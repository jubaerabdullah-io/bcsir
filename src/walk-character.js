// The walker shown in Walk Mode's third-person view.
//
// One small MapLibre custom layer ("walk-character") draws the chosen character
// (WALK_CHARACTERS in config.js; models/characters/male.glb, built by
// `npm run models:character`) at the player's map position and floor height,
// turned to `facing` (compass degrees). It shares the Three.js renderer of the
// other 3D layers (three-shared.js) and the map's depth buffer, so buildings and
// trees hide it correctly. Animations follow the movement: Idle when stopped, Walk
// when moving, Run when running or moving at a jog (from JOG_FROM m/s), Jump while
// in the air; their pace follows the speed. Each character sets its height and
// the paces its clips are animated for (height, walkPace, runPace in config.js).
// The layer exists only while the character is shown: hide() removes it and stops
// its animation loop, and the loaded model is kept for the next walk.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { MercatorCoordinate } from "maplibre-gl";
import { acquireRenderer, releaseRenderer } from "./three-shared.js";
import { publicAssetUrl } from "./paths.js";

const LAYER_ID = "walk-character";
const HEIGHT_M = 1.75; // the model is scaled to this height (unless the character sets one)
const WALK_PACE = 2.0; // m/s the Walk clip is animated for (unless the character sets walkPace)
const RUN_PACE = 4.3; // m/s the Run clip is animated for (runPace)
const JOG_FROM = 2.6; // m/s from which the Run clip plays without Shift
const IDLE_FPS = 24; // repaints per second while only the idle animation plays
const FADE_S = 0.25;
const DEG = Math.PI / 180;

const loaded = new Map(); // url -> Promise<gltf>

