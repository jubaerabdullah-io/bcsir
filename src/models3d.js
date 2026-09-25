// GLB/GLTF model rendering for MapLibre, reused from the reference
// indoor-mapping project (src/models3d.js).
//
// Kept from the reference (unchanged behaviour):
// - placement from a single Point [longitude, latitude]; base_m, top_m, scale,
//   size and rotation properties; in-place 360° yaw around the model centre;
// - MercatorCoordinate anchor + meterInMercatorCoordinateUnits() scale and the
//   same model/projection matrix maths, so models stay geographically aligned
//   while the camera moves;
// - the same three lights, fixed in each model's own frame (they turn with the
//   model's rotation), so every model is shaded exactly as before.
//
// Extended for the BCSIR map:
// - one THREE.WebGLRenderer shared by all layers (see three-shared.js);
// - sync3DModels() applies a FeatureCollection incrementally;
// - no continuous repaint loop; a repaint is requested only when something changes;
// - Draco and Meshopt compressed GLBs are supported;
// - visibility switches (global and per layer group) for the layer manager.
//
// Performance (2026-09-24). The reference drew every placed model with its own
// MapLibre custom layer and full-detail GLB (277 trees: ~1,400 draw calls and 27
// million triangles per frame). Now:
// - ONE custom layer ("3d-models") draws every model. Placements of the same GLB
//   are drawn with THREE.InstancedMesh: one draw call per GLB part and detail
//   level instead of one per placement. A small vertex-shader addition places
//   each instance with the reference's matrix maths, and lighting is still
//   computed in the model's own frame.
// - Levels of detail from public/models/lod/manifest.json (written by
//   `npm run models:optimize`): a model is drawn with the level that suits its
//   height on screen. The coarsest level is loaded first, so models appear
//   quickly; finer levels are downloaded only when a model is shown large enough.
//   Every level is fitted with the ORIGINAL model's bounding box (recorded in
//   the manifest), so positions and sizes are identical at every level.
// - Visibility by zoom level and distance (MODEL_VISIBILITY in config.js):
//   models are not drawn below minZoom, beyond maxDistanceM, when smaller than
//   minPixels on screen, or outside the view; models smaller than impostorPixels
//   are drawn as impostors (pre-rendered views of the model on camera-facing cards).
// - Transparent parts (leaf cards) are drawn back to front.
//
// Models are configured in GeoJSON (public/data/models.geojson and the other
// datasets, see model-placements.js); the model-manager UI was removed.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { MercatorCoordinate } from "maplibre-gl";
import { MODEL_VISIBILITY } from "./config.js";
import { publicAssetUrl } from "./paths.js";
import { acquireRenderer, releaseRenderer } from "./three-shared.js";

THREE.Cache.enabled = true;

const LAYER_ID = "3d-models";
const placementsByKey = new Map(); // geojsonUrl -> placements
const lastSignatureByUrl = new Map();
const hiddenKeys = new Set(); // model sets (geojsonUrl keys) hidden by the layer manager
let modelsVisible = true;
let modelLayer = null;
let lastStats = { placements: 0, drawn: 0, culled: 0, pendingDrawable: 0, loading: 0, levels: {} };

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDegrees(value) {
  const number = toFiniteNumber(value) ?? 0;
  return ((number % 360) + 360) % 360;
}

function toRadians(degrees) {
  return normalizeDegrees(degrees) * Math.PI / 180;
}

function safeId(value) {
  const cleaned = String(value ?? "model")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "model";
}

function resolveModelUrl(modelPath) {
  return publicAssetUrl(modelPath);
}

function firstFinite(properties, names) {
  for (const name of names) {
    const value = toFiniteNumber(properties?.[name]);
    if (value !== null) return value;
  }
  return null;
}

// `fit`: [width, height, depth] in metres (height may be null), or null.
function fitSizeOf(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const size = value.map(toFiniteNumber);
  return size[0] > 0 && size[2] > 0 ? size : null;
}

function resolveSizeMultiplier(value) {
  const size = toFiniteNumber(value);
  if (size === null || size === 0) return 1;
  return size > 0 ? size : 1 / (1 + Math.abs(size));
}

/*
  Simple placement logic (reference)
  ----------------------------------
  A model has ONE map position only.  No separate pivot is needed.

  Preferred GeoJSON form:
    geometry: { type: "Point", coordinates: [longitude, latitude] }

  Also accepted when a non-spatial table is used:
    properties: { lon: 90.39, lat: 23.75 }

  rotation is a yaw in degrees and may be any value. It is normalized to
  0..359.999 and rotates the object around its own horizontal centre.

  base_m is the altitude of the model bottom; top_m (optional) fits the model
  height between base_m and top_m. size is a uniform multiplier: 1 preserves the
  rendered size, 0.5 halves it and 2 doubles it.
*/
function getModelPosition(feature) {
  const properties = feature?.properties || {};
  const propertyLongitude = firstFinite(properties, ["lon", "lng", "longitude", "model_lon", "model_lng"]);
  const propertyLatitude = firstFinite(properties, ["lat", "latitude", "model_lat"]);

  if (propertyLongitude !== null && propertyLatitude !== null) {
    return { longitude: propertyLongitude, latitude: propertyLatitude };
  }

  if (feature?.geometry?.type === "Point" && Array.isArray(feature.geometry.coordinates)) {
    const longitude = toFiniteNumber(feature.geometry.coordinates[0]);
    const latitude = toFiniteNumber(feature.geometry.coordinates[1]);
    if (longitude !== null && latitude !== null) return { longitude, latitude };
  }

  return null;
}

