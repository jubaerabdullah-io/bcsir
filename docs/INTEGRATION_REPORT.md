# BCSIR 3D map: integration report

This report records what was found in the two projects, what was built, what was
reused, and how preservation of the BCSIR data and routing was verified. For running
the app, the GeoJSON properties and the project layout, see [README.md](../README.md).

> Sections 1–9 describe the first integration. Section 10 describes the later
> update that made the visualization GeoJSON-driven, moved the data into
> `public/data/` and removed the model-manager interface and its upload API.
> Section 11 describes the interface, search and directions update and the
> removal of the duplicate data files. Section 12 describes the building photos
> taken from the original map. Section 13 covers the grass and 3D performance;
> section 14 live navigation, walk collision, the minimap, route visibility and the
> images missing on GitHub Pages.

## 1. The original BCSIR repository

The repository is a **data project**, not a web application. It contains:

| Item | Content |
|---|---|
| `BCSIRBoundary.geojson` | 1 MultiPolygon, campus boundary (281 vertices) |
| `BuildingBoundary.geojson` | 86 MultiPolygons with `id`, `name_en`, `name_bn`, `name_en_short`, `name_en_alias`, `entrance_coords`, `image_url`, `site_url`, `color`, `area`, `svg_type`, `labeling_priority`. No height attribute. |
| `ConnectedRoad.geojson` | 46 road MultiLineStrings (`road_type`, `width`, line-style fields) |
| `ConnectedRoadsDrawingVersion.geojson` | Byte-identical copy of `ConnectedRoad.geojson` (a second QGIS style layer) |
| `Pathway.geojson` | 23 pathway MultiLineStrings |
| `InternalBoundary.geojson` | 6 MultiLineStrings |
| `ConnectedRoads/v0/r2.json` | 69 MultiLineStrings = all 46 roads + all 23 pathways. This is the routing network. |
| `ShapefileFolder/Garden` | 33 polygons, WGS 84 |
| `ShapefileFolder/TreeLine` | 53 polylines with a `degree` field (tree-symbol rotation), WGS 84 |
| `SrcDriveQMapBCSIR.qgz` | QGIS project: the layers above plus an OSM basemap, EPSG:4326, categorized building colours |
| `.qto3settings` | Qgis2threejs export settings; every layer at altitude 0, no extrusion heights |
| `connection_check.js` | Node script with `buildGraph`, `dijkstra`, `isGraphConnected`, `findConnectedComponents` |
| `main_QRCode.zip` | Python script generating QR codes for `https://map-bcsir.srcdrive.com/?buildingid=<id>` |

All vector data uses CRS84 / EPSG:4326 (WGS 84 longitude/latitude). MapLibre uses
that directly, so no reprojection was needed.

### Routing as found

- **Representation.** Each MultiLineString vertex is rounded to 6 decimals and becomes a
  node key `"lon,lat"`. Consecutive vertices become bidirectional edges weighted by planar
  distance in degrees. Features that share a rounded vertex are connected there.
- **Algorithm.** Dijkstra with a linear scan over a `Set` queue.
- **Purpose.** The script checks that every pair of points of interest is connected and
  prints the graph's connected components. It is a connectivity checker, not a web
  routing feature.
- **Missing pieces.**
  - The script reads `./r2.json` and `./pois.json` next to itself. `r2.json` lives in
    `ConnectedRoads/v0/` and `pois.json` does not exist anywhere, so the script cannot
    run as shipped.
  - The web frontend behind `map-bcsir.srcdrive.com` is not in this repository.
- **Network facts.**
  - 196 nodes, 409 directed edges, 2 connected components (191 and 5 nodes).
  - The 5-node component is pathway 223.
  - Only 2 of 86 `entrance_coords` fall exactly on a network node.
  - 47 buildings have an empty `entrance_coords`.

## 2. The reference repository (indoormappingt1)

A Vite + vanilla JavaScript indoor-mall viewer ("Atlas Indoor"): MapLibre GL JS 6.9.0,
Three.js 0.186, Vite 8.3.0. Main parts:

- `map-redesign.js`: MapLibre map with worker-URL fix, desaturated OSM basemap, light, theme switch.
- `indoor-redesign.js` / `indoor-base.js`: GeoJSON loading with per-file fallback, `base_m`/`top_m`
  extrusions, body + roof extrusion layers, roof seams, corner columns, logo symbols.
- `models3d.js`: one MapLibre custom layer per GLB. It places a model at one lon/lat
  using `MercatorCoordinate`, with `base_m`, `top_m`, `size` and in-place rotation.
