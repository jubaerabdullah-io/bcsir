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
// - Building models that hide the drawn route (setFadedModelBuildings, from
//   route-occlusion.js) are drawn see-through, like the faded extrusions.
//
// Models are configured in GeoJSON (public/data/models.geojson and the other
// datasets, see model-placements.js); the model-manager UI was removed.
//
// This file holds the renderer: the model templates with their detail levels, the
// custom layer and the functions the map calls. Its parts are beside it:
//   model-features.js   placement features (GeoJSON) -> placements
//   model-manifest.js   the level-of-detail manifest
//   model-parts.js      lights, instanced meshes and their materials
//   model-impostors.js  pre-rendered views for models a few pixels tall
import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import { MODEL_VISIBILITY } from "../core/config.js";
import { MODELS_LAYER, OVERLAY_LAYERS } from "../map/layer-ids.js";
import { normalizeDegrees } from "../utils/local-frame.js";
import { buildSignature, prepareModels, resolveSizeMultiplier } from "./model-features.js";
import { bakeImpostor, createImpostorMesh, IMPOSTOR_FRAME_BUDGET, IMPOSTOR_HEIGHTS } from "./model-impostors.js";
import { modelManifestEntry } from "./model-manifest.js";
import { addModelLights, createPart, disposeFadedMaterials, disposeObject3D, removePart, sidedMaterials, twoPass } from "./model-parts.js";
import { acquireRenderer, metricFrameMatrix, releaseRenderer, sharedGltfLoader } from "./three-shared.js";

const placementsByKey = new Map(); // set key -> placements
const lastSignatureByKey = new Map();
const hiddenKeys = new Set(); // model sets hidden by the layer manager
const fadedBuildings = new Set(); // building_id of building models drawn see-through
const hiddenBuildings = new Set(); // building_id of building models not drawn (their floor plan is open)
let modelsVisible = true;
let modelLayer = null;
let lastStats = { placements: 0, drawn: 0, culled: 0, pendingDrawable: 0, loading: 0, levels: {} };

