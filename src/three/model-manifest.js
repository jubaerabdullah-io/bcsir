// Level-of-detail manifest of the open organisation's models
// (public/models/<org>/lod/manifest.json, written by `npm run models:optimize`):
// for each GLB its detail levels, its original bounding box and, for a ground
// surface, its top-view tile. Read once, by the model renderer (models3d.js) and
// the ground surfaces (surface-layer.js).
import { activeOrg, orgId } from "../core/org.js";
import { publicAssetUrl } from "../core/paths.js";

const modelsFolderUrl = () => publicAssetUrl(`models/${orgId()}/`);

let manifestPromise = null;
function loadManifest() {
  if (!manifestPromise) {
    // An organisation without optimized models has no manifest to ask for.
    manifestPromise = activeOrg()?.has_model_manifest === false ? Promise.resolve({ models: {} }) : fetch(new URL("lod/manifest.json", modelsFolderUrl()).href, { cache: "no-cache" })
      .then((response) => (response.ok ? response.json() : { models: {} }))
      .catch(() => ({ models: {} }));
  }
  return manifestPromise;
}

// Path of a model URL inside public/models/<org>/ ("mango_tree.glb"), or null.
function manifestKey(url) {
  const base = modelsFolderUrl();
  return url.startsWith(base) ? decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]) : null;
}

// The manifest entry of a model (URLs resolved), or null when the model was not
// optimized yet: it is then drawn from its own file only. A GLB replaced under the same
// name after the optimizer ran is reported by `npm run dev`, `npm run build` and `npm test`.
const entryPromises = new Map();
export function modelManifestEntry(url) {
  if (!entryPromises.has(url)) {
    entryPromises.set(url, loadManifest().then((manifest) => {
      const key = manifestKey(url);
      const entry = key ? manifest.models?.[key] : null;
      if (!entry) return null;
      const folder = modelsFolderUrl();
      return {
        ...entry,
        lods: entry.lods.map((lod) => ({ ...lod, url: new URL(lod.url, folder).href })),
        surface: entry.surface ? { ...entry.surface, url: new URL(entry.surface.url, folder).href } : null
      };
    }));
  }
  return entryPromises.get(url);
}