- `modelEditor.js`: model editor (anchors, move pad, offsets, rotation, heights, save via a Vite
  middleware). Its markup was not in `index.html`, so the editor was not active in the
  reference app. It also had pivot controls that the renderer ignores.
- `camera-controls.js`: View menu presets, compass, follow-direction, route-up.
- `walkMode.js`: first-person camera.
- `interactions-redesign.js`, `ui.js`: hover/selection feature states, search, info card,
  A/B route endpoint selection. The viewer has no route calculation.
- `builder/`: a separate floor-plan authoring app with a Python backend.
- Sample indoor data and eleven GLBs of up to 19 MB.

## 3. Integration summary

The BCSIR repository now contains a Vite web app at its root. The app reads the
original files through a Vite plugin that serves them read-only, and copies them
byte-for-byte into `dist/`. The reference viewer's architecture was transferred:

- map setup, stylesheet and page layout;
- camera presets, compass and walk mode;
- the layer pattern (body + roof extrusions, seams, corners);
- the interaction feature states, search and info card;
- GLB rendering and the model editor.

It was then adapted to campus data and extended with:

- routing on the original algorithm;
- a layer manager;
- GLB upload and removal;
- procedural 3D trees for TreeLine.

## 4. Reused components

| Reference file | BCSIR file | Change |
|---|---|---|
| `src/paths.js` | `src/paths.js` | none |
| `src/walkMode.js` | `src/walkMode.js` | none |
| `src/wall-strip.js` | `src/wall-strip.js` | none (boundary and internal walls) |
| `src/camera-controls.js` | `src/camera-controls.js` | + Isometric preset, rotate/tilt buttons |
| `src/map-redesign.js` | `src/map.js` | start view; OSM `maxzoom: 19` to avoid tile 404s |
| `src/models3d.js` | `src/models3d.js` | placement and matrix code kept. Added: shared renderer, one download per GLB, incremental sync, visibility switch, Draco/Meshopt. Removed: the per-frame repaint loop. |
| `src/modelEditor.js` | `src/modelEditor.js` | anchors, move pad, offsets, coordinates, rotation, heights, save/cancel kept. Pivot controls removed (the renderer ignores them). Added: upload, name, scale, duplicate, remove, pick on map. |
| `src/interactions-redesign.js` | `src/interactions.js` | same feature states and API, on buildings |
| `src/ui.js` | `src/ui.js` | building fields, route summary |
| `src/indoor-base.js`, `src/indoor-redesign.js` helpers | `src/geo-utils.js` | `calculateBounds`, `getFeatureCenter`, `offsetPath`, `wallLineToPolygon`, roof seams, vertical corners |
| `addIndoorLayers()` pattern | `src/bcsir-layers.js` | BCSIR layers |
| `src/surface-colors.js` pattern | `src/tree-layer.js` | custom-layer frame reused for trees |
| `src/main.js` | `src/main.js` | same start-up structure |
| `src/style.css` | `src/style.css` | copied unchanged, BCSIR rules appended |
| `index.html` | `index.html` | same controls and panels; model-editor markup written for the reference CSS classes |
| `vite.config.js` | `vite.config.js` | `optimizeDeps.exclude`, worker handling; the save middleware idea moved into the plugin |

Not transferred, with reasons:

- **Floor-plan builder and Python backend:** not relevant to campus data.
- **Shop logo rasterizing:** BCSIR has no logos.
- **Level selector:** the campus has a single ground level.
- **surface-colors roof overlay:** it would hide the selection highlight.
- **Sample indoor data and GLBs:** unrelated to BCSIR.
- **GitHub Pages workflow:** no deployment target was given.

## 5. New components

| File | Purpose |
|---|---|
| `scripts/vite-plugin-bcsir.mjs` | Read-only data serving; byte-identical copy into the build; routing virtual module; model save/upload API (dev + preview); live reload after a QGIS save; building-photo manifest |
| `scripts/lib/original-routing.mjs` | Extracts the four routing functions from `connection_check.js` verbatim |
| `src/routing/route-service.js` | Builds the graph and routes with those functions; snaps building entrances to nodes |
| `scripts/lib/shapefile-reader.mjs`, `scripts/lib/derive.mjs`, `scripts/derive-shapefiles.mjs` | Shapefile to GeoJSON with exact coordinates, plus a staleness check |
| `src/bcsir-data.js` | Loads datasets; in-memory render copies (heights, colours, labels) |
| `src/bcsir-layers.js` | MapLibre layers, layer groups, route layers |
| `src/tree-layer.js`, `src/three-shared.js` | Instanced 3D trees; one shared Three.js renderer |
| `src/layer-manager.js` | Layer visibility, building opacity and default-height sliders, legend |
| `src/model-store.js` | Model save/upload client with read-only fallback |
| `src/config.js` | QGIS colours, visual default heights, widths |
| `scripts/verify-originals.mjs`, `scripts/verify-routing.mjs`, `tests/` | Preservation and equivalence checks |