function toRadians(degrees) {
  return normalizeDegrees(degrees) * Math.PI / 180;
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

// Bumped whenever a placement is fitted again (its instance data changes).
let placementVersion = 0;

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
    building: false, // used by a building placement: its levels also get see-through parts
    // [{ url, minPx, state, scene, parts, instances, fadedParts, fadedInstances }], finest first
    levels: null,
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
    sharedGltfLoader().loadAsync(level.url).then(
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
        if (template.building) level.fadedParts = level.parts.map((part) => createPart({ geometry: part.mesh.geometry, material: part.sourceMaterial, matrixWorld: part.meshMatrix }, Math.max(1, template.capacity), true));
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
      template.levels = entry.lods.map((lod) => ({ url: lod.url, minPx: lod.minPx, state: "idle", parts: null, instances: [], fadedParts: null, fadedInstances: [] }));
    } else {
      template.levels = [{ url, minPx: 0, state: "idle", parts: null, instances: [], fadedParts: null, fadedInstances: [] }];
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
      const resize = (part) => {
        removePart(part);
        return createPart({ geometry: part.mesh.geometry, material: part.sourceMaterial, matrixWorld: part.meshMatrix }, capacity, part.faded);
      };
      level.parts = level.parts.map(resize);
      if (level.fadedParts) level.fadedParts = level.fadedParts.map(resize);
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
      for (const part of level.fadedParts || []) {
        removePart(part);
        disposeFadedMaterials(part.sourceMaterial);
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

// Route, labels and markers stay above the 3D models (reference behaviour).
function keepMapOverlaysOnTop(map) {
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
      const parts = [...job.level.parts, ...(job.level.fadedParts || [])];
      for (const part of parts) { group.add(part.mesh); if (part.front) group.add(part.front); }
      compile(group);
      for (const part of parts) { group.remove(part.mesh); if (part.front) group.remove(part.front); }
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
    const buildingUrls = new Set();
    for (const placements of placementsByKey.values()) for (const placement of placements) {
      users.set(placement.url, (users.get(placement.url) || 0) + 1);
      if (placement.building) buildingUrls.add(placement.url);
    }
    for (const [url, template] of templates) {
      if (users.has(url)) continue;
      template.dispose();
      templates.delete(url);
    }
    for (const [url, count] of users) {
      let template = templates.get(url);
      if (!template) { template = createTemplate(url, repaint, precompile); templates.set(url, template); }
      template.building = buildingUrls.has(url);
      template.users = count;
      template.setCapacity(count);
    }
    for (const placements of placementsByKey.values()) for (const placement of placements) {
      if (!origin) origin = MercatorCoordinate.fromLngLat([placement.longitude, placement.latitude], 0);
      placement.template = templates.get(placement.url);
      placement.box = null; // re-fitted in render() once the box is known
    }
    if (origin) metricFrameMatrix(origin, originTransform);
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
    id: MODELS_LAYER,
    type: "custom",
    renderingMode: "3d",

    onAdd(mapInstance, context) {
      map = mapInstance;
      gl = context;
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      scene.matrixWorldAutoUpdate = false;
      addModelLights(scene);
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

      const stats = { placements: 0, drawn: 0, culled: 0, pendingDrawable: 0, loading: 0, faded: 0, levels: {} };
      for (const template of templates.values()) {
        for (const impostor of template.impostors || []) impostor.instances.length = 0;
        for (const level of template.levels || []) { level.instances.length = 0; level.fadedInstances.length = 0; }
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
          if (placement.buildingId !== null && hiddenBuildings.has(placement.buildingId)) { stats.culled += 1; continue; }
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
          const level = template.levels[index];
          if (level.fadedParts && fadedBuildings.has(placement.buildingId)) { level.fadedInstances.push(placement); stats.faded += 1; }
          else level.instances.push(placement);
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
          for (const part of level.fadedParts || []) {
            if (!part.mesh.parent) scene.add(part.mesh, part.front);
            fillPart(part, level.fadedInstances);
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
      bakeTarget?.dispose();
      bakeTarget = null;
      releaseRenderer(gl);
      scene = camera = renderer = map = null;
      modelLayer = null;
    }
  };
}

// Applies a set of placement features (a FeatureCollection, see model-features.js)
// under `key`: it replaces the set applied under that key before. Returns true when
// the set changed.
function sync3DModels(map, key, data, options = {}) {
  const { entries, preparedModels } = prepareModels(data, key);
  const signature = buildSignature(entries);
  if (options.force !== true && signature === lastSignatureByKey.get(key)) return false;

  if (preparedModels.length) placementsByKey.set(key, preparedModels);
  else placementsByKey.delete(key);

  if (!modelLayer || !map.getLayer(MODELS_LAYER)) {
    modelLayer = createModelsLayer();
    map.addLayer(modelLayer, options.beforeId && map.getLayer(options.beforeId) ? options.beforeId : undefined);
  } else {
    modelLayer.syncTemplates();
  }

  keepMapOverlaysOnTop(map);
  lastSignatureByKey.set(key, signature);
  map.triggerRepaint();
  return true;
}

// Shows the placement features `options.data` as the model set `key`. A set that
// cannot be used is reported and left as it was. Resolves to true when it changed.
export async function load3DModels(map, key, options = {}) {
  try {
    const changed = sync3DModels(map, key, options.data, options);
    if (changed) console.info(`3D models updated: ${placementsByKey.get(key)?.length ?? 0}`);
    return changed;
  } catch (error) {
    console.error(`Could not update the 3D models of "${key}":`, error);
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

// Building models (placement building_id = BuildingBoundary render_id) drawn
// see-through because they hide the drawn route (route-occlusion.js); [] = none.
export function setFadedModelBuildings(map, ids) {
  const next = new Set((ids || []).map(String));
  if (next.size === fadedBuildings.size && [...next].every((id) => fadedBuildings.has(id))) return;
  fadedBuildings.clear();
  next.forEach((id) => fadedBuildings.add(id));
  map.triggerRepaint();
}

// Building models that are not drawn at all: the buildings whose floor plan is open
// (indoor/indoor-controller.js); [] = none.
export function setHiddenModelBuildings(map, ids) {
  const next = new Set((ids || []).map(String));
  if (next.size === hiddenBuildings.size && [...next].every((id) => hiddenBuildings.has(id))) return;
  hiddenBuildings.clear();
  next.forEach((id) => hiddenBuildings.add(id));
  map.triggerRepaint();
}

// Counts from the last drawn frame (diagnostics and tests): placements shown,
// drawn per detail level, culled, waiting for their first file, files loading.
export function get3DModelStats() {
  return { ...lastStats, levels: { ...lastStats.levels } };
}
