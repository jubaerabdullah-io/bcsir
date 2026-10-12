#!/usr/bin/env node
// Usage: npm run models:character [-- <source.glb> [<output.glb>]]
//
// Builds public/models/shared/characters/nathan.glb, the walker shown in Walk Mode's
// third-person view (src/walk/walk-character.js), from the scanned man with a
// motion-captured walk that was added to that folder:
//   nathan_animated_003_-_walking_3d_man.glb  ("Nathan Animated 003 - Walking 3D Man"
//   by Renderpeople, CC-BY-4.0; 20 MB, an 8192 px texture, one clip "Take 001")
//
// The source is one recording of a man walking on the spot: two full strides of a
// real person, so every joint moves as a person's does (the thigh swings from the
// hip, the knee bends through the swing and is straight when the heel lands, the
// foot rolls from heel to toe, the pelvis and the chest turn against each other,
// the arms swing against the legs with the elbows closing as they come forward).
// The map needs more than that one clip, and a much lighter file:
//   Walk  the recording, sampled at 30 frames a second and closed into a loop (its
//         last frame is followed by its first again, with nothing skipped)
//   Idle  standing: the legs straight as the model was scanned, the trunk, head and
//         arms as the man holds them on average while he walks (arms hanging at his
//         sides), breathing slowly
//   Run   a jog made from the recording: the same motion of every joint taken
//         further (longer swing of the thighs, knees drawn up higher, the arms bent
//         at the elbow and pumping, the trunk leaning forward) and faster, with the
//         feet kept on the ground
//   the texture at 1024 px; the model stands in its Idle pose when no clip plays.
// The script prints the pace (m/s over the ground) the Walk and the Run are made
// for, at the height the character is drawn at: WALK_CHARACTERS in
// src/core/config.js holds them (walkPace, runPace), so the feet do not slide.
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { prune } from "@gltf-transform/functions";
import sharp from "sharp";
import * as THREE from "three";

const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = path.resolve(process.argv[2] || path.join(root, "public/models/shared/characters/nathan_animated_003_-_walking_3d_man.glb"));
const OUTPUT = path.resolve(process.argv[3] || path.join(root, "public/models/shared/characters/nathan.glb"));

const FPS = 30;
const TEXTURE_PX = 1024;
const DRAWN_HEIGHT_M = 1.8; // WALK_CHARACTERS height: the paces are printed for it
const IDLE = { seconds: 4, fps: 15, breath: 0.016 }; // breath: radians the chest rises and falls
// The jog: how much further each joint goes than in the walk (1 = as walked), and
// how much faster the strides follow each other.
const RUN = {
  rate: 1.62, // strides per second, as a multiple of the walk's
  gain: { upperleg: 1.38, lowerleg: 1.55, foot: 1.15, ball: 1, upperarm: 1.7, shoulder: 1.2, spine: 1.25, hip: 1.25 },
  elbow: 1.15, // radians the elbows are bent further
  lean: 0.14, // radians the trunk leans forward
  bounce: 1.6 // the rise and fall of the hips, as a multiple of the walk's
};

const io = new NodeIO();
const document = await io.read(SOURCE);
const gltf = document.getRoot();
const skin = gltf.listSkins()[0];
const source = gltf.listAnimations()[0];
if (!skin || !source) throw new Error(`${SOURCE}: a skinned model with one animation is expected`);
const joints = skin.listJoints();
const jointSet = new Set(joints);
// "rp_nathan_animated_003_walking_upperleg_l_074" -> "upperleg_l"
const short = (node) => node.getName().replace(/^rp_[a-z]+_animated_\d+_[a-z]+_/, "").replace(/_\d+$/, "");
const byName = new Map(joints.map((joint) => [short(joint), joint]));
const need = (name) => { const joint = byName.get(name); if (!joint) throw new Error(`The skeleton has no joint "${name}"`); return joint; };
const parentOf = new Map();
for (const joint of joints) for (const child of joint.listChildren()) if (jointSet.has(child)) parentOf.set(child, joint);

