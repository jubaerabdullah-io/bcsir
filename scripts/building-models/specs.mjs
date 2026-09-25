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
    // The feature is a small marker: the gate is built at its real size on the
    // boundary wall next to it (see style-gate.mjs); set wall_gap_m on the feature
    // so the drawn boundary wall opens for it.
    id: 301,
    name: "Main Gate",
    file: "models/buildings/main-gate.glb",
    style: "gate"
  }
];
