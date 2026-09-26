// Generated building models (npm run models:buildings).
//
// Each entry names a BuildingBoundary feature (id), the GLB it writes (a path in
// public/) and its style. The map draws a building from a GLB when the feature's
// `building_model` property names that file; the model is built on the feature's
// footprint, height (top_m - base_m), entrance and model_rotation, so rebuild it
// after changing those if the model should keep its exact proportions (the map
// stretches it to fit either way).
//
// Styles: "screen" (style-screen.mjs: IGCRT, IFST) and "grid" (style-grid.mjs:
// Secretariat). Reference photos are in backup/models/source/ (not in git).
//   sign.photo / sign.quad  signboard cut from a photo: corners TL TR BR BL in pixels
//   sign.width              signboard width in metres (screen style)
//   courtyard               { width, length } in metres (screen style)
//   floorHeight, groundHeight, bay   storey height, ground-floor height and bay width target (grid style)
//   module                  no footprint: one bay of one floor, sized by src/config.js
//                           (BUILDING_MODELS.modules), which the map tiles over every
//                           building whose building_model names the file
import { RESIDENTIAL_MODULE } from "../../src/config.js";

export const BUILDING_SPECS = [
  {
    id: 110,
    name: "IGCRT",
    file: "models/buildings/igcrt.glb",
    style: "screen",
    sign: { photo: "igcrt/photo-3.png", quad: [[338, 310], [725, 265], [721, 326], [338, 354]], width: 7 },
    courtyard: { width: 17, length: 38 }
  },
  {
    // Same architecture as IGCRT (twin building across the forecourt; satellite
    // imagery shows the same screen and courtyard). No photo of its sign: the board
    // carries the building's names from BuildingBoundary.
    id: 111,
    name: "IFST",
    file: "models/buildings/ifst.glb",
    style: "screen",
    sign: { width: 6.5 },
    courtyard: { width: 15.5, length: 38 }
  },
  {
    id: 127,
    name: "Secretariat",
    file: "models/buildings/secretariat.glb",
    style: "grid",
    sign: { photo: "secretariat/photo-1.png", quad: [[552, 522], [874, 539], [875, 567], [551, 553]] },
    floorHeight: 3.2,
    groundHeight: 4.0,
    bay: 3.9
  },
  {
    // PPDC is one courtyard building drawn as two BuildingBoundary features: 104
    // (east wing with the north and south arms) and 112 (west wing). Each part is
    // built on its own polygon; the walls between the two parts are left out.
    // The entrance with the signboard is in the middle of the south front (photo 1).
    id: 104,
    name: "PPPDC-east",
    file: "models/buildings/pppdc-east.glb",
    style: "gallery",
    entrance: [90.38534378, 23.74008485],
    roofStructure: "stair",
    floorHeight: 3.4,
    groundHeight: 3.8,
    bay: 3.0
  },
  {
    id: 112,
    name: "PPPDC-west",
    file: "models/buildings/pppdc-west.glb",
    style: "gallery",
    roofStructure: "shed",
    floorHeight: 3.4,
    groundHeight: 3.8,
    bay: 3.0
  },
  {
    // In the PPDC courtyard; no close photo of it: the usual elevated concrete tank.
    id: 109,
    name: "Water Tank",
    file: "models/buildings/water-tank.glb",
    style: "tank"
  },
  {
    // Stepped footprint (two offset blocks). Front: the long south wall at the
    // entrance, with the teal glass panel, the recessed window box and the arcade.
    id: 108,
    name: "BRICM",
    file: "models/buildings/bricm.glb",
    style: "modern",
    // As in the photo: the stone tower with the glass slot beside the front, the
    // lower glass block to its left. Wall numbers are printed by the builder.
    facades: { 1: "slot", 2: "slot", 3: "stone", 4: "glass", 5: "glass", 8: "glass" }
  },
  {
    // L-shaped footprint; the entrance (glass front with the canopy) faces west.
    id: 119,
    name: "IBSPS",
    file: "models/buildings/ibsps.glb",
    style: "brick",
    floorHeight: 3.0,
    groundHeight: 3.8,
    // From the photos: bays and the concrete stair tower on the north side (photos 10,
    // 11), the light grey wall beside the tower, fins on the stepped south side and
    // balconies at the north end of the east side (photo 13).
    facades: { 2: "plaster", 3: "plain", 5: "fins", 7: "fins", 9: "fins" },
    tower: { wall: 1, side: "left" },
    balconies: { wall: 4, side: "right" }
  },
  {
    // Long 3-storey block; the entrance (brick-tile section, canopy with the green
    // signboard, hoods at the roof line) is on the long west front.
    id: 107,
    name: "IERD",
    file: "models/buildings/ierd.glb",
    style: "classic",
    groundHeight: 3.6,
    floorHeight: 3.3,
    bay: 3.0
  },
  {
    // Two-storey prayer hall; the entrance with the forecourt canopy faces west.
    id: 203,
    name: "Central Mosque",
    file: "models/buildings/central-mosque.glb",
    style: "mosque"
  },
  {
    // All residential quarters share one architecture (photos: residential/): one
    // module used by every "Residential Quarter/Building" and "Res. Quarters" feature.
    name: "Residential",
    file: "models/buildings/residential.glb",
    style: "residential",
    module: RESIDENTIAL_MODULE
  },
  {
    // Grass football field with goals, the earth track, the low wall and the pavers at
    // the east end (photos: playground/). Its top_m (0.3 m) is the ground surfaces'
    // box; the goals and the wall stand above it at their real height.
    id: 244,
    name: "Play Ground",
    file: "models/buildings/playground.glb",
    style: "playground"
  },
  {
    // Long block with the entrance wing at its south-west corner (photos: fibre/): the
    // wing's face with the orange entrance under the canopy, the green glass curtain
    // wall beside it, cream plaster; the fountain garden in front.
    id: 113,
    name: "Fibre & Polymer",
    file: "models/buildings/fibre-polymer.glb",
    style: "fibre",
    // Wall numbers printed by the builder: the wing's west and east faces are aluminium
    // panels, the main south face beside the wing is the glass tower and plaster.
    facades: { 1: "panel", 6: "front", 7: "panel" }
  },
  {
    // Stair bay with the brick lattice strips at the entrance, the signboard on the
    // canopy cut from the photo (genomic/).
    id: 101,
    name: "Genomic",
    file: "models/buildings/genomic.glb",
    style: "genomic"
  },
  {
    // Blue window bands; the porch with the carved frieze and ornate columns and the
    // blue signboard (photo: inars/).
    id: 102,
    name: "INARS",
    file: "models/buildings/inars.glb",
    style: "inars"
  },
  {
    // The open car shed beside INARS (photo: garage/; the same white jeep as at INARS).
    id: 123,
    name: "Garage",
    file: "models/buildings/garage.glb",
    style: "garage"
  },
  {
    // BCSIR High School (photos: high-school/; style-school.mjs). The U building: pink
    // galleries round its courtyard, the cream end wall with the school's name facing
    // the Parents Shade.
    id: 230,
    name: "High School U",
    file: "models/buildings/high-school-u.glb",
    style: "school",
    part: "court",
    nameWallToward: 231,
    groundHeight: 2.9,
    bay: 3.3
  },
  {
    // The cream block with the arched verandas facing the yard (photo 2).
    id: 229,
    name: "High School",
    file: "models/buildings/high-school.glb",
    style: "school",
    part: "arcade",
    groundHeight: 3.0,
    bay: 3.4
  },
  {
    // The pink kiosk with the school's signboard in front of the U building's end wall
    // (photos 1 and 3); the sign faces the yard to the east.
    id: 231,
    name: "Parents Shade",
    file: "models/buildings/school-shade.glb",
    style: "school",
    part: "shade",
    front: 90,
    sign: { photo: "high-school/photo-3.png", quad: [[54, 307], [734, 361], [734, 444], [54, 385]] }
  },
  {
    // The feature is a small marker: the gate is built at its real size on the
    // boundary wall next to it (see style-gate.mjs); set wall_gap_m on the feature
    // so the drawn boundary wall opens for it.
    id: 301,
    name: "Main Gate",
    file: "models/buildings/main-gate.glb",
    style: "gate"
  }
];