// ---- The recording, sampled evenly ------------------------------------------------------
const channels = new Map(); // node -> { translation?: sampler, rotation?: sampler }
for (const channel of source.listChannels()) {
  const node = channel.getTargetNode();
  if (!channels.has(node)) channels.set(node, {});
  channels.get(node)[channel.getTargetPath()] = channel.getSampler();
}
const sourceEnd = Math.max(...source.listSamplers().map((sampler) => sampler.getInput().getMax([])[0]));
const FRAMES = Math.round(sourceEnd * FPS) + 1; // the loop: frame FRAMES is frame 0 again
const quat = (values, at = 0) => new THREE.Quaternion(values[at], values[at + 1], values[at + 2], values[at + 3]);
const vec = (values, at = 0) => new THREE.Vector3(values[at], values[at + 1], values[at + 2]);

function sampleAt(sampler, time, size) {
  const times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
  let i = 0;
  while (i < times.length - 1 && times[i + 1] <= time) i += 1;
  const j = Math.min(i + 1, times.length - 1);
  const span = times[j] - times[i];
  const t = span > 0 ? Math.min(1, Math.max(0, (time - times[i]) / span)) : 0;
  if (size === 4) return quat(values, i * 4).slerp(quat(values, j * 4), t);
  return vec(values, i * 3).lerp(vec(values, j * 3), t);
}

// walk.get(node) = { rotation: [Quaternion per frame], translation: [Vector3 per frame] }
// (only the properties the recording moves), frames 0..FRAMES - 1.
const walk = new Map();
for (const [node, own] of channels) {
  const track = {};
  if (own.rotation) track.rotation = Array.from({ length: FRAMES }, (_, frame) => sampleAt(own.rotation, frame / FPS, 4));
  if (own.translation) track.translation = Array.from({ length: FRAMES }, (_, frame) => sampleAt(own.translation, frame / FPS, 3));
  // The same side of each quaternion as the frame before, so frames blend the short way.
  track.rotation?.forEach((q, frame, all) => { if (frame && all[frame - 1].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); });
  walk.set(node, track);
}

// ---- Poses and where they put the joints ------------------------------------------------
// A pose: node -> { q, t } for the joints it sets; the others keep the file's values.
const restOf = (node) => ({ q: quat(node.getRotation()), t: vec(node.getTranslation()) });
const poseOfFrame = (tracks, frame) => new Map([...tracks].map(([node, track]) => [node, { q: track.rotation?.[frame] ?? restOf(node).q, t: track.translation?.[frame] ?? restOf(node).t }]));
const ONE = new THREE.Vector3(1, 1, 1);
// World matrix of every joint (the nodes above the skeleton leave it where it is).
function worldOf(pose) {
  const world = new Map();
  const visit = (node, parent) => {
    const { q, t } = pose.get(node) || restOf(node);
    const matrix = parent.clone().multiply(new THREE.Matrix4().compose(t, q, vec(node.getScale())));
    world.set(node, matrix);
    for (const child of node.listChildren()) if (jointSet.has(child)) visit(child, matrix);
  };
  for (const joint of joints) if (!parentOf.has(joint)) visit(joint, new THREE.Matrix4());
  return world;
}
const positionIn = (world, name) => new THREE.Vector3().setFromMatrixPosition(world.get(need(name)));
const rotationIn = (world, node) => new THREE.Quaternion().setFromRotationMatrix(world.get(node));

// The pose the model was scanned and bound in (arms out, legs straight), from the
// skin's inverse bind matrices.
const inverseBind = skin.getInverseBindMatrices().getArray();
const bindWorld = new Map(joints.map((joint, index) => [joint, new THREE.Matrix4().fromArray(inverseBind, index * 16).invert()]));
const bind = new Map();
for (const joint of joints) {
  const parent = parentOf.get(joint);
  if (!parent) continue;
  const q = new THREE.Quaternion(), t = new THREE.Vector3();
  bindWorld.get(parent).clone().invert().multiply(bindWorld.get(joint)).decompose(t, q, new THREE.Vector3());
  bind.set(joint, { q, t });
}

