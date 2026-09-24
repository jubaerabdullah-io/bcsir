#!/usr/bin/env node
// Usage: npm run verify:originals
// Confirms that every original BCSIR file (datasets, shapefiles, QGIS project,
// routing script, QR helper) is byte-identical to the state recorded in
// original-files.sha256 before the 3D map was added.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

export async function verifyOriginals() {
  const manifest = await readFile(path.join(root, "original-files.sha256"), "utf8");
  const entries = manifest.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
    const [hash, ...rest] = line.trim().split(/\s+/);
    return { hash, file: rest.join(" ") };
  });
  const results = [];
  for (const { hash, file } of entries) {
    try {
      const actual = createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
      results.push({ file, ok: actual === hash, detail: actual === hash ? "unchanged" : `CHANGED (sha256 ${actual})` });
    } catch (error) {
      results.push({ file, ok: false, detail: `MISSING (${error.code || error.message})` });
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await verifyOriginals();
  for (const { file, ok, detail } of results) console.log(`${ok ? "OK     " : "FAILED "} ${file}  ${detail}`);
  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} original files unchanged.`);
  process.exit(failed.length ? 1 : 0);
}
