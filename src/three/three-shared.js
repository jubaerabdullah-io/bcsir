// Three.js resources shared by every custom layer of the map: the 3D models, the
// procedural trees, the ground surfaces, the walker and the sky.
import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// A file asked for twice (a detail level, a texture) is fetched once.
THREE.Cache.enabled = true;

// One THREE.WebGLRenderer per MapLibre WebGL context, shared by every custom
// layer (3D models and procedural trees). The reference project created one
// renderer per model; sharing avoids duplicated shader programs and state.
// MapLibre and Three.js share the context, so never call forceContextLoss().
const renderers = new WeakMap();

export function acquireRenderer(map, gl) {
  let entry = renderers.get(gl);
  if (!entry) {
    const renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    renderer.autoClear = false;
    entry = { renderer, users: 0 };
    renderers.set(gl, entry);
  }
  entry.users += 1;
  return entry.renderer;
}

export function releaseRenderer(gl) {
  const entry = renderers.get(gl);
  if (!entry) return;
  entry.users -= 1;
  if (entry.users <= 0) {
    entry.renderer.dispose();
    renderers.delete(gl);
  }
}

// One GLTF loader for every GLB (models, building models, the walker): it reads
// plain, Draco-compressed and Meshopt-compressed files.
let gltfLoader = null;
export function sharedGltfLoader() {
  if (!gltfLoader) {
    gltfLoader = new GLTFLoader();
    // DRACOLoader resolves its bundled decoder via import.meta.url (Vite emits it).
    gltfLoader.setDRACOLoader(new DRACOLoader());
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }
  return gltfLoader;
}

// The matrix from metres east / north / up at a MercatorCoordinate to Mercator
// units, written into `target`: every layer draws in such a local frame and
// multiplies MapLibre's projection by it. Mercator y points south, hence the
// negative north scale.
const frameScale = new THREE.Matrix4();
export function metricFrameMatrix(anchor, target) {
  const unitsPerMetre = anchor.meterInMercatorCoordinateUnits();
  return target.makeTranslation(anchor.x, anchor.y, anchor.z).multiply(frameScale.makeScale(unitsPerMetre, -unitsPerMetre, unitsPerMetre));
}
