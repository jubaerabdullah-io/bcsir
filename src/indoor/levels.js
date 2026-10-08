// Floor folders and floor files of an indoor building (pure, tested with node --test).
//
// A building with floor plans is a folder inside public/data/<organisation>/:
//
//   public/data/<organisation>/<building folder>/
//     building.json            optional: { "building_id": 127, "name": "..." }
//     L01/                     one folder per floor
//       level.geojson          floor outline (Polygon) and the floor's own name
//       corridor.geojson       walkable areas (Polygon)
//       shops.geojson          rooms: any other file name is a room layer
//       walls.geojson          walls (LineString or Polygon)
//       pois.geojson           points: lift, stairs, entrance, toilet, ...
//       doors.geojson          optional: where a room opens to the corridor (Point, or
//                              a LineString across the opening: then a door is drawn)
//       furniture.geojson      optional: desks, tables, shelves, ... (Polygon), drawn only
//     L02/ ...
//
// Floor folder names: L01, L02, ... (also L1, F1, "Level 1", "1"), G / GF / L00
// for a ground floor counted as zero, B1 / B01 for basements. Floors are ordered
// by their number (`ordinal`), lowest first.

const LEVEL = /^(?:l|lv|lvl|level|f|fl|floor)?[\s_-]*0*(\d+)$/i;
const GROUND = /^(?:g|gf|ground|ground[\s_-]*floor)$/i;
const BASEMENT = /^(?:b|basement)[\s_-]*0*(\d*)$/i;

// { id, ordinal, short, name } of a floor folder, or null when the folder name is
// not a floor. `id` is the folder name; `short` is the label on the floor button.
export function parseLevelFolder(folder) {
  const text = String(folder ?? "").trim();
  if (!text) return null;
  if (GROUND.test(text)) return { id: text, ordinal: 0, short: "G", name: "Ground floor" };
  const basement = BASEMENT.exec(text);
  if (basement) {
    const number = Number(basement[1] || 1);
    return { id: text, ordinal: -number, short: `B${number}`, name: `Basement ${number}` };
  }
  const level = LEVEL.exec(text);
  if (level) {
    const number = Number(level[1]);
    if (number === 0) return { id: text, ordinal: 0, short: "G", name: "Ground floor" };
    return { id: text, ordinal: number, short: `L${number}`, name: `Level ${number}` };
  }
  return null;
}

// Lowest floor first; equal numbers keep their folder-name order.
export function sortLevels(levels) {
  return [...levels].sort((a, b) => a.ordinal - b.ordinal || String(a.id).localeCompare(String(b.id)));
}

// The floor a building opens on: the one marked is_default, else the lowest floor
// that is not a basement, else the lowest floor.
export function defaultLevel(levels) {
  const sorted = sortLevels(levels);
  return sorted.find((level) => level.is_default) || sorted.find((level) => level.ordinal >= 0) || sorted[0] || null;
}

const FILE_KINDS = [
  ["level", /^(?:level|levels|floor|outline)$/],
  ["corridor", /^(?:corridor|corridors|walkway|walkways|lobby|lobbies|hall|halls)$/],
  ["walls", /^(?:wall|walls)$/],
  ["pois", /^(?:poi|pois|point|points)$/],
  ["doors", /^(?:door|doors)$/],
  ["furniture", /^(?:furniture|furnishings?|fittings?|fixtures?)$/]
];
const SINGULAR = { shops: "shop", rooms: "room", offices: "office", units: "room", labs: "lab", laboratories: "lab", toilets: "toilet", stores: "store", halls: "hall", classes: "classroom", classrooms: "classroom" };

// { kind, unitClass } of a floor file: "level", "corridor", "walls", "pois",
// "doors" or "furniture"; every other file is a room layer ("units") whose
// features default to the class named by the file ("shops.geojson" -> "shop").
export function levelFileKind(fileName) {
  const stem = String(fileName ?? "").replace(/\.(geo)?json$/i, "").trim().toLowerCase();
  for (const [kind, pattern] of FILE_KINDS) if (pattern.test(stem)) return { kind, unitClass: null };
  return { kind: "units", unitClass: SINGULAR[stem] || stem.replace(/s$/, "") || "room" };
}

// ---- Feature classes ---------------------------------------------------------------
// The class of a room or point comes from the first of these properties that is set
// (case-insensitive), so layers drawn in QGIS with their own field names work.
const CLASS_KEYS = ["class", "type", "category", "kind", "poi_type", "amenity", "use", "usage"];
const NAME_KEYS = ["name", "name_en", "title", "label", "shop_name", "room_name", "room"];