// ---- Idle -------------------------------------------------------------------------------
const mean = (quaternions) => {
  const sum = new THREE.Vector4();
  for (const q of quaternions) sum.add(new THREE.Vector4(q.x, q.y, q.z, q.w).multiplyScalar(quaternions[0].dot(q) < 0 ? -1 : 1));
  return new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize();
};
const LEGS = /^(root|hip|upperleg|lowerleg|foot|ball)(_|$)/;
const idlePose = new Map();
for (const joint of joints) {
  const track = walk.get(joint) || {};
  const standing = LEGS.test(short(joint)) ? bind.get(joint) : null;
  if (!standing && !track.rotation && !track.translation) continue;
  idlePose.set(joint, {
    q: standing ? standing.q.clone() : track.rotation ? mean(track.rotation) : restOf(joint).q,
    // Only a joint the recording moves is moved: the others keep their place on their bone.
    t: !track.translation ? restOf(joint).t : standing ? standing.t.clone() : track.translation.reduce((sum, t) => sum.add(t), new THREE.Vector3()).divideScalar(FRAMES)
  });
}
// The feet on the ground: as low as the walking man's lower foot stands.
const ankleHeight = (world) => Math.min(positionIn(world, "foot_l").y, positionIn(world, "foot_r").y);
const walkAnkle = Array.from({ length: FRAMES }, (_, frame) => ankleHeight(worldOf(poseOfFrame(walk, frame))));
const groundAnkle = walkAnkle.reduce((sum, value) => sum + value, 0) / FRAMES; // one foot is always down
const hip = need("hip");
idlePose.get(hip).t.y += groundAnkle - ankleHeight(worldOf(idlePose));

// A turn about one of the body's own directions (x: its left, y: up, z: the way it
// faces), given to a joint as it stands in `world`.
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
function turned(pose, world, name, axis, angle) {
  const node = need(name);
  const facing = rotationIn(world, node);
  const local = facing.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(AXES[axis], angle)).multiply(facing);
  return (pose.get(node) || restOf(node)).q.clone().multiply(local);
}

const idleWorld = worldOf(idlePose);
const idleKeys = Math.round(IDLE.seconds * IDLE.fps) + 1;
const idleTracks = new Map([...idlePose].map(([node, { q, t }]) => [node, { rotation: [q, q], ...(walk.get(node)?.translation ? { translation: [t, t] } : {}) }]));
// Breathing: the chest rises, the neck keeps the head still.
for (const [name, share] of [["spine_02", -0.6], ["spine_03", -0.4], ["neck", 0.8]]) {
  idleTracks.get(need(name)).rotation = Array.from({ length: idleKeys }, (_, key) => turned(idlePose, idleWorld, name, "x", share * IDLE.breath * Math.sin((key / (idleKeys - 1)) * Math.PI * 2)));
}