export function createWalkCharacter(map, { onError } = {}) {
  let character = null; // entry of WALK_CHARACTERS
  let gltf = null;
  let holder = null; // yaw (about up) of the character in its east-north-up frame
  let mixer = null;
  let actions = {};
  let current = null;
  let layer = null;
  let frame = 0;
  let lastTime = 0;
  let lastPaint = 0;
  let visible = false;
  const state = { position: null, altitude: 0, facing: 0, speed: 0, running: false, airborne: false };

  function load(url) {
    if (!loaded.has(url)) loaded.set(url, new GLTFLoader().loadAsync(url));
    return loaded.get(url);
  }

  // Colours of the chosen character on the model's named materials.
  function applyColors(root, colors = {}) {
    root.traverse((object) => {
      if (!object.isMesh) return;
      const color = colors[object.material?.name];
      if (color) object.material.color.set(color);
    });
  }

  function build() {
    const scene = gltf.scene;
    scene.traverse((object) => { if (object.isMesh) { object.frustumCulled = false; object.material = object.material.clone(); } });
    applyColors(scene, character.colors);
    const box = new THREE.Box3().setFromObject(scene);
    const scale = (Number(character.height) || HEIGHT_M) / Math.max(0.1, box.max.y - box.min.y);
    scene.scale.setScalar(scale);
    scene.position.y = -box.min.y * scale;
    const upright = new THREE.Group(); // glTF Y-up -> map Z-up
    upright.rotation.x = Math.PI / 2;
    upright.add(scene);
    holder = new THREE.Group();
    holder.add(upright);
    mixer = new THREE.AnimationMixer(scene);
    actions = {};
    for (const clip of gltf.animations) actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
    current = null;
    play(pick());
  }

  function pick() {
    if (state.airborne && actions.jump) return "jump";
    if (state.speed < 0.15) return "idle";
    return (state.running || state.speed >= JOG_FROM) && actions.run ? "run" : "walk";
  }

  function play(name) {
    const next = actions[name] || actions.idle || Object.values(actions)[0];
    if (!next || next === current) return;
    next.reset().setEffectiveWeight(1).play();
    if (current) current.crossFadeTo(next, FADE_S, false);
    current = next;
  }

  function createLayer() {
    let renderer = null, scene = null, camera = null, gl = null;
    const projection = new THREE.Matrix4();
    const place = new THREE.Matrix4();
    return {
      id: LAYER_ID,
      type: "custom",
      renderingMode: "3d",
      onAdd(mapInstance, context) {
        gl = context;
        renderer = acquireRenderer(mapInstance, gl);
        scene = new THREE.Scene();
        // Lights in the east-north-up frame: sun from the south-south-west, like the map.
        const sky = new THREE.HemisphereLight(0xffffff, 0x8a8f86, 1.9);
        sky.position.set(0, 0, 1); // up
        scene.add(sky);
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(Math.sin(205 * DEG), Math.cos(205 * DEG), 1.3);
        scene.add(sun);
        camera = new THREE.Camera();
        if (holder) scene.add(holder);
      },
      render(_gl, args) {
        const mainMatrix = args?.defaultProjectionData?.mainMatrix;
        if (!visible || !holder || !state.position || !mainMatrix) return;
        if (!holder.parent) scene.add(holder);
        // East-north-up metres at the character -> Mercator.
        const anchor = MercatorCoordinate.fromLngLat(state.position, state.altitude);
        const s = anchor.meterInMercatorCoordinateUnits();
        place.makeTranslation(anchor.x, anchor.y, anchor.z).multiply(new THREE.Matrix4().makeScale(s, -s, s));
        projection.fromArray(mainMatrix).multiply(place);
        camera.projectionMatrix.copy(projection);
        camera.projectionMatrixInverse.copy(projection).invert();
        // The model faces south (-north) after standing it up: turn it to `facing`.
        holder.rotation.set(0, 0, Math.PI - state.facing * DEG);
        renderer.resetState();
        renderer.render(scene, camera);
        renderer.resetState();
      },
      onRemove() {
        if (holder) holder.removeFromParent();
        releaseRenderer(gl);
        renderer = scene = camera = null;
      }
    };
  }

  function tick(time) {
    frame = 0;
    if (!visible) return;
    const dt = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0;
    lastTime = time;
    if (mixer) {
      play(pick());
      if (current === actions.walk) current.timeScale = Math.max(0.4, Math.min(2.2, state.speed / (Number(character?.walkPace) || WALK_PACE)));
      if (current === actions.run) current.timeScale = Math.max(0.6, Math.min(2.2, state.speed / (Number(character?.runPace) || RUN_PACE)));
      mixer.update(dt);
    }
    // Moving: every frame (the camera moves anyway); idle: a lighter frame rate.
    if (state.speed >= 0.15 || state.airborne || time - lastPaint >= 1000 / IDLE_FPS) { lastPaint = time; map.triggerRepaint(); }
    frame = requestAnimationFrame(tick);
  }

  return {
    // Shows `entry` (a WALK_CHARACTERS entry); loads its model the first time.
    async show(entry) {
      visible = true;
      if (!layer) { layer = createLayer(); if (!map.getLayer(LAYER_ID)) map.addLayer(layer); }
      if (!frame) { lastTime = 0; frame = requestAnimationFrame(tick); }
      if (character?.id === entry.id && gltf) return;
      character = entry;
      try {
        const url = publicAssetUrl(entry.model);
        const result = await load(url);
        if (character !== entry) return;
        // Each show builds its own copy (materials are recoloured per character).
        if (holder) { holder.removeFromParent(); holder.traverse((object) => { if (object.isMesh) object.material.dispose(); }); }
        gltf = { scene: cloneSkinned(result.scene), animations: result.animations };
        build();
        map.triggerRepaint();
      } catch (error) {
        console.warn(`Walk character ${entry.model} could not be loaded; walking continues without it.`, error);
        onError?.(error);
      }
    },
    // position [lon, lat], altitude (m), facing (deg), speed (m/s), running and airborne (bool).
    update(next) {
      Object.assign(state, next);
      if (visible) map.triggerRepaint();
    },
    setVisible(show) {
      if (visible === show) return;
      visible = show;
      if (show && !frame && layer) { lastTime = 0; frame = requestAnimationFrame(tick); }
      map.triggerRepaint();
    },
    // Removes the layer and stops the animation loop (the model stays loaded).
    hide() {
      visible = false;
      cancelAnimationFrame(frame);
      frame = 0;
      if (layer && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      layer = null;
      state.speed = 0;
    },
    isShown: () => Boolean(layer) && visible,
    stats: () => ({ shown: Boolean(layer) && visible, loaded: Boolean(gltf), animation: current ? Object.keys(actions).find((key) => actions[key] === current) : null, character: character?.id ?? null, facing: state.facing, speed: state.speed })
  };
}
