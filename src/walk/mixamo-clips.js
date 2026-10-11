// Idle, Walk, Run and Jump for a character that has a skeleton but no such clips.
//
// A character downloaded as a rigged model in its T-pose (a Mixamo skeleton: bones
// named mixamorigHips, mixamorigLeftUpLeg, ...) can be posed but does not move: its
// file holds no walk. This module writes the clips for that skeleton, so such a
// character walks in Walk Mode like one that came with its own animations
// (walk-character.js uses them when the file has none of that name).
//
// The motion is described in the body's own directions (x: the character's left,
// y: up, z: the way it faces), per joint and as a function of the phase of the
// step, and only then turned into each bone's own rotation. That takes the
// skeleton's rest pose into account, whatever way its bones happen to be turned in
// the file, so nothing here depends on how the rig was built: only on the names of
// its bones.
//
// The walk is a human one: the thigh swings from the hip, the knee bends while the
// foot is off the ground and is straight again when the heel lands, the foot lifts
// its toes for the landing and pushes off at the end of the step, the pelvis turns
// with the stride and dips on the side of the swinging leg, the chest turns against
// it, and the arms hang at the sides and swing against the legs, their elbows
// closing a little as they come forward.
import * as THREE from "three";

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const pos = (value) => Math.max(0, value);
const about = (axis, angle) => new THREE.Quaternion().setFromAxisAngle(axis, angle);
const all = (...rotations) => rotations.reduce((result, rotation) => result.multiply(rotation), new THREE.Quaternion());

// Joint movements, each named for what it does (angles in radians).
const swing = (forward) => about(X, -forward); // a hanging limb forward (+) or back (-)
const bend = (angle) => about(X, angle); // the knee
const toes = (up) => about(X, -up); // toes up (+) or pointed down (-)
const lean = (forward) => about(X, forward); // the trunk forward (+)
const turn = (left) => about(Y, left); // about the upright axis
const tilt = (angle) => about(Z, angle); // sideways: + lifts the body's left side

// The arms are held out sideways in the rest pose: `ARM_DOWN` brings them to the
// sides (a little away from the body), and the elbow then bends about the axis that
// lies across the body once the arm hangs.
const ARM_DOWN = 1.36;
const armDown = (side, amount = ARM_DOWN) => about(Z, -side * amount); // side: +1 left, -1 right
const elbow = (side, angle, down = ARM_DOWN) => about(X.clone().applyQuaternion(about(Z, side * down)), -angle);
const arm = (side, forward, down = ARM_DOWN) => all(swing(forward), armDown(side, down));

// ---- The clips -------------------------------------------------------------------------
// Each: seconds for one cycle (two steps), frames sampled, the pace in m/s it is
// made for, how far the hips rise (a share of their height) and what each joint
// does at phase p (0..2π). The left leg is furthest forward at p = π/2.
const leg = (p, { reach, lift = 0, knee, kneeRest = 0.06, kneeLead = 0.35, toeUp = 0.22, pushOff = 0.3 }) => ({
  upper: swing(reach * (Math.sin(p) + 0.19 * Math.sin(2 * p)) + lift),
  // Bent through the swing (most just before the leg passes under the body),
  // straight when the heel lands.
  lower: bend(kneeRest + knee * pos(Math.cos(p + kneeLead)) ** 2),
  // Toes up for the landing, pointed down for the push at the end of the step.
  foot: toes(toeUp * pos(Math.cos(p - 0.75)) ** 2 - pushOff * pos(Math.cos(p + Math.PI / 2 + 0.25)) ** 2)
});

const CLIPS = {
  Idle: {
    duration: 3.6, samples: 25, pace: 0,
    rise: () => 0,
    joints: (p) => ({
      Spine2: lean(0.014 * Math.sin(p)),
      Head: all(turn(0.05 * Math.sin(p)), lean(-0.012 * Math.sin(p))),
      LeftArm: arm(1, 0.02 * Math.sin(p), ARM_DOWN - 0.015 * Math.sin(p)),
      RightArm: arm(-1, 0.02 * Math.sin(p), ARM_DOWN - 0.015 * Math.sin(p)),
      LeftForeArm: elbow(1, 0.18),
      RightForeArm: elbow(-1, 0.18)
    })
  },
  Walk: {
    duration: 0.92, samples: 33, pace: 1.85,
    // Highest as each leg passes under the body, lowest when both feet are down.
    rise: (p) => -0.012 + 0.018 * Math.cos(2 * p),
    joints: (p) => {
      const left = leg(p, { reach: 0.44, lift: 0.07, knee: 0.95 });
      const right = leg(p + Math.PI, { reach: 0.44, lift: 0.07, knee: 0.95 });
      const reachLeft = -Math.sin(p), reachRight = Math.sin(p); // the arms go against the legs
      return {
        Hips: all(turn(-0.075 * Math.sin(p)), tilt(-0.035 * Math.cos(p))),
        Spine: all(lean(0.04), turn(0.05 * Math.sin(p)), tilt(0.035 * Math.cos(p))),
        Spine2: turn(0.1 * Math.sin(p)),
        Head: all(turn(-0.075 * Math.sin(p)), lean(-0.03)),
        LeftUpLeg: left.upper, LeftLeg: left.lower, LeftFoot: left.foot,
        RightUpLeg: right.upper, RightLeg: right.lower, RightFoot: right.foot,
        LeftArm: arm(1, 0.42 * reachLeft - 0.04),
        RightArm: arm(-1, 0.42 * reachRight - 0.04),
        LeftForeArm: elbow(1, 0.26 + 0.34 * pos(reachLeft)),
        RightForeArm: elbow(-1, 0.26 + 0.34 * pos(reachRight))
      };
    }
  },
  Run: {
    duration: 0.64, samples: 33, pace: 4.8,
    rise: (p) => -0.03 + 0.03 * Math.cos(2 * p + 0.5),
    joints: (p) => {
      const stride = { reach: 0.72, lift: 0.2, knee: 1.55, kneeRest: 0.3, kneeLead: 0.55, toeUp: 0.15, pushOff: 0.5 };
      const left = leg(p, stride), right = leg(p + Math.PI, stride);
      const reachLeft = -Math.sin(p), reachRight = Math.sin(p);
      return {
        Hips: all(turn(-0.12 * Math.sin(p)), tilt(-0.04 * Math.cos(p))),
        Spine: all(lean(0.2), turn(0.08 * Math.sin(p))),
        Spine2: all(lean(0.06), turn(0.16 * Math.sin(p))),
        Head: all(turn(-0.12 * Math.sin(p)), lean(-0.2)),
        LeftUpLeg: left.upper, LeftLeg: left.lower, LeftFoot: left.foot,
        RightUpLeg: right.upper, RightLeg: right.lower, RightFoot: right.foot,
        LeftArm: arm(1, 0.8 * reachLeft, ARM_DOWN + 0.05),
        RightArm: arm(-1, 0.8 * reachRight, ARM_DOWN + 0.05),
        LeftForeArm: elbow(1, 1.45 + 0.2 * reachLeft, ARM_DOWN + 0.05),
        RightForeArm: elbow(-1, 1.45 + 0.2 * reachRight, ARM_DOWN + 0.05)
      };
    }
  },
  // Held while in the air: knees drawn up, arms raised.
  Jump: {
    duration: 1, samples: 2, pace: 0,
    rise: () => -0.02,
    joints: () => ({
      Spine: lean(0.12),
      Head: lean(-0.1),
      LeftUpLeg: swing(0.9), LeftLeg: bend(1.3), LeftFoot: toes(-0.3),
      RightUpLeg: swing(0.3), RightLeg: bend(0.9),
      LeftArm: arm(1, 0.7, 0.85), RightArm: arm(-1, 0.7, 0.85),
      LeftForeArm: elbow(1, 0.7, 0.85), RightForeArm: elbow(-1, 0.7, 0.85)
    })
  }
};

