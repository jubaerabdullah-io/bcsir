// Organisation picker: the first screen. One card per organisation in
// data/catalog.json (name, logo, what is mapped); choosing one opens its map.
// With more than six organisations a filter box appears.
import { escapeHTML } from "../utils/html.js";
import { publicAssetUrl } from "../core/paths.js";

const FILTER_FROM = 7;
const plural = (count, word) => `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

// Two-letter mark for an organisation without a logo ("Taqwa Fabrics" -> "TF").
export function initials(name) {
  const words = String(name ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

// What an organisation's card says is mapped ("86 buildings", "12 floors").
export function statLabels(stats = {}) {
  const labels = [];
  if (stats.buildings) labels.push(plural(stats.buildings, "building"));
  if (stats.floors) labels.push(`${plural(stats.floors, "floor")} mapped`);
  if (stats.places) labels.push(plural(stats.places, "room"));
  return labels;
}

function cardHTML(org) {
  const logo = org.logo
    ? `<img src="${escapeHTML(publicAssetUrl(`image/${org.image_folder || org.id}/${org.logo}`))}" alt="" loading="lazy" />`
    : `<span>${escapeHTML(initials(org.short_name || org.name))}</span>`;
  const stats = statLabels(org.stats);
  return `<button class="org-card" type="button" data-org="${escapeHTML(org.id)}"${org.accent ? ` style="--org-accent: ${escapeHTML(org.accent)}"` : ""}>
    <span class="org-card-logo${org.logo ? "" : " org-card-initials"}" aria-hidden="true">${logo}</span>
    <span class="org-card-text">
      <strong>${escapeHTML(org.name)}</strong>
      ${org.tagline ? `<small>${escapeHTML(org.tagline)}</small>` : ""}
      ${stats.length ? `<span class="org-card-stats">${stats.map((label) => `<span>${escapeHTML(label)}</span>`).join("")}</span>` : `<span class="org-card-stats"><span>No map data yet</span></span>`}
    </span>
    ${org.sample ? '<span class="org-card-badge">Sample data</span>' : ""}
    <svg class="org-card-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
  </button>`;
}

// Resolves with the id of the organisation the visitor chose.
export function showOrgPicker(organisations, { message = "" } = {}) {
  const picker = document.querySelector("#org-picker");
  const list = document.querySelector("#org-picker-list");
  const filter = document.querySelector("#org-picker-filter");
  const note = document.querySelector("#org-picker-message");
  const normalize = (value) => String(value ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

  function render() {
    const query = normalize(filter.value).trim();
    const shown = organisations.filter((org) => !query || normalize(`${org.name} ${org.short_name} ${org.tagline || ""}`).includes(query));
    list.innerHTML = shown.length ? shown.map(cardHTML).join("") : `<p class="org-picker-empty">No place matches “${escapeHTML(filter.value.trim())}”.</p>`;
  }

  document.querySelector("#org-picker-search").hidden = organisations.length < FILTER_FROM;
  note.textContent = message || (organisations.length ? "" : "No map has been added yet: create a folder in public/data/ for the first one.");
  note.hidden = !note.textContent;
  render();
  picker.hidden = false;
  document.documentElement.dataset.stage = "picker";
  (organisations.length < FILTER_FROM ? list.querySelector(".org-card") : filter)?.focus({ preventScroll: true });

  return new Promise((resolve) => {
    filter.addEventListener("input", render);
    filter.addEventListener("keydown", (event) => { if (event.key === "Enter") list.querySelector(".org-card")?.click(); });
    list.addEventListener("click", (event) => {
      const card = event.target.closest("[data-org]");
      if (!card) return;
      picker.classList.add("org-picker-leaving");
      list.querySelectorAll(".org-card").forEach((item) => { item.disabled = true; });
      card.classList.add("org-card-chosen");
      resolve(card.dataset.org);
    });
  });
}

// Fades the picker out once the chosen map is ready to show.
export function hideOrgPicker() {
  const picker = document.querySelector("#org-picker");
  if (!picker || picker.hidden) return;
  picker.classList.add("org-picker-gone");
  setTimeout(() => { picker.hidden = true; picker.classList.remove("org-picker-gone", "org-picker-leaving"); }, 320);
}
