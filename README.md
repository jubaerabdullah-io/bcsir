# Bangladesh Council of Scientific and Industrial Research: 3D campus map

An interactive 3D map of the BCSIR campus in Dhaka, built with **MapLibre GL JS** and
**Three.js**. Everything on the map is controlled by the GeoJSON files in
`public/data/`: building heights and colours, road and wall thickness, tree lines,
building photos and GLB models. Routes are calculated with the **original BCSIR routing
code** (`connection_check.js`) on the original road network.

The search finds buildings, laboratories, research divisions and laboratory testing
services. Selecting a test opens the building of the laboratory that offers it, and the
directions panel gives a walking route to it.

The 3D architecture is adapted from the
[indoormappingt1](https://github.com/jubaerabdullah-io/indoormappingt1) project.

---

## Run it

Requires Node.js 22.15 or newer (tested with Node 24).

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # production build in dist/
npm run preview       # serve dist/ at http://localhost:4173
npm test              # data, search, routing, labels, basemaps (node --test)
npm run verify        # originals unchanged + routing equivalence + npm test
npm run data:prepare  # create missing files in public/data (see below)
npm run data:services # re-import the official INARS testing-service list
```

Open the URL Vite prints. Do not open `index.html` directly from disk.
For phone or LAN testing use `npm run dev -- --host` (live navigation needs GPS, which
browsers give only to `https://` pages and `localhost`).

### Deploying (GitHub Pages)

`npm run build` writes `dist/`. The build uses relative URLs (`base: "./"`), so it works
at any sub-path, such as `https://<user>.github.io/indoormappingt1/`, and locally.
`BASE_PATH=/indoormappingt1/ npm run build` gives absolute URLs instead. Every file in
`public/` is published; image and model paths are URL-encoded and building photos are
matched to their real file names (GitHub Pages is case-sensitive, Windows is not).
`public/.nojekyll` stops a branch-based Pages build from dropping files.

Everything in `public/` must be committed. The original `.gitignore` ignored every
`*.png`, which kept `public/route-walker.png` (the figure on the route) and
`public/bcsir-logo.png` out of the repository: they worked locally but were missing
(404, broken images) on a site built from the repository. `.gitignore` now ends with
`!public/**`, and `npm test` checks it.

## Using the map

| Action | How |
|---|---|
| Find a building, laboratory or test | Search bar at the top (for example `Pilot Plant`, `Analytical`, `Calcium`). Arrow keys and Enter work in the list. |
| Building information | Click a building or its round label. The card shows the photo, names, height, entrance and website. |
| Test or laboratory information | Choose it in the search. The map flies to the laboratory's building, highlights it and the card shows the test (sample type, method, fee, time, laboratory, source). |
| Walking directions | **Directions** panel (top right): choose a starting point and a destination by typing, or with the target button and a click on a building. The To field also accepts tests. Swap, clear each field or **Clear route**. |
| WALK | The WALK tile turns the walking route on or off. It is on by default. |
| Directions from the card | **Start here** / **Directions to here** in the building card. |
| Return to the whole campus | **View on Map**: the folded-map button in the right-hand controls. |
| Street or satellite map | Layers button (right). Satellite shows the imagery with the building labels and the route only; the drawn buildings, roads, gardens, trees, walls and 3D models come back with Street. The same panel has the dark map switch and **Map details**, the layer visibility list. |
| Pan, rotate, tilt | Drag. Right-drag (or Ctrl + drag) rotates and tilts. Scroll zooms. |
| Zoom, rotate, tilt buttons | Right-hand controls. Rotate and tilt buttons are hidden on phones and short windows. |
| Camera presets | **View** menu: Top-down, Isometric, 3D Corner, Front, Free, Follow Direction, Route Up, North Up, Reset. Compass: north up. |
| First-person walk | **Walk** (bottom left), then click a location on the map: the camera goes down to eye height there. W/A/S/D or arrows to walk, hold Shift to move faster, mouse to look, V to switch between third- and first-person view, Esc (or **Exit** on the Walk button) to exit, or to cancel while choosing. On a computer no panel covers the view. On phones: hold the arrow buttons (bottom right), drag the view to look. Walls and buildings cannot be walked through; a circular minimap (bottom left) shows the surroundings, the route and the destination. |
| Live navigation | With a route drawn, **Start** under the route summary: follows the phone's GPS along the route, turns the map with its compass, shows the next turn and the remaining distance and time. See [Live navigation](#live-navigation-and-3d-mode). |
| 3D mode | **3D mode** under the route summary: walk the route in first-person view with the same guidance. |
| Deep link | `?buildingid=101` opens building 101 (the format used by the QR codes in `main_QRCode.zip`). |

## Building labels

Each building has one label: a round photo badge (white ring, soft shadow) with the
building name under it. Badge and name are one MapLibre symbol, so they are clicked,
placed and hidden together.

- **Photo**: the building's `image` property in `BuildingBoundary.geojson`, for example
  `"image": "/image/pilot-plant.png"` for `public/image/pilot-plant.png` (PNG, JPG, JPEG,
  WEBP). The original `image_url` attribute (for example `101.jpg`) is used when that file
  is in `public/image/`. Without a usable photo the badge shows a neutral building icon. A
  photo that is not in `public/image/` is never requested; the browser console names the
  building to fix. The same photo heads the building card opened by clicking the label or
  the building.
- **Photos from the original map**: `public/image/<id>.jpg` are the 38 building photos of
  the original BCSIR map (`https://map-bcsir.srcdrive.com/images/<image_url>`), copied
  unchanged. The original map links a photo to a building by `image_url`, which is
  `<building id>.jpg` for every building, so each photo reaches its building through that
  attribute; `npm test` checks that every `<id>.jpg` belongs to the building with that ID.
- **Position**: the point of the footprint farthest from its edges (the "pole of
  inaccessibility"), so the label is inside the building also for L- and U-shaped
  footprints. It floats just above the roof (`top_m` + 1 m) and stays on the building
  while the camera zooms, rotates and tilts. Coordinates are only read.
- **Visibility**: buildings with `labeling_priority` 8 or more show from zoom 15, all
  others from zoom 17. Higher priority is placed first, and MapLibre hides a label rather
  than let it overlap another. Labels never hide buildings or GLB models.

## Search, laboratories and testing services

The repository had no laboratory or service data. Two structured files now hold it:

| File | Content |
|---|---|
| `public/data/directory/laboratories.json` | Institutes, laboratories, research divisions and sections, each linked to a building |
| `public/data/directory/testing-services.json` | Laboratory testing services, each linked to a laboratory |

Every record comes from an official BCSIR website and names its source:

- **542 testing services** from the INARS
  [Service Charge list of Analytical Parameters](https://inars.bcsir.gov.bd/pages/static-pages/6922df91933eb65569e22ced),
  imported row by row by `npm run data:services`. Test name, sample type, method, fee and
  duration are kept exactly as published; each record keeps the list's serial number
  (`source_ref`, for example `SI 517`). The list repeats a few identical rows; the search
  shows each of them once.
- **INARS research divisions** (Organic, Inorganic and Environmental Analytical Research
  Division) from the INARS [research divisions page](https://inars.bcsir.gov.bd/pages/static-pages/6922dcee933eb65569e12cbc).
- **IFST research divisions and sections** from the [IFST website](https://ifst.bcsir.gov.bd/).

### How a test finds its building

```text
service.laboratory_id ──► laboratory.building_id ──► BuildingBoundary.geojson feature id
                          (or the parent unit's building_id, via parent_id)
```

- INARS is building **102**, "Institute of National Analytical Research & Services".
  Its `site_url` is `https://inars.bcsir.gov.bd/`, the site that publishes the service list.
- IFST is building **111**, "Institute of Food Science & Technology".
- A division without its own `building_id` uses its institute's building. The card says so.
- A service or laboratory can set its own `building_id` when it is verified to be in a
  different building; that value is then used.
- If no building is recorded along the chain, the search shows "Location not recorded",
  the map does not move, and it cannot be used as a route endpoint. Nothing is guessed.

### Adding verified records

```jsonc
// laboratories.json → "laboratories"
{ "id": "igcrt", "name": "Institute of Glass & Ceramic Research & Testing", "short_name": "IGCRT",
  "type": "institute", "parent_id": null, "building_id": 110, "source_url": "https://igcrt.bcsir.gov.bd/" }
// type: institute | laboratory | division | section

// testing-services.json → "sources" (once per source) and "services"
{ "id": "igcrt-xrd", "title": "…", "publisher": "…", "url": "https://…", "retrieved": "2026-09-24" }
{ "id": "igcrt-1", "name": "X-ray diffraction (XRD)", "sample_type": "Ceramic powder", "method": "…",
  "fee_bdt": 5000, "duration_days": 7, "laboratory_id": "igcrt", "source": "igcrt-xrd", "source_ref": "…" }
// optional: "building_id" overrides the laboratory's building; "fee_text" / "duration_text" when not a number
```

While `npm run dev` runs, saving either file reloads the search. `npm test` checks that
every record has a source, every laboratory resolves to an existing building and every
service to an existing laboratory. `npm run data:services` replaces only the INARS
records and keeps any others.

## Directions and routing

The browser runs the original functions `buildGraph()`, `dijkstra()`,
`isGraphConnected()` and `findConnectedComponents()`, extracted verbatim from the
unmodified `connection_check.js` at build time (`scripts/lib/original-routing.mjs`).
The network is `public/data/ConnectedRoads/v0/r2.json`, the original file, checked by
sha256. Visual road properties never reach the router. The directions panel, the WALK
tile and the building card only choose the endpoints; the route itself is unchanged.

- **Endpoints.** A building is routed from or to its recorded `entrance_coords`, snapped
  to the nearest network node. 47 of 86 buildings have no recorded entrance; for those the
  route uses the network node nearest to the footprint centre, and the summary says so in
  words ("No entrance is recorded for … The route ends at the nearest point of the campus
  road network, 12 m from the building centre."). The short leg between the building and
  the network is drawn dashed and is never counted as route length or added to the graph.
- **No connection.** When the network has no path, the panel shows "No walking route" and
  no line is drawn.
- **Display.** Red route line on a white casing, drawn above the 3D buildings. Blue pin at
  the start, red pin at the destination (HTML markers above the map). A small walking
  figure moves along the route from the start pin to the destination pin and repeats
  (`route-walker.js`). Walking time assumes 5 km/h.
- **Buildings in front of the route** become see-through (30 % opacity) while they hide
  it, and return to normal when the camera moves on or the route is cleared
  (`route-occlusion.js`). Only those buildings change. Because the line is drawn above
  the 3D layers, a route passing behind a building would otherwise be painted across it
  as if it went through it.
- **Drawn geometry around buildings** (`navigation/route-detour.js`). No building has
  an indoor passage, so the drawn line is led around footprints it would cross, along
  their outline at about 1 m clearance: one network edge clips a corner of Dhaka
  Laboratories (126), and 15 of the dashed access legs cross a neighbouring building.
  The node path from the original `dijkstra()` is not changed; the summary notes the
  detour and its distance includes it. The Water Tank (109) stands inside the footprint
  of the Pilot Plant (104), so its access line cannot avoid that building; the summary
  says so.

`npm run verify:routing` runs the **unmodified** `connection_check.js` and compares its
results with the web route service (connectivity, components, every "No path found"
pair and every path).

## Live navigation and 3D mode

**Start** (under the route summary) begins live guidance on the phone:

- The position comes from GPS (`navigator.geolocation`, high accuracy). The map follows
  it with the position in the lower part of the screen, turned so the phone's heading
  points up; a blue dot with a view cone marks it, and a circle shows the GPS accuracy.
  Dragging the map pauses following; **Recenter** resumes it.
- The heading comes from the compass. On iPhone the browser asks for permission when
  Start is tapped. Without a compass, when permission is refused, or while iOS reports
  it as uncalibrated, the map turns with the walking direction instead, and the sheet
  says why.
- The banner shows the next turn (a turn is a change of direction of 28° or more,
  judged over 7 m, so curved paths do not produce a turn at every vertex), its distance
  and the turn after it when close. The sheet shows the remaining time and distance.
- More than 12 m from the route (more when GPS is inaccurate) for 2.5 s: **Off route**,
  with the direction and distance back to it. After 8 s off route, the route is
  calculated again from the current position with the original algorithm.
- Missing, refused or weak GPS (±30 m or worse), or a position far from the campus: the
  alert says so and offers **Set position** (tap the map where you are), or 3D mode.
  Location needs an `https://` address (GitHub Pages is), or `localhost`.
- Arrival is at the destination's recorded entrance, or where the route reaches the
  building when no entrance is recorded.

**3D mode** (under the route summary, or on the navigation sheet) opens the first-person
walk mode on the same route: the camera starts at the route start (or at the GPS
position), facing along the route; the route stays drawn; the banner keeps giving the
next turn. Walking forward turns the view gently towards the route ahead, so holding
the forward button follows it. **Follow GPS** in the walk panel lets GPS and the
compass move the walker instead; touching the controls hands it back. Exit (or Esc)
returns to the map view; × in the banner or **End** ends navigation and restores the
previous view.

**Indoors:** no building has indoor map data (floor plans, walkable areas, entrances per
level), and GPS cannot tell floors or rooms, so guidance ends at the building and says
so. Buildings cannot be entered in walk mode. `navigation/collision.js` already accepts
indoor areas (`{ buildingId, level, walkable, entrances }`): a building with them can be
entered only through an entrance, and movement then stays on the walkable areas of the
selected level. Using them needs that data, a level selector, and an indoor positioning
source (for example Wi-Fi RTT or BLE beacons) for live guidance inside.

## Basemaps

| Basemap | Source | Attribution shown |
|---|---|---|
| Street (default) | OpenStreetMap tiles, the original desaturated `context-map` layer | © OpenStreetMap contributors |
| Satellite | Esri World Imagery | Powered by Esri, Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community |

Both raster sources are in the same MapLibre style. Switching changes which raster layer
is visible. Satellite shows the imagery alone: the drawn campus layers (buildings, roads,
pathways, boundary and internal walls, garden, trees and GLB models) are hidden while it
is active, and their switches in **Map details** are greyed out. Building labels, the
route and its pins stay. Switching back to Street restores every layer as it was. MapLibre shows the attribution of the visible basemap only. The choice is
remembered in the browser. Use of Esri World Imagery is subject to Esri's terms of use.

## Controlling the map with GeoJSON properties

Edit a file in `public/data/` (in QGIS or a text editor), save it, and reload the
page. While `npm run dev` runs, the open page reloads the changed file by itself.
For a production build, run `npm run build` again, or edit the same file in `dist/data/`.

### Properties

| Property | Meaning | Used by |
|---|---|---|
| `base_m` | Bottom elevation, metres | all layers |
| `top_m` | Top elevation, metres (must be greater than `base_m`) | all layers |
| `color` | Colour as a hex code: `"#FF0000"`, `"#f00"` | all layers |
| `thickness_m` | Physical width in metres of the road or wall built around the line | roads, pathways, boundaries |
| `fill_color` | Colour of the campus ground inside the boundary | `BCSIRBoundary` |
| `spacing_m` | Distance between trees along the line | `TreeLine` |
| `image` | Building photo URL, e.g. `"/image/abc.png"` for `public/image/abc.png` (PNG, JPG, JPEG, WEBP). Shown in the round label and the building card. | `BuildingBoundary` |
| `model` | GLB/GLTF URL, e.g. `"/models/escalators.glb"` for `public/models/escalators.glb` | any Point/MultiPoint feature |
| `size`, `scale`, `rotation` | GLB model size, base scale and rotation (see below) | model features |
| `model_points` | `[[lon, lat], …]` where to place `model` on a line or polygon feature | any feature |
| `surface_model` | GLB whose top view covers the polygon, e.g. `"/models/grass.glb"` (see below) | `Garden` |
| `surface_scale` | Metres per model unit of `surface_model` (default 1; `grass.glb` is in centimetres: `0.01`) | `Garden` |
| `labeling_priority` | Label importance (8 or more: shown from zoom 15) | `BuildingBoundary` |
| `building_model` | GLB drawn instead of the building's extrusion, fitted to its footprint and height, e.g. `"models/buildings/igcrt.glb"` (see [Realistic building models](#realistic-building-models)) | `BuildingBoundary` |
| `model_rotation` | Degrees, clockwise: 90 / 180 / 270 make another side the front; other values turn the fitted model | `BuildingBoundary` with `building_model` |
| `model_size` | Multiplier after fitting (1 = the footprint exactly, 1.1 = 10 % larger) | `BuildingBoundary` with `building_model` |
| `wall_gap_m` | Width in metres of the opening in the drawn campus wall for a gate drawn from its `building_model` (the data and walk collision keep the whole wall) | `BuildingBoundary` gates with `building_model` |

Example building:

```json
{ "type": "Feature",
  "properties": { "id": 104, "name_en": "Pilot Plant & Process Development Centre", "base_m": 0, "top_m": 15, "color": "#E5E7EB", "image": "/image/pilot-plant.png" },
  "geometry": { … unchanged … } }
```

How each layer uses them:

| File | Rendering |
|---|---|
| `BuildingBoundary.geojson` | 3D building from `base_m` to `top_m` in `color` (walls drawn slightly darker for depth). The existing `color` codes `o`, `r`, `b`, `g` still work and use the QGIS colours; a hex value replaces them. |
| `ConnectedRoad.geojson` | Road surface, `thickness_m` wide, from `base_m` to `top_m` |
| `ConnectedRoadsDrawingVersion.geojson` | The wider grey road edge underneath (the QGIS "drawing version" style) |
| `Pathway.geojson` | Pathways, like roads |
| `BCSIRBoundary.geojson` | Wall along the boundary (`thickness_m`, `base_m`, `top_m`, `color`) and ground colour `fill_color` |
| `InternalBoundary.geojson` | Walls along the internal boundary lines |
| `Garden.geojson` | Garden surface at `top_m`: covered with the top view of `surface_model` (all gardens use `grass.glb`), otherwise from `base_m` to `top_m` in `color` |
| `TreeLine.geojson` | 3D trees along each line: tree tops at `top_m`, crown `color`, one tree every `spacing_m` (not drawn while `TreeLineModels.geojson` places GLB trees) |

Missing or invalid values fall back to defaults (`src/config.js`, `LAYER_DEFAULTS`) and
the browser console lists every feature that needs fixing. `npm test` checks all files in
`public/data/` for valid values.

Roads, pathways and walls are built as 3D strips around the original centre lines.
The line geometry itself, and therefore the routing network, never changes.

### GLB models

Put the `.glb` file in `public/models/` and add a Point (one model) or MultiPoint
(one model per point) feature with a `model` property to `public/data/models.geojson`:

```json
{ "type": "Feature",
  "properties": { "name": "Escalator", "model": "/models/escalators.glb",
                  "base_m": 0.5, "top_m": 3.0, "size": 0.0, "rotation": 280 },
  "geometry": { "type": "Point", "coordinates": [90.38780, 23.74045] } }
```

- `base_m`: altitude of the model bottom (default 0).
- `top_m`: optional. If greater than `base_m`, the model is scaled so its height fits between `base_m` and `top_m`.
- `size`: extra uniform multiplier applied last. `0` or missing = 1 (no change), `2` = double, `0.5` = half. Negative values shrink: `-1` = half, `-3` = quarter.
- `scale`: base scale used when `top_m` is not set (default 1).
- `rotation`: degrees around the vertical axis, around the model's own centre.

Models for other layers go in the same way: `public/data/GardenModels.geojson` and
`public/data/TreeLineModels.geojson` are shown and hidden with the Garden and Tree line
layers. A Point or MultiPoint feature with `model` in any other data file also works.
Garden and TreeLine contain polygons and lines; to place a model on one of those
features without adding a Point, give it `model_points`. Models are never placed at
guessed positions.

`TreeLineModels.geojson` holds one Point per tree position of `TreeLine.geojson` (the
start of each line, then every `spacing_m`), each with one of the four tree GLBs in
`public/models/` chosen at random, and its own `base_m`, `top_m`, `size` and
`rotation` to edit (`line_id` is the TreeLine line it belongs to). While this file
places at least one model, the procedural trees are not drawn; empty its `features`
to bring them back.

A layer's models load the first time the layer is visible. Each GLB file is
downloaded once, however many features use it. Draco and Meshopt compressed GLBs work.

### Grass on the gardens

Every Garden polygon has `"surface_model": "/models/grass.glb", "surface_scale": 0.01`.
`grass.glb` is a photo-scanned lawn about 1.2 × 2.8 m (in centimetres, hence 0.01)
with 300,000 triangles; copies of it over the 24,000 m² of gardens would be billions
of triangles. Its look is flat, so `npm run models:optimize` renders it once from
straight above into a seamless tile (`public/models/lod/grass.surface.webp`, 0.13 MB)
and the map repeats that tile over each polygon at its real size, mirrored at random
per repeat so the pattern does not show. The polygon geometry is unchanged. Remove
`surface_model` from a feature to give it its flat `color` again; any other GLB works as
a surface the same way.

The scanned lawn is much darker than the pastel map. `SURFACE_APPEARANCE` in
`src/config.js` recolours `grass.glb`'s surface only: its light and dark blades are kept
around a pastel green (`tint`, `tintAmount`), slightly lightened, and drawn at 88 %
opacity over the campus ground. Other models and surfaces are not affected; delete the
entry for the original look.

### Optimizing models (run after adding or replacing a GLB)

```bash
npm run models:optimize
```

For each `public/models/*.glb` the script:

- keeps the uploaded file unchanged in `backup/models/source/` (`--force` rebuilds from there);
- replaces `public/models/<name>.glb` with the same geometry, Meshopt-compressed, with WebP
  textures at the original resolution (GeoJSON keeps using the same URL);
- writes lighter detail levels `public/models/lod/<name>.lod1-4.glb`: leaves and twigs are
  thinned and each kept leaf is enlarged so crowns keep their density and colour; trunks
  are simplified; textures are the matching mipmap levels;
- writes `public/models/lod/manifest.json`: the levels, the on-screen size each is used
  from, and the bounding box of the original model, with which every level is fitted, so
  positions and sizes are the same at every level;
- bakes the ground tile of every `surface_model`.

A GLB that was not optimized yet is still drawn, from its own file, without detail
levels. `npm run dev`, `npm run build` and `npm test` report GLBs that are new or were
replaced since the last run.

### Detail and visibility by zoom level and distance

All GLB models are drawn by one layer, with one draw call per model part and detail
level (not one per tree). Each model gets the level that matches its height on screen:

| On-screen height | Drawn with |
|---|---|
| 400 px and more | the full model (LOD 0) |
| 150–400 px | LOD 1 |
| 60–150 px | LOD 2 |
| 32–60 px | LOD 3 |
| under 32 px | an impostor: views of the model rendered once in the browser (8 directions × 4 heights, with the model's own lights), shown on a card facing the camera |
| under 1.5 px, beyond 3 km, outside the view, or map zoom under 14 | not drawn |

The coarsest level of each model loads first, so trees appear quickly; finer levels
download only when a model is shown large enough. The limits are in `src/config.js`
(`MODEL_VISIBILITY`) and the level sizes in `scripts/optimize-models.mjs` (`LADDER`).
Every level was compared with renders of the original model at the largest size it is
used for (same silhouette area within a few percent, mean colour difference 1–8 of 255;
the realistic tree's coarsest levels cover about 20 % more area).

Loading and drawing costs kept low (2026-09-25; same pictures, checked pixel by pixel):
- A detail level's shaders compile in the background (`KHR_parallel_shader_compile`)
  before it is drawn, including those of the impostor views; the page no longer freezes
  while they compile. A building's extrusion is hidden only once its GLB can be drawn.
- Instance data is sent to the GPU only when the drawn placements change, and
  transparent double-sided parts are drawn by a back-side and a front-side copy (in
  the order three.js uses) instead of switching shaders twice per part every frame.
- The campus boundary, road, pathway and wall strips share one map source
  (`campus-ground`): MapLibre updates every source on every camera frame.
- Building label anchors are computed once per footprint, and label badges are drawn
  on a CPU canvas (their pixels are read back once).

### Realistic building models

A building in `BuildingBoundary.geojson` with a `building_model` property is drawn from
that GLB instead of its extrusion; every other building is unchanged.

```json
"properties": { "id": 127, "name_en": "Secretariat Building", "base_m": 0, "top_m": 20.5, …,
                "building_model": "models/buildings/secretariat.glb", "model_rotation": 0, "model_size": 1 }
```

- **Fit:** the model is stretched to the footprint's rectangle (its front = the side
  nearest `entrance_coords`) and to the height `top_m - base_m`, standing on `base_m`.
  Raise `top_m` to make it taller, set `model_rotation` to turn it (90 / 180 / 270: another
  side becomes the front and the model is fitted to that side; e.g. 5: turned 5°), and
  `model_size` to enlarge it. A model fitted more than 15 % away from its own proportions
  is reported in the console (it would look stretched).
- **Models now:** IGCRT (id 110), IFST (111), the Secretariat (127), the Pilot Plant &
  Process Development Centre (two features: 104 and 112), its Water Tank (109), the
  Main Gate (301), the Bangladesh Reference Institute for Chemical Measurements (108),
  the Institute of Bioequivalence Studies & Pharmaceutical Sciences (119) and the Institute
  of Energy Research & Development (107), in `public/models/buildings/` (11–115 KB, 170–2,500 triangles, one
  material and one 1024 px WebP atlas each: one draw call per building).
- **Building the models:** `npm run models:buildings` (or `-- IGCRT 127` for some) writes
  them from `scripts/building-models/specs.mjs`: each entry names the building, the file
  and a style:
  - `screen`: the perforated screen of IGCRT and IFST, recessed ground floor, entrance,
    planter wall, courtyard;
  - `grid`: the Secretariat's fins, recessed windows, ledges with AC units, entrance
    canopy, roof structures;
  - `gallery`: PPDC's open corridor galleries, built along the footprint polygon's own
    edges, so it suits any footprint shape (L, U, courtyard). A building drawn as several
    features (PPDC: 104 + 112) gets no wall where the parts meet; edges facing the
    building's courtyard get the plainer courtyard facade;
  - `modern`: BRiCM's beige stone, teal glass panels standing proud of it, the front's
    recessed window box and arched arcade, stone towers with a glass slot and the top
    band of small windows; built along the polygon's edges. The builder prints each
    wall's facade (`front`, `stone`, `glass` or `slot`), numbered clockwise from the
    front; `facades` in the spec changes them;
  - `brick`: IBSPS's terracotta brick with a white line at every floor; per wall a
    `front` (glass curtain wall between brick piers, entrance canopy, lawn signboard),
    `bays` (deep window bays with grey ledges and hoods), `fins` (deep brick fins),
    `plaster` or `plain` facade, chosen like `modern` (`facades`), plus a concrete stair
    tower (`tower`) and stacked balconies (`balconies`) at a wall end;
  - `classic`: IERD's cream block with pilasters between the window bays, the pink
    brick-tile entrance, the wide canopy with the green signboard and the hoods at the
    roof line;
  - `tank`: an elevated concrete water tank on braced columns;
  - `gate`: the Main Gate (arch with the Bangla inscription, see-through iron gates,
    tiled wings with the emblem). Its feature is only a small marker, so the gate is
    built at its real size (27.6 m) on the campus wall line next to the marker, turned
    along the wall; `wall_gap_m` (27.6) opens the drawn wall there.
  Each model is built on its building's footprint, height and entrance, so it fits at
  100 %; rebuild it after changing those (or a quarter-turn `model_rotation`) to keep
  exact proportions.
- **Heights changed with the models (2026-09-25):** PPDC (104, 112) `top_m` 7 → 11.5 (it
  has three storeys) and the Main Gate (301) `top_m` 3.5 → 7.4 (the arch). The Water
  Tank keeps 21 m; its model is the usual design, as no photo shows it closely.
  Signboards are cut from the reference photos in `backup/models/source/` (not in git);
  without a photo, the board carries the building's names from `BuildingBoundary`. These
  models are not part of `npm run models:optimize`.
- **Residential quarters: one model for all (2026-09-26).** All residential quarters
  share one architecture (photos in `backup/models/source/residential/`), so one GLB,
  `models/buildings/residential.glb` (44 KB, 62 triangles), draws every building whose
  `building_model` names it: Residential Building 01, Residential Quarters 02–11 and the
  "Res. Quarters" blocks (ids 206–216, 219, 221–225, 239). The GLB is one bay (3.3 m) of
  one storey (3.5 m): pale yellow plaster, a veranda with a railing wall and the concrete
  jali lattice beside a green-framed window on the front, a wider window and a bathroom
  vent on the back, a slab with a green edge round every floor, a parapet on the front and
  back of the dark roof (style `residential`). It is not stretched to the footprint's
  rectangle: `BUILDING_MODELS.modules` in `src/config.js` marks it as a module, and the
  map tiles it over the footprint (`tiledModelParts` in `src/building-footprint.js`): the
  footprint is cut across its long axis where its outline steps, each strip is filled
  with bays of about 3.3 m and storeys are stacked up to `top_m` (15 m: 4 storeys, 18 m: 5,
  9 m: 2), so the stepped plans are followed. The veranda side faces the long side
  nearest south; `model_rotation: 180` puts it on the other side. To use it on another
  building, set `"building_model": "models/buildings/residential.glb"`; `model_size` is
  not used for modules. All 744 bays and storeys are one instanced draw call.
- **Your own GLB (Blender):** model the building at any scale with Y up and its front
  (entrance side) facing +Z, export it to `public/models/buildings/`, and set
  `building_model`. It is fitted like the generated ones.
- **Extrusion:** hidden only after the building's GLB has loaded (body, roof, seams,
  corners and see-through copies are filtered out); an invisible extrusion keeps it
  clickable. If a GLB cannot be loaded, that building keeps its extrusion and the console
  says `[Building 3D] Failed to load … ; using standard extrusion.`
  `BUILDING_MODELS.enabled = false` in `src/config.js` draws every building as an
  extrusion again.
- **Debug:** open the map with `?buildingDebug` (or run `bcsirBuildings.debug(true)` in the
  console) to outline each footprint (yellow), its rectangle and front direction (cyan),
  the anchor, and the placed model box (magenta, dashed).

## Data files

`public/data/` is the only copy of each dataset. The app loads it and the QGIS project
`SrcDriveQMapBCSIR.qgz` opens its GeoJSON layers from it, so an edit saved in QGIS
reaches the map directly.

| File | Notes |
|---|---|
| `BCSIRBoundary.geojson`, `BuildingBoundary.geojson`, `ConnectedRoad.geojson`, `ConnectedRoadsDrawingVersion.geojson`, `Pathway.geojson`, `InternalBoundary.geojson` | Original BCSIR layers with their visualization properties. `ConnectedRoadsDrawingVersion` has the same lines as `ConnectedRoad` but its own width and colour (the grey road edge). |
| `ConnectedRoads/v0/r2.json` | Routing network, the original file (sha256 in `original-files.sha256`) |
| `Garden.geojson`, `TreeLine.geojson` | Converted from `ShapefileFolder/Garden` and `ShapefileFolder/TreeLine`, which remain the QGIS sources of those two layers |
| `models.geojson`, `GardenModels.geojson`, `TreeLineModels.geojson` | GLB placements |
| `directory/laboratories.json`, `directory/testing-services.json` | Laboratories and testing services (see above) |

- **Duplicates removed (2026-09-24).** The repository root held a second copy of the six
  GeoJSON layers and of `ConnectedRoads/v0/r2.json`. They were removed; a zip of them is
  in `backup/` (ignored by git), and the QGIS project was repointed to `public/data/`.
  The original geometry text and attribute values of every feature are fingerprinted in
  `original-data-fingerprints.json`; `npm test` proves `public/data/` still holds them.
- All data is WGS 84 longitude/latitude (EPSG:4326), used directly by MapLibre.
  Coordinates are kept with their original number text.
- `npm run data:prepare` creates missing model files and reports missing datasets.
  After editing a shapefile in QGIS, run `npm run data:prepare -- --refresh` to rebuild
  `Garden.geojson` and `TreeLine.geojson`; their visualization properties are kept.

## Project structure

```text
├── index.html                   app page
├── vite.config.js               Vite config (reference settings + BCSIR plugin)
├── original-files.sha256        checksums of the original BCSIR files
├── original-data-fingerprints.json  geometry/attribute fingerprints of the original layers
├── public/
│   ├── data/                    the datasets (edit these); data/directory/ = labs and tests
│   ├── models/                  GLB/GLTF files (optimized); models/lod/ = detail levels, grass tile, manifest
│   └── image/                   building photos
├── src/
│   ├── main.js                  start-up and wiring
│   ├── map.js, basemaps.js      MapLibre map; street and satellite basemaps
│   ├── config.js                dataset paths and fallback defaults
│   ├── visual-properties.js     reads and validates base_m, top_m, thickness_m, color, …
│   ├── bcsir-data.js            loads datasets, builds render copies and label points
│   ├── bcsir-layers.js          MapLibre layers (buildings, labels, route), layer groups
│   ├── building-labels.js       round photo badges for the labels
│   ├── building-images.js       building photo lookup (labels and card)
│   ├── directory.js             search index, lab/test → building mapping
│   ├── directory-data.js        loads public/data/directory/
│   ├── combobox.js              accessible autocomplete list
│   ├── search-ui.js             main search bar
│   ├── directions-ui.js         From / To panel and WALK toggle
│   ├── route-summary.js         walking time and endpoint notes
│   ├── route-walker.js          walking figure animated along the route
│   ├── route-markers.js         blue / red route pins
│   ├── basemap-control.js       Street / Satellite choice
│   ├── layer-manager.js         layers panel and visibility list
│   ├── ui.js                    building card, toast, status, theme
│   ├── interactions.js          hover/select/route endpoints/choose on map
│   ├── camera-controls.js       camera presets
│   ├── geo-utils.js             geometry helpers, label anchors
│   ├── model-placements.js, models3d.js, tree-layer.js, three-shared.js
│   ├── building-models.js, building-footprint.js  buildings drawn from GLB models
│   ├── surface-layer.js         grass (surface_model) on the Garden polygons
│   ├── route-occlusion.js       see-through buildings in front of the route
│   ├── walkMode.js, wall-strip.js, paths.js, asset-paths.js, html.js
│   ├── navigation/              live navigation (live-navigation.js), compass, turn
│   │                            guidance (route-progress.js), walk collision,
│   │                            route geometry around buildings, walk minimap
│   ├── routing/route-service.js route calculation with the original functions
│   └── style.css
├── scripts/
│   ├── import-inars-services.mjs  npm run data:services
│   ├── optimize-models.mjs        npm run models:optimize
│   ├── build-building-models.mjs  npm run models:buildings (styles and specs in building-models/)
│   ├── prepare-public-data.mjs    npm run data:prepare
│   ├── vite-plugin-bcsir.mjs      routing module, photo list, live data reload
│   ├── verify-originals.mjs       npm run verify:originals
│   ├── verify-routing.mjs         npm run verify:routing
│   └── lib/                       shapefile reader, public-data helpers, routing extractor
├── tests/                       node --test suites + GLB fixture generator
└── (original BCSIR files: QGIS project, shapefiles, connection_check.js, QR helper)
```

## Known limitations

- **Testing services come from INARS only.** IFST publishes its list as a PDF whose table
  does not extract reliably, so no IFST tests were imported; other institutes publish no
  machine-readable list. All 542 imported tests therefore lead to building 102. Add other
  laboratories' services as verified records (see above).
- **Service locations are institute-level.** Each INARS test is mapped to the INARS
  building (102). BCSIR also has a building named "Analytical Service Cell" (135), but no
  source links it to INARS, so it is not used. Set `building_id` on records once the
  sample-reception point is verified.
- **Building photos.** 38 of 86 buildings have a photo. The original map has none for the
  other 48 (112, 115, 117, 118, 120–122, 132, 133, 201, 202, 204–228, 230–233, 235–237,
  239–243), so they show the neutral icon and placeholder; add `public/image/<id>.jpg` to
  fill one in. The original map uses one identical photo for 302 (Secondary Gate) and
  303 (Internal Residential Gate); it is kept for both, although it can show at most one
  of them. Building 101's `image` now points to `/image/101.jpg` (it named
  `public/image/topten.png`, a non-BCSIR logo that still lies unused in `public/image/`).
- The road network has two disconnected parts. Pathway 223 forms a separate 5-node
  component. Buildings 305 (Residential School Gate, by its entrance), 230 and 235
  (by footprint centre) snap to it, so they have no route to the rest of the campus.
  This matches the original `connection_check.js` output. Fixing it means editing
  `r2.json` in QGIS.
- 47 of 86 buildings have no `entrance_coords`; their routes use the network node nearest
  to the footprint centre, as stated in the route summary.
- Original edge weights are planar distances in degrees; kept as is. Distances and
  walking times shown are in metres and minutes.
- `r2.json` is a merged copy of `ConnectedRoad.geojson` + `Pathway.geojson`. After road
  edits in QGIS, regenerate `r2.json` the same way, or routing keeps the old network.
- Map labels use English names (MapLibre cannot shape Bengali on the map); Bengali
  names appear in the building card and are searchable.
- Labels need `fonts.openmaptiles.org`; the basemaps need OpenStreetMap and Esri tiles.
- Where two road or pathway surfaces overlap at the same `top_m`, the overlap can
  flicker; give them slightly different heights (the defaults do).
- KTX2 (Basis) compressed textures inside GLBs are not enabled (WebP is used).
- The gardens show the grass scan's top view as a flat surface; the scan's few centimetres
  of relief are not modelled.
- Detail levels and impostors are close to, not identical with, the full models: small
  trees can look very slightly fuller or lighter. Raise the sizes in `LADDER` /
  `MODEL_VISIBILITY.impostorPixels` to trade speed for exactness.
- **Indoor navigation needs data that does not exist yet:** floor plans with walkable
  areas and entrances per level, and an indoor positioning source. Until then every
  building is solid in walk mode and guidance ends at the building.
- Walk-mode collision covers building footprints (0.5 m or taller) and the boundary and
  internal walls. Flat areas drawn 0.3 m high (research field, Spirulina Pond, play
  ground) stay walkable, as do trees and GLB models.
- GPS on campus is typically accurate to 5–15 m outdoors and much worse beside tall
  buildings; off-route warnings wait for 2.5 s and allow for the reported accuracy.
