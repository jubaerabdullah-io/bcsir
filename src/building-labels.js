// Circular photo badges for the building labels (mall-directory style).
//
// Each label is one MapLibre symbol: a round badge (the building's photo in a
// white ring with a soft shadow) and the building name under it. Because icon
// and text are one symbol, they are clicked, placed and hidden together, and
// MapLibre's collision detection keeps labels from overlapping. The symbol is
// anchored at the building's pole of inaccessibility (always inside the
// footprint) at roof height, so it stays on its building while the camera
// zooms, rotates and tilts.
//
// The photo comes from the building's "image" property (see building-images.js).
// A building without a usable photo gets a neutral building icon; a photo that
// fails to load keeps that icon, so no broken image is ever shown.
import { buildingImageCandidates, imageManifest, loadFirstImage } from "./building-images.js";

export const FALLBACK_BADGE = "bcsir-badge:none";
const PIXEL_RATIO = 2;
const SIZE = 42; // CSS px of the icon image, including room for the shadow
const DIAMETER = 30; // CSS px of the white badge
const RING = 2.5; // white ring around the photo

function badgeCanvas(draw) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE * PIXEL_RATIO;
  const ctx = canvas.getContext("2d");
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  const c = SIZE / 2;
  // White badge with a soft shadow.
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.28)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath(); ctx.arc(c, c, DIAMETER / 2, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.restore();
  // Subtle outer border.
  ctx.beginPath(); ctx.arc(c, c, DIAMETER / 2 - 0.5, 0, Math.PI * 2); ctx.strokeStyle = "rgba(15, 23, 42, 0.12)"; ctx.lineWidth = 1; ctx.stroke();
  // Photo (or icon) clipped to the inner circle.
  ctx.save();
  ctx.beginPath(); ctx.arc(c, c, DIAMETER / 2 - RING, 0, Math.PI * 2); ctx.clip();
  draw(ctx, c, DIAMETER / 2 - RING);
  ctx.restore();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function drawPhoto(image) {
  return badgeCanvas((ctx, c, r) => {
    const scale = Math.max((2 * r) / image.naturalWidth, (2 * r) / image.naturalHeight); // object-fit: cover
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    ctx.drawImage(image, c - w / 2, c - h / 2, w, h);
  });
}

// Neutral building icon for buildings without a photo.
function drawFallback() {
  return badgeCanvas((ctx, c, r) => {
    ctx.fillStyle = "#f1f5f9"; ctx.fillRect(c - r, c - r, 2 * r, 2 * r);
    ctx.fillStyle = "#64748b";
    const s = r / 17; // icon drawn on a 34 px grid
    ctx.beginPath();
    ctx.moveTo(c - 9 * s, c + 9 * s); ctx.lineTo(c - 9 * s, c - 3 * s); ctx.lineTo(c, c - 9 * s); ctx.lineTo(c + 9 * s, c - 3 * s); ctx.lineTo(c + 9 * s, c + 9 * s); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f1f5f9";
    [[-5, -2], [1.5, -2], [-5, 3], [1.5, 3]].forEach(([x, y]) => ctx.fillRect(c + x * s, c + y * s, 3.5 * s, 3 * s));
  });
}

export function createBuildingLabels(map, { onChange } = {}) {
  const resolved = new Map(); // building render_id -> icon id of its loaded photo
  let generation = 0;
  if (!map.hasImage(FALLBACK_BADGE)) map.addImage(FALLBACK_BADGE, drawFallback(), { pixelRatio: PIXEL_RATIO });

  // Icon id for a building's label (the fallback until its photo has loaded).
  const badgeFor = (properties) => resolved.get(properties?.render_id) || FALLBACK_BADGE;

  // Loads the photos of every building (each distinct photo once) and reports
  // when label icons changed so the label source can be refreshed.
  async function load(buildings) {
    const current = ++generation;
    await imageManifest;
    const byUrl = new Map();
    const next = new Map();
    await Promise.all(buildings.features.map(async (feature) => {
      const candidates = buildingImageCandidates(feature.properties);
      if (!candidates.length) return;
      const cacheKey = candidates.join("|");
      if (!byUrl.has(cacheKey)) byUrl.set(cacheKey, loadFirstImage(candidates).then((image) => {
        if (!image) return null;
        const id = `bcsir-badge:${image.src}`;
        try {
          if (!map.hasImage(id)) map.addImage(id, drawPhoto(image), { pixelRatio: PIXEL_RATIO });
          return id;
        } catch (error) {
          console.warn(`Building photo ${image.src} could not be used for the map label; showing the placeholder.`, error);
          return null;
        }
      }));
      const id = await byUrl.get(cacheKey);
      if (id) next.set(feature.properties.render_id, id);
    }));
    if (current !== generation) return;
    const changed = next.size !== resolved.size || [...next].some(([key, value]) => resolved.get(key) !== value);
    resolved.clear();
    next.forEach((value, key) => resolved.set(key, value));
    if (changed) onChange?.();
  }

  return { badgeFor, load, loadedCount: () => resolved.size };
}
