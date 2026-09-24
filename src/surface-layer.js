// Ground surfaces made from a GLB model (visualization only).
//
// A Garden.geojson polygon whose properties name a "surface_model" (for example
// "/models/grass.glb") is covered with that model as seen from straight above:
// `npm run models:optimize` renders the model top-down into a seamless tile
// (public/models/lod/<name>.surface.webp, listed in the manifest) and this layer
// repeats the tile across the polygon at the model's real size.
//   surface_model  GLB whose top view covers the polygon
//   surface_scale  metres per model unit (default 1; grass.glb is in centimetres: 0.01)
//   top_m          height of the surface, as for the flat colour it replaces
// Every repeat of the tile is mirrored at random (the tile is seamless, so the result
// is too), which hides the repetition. Like the scanned grass, the surface is unlit.
// The polygon geometry is not changed. Polygons are removed from the flat-colour layer
// (`coveredLayerId`) once their surface is ready; without a surface tile (model not
// optimized yet, or a load error) they keep their flat colour.
//
// Built on the custom-layer pattern of tree-layer.js: a local metric frame anchored
// at a MercatorCoordinate origin, projected with MapLibre's mainMatrix; one mesh and
// one draw call per surface model.
//
// SURFACE_APPEARANCE (config.js) can tint, lighten and fade a model's surface
// (used for grass.glb only). The fade keeps the canvas alpha at 1 (see the
// impostor note in models3d.js), so the page never shows through.
import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import { SURFACE_APPEARANCE } from "./config.js";
import { modelManifestEntry } from "./models3d.js";
import { publicAssetUrl } from "./paths.js";
import { acquireRenderer, releaseRenderer } from "./three-shared.js";
import { parseNumber } from "./visual-properties.js";

// Replaces three.js's map_fragment: sample the tile mirrored at random per repeat, with
// the derivatives of the continuous coordinates so mipmapping has no seams.
const MAP_FRAGMENT = `
#ifdef USE_MAP
	vec2 bcsirCell = floor( vMapUv );
	vec2 bcsirFlip = step( 0.5, fract( sin( vec2( dot( bcsirCell, vec2( 127.1, 311.7 ) ), dot( bcsirCell, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 ) );
	vec2 bcsirSign = 1.0 - 2.0 * bcsirFlip;
	vec2 bcsirUv = mix( vMapUv - bcsirCell, 1.0 - ( vMapUv - bcsirCell ), bcsirFlip );
	diffuseColor *= textureGrad( map, bcsirUv, dFdx( vMapUv ) * bcsirSign, dFdy( vMapUv ) * bcsirSign );
#endif
#ifdef BCSIR_APPEARANCE
	// Recolour: the tile's light and dark detail around the tint colour.
	float bcsirLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	vec3 bcsirRecoloured = bcsirTint * clamp( mix( 1.0, bcsirLuma / bcsirMeanLuma, 0.6 ), 0.7, 1.3 );
	diffuseColor.rgb = mix( diffuseColor.rgb, bcsirRecoloured, bcsirTintAmount );
	diffuseColor.rgb += ( 1.0 - diffuseColor.rgb ) * bcsirLighten;
#endif`;

// Mean linear luminance of a texture image (sampled at 32 x 32), for the recolour.
function meanLuminance(image) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, 32, 32);
    const { data } = ctx.getImageData(0, 0, 32, 32);
    const linear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * linear(data[i]) + 0.7152 * linear(data[i + 1]) + 0.0722 * linear(data[i + 2]);
    return Math.max(0.005, sum / (data.length / 4));
  } catch {
    return 0.05;
  }
}

