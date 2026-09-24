#!/usr/bin/env node
// Usage:
//   npm run data:prepare               create missing files in public/data/
//   npm run data:prepare -- --refresh  rebuild Garden / TreeLine from the shapefiles, keeping
//                                      the visualization properties already set
// Only public/data/ is written; the shapefiles are only read.
import { fileURLToPath } from "node:url";
import { preparePublicData } from "./lib/public-data.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const refresh = process.argv.includes("--refresh");
const written = await preparePublicData(root, { refresh, log: console.log });
console.log(written.length ? `Done. ${written.length} file(s) written.` : "public/data is up to date. Nothing written.");
