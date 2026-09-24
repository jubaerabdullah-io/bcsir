import * as THREE from "three";

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