## 6. Routing preservation

- `connection_check.js` and `r2.json` are unchanged (checksums).
- The browser executes the verbatim original functions.
- Added around the algorithm, without touching it:
  - snapping a building's entrance, or its centroid, to the nearest node;
  - drawing the node path at the full-precision `r2.json` vertices;
  - a metric length for display.
- `npm run verify:routing` runs the **unmodified** script on the 65 distinct snapped
  building nodes (2,080 pairs), then compares with the web route service.
  - Connectivity matches: `false` in both.
  - Components match: 191 + 5 nodes.
  - The 186 "No path found" pairs are identical.
  - All 2,080 paths are identical to the original `dijkstra()`.

## 7. Geographic data preservation

- 22 original files are recorded in `original-files.sha256`. All are unchanged
  (`npm run verify:originals`).
- Two repository files that are not data did change:
  - `package-lock.json`: an empty placeholder, now filled by `npm install`.
  - `.gitignore`: `node_modules/` and `dist/` appended; existing lines kept.
- The built `dist/data/*` files are byte-identical to their sources.
- Tests prove that the buildings given to MapLibre have geometry identical to
  `BuildingBoundary.geojson`, and that render copies share the original geometry objects.
- The derived shapefile GeoJSON equals the shapefile coordinates and attributes exactly,
  and lies inside the `.shp` header bounding box.
- The display layers use exactly the geometry of the routing network:
  `r2.json` = `ConnectedRoad` + `Pathway`.

## 8. Test results

Environment: Windows 10, Node 24.21, Chrome 153 headless with SwiftShader
(software WebGL, so no GPU frame-rate figures).

| Suite | Result |
|---|---|
| `npm install` | 41 packages, 0 vulnerabilities |
| `npm run verify:originals` | 22/22 original files unchanged |
| `npm run verify:routing` | 9/9 checks |
| `npm test` | 11/11 tests |
| `npm run build` | success; app chunk 82 kB, MapLibre and Three.js in separate chunks |
| Browser suite on `npm run dev` | 42/42 checks |
| Browser suite on `npm run preview` (production build) | 42/42 checks |
| Static hosting of `dist/` from a sub-path, no server API | 9/9 checks: data, deep link, routing, no-path case, read-only models, no failed requests, layout, console |
| Live reload while `npm run dev` runs | 2/2: only the changed dataset reloads; the derived file regenerates byte-for-byte |

The browser suite covers:

- data loading, buildings as fill-extrusions, and geometry identity;
- clicking a building, search, and the `?buildingid` link;
- a route from building 101 to 119 (11 nodes, about 249 m);
- route visibility from 0° to 76° pitch at several bearings (measured on rendered pixels), and roads at 70°;
- the Top-down, Isometric (54.74°), rotate, tilt, zoom and reset controls, and mouse pan and rotate;
- all 11 layer toggles, opacity and height sliders;
- upload of a generated GLB and a real third-party GLB, lon/lat, altitude, scale and rotation;
- the duplicate sharing geometry, the anchor staying on its lon/lat while the camera moves, and save, reload, remove and reload again;
- walk mode enter and exit, the dark theme, and no console errors or warnings.

Two final CSS adjustments (layer-panel height, toast position above the route bar) were
made after the 42-check runs and verified by the static-hosting run on the final build.

## 9. Remaining limitations

See "Known limitations" in [README.md](../README.md).

## 10. Update: GeoJSON-driven visualization

### What changed

- **Data location.** The app now loads visualization copies from `public/data/`
  (served as `/data/…`). They are generated from the root originals by
  `npm run data:prepare` (`scripts/lib/public-data.mjs`). Each copy keeps every
  feature, its geometry (original coordinate text), ID and original attributes, and
  adds the standard properties. The routing network copy
  `public/data/ConnectedRoads/v0/r2.json` is byte-identical to the original. The
  earlier `data-derived/` folder, and the plugin code that served files from the
  repository root, were removed.