function disposeObject3D(root) {
  if (!root) return;

  const disposedTextures = new WeakSet();
  const disposedMaterials = new WeakSet();
  const disposedGeometries = new WeakSet();

  root.traverse((object) => {
    if (object.geometry && !disposedGeometries.has(object.geometry)) {
      disposedGeometries.add(object.geometry);
      object.geometry.dispose?.();
    }

    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];

    for (const material of materials) {
      if (!material || disposedMaterials.has(material)) continue;
      disposedMaterials.add(material);

      for (const value of Object.values(material)) {
        if (value?.isTexture && !disposedTextures.has(value)) {
          disposedTextures.add(value);
          value.dispose?.();
        }
      }
      material.dispose?.();
    }
  });
}

let loader = null;
function getLoader() {
  if (!loader) {
    loader = new GLTFLoader();
    // DRACOLoader resolves its bundled decoder via import.meta.url (Vite emits it).
    loader.setDRACOLoader(new DRACOLoader());
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

// ---- Load results per model URL (whenModelLoaded) -------------------------------------
// Resolved with { url, box } when the first detail level of that file has loaded,
// rejected when every level failed. Nothing waits on them unless asked.
const loadResults = new Map();
function loadResult(url) {
  let entry = loadResults.get(url);
  if (!entry) {
    entry = { settled: false };
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    entry.promise.catch(() => {});
    loadResults.set(url, entry);
  }
  return entry;
}
function settleLoad(url, error, box, fitBox) {
  const entry = loadResult(url);
  if (entry.settled) return;
  entry.settled = true;
  if (error) entry.reject(error); else entry.resolve({ url, box: box.clone(), fitBox: (fitBox || box).clone() });
}
export function whenModelLoaded(url) {
  return loadResult(url).promise;
}

// ---- Level-of-detail manifest (scripts/optimize-models.mjs) ---------------------------
let manifestPromise = null;
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(publicAssetUrl("models/lod/manifest.json"), { cache: "no-cache" })
      .then((response) => (response.ok ? response.json() : { models: {} }))
      .catch(() => ({ models: {} }));
  }
  return manifestPromise;
}

// Path of a model URL inside public/models/ ("mango_tree.glb"), or null.
function manifestKey(url) {
  const base = publicAssetUrl("models/");
  return url.startsWith(base) ? decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]) : null;
}

// The manifest entry of a model (URLs resolved), or null when the model was not
// optimized yet: it is then drawn from its own file only. A GLB replaced under the same
// name after the optimizer ran is reported by `npm run dev`, `npm run build` and `npm test`.
const entryPromises = new Map();
export function modelManifestEntry(url) {
  if (!entryPromises.has(url)) {
    entryPromises.set(url, loadManifest().then((manifest) => {
      const key = manifestKey(url);
      const entry = key ? manifest.models?.[key] : null;
      if (!entry) return null;
      const folder = publicAssetUrl("models/");
      return {
        ...entry,
        lods: entry.lods.map((lod) => ({ ...lod, url: new URL(lod.url, folder).href })),
        surface: entry.surface ? { ...entry.surface, url: new URL(entry.surface.url, folder).href } : null
      };
    }));
  }
  return entryPromises.get(url);
}

// ---- Instanced drawing -----------------------------------------------------------------
// Each instance carries the reference's model matrix in compact form:
//   bcsirPlace = (east, north, up) offset in metres from the layer origin, and the
//                ratio of the placement's Mercator scale to the origin's;
//   bcsirYaw   = (cos, sin) of the rotation.
// instanceMatrix holds the fit (scale, centring) in the GLB's own Y-up frame, so
// lighting (mvPosition, normals) is computed in that frame exactly as before.
// Non-instanced use of the same materials (the impostor views) keeps three.js's projection.
const PLACE_VERTEX = THREE.ShaderChunk.project_vertex.replace(
  "gl_Position = projectionMatrix * mvPosition;",
  `#ifdef USE_INSTANCING
	vec3 bcsirLocal = mvPosition.xyz;
	gl_Position = projectionMatrix * vec4(
		bcsirPlace.x + bcsirPlace.w * ( bcsirYaw.x * bcsirLocal.x - bcsirYaw.y * bcsirLocal.z ),
		bcsirPlace.y - bcsirPlace.w * ( bcsirYaw.y * bcsirLocal.x + bcsirYaw.x * bcsirLocal.z ),
		bcsirPlace.z + bcsirPlace.w * bcsirLocal.y,
		1.0 );
#else
	gl_Position = projectionMatrix * mvPosition;
#endif`
);

// ---- Impostors: models only a few pixels tall ---------------------------------------
// When its first detail level has loaded, each GLB is rendered once (in MapLibre's
// offscreen pass) from IMPOSTOR_AZIMUTHS directions at IMPOSTOR_ELEVATIONS heights,
// with the same lights in the model's own frame. A model smaller than
// MODEL_VISIBILITY.impostorPixels on screen is drawn as a camera-facing card showing
// the view closest to the actual one: two triangles instead of thousands.
// The views are rendered with the model as tall as it is on screen (IMPOSTOR_HEIGHTS,
// pixels; the closest set is used): leaf textures fade with mipmapping at small sizes,
// so views rendered larger would show fuller, lighter crowns than the models do.
// A set of views is rendered only when a model of that size is on screen (within
// IMPOSTOR_FRAME_BUDGET ms per frame); until then the closest set already rendered is
// used, or the model waits a frame. Small models never need the detail levels' shaders.
const IMPOSTOR_AZIMUTHS = 8;
const IMPOSTOR_ELEVATIONS = 4; // 0, 30, 60 and 90 degrees above the horizon
const IMPOSTOR_HEIGHTS = [6, 12, 20, 32];
const IMPOSTOR_FRAME_BUDGET = 30;