// ---- Run --------------------------------------------------------------------------------
// Each joint goes `gain` times as far from where it is held on average as it does
// in the walk.
function powered(q, gain) { // the turn `q`, taken `gain` times as far
  const sign = q.w < 0 ? -1 : 1;
  const sine = Math.hypot(q.x, q.y, q.z);
  if (sine < 1e-7) return q.clone();
  const angle = 2 * Math.atan2(sine, q.w * sign);
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(q.x, q.y, q.z).multiplyScalar(sign / sine), angle * gain);
}
function amplified(rotation, gain) {
  const centre = mean(rotation);
  return rotation.map((q) => centre.clone().multiply(powered(centre.clone().invert().multiply(q), gain)));
}
const gainOf = (name) => Object.entries(RUN.gain).find(([key]) => name.startsWith(key))?.[1] ?? 1;
const run = new Map([...walk].map(([node, track]) => [node, {
  ...(track.rotation ? { rotation: gainOf(short(node)) === 1 ? track.rotation.map((q) => q.clone()) : amplified(track.rotation, gainOf(short(node))) } : {}),
  ...(track.translation ? { translation: track.translation.map((t) => t.clone()) } : {})
}]));
// The elbows bent: about the axis each one bends about in the walk, the way that
// brings the hand nearer the shoulder.
for (const side of ["l", "r"]) {
  const lower = need(`lowerarm_${side}`);
  const rotation = walk.get(lower).rotation;
  const centre = mean(rotation);
  const axis = new THREE.Vector3();
  for (const q of rotation) {
    const d = centre.clone().invert().multiply(q);
    const v = new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(d.w < 0 ? -1 : 1);
    axis.add(axis.dot(v) < 0 ? v.negate() : v);
  }
  axis.normalize();
  const reach = (angle) => {
    const pose = poseOfFrame(walk, 0);
    pose.get(lower).q = pose.get(lower).q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    const world = worldOf(pose);
    return positionIn(world, `upperarm_${side}`).distanceTo(positionIn(world, `hand_${side}`));
  };
  const bend = new THREE.Quaternion().setFromAxisAngle(axis, reach(0.3) < reach(-0.3) ? RUN.elbow : -RUN.elbow);
  run.get(lower).rotation = run.get(lower).rotation.map((q) => q.clone().multiply(bend));
  // The upper arm a little back, so the bent forearm swings beside the body.
  const upper = need(`upperarm_${side}`);
  run.get(upper).rotation = run.get(upper).rotation.map((q, frame) => turned(new Map([[upper, { q }]]), worldOf(poseOfFrame(walk, frame)), `upperarm_${side}`, "x", 0.25));
}
// The trunk leans into the run.
{
  const spine = need("spine_01");
  run.get(spine).rotation = run.get(spine).rotation.map((q, frame) => turned(new Map([[spine, { q }]]), worldOf(poseOfFrame(walk, frame)), "spine_01", "x", RUN.lean));
  const head = need("neck");
  run.get(head).rotation = run.get(head).rotation.map((q, frame) => turned(new Map([[head, { q }]]), worldOf(poseOfFrame(walk, frame)), "neck", "x", -RUN.lean * 0.6));
}
// The hips rise and fall more, and are then set so the lower foot stands on the ground.
{
  const heights = walk.get(hip).translation.map((t) => t.y);
  const middle = heights.reduce((sum, value) => sum + value, 0) / FRAMES;
  run.get(hip).translation.forEach((t, frame) => { t.y = middle + (heights[frame] - middle) * RUN.bounce; });
  const drop = run.get(hip).translation.map((_, frame) => groundAnkle - ankleHeight(worldOf(poseOfFrame(run, frame))));
  // Smoothed over a few frames: the feet meet the ground without a jolt, and the body
  // still leaves it a little between two steps.
  const smooth = drop.map((_, frame) => [-2, -1, 0, 1, 2].reduce((sum, offset) => sum + drop[(frame + offset + FRAMES) % FRAMES], 0) / 5);
  run.get(hip).translation.forEach((t, frame) => { t.y += smooth[frame]; });
}

// ---- Pace: how fast the ground passes under the standing foot ----------------------------
function paceOf(tracks, seconds) {
  const z = (frame, name) => positionIn(worldOf(poseOfFrame(tracks, frame % FRAMES)), name).z;
  const y = (frame, name) => positionIn(worldOf(poseOfFrame(tracks, frame % FRAMES)), name).y;
  const speeds = [];
  for (let frame = 0; frame < FRAMES; frame += 1) for (const name of ["foot_l", "foot_r"]) {
    const other = name === "foot_l" ? "foot_r" : "foot_l";
    // The foot that carries the weight: the lower one, moving back.
    if (y(frame, name) < y(frame, other) - 2 && y(frame + 1, name) < y(frame + 1, other) - 2) speeds.push((z(frame, name) - z(frame + 1, name)) / (seconds / FRAMES));
  }
  speeds.sort((a, b) => a - b);
  return speeds[Math.floor(speeds.length / 2)]; // model units a second
}

