// Saved choices of the visitor (localStorage): the map theme, the basemap, the
// Walk Mode character and the places used last.
//
// Reading and writing never throw: in a private window, or with storage blocked,
// a choice simply lasts for this page. The keys are the ones already in use, so
// saved choices are kept.
export const PREFERENCE_KEYS = {
  theme: "bcsir-map-theme", // "dark" | "light"
  basemap: "bcsir-map-basemap", // basemap id (map/basemaps.js)
  walk: "bcsir-walk-mode", // { character }
  recent: "bcsir-map-recent" // { [organisation id]: [directory entry key, ...] }, newest first (search/recents.js)
};

// The saved text, or null.
export function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* the choice lasts for this page only */ }
}

// The saved object, or {} when nothing usable is saved.
export function readJSONPreference(key) {
  try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; }
}

export function writeJSONPreference(key, value) {
  writePreference(key, JSON.stringify(value));
}
