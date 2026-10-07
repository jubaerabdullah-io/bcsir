// The places the visitor used last: results chosen in the search box and the
// starting points and destinations of routes, newest first. The search box and
// the directions fields list them before anything is typed.
//
// Only the keys of the directory entries are saved (directory.js: "building:101",
// "place:<uid>", "lab:<id>", "test:<id>"), one list per organisation, so a place
// that has left the map data is simply not listed any more.
import { PREFERENCE_KEYS, readJSONPreference, writeJSONPreference } from "../core/preferences.js";

const KEPT = 8;

// scope: the organisation's id. read / write: the saved object (replaced in tests).
export function createRecents({ scope, limit = KEPT, read = () => readJSONPreference(PREFERENCE_KEYS.recent), write = (value) => writeJSONPreference(PREFERENCE_KEYS.recent, value) }) {
  const saved = read()?.[scope];
  let keys = (Array.isArray(saved) ? saved : []).filter((key) => typeof key === "string").slice(0, limit);
  const save = () => write({ ...read(), [scope]: keys });

  return {
    // entry: a directory entry. One without a key (a place the directory does not list) is not kept.
    add(entry) {
      if (!entry?.key) return;
      keys = [entry.key, ...keys.filter((key) => key !== entry.key)].slice(0, limit);
      save();
    },
    // The saved places as entries, newest first. resolve(key) gives the entry of a
    // key, or null when it no longer exists. kinds: entry kinds to list (default
    // all); exclude: keys to leave out; limit: how many at most.
    list(resolve, { kinds = null, exclude = [], limit: most = limit } = {}) {
      const entries = [];
      for (const key of keys) {
        if (entries.length >= most) break;
        if (exclude.includes(key)) continue;
        const entry = resolve(key);
        if (entry && (!kinds || kinds.includes(entry.kind))) entries.push(entry);
      }
      return entries;
    },
    clear() {
      keys = [];
      save();
    }
  };
}