const IMPOSTOR_VERTEX = `
attribute vec4 bcsirCenter; // centre in metres from the layer origin, half-size in metres
attribute vec2 bcsirYaw; // cos, sin of the model rotation
uniform vec3 eyePosition;
varying vec2 vAtlasUv;
void main() {
	vec3 center = bcsirCenter.xyz;
	vec3 d = normalize( eyePosition - center );
	// Direction to the camera in the model's frame (Y up), as used for the views.
	vec3 m = vec3( bcsirYaw.x * d.x - bcsirYaw.y * d.y, d.z, - bcsirYaw.y * d.x - bcsirYaw.x * d.y );
	float azimuth = atan( m.x, m.z );
	float elevation = asin( clamp( m.y, 0.0, 1.0 ) );
	float column = mod( floor( azimuth / ${(2 * Math.PI).toFixed(6)} * ${IMPOSTOR_AZIMUTHS}.0 + 0.5 ), ${IMPOSTOR_AZIMUTHS}.0 );
	float row = clamp( floor( elevation / ${(Math.PI / 2).toFixed(6)} * ${IMPOSTOR_ELEVATIONS - 1}.0 + 0.5 ), 0.0, ${IMPOSTOR_ELEVATIONS - 1}.0 );
	vAtlasUv = vec2( ( column + uv.x ) / ${IMPOSTOR_AZIMUTHS}.0, ( row + uv.y ) / ${IMPOSTOR_ELEVATIONS}.0 );
	vec3 right = cross( vec3( 0.0, 0.0, 1.0 ), d );
	right = length( right ) < 1e-5 ? vec3( 1.0, 0.0, 0.0 ) : normalize( right );
	vec3 up = cross( d, right );
	vec3 world = center + ( position.x * right + position.y * up ) * 2.0 * bcsirCenter.w;
	gl_Position = projectionMatrix * vec4( world, 1.0 );
}`;

const IMPOSTOR_FRAGMENT = `
uniform sampler2D atlas;
varying vec2 vAtlasUv;
void main() {
	vec4 texel = texture2D( atlas, vAtlasUv ); // premultiplied by coverage
	if ( texel.a < 0.02 ) discard;
	gl_FragColor = vec4( texel.rgb / texel.a, texel.a );
	#include <colorspace_fragment>
}`;

// Renders the views of one model (GLB frame, original bounding box) into a texture;
// each view is `cell` pixels square.
function bakeImpostor(renderer, sourceScene, box, cell) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const target = new THREE.WebGLRenderTarget(IMPOSTOR_AZIMUTHS * cell, IMPOSTOR_ELEVATIONS * cell, {
    samples: 4,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const light1 = new THREE.DirectionalLight(0xffffff, 1.5);
  light1.position.set(0, -70, 100).normalize();
  const light2 = new THREE.DirectionalLight(0xffffff, 1);
  light2.position.set(0, 70, 100).normalize();
  scene.add(light1, light2);
  const parent = sourceScene.parent;
  scene.add(sourceScene);
  const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, radius * 0.01, radius * 4);
  const clearColor = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  target.scissorTest = true;
  target.viewport.set(0, 0, target.width, target.height);
  target.scissor.set(0, 0, target.width, target.height);
  renderer.setRenderTarget(target);
  renderer.clear(true, true, false);
  // Mipmaps once, after the last view.
  target.texture.generateMipmaps = false;
  for (let row = 0; row < IMPOSTOR_ELEVATIONS; row += 1) {
    const elevation = (row / (IMPOSTOR_ELEVATIONS - 1)) * Math.PI / 2;
    for (let column = 0; column < IMPOSTOR_AZIMUTHS; column += 1) {
      const azimuth = (column / IMPOSTOR_AZIMUTHS) * Math.PI * 2;
      const direction = new THREE.Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));
      camera.position.copy(center).addScaledVector(direction, radius * 2);
      // Seen from straight above, "up" in the view points away from the camera's azimuth.
      if (row === IMPOSTOR_ELEVATIONS - 1) camera.up.set(-Math.sin(azimuth), 0, -Math.cos(azimuth)); else camera.up.set(0, 1, 0);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      target.viewport.set(column * cell, row * cell, cell, cell);
      target.scissor.copy(target.viewport);
      target.texture.generateMipmaps = row === IMPOSTOR_ELEVATIONS - 1 && column === IMPOSTOR_AZIMUTHS - 1;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
    }
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(clearColor, clearAlpha);
  scene.remove(sourceScene);
  if (parent) parent.add(sourceScene);
  return target;
}