- **Property-driven rendering.** `src/visual-properties.js` reads and validates
  `base_m`, `top_m`, `thickness_m`, `color`, `fill_color` and `spacing_m` for every
  feature. `src/config.js` now only holds fallbacks. Buildings, gardens, roads,
  pathways, the drawing-version road edge and both boundary types render as MapLibre
  fill-extrusions. Roads and walls are metric strips built around the unchanged centre
  lines, and trees follow each tree line's own properties.
- **GLB models from GeoJSON.** `src/model-placements.js` collects Point, MultiPoint and
  `model_points` placements from every dataset. It loads each layer group's models the
  first time the group is visible, and `models3d.js` renders them unchanged. New files:
  `public/data/models.geojson`, `GardenModels.geojson`, `TreeLineModels.geojson`, and
  the folders `public/models/` and `public/image/`.
- **Building images.** The `image` property (PNG, JPG, JPEG, WEBP) is shown in the
  building card, with the placeholder if it fails to load.
- **Removed.**
  - The model-manager UI: the 3D button, the panel and the upload form.
  - `src/modelEditor.js`, `src/model-store.js`, and the upload/save API in the Vite plugin.
  - The `models/` folder and the model-editor CSS.
  - The renderer hooks used only by the editor (`preview3DModel`, `remember3DModelData`, status listeners).

  The GLB renderer, its placement maths, the shared GLB cache and the shared Three.js
  renderer are unchanged.
- **Interaction fix.** Click and hover used one handler per building layer, so one click
  could fire several selections. This became visible once a building was raised with
  `base_m`. There is now a single click and a single hover handler that pick the
  building under the pointer.
- **Owner edit kept.** Building 207's `color` had been changed in the root
  `BuildingBoundary.geojson` from `"r"` to `"#FF9A87"`. The edit was kept and carried
  into the copy, and the checksum baseline in `original-files.sha256` was updated with a note.
- **.gitignore.** The original rules ignore every `*.png`, `*.jpg` and `*.jpeg`, so
  `public/image/` is now excepted and building photos can be committed.

### Tests after the update

| Suite | Result |
|---|---|
| `npm install` | 0 vulnerabilities |
| `npm run verify:originals` | 22/22 originals unchanged (BuildingBoundary re-baselined as noted) |
| `npm run verify:routing` | 10/10, including the byte-identical public routing copy |
| `npm test` | 24/24 (see below) |
| All 3,655 building-to-building routes | identical to the snapshot taken before the update |
| `npm run build` | success |
| Browser suite on `npm run dev` | 35/35 |
| Browser suite on the production build | 35/35 |
| Static hosting of `dist/` | 9/9 |
| Property suite (edits real files in `public/data`, reloads, restores them byte-for-byte) | 30/30 |

The `npm test` suite covers:

- copies against the originals: geometry, IDs, attributes and coordinate text;
- property validity in every file;
- building, road and wall property handling, including measured strip widths;
- the model placement rules.

The property suite covered:

- building `base_m`/`top_m`/`color` on screen, the image on click, a missing image, and hover not opening the card;
- road thickness (8 m measured), height and colour, and a pathway;
- boundary wall thickness (1.0 m measured), and internal boundary and garden properties;
- tree `spacing_m`;
- Point, MultiPoint and `model_points` GLBs, lazy loading of the Garden group, and a single download of a GLB used by three placements;
- the model staying on its coordinate while the camera moves;
- `size`, `rotation`, `base_m` and model URL changes after reload;
- live reload without a page reload, the route unchanged by visual edits, and no unexpected console messages.

## 11. Update: modern interface, campus search, directions and basemaps (2026-09-24)

### Interface

- **Removed from the interface only:** the left layer menu and its button, the
  building opacity and height-scale sliders, the category legend (Office, Residential,
  Gate, Grounds, Other), the instruction note, the statistics line
  ("86 buildings · 46 roads · …"), the hover preview card and the bottom A → B route bar.
  Categories, heights, colours and every rendering function are unchanged; the
  statistics are still computed and exposed to the test hooks.
- **Header:** "Bangladesh Council of Scientific and Industrial Research", no subtitle; it
  wraps on small screens.
- **Building labels:** one MapLibre symbol per building with a round photo badge drawn on
  a canvas (`src/building-labels.js`) and the name. The photo comes from the `image`
  property; missing photos get a neutral icon and are never requested. Anchors moved from
  the area centroid to the pole of inaccessibility: the old centroid was outside the
  footprint for buildings 104, 126 and 230; the new anchor is inside all 86 footprints.
