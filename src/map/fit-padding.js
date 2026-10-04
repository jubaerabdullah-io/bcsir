// Camera padding (pixels) for map.fitBounds(): it keeps what is framed clear of the
// panels around the map. Screens narrower than a phone's width have their own values.
const PHONE_WIDTH_PX = 700;

const padding = (phone, wide) => () => {
  const value = window.innerWidth < PHONE_WIDTH_PX ? phone : wide;
  return typeof value === "object" ? { ...value } : value;
};

export const FIT_PADDING = {
  // The whole site (the home view).
  site: padding(40, 90),
  // A route between buildings.
  route: padding(60, 140),
  // A route, or one of its steps, that goes through floor plans.
  indoorRoute: padding({ top: 170, bottom: 190, left: 40, right: 70 }, { top: 150, bottom: 110, left: 110, right: 160 }),
  // A building whose floor is being opened.
  building: padding({ top: 150, bottom: 150, left: 30, right: 80 }, { top: 140, bottom: 90, left: 80, right: 150 })
};
