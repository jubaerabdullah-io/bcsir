// Vite plugin for the BCSIR 3D map.
//
// The datasets, GLB models and images are ordinary files in public/ (Vite serves
// them in development and copies them into dist/ at build time). This plugin:
// 1. Exposes the original routing functions from connection_check.js as the
//    virtual module "virtual:bcsir-routing" (see scripts/lib/original-routing.mjs).
// 2. Lists the building photos in public/image/ (including sub-folders) as
//    data/building-images.json, so the building card and the map labels only
//    request photos that exist.
// 3. Pushes a "bcsir:data-changed" event when a file in public/data/ changes
//    (for example saved from QGIS or a text editor), so only that dataset is
//    reloaded in the browser during `npm run dev`.
// 4. Warns when public/data/ConnectedRoads/v0/r2.json (the routing network) is
//    missing or no longer matches the sha256 recorded in original-files.sha256.
// 5. Warns when a GLB in public/models/ is new or was replaced since
//    `npm run models:optimize` last ran (public/models/lod/manifest.json).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildRoutingModule, ORIGINAL_ROUTING_FILE } from "./lib/original-routing.mjs";

const VIRTUAL_ROUTING_ID = "virtual:bcsir-routing";
const RESOLVED_ROUTING_ID = `\0${VIRTUAL_ROUTING_ID}`;
const PUBLIC_DATA_DIR = "public/data";
const IMAGE_DIR = "public/image";
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
const ROUTING_NETWORK = "public/data/ConnectedRoads/v0/r2.json";
const CHECKSUMS = "original-files.sha256";
const MODELS_DIR = "public/models";
const MODEL_MANIFEST = "public/models/lod/manifest.json";

export function bcsirPlugin() {
  let root = process.cwd();
  let logger = console;
  const sourcePath = (relative) => path.join(root, relative);

  // Image files in public/image/, as paths relative to that folder
  // ("101.jpg", "BuildingBoundary/abc.png"), so the map requests only photos
  // that exist.
  function buildingImages() {
    const directory = sourcePath(IMAGE_DIR);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.test(entry.name))
      .map((entry) => path.relative(directory, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join("/"))
      .sort();
  }

  function checkRoutingNetwork() {
    const network = sourcePath(ROUTING_NETWORK);
    if (!existsSync(network)) {
      logger.warn(`[bcsir] ${ROUTING_NETWORK} is missing; routes cannot be calculated.`);
      return;
    }
    const recorded = existsSync(sourcePath(CHECKSUMS))
      ? readFileSync(sourcePath(CHECKSUMS), "utf8").split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find(([, name]) => name === ROUTING_NETWORK)?.[0]
      : null;
    const actual = createHash("sha256").update(readFileSync(network)).digest("hex");
    if (recorded && recorded !== actual) logger.warn(`[bcsir] ${ROUTING_NETWORK} differs from the original routing network recorded in ${CHECKSUMS}.`);
  }

  function checkModels() {
    const directory = sourcePath(MODELS_DIR);
    if (!existsSync(directory)) return;
    let manifest = { models: {} };
    try { manifest = JSON.parse(readFileSync(sourcePath(MODEL_MANIFEST), "utf8")); } catch { /* none yet */ }
    const stale = readdirSync(directory)
      .filter((file) => /.glb$/i.test(file))
      .filter((file) => manifest.models?.[file]?.sha256 !== createHash("sha256").update(readFileSync(path.join(directory, file))).digest("hex"));
    if (stale.length) logger.warn(`[bcsir] ${stale.join(", ")}: new or replaced since the last "npm run models:optimize"; run it to optimize them (until then they are drawn from their own files, without detail levels).`);
  }

  function imageListMiddleware(req, res, next) {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (req.method !== "GET" || !pathname.endsWith("/data/building-images.json")) return next();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(buildingImages()));
  }

  return {
    name: "bcsir-map",

    configResolved(config) {
      root = config.root;
      logger = config.logger;
    },

    buildStart() {
      checkRoutingNetwork();
      checkModels();
      this.addWatchFile(sourcePath(ORIGINAL_ROUTING_FILE));
    },

    resolveId(id) {
      return id === VIRTUAL_ROUTING_ID ? RESOLVED_ROUTING_ID : null;
    },

    load(id) {
      if (id !== RESOLVED_ROUTING_ID) return null;
      this.addWatchFile(sourcePath(ORIGINAL_ROUTING_FILE));
      return buildRoutingModule(root);
    },

    configureServer(server) {
      server.middlewares.use(imageListMiddleware);
      const dataDir = path.normalize(sourcePath(PUBLIC_DATA_DIR)) + path.sep;
      const timers = new Map();
      const notify = (file) => {
        const normalized = path.normalize(file);
        if (!normalized.startsWith(dataDir) || !/\.(geo)?json$/i.test(normalized)) return;
        clearTimeout(timers.get(normalized));
        timers.set(normalized, setTimeout(() => {
          const published = `data/${path.relative(dataDir, normalized).split(path.sep).join("/")}`;
          server.ws.send({ type: "custom", event: "bcsir:data-changed", data: { file: published } });
        }, 250));
      };
      server.watcher.on("change", notify);
      server.watcher.on("add", notify);
      // Newly uploaded or replaced GLB files.
      const modelsDir = path.normalize(sourcePath(MODELS_DIR)) + path.sep;
      let modelTimer;
      const onModel = (file) => {
        const normalized = path.normalize(file);
        if (!normalized.startsWith(modelsDir) || !/.glb$/i.test(normalized) || normalized.includes(`${path.sep}lod${path.sep}`)) return;
        clearTimeout(modelTimer);
        modelTimer = setTimeout(checkModels, 1000);
      };
      server.watcher.on("change", onModel);
      server.watcher.on("add", onModel);
    },

    configurePreviewServer(server) {
      server.middlewares.use(imageListMiddleware);
    },

    generateBundle() {
      this.emitFile({ type: "asset", fileName: "data/building-images.json", source: `${JSON.stringify(buildingImages())}\n` });
    }
  };
}