// The pace (m/s) the written Walk and Run are made for: { walkPace, runPace }.
export const MIXAMO_PACES = { walkPace: CLIPS.Walk.pace, runPace: CLIPS.Run.pace };

// "mixamorigLeftUpLeg", "mixamorig:LeftUpLeg", "mixamorig1LeftUpLeg" -> "LeftUpLeg".
const jointName = (name) => /^mixamorig\d*[:_]?(.+)$/i.exec(String(name || ""))?.[1] || null;

function skeletonOf(root) {
  const bones = new Map(); // joint name -> bone
  root.traverse((object) => {
    const joint = object.isBone ? jointName(object.name) : null;
    if (joint && !bones.has(joint)) bones.set(joint, object);
  });
  return bones;
}

// True when `root` holds a skeleton this module can write clips for.
export function isMixamoRig(root) {
  const bones = skeletonOf(root);
  return ["Hips", "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg", "LeftArm", "RightArm"].every((joint) => bones.has(joint));
}

// The clips (THREE.AnimationClip: Idle, Walk, Run, Jump) for the skeleton in `root`,
// which must stand in its rest pose (arms out sideways) when this is called.
export function buildMixamoClips(root) {
  const bones = skeletonOf(root);
  const hips = bones.get("Hips");
  if (!hips) return [];
  root.updateWorldMatrix(true, true);
  const rootTurn = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  // A bone's rest orientation in the body's directions.
  const rest = new Map();
  const restOf = (object) => {
    if (!rest.has(object)) rest.set(object, rootTurn.clone().multiply(object.getWorldQuaternion(new THREE.Quaternion())));
    return rest.get(object);
  };
  // The hips rise and fall along the body's upright axis, in their parent's own units.
  const hipsRest = hips.position.clone();
  const up = Y.clone().applyQuaternion(restOf(hips.parent).clone().invert()).multiplyScalar(hipsRest.length());

  return Object.entries(CLIPS).map(([name, clip]) => {
    const times = Array.from({ length: clip.samples }, (_, index) => (index / (clip.samples - 1)) * clip.duration);
    const values = new Map(); // bone -> quaternion values
    const heights = [];
    for (let index = 0; index < clip.samples; index += 1) {
      const phase = (index / (clip.samples - 1)) * Math.PI * 2;
      for (const [joint, own] of Object.entries(clip.joints(phase))) {
        // Only the bone that carries the name (a file may hold a second, unused bone of
        // the same name under it). A joint this skeleton lacks is left out.
        const bone = bones.get(joint);
        if (!bone) continue;
        // `own` turns the joint about the body's directions as its parent carries
        // them; the bone's own rotation is that turn seen from its parent's rest pose.
        const local = restOf(bone.parent).clone().invert().multiply(own).multiply(restOf(bone));
        if (!values.has(bone)) values.set(bone, []);
        const track = values.get(bone);
        // The same side of the quaternion as the frame before, so frames blend the short way.
        const last = track.length ? track.slice(-4) : null;
        if (last && last[0] * local.x + last[1] * local.y + last[2] * local.z + last[3] * local.w < 0) local.set(-local.x, -local.y, -local.z, -local.w);
        track.push(local.x, local.y, local.z, local.w);
      }
      heights.push(...hipsRest.clone().addScaledVector(up, clip.rise(phase)).toArray());
    }
    const tracks = [...values].map(([bone, track]) => new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, track));
    tracks.push(new THREE.VectorKeyframeTrack(`${hips.name}.position`, times, heights));
    return new THREE.AnimationClip(name, clip.duration, tracks);
  });
}
