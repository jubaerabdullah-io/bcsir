// Where the camera puts things: padding (pixels) for framing (camera-fit.js,
// map.fitBounds()) and the offset for map.flyTo(), so that what is framed fills the
// part of the map that no panel or control covers. Screens narrower than a phone's
// width have their own values.
const PHONE_WIDTH_PX = 700;
const SIDES = ["top", "bottom", "left", "right"];
const GAP_PX = 12; // between a panel and what is framed beside it
const FREE_SHARE = 0.4; // of the width and of the height that padding always leaves free
// The right-hand controls on a wide screen (the Walk button below them is left out:
// it only takes the bottom corner).
const RAIL_PARTS = [".floor-control:not([hidden])", ".layers-control", ".view-control", ".zoom-control"];

const isPhone = () => window.innerWidth < PHONE_WIDTH_PX;
const sides = (value) => (typeof value === "object" ? { ...value } : { top: value, bottom: value, left: value, right: value });

// The edges of the map that panels and controls cover, in pixels. On a wide screen
// the search box, the directions panel and the open card share a column on the
// left, which counts while the panel or a card is open, and the controls stand in
// a column on the right. On a phone the search box or the directions panel is at
// the top, the card rises from the bottom and the floor selector stands at the
// right edge below the top.
export function coveredEdges() {
  const covered = { top: 0, bottom: 0, left: 0, right: 0 };
  if (typeof document === "undefined") return covered;
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element || element.closest("[hidden]")) return null;
    const rect = element.getBoundingClientRect();
    return rect.width && rect.height ? rect : null;
  };
  const card = box(".info-card:not([hidden])");
  if (isPhone()) {
    covered.top = box(".app-top")?.bottom || 0;
    if (card) covered.bottom = window.innerHeight - card.top;
    const floors = box(".floor-control:not([hidden])");
    if (floors) covered.right = window.innerWidth - floors.left;
  } else {
    covered.left = Math.max(box("#directions:not([hidden])")?.right || 0, card?.right || 0);
    const left = Math.min(...RAIL_PARTS.map((selector) => box(selector)?.left ?? Infinity));
    if (Number.isFinite(left)) covered.right = window.innerWidth - left;
  }
  return covered;
}

// Where map.flyTo() should put its target, from the centre of the map: the middle
// of the part that no panel covers.
export function flyOffset() {
  const covered = coveredEdges();
  return [(covered.left - covered.right) / 2, (covered.top - covered.bottom) / 2];
}

// `phone` and `wide` are the least padding; a covered edge gets more.
const padding = (phone, wide) => () => {
  const result = sides(isPhone() ? phone : wide);
  const covered = coveredEdges();
  for (const side of SIDES) if (covered[side]) result[side] = Math.max(result[side], covered[side] + GAP_PX);
  // Padding that left no room would stop the camera from moving at all.
  for (const [a, b, size] of [["left", "right", window.innerWidth], ["top", "bottom", window.innerHeight]]) {
    const most = size * (1 - FREE_SHARE);
    const scale = most / (result[a] + result[b]);
    if (scale < 1) { result[a] *= scale; result[b] *= scale; }
  }
  for (const side of SIDES) result[side] = Math.round(result[side]);
  return result;
};

// The least padding is small: what covers the map is measured (coveredEdges()), so
// what is framed can fill the rest of the screen. Pins stand above their point, so
// framings with pins keep more at the top.
export const FIT_PADDING = {
  // The whole site (the home view). On a phone the controls stand in the bottom right.
  site: padding({ top: 20, bottom: 70, left: 14, right: 14 }, 60),
  // A route between buildings (pins at both ends).
  route: padding({ top: 56, bottom: 36, left: 20, right: 20 }, { top: 70, bottom: 50, left: 60, right: 50 }),
  // A route, or one of its steps, that goes through floor plans.
  indoorRoute: padding({ top: 56, bottom: 30, left: 16, right: 16 }, { top: 70, bottom: 50, left: 60, right: 50 }),
  // A building whose floor is being opened, or the selected building.
  building: padding({ top: 14, bottom: 24, left: 10, right: 10 }, { top: 40, bottom: 40, left: 40, right: 30 }),
  // A room or point (its pin stands above it).
  place: padding({ top: 56, bottom: 20, left: 14, right: 14 }, { top: 70, bottom: 40, left: 50, right: 40 })
};
