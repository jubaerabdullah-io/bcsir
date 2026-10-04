// Start-up: the landing page, or which organisation's map to open.
//
// 0. An address that names no map (no ?org=, ?buildingid=, ?place= or ?maps) shows
//    the IndoorWay landing page (src/landing/). Its showcase opens the maps below
//    in frames; ?maps shows the organisation picker.
// 1. data/catalog.json lists the organisations (BCSIR, Taqwa Fabrics, ...).
// 2. The address may name one (?org=bcsir). Addresses made before organisations
//    existed (?buildingid=101, the printed QR codes) open the default organisation.
//    Otherwise the visitor chooses on the organisation picker.
// 3. That organisation's index (data/<org>/index.json: its dataset files, photos,
//    buildings with floors and rooms) becomes the active organisation, and only
//    then is the map (app.js) loaded, so every module reads its folders from it.
import "./styles/style.css";
import "./styles/indoor.css";
import { setActiveOrg } from "./core/org.js";
import { hideOrgPicker, showOrgPicker } from "./ui/org-picker.js";
import { fetchPublicJSON, publicAssetUrl } from "./core/paths.js";
import { PREFERENCE_KEYS, readPreference } from "./core/preferences.js";
import { opensMap, viewMode } from "./core/view-mode.js";

const $ = (selector) => document.querySelector(selector);

function fail(message, error) {
  console.error(message, error);
  $("#map-status").textContent = message;
  $("#status-chip").hidden = false;
  $(".status-dot")?.classList.add("error");
}

// Name, logo and colour of the open organisation in the page header.
function applyBranding(org) {
  document.title = org.name;
  $("#app-name").textContent = org.name;
  $("#app-sample").hidden = org.sample !== true;
  if (org.logo) $("#app-logo").src = publicAssetUrl(`image/${org.image_folder || org.id}/${org.logo}`);
  if (org.accent) document.documentElement.style.setProperty("--org-accent", org.accent);
  $("#map").setAttribute("aria-label", `Interactive 3D map of ${org.short_name || org.name}`);
  const hasRooms = org.places?.some((place) => place.kind === "unit");
  const placeholder = org.search_placeholder || (hasRooms ? "Search buildings and rooms..." : "Search buildings...");
  $("#campus-search-input").placeholder = placeholder;
  $("#campus-search-input").setAttribute("aria-label", placeholder.replace(/\.+$/, ""));
  document.querySelector('meta[name="description"]')?.setAttribute("content", `Interactive 3D map of ${org.name}: buildings, floor plans and walking directions.`);
}

async function boot() {
  if (!opensMap()) {
    document.documentElement.dataset.stage = "landing";
    const { showLanding } = await import("./landing/landing.js");
    showLanding();
    return;
  }
  const mode = viewMode();
  // The saved map theme also styles the picker.
  if (readPreference(PREFERENCE_KEYS.theme) === "dark") document.documentElement.dataset.theme = "dark";
  $("#status-chip").hidden = true;

  let organisations;
  try { ({ organisations } = await fetchPublicJSON("data/catalog.json")); }
  catch (error) { fail("The list of maps could not be loaded", error); return; }

  const params = new URLSearchParams(window.location.search);
  const known = (id) => organisations.some((org) => org.id === id);
  let id = params.get("org");
  let message = "";
  if (id && !known(id)) { message = `There is no map called “${id}”. Choose one below.`; id = null; }
  if (!id && params.has("buildingid")) id = (organisations.find((org) => org.default) || organisations[0])?.id || null;
  const single = organisations.length === 1;
  if (!id && single && !message) id = organisations[0].id;

  if (!id) {
    id = await showOrgPicker(organisations, { message });
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("org", id);
    window.history.pushState({ org: id }, "", url);
  }
  // Back from a map returns to the picker (and forward opens the map again).
  window.addEventListener("popstate", () => window.location.reload());

  $("#status-chip").hidden = false;
  let org;
  try { org = await fetchPublicJSON(`data/${id}/index.json`); }
  catch (error) { hideOrgPicker(); fail("This map could not be loaded", error); return; }
  if (org.problems?.length) console.warn(`${org.id}: check the data folder:\n  ${org.problems.join("\n  ")}`);
  setActiveOrg(org);
  if (viewMode().flat) document.documentElement.dataset.view = "2d"; // the address or the organisation asks for the flat map
  applyBranding(org);

  const change = $("#org-switch");
  change.hidden = single || mode.embed;
  change.addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.search = "?maps";
    window.location.assign(url);
  });

  document.documentElement.dataset.stage = "map";
  hideOrgPicker();
  await import("./app.js");
}

boot();
