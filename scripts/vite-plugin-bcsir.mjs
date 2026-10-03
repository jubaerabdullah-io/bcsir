// Vite plugin for the indoor / campus 3D map.
//
// The datasets, GLB models and images are ordinary files in public/, one folder per
// organisation (public/data/<org>/, public/models/<org>/, public/image/<org>/). Vite
// serves them in development and copies them into dist/ at build time. This plugin:
// 1. Exposes the original routing functions from connection_check.js as the
//    virtual module "virtual:bcsir-routing" (see scripts/lib/original-routing.mjs).
// 2. Publishes the catalog of organisations (scripts/lib/catalog.mjs):
//    data/catalog.json for the organisation picker and data/<org>/index.json for
//    each organisation (dataset files, photos, buildings with floors, the search
//    list of rooms). They are generated from the folders, never stored in public/.
// 3. Pushes a "bcsir:data-changed" event when a file in public/data/ changes
//    (for example saved from QGIS or a text editor), so only that dataset or that
//    floor is reloaded in the browser during `npm run dev`.
// 4. Warns when the BCSIR routing network is missing or no longer matches the
//    sha256 recorded in original-files.sha256.
// 5. Warns when a GLB in public/models/<org>/ is new or was replaced since
//    `npm run models:optimize` last ran (public/models/<org>/lod/manifest.json).
// 6. In a build, writes the names of the landing page's own script and stylesheet
//    into index.html (in place of the mark "landing files"), so the page asks for
//    them at once instead of after the start-up script and the map's stylesheet
//    have arrived. Map addresses do not ask for them.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildCatalog, buildOrgIndex, DATA_DIR, listOrganisations, MODELS_DIR } from "./lib/catalog.mjs";
import { buildRoutingModule, ORIGINAL_ROUTING_FILE } from "./lib/original-routing.mjs";

const VIRTUAL_ROUTING_ID = "virtual:bcsir-routing";
const RESOLVED_ROUTING_ID = `\0${VIRTUAL_ROUTING_ID}`;
const CHECKSUMS = "original-files.sha256";
const CATALOG_URL = /\/data\/catalog\.json$/;
const INDEX_URL = /\/data\/([^/]+)\/index\.json$/;
const LANDING_MARK = "<!-- landing files -->";
const LANDING_MODULE = /[\\/]src[\\/]landing[\\/]landing\.js$/;

export function bcsirPlugin() {
  let root = process.cwd();
  let logger = console;
  let base = "./";
  const sourcePath = (relative) => path.join(root, relative);

  // The routing networks recorded in original-files.sha256 must stay the originals.
  function checkRoutingNetworks() {
    if (!existsSync(sourcePath(CHECKSUMS))) return;
    const recorded = readFileSync(sourcePath(CHECKSUMS), "utf8").split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter(([hash, name]) => hash && !hash.startsWith("#") && name?.startsWith(`${DATA_DIR}/`));
    for (const [hash, name] of recorded) {
      if (!existsSync(sourcePath(name))) { logger.warn(`[map] ${name} is missing; routes cannot be calculated.`); continue; }
      if (createHash("sha256").update(readFileSync(sourcePath(name))).digest("hex") !== hash) logger.warn(`[map] ${name} differs from the original routing network recorded in ${CHECKSUMS}.`);
    }
  }

  function checkModels() {
    const models = sourcePath(MODELS_DIR);
    if (!existsSync(models)) return;
    for (const entry of readdirSync(models, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(models, entry.name);
      let manifest = { models: {} };
      try { manifest = JSON.parse(readFileSync(path.join(directory, "lod", "manifest.json"), "utf8")); } catch { /* none yet */ }
      const stale = readdirSync(directory)
        .filter((file) => /.glb$/i.test(file))
        .filter((file) => manifest.models?.[file]?.sha256 !== createHash("sha256").update(readFileSync(path.join(directory, file))).digest("hex"));
      if (stale.length) logger.warn(`[map] ${MODELS_DIR}/${entry.name}: ${stale.join(", ")}: new or replaced since the last "npm run models:optimize"; run it to optimize them (until then they are drawn from their own files, without detail levels).`);
    }
  }

  // Problems found in the data folders (a floor without an outline, a building
  // folder that matches no footprint, ...), reported once per start.
  function reportCatalog() {
    for (const id of listOrganisations(root)) {
      const { problems, stats } = buildOrgIndex(root, id);
      logger.info(`[map] ${id}: ${stats.buildings} buildings, ${stats.indoor_buildings} with floor plans (${stats.floors} floors, ${stats.places} named rooms)`);
      if (problems.length) logger.warn(`[map] ${id}: check the data folder:\n  ${problems.join("\n  ")}`);
    }
  }

  function catalogMiddleware(req, res, next) {
    if (req.method !== "GET") return next();
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let body = null;
    const index = INDEX_URL.exec(pathname);
    if (CATALOG_URL.test(pathname)) body = buildCatalog(root);
    else if (index && listOrganisations(root).includes(index[1])) body = buildOrgIndex(root, index[1]);
    if (!body) return next();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  }

  return {
    name: "indoor-map",

    configResolved(config) {
      root = config.root;
      logger = config.logger;
      base = config.base || "./";
    },

    buildStart() {
      checkRoutingNetworks();
      checkModels();
      reportCatalog();
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
      server.middlewares.use(catalogMiddleware);
      const dataDir = path.normalize(sourcePath(DATA_DIR)) + path.sep;
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
      server.watcher.on("unlink", notify);
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
      server.middlewares.use(catalogMiddleware);
    },

    transformIndexHtml: {
      order: "post",
      handler(html, { bundle }) {
        if (!bundle || !html.includes(LANDING_MARK)) return html; // `npm run dev`: the mark stays a comment
        const chunks = Object.values(bundle).filter((item) => item.type === "chunk");
        const landing = chunks.find((chunk) => LANDING_MODULE.test(chunk.facadeModuleId || ""));
        if (!landing) return html;
        // The modules it imports that the page has not asked for already.
        const entries = new Set(chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName));
        const scripts = [landing.fileName, ...landing.imports.filter((file) => !entries.has(file))];
        const styles = [...(landing.viteMetadata?.importedCss || [])];
        const links = [
          ...scripts.map((file) => `<link rel="modulepreload" crossorigin href="${base}${file}">`),
          ...styles.map((file) => `<link rel="preload" as="style" crossorigin href="${base}${file}">`)
        ];
        return html.replace(LANDING_MARK, links.join(""));
      }
    },

    generateBundle() {
      this.emitFile({ type: "asset", fileName: "data/catalog.json", source: `${JSON.stringify(buildCatalog(root))}\n` });
      for (const id of listOrganisations(root)) this.emitFile({ type: "asset", fileName: `data/${id}/index.json`, source: `${JSON.stringify(buildOrgIndex(root, id))}\n` });
    }
  };
}
