// Accessible autocomplete (ARIA combobox + listbox) shared by the main search
// bar and the From / To fields of the directions panel.
// Keyboard: ArrowDown / ArrowUp move through the results, Enter picks the
// highlighted (or first) result, Escape closes the list.
import { escapeHTML } from "./html.js";

const ICONS = {
  building: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.4c-3.9 0-7.1 3.1-7.1 7 0 5.3 7.1 12.2 7.1 12.2s7.1-6.9 7.1-12.2c0-3.9-3.2-7-7.1-7Zm0 9.6a2.6 2.6 0 1 1 0-5.2 2.6 2.6 0 0 1 0 5.2Z"/></svg>',
  lab: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8.2 3.6 3.4 2-3.9 6.7-3.4-2Z"/><path d="m10.2 8.9 2.3 1.3"/><path d="M13.6 11.4a5.2 5.2 0 0 1-1.1 8.1"/><path d="M5 20.6h14"/><path d="M8 17.6h6"/></g></svg>',
  test: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" opacity=".3" d="M7.6 14.2h8.8l2.6 4a1.5 1.5 0 0 1-1.3 2.3H6.3A1.5 1.5 0 0 1 5 18.2Z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 3.2h6M10.2 3.2v5.3l-5.3 9A2.3 2.3 0 0 0 6.9 21h10.2a2.3 2.3 0 0 0 2-3.5l-5.3-9V3.2"/></svg>'
};
export const KIND_LABELS = { building: "Building", lab: "Laboratory", test: "Test" };

export function kindIcon(kind) {
  return `<span class="result-icon result-icon-${kind}">${ICONS[kind] || ICONS.building}</span>`;
}

export function resultItemHTML(entry) {
  return `${kindIcon(entry.kind)}<span class="result-text"><strong>${escapeHTML(entry.title)}</strong>${entry.subtitle ? `<small>${escapeHTML(entry.subtitle)}</small>` : ""}<em>${escapeHTML(entry.meta)}</em></span>`;
}

let comboboxCount = 0;

export function createCombobox({ input, list, search, onSelect, onClear, emptyText = "No matches", renderItem = resultItemHTML }) {
  const listId = list.id || `combobox-list-${++comboboxCount}`;
  list.id = listId;
  list.setAttribute("role", "listbox");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");
  let items = [];
  let active = -1;

  function setOpen(open) {
    list.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
    list.closest("[data-combobox]")?.classList.toggle("combobox-open", open);
    if (!open) { active = -1; input.removeAttribute("aria-activedescendant"); }
  }

  function highlight(index) {
    const options = list.querySelectorAll('[role="option"]');
    options.forEach((option, i) => option.setAttribute("aria-selected", String(i === index)));
    active = index;
    if (index >= 0 && options[index]) {
      input.setAttribute("aria-activedescendant", options[index].id);
      options[index].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }

  function render() {
    const query = input.value.trim();
    if (!query) { items = []; list.innerHTML = ""; setOpen(false); return; }
    const { results, total } = search(query);
    items = results;
    if (!results.length) {
      list.innerHTML = `<div class="combo-empty" role="presentation">${escapeHTML(emptyText)} for “${escapeHTML(query)}”</div>`;
    } else {
      list.innerHTML = results.map((entry, index) => `<div class="combo-option result-${entry.kind}" role="option" id="${listId}-option-${index}" data-index="${index}" aria-selected="false">${renderItem(entry)}</div>`).join("")
        + (total > results.length ? `<div class="combo-footer" role="presentation">Showing ${results.length} of ${total} results. Type more to narrow the list.</div>` : "");
    }
    setOpen(true);
    active = -1;
  }

  function choose(index) {
    const entry = items[index];
    if (!entry) return false;
    setOpen(false);
    onSelect(entry);
    return true;
  }

  input.addEventListener("input", render);
  input.addEventListener("focus", () => { if (input.value.trim() && list.hidden) render(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.hidden) render();
      if (!items.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      highlight((active + step + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (list.hidden) render();
      choose(active >= 0 ? active : 0);
    } else if (event.key === "Escape") {
      if (!list.hidden) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      else if (input.value) { event.preventDefault(); input.value = ""; onClear?.(); }
    } else if (event.key === "Tab") setOpen(false);
  });
  // mousedown keeps focus in the input; click picks the option.
  list.addEventListener("mousedown", (event) => { if (event.target.closest('[role="option"]')) event.preventDefault(); });
  list.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option) choose(Number(option.dataset.index));
  });
  list.addEventListener("mousemove", (event) => {
    const option = event.target.closest('[role="option"]');
    if (option && Number(option.dataset.index) !== active) highlight(Number(option.dataset.index));
  });
  document.addEventListener("pointerdown", (event) => {
    if (!list.hidden && !event.target.closest(`[aria-controls="${listId}"]`) && !list.contains(event.target)) setOpen(false);
  });
  setOpen(false);

  return {
    // Search button: pick the highlighted or first result. Returns false if none.
    submit() { render(); return choose(active >= 0 ? active : 0); },
    close: () => setOpen(false),
    refresh() { if (!list.hidden) render(); },
    setText(text) { input.value = text || ""; setOpen(false); }
  };
}
