// Reads the files of one floor from disk, in the form src/indoor/indoor-store.js
// expects from its `loadFiles` (the browser fetches the same files). Used by the
// tests and by scripts that route through floor plans.
import { readFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./catalog.mjs";

export function readLevelFiles(root, orgId, building, level) {
  const directory = path.join(root, DATA_DIR, orgId, building.entry.folder, level.id);
  const read = (file) => JSON.parse(readFileSync(path.join(directory, file), "utf8"));
  const { files } = level;
  return {
    level: files.level ? read(files.level) : null,
    corridor: files.corridor.map(read),
    walls: files.walls.map(read),
    doors: files.doors.map(read),
    pois: files.pois.map((file) => ({ file, data: read(file) })),
    units: files.units.map((unit) => ({ ...unit, data: read(unit.file) }))
  };
}