export function firstProperty(properties, keys) {
  if (!properties) return undefined;
  const lower = new Map(Object.entries(properties).map(([key, value]) => [key.toLowerCase().trim(), value]));
  for (const key of keys) {
    const value = lower.get(key);
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

export const featureName = (properties) => {
  const value = firstProperty(properties, NAME_KEYS);
  return value === undefined ? "" : String(value).trim();
};

const slug = (value) => String(value ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");

// Ways between floors. `accessible`: usable without climbing steps.
export const CONNECTOR_CLASSES = {
  lift: { label: "Lift", accessible: true },
  stairs: { label: "Stairs", accessible: false },
  escalator: { label: "Escalator", accessible: false },
  ramp: { label: "Ramp", accessible: true }
};

const POI_ALIASES = [
  ["lift", /^(?:lift|lifts|elevator|elevators|passenger-lift|cargo-lift|service-lift)$/],
  ["stairs", /^(?:stair|stairs|staircase|stairway|stairwell|steps|fire-stair|fire-stairs|emergency-stair|emergency-stairs)$/],
  ["escalator", /^(?:escalator|escalators)$/],
  ["ramp", /^(?:ramp|ramps)$/],
  ["entrance", /^(?:entrance|entry|exit|gate|main-entrance|main-gate|main-door|entrance-exit|entry-exit)$/],
  ["toilet", /^(?:toilet|toilets|washroom|restroom|wc|bathroom|lavatory)$/],
  ["prayer", /^(?:prayer|prayer-room|namaz|namaj|mosque|masjid)$/],
  ["info", /^(?:info|information|reception|help-desk|helpdesk|front-desk)$/],
  ["food", /^(?:food|canteen|cafe|cafeteria|restaurant|dining)$/],
  ["atm", /^(?:atm|bank|booth)$/],
  ["water", /^(?:water|drinking-water)$/],
  ["first-aid", /^(?:first-aid|medical|clinic|doctor)$/],
  ["fire", /^(?:fire|fire-extinguisher|extinguisher|fire-exit|hydrant)$/],
  ["parking", /^(?:parking|car-park)$/]
];
const NAME_HINTS = [
  ["lift", /\b(?:lift|elevator)\b/i],
  ["stairs", /\bstair/i],
  ["escalator", /\bescalator/i],
  ["ramp", /\bramp\b/i],
  ["entrance", /\b(?:entrance|entry|main gate|exit)\b/i],
  ["toilet", /\b(?:toilet|washroom|restroom|wc)\b/i]
];

// Class of a point of interest: its class property, else a hint in its name
// ("Lift A", "Stair 2"), else "poi".
export function poiClass(properties) {
  const raw = slug(firstProperty(properties, CLASS_KEYS));
  if (raw) {
    for (const [name, pattern] of POI_ALIASES) if (pattern.test(raw)) return name;
    return raw;
  }
  const name = featureName(properties);
  for (const [value, pattern] of NAME_HINTS) if (pattern.test(name)) return value;
  return "poi";
}

export const isConnectorClass = (value) => Object.hasOwn(CONNECTOR_CLASSES, value);

// Class of a room: its class property, else the class of its file.
export function unitClass(properties, fallback = "room") {
  return slug(firstProperty(properties, CLASS_KEYS)) || fallback;
}

// Words shown for a class ("first-aid" -> "First aid").
export function classLabel(value) {
  const text = String(value ?? "").replace(/[-_]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

// ---- Feature identity ----------------------------------------------------------------
// A room or point is known by "<building key>/<floor folder>/<file>/<feature key>".
// The feature key is its id property when it has one, else its position in the
// file; repeated ids get "~2", "~3". The catalog (scripts/lib/catalog.mjs) and the
// map (indoor-data.js) both use these functions, so their ids agree.
const ID_KEYS = ["id", "fid", "uid", "unit_id", "room_id", "poi_id"];

export function featureKeys(features) {
  const seen = new Map();
  return (features || []).map((feature, index) => {
    const raw = firstProperty(feature?.properties, ID_KEYS) ?? feature?.id;
    const base = raw === undefined || raw === null || String(raw).trim() === "" ? `#${index + 1}` : String(raw).trim();
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base}~${count}` : base;
  });
}

export const fileStem = (fileName) => String(fileName ?? "").replace(/\.(geo)?json$/i, "");
export const placeUid = (buildingKey, levelId, fileName, key) => `${buildingKey}/${levelId}/${fileStem(fileName)}/${key}`;

// URL-safe key of a building folder ("Building-01 (Secretariat)" -> "building-01-secretariat").
export const folderKey = (folder) => slug(folder) || "building";
