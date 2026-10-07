// Building information card, toast, loading status, theme and zoom buttons.
// Adapted from the reference project's src/ui.js; shop fields are replaced by
// the BuildingBoundary.geojson attributes the card shows: the photo, the names
// (name_en, name_bn, name_en_short, name_en_alias), the category and site_url.
//
// The card can also show why a building was opened: a laboratory / research
// division or a testing service chosen in the search. The search box and the
// directions panel live in search-ui.js and directions-ui.js; on a wide screen
// the card hangs below whichever of them is shown. The hover preview card was
// removed (hovering only highlights the building).
import { setMapTheme, zoomBy } from "../map/map.js";
import { publicAssetUrl } from "../core/paths.js";
import { PREFERENCE_KEYS, readPreference, writePreference } from "../core/preferences.js";
import { buildingImageCandidates } from "../buildings/building-images.js";
import { formatDuration, formatFee } from "../search/directory.js";
import { kindIcon } from "../search/combobox.js";
import { escapeHTML } from "../utils/html.js";

const $ = (selector) => document.querySelector(selector);
const FALLBACK_BUILDING_IMAGE = publicAssetUrl("building-placeholder.svg");

// Reference setImage(): try candidates in order, then fall back.
function setImage(element, candidates, fallback) {
  const list = candidates.filter(Boolean);
  let index = 0;
  element.onerror = () => {
    if (index < list.length) { element.src = list[index++]; return; }
    element.onerror = null;
    element.src = fallback;
  };
  if (list.length) element.src = list[index++];
  else { element.onerror = null; element.src = fallback; }
}

