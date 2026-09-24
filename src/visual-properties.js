// Reads and validates the visualization properties of GeoJSON features:
//   base_m, top_m, thickness_m, color, fill_color, spacing_m
// Invalid or missing values fall back to the dataset defaults in config.js.
// Problems are collected per file and reported with one console warning, so a
// typing mistake in a GeoJSON file is easy to find without breaking the map.
import { BUILDING_CATEGORIES } from "./config.js";

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Accepts "#RGB", "#RRGGBB" (and the same without "#"). Returns "#rrggbb" or null.
export function parseColor(value) {
  if (typeof value !== "string") return null;
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split("").map((c) => c + c).join("") : match[1];
  return `#${hex.toLowerCase()}`;
}

const isMissing = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

// Numbers may arrive as numbers or numeric strings (e.g. text fields from QGIS).
export function parseNumber(value) {
  if (isMissing(value) || typeof value === "boolean") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : null;
}

export function createReport(label) {
  const issues = new Map(); // message -> feature ids
  return {
    add(featureId, message) {
      if (!issues.has(message)) issues.set(message, []);
      issues.get(message).push(featureId);
    },
    flush() {
      if (!issues.size) return [];
      const lines = [...issues].map(([message, ids]) => `  ${message} (${ids.length} feature${ids.length > 1 ? "s" : ""}: ${ids.slice(0, 8).join(", ")}${ids.length > 8 ? ", …" : ""})`);
      console.warn(`${label}: some visualization properties were invalid; defaults were used.\n${lines.join("\n")}`);
      return [...issues.keys()];
    }
  };
}

function numberProperty(properties, key, fallback, report, featureId, { positive = false } = {}) {
  const raw = properties?.[key];
  if (isMissing(raw)) return fallback;
  const value = parseNumber(raw);
  if (value === null || (positive && value <= 0)) {
    report?.add(featureId, `${key} must be a ${positive ? "positive " : ""}number, got ${JSON.stringify(raw)}`);
    return fallback;
  }
  return value;
}

function colorProperty(properties, key, fallbackColor, report, featureId, { legacyCodes = false } = {}) {
  const fallback = parseColor(fallbackColor) ?? fallbackColor;
  const raw = properties?.[key];
  if (isMissing(raw)) return fallback;
  const color = parseColor(raw);
  if (color) return color;
  if (legacyCodes && typeof raw === "string" && BUILDING_CATEGORIES[raw.trim()]) return BUILDING_CATEGORIES[raw.trim()].color;
  report?.add(featureId, `${key} must be a hex colour such as "#FF0000", got ${JSON.stringify(raw)}`);
  return fallback;
}

// Resolves every visualization value of one feature.
// `defaults` is the dataset entry of LAYER_DEFAULTS.
export function resolveVisual(properties, defaults, { report, featureId, legacyColorCodes = false } = {}) {
  const baseM = numberProperty(properties, "base_m", defaults.base_m ?? 0, report, featureId);
  const defaultHeight = (defaults.top_m ?? 0) - (defaults.base_m ?? 0);
  let topM = numberProperty(properties, "top_m", null, report, featureId);
  if (topM !== null && topM <= baseM) {
    report?.add(featureId, `top_m must be greater than base_m (base_m ${baseM}, top_m ${topM})`);
    topM = null;
  }
  if (topM === null) topM = baseM + defaultHeight;
  return {
    baseM,
    topM,
    thicknessM: numberProperty(properties, "thickness_m", defaults.thickness_m ?? 1, report, featureId, { positive: true }),
    color: colorProperty(properties, "color", defaults.color ?? "#ffffff", report, featureId, { legacyCodes: legacyColorCodes }),
    fillColor: colorProperty(properties, "fill_color", defaults.fill_color ?? defaults.color ?? "#ffffff", report, featureId),
    spacingM: numberProperty(properties, "spacing_m", defaults.spacing_m ?? 7, report, featureId, { positive: true })
  };
}