function createImpostorMesh(texture, capacity) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const center = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const yaw = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("bcsirCenter", center);
  geometry.setAttribute("bcsirYaw", yaw);
  const material = new THREE.ShaderMaterial({
    uniforms: { atlas: { value: texture }, eyePosition: { value: new THREE.Vector3() } },
    vertexShader: IMPOSTOR_VERTEX,
    fragmentShader: IMPOSTOR_FRAGMENT,
    side: THREE.DoubleSide,
    // Coverage from the view's alpha; the map canvas keeps alpha 1 (a lower alpha would
    // let the page show through the edges).
    alphaToCoverage: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.ZeroFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.count = 0;
  return { mesh, center, yaw };
}

function preparePlacedMaterial(material) {
  if (material.userData.bcsirPlaced) return;
  material.userData.bcsirPlaced = true;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec4 bcsirPlace;\nattribute vec2 bcsirYaw;\n${shader.vertexShader.replace("#include <project_vertex>", PLACE_VERTEX)}`;
  };
  material.customProgramCacheKey = () => "bcsir-placed";
  material.needsUpdate = true;
}

// three.js draws a transparent double-sided material in two passes (back faces,
// then front faces), flipping material.side and forcing a shader program lookup
// before each pass, on every frame. Such a part is drawn instead by two meshes
// made one after the other, with a back-side and a front-side copy of the
// material: transparent objects at the same depth are drawn in creation order, so
// the result and the order are the same, without the per-frame program changes.
const sidedCopies = new WeakMap(); // material -> [back, front]
function sidedMaterials(material) {
  if (!sidedCopies.has(material)) {
    sidedCopies.set(material, [THREE.BackSide, THREE.FrontSide].map((side) => {
      const copy = material.clone();
      copy.side = side;
      copy.userData = { ...copy.userData, bcsirPlaced: false };
      preparePlacedMaterial(copy);
      return copy;
    }));
  }
  return sidedCopies.get(material);
}
const twoPass = (material) => !Array.isArray(material) && material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass;

// One drawable part of one detail level: a GLB mesh drawn for many placements.
function createPart(sourceMesh, capacity) {
  // Geometry attributes are shared with the loaded GLB; only the per-instance
  // attributes are added to this copy.
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(sourceMesh.geometry.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(sourceMesh.geometry.index);
  for (const group of sourceMesh.geometry.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const place = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const yaw = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("bcsirPlace", place);
  geometry.setAttribute("bcsirYaw", yaw);
  const materials = Array.isArray(sourceMesh.material) ? sourceMesh.material : [sourceMesh.material];
  materials.forEach(preparePlacedMaterial);
  const instanced = (material) => {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // culled per placement in render()
    mesh.matrixAutoUpdate = false;
    mesh.count = 0;
    return mesh;
  };
  const mesh = instanced(twoPass(sourceMesh.material) ? sidedMaterials(sourceMesh.material)[0] : sourceMesh.material);
  // Front faces of a two-pass material: same geometry and instance data.
  const front = twoPass(sourceMesh.material) ? instanced(sidedMaterials(sourceMesh.material)[1]) : null;
  if (front) front.instanceMatrix = mesh.instanceMatrix;
  return {
    mesh,
    front,
    sourceMaterial: sourceMesh.material,
    place,
    yaw,
    meshMatrix: sourceMesh.matrixWorld.clone(),
    transparent: materials.some((material) => material.transparent),
    drawn: [], // placements whose instance data is on the GPU, in order
    drawnVersion: -1
  };
}

// Bumped whenever a placement is fitted again (its instance data changes).
let placementVersion = 0;

function removePart(part) {
  for (const mesh of [part.mesh, part.front]) {
    if (!mesh) continue;
    mesh.removeFromParent();
    mesh.dispose();
  }
}

// A GLB used by one or more placements, with its detail levels.
// precompile(level, withBake) resolves when the level's shaders (and, withBake, those
// of the impostor views) have compiled; the level is drawn only then.
function createTemplate(url, onChange, precompile = () => Promise.resolve()) {
  const template = {
    url,
    users: 0,
    box: null, // bounding box of the ORIGINAL model (fit and centring)
    // Part of the model that stands on the building footprint (GLB scene extras
    // "bcsir_footprint": { min, max } in metres), used by `fit` placements; a canopy
    // or steps may reach beyond it. Null: the whole bounding box.
    fitBox: null,
    levels: null, // [{ url, minPx, state, scene, parts, instances }], finest first
    ready: false,
    disposed: false,
    capacity: 0,
    bakeSource: null, // first loaded level: the impostor views are rendered from it
    impostors: null // [{ height, target, part, instances, wanted }], part once rendered
  };

  function loadLevel(index) {
    const level = template.levels[index];
    if (level.state !== "idle") return;
    level.state = "loading";
    getLoader().loadAsync(level.url).then(
      (gltf) => {
        if (template.disposed) { disposeObject3D(gltf.scene); return; }
        gltf.scene.updateMatrixWorld(true);
        // Without a manifest entry the box comes from the file itself (reference behaviour).
        if (!template.box) template.box = new THREE.Box3().setFromObject(gltf.scene);
        const footprint = gltf.scene.userData?.bcsir_footprint;
        if (!template.fitBox && Array.isArray(footprint?.min) && Array.isArray(footprint?.max)) {
          template.fitBox = new THREE.Box3(new THREE.Vector3(...footprint.min), new THREE.Vector3(...footprint.max));
        }
        level.scene = gltf.scene;
        level.parts = [];
        gltf.scene.traverse((object) => { if (object.isMesh) level.parts.push(createPart(object, Math.max(1, template.capacity))); });
        // Drawn once its shaders have compiled in the background (no main-thread stall).
        level.state = "compiling";
        const bake = !template.bakeSource;
        if (bake) {
          template.bakeSource = gltf.scene;
          template.impostors = IMPOSTOR_HEIGHTS.map((height) => ({ height, target: null, part: null, instances: [], wanted: false }));
        }
        console.info(`3D model loaded: ${level.url}`, { detailLevel: index, placements: template.users });
        precompile(level, bake).then(() => {
          if (template.disposed) return;
          level.state = "ready";
          if (bake) template.bakeReady = true;
          settleLoad(template.url, null, template.box, template.fitBox);
          onChange();
        });
        onChange();
      },
      (error) => {
        level.state = "failed";
        if (!template.disposed) console.error(`3D model loading failed: ${level.url}`, error);
        if (template.levels.every((item) => item.state === "failed")) settleLoad(template.url, error);
        onChange();
      }
    );
  }

  template.init = modelManifestEntry(url).then((entry) => {
    if (template.disposed) return;
    if (entry?.lods?.length) {
      template.box = new THREE.Box3(new THREE.Vector3(...entry.box.min), new THREE.Vector3(...entry.box.max));
      template.levels = entry.lods.map((lod) => ({ url: lod.url, minPx: lod.minPx, state: "idle", parts: null, instances: [] }));
    } else {
      template.levels = [{ url, minPx: 0, state: "idle", parts: null, instances: [] }];
    }
    template.ready = true;
    loadLevel(template.levels.length - 1); // coarsest first: every model appears quickly
    onChange();
  });

  // Level to draw for a model `px` pixels tall: the wanted level if loaded, otherwise the
  // closest loaded one (finer first). Loads the wanted level when it is missing.
  template.levelFor = (px) => {
    const levels = template.levels;
    let want = levels.length - 1;
    for (let i = 0; i < levels.length; i += 1) if (px >= levels[i].minPx) { want = i; break; }
    if (levels[want].state === "idle") loadLevel(want);
    else if (levels[want].state === "failed" && !levels.some((level) => level.state === "ready" || level.state === "loading" || level.state === "compiling")) {
      // That file is missing: fall back to the nearest other level.
      for (let d = 1; d < levels.length; d += 1) {
        const other = levels[want + d]?.state === "idle" ? want + d : levels[want - d]?.state === "idle" ? want - d : -1;
        if (other >= 0) { loadLevel(other); break; }
      }
    }
    for (let d = 0; d < levels.length; d += 1) {
      if (levels[want - d]?.state === "ready") return want - d;
      if (levels[want + d]?.state === "ready") return want + d;
    }
    return -1;
  };

  template.setCapacity = (capacity) => {
    if (capacity <= template.capacity) return;
    template.capacity = capacity;
    for (const level of template.levels || []) {
      if (!level.parts) continue;
      level.parts = level.parts.map((part) => {
        removePart(part);
        return createPart({ geometry: part.mesh.geometry, material: part.sourceMaterial, matrixWorld: part.meshMatrix }, capacity);
      });
    }
    for (const impostor of template.impostors || []) {
      if (!impostor.part) continue;
      impostor.part.mesh.removeFromParent();
      impostor.part.mesh.dispose();
      impostor.part = createImpostorMesh(impostor.target.texture, capacity);
    }
  };

  // Called from the layer's offscreen pass: renders one wanted set of views.
  template.bakeNextImpostor = (renderer) => {
    const impostor = template.disposed || !template.bakeReady ? null : template.impostors?.find((item) => item.wanted && !item.part);
    if (!impostor) return false;
    const size = template.box.getSize(new THREE.Vector3());
    // View size so the model is `height` pixels tall in it.
    const cell = Math.max(4, Math.ceil((impostor.height * size.length()) / Math.max(size.y, 1e-6)));
    renderer.resetState();
    impostor.target = bakeImpostor(renderer, template.bakeSource, template.box, cell);
    renderer.resetState();
    impostor.part = createImpostorMesh(impostor.target.texture, Math.max(1, template.capacity));
    return true;
  };

  template.dispose = () => {
    template.disposed = true;
    for (const level of template.levels || []) {
      for (const part of level.parts || []) {
        removePart(part);
        if (part.front) sidedMaterials(part.sourceMaterial).forEach((material) => material.dispose());
      }
      if (level.scene) disposeObject3D(level.scene);
    }
    for (const impostor of template.impostors || []) {
      if (!impostor.part) continue;
      impostor.part.mesh.removeFromParent();
      impostor.part.mesh.geometry.dispose();
      impostor.part.mesh.material.dispose();
      impostor.part.mesh.dispose();
      impostor.target.dispose();
    }
  };
  return template;
}

// -----------------------------------------------------------------------------

function normalizeFeatures(features) {
  const seen = new Map();
  const entries = [];

  (features || []).forEach((feature, index) => {
    if (!feature) return;
    const position = getModelPosition(feature);
    if (!position) return;

    const properties = feature.properties || {};
    const fallbackId = [
      properties.model || "model",
      position.longitude,
      position.latitude,
      index
    ].join("-");

    const originalId = safeId(properties.id || fallbackId);
    const count = seen.get(originalId) || 0;
    seen.set(originalId, count + 1);
    const id = count ? `${originalId}__${count + 1}` : originalId;

    entries.push({ id, feature, position });
  });

  return entries;
}

function buildSignature(entries) {
  return JSON.stringify(
    entries.map(({ id, feature, position }) => {
      const properties = feature.properties || {};
      return {
        id,
        model: properties.model ?? null,
        longitude: position.longitude,
        latitude: position.latitude,
        base_m: properties.base_m ?? null,
        top_m: properties.top_m ?? null,
        scale: properties.scale ?? null,
        size: properties.size ?? null,
        rotation: normalizeDegrees(properties.rotation),
        building: properties.building === true,
        fit: fitSizeOf(properties.fit)
      };
    })
  );
}

// Route, labels and markers stay above the 3D models (reference behaviour).
const OVERLAY_LAYERS = [
  "route-casing",
  "route-line",
  "route-access",
  "route-point-circles",
  "route-point-labels",
  "building-labels-major",
  "building-labels-minor"
];

export function keepMapOverlaysOnTop(map) {
  OVERLAY_LAYERS.forEach((id) => {
    if (map.getLayer(id)) map.moveLayer(id);
  });
}

// Fit of one placement in the GLB frame (reference applyModelSizeAndFloor(), from the
// original bounding box): uniform scale, horizontal centre on the map position, bottom
// at base_m. Also the metric offset and bounding sphere used for culling.
function placeModel(placement, box, origin, fitBox = null) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  let factor = Number.isFinite(placement.scale) && placement.scale > 0 ? placement.scale : 1;
  if (Number.isFinite(placement.topM) && placement.topM > placement.baseM && size.y > 0) {
    factor = (placement.topM - placement.baseM) / size.y;
  }
  factor *= resolveSizeMultiplier(placement.size);
  let scale = [factor, factor, factor];
  let fitCenter = center, fitMinY = box.min.y;
  if (placement.fitSize) {
    // `fit` placements (building-models.js): the footprint part of the model is
    // stretched to width x height x depth metres (height null: the mean of the
    // other two factors), then multiplied by size.
    const target = fitBox || box;
    const fs = target.getSize(new THREE.Vector3());
    const [w, h, d] = placement.fitSize;
    const sx = w > 0 && fs.x > 0 ? w / fs.x : 1, sz = d > 0 && fs.z > 0 ? d / fs.z : 1;
    const sy = h > 0 && fs.y > 0 ? h / fs.y : (sx + sz) / 2;
    const multiplier = resolveSizeMultiplier(placement.size);
    scale = [sx * multiplier, sy * multiplier, sz * multiplier];
    fitCenter = target.getCenter(new THREE.Vector3());
    fitMinY = target.min.y;
  }
  placementVersion += 1;
  placement.fitBox = fitBox;
  placement.fit = new THREE.Matrix4()
    .makeTranslation(-scale[0] * fitCenter.x, -scale[1] * fitMinY, -scale[2] * fitCenter.z)
    .multiply(new THREE.Matrix4().makeScale(...scale));

  const anchor = MercatorCoordinate.fromLngLat([placement.longitude, placement.latitude], placement.baseM);
  const unitsPerMetre = origin.meterInMercatorCoordinateUnits();
  const k = anchor.meterInMercatorCoordinateUnits() / unitsPerMetre;
  const yaw = toRadians(placement.rotation);
  placement.place = [
    (anchor.x - origin.x) / unitsPerMetre,
    -(anchor.y - origin.y) / unitsPerMetre,
    (anchor.z - origin.z) / unitsPerMetre,
    k
  ];
  placement.yaw = [Math.cos(yaw), Math.sin(yaw)];
  placement.heightM = size.y * scale[1] * k;
  placement.center = new THREE.Vector3(placement.place[0], placement.place[1], placement.place[2] + placement.heightM / 2);
  placement.radius = 0.5 * Math.hypot(size.x * scale[0], size.y * scale[1], size.z * scale[2]) * k * 1.1;
  placement.box = box;
}

function createModelsLayer() {
  let map = null;
  let gl = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let origin = null; // MercatorCoordinate of the first placement: metric frame origin
  const templates = new Map(); // url -> template
  const originTransform = new THREE.Matrix4();
  const projection = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const sphere = new THREE.Sphere();
  const eye = new THREE.Vector4();
  const eyePosition = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const repaint = () => map?.triggerRepaint();

  // Shader compilation in the background (KHR_parallel_shader_compile). A newly
  // loaded detail level is drawn once its programs are ready, instead of stalling
  // the page while they compile on first use. Compiled here: the programs used to
  // draw the level, and (for the first level of a model) those of the impostor
  // views, which render the GLB itself into a target, with the back and front
  // passes of transparent double-sided materials. Without the extension the
  // programs report ready at once and the first draw waits as before.
  const compileJobs = [];
  let bakeTarget = null;
  const precompile = (level, withBake) => new Promise((resolve) => { compileJobs.push({ level, withBake, resolve }); repaint(); });
  function compileQueued() {
    if (!compileJobs.length || !camera || !scene) return;
    renderer.resetState();
    for (const job of compileJobs.splice(0)) {
      const programs = new Set();
      const compile = (root) => renderer.compile(root, camera, scene).forEach((material) => { const program = renderer.properties.get(material).currentProgram; if (program) programs.add(program); });
      const group = new THREE.Group();
      for (const part of job.level.parts) { group.add(part.mesh); if (part.front) group.add(part.front); }
      compile(group);
      for (const part of job.level.parts) { group.remove(part.mesh); if (part.front) group.remove(part.front); }
      if (job.withBake) {
        bakeTarget ||= new THREE.WebGLRenderTarget(1, 1);
        renderer.setRenderTarget(bakeTarget);
        compile(job.level.scene);
        const sided = new Set();
        job.level.scene.traverse((object) => { if (object.isMesh) (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => { if (twoPass(material)) sided.add(material); }); });
        for (const side of sided.size ? [THREE.BackSide, THREE.FrontSide] : []) {
          sided.forEach((material) => { material.side = side; material.needsUpdate = true; });
          compile(job.level.scene);
        }
        sided.forEach((material) => { material.side = THREE.DoubleSide; material.needsUpdate = true; });
        renderer.setRenderTarget(null);
      }
      const poll = () => {
        for (const program of programs) if (program.isReady()) programs.delete(program);
        if (programs.size) { setTimeout(poll, 16); return; }
        job.resolve();
        repaint();
      };
      poll();
    }
    renderer.resetState();
  }

  function syncTemplates() {
    const users = new Map();
    for (const placements of placementsByKey.values()) for (const placement of placements) users.set(placement.url, (users.get(placement.url) || 0) + 1);
    for (const [url, template] of templates) {
      if (users.has(url)) continue;
      template.dispose();
      templates.delete(url);
    }
    for (const [url, count] of users) {
      let template = templates.get(url);
      if (!template) { template = createTemplate(url, repaint, precompile); templates.set(url, template); }
      template.users = count;
      template.setCapacity(count);
    }
    for (const placements of placementsByKey.values()) for (const placement of placements) {
      if (!origin) origin = MercatorCoordinate.fromLngLat([placement.longitude, placement.latitude], 0);
      placement.template = templates.get(placement.url);
      placement.box = null; // re-fitted in render() once the box is known
    }
    if (origin) {
      const unitsPerMetre = origin.meterInMercatorCoordinateUnits();
      originTransform.makeTranslation(origin.x, origin.y, origin.z).multiply(new THREE.Matrix4().makeScale(unitsPerMetre, -unitsPerMetre, unitsPerMetre));
    }
    repaint();
  }

  function fillPart(part, instances) {
    const count = instances.length;
    part.mesh.count = count;
    part.mesh.visible = count > 0;
    if (part.front) { part.front.count = count; part.front.visible = count > 0; }
    // The same placements in the same order as last frame: the data on the GPU is current.
    const same = part.drawnVersion === placementVersion && part.drawn.length === count && instances.every((placement, i) => part.drawn[i] === placement);
    if (same) return;
    part.drawn = instances.slice();
    part.drawnVersion = placementVersion;
    const matrices = part.mesh.instanceMatrix.array;
    const place = part.place.array;
    const yaw = part.yaw.array;
    for (let i = 0; i < count; i += 1) {
      const placement = instances[i];
      matrix.multiplyMatrices(placement.fit, part.meshMatrix).toArray(matrices, i * 16);
      place.set(placement.place, i * 4);
      yaw.set(placement.yaw, i * 2);
    }
    if (count) {
      part.mesh.instanceMatrix.clearUpdateRanges();
      part.mesh.instanceMatrix.addUpdateRange(0, count * 16);
      part.mesh.instanceMatrix.needsUpdate = true;
      part.place.clearUpdateRanges();
      part.place.addUpdateRange(0, count * 4);
      part.place.needsUpdate = true;
      part.yaw.clearUpdateRanges();
      part.yaw.addUpdateRange(0, count * 2);
      part.yaw.needsUpdate = true;
    }
  }

  function fillImpostors(part, instances) {
    const count = instances.length;
    part.mesh.material.uniforms.eyePosition.value.copy(eyePosition);
    part.mesh.count = count;
    part.mesh.visible = count > 0;
    const same = part.drawnVersion === placementVersion && part.drawn?.length === count && instances.every((placement, i) => part.drawn[i] === placement);
    if (same) return;
    part.drawn = instances.slice();
    part.drawnVersion = placementVersion;
    for (let i = 0; i < count; i += 1) {
      const placement = instances[i];
      part.center.array.set([placement.center.x, placement.center.y, placement.center.z, placement.radius / 1.1], i * 4);
      part.yaw.array.set(placement.yaw, i * 2);
    }
    if (count) {
      part.center.clearUpdateRanges();
      part.center.addUpdateRange(0, count * 4);
      part.center.needsUpdate = true;
      part.yaw.clearUpdateRanges();
      part.yaw.addUpdateRange(0, count * 2);
      part.yaw.needsUpdate = true;
    }
  }

  return {
    id: LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    onAdd(mapInstance, context) {
      map = mapInstance;
      gl = context;
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      scene.matrixWorldAutoUpdate = false;
      scene.add(new THREE.AmbientLight(0xffffff, 1.5));
      const directionalLight1 = new THREE.DirectionalLight(0xffffff, 1.5);
      directionalLight1.position.set(0, -70, 100).normalize();
      scene.add(directionalLight1);
      const directionalLight2 = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight2.position.set(0, 70, 100).normalize();
      scene.add(directionalLight2);
      scene.updateMatrixWorld(true);
      renderer = acquireRenderer(map, gl);
      syncTemplates();
    },

    syncTemplates,

    // MapLibre's offscreen pass: render wanted sets of impostor views, within a time budget.
    prerender() {
      if (!renderer) return;
      compileQueued();
      const start = performance.now();
      let baked = false;
      for (const template of templates.values()) {
        while (performance.now() - start < IMPOSTOR_FRAME_BUDGET && template.bakeNextImpostor(renderer)) baked = true;
      }
      if (baked) repaint();
    },

    render(_gl, args) {
      const mainMatrix = args?.defaultProjectionData?.mainMatrix;
      if (!renderer || !scene || !origin || !mainMatrix) return;

      projection.fromArray(mainMatrix).multiply(originTransform);
      camera.projectionMatrix.copy(projection);
      camera.projectionMatrixInverse.copy(projection).invert();
      frustum.setFromProjectionMatrix(projection);
      // Camera position: the point whose clip coordinates are (0, 0, 1, 0).
      eye.set(0, 0, 1, 0).applyMatrix4(camera.projectionMatrixInverse);
      eyePosition.set(eye.x / eye.w, eye.y / eye.w, eye.z / eye.w);
      const focalPx = (gl.drawingBufferHeight / 2) / Math.tan((args.fov || 0.6435) / 2);
      const zoomVisible = map.getZoom() >= MODEL_VISIBILITY.minZoom;

      const stats = { placements: 0, drawn: 0, culled: 0, pendingDrawable: 0, loading: 0, levels: {} };
      for (const template of templates.values()) {
        for (const impostor of template.impostors || []) impostor.instances.length = 0;
        for (const level of template.levels || []) level.instances.length = 0;
      }

      for (const [key, placements] of placementsByKey) {
        if (!modelsVisible || hiddenKeys.has(key)) continue;
        stats.placements += placements.length;
        if (!zoomVisible && !placements.some((placement) => placement.building)) { stats.culled += placements.length; continue; }
        for (const placement of placements) {
          // A building model replaces a building's extrusion (building-models.js), so it is
          // drawn whenever that building would be: at every zoom and distance, in full
          // detail (never as an impostor), only culled outside the view.
          if (!zoomVisible && !placement.building) { stats.culled += 1; continue; }
          const template = placement.template;
          if (!template?.ready || !template.box) { stats.pendingDrawable += 1; continue; }
          if (placement.box !== template.box || placement.fitBox !== template.fitBox) placeModel(placement, template.box, origin, template.fitBox);
          sphere.center.copy(placement.center);
          sphere.radius = placement.radius;
          const distance = Math.max(1e-3, eyePosition.distanceTo(placement.center));
          const px = (placement.heightM * focalPx) / distance;
          const tooSmall = !placement.building && (distance > MODEL_VISIBILITY.maxDistanceM || px < MODEL_VISIBILITY.minPixels);
          if (tooSmall || !frustum.intersectsSphere(sphere)) { stats.culled += 1; continue; }
          if (!placement.building && px < MODEL_VISIBILITY.impostorPixels && template.impostors) {
            const { impostors } = template;
            let impostor = impostors.find((item) => item.height >= px) || impostors[impostors.length - 1];
            if (!impostor.part) {
              impostor.wanted = true; // rendered in the next frames
              impostor = impostors.filter((item) => item.part).sort((a, b) => Math.abs(a.height - px) - Math.abs(b.height - px))[0];
            }
            if (!impostor) { stats.pendingDrawable += 1; repaint(); continue; }
            impostor.instances.push(placement);
            stats.drawn += 1;
            stats.levels.impostor = (stats.levels.impostor || 0) + 1;
            continue;
          }
          const index = template.levelFor(px);
          if (index < 0) { stats.pendingDrawable += 1; continue; }
          placement.distance = distance;
          template.levels[index].instances.push(placement);
          stats.drawn += 1;
          stats.levels[index] = (stats.levels[index] || 0) + 1;
        }
      }

      for (const template of templates.values()) {
        for (const impostor of template.impostors || []) {
          if (!impostor.part) continue;
          if (!impostor.part.mesh.parent) scene.add(impostor.part.mesh);
          fillImpostors(impostor.part, impostor.instances);
        }
        for (const level of template.levels || []) {
          if (level.state === "loading" || level.state === "compiling") stats.loading += 1;
          if (!level.parts) continue;
          const { instances } = level;
          if (level.parts.some((part) => part.transparent) && instances.length > 1) instances.sort((a, b) => b.distance - a.distance);
          for (const part of level.parts) {
            if (!part.mesh.parent) scene.add(part.mesh);
            if (part.front && !part.front.parent) scene.add(part.front);
            fillPart(part, instances);
          }
        }
      }
      lastStats = stats;
      if (!stats.drawn) return;

      renderer.resetState();
      renderer.render(scene, camera);
      renderer.resetState();
    },

    onRemove() {
      for (const template of templates.values()) template.dispose();
      templates.clear();
      releaseRenderer(gl);
      scene = camera = renderer = map = null;
      modelLayer = null;
    }
  };
}

function prepareModels(data, geojsonUrl) {
  if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("models.geojson must be a GeoJSON FeatureCollection.");
  }

  const entries = normalizeFeatures(data.features);
  const preparedModels = [];

  for (const { id, feature, position } of entries) {
    const properties = feature.properties || {};

    if (!properties.model) {
      console.warn(`Skipping model "${id}": no model path.`);
      continue;
    }

    preparedModels.push({
      modelId: id,
      sourceKey: geojsonUrl,
      url: resolveModelUrl(properties.model),
      longitude: position.longitude,
      latitude: position.latitude,
      baseM: toFiniteNumber(properties.base_m) ?? 0,
      topM: toFiniteNumber(properties.top_m),
      scale: toFiniteNumber(properties.scale) ?? 1,
      size: toFiniteNumber(properties.size) ?? 1,
      rotation: normalizeDegrees(properties.rotation),
      building: properties.building === true,
      fitSize: fitSizeOf(properties.fit)
    });
  }

  if ((data.features || []).length > 0 && preparedModels.length === 0) {
    throw new Error("No valid 3D model features found. Use one lon/lat position and a model path.");
  }

  return { entries, preparedModels };
}

async function fetchGeoJSON(geojsonUrl) {
  const separator = geojsonUrl.includes("?") ? "&" : "?";
  const response = await fetch(`${geojsonUrl}${separator}v=${Date.now()}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

// Apply a FeatureCollection directly (used by the viewer and the editor).
export function sync3DModels(map, geojsonUrl, data, options = {}) {
  const { entries, preparedModels } = prepareModels(data, geojsonUrl);
  const signature = buildSignature(entries);
  if (options.force !== true && signature === lastSignatureByUrl.get(geojsonUrl)) return false;

  if (preparedModels.length) placementsByKey.set(geojsonUrl, preparedModels);
  else placementsByKey.delete(geojsonUrl);

  if (!modelLayer || !map.getLayer(LAYER_ID)) {
    modelLayer = createModelsLayer();
    map.addLayer(modelLayer, options.beforeId && map.getLayer(options.beforeId) ? options.beforeId : undefined);
  } else {
    modelLayer.syncTemplates();
  }

  keepMapOverlaysOnTop(map);
  lastSignatureByUrl.set(geojsonUrl, signature);
  map.triggerRepaint();
  return true;
}

export async function load3DModels(map, geojsonUrl, options = {}) {
  try {
    const data = options.data || await fetchGeoJSON(geojsonUrl);
    const changed = sync3DModels(map, geojsonUrl, data, options);
    if (changed) console.info(`3D models updated: ${placementsByKey.get(geojsonUrl)?.length ?? 0}`);
    return changed;
  } catch (error) {
    console.error(`Could not update 3D models from ${geojsonUrl}:`, error);
    return false;
  }
}

// Without a key: all models. With a key: only the models loaded under that key.
export function set3DModelsVisible(map, visible, key = null) {
  if (key === null) modelsVisible = Boolean(visible);
  else if (visible) hiddenKeys.delete(key);
  else hiddenKeys.add(key);
  map.triggerRepaint();
}

export function are3DModelsVisible(key = null) {
  return modelsVisible && (key === null || !hiddenKeys.has(key));
}

// Counts from the last drawn frame (diagnostics and tests): placements shown,
// drawn per detail level, culled, waiting for their first file, files loading.
export function get3DModelStats() {
  return { ...lastStats, levels: { ...lastStats.levels } };
}