- **Search bar** (top centre), **Directions** panel with the **WALK** tile (top right),
  right-hand control rail with the **layers** button, and **View on Map** (bottom left).
  The layer visibility list and the dark-map switch moved into the layers panel. The
  first-person walk button shows an icon instead of the word "Walk" to avoid confusion
  with the WALK travel mode.
- **Stylesheet** rewritten as plain CSS with light tokens and a dark variant; the
  first-person walk-mode styles are kept.

### Search and data

- New files `public/data/directory/laboratories.json` (28 records) and
  `testing-services.json` (542 INARS services) with a source for every record.
  `scripts/import-inars-services.mjs` (`npm run data:services`) re-imports the official
  INARS list row by row and refuses to write if the table layout changes.
- `src/directory.js` builds one index of buildings (same fields as the old search),
  laboratories and tests, and resolves service → laboratory → building. A missing link
  yields "Location not recorded"; nothing is guessed.

### Directions

- The From / To fields, the target buttons (choose on map), swap and clear call the
  existing interaction controller. Routing, the graph and `route-service.js` are
  unchanged. The route is now red with blue and red HTML pins; buildings without a
  recorded entrance and unconnected buildings are described in the route summary.

### Basemaps

- The style holds the original OSM `context-map` layer and an Esri World Imagery layer.
  Switching changes layer visibility only; custom 3D layers, the route and the camera are
  untouched, and MapLibre shows only the visible basemap's attribution.

### Duplicate data files

- Removed from the repository root: `BCSIRBoundary.geojson`, `BuildingBoundary.geojson`,
  `ConnectedRoad.geojson`, `ConnectedRoadsDrawingVersion.geojson` (byte-identical to
  `ConnectedRoad.geojson`), `InternalBoundary.geojson`, `Pathway.geojson` and
  `ConnectedRoads/v0/r2.json` (byte-identical to the `public/data` copy). A verified zip
  of them and of the previous QGIS project is in `backup/` (ignored by git).
- Before removal, every feature's geometry text and original attributes were
  fingerprinted in `original-data-fingerprints.json`; `npm test` checks `public/data`
  against it.
- `SrcDriveQMapBCSIR.qgz`: the 12 datasource references of the six GeoJSON layers now
  point to `./public/data/`; the rest of the project XML is byte-identical. The checksum
  baseline was updated with a note. `dist/` is build output and was rebuilt.
- The scripts and tests that read the root copies now use `public/data`.

### Tests after the update

Environment: Windows 10, Node 24.21, Chrome 153 headless with SwiftShader.

| Suite | Result |
|---|---|
| `npm install` | 0 vulnerabilities |
| `npm run build` | success |
| `npm run verify:originals` | 16/16 unchanged (after the documented re-baseline) |
| `npm run verify:routing` | 9/9; 2,080/2,080 paths equal the unmodified `connection_check.js` |
| `npm test` | 42/42 (the 24 existing tests, adapted to `public/data`, plus 18 new) |
| All 3,655 building-to-building routes | identical to the snapshot taken before the update |
| Browser suite, `npm run dev` | 43/43, no console errors |
| Browser suite, production build (`vite preview`) | 43/43, no console errors |
| Layout: phone 390×844, tablet 820×1180, laptop 1280×720, dark theme | 14/14 |
| Label alignment at four bearings and zooms, live reload of the directory | 7/7 |
| Photo badges (request intercepted in the browser, files untouched) | 5/5 on dev and production |
| Static hosting of `dist/` from a sub-path | 4/4 |

The browser suite covers the removed controls, the title, label clicks, building /
laboratory / test search, test → building 102 with highlight and card, View on Map,
From / To with autocomplete, a test as destination, swap, clear, choose on map, the WALK
toggle and its style, the no-path message, the 101 → 119 route (11 nodes, 249 m), street
↔ satellite with camera, route, labels and 3D layers kept and the right attribution, the
layer list, first-person walk mode, View menu presets and the `?buildingid` link.

## 12. Update: building photos from the original map (2026-09-24)

### Where the photos are

- The BCSIR repository has never contained a photo: its `.gitignore` excludes `*.jpg`,
  `*.png` and `images`, and no commit in its history adds one.
- The original map (`https://map-bcsir.srcdrive.com`, the QR-code target) opens a popup
  when a building is clicked: the photo `/images/${image_url}`, the English or Bengali
  name, Set as Source / Set as Destination and a Details link (`site_url`).