export function createUI({ map, onClearSelection, onSetSource, onSetDestination }) {
  const card = $("#building-card"); const context = $("#card-context"); const toast = $("#toast"); const themeToggle = $("#theme-toggle");
  // Elements of the card and of the status chip: looked up once, written on every selection.
  const fields = {
    image: $("#building-image"), located: $("#building-located"), name: $("#building-name"), nameBn: $("#building-name-bn"),
    category: $("#building-category"), alias: $("#building-alias"), site: $("#building-site")
  };
  const sourceButton = $("#set-source"), destinationButton = $("#set-destination");
  const sourceLabel = sourceButton.querySelector(".route-label"), destinationLabel = destinationButton.querySelector(".route-label");
  const statusChip = $("#status-chip"), statusText = $("#map-status"), statusDot = $(".status-dot");
  let activeFeature = null; let activeContext = null; let pendingContext = null; let routeSelection = { source: null, destination: null }; let toastTimer;

  function applyTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#171a1c" : "#f4f7f8");
    themeToggle.setAttribute("aria-pressed", String(next === "dark"));
    setMapTheme(map, next);
    writePreference(PREFERENCE_KEYS.theme, next);
  }
  applyTheme(readPreference(PREFERENCE_KEYS.theme) || "light");
  themeToggle.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("#zoom-in").addEventListener("click", () => zoomBy(map, .8)); $("#zoom-out").addEventListener("click", () => zoomBy(map, -.8));

  // The cards start where the search box or the directions panel ends
  // (--top-area-bottom in style.css). Not while that area is off the page (navigation).
  const topArea = $(".app-top");
  if (topArea && window.ResizeObserver) {
    new ResizeObserver(() => {
      const bottom = topArea.getBoundingClientRect().bottom;
      if (bottom > 0) $("#app").style.setProperty("--top-area-bottom", `${Math.round(bottom)}px`);
    }).observe(topArea);
  }

  function currentRouteKind(feature) { const id = feature?.properties?.render_id; if (routeSelection.source?.properties?.render_id === id) return "source"; if (routeSelection.destination?.properties?.render_id === id) return "destination"; return ""; }
  function refreshActions() {
    const kind = currentRouteKind(activeFeature);
    sourceButton.classList.toggle("active-route-action", kind === "source");
    destinationButton.classList.toggle("active-route-action", kind === "destination");
    sourceButton.setAttribute("aria-pressed", String(kind === "source"));
    destinationButton.setAttribute("aria-pressed", String(kind === "destination"));
    sourceLabel.textContent = kind === "source" ? "Starting point" : "Start here";
    destinationLabel.textContent = kind === "destination" ? "Destination" : "Directions";
  }

  // Laboratory / test that led to this building (from the search).
  function renderContext(entry) {
    activeContext = entry;
    context.hidden = !entry;
    card.classList.toggle("has-context", Boolean(entry));
    if (!entry) { context.innerHTML = ""; return; }
    const facts = [];
    let kindLabel = entry.typeLabel || "Laboratory";
    let lines = [];
    let source = null;
    if (entry.kind === "test") {
      kindLabel = "Testing service";
      const service = entry.record;
      if (entry.subtitle) facts.push(["Sample", entry.subtitle]);
      if (service.method) facts.push(["Method", service.method]);
      if (formatFee(service)) facts.push(["Fee", formatFee(service)]);
      if (formatDuration(service)) facts.push(["Time", formatDuration(service)]);
      if (entry.lab) lines.push(`Offered by <strong>${escapeHTML(entry.lab.name)}${entry.lab.short_name ? ` (${escapeHTML(entry.lab.short_name)})` : ""}</strong>`);
      if (entry.source) source = { url: entry.source.url, text: `${entry.source.title}, ${service.source_ref}${entry.source.retrieved ? ` (retrieved ${entry.source.retrieved})` : ""}` };
    } else {
      const parent = entry.parents?.[0];
      if (parent) lines.push(`Part of <strong>${escapeHTML(parent.name)}${parent.short_name ? ` (${escapeHTML(parent.short_name)})` : ""}</strong>`);
      if (entry.locatedVia) lines.push(`Location: the building recorded for ${escapeHTML(entry.locatedVia.short_name || entry.locatedVia.name)}`);
      if (entry.record?.source_url) source = { url: entry.record.source_url, text: new URL(entry.record.source_url).hostname };
    }
    context.innerHTML = `<div class="context-kind">${kindIcon(entry.kind)}<span>${escapeHTML(kindLabel)}</span></div>
      <h3 class="context-title">${escapeHTML(entry.title)}</h3>
      ${facts.length ? `<dl class="context-facts">${facts.map(([label, value]) => `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join("")}</dl>` : ""}
      ${lines.map((line) => `<p class="context-line">${line}</p>`).join("")}
      ${source ? `<a class="context-source" href="${escapeHTML(source.url)}" target="_blank" rel="noopener">Source: ${escapeHTML(source.text)}</a>` : ""}`;
  }

  // Called by app.js right before a search result selects its building.
  function setPendingContext(entry) { pendingContext = entry || null; }

  function showBuilding(feature) {
    if (!feature) return;
    activeFeature = feature;
    const p = feature.properties || {};
    const entry = pendingContext && String(pendingContext.buildingId) === String(p.id) ? pendingContext : null;
    pendingContext = null;
    renderContext(entry);
    card.style.setProperty("--shop-accent", p.render_color);
    fields.located.hidden = !entry;
    fields.name.textContent = String(p.name_en || p.render_label).trim();
    fields.nameBn.textContent = p.name_bn || "";
    fields.nameBn.hidden = !p.name_bn;
    fields.category.textContent = p.render_category_label || "Building";
    const aliases = [p.name_en_short, p.name_en_alias].filter(Boolean);
    fields.alias.textContent = aliases.join(" · ");
    fields.alias.hidden = !aliases.length;
    fields.site.hidden = !p.site_url;
    if (p.site_url) { fields.site.href = p.site_url; fields.site.textContent = p.site_url.replace(/^https?:\/\//, "").replace(/\/$/, ""); }
    setImage(fields.image, buildingImageCandidates(p), FALLBACK_BUILDING_IMAGE);
    refreshActions(); card.hidden = false;
    card.scrollTop = 0;
  }
  function hideBuilding() { activeFeature = null; renderContext(null); card.hidden = true; }
  function showToast(message) { clearTimeout(toastTimer); toast.textContent = message; toast.classList.add("show"); toastTimer = setTimeout(() => toast.classList.remove("show"), 3200); }

  function updateRouteSelection(next) {
    routeSelection = next || { source: null, destination: null };
    refreshActions();
  }

  $("#building-card-close").addEventListener("click", () => onClearSelection?.());
  sourceButton.addEventListener("click", () => activeFeature && onSetSource?.(activeFeature, activeContext));
  destinationButton.addEventListener("click", () => activeFeature && onSetDestination?.(activeFeature, activeContext));

  // Loading / error status. Dataset statistics are no longer shown.
  function setStatus(message, type = "loading") {
    statusText.textContent = message;
    statusDot.classList.remove("ready", "error"); statusDot.classList.add(type);
    statusChip.hidden = false;
  }
  function hideStatus() { statusChip.hidden = true; }

  return { showBuilding, hideBuilding, showToast, setStatus, hideStatus, setPendingContext, updateRouteSelection, activeBuilding: () => activeFeature, activeContext: () => activeContext };
}
