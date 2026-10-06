// Impostors: models only a few pixels tall.
//
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
import * as THREE from "three";
import { addModelLights } from "./model-parts.js";

const IMPOSTOR_AZIMUTHS = 8;
const IMPOSTOR_ELEVATIONS = 4; // 0, 30, 60 and 90 degrees above the horizon
export const IMPOSTOR_HEIGHTS = [6, 12, 20, 32];
export const IMPOSTOR_FRAME_BUDGET = 30;

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
export function bakeImpostor(renderer, sourceScene, box, cell) {
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
  addModelLights(scene);
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

export function createImpostorMesh(texture, capacity) {
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