// ---- Written into the file --------------------------------------------------------------
const buffer = gltf.listBuffers()[0];
const walkSeconds = FRAMES / FPS;
const runSeconds = walkSeconds / RUN.rate;
const paces = { walk: paceOf(walk, walkSeconds), run: paceOf(run, runSeconds) };
function addClip(name, tracks, seconds) {
  const animation = document.createAnimation(name);
  const inputs = new Map(); // key count -> times
  const input = (count) => {
    if (!inputs.has(count)) inputs.set(count, document.createAccessor().setType("SCALAR").setBuffer(buffer).setArray(Float32Array.from({ length: count }, (_, key) => (key / (count - 1)) * seconds)));
    return inputs.get(count);
  };
  for (const [node, track] of tracks) for (const [targetPath, type, size] of [["rotation", "VEC4", 4], ["translation", "VEC3", 3]]) {
    const frames = track[targetPath];
    if (!frames) continue;
    // A loop: its first frame again at the end (a two-frame track holds one pose).
    const keys = frames.length > 2 ? [...frames, frames[0]] : frames;
    const values = new Float32Array(keys.length * size);
    keys.forEach((value, key) => value.toArray(values, key * size));
    const sampler = document.createAnimationSampler().setInput(input(keys.length)).setOutput(document.createAccessor().setType(type).setBuffer(buffer).setArray(values)).setInterpolation("LINEAR");
    animation.addSampler(sampler).addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath(targetPath).setSampler(sampler));
  }
  return animation;
}
for (const channel of source.listChannels()) channel.dispose();
for (const sampler of source.listSamplers()) sampler.dispose();
source.dispose();
addClip("Idle", idleTracks, IDLE.seconds);
addClip("Walk", walk, walkSeconds);
addClip("Run", run, runSeconds);
// The model stands in its Idle pose when no clip plays (and is measured in it).
for (const [node, { q, t }] of idlePose) node.setRotation(q.toArray()).setTranslation(t.toArray());

// One colour texture, much smaller: the character is a few hundred pixels tall on screen.
for (const texture of gltf.listTextures()) {
  const image = texture.getImage();
  if (!image) continue;
  const [width, height] = texture.getSize() || [0, 0];
  if (Math.max(width, height) <= TEXTURE_PX) continue;
  const resized = await sharp(Buffer.from(image)).resize(TEXTURE_PX, TEXTURE_PX, { fit: "inside" }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  texture.setImage(new Uint8Array(resized)).setMimeType("image/jpeg");
}
// Skin and cloth, lit by the map's lights alone: nothing of it is metal.
for (const material of gltf.listMaterials()) material.setMetallicFactor(0).setRoughnessFactor(Math.max(0.85, material.getRoughnessFactor()));

await document.transform(prune());
await io.write(OUTPUT, document);

const standing = worldOf(idlePose);
const tall = Math.max(...skin.listJoints().map((joint) => new THREE.Vector3().setFromMatrixPosition(standing.get(joint)).y));
const boundHeight = (() => { const position = gltf.listMeshes()[0].listPrimitives()[0].getAttribute("POSITION"); return position.getMax([])[1] - position.getMin([])[1]; })();
const metres = DRAWN_HEIGHT_M / boundHeight; // metres per model unit at the drawn height
const size = (await stat(OUTPUT)).size;
console.log(`${path.relative(root, OUTPUT)}: ${(size / 1024).toFixed(0)} KB (source ${((await stat(SOURCE)).size / 1048576).toFixed(1)} MB)`);
console.log(`  clips: Idle ${IDLE.seconds} s, Walk ${walkSeconds.toFixed(3)} s (${FRAMES} frames, two strides), Run ${runSeconds.toFixed(3)} s`);
console.log(`  model: ${boundHeight.toFixed(1)} units tall as bound, top joint at ${tall.toFixed(1)} standing; drawn ${DRAWN_HEIGHT_M} m tall`);
console.log(`  idle: hands at ${["hand_l", "hand_r"].map((name) => positionIn(standing, name).toArray().map((v) => v.toFixed(0)).join(" ")).join(" | ")}, feet at ${["foot_l", "foot_r"].map((name) => positionIn(standing, name).toArray().map((v) => v.toFixed(0)).join(" ")).join(" | ")}, head at ${positionIn(standing, "head").toArray().map((v) => v.toFixed(0)).join(" ")}`);
console.log(`  walkPace: ${(paces.walk * metres).toFixed(2)} m/s, runPace: ${(paces.run * metres).toFixed(2)} m/s  (WALK_CHARACTERS in src/core/config.js)`);
