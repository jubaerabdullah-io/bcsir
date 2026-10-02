# Build prompt: multi-organisation indoor + campus 3D map platform

> Paste everything below this line into a new Claude Code session opened in an **empty folder**.
> Attach the image that shows the visual style you want before sending.

---

## 0. Your role and the goal

You are building a **new** web app from scratch: a static, data-driven 3D map platform that
serves **many organisations** (for example *Taqwa Ltd*, *Bangladesh Airport*). Each
organisation has a site (boundary, roads, paths, green areas, outdoor 3D objects) and many
buildings. Each building has floors, and each floor has rooms or shops, corridors, walls,
doors, points of interest, stairs and elevators, and placed 3D models.

Non-goals: the system must **not** be complex. Optimise for: one obvious place for every
piece of data, a build-time compiler that validates everything, a small runtime, lazy
loading, and predictable behaviour when the 1st or the 500th building is added.

Work in phases (section 13). Use plan mode before Phase 1. Keep a `CLAUDE.md` in the new repo
with the decisions below and anything you learn.

---

## 1. Reference repository (read-only knowledge source)

A previous single-campus project exists at:

```
C:\Users\Pathao Ltd\Downloads\bcsir-qgis-map-master\bcsir-qgis-map-master
```

It is MapLibre GL JS 6.9 + three.js. **Do not copy its renderer code** (`models3d.js`,
`building-models.js`, `scripts/building-models/*`, `tree-layer.js`, `walkMode.js` are
being replaced by simpler mechanisms). Read these files for ideas and port **pure logic only**,
with tests:

| File | Port / learn |
|---|---|
| `src/asset-paths.js` | `encodeAssetPath`, `findListedFile`: URL-encode path segments, match file names case-sensitively (GitHub Pages is case-sensitive, Windows is not) |
| `src/visual-properties.js` | `parseNumber`, `parseColor`, `createReport`: QGIS writes numbers as strings, and problems are reported grouped by message with feature ids |
| `src/model-placements.js` | GeoJSON → model placement rules (Point / MultiPoint), never guessing positions |
| `src/building-footprint.js` | `orientedFootprint`, `footprintFront`, `offsetLngLat`: oriented rectangle of a polygon, front side from an entrance |
| `src/geo-utils.js` | `wallLineToPolygon` (wall line → strip with thickness), `cutLineGaps` (door openings), `labelAnchor` (label inside L/U shapes) |
| `src/navigation/local-frame.js` | local metric frame, segment maths |
| `src/navigation/route-progress.js` | turn detection (≥28° judged over 7 m, merge turns within 10 m), manoeuvre text, distance formatting |
| `src/navigation/compass.js` | iOS compass permission and heading handling (for later outdoor live navigation) |
| `src/combobox.js`, `src/directory.js` (`normalizeText`) | keyboard-accessible search list, text normalisation |
| `src/short-names.js` | short labels for small screens |
| `scripts/optimize-models.mjs` | gltf-transform pipeline: dedup/prune/weld/meshopt, spec-gloss → metal-rough, keeping originals |
| `scripts/vite-plugin-bcsir.mjs` | dev-server data watcher → push a reload event for only the changed dataset |
| `src/models3d.js` | study the instanced mesh approach (one THREE.InstancedMesh per GLB part), the LOD manifest, the impostor bake, and the building fade — **do not copy wholesale**, but the patterns are proven |
| `README.md`, `docs/INTEGRATION_REPORT.md` | lessons, measured performance numbers |

---

## 2. Key decisions (already made, do not re-litigate without asking)

1. **Renderer: MapLibre GL JS, latest stable, exact version pinned** (no `^`). Reasons: open
   source, no billing, no token required, the reference repo already uses it. three.js (latest
   stable, exact version pinned) provides the 3D model layer as a MapLibre custom layer — the
   same proven approach as the reference, but rewritten cleanly with one layer for all models.
   - Before using any MapLibre API, check `node_modules/maplibre-gl/dist/maplibre-gl.d.ts`. The
     reference found that MapLibre 6.9 has no `map.isEasing()`, no `getFreeCameraOptions()`, and
     `fill-extrusion-opacity` is per-layer not per-feature. Verify the pinned version before using
     any camera or opacity API.
   - Basemap: free OpenStreetMap raster tiles (default) plus an optional satellite tile URL in
     `org.json`. No Mapbox Standard style.
2. **We own the floor state.** Build our own level control (section 8.2) and switch floors by
   loading that floor's GeoJSON bundle (`source.setData()`). We know the active floor for lazy
   loading, routing, and the URL. The compiled data uses the **Mapbox indoor schema field names**
   (`structure`, `floor`, `z_index`, `floor_id`, `structure_ids`, `is_default`,
   `conflicted_floor_ids`) — they are clean names, not a vendor lock-in, and following them costs
   nothing.
