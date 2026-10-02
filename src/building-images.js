// Building photos, shared by the information card and the circular map labels.
//
// Photos are in the organisation's own folder, public/image/<organisation>/. In
// order of preference:
// 1. the "image" property of the buildings file, e.g. "/image/abc.png" or
//    "abc.png" (public/image/<organisation>/abc.png); PNG, JPG, JPEG and WEBP;
// 2. the original "image_url" attribute (e.g. "101.jpg"), used only when that
//    file exists in that folder.
// The organisation's index lists the files in its image folder (written by
// scripts/lib/catalog.mjs), so a photo that is not there is never requested: the
// map shows the neutral placeholder and the console names the building to fix.
// Names are matched to that listing ignoring capitalisation and URL encoding,
// and the file's own spelling is requested: Windows and the dev server accept
// "Photo.PNG" for "photo.png", GitHub Pages does not.
import { findListedFile } from "./asset-paths.js";
import { activeOrg, imageKey, imagePath, orgId } from "./org.js";
import { publicAssetUrl } from "./paths.js";

const IMAGE_EXTENSION = /\.(png|jpe?g|webp)(?:[?#].*)?$/i;
const REMOTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

// Paths relative to public/image/<organisation>/, or null if unknown.
const available = Array.isArray(activeOrg()?.images) ? new Set(activeOrg().images) : null;
// Kept for callers that wait for the listing: it now arrives with the organisation.
export const imageManifest = Promise.resolve();

const warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

// Call after `await imageManifest`.
export function buildingImageCandidates(properties = {}) {
  const candidates = [];
  const folder = `public/image/${orgId()}/`;
  const image = typeof properties.image === "string" ? properties.image.trim() : "";
  if (image) {
    const local = imageKey(image); // null for a remote URL
    const listed = local !== null && available ? findListedFile(local, available) : null;
    if (!IMAGE_EXTENSION.test(image)) warnOnce(`Building ${properties.id}: image must be a .png, .jpg, .jpeg or .webp URL, got ${JSON.stringify(properties.image)}`);
    else if (local !== null && available && !listed) warnOnce(`Building ${properties.id}: image ${JSON.stringify(image)} is not in ${folder}, so the placeholder is shown.`);
    else if (listed && listed !== local) {
      warnOnce(`Building ${properties.id}: image ${JSON.stringify(image)} is spelled "${listed}" in ${folder}; using that file (GitHub Pages is case-sensitive).`);
      candidates.push(imagePath(listed));
    } else candidates.push(imagePath(image));
  }
  const name = findListedFile(String(properties.image_url ?? "").trim(), available);
  if (name) candidates.push(imagePath(name));
  return [...new Set(candidates.map((candidate) => publicAssetUrl(candidate)))];
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
