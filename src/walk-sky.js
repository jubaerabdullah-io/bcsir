// The sky of Walk Mode (game view): a blue gradient with the sun and soft clouds
// above the horizon.
//
// One small custom layer ("walk-sky") draws a dome around the camera: only its
// upper half, so it covers directions above the horizon (the flat map's ground is
// always below it), and at the far end of the depth range without writing depth,
// so buildings, trees, the walker and labels stay in front of it. The map's own sky
// and fog get matching colours, so the ground fades into the same horizon. Shown
// while walking, removed with the previous sky restored when Walk Mode ends; the
// clouds do not move, so the sky costs no extra repaints.
import * as THREE from "three";
import { acquireRenderer, releaseRenderer } from "./three-shared.js";

const LAYER_ID = "walk-sky";
const MAP_SKY = {
  "sky-color": "#5ea8e6",
  "horizon-color": "#d7eaf7",
  "fog-color": "#e3edf2",
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.7,
  "fog-ground-blend": 0.92,
  "atmosphere-blend": 0
};
const DEG = Math.PI / 180;
const SUN = { azimuth: 205, elevation: 38 }; // as the map's light

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position; // east, north, up
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    p.z = p.w * 0.99999; // far away: behind everything the map draws in 3D
    gl_Position = p;
  }
`;
const FRAGMENT = /* glsl */ `
  uniform vec3 sunDir;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.z, 0.0);
    vec3 col = mix(vec3(0.84, 0.92, 0.97), vec3(0.24, 0.52, 0.87), pow(h, 0.5));
    float s = max(dot(d, sunDir), 0.0);
    col += vec3(1.0, 0.96, 0.84) * (smoothstep(0.9993, 0.9997, s) * 1.2 + pow(s, 14.0) * 0.22);
    // Clouds on a layer overhead, thinning out towards the horizon.
    vec2 uv = d.xy / (d.z + 0.15) * 1.6;
    float n = fbm(uv + vec2(3.1, 1.7));
    float cover = smoothstep(0.5, 0.75, n) * smoothstep(0.0, 0.2, d.z);
    vec3 cloud = mix(vec3(1.0), vec3(0.76, 0.8, 0.87), smoothstep(0.45, 0.85, fbm(uv * 1.3 + 0.4)));
    col = mix(col, cloud, cover * 0.92);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createWalkSky(map) {
  let layer = null;
  let previousSky = null;

  function createLayer() {
    let renderer = null, scene = null, camera = null, gl = null, dome = null;
    const inverse = new THREE.Matrix4();
    const place = new THREE.Matrix4();
    const scale = new THREE.Matrix4();
    const eye = new THREE.Vector4();
    return {
      id: LAYER_ID,
      type: "custom",
      renderingMode: "3d",
      onAdd(mapInstance, context) {
        gl = context;
        renderer = acquireRenderer(mapInstance, gl);
        scene = new THREE.Scene();
        camera = new THREE.Camera();
        const geometry = new THREE.SphereGeometry(1, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2); // upper half, +Z up
        const sunDir = new THREE.Vector3(Math.sin(SUN.azimuth * DEG) * Math.cos(SUN.elevation * DEG), Math.cos(SUN.azimuth * DEG) * Math.cos(SUN.elevation * DEG), Math.sin(SUN.elevation * DEG));
        // Both sides: the placement below mirrors north-south, which flips the winding.
        dome = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: { sunDir: { value: sunDir } }, side: THREE.DoubleSide, depthWrite: false, depthTest: true }));
        dome.frustumCulled = false;
        scene.add(dome);
      },
      render(_gl, args) {
        const mainMatrix = args?.defaultProjectionData?.mainMatrix;
        if (!mainMatrix || !dome) return;
        // The camera: the point whose clip coordinates are (0, 0, 1, 0).
        inverse.fromArray(mainMatrix).invert();
        eye.set(0, 0, 1, 0).applyMatrix4(inverse);
        if (!eye.w) return;
        // The dome's placement (at the camera, about 800 m round: only its direction
        // matters) is folded into the projection here, in double precision, so the
        // shader only sees the unit dome (Mercator coordinates in the shader would
        // wobble at walking zoom).
        const r = 2e-5; // Mercator units
        place.makeTranslation(eye.x / eye.w, eye.y / eye.w, eye.z / eye.w).multiply(scale.makeScale(r, -r, r)); // east, north (Mercator y points south), up
        camera.projectionMatrix.fromArray(mainMatrix).multiply(place);
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        renderer.resetState();
        renderer.render(scene, camera);
        renderer.resetState();
      },
      onRemove() {
        dome?.geometry.dispose();
        dome?.material.dispose();
        releaseRenderer(gl);
        renderer = scene = camera = dome = null;
      }
    };
  }

  return {
    show() {
      if (layer) return;
      previousSky = map.getSky?.(); // undefined: the style has no sky
      map.setSky?.(MAP_SKY);
      layer = createLayer();
      // Under the 3D models and the labels; the dome is behind everything anyway.
      const before = ["3d-models", "building-labels-major", "building-labels-minor"].find((id) => map.getLayer(id));
      map.addLayer(layer, before);
      map.triggerRepaint();
    },
    hide() {
      if (!layer) return;
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      layer = null;
      map.setSky?.(previousSky); // undefined takes the sky away again ({} would keep ours)
      map.triggerRepaint();
    },
    isShown: () => Boolean(layer)
  };
}
