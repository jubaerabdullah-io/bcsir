// Loads the organisation's directory files (org.json "directory": laboratories and
// testing services, e.g. public/data/bcsir/directory/). An organisation without a
// directory simply has none. A missing or broken file never stops the map: the
// search then has no laboratories or tests, and the problem is logged.
import { activeOrg, orgDataPath } from "./org.js";
import { publicAssetUrl } from "./paths.js";

// Published paths of the directory files ({ laboratories, services }); a file the
// organisation does not have is null.
export function directoryFiles() {
  const files = activeOrg()?.directory || {};
  return { laboratories: files.laboratories ? orgDataPath(files.laboratories) : null, services: files.services ? orgDataPath(files.services) : null };
}

async function readJSON(file, fresh) {
  if (!file) return {};
  const url = publicAssetUrl(file);
  const response = await fetch(fresh ? `${url}?v=${Date.now()}` : url, fresh ? { cache: "no-store" } : undefined);
  if (!response.ok) throw new Error(`${file}: ${response.status} ${response.statusText}`);
  return response.json();
}

function validRecords(list, file, required) {
  if (!Array.isArray(list)) { console.warn(`${file}: expected a list of records.`); return []; }
  const valid = list.filter((record) => required.every((key) => record?.[key] !== undefined && record[key] !== null && record[key] !== ""));
  if (valid.length !== list.length) console.warn(`${file}: ${list.length - valid.length} record(s) skipped because ${required.join(", ")} is missing.`);
  return valid;
}

export async function loadDirectory({ fresh = false } = {}) {
  const DIRECTORY_FILES = directoryFiles();
  const [labs, services] = await Promise.allSettled([readJSON(DIRECTORY_FILES.laboratories, fresh), readJSON(DIRECTORY_FILES.services, fresh)]);
  const errors = [];
  const fail = (file, result) => { const message = result.reason?.message || String(result.reason); console.warn(`Could not load ${file}:`, message); errors.push(message); };
  if (labs.status === "rejected") fail(DIRECTORY_FILES.laboratories, labs);
  if (services.status === "rejected") fail(DIRECTORY_FILES.services, services);
  return {
    laboratories: labs.status === "fulfilled" && DIRECTORY_FILES.laboratories ? validRecords(labs.value.laboratories, DIRECTORY_FILES.laboratories, ["id", "name", "type"]) : [],
    services: services.status === "fulfilled" && DIRECTORY_FILES.services ? validRecords(services.value.services, DIRECTORY_FILES.services, ["id", "name", "laboratory_id"]) : [],
    sources: services.status === "fulfilled" && Array.isArray(services.value.sources) ? services.value.sources : [],
    errors
  };
}