function modelFileName(model) {
  return decodeURIComponent(String(model).split(/[?#]/)[0].split("/").pop() || "").toLowerCase();
}

// Material for one surface model, with its SURFACE_APPEARANCE entry if any.
function surfaceMaterial(texture, model) {
  const appearance = Object.entries(SURFACE_APPEARANCE).find(([name]) => name.toLowerCase() === modelFileName(model))?.[1];
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const opacity = Math.min(1, Math.max(0, Number(appearance?.opacity ?? 1)));
  if (opacity < 1) {
    material.transparent = true;
    material.opacity = opacity;
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.SrcAlphaFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
  }
  const uniforms = appearance ? {
    bcsirTint: { value: new THREE.Color(appearance.tint || "#ffffff") },
    bcsirTintAmount: { value: Number(appearance.tintAmount) || 0 },
    bcsirLighten: { value: Number(appearance.lighten) || 0 },
    bcsirMeanLuma: { value: meanLuminance(texture.image) }
  } : null;
  material.onBeforeCompile = (shader) => {
    if (uniforms) {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = `#define BCSIR_APPEARANCE\nuniform vec3 bcsirTint;\nuniform float bcsirTintAmount;\nuniform float bcsirLighten;\nuniform float bcsirMeanLuma;\n${shader.fragmentShader}`;
    }
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", MAP_FRAGMENT);
  };
  material.customProgramCacheKey = () => (uniforms ? "bcsir-surface-appearance" : "bcsir-surface");
  return material;
}

function surfaceOf(feature) {
  const p = feature?.properties || {};
  if (typeof p.surface_model !== "string" || !/\.(glb|gltf)(?:[?#].*)?$/i.test(p.surface_model.trim())) return null;
  const type = feature.geometry?.type;
  if (type !== "Polygon" && type !== "MultiPolygon") return null;
  const scale = parseNumber(p.surface_scale);
  return { model: p.surface_model.trim(), scale: scale > 0 ? scale : 1 };
}

export function surfaceLayer(id, collection, { coveredLayerId } = {}) {
  let map, gl, renderer, scene, camera, origin;
  let visible = true;
  let generation = 0;
  const meshes = [];
  const transform = new THREE.Matrix4();
  const projection = new THREE.Matrix4();
  const scaleMatrix = new THREE.Matrix4();

  function clear() {
    for (const mesh of meshes.splice(0)) {
      scene?.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }
  }

  // Covered polygons leave the flat-colour layer once their surface is drawn.
  function updateCoveredFilter(readyModels) {
    if (!coveredLayerId || !map?.getLayer(coveredLayerId)) return;
    map.setFilter(coveredLayerId, readyModels.length ? ["!", ["in", ["get", "surface_model"], ["literal", readyModels]]] : null);
  }

  function buildGeometry(features, tile) {
    const unitsPerMetre = origin.meterInMercatorCoordinateUnits();
    const toLocal = (lngLat) => {
      const m = MercatorCoordinate.fromLngLat(lngLat, 0);
      return new THREE.Vector2((m.x - origin.x) / unitsPerMetre, -(m.y - origin.y) / unitsPerMetre);
    };
    const positions = [];
    const uvs = [];
    const indices = [];
    for (const { feature, surface } of features) {
      const height = Number(feature.properties.render_top_m) || 0;
      const tileW = tile.width * surface.scale;
      const tileH = tile.height * surface.scale;
      const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const polygon of polygons) {
        if (!Array.isArray(polygon?.[0]) || polygon[0].length < 4) continue;
        const contour = polygon[0].map(toLocal);
        const holes = polygon.slice(1).map((ring) => ring.map(toLocal));
        const faces = THREE.ShapeUtils.triangulateShape(contour, holes); // drops closing points
        const first = positions.length / 3;
        for (const point of [contour, ...holes].flat()) {
          positions.push(point.x, point.y, height);
          uvs.push(point.x / tileW, point.y / tileH);
        }
        for (const face of faces) indices.push(first + face[0], first + face[1], first + face[2]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
  }

  async function rebuild(data) {
    collection = data;
    if (!scene) return;
    const current = ++generation;
    clear();
    const byModel = new Map();
    for (const feature of collection?.features || []) {
      const surface = surfaceOf(feature);
      if (!surface) continue;
      if (!byModel.has(surface.model)) byModel.set(surface.model, []);
      byModel.get(surface.model).push({ feature, surface });
    }
    updateCoveredFilter([]);
    if (!byModel.size) { map?.triggerRepaint(); return; }
    if (!origin) {
      const { geometry } = byModel.values().next().value[0].feature;
      origin = MercatorCoordinate.fromLngLat(geometry.type === "Polygon" ? geometry.coordinates[0][0] : geometry.coordinates[0][0][0], 0);
    }

    const ready = [];
    await Promise.all([...byModel].map(async ([model, features]) => {
      try {
        const tile = (await modelManifestEntry(publicAssetUrl(model)))?.surface;
        if (!tile) {
          console.warn(`${model}: no ground-surface tile; run "npm run models:optimize". Those Garden polygons keep their flat colour.`);
          return;
        }
        const texture = await new THREE.TextureLoader().loadAsync(tile.url);
        if (current !== generation || !scene) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        const material = surfaceMaterial(texture, model);
        const mesh = new THREE.Mesh(buildGeometry(features, tile), material);
        mesh.frustumCulled = false;
        scene.add(mesh);
        meshes.push(mesh);
        ready.push(model);
      } catch (error) {
        console.error(`Ground surface ${model} could not be loaded; those Garden polygons keep their flat colour.`, error);
      }
    }));
    if (current !== generation) return;
    updateCoveredFilter(ready);
    map?.triggerRepaint();
  }

  return {
    id,
    type: "custom",
    renderingMode: "3d",
    onAdd(mapInstance, context) {
      map = mapInstance;
      gl = context;
      scene = new THREE.Scene();
      camera = new THREE.Camera();
      renderer = acquireRenderer(map, gl);
      rebuild(collection);
    },
    setData: rebuild,
    setVisible(next) { visible = Boolean(next); map?.triggerRepaint(); },
    isVisible: () => visible,
    render(_gl, args) {
      const matrix = args?.defaultProjectionData?.mainMatrix;
      if (!visible || !origin || !matrix || !meshes.length) return;
      const s = origin.meterInMercatorCoordinateUnits();
      scaleMatrix.makeScale(s, -s, s);
      transform.makeTranslation(origin.x, origin.y, origin.z).multiply(scaleMatrix);
      camera.projectionMatrix = projection.fromArray(matrix).multiply(transform);
      renderer.resetState();
      renderer.render(scene, camera);
      renderer.resetState();
    },
    onRemove() {
      generation += 1;
      clear();
      releaseRenderer(gl);
      scene = camera = renderer = null;
    }
  };
}
