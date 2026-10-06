// Optional switches for a map shown inside another page. Without them the map
// opens exactly as before.
//   ?view=2d   flat map: the camera stays straight above the site, north up.
//              An organisation whose org.json says "view_mode": "2d" is always flat.
//   ?embed=1   the map is inside a frame: no "choose another place" button
import { activeOrg } from "./org.js";

export function viewMode(search = globalThis.location?.search ?? "", org = activeOrg()) {
  const params = new URLSearchParams(search);
  return { flat: params.get("view") === "2d" || org?.view_mode === "2d", embed: params.has("embed") };
}
