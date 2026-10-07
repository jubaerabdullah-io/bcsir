// Where the camera puts things: padding (pixels) for map.fitBounds() and the
// offset for map.flyTo(), so that what is framed stays clear of the panels over
// the map. Screens narrower than a phone's width have their own values.
const PHONE_WIDTH_PX = 700;
const SIDES = ["top", "bottom", "left", "right"];
const GAP_PX = 30; // between a panel and what is framed beside it
const FREE_SHARE = 0.4; // of the width and of the height that padding always leaves free

const isPhone = () => window.innerWidth < PHONE_WIDTH_PX;
const sides = (value) => (typeof value === "object" ? { ...value } : { top: value, bottom: value, left: value, right: value });

// The edges of the map that panels cover, in pixels. On a wide screen the search
// box, the directions panel and the open card share a column on the left, which
// counts while the panel or a card is open. On a phone the search box or the
// directions panel is at the top and the card rises from the bottom.
export function coveredEdges() {
  const covered = { top: 0, bottom: 0, left: 0, right: 0 };
  if (typeof document === "undefined") return covered;
  const box = (selector) => {
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    return rect && rect.width && rect.height ? rect : null;
  };
  const card = box(".info-card:not([hidden])");
  if (isPhone()) {
    covered.top = box(".app-top")?.bottom || 0;
    if (card) covered.bottom = window.innerHeight - card.top;
  } else {
    covered.left = Math.max(box("#directions:not([hidden])")?.right || 0, card?.right || 0);
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

export const FIT_PADDING = {
  // The whole site (the home view).
  site: padding(40, 90),
  // A route between buildings.
  route: padding(60, 110),
  // A route, or one of its steps, that goes through floor plans. On the right are
  // the map controls and the floor selector.
  indoorRoute: padding({ top: 110, bottom: 190, left: 40, right: 70 }, { top: 110, bottom: 110, left: 110, right: 170 }),
  // A building whose floor is being opened.
  building: padding({ top: 110, bottom: 150, left: 30, right: 80 }, { top: 110, bottom: 90, left: 80, right: 170 })
};