3. **The active floor is drawn flattened at ground level**: the focused building's exterior shell
   is hidden (filter on the buildings layer), and its active floor plan is drawn at z = 0. Floor
   fills are `fill`, walls are short `fill-extrusion`, and 3D objects use the three.js custom
   layer. Other buildings show their exterior shells. This avoids floating floors and route lines
   hidden inside extrusions. `fill-extrusion-opacity` is per-layer in MapLibre, so never design
   a feature that needs per-building transparency simultaneously (the flattened-floor approach
   avoids this by only showing one building's interior at a time).
4. **Floor plans are GeoJSON, never GLB.** Walls, rooms, corridors and doors come from GeoJSON
   (searchable, clickable, routable, cheap). **GLB files are only for objects**: stairs,
   escalators, kiosks, furniture, trees, gates, vehicles, and optionally a landmark building's
   exterior. A GLB is placed by a GeoJSON feature in one of 4 modes (section 4.5): Point,
   MultiPoint, Polygon-fit, Line-repeat. This replaces the old `building-models.js`, the
   procedural building generator and the custom tree layer.
5. **Build-time compiler, static runtime.** Browsers cannot list folders, and raw QGIS exports
   are not render-ready. `scripts/compile.mjs` reads the authoring folders, validates,
   normalises, optimises models and images, builds the routing graph and the search index, and
   writes small per-organisation bundles. The browser only fetches compiled files.
6. **Authoring content lives outside `public/`** in `content/<org>/`. Vite publishes everything
   in `public/` unchanged, which would ship raw sources, full-size photos and every
   organisation's data in every build. The compiler writes runtime files to `public/generated/`,
   which is git-ignored and reproducible.
7. **Stack**: Vite + vanilla JavaScript ES modules (no UI framework), Node ≥ 22, `node --test`.
   Dependencies: `maplibre-gl` (pinned), `three` (pinned), `polylabel`, a minimal set of
   `@turf/*` functions, `@gltf-transform/*`, `meshoptimizer`, `sharp`, `chokidar` (dev only).
   Ask before adding any other dependency.
8. **Static hosting** (GitHub Pages or any CDN), relative `base: "./"`. Everything in
   `public/generated/` is **public**: never put private data (staff phone numbers, security
   rooms) in content. Per-company access control (restricting which organisations are visible to
   which users) is deferred to Phase 9 and needs a backend; it is not in scope for Phases 1–8.

---

## 3. Authoring layout (what I, the map maker, edit in QGIS)

```
content/
├── _shared/
│   └── models/                       # GLBs any organisation may use: "shared/tree-mango.glb"
├── taqwa-ltd/                        # one folder per organisation = add/remove/deploy one folder
│   ├── org.json                      # name, logo, theme, initial view, options (section 4.1)
│   ├── boundary/   *.geojson         # site outline (+ optional wall)
│   ├── roads/      *.geojson         # roads (LineString + width_m, or Polygon)
│   ├── paths/      *.geojson         # footpaths; also the outdoor routing network
│   ├── areas/      *.geojson         # gardens, parking, water, plazas, sports
│   ├── models/     *.geojson         # outdoor GLB placements (trees, gate, signboards)
│   ├── images/                       # photos, logos (any sub-folders)
│   ├── 3d/                           # this organisation's GLB/glTF files
│   └── buildings/
│       ├── 5 Storied New Admin Building/
│       │   ├── building.geojson      # footprint + building properties (1 feature)
│       │   ├── G/                    # ground floor
│       │   │   ├── level.geojson     # optional: floor outline + level properties
│       │   │   ├── corridors.geojson
│       │   │   ├── shops.geojson     # any other name = a "units" layer (class = "shop")
│       │   │   ├── walls.geojson
│       │   │   ├── doors.geojson
│       │   │   ├── pois.geojson
│       │   │   ├── connectors.geojson   # stairs / elevators / escalators / ramps
│       │   │   ├── paths.geojson        # indoor routing lines
│       │   │   └── models.geojson       # GLB placements on this floor
│       │   ├── L1/ …                 # first floor above ground
│       │   ├── L2/ …                 # second floor
│       │   └── L3/ …
│       └── 2 Storied Building/
│           ├── G/ …
│           └── L1/ …
└── bangladesh-airport/ …             # same structure
```

Rules (the compiler enforces them):

- **Every folder of site files (`roads/`, `paths/`, …) may hold any number of `.geojson` files.**
  They are merged, so file names are free (`road1.geojson`, `north-roads.geojson`).
- **File-name kinds on a level**: `level`, `corridors`, `walls`, `doors`, `pois`, `connectors`,
  `paths`, `models`. The singular form is also accepted (`corridor.geojson`). **Any other file
  name is a units layer**, and its default `class` is the singular file name: `shops.geojson` →
  `shop`, `offices.geojson` → `office`, `toilets.geojson` → `toilet`.
- **Folder names may contain spaces and capitals.** The compiler derives a URL-safe id
  (`5-storied-new-admin-building`) unless the feature sets `id`. Ids are used in URLs and QR
  codes, so they must never change once published. Id collisions are errors.
- **Level folder naming and z_index**:

  | Folder | Meaning | Default z_index |
  |---|---|---|
  | `G` | Ground floor | 0 |
  | `L1`, `L2`, `L3`, … | Floors above ground | 1, 2, 3, … |
  | `B1`, `B2`, … | Basements | −1, −2, … |

  `level.geojson` can override `name`, `short_name` and `z_index`, for example
  `{ "z_index": 0, "short_name": "G", "name": "Ground Floor" }`. Reject any other folder name
  in a level directory with a clear error.

- Coordinates: **WGS 84 longitude/latitude** (EPSG:4326 / CRS84), 7 decimals. Reject any
  coordinate outside ±180/±90 or more than 2 km outside the organisation's bounds, naming the
  file. This catches exports left in a projected CRS such as BUTM / EPSG:3106.
- The compiler **never writes into `content/`**: the user edits those files by hand and in QGIS.

---

## 4. Authoring schema

All properties are optional unless marked ★. Numbers may be numbers or numeric strings. Unknown
properties are kept and passed through to the info card. Common properties on any feature:
`id`, `name`, `name_bn`, `class`, `color` (hex), `image` (path inside `images/`),
`description`, `keywords`, `phone`, `hours`, `url`, `hidden` (true = not drawn),
`searchable` (default true for units and POIs).

### 4.1 `org.json`

```jsonc
{
  "id": "taqwa-ltd",                       // default: folder name slug
  "name": "Taqwa Ltd", "name_bn": "…",
  "logo": "logo.png",                      // inside images/
  "theme": { "primary": "#0F766E", "accent": "#F59E0B" },   // overrides the design tokens
  "view": { "center": [90.39, 23.74], "zoom": 16.5, "pitch": 55, "bearing": -20 },
  "indoor_min_zoom": 17,                   // floor plans and the level control appear at or above this zoom
  "basemap": {
    "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],  // default; override per org
    "satellite_tiles": [],                 // optional; shown as second basemap option
    "attribution": "© OpenStreetMap contributors"
  },
  "level_height_m": 3.2,                   // default storey height
  "languages": ["en", "bn"],
  "quick_categories": ["toilet", "prayer-room", "exit", "atm", "food"]
}
```

### 4.2 Site layers

| Kind | Geometry | Properties |
|---|---|---|
| `boundary` | Polygon | `wall_height_m` (0 = no wall, default 0), `wall_thickness_m` (0.25) |
| `roads` | LineString (`width_m` ★ default 6) or Polygon | `name`, `routable` (default true) |
| `paths` | LineString | `width_m` (default 1.5, 0 = routing only, not drawn), `routable` (true) |
| `areas` | Polygon | `class` ★ garden / parking / water / plaza / sports / … (colours from theme) |
| `models` | see 4.5 | see 4.5 |

### 4.3 `building.geojson` (exactly 1 Polygon / MultiPolygon)

`id`, `name` ★ (default: folder name), `name_bn`, `short_name`, `height_m` (default: sum of
level heights), `color`, `image`, `label_priority` (0–10), `default_level` (`"G"`),
`exterior_model` (GLB fitted to the footprint, Polygon-fit mode),
`exterior_model_rotation` (0/90/180/270: which rectangle side is the front).

### 4.4 Level files

| Kind | Geometry | Properties |
|---|---|---|
| `level` | Polygon (default: building footprint) | `name`, `short_name`, `z_index`, `height_m`, `is_default`, `color` |
| units (`shops`, `offices`, …) | Polygon | `class`, `name`, `unit_number`, `color`, `image`, `hours`, `phone` |
| `corridors` | Polygon | `class` corridor / lobby / hall |
| `walls` | LineString (`thickness_m` 0.2) or Polygon | `height_m` (2.8) |
| `doors` | LineString across the opening, or Point (`width_m` 1) | `class` door / gate / emergency, `entrance` (true = building entrance), `unit` (unit id, auto-detected if missing) |
| `pois` | Point | `class` ★ (toilet, prayer-room, atm, info, exit, kiosk, first-aid, …), `name`, `icon` |
| `connectors` | Point or Polygon | `class` ★ stairs / elevator / escalator / ramp, `connector_id` ★ (the **same id on every level it serves**: that is how levels are linked), `direction` (escalator: up / down), `name` |
| `paths` | LineString | indoor routing centrelines (through corridors to doors); not drawn |
| `models` | see 4.5 | see 4.5 |

If a level has **no `walls` file**, unit outlines are drawn as walls (outline `line` layer, or
`fill-extrusion-line-width` if the pinned MapLibre version supports it — check the type
definitions before using it; fall back to `line` otherwise).

### 4.5 GLB placement (`models` files, and `exterior_model`)

`model` ★: a file in this organisation's `3d/` folder (`"stair.glb"`, `"lobby/kiosk.glb"`) or
`"shared/<file>"` from `content/_shared/models/`.

| Geometry | Mode | Extra properties |
|---|---|---|
| Point | one model at the point | `rotation` (degrees clockwise from north), `scale` (uniform, default 1) **or** `height_m` (fit height, keep proportions), `base_m` (lift above the floor) |
| MultiPoint | one model per point | same as Point |
| Polygon | **fit**: the compiler computes the polygon's minimum-area oriented rectangle and places the model at its centre, rotated to it and scaled to it | `fit`: `stretch` (default; X/Z to the rectangle, Y to `height_m` or proportional) or `contain` (keep proportions, fit inside); `rotation` 0/90/180/270 picks the front side; warn when stretched more than 15 % |
| LineString | **repeat** along the line | `spacing_m` ★, `offset_m` (side offset), `align` (default true: turn with the line), `rotation` (added) |

GLB authoring convention: **Y up, metres, front faces +Z**. The optimizer re-centres every model so
its origin is at the **bottom centre** of its bounding box, so a Point is where the object
stands. Before writing placement maths, **calibrate the three.js model axes and rotation sign**
with a generated test GLB (an arrow 1 × 2 × 3 m with coloured axes and a clear front), record
the result in `CLAUDE.md`, and write a unit test that asserts the calibration for a known placement.

---

## 5. The compiler (`scripts/compile.mjs`)

Commands:

```
npm run content:check            # validate only, exit 1 on errors (CI on every PR)
npm run content:build            # compile everything into public/generated/
ORG=taqwa-ltd npm run build      # compile + vite build for ONE organisation (own deploy)
npm run dev                      # compile, start Vite, recompile the changed org/building on save
```

Steps:

1. **Discover** organisations, site layers, buildings, levels and files (rules in section 3).
2. **Read and normalise**: flatten `MultiPolygon` / `MultiLineString` where needed, parse
   numeric strings, drop `null` properties, round coordinates to 7 decimals, close rings, remove
   duplicate vertices. Assign each feature a stable `uid`: `<org>/<building>/<level>/<kind>/<id>`
   (fallback `#<index>` plus a warning for searchable features without `id`).
3. **Validate** (section 5.1). Errors fail the build. Warnings print one grouped report per
   file with feature ids and are written to `public/generated/<org>/report.json`. A debug panel
   in the app shows that report.
4. **Geometry preparation**: wall lines → polygons with thickness (port `wallLineToPolygon`),
   door openings cut out of line walls (port `cutLineGaps`), roads and paths buffered to their
   `width_m` (flat caps), label points by pole of inaccessibility (`polylabel`) for units,
   buildings and areas, and building shell heights.
5. **Models**: optimise (section 6), read each model's bounding box, and resolve every
   placement to `{ lngLat, model_url, yawDeg, scaleXYZ, baseM }` (three.js placement terms —
   calibrated to the Y-up/+Z-front convention). Unknown or missing GLB = error naming the
   feature. Check file names **case-sensitively**.
6. **Images**: resize with `sharp` to max 1600 px (cards) and 256 px (badges and thumbnails),
   JPEG/WebP with content-hashed names. A missing or wrong-case image is a warning, and the card
   shows a placeholder.
7. **Routing graph** (section 9).
8. **Search index** per organisation (section 8.4).
9. **Write outputs** with content-hashed file names (immutable caching), referenced from
   `org.json`:

```
public/generated/
├── index.json                         # organisations: id, name, logo, view (for a landing page)
└── taqwa-ltd/
    ├── org.json                       # config + structures + floors + file map
    ├── site.<hash>.json               # boundary, roads, paths, areas, shells, labels, site models
    ├── levels/<building>/<level>.<hash>.json   # ONE bundle per floor: every kind, with `kind`
    ├── graph.<hash>.json              # routing graph (loaded only when directions open)
    ├── search.<hash>.json
    ├── models/<name>.<hash>.glb       # optimised models
    ├── images/<name>.<hash>.jpg
    └── report.json
```

10. **Incremental**: cache by content hash in `.cache/` (git-ignored, and cached in CI). Saving one
    file in QGIS recompiles only that building or site layer within about 1 s, and the dev
    server pushes an event so the browser re-fetches only the changed bundle.

### 5.1 Validation rules

Errors: invalid JSON or geometry; coordinates not lon/lat or far outside the organisation;
duplicate ids or uids; a level kind with the wrong geometry type; a GLB that is missing, too
heavy, or unsupported (section 6); a building without a footprint; a duplicate level `z_index` in
one building; a `connector_id` present on only one level; an unrecognised level folder name
(anything other than `G`, `L1`…`L99`, `B1`…`B9`).

Warnings: level features outside the building footprint (with a 1 m tolerance); a searchable
unit or POI without `id` or `name`; a unit without a door (the route then ends at the nearest
path point, and the UI says so); a door more than 3 m from any path; a POI or connector more than
5 m from a path; disconnected routing components; outdoor paths crossing a building footprint
other than at an entrance; a model stretched more than 15 %; images missing or in the wrong case.

---

## 6. Model pipeline (inside the compiler, reusing `optimize-models.mjs` ideas)

Three.js constraints, which the optimizer enforces:

- glTF 2.0 / GLB, **metallic-roughness only**: convert `KHR_materials_pbrSpecularGlossiness`
  (the reference repo had to do this — three.js 0.186 ignores spec-gloss silently) and warn on
  unlit materials.
- Mesh compression: `EXT_meshopt_compression` (use meshopt, same as the reference).
- WebP textures are fine for three.js — use `sharp` to convert to WebP for size. Do NOT emit
  `EXT_texture_webp` in the GLB (three.js loads it as a standard image, not via the extension).
  Resize textures to max 1024 px (2048 for `exterior_model`).
- **Animations and skins**: strip with a warning (animated characters are out of scope for v1;
  three.js supports them but the runtime does not).
- **At most ~100,000 triangles total per GLB** for instanced models (trees, kiosks, small
  objects): warn above 15,000 vertices per mesh, error above 65,536 (16-bit index limit that
  three.js enforces per mesh unless `BufferGeometry` uses 32-bit). For scale: the reference
  found that 277 trees at 130–180 k triangles each crashed to 4–5 fps; after instancing with
  LODs it went to 55 fps. Simplify heavy meshes with gltf-transform `simplify`.
- Re-centre to bottom-centre (`origin` = bottom of bounding box, horizontally centred), record
  the bounding box dimensions, write a content-hashed file to `public/generated/<org>/models/`.
  The original in `content/` is never modified.
- Write LOD variants to `public/generated/<org>/models/lod/<name>.lod1.glb` etc. (the reference
  optimizer has the thresholds; reuse or improve them). The runtime picks the LOD that fits the
  model's screen height in pixels. Record the LOD manifest alongside.
- Keep the original in `content/` untouched (copy first to a `backup/` that is git-ignored).

---

## 7. Runtime architecture (`src/`)

Small modules (under about 300 lines each), with pure logic separated from map code and
tested with `node --test`:

```
src/
├── main.js                 # boot: org resolution, wiring
├── state.js                # single app state + subscribe (org, focused building, active floor per building, selection, route, language)
├── url-state.js            # ?org=&b=&l=&f=&from=&to=&accessible= ↔ state (pure, tested)
├── data/loader.js          # fetch compiled bundles, LRU cache (≈8 floors), prefetch adjacent floors
├── map/map.js              # MapLibre map, OSM tiles, attribution
├── map/site-layers.js      # site source + layers (areas, roads, paths, boundary, building shells, labels)
├── map/indoor-layers.js    # one "indoor" source = the active floor bundle; layers filtered by `kind`
├── map/model-layer.js      # one three.js custom layer for ALL models: site + active floor; InstancedMesh per GLB, LODs, impostors for small objects
├── map/route-layers.js     # route casing/line per floor + floor-change markers
├── map/focus.js            # which building is focused (pure rule + map glue)
├── ui/level-control.js     # floor selector (section 8.2)
├── ui/search.js, ui/combobox.js, ui/info-card.js, ui/directions.js, ui/org-picker.js
├── ui/theme.css            # design tokens (from the style image) + org overrides
├── routing/graph.js        # load graph, A* (binary heap), accessible mode (pure, tested)
├── routing/instructions.js # legs per floor, turns, floor changes, enter/exit building (pure, tested)
└── i18n.js                 # en / bn strings, name fallback rules
```

**`map/model-layer.js`** is the replacement for `models3d.js`. Key patterns from the reference
to keep:
- ONE `THREE.WebGLRenderer` shared by the whole app (`acquireRenderer` / `releaseRenderer` pattern).
- ONE MapLibre custom layer (`"3d-models"`) drawing everything; show/hide groups by turning
  their `THREE.InstancedMesh` visible, never by adding/removing the layer.
- `InstancedMesh` per GLB part per LOD level; the instance buffer is updated incrementally.
- Impostors (pre-rendered cards) for models below ~32 px screen height — trees especially.
- Lights fixed in each model's own frame (they rotate with the model).
- Compile three.js programs at start-up (`renderer.compile` + `program.isReady()`) to avoid the
  start-up freeze the reference measured (shader compilation = ~1.5 s freeze on Intel UHD).

Loading strategy (this is what makes it scale):

1. Boot: `generated/index.json` → organisation → `org.json` (config, buildings, floors) →
   `site.json`. Nothing indoor is loaded.
2. At zoom ≥ `indoor_min_zoom`, **focus** one building: the selected building (click, search,
   route) while it is in view, else the building under the map centre, else none. Use hysteresis
   and `moveend` debounce so focus does not flicker. Hide the focused building's shell
   (filter) and show its active floor.
3. Floor switch = fetch (or take from the LRU) that floor bundle and `indoorSource.setData()`.
   Prefetch the floors directly above and below. Verify in the Network tab that GLBs are not
   downloaded again on a floor switch.
4. The routing graph and the search index load on first use (the search index may load at
   boot if small; decide by size).
5. Use one GeoJSON source per concern (site, indoor, route), `promoteId: "uid"`, and
   `feature-state` for hover and selected. Do not create a source per file or a layer per feature.

---

## 8. UI and controls

### 8.1 Visual style

The attached image shows the style I want. **Before writing UI code**, describe it in
`docs/design.md`: colour palette (hex), typography, corner radii, shadows, spacing scale, icon
style, light/dark. Wait for my confirmation, then implement it as CSS custom properties in
`ui/theme.css`. `org.json` `theme` overrides `--primary` / `--accent` and the logo. Map colours
(unit classes, areas, walls, route) come from the same tokens. If no image is attached, ask for it.

### 8.2 Level control

- Appears only when a building is focused at zoom ≥ `indoor_min_zoom`, and disappears otherwise.
- Vertical list ordered by `z_index`, **highest at the top** (L3, L2, L1, G, B1, B2).
  Button label = `short_name` (e.g. "G", "L1"), tooltip = `name` (e.g. "Ground Floor").
  Active floor is highlighted. Header = the building's short name.
- Default floor: `is_default` on the floor, else `default_level` on the building (e.g. `"G"`),
  else `z_index 0`. The last chosen floor per building is remembered for the session.
- Floors the current route uses carry a small route dot. The floor of the search target or the
  route start is selected automatically.
- Keyboard: arrow keys and Enter, `aria-pressed`, visible focus. Position: right side under the
  zoom and compass buttons; on phones, keep it clear of the bottom sheet.

### 8.3 Map interaction

- Click a unit, POI, connector or building to select it (feature-state highlight) and open the
  info card. Hover highlight only on devices with a pointer.
- Labels: units and POIs at zoom ≥ `indoor_min_zoom` + 0.5, with collision and priority by
  area and class. Building labels show a round photo badge and name (as in the old project,
  using `addImage` with a canvas badge drawn in JavaScript).
- **Bangla on map labels**: MapLibre GL JS does not do complex text shaping, so Bengali conjuncts
  render broken in symbol layers. Map symbols show English only. Bangla appears in the HTML UI
  (cards, search, directions). If Bangla map labels are required, render them as canvas images
  per label (`map.addImage`), and only for the active floor.
- Camera presets: Overview (whole site), Top-down, 3D. Compass button resets north.
  Satellite basemap toggle (if `satellite_tiles` is set in `org.json`). Dark mode.

### 8.4 Search

- One box at the top. Results grouped as Buildings / Places (units) / Facilities (POI
  classes, e.g. "Toilets · 12 on this site").
- Each result shows the class icon, name, `unit_number`, and "L1 · Admin Building".
- Normalisation: case, diacritics, Unicode NFC, Bangla digits → Latin digits, and searching
  `name`, `name_bn`, `short_name`, `unit_number`, class label and `keywords`.
- Ranking: exact > prefix > word prefix > substring, then class priority.
- Quick-category chips from `org.json`.
- Selecting a result: fly to it, focus the building, switch the floor, highlight, open the card.
- No search library unless an organisation's index exceeds about 20,000 entries; then propose
  MiniSearch.

### 8.5 Info card

Bottom sheet on phones (swipe up and down), side panel on desktop. Shows the photo, name
(en + bn), class, floor and building, `unit_number`, hours, phone, website, description, and
the buttons **Directions here** / **Start here** / **Share** (deep link).

### 8.6 Directions

- From/To fields (search, pick on map, or "You are here").
- **"You are here" comes from QR codes**: `?org=taqwa-ltd&from=<uid>` printed at entrances,
  lifts and kiosks. This is the practical indoor positioning (GPS cannot tell floors and is
  useless indoors). Provide `npm run qr -- <org>` to generate a printable QR sheet per
  POI or door with `qr_code: true`.
- Toggle **Avoid stairs** (accessible route: elevators and ramps only). Swap and Clear buttons.
- Summary: distance, time, and the number of floor changes. Steps list: turns, "Take Elevator
  E2 up to L2", "Enter New Admin Building by the Main entrance". Tapping a step moves the
  camera there and switches the floor.
- The map draws the active floor's legs and outdoor legs. Floor-change markers ("↑ L2") are
  clickable and switch the floor. A "Next floor" button appears while a route is active.
- When data is missing, say so instead of guessing (for example "No door is recorded for
  Shop 12; the route ends at the corridor in front of it").

### 8.7 Deep links

`?org=&b=&l=&f=&from=&to=&accessible=1`. State changes update the URL with `replaceState`, and
the back button restores the previous selection. Organisation resolution order: `?org=` →
single-org build → org picker (`index.json`).

---

## 9. Routing

- **Graph nodes and edges** come from outdoor `roads` + `paths` (routable) and each level's
  `paths`. The compiler nodes the network: snap endpoints within 0.5 m and split lines where they
  cross without a shared vertex (QGIS-drawn lines often do). Report dangling ends within 1 m of
  another line.
- **Links** (each inserts a node on the nearest segment):
  - door → nearest path on its level (≤ 3 m, else a warning)
  - unit → its doors (a door within 0.5 m of the unit outline, or the door's `unit`)
  - POI and connector → nearest path (≤ 5 m)
  - `entrance: true` door → nearest outdoor path (≤ 15 m)
  - connectors with the same `connector_id` on consecutive levels (by `z_index`) → vertical edges
- **Costs in seconds**: walking length / 1.3 m/s; stairs 12 s per level; escalator 10 s per
  level, one-way by `direction`; elevator 25 s wait + 4 s per level; ramp length / 1.1 m/s.
  Accessible mode removes stairs and escalators. `emergency` doors are excluded unless they are
  the only way, and then the UI warns.
- **Algorithm**: A* with a binary heap and a straight-line-time heuristic, on compact arrays
  (`nodes: [lon, lat, floorIndex]`, `edges: [a, b, cost, length, kind]`). Run it on the main
  thread. Measure it on the largest organisation; move it to a Web Worker only if a query takes
  more than 50 ms.
- **Output**: legs split by floor (`floor_id`, or `"site"` outdoors) with coordinates, and
  instructions using the ported turn detection (≥28° over 7 m, merging within 10 m).
- Test with fixtures: a route across two buildings and three floors (G → L1 → L2); the
  accessible route takes the elevator; an unreachable unit gives a clear message; graph
  components are reported.

Out of scope for v1 but keep room for it: outdoor live GPS navigation (port `compass.js` and the
off-route rule from the old project: more than 12 m away for 2.5 s = off route, reroute after
8 s; GPS needs https).

---

## 10. Scale targets and budgets (measure them, don't assume)

| Metric | Target |
|---|---|
| Organisations per deployment | 50+ (or one per deploy with `ORG=`) |
| Buildings per organisation | 500 |
| Features per floor | 10,000 |
| JS bundle (without maplibre-gl, three.js) | < 150 KB gzip |
| `org.json` + `site.json` for 100 buildings | < 500 KB gzip |
| Floor switch | < 100 ms if prefetched, < 400 ms over 4G |
| Overview frame rate | ≥ 50 fps on an Intel UHD laptop, ≥ 30 fps on a mid Android phone |
| GLB per instanced model (trees, kiosks) | < 15,000 vertices per mesh, textures ≤ 1024 px |
| Route query, largest organisation | < 50 ms |

Write `scripts/generate-stress-org.mjs`, which writes a synthetic organisation (500 buildings ×
5 floors × 2,000 features, 200 trees) to `content/_stress/` (git-ignored), and measure compile
time, bundle sizes and fps on it. If one floor bundle exceeds about 3 MB, propose a vector-tile
or PMTiles path. Do not build it before measurements show the need.

---

## 11. Lessons from the old project (do not relearn them)

1. **GitHub Pages is case-sensitive, Windows is not.** `101.JPG` worked locally and 404'd when
   deployed. The compiler matches references case-sensitively, and every runtime URL is
   segment-encoded (spaces, `#`).
2. **`.gitignore` silently dropped deployed assets** (`*.png` excluded the logo). Generated files
   are rebuilt in CI, so nothing deployable may depend on an ignored file. Add a test that
   every `content/` file referenced by data is tracked by git.
3. Use `base: "./"` so the build works under any sub-path. Git Bash rewrites `/sub/path/`
   arguments into Windows paths: use `MSYS_NO_PATHCONV=1` or PowerShell. Add
   `public/.nojekyll`.
4. QGIS exports: numbers as strings, `MultiPolygon` for simple shapes, `null` properties, `fid`
   fields, and occasionally a projected CRS. Normalise them, and never re-serialise the user's
   files.
5. **Never guess silently.** A model on a polygon without fit rules, a building without an
   entrance, or a POI far from paths gives a precise message with file and feature id, and the
   UI states the limitation.
6. Heavy GLBs dominate frame time. Instancing and LODs took the old campus from 4–5 fps
   (without) to 55 fps (with). Budget models at compile time.
7. The start-up freeze was mostly shader compilation. Compile three.js programs at boot
   (`renderer.compile` + `program.isReady()`) to move the freeze before the first user
   interaction. The reference measured: long-task time 2.6 → 1.9 s after fix.
8. **MapLibre 6.9 gotchas** (verify for the pinned version): `map.isEasing()` did not exist;
   `map.getFreeCameraOptions()` did not exist; `fill-extrusion-opacity` is per-layer not
   per-feature; `GeoJSONSource.getData()` is async. Always check type definitions.
9. Labels inside L- and U-shaped polygons need the pole of inaccessibility (`polylabel`), not
   the centroid.
10. Live data reload on save (QGIS → browser in < 1 s) made authoring fast. Keep it.
11. Headless checks: Chrome `--headless=new --remote-debugging-port` + CDP works without
    Playwright, but Playwright is fine here. Expose `window.app` (state, `setFloor`, `route`,
    `focus`) for tests. `vite preview` binds `localhost`, not `127.0.0.1`.
12. Measure performance on the low-end GPU before and after any optimisation, and report the
    numbers. Assumptions are always wrong.
13. The zoom-clamp bug: `calculateCameraOptionsFromTo` for a close camera returns zoom >
    `maxZoom`, causing `jumpTo` to move the camera far back. If close-up 3D walk mode is needed
    later, aim at a farther-away point along the same line (see `walkMode.js` in the reference).

---

## 12. Testing and verification

- `node --test`: level folder name parsing (G, L1, L2, B1, B2), slugs and kind detection,
  normalisation, CRS rejection, polygon-fit and line-repeat maths (known rectangles), wall
  strips and door gaps, graph noding and linking, connectors, accessible mode, A*,
  instructions, search normalisation (Bangla digits), URL state, focus rule, level ordering
  (G at 0, L1 at 1, B1 at −1), and case-sensitive asset checks.
- Fixture organisation `content/_example/`: 2 buildings (one G + L1 + L2 + B1, one G only),
  stairs and an elevator, an escalator, doors, an entrance, outdoor paths, 3 GLBs (one Point,
  one Polygon-fit, one Line-repeat). It is also the template I copy for a new company.
- Playwright smoke test (no token needed — MapLibre is free): load `_example`, focus a
  building, the level control appears (G / L1 / L2), switch floors, search a unit, route across
  floors with and without "Avoid stairs", take screenshots on desktop and phone viewports in
  light and dark. Look at the screenshots yourself before reporting a UI phase as done.
- `npm run verify` = `content:check` + unit tests + build.
- A CI workflow (GitHub Actions) runs verify on pull requests and deploys `main` to Pages
  with an `.cache/` cache.

---

## 13. Phases (stop at the end of each, show me results, then continue)

1. **Scaffold and schema**: repo, Vite, the `content/_example/` fixture, `docs/authoring.md`
   (the schema above in plain language, with QGIS export settings: EPSG:4326, GeoJSON, 7 decimals,
   floor naming G / L1 / L2 / B1), `CLAUDE.md`. Done when the fixture and documentation exist
   and match.
2. **Compiler and validation** (no models or graph yet). Done when `content:check` passes on the
   fixture, fails with clear messages on 5 broken copies, and unit tests pass.
3. **Map: site, shells, focus, level control, floor rendering, info card.** Done when the
   screenshots match the style and floor switching works with lazy loading (Network tab).
4. **Models**: optimizer + calibration + 4 placement modes + site trees. Done when the fixture
   models stand at the right place, size and rotation (debug overlay `?debug=models` draws the
   fit rectangles and front arrows), there is no re-download on floor switch, and fps is measured.
5. **Search + deep links + QR**. Done when every fixture unit is findable in English and Bangla
   and QR links open with "You are here".
6. **Routing + directions UI**. Done when the cross-building, multi-floor and accessible tests
   pass and the UI walk-through is captured in screenshots.
7. **Scale and polish**: stress organisation, budgets table filled with measured numbers, phone
   pass, accessibility pass (keyboard, contrast, screen-reader labels), README, deploy workflow.
8. *(Optional)* **Import the old BCSIR campus** as an organisation from the reference repo
   (`public/data/*.geojson`, building photos, building GLBs as `exterior_model`). It is a real
   86-building test of site and shell rendering (it has no indoor data — only outdoor floors).
9. *(Later)* **Per-company access control**: each company gets a URL or key that shows only
   their data. This needs a backend (an edge function or a simple proxy) to gate the compiled
   files. Design it so the compiled files themselves are unchanged — only access changes. Propose
   the architecture before building it.

Working rules: show a plan before each phase. Ask before changing a decision in section 2 or
adding a dependency. Keep commits per phase. Report failing tests with their output. Never edit
files in `content/` that I authored, except the `_example` and `_stress` organisations.

---

## 14. Out of scope for v1 (Phases 1–8)

Walk/game mode, animated characters, live indoor positioning (BLE beacons or Wi-Fi RTT),
in-browser editing, and a vector-tile pipeline (only after measurements require it).

---

## 15. Questions — answer these before starting Phase 1

1. Is the attached style image present? (If not, describe the style you want before UI work
   begins.)
2. Confirm the floor naming: **G** = ground, **L1/L2/L3** = upper floors, **B1/B2** = basements.
   Is this correct for all your organisations, or does one of them start from a different label?
3. Deploy: one site with an organisation picker (all companies visible at
   `https://yoursite.com/`), or a separate URL per company, or both?
