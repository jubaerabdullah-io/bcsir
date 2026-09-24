// Procedural 3D trees along the TreeLine lines (visualization only).
//
// Built on the custom-layer pattern of the reference project's
// surface-colors.js: a local metric frame anchored at a MercatorCoordinate
// origin, projected with MapLibre's mainMatrix. All trees are drawn with two
// InstancedMesh objects (trunks + crowns), i.e. two draw calls in total.
//
// Every tree line is controlled by its own GeoJSON properties (render_* values
// prepared in bcsir-data.js):
//   base_m     ground elevation of the trees
//   top_m      elevation of the tree tops (tree height = top_m - base_m)
//   color      crown colour
//   spacing_m  distance between trees along the line
// The line geometry itself is not changed.
//
// While TreeLineModels.geojson places GLB tree models, these procedural trees
// are not drawn (setReplaced, see bcsir-layers.js); they return when it is empty.
import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import { acquireRenderer, releaseRenderer } from "./three-shared.js";

function treePlacements(collection) {
  const placements = [];
  for (const feature of collection?.features || []) {
    const geometry = feature?.geometry;
    const p = feature?.properties || {};
    const lines = geometry?.type === "LineString" ? [geometry.coordinates] : geometry?.type === "MultiLineString" ? geometry.coordinates : [];
    const spacingM = p.render_spacing_m;
    const tree = { baseM: p.render_base_m, heightM: p.render_top_m - p.render_base_m, color: p.render_color };
    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2 || !(spacingM > 0)) continue;
      let carried = 0;
      placements.push({ ...tree, lngLat: line[0] });
      for (let i = 1; i < line.length; i += 1) {
        const a = MercatorCoordinate.fromLngLat(line[i - 1]);
        const b = MercatorCoordinate.fromLngLat(line[i]);
        const unitsPerMetre = a.meterInMercatorCoordinateUnits();
        const lengthM = Math.hypot(b.x - a.x, b.y - a.y) / unitsPerMetre;
        let at = spacingM - carried;
        while (at <= lengthM) {
          const t = at / lengthM;
          placements.push({ ...tree, lngLat: new MercatorCoordinate(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0).toLngLat().toArray() });
          at += spacingM;
        }
        carried = lengthM - (at - spacingM);
      }
    }
  }
  return placements;
}

// Deterministic 0..1 value per tree so the variation is stable between reloads.
function jitter(index, salt) {
  const x = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Unit tree, Z-up, bottom at 0 and top exactly at 1: scaled per instance by the
// tree height so its top lands exactly on top_m.
function unitTreeGeometry() {
  const trunkHeight = 0.35, crownRadius = 0.29, trunkRadius = 0.033;
  const trunk = new THREE.CylinderGeometry(trunkRadius * 0.8, trunkRadius, trunkHeight, 6).rotateX(Math.PI / 2).translate(0, 0, trunkHeight / 2);
  const crown = new THREE.IcosahedronGeometry(crownRadius, 1).rotateX(Math.PI / 2).translate(0, 0, trunkHeight + crownRadius * 0.85);
  crown.computeBoundingBox();
  const topZ = crown.boundingBox.max.z;
  trunk.scale(1 / topZ, 1 / topZ, 1 / topZ);
  crown.scale(1 / topZ, 1 / topZ, 1 / topZ);
  return { trunk, crown };
}

export function treeLayer(id, collection, { trunkColor }) {
  let map, gl, renderer, scene, camera, origin, trunks, crowns;
  let visible = true;
  let replaced = false; // GLB tree models stand in for these trees
  const transform = new THREE.Matrix4();
  const projection = new THREE.Matrix4();
  const scaleMatrix = new THREE.Matrix4();

  function clear() {
    for (const mesh of [trunks, crowns]) {
      if (!mesh) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    trunks = crowns = null;
  }

  function rebuild(data) {
    collection = data;
    if (!scene) return;
    clear();
    const placements = treePlacements(collection).filter((tree) => tree.heightM > 0);
    if (!placements.length) { origin = null; map?.triggerRepaint(); return; }
    origin = MercatorCoordinate.fromLngLat(placements[0].lngLat, 0);
    const unitsPerMetre = origin.meterInMercatorCoordinateUnits();
    const { trunk, crown } = unitTreeGeometry();
    trunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: trunkColor }), placements.length);
    // Crown colour comes from each line's `color` (instance colours).
    crowns = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), placements.length);

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const up = new THREE.Vector3(0, 0, 1);
    const tint = new THREE.Color();
    placements.forEach((tree, index) => {
      const m = MercatorCoordinate.fromLngLat(tree.lngLat, 0);
      // Local right-handed frame: metres east (x), north (y), up (z). Mercator y grows
      // south, so y is negated here and flipped back by the (s, -s, s) scale in render().
      position.set((m.x - origin.x) / unitsPerMetre, -(m.y - origin.y) / unitsPerMetre, tree.baseM);
      quaternion.setFromAxisAngle(up, jitter(index, 2) * Math.PI * 2);
      scale.set(tree.heightM, tree.heightM, tree.heightM);
      matrix.compose(position, quaternion, scale);
      trunks.setMatrixAt(index, matrix);
      crowns.setMatrixAt(index, matrix);
      crowns.setColorAt(index, tint.set(tree.color).offsetHSL(0, 0, (jitter(index, 3) - 0.5) * 0.08));
    });
    trunks.frustumCulled = crowns.frustumCulled = false;
    scene.add(trunks, crowns);
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
      scene.add(new THREE.AmbientLight(0xffffff, 1.35));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(0.4, -0.6, 1).normalize();
      scene.add(sun);
      renderer = acquireRenderer(map, gl);
      rebuild(collection);
    },
    setData: rebuild,
    setVisible(next) { visible = Boolean(next); map?.triggerRepaint(); },
    setReplaced(next) { replaced = Boolean(next); map?.triggerRepaint(); },
    isVisible: () => visible,
    count() { return trunks?.count ?? 0; },
    render(_gl, args) {
      const matrix = args?.defaultProjectionData?.mainMatrix;
      if (!visible || replaced || !origin || !matrix || !trunks) return;
      const s = origin.meterInMercatorCoordinateUnits();
      scaleMatrix.makeScale(s, -s, s);
      transform.makeTranslation(origin.x, origin.y, origin.z).multiply(scaleMatrix);
      camera.projectionMatrix = projection.fromArray(matrix).multiply(transform);
      renderer.resetState();
      renderer.render(scene, camera);
      renderer.resetState();
    },
    onRemove() {
      clear();
      releaseRenderer(gl);
      scene = camera = renderer = null;
    }
  };
}
