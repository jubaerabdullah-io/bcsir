// Floor selector: the floors of the building in view, highest at the top, as on
// indoor maps (one button per floor, the shown floor highlighted). The button at
// the bottom shows the building from outside again. A caption beside the control
// names the building and the shown floor; floors a route passes carry a dot.
//
// Keyboard: Tab reaches the shown floor, the arrow keys move between floors, Enter
// or Space shows one. With more floors than fit, the list scrolls (arrow buttons).
import { escapeHTML } from "../html.js";

// onSelect(levelId) shows a floor; onExterior() shows the building from outside.
export function createFloorControl({ onSelect, onExterior }) {
  const control = document.querySelector("#floor-control");
  const caption = document.querySelector("#floor-building");
  const list = document.querySelector("#floor-list");
  const up = document.querySelector("#floor-up");
  const down = document.querySelector("#floor-down");
  const exterior = document.querySelector("#floor-exterior");
  let shown = null; // { key, levels, active }

  function updateScrollButtons() {
    const overflow = list.scrollHeight > list.clientHeight + 1;
    up.hidden = down.hidden = !overflow;
    up.disabled = list.scrollTop <= 0;
    down.disabled = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
  }
  const scrollBy = (direction) => list.scrollBy({ top: direction * list.clientHeight * 0.7, behavior: "smooth" });
  up.addEventListener("click", () => scrollBy(-1));
  down.addEventListener("click", () => scrollBy(1));
  list.addEventListener("scroll", updateScrollButtons, { passive: true });
  window.addEventListener("resize", updateScrollButtons);

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-level]");
    if (button) onSelect?.(button.dataset.level);
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const buttons = [...list.querySelectorAll("[data-level]")];
    const index = buttons.indexOf(document.activeElement);
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next) { event.preventDefault(); next.focus(); }
  });
  exterior.addEventListener("click", () => onExterior?.());
  caption.addEventListener("click", () => onExterior?.());

  // building: { key, name, shortName, sample }; levels: lowest first ({ id, short, name });
  // active: the shown floor's id, or null for the outside view; routeLevels: ids with a route dot.
  function show({ building, levels, active = null, routeLevels = new Set() }) {
    const rebuilt = !shown || shown.key !== building.key || shown.levels !== levels;
    if (rebuilt) {
      list.innerHTML = [...levels].reverse().map((level) => `<button class="floor-button" type="button" role="radio" data-level="${escapeHTML(level.id)}" title="${escapeHTML(level.name)}" aria-label="${escapeHTML(level.name)}">${escapeHTML(level.short)}<span class="floor-dot" aria-hidden="true"></span></button>`).join("");
    }
    const activeLevel = levels.find((level) => level.id === active) || null;
    list.querySelectorAll("[data-level]").forEach((button) => {
      const on = button.dataset.level === active;
      button.setAttribute("aria-checked", String(on));
      button.tabIndex = on || (!activeLevel && button === list.lastElementChild) ? 0 : -1;
      button.classList.toggle("on-route", routeLevels.has(button.dataset.level));
    });
    exterior.setAttribute("aria-pressed", String(!activeLevel));
    caption.innerHTML = `<strong>${escapeHTML(building.shortName || building.name)}</strong><span>${escapeHTML(activeLevel ? activeLevel.name : "Outside view")}${building.sample ? " · sample" : ""}</span>`;
    caption.title = activeLevel ? `${building.name}: showing ${activeLevel.name}. Click for the outside view.` : `${building.name}: choose a floor`;
    control.hidden = false;
    control.dataset.open = String(Boolean(activeLevel));
    if (rebuilt || shown.active !== active) list.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
    shown = { key: building.key, levels, active };
    updateScrollButtons();
  }

  function hide() {
    control.hidden = true;
    shown = null;
  }

  return { show, hide, shownKey: () => shown?.key ?? null };
}