- `image_url` is `<building id>.jpg` for all 86 buildings, identical in the original
  repository and in `public/data`. That ID is the link between photo and footprint, so
  no name matching was needed.

### What was done

- Each of the 86 `image_url` files was requested from the original map. 38 are JPEGs
  (320×240, JPEG start and end markers checked); the other 48 return 404, so the original
  map has no photo for them either. The 38 files were copied unchanged to
  `public/image/<id>.jpg`.
- No code changed. `building-images.js` already falls back to `image/<image_url>` when the
  file is in `public/image/`, and the same lookup feeds the building card and the round
  label badges.
- Building 101's `image` was changed from `public/image/topten.png` (a "Top Ten Fabrics &
  Tailors" logo; the path loaded in `npm run dev` but not in the build) to
  `/image/101.jpg`, at the owner's request. It is the only GeoJSON change.
- The original map serves one byte-identical photo as both `302.jpg` (Secondary Gate)
  and `303.jpg` (Internal Residential Gate). Both are kept as in the original map.
- New test: every `public/image/<id>.jpg` is the `image_url` of exactly one building,
  that building has the same ID, and the file is a JPEG.

### Tests after the update

| Suite | Result |
|---|---|
| `npm run verify:originals` | 16/16 unchanged |
| `npm run verify:routing` | 9/9 |
| `npm test` | 42/43: the new photo test passes. The failure was already present: `buildings take base_m, top_m and color from GeoJSON` expects `top_m` 12 for building 102, and the data has 18. |
| `npm run build` | success; app bundle byte-identical in name (`index-rKSlXxIG.js`) |
| Browser, production build and dev server | card photo correct for 86/86 buildings (38 photos, 48 placeholders); 38 label badges with photos; clicking the name label of 203, 244, 301, 112 and 101 selects that building and shows its own photo or the placeholder; hovering does not open the card; no failed requests |

## 13. Update: grass on the gardens and 3D performance (2026-09-24)

### Grass

- `public/models/grass.glb` (uploaded by the owner) is a photo-scanned lawn about 1.2 × 2.8 m
  with 300,000 triangles and a 4096² texture (27 MB). Covering the 33 Garden polygons
  (about 24,000 m²) with copies would take billions of triangles, and the scan is flat.
- Every Garden feature got `"surface_model": "/models/grass.glb", "surface_scale": 0.01`
  (the scan is in centimetres). Geometry, IDs and the original attributes are unchanged;
  both keys were added to `VISUAL_KEYS` so `data:prepare --refresh` keeps them.
- `npm run models:optimize` renders the model from straight above (texture × vertex
  colour, as its unlit material shows), crops the largest fully covered rectangle and
  makes it seamless: `public/models/lod/grass.surface.webp`, 408 × 980 px, 0.13 MB,
  0.73 × 1.75 m.
- `src/surface-layer.js` repeats the tile over the polygons at `top_m`, with a random
  mirror per repeat. The polygons leave `garden-3d` once the grass is drawn; without a
  tile they keep their flat colour. The Garden layer switch and satellite view hide it.

### Rendering and loading

