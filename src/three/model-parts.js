// What a GLB model is drawn with: its lights, the instanced copies of its meshes
// (one draw call per mesh and detail level, however many placements use it) and
// the material variants they need. Used by the model renderer (models3d.js) and
// the impostor views (model-impostors.js).
import * as THREE from "three";
import { STYLE } from "../core/config.js";

// The reference's three lights, fixed in each model's own frame (they turn with the
// model's rotation). The layer's scene and the impostor views use the same ones, so
// a model is shaded alike at every size.
export function addModelLights(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 1.5));
  const light1 = new THREE.DirectionalLight(0xffffff, 1.5);
  light1.position.set(0, -70, 100).normalize();
  const light2 = new THREE.DirectionalLight(0xffffff, 1);
  light2.position.set(0, 70, 100).normalize();
  scene.add(light1, light2);
}

export function disposeObject3D(root) {
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
export function sidedMaterials(material) {
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
export const twoPass = (material) => !Array.isArray(material) && material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass;

// See-through copies of a building model's material (setFadedModelBuildings): a
// depth-only pass, then the colours at STYLE.routeObscuringOpacity where that depth
// is met. Only the nearest surface of the model shows, as in the see-through
// extrusions, instead of its back walls and floors through each other. Both are
// drawn after the opaque models (transparent, renderOrder 1 and 2), so those show
// through.
const fadedCopies = new WeakMap(); // material -> [depth, colour]
function fadedMaterials(material) {
  if (!fadedCopies.has(material)) {
    const depth = material.clone();
    Object.assign(depth, { colorWrite: false, depthWrite: true, transparent: true, forceSinglePass: true });
    const colour = material.clone();
    Object.assign(colour, { transparent: true, opacity: material.opacity * STYLE.routeObscuringOpacity, depthWrite: false, depthFunc: THREE.LessEqualDepth, forceSinglePass: true });
    for (const copy of [depth, colour]) {
      copy.userData = { ...copy.userData, bcsirPlaced: false };
      preparePlacedMaterial(copy);
    }
    fadedCopies.set(material, [depth, colour]);
  }
  return fadedCopies.get(material);
}
export function disposeFadedMaterials(material) {
  for (const item of Array.isArray(material) ? material : [material]) {
    fadedCopies.get(item)?.forEach((copy) => copy.dispose());
    fadedCopies.delete(item);
  }
}

// One drawable part of one detail level: a GLB mesh drawn for many placements.
// faded: the see-through version of that part (fadedMaterials), with its own instances.
export function createPart(sourceMesh, capacity, faded = false) {
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
  const instanced = (material, renderOrder = 0) => {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // culled per placement in render()
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = renderOrder;
    mesh.count = 0;
    return mesh;
  };
  const fadedCopy = (pass) => (Array.isArray(sourceMesh.material) ? sourceMesh.material.map((material) => fadedMaterials(material)[pass]) : fadedMaterials(sourceMesh.material)[pass]);
  let mesh, front;
  if (faded) {
    // Depth pass, then the colours: same geometry and instance data.
    mesh = instanced(fadedCopy(0), 1);
    front = instanced(fadedCopy(1), 2);
  } else {
    mesh = instanced(twoPass(sourceMesh.material) ? sidedMaterials(sourceMesh.material)[0] : sourceMesh.material);
    // Front faces of a two-pass material: same geometry and instance data.
    front = twoPass(sourceMesh.material) ? instanced(sidedMaterials(sourceMesh.material)[1]) : null;
  }
  if (front) front.instanceMatrix = mesh.instanceMatrix;
  return {
    mesh,
    front,
    faded,
    sourceMaterial: sourceMesh.material,
    place,
    yaw,
    meshMatrix: sourceMesh.matrixWorld.clone(),
    transparent: materials.some((material) => material.transparent),
    drawn: [], // placements whose instance data is on the GPU, in order
    drawnVersion: -1
  };
}

export function removePart(part) {
  for (const mesh of [part.mesh, part.front]) {
    if (!mesh) continue;
    mesh.removeFromParent();
    mesh.dispose();
  }
}
