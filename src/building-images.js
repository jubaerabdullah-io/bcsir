// Building photos, shared by the information card and the circular map labels.
//
// In order of preference:
// 1. the "image" property of BuildingBoundary.geojson, a public URL such as
//    "/image/abc.png" (public/image/abc.png); PNG, JPG, JPEG and WEBP;
// 2. the original "image_url" attribute (e.g. "101.jpg"), used only when that
//    file exists in public/image/.
// data/building-images.json lists the files in public/image/ (written by the
// Vite plugin), so a photo that is not there is never requested: the map shows
// the neutral placeholder and the console names the building to fix.
import { publicAssetUrl } from "./paths.js";

const IMAGE_EXTENSION = /\.(png|jpe?g|webp)(?:[?#].*)?$/i;
const REMOTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

let available = null; // Set of paths relative to public/image/, or null if unknown
export const imageManifest = fetch(publicAssetUrl("data/building-images.json"))
  .then((response) => (response.ok ? response.json() : null))
  .then((list) => { available = Array.isArray(list) ? new Set(list) : null; })
  .catch(() => { available = null; });

const warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

// Path inside public/image/ for a local "image/..." URL, else null.
function localImagePath(value) {
  if (REMOTE.test(value) || /^(?:data|blob):/i.test(value)) return null;
  const clean = value.replace(/^\.\//, "").replace(/^public\//i, "").replace(/^\/+/, "");
  return clean.startsWith("image/") ? clean.slice("image/".length) : null;
}

// Call after `await imageManifest`.
export function buildingImageCandidates(properties = {}) {
  const candidates = [];
  const image = typeof properties.image === "string" ? properties.image.trim() : "";
  if (image) {
    const local = localImagePath(image);
    if (!IMAGE_EXTENSION.test(image)) warnOnce(`Building ${properties.id}: image must be a .png, .jpg, .jpeg or .webp URL, got ${JSON.stringify(properties.image)}`);
    else if (local !== null && available && !available.has(local)) warnOnce(`Building ${properties.id}: image ${JSON.stringify(image)} is not in public/image/, so the placeholder is shown.`);
    else candidates.push(image);
  }
  const name = String(properties.image_url ?? "").trim();
  if (name && available?.has(name)) candidates.push(`image/${name}`);
  return candidates.map((candidate) => publicAssetUrl(candidate));
}

// Loads the first candidate that decodes. Resolves to an HTMLImageElement or null.
export function loadFirstImage(candidates) {
  return candidates.reduce((previous, url) => previous.then((found) => found || new Promise((resolve) => {
    const image = new Image();
    if (REMOTE.test(url) && !url.startsWith(window.location.origin)) image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image.naturalWidth ? image : null);
    image.onerror = () => resolve(null);
    image.src = url;
  })), Promise.resolve(null));
}