| Bottleneck (before) | Change |
|---|---|
| One MapLibre custom layer and scene per tree: 277 renders, about 1,400 draw calls per frame | One layer (`3d-models`); `InstancedMesh` per GLB part and detail level; lighting still in each model's frame |
| Full-detail trees everywhere: 27 million triangles per frame (mango 130k, stylized 182k each) | Detail levels by on-screen height (400 / 150 / 60 / 32 px); impostors (views rendered in the browser at the model's on-screen size) below 32 px |
| 37.9 MB of GLBs (PNG textures, float geometry) downloaded before any tree shows | Same-geometry LOD 0 with Meshopt + WebP; coarsest level loaded first (0.95 MB for the four trees); finer levels on demand |
| Transparent leaves drawn in file order | Transparent instances sorted back to front |

All levels are fitted with the original model's bounding box (manifest), so positions
and sizes are unchanged. Each level was compared with renders of the original at the
largest size it is drawn: silhouette area within ±6 % and mean colour within 1–8/255
for mango, stylized and maple; the realistic tree's two coarsest levels cover about
20–25 % more area at the same colour. LOD 0 is identical (colour difference ≤ 1).
Impostors match the mesh they replace within 1–6/255 (maple up to 12/255 at 32 px).

### Measurements

Chrome 153 headless on the owner's Intel UHD Graphics (ANGLE D3D11), 1400 × 900,
production build, cold cache; before/after runs interleaved, medians of 3. Other
programs were busy during the runs, so single runs vary by about ±25 %.

| View | FPS before | FPS after | Draw calls | Triangles / frame |
|---|---|---|---|---|
| Campus (start view, zoom 16.7) | 3.4 | 55.2 | 1,387 → 306 | 27.2 M → 0.02 M |
| Zoomed out (15.6) | 3.3 | 52.5 | 1,317 → 198 | 27.2 M → 0.02 M |
| Mid (18.4, pitch 60) | 4.1 | 29.4 | 1,250 → 389 | 24.5 M → 0.51 M |
| Close (20.4, pitch 70) | 6.6 | 21.7 | 1,095 → 275 | 22.0 M → 2.96 M |
| Street level (21, pitch 78) | 12.3 | 23.9 | 491 → 297 | 5.4 M → 1.44 M |

MapLibre render time on the main thread per frame at the start view: 321 ms → 15 ms.

| Loading | Before | After |
|---|---|---|
| GLB data before all trees show | 37.9 MB | 1.23 MB (0.95 MB trees, grass tile, manifest) |
| All trees drawn, 20 Mbit/s, 40 ms latency (2 pairs) | 30.4 / 33.8 s | 11.5 / 13.7 s |
| Model loading window, local server (3 pairs, median) | 4.5 s | 4.1 s |
| Long tasks while loading (median) | 5.4 s, longest 1.4 s | 2.8 s, longest 0.5 s |
| JS heap after loading | 117–140 MB | 33–35 MB |
| `public/models/` deployed | 66 MB | 28 MB (all levels) |

On a local server the download is instant, so the trees take about as long as before:
decoding, shader compilation and the impostor views replace the saved transfer time.

### Tests after the update

| Suite | Result |
|---|---|
| `npm run verify:originals` | 16/16 unchanged |
| `npm run verify:routing` | 9/9 |
| `npm test` | 45/46: 3 new model tests pass; the failure is the one already present (building 102 `top_m`). |
| `npm run build` | success, no model warnings |
| Earlier browser suites, before and after builds | identical results (e2e 37/41 on both: its WALK tile and walk-mode expectations predate the current UI; photos and labels identical); the only differences are frame-rate effects (route walker further along at the same moment) |
| Live reload (dev) | tree `size`/`rotation` edit applied; Garden polygon without `surface_model` returns to its flat colour; files restored byte for byte |
| Layer switches | Garden, Tree line and satellite hide and show the grass and all models; route 101 → 119 and building selection unchanged |

During the session `BCSIRBoundary.geojson` (`color`, `top_m`) and `InternalBoundary.geojson`
(`top_m`, `thickness_m`) were edited outside this work; those edits were left as they are.

## 14. Update: live navigation, 3D walk, collision, minimap, route visibility, grass and deployed images (2026-09-25)

### Images missing on GitHub Pages (root cause)

- The original `.gitignore` ignores every `*.png` (and `*.jpg`, `*.jpeg`); only
  `public/image/` had been excepted. `public/route-walker.png` (the walking figure on
  the route) and `public/bcsir-logo.png` (header logo) were therefore never committed.
  They load locally, where the files exist, but a site built from the repository has
  neither: both return 404 and show as broken images. The broken image on the route in
  the report's screenshot is the walking figure.
- Checked by building the committed tree (`git archive HEAD`) and serving it under
  `/indoormappingt1/` with a case-sensitive server: both PNGs 404. The same check on the
  files git includes after the fix: both 200, as are all 38 building photos, with the
  relative base, with `BASE_PATH=/indoormappingt1/`, and without the trailing slash.
- Fix: `.gitignore` ends with `!public/**`. Also: public paths are URL-encoded once
  (`asset-paths.js`, used by `publicAssetUrl()`); a building photo is matched to its
  real file name ignoring capitalisation and encoding (GitHub Pages is case-sensitive,
  Windows is not); the walking figure falls back to a drawn figure and the logo to the
  favicon if a file is missing; `public/.nojekyll`; optional `BASE_PATH` for an absolute
  base. `publicAssetUrl()` and the relative base were already correct.

### New and changed files

| File | Change |
|---|---|
| `src/navigation/live-navigation.js` | New: live guidance (GPS, compass, follow camera, banner and sheet, off-route, re-route, manual position, 3D mode switch) |
| `src/navigation/route-progress.js` | New: route measurement, turns, position on the route, guidance text (pure) |
| `src/navigation/collision.js` | New: walk-mode collision with buildings and walls; indoor areas entered only through entrances (pure) |
| `src/navigation/route-detour.js` | New: drawn route geometry around buildings; node path unchanged (pure) |
| `src/navigation/compass.js`, `minimap.js`, `local-frame.js` | New: compass readings and permission; walk-mode minimap; metric helpers |
| `src/route-occlusion.js` | New: see-through buildings in front of the route |
| `src/asset-paths.js` | New: URL encoding and file-name matching for public assets (pure) |
| `src/walkMode.js` | Optional hooks: collision, start outside buildings, pose, state, manual input, route assist, `open(position, { heading })`, `getPose`/`setPose`; frame loop only while a control is held |
| `src/main.js` | Wiring; `displayRoute` (corrected geometry) drawn instead of `lastRoute`, which is kept for the test hooks |
| `src/bcsir-layers.js`, `src/interactions.js` | See-through copies of the building layers (empty until needed), clickable |
| `src/routing/route-service.js` | `routeFromPoint()` for re-routing (same original `dijkstra()`); `route()` unchanged in behaviour; corrected access legs drawn when present |
| `src/surface-layer.js`, `src/config.js` | Grass recolour and opacity (`SURFACE_APPEARANCE`); `STYLE.routeObscuringOpacity` |
| `src/route-walker.js`, `src/building-images.js`, `src/paths.js` | Image fallbacks and path handling (above); walker hidden while navigating |
| `src/directions-ui.js`, `src/camera-controls.js` | Start / 3D mode buttons; `release()` stops Follow Direction |
| `index.html`, `src/style.css` | Navigation banner, sheet, alert, minimap, route buttons; phone layouts (portrait and landscape) |
| `.gitignore`, `public/.nojekyll`, `vite.config.js` | Deployment (above) |
| `tests/navigation.test.mjs` | New: 10 tests |

### Route geometry

- Every network edge and every building's access leg was tested against the footprints
  (6,812 building-to-building routes). One network edge clips Dhaka Laboratories (126,
  4.7 m inside); 15 access legs cross a neighbouring building (up to 20 m). These are now
  drawn around the buildings; the longest detour adds 3.8 m. The node paths are the
  original algorithm's (`verify:routing` 2,080/2,080). The Water Tank (109) stands inside
  the Pilot Plant's (104) footprint, so its leg cannot avoid it; the summary says so.
- No network edge crosses the boundary or internal walls.

### Tests

Environment: Windows 10, Node 24.21, Chrome 153 headless on the owner's Intel UHD GPU.

| Suite | Result |
|---|---|
| `npm run verify:originals` | 16/16 unchanged |
| `npm run verify:routing` | 9/9; 2,080/2,080 paths equal the unmodified `connection_check.js` |
| `npm test` | 55/56: the 10 new tests pass; the failure is the one already present (building 102 `top_m`) |
| `npm run build` | success |
| Desktop browser suite (production build and dev server) | 41/41 each: 3D mode from the route, guidance banner, idle view not re-rendered, forward walk follows the route, minimap enlarge/fold, Esc back to map navigation, End; walking into IGCRT blocked with a message; a start inside a building moved out; live guidance with emulated GPS; camera follows; compass turns the map; no rendering once settled; off route after 2.5 s; re-route; arrival with the indoor note; pan pauses following, Recenter resumes; GPS refused → Set position; routes past 126 drawn around it; clearing the route restores every building; all local images 200; no GLB downloaded twice; no console errors |
| Phone suite, 390×844, 360×740 and 844×390 (touch) | 20/20 each: controls on screen and not overlapping, touch targets ≥ 44 px (pad 48 px), touch pad walks, drag turns, minimap tap, navigation sheet, interface restored |
| Existing features, HEAD vs new build | identical: deep link, card and photo, search, feature counts, routes 101 → 119 (11 nodes, 249 m) and 102 → 301, no-path case, WALK toggle, pick on map, layer switches, satellite/street, dark theme, View presets, models, 38 label photos |
| Walk smoothness, phone viewport, CPU ×4 (3 runs each) | plain walk: HEAD 16.0–20.6 fps, new 14.0–18.2 fps (within run-to-run noise; bound by map rendering); longest task HEAD 130–192 ms, new 96–106 ms. With a route in 3D mode: 14.0–15.8 fps; see-through checks cost 6–7 ms per second |
