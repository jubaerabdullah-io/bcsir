// Main search bar: buildings, laboratories, research divisions and testing
// services in one list. Extends the original building search (same building
// fields: English, short and Bengali names, alias, ID and category) with the
// campus directory (directory.js).
import { createCombobox } from "./combobox.js";

export function createSearch({ getDirectory, onSelect, onMessage }) {
  const form = document.querySelector("#campus-search");
  const input = document.querySelector("#campus-search-input");
  const combo = createCombobox({
    input,
    list: document.querySelector("#campus-search-results"),
    search: (query) => getDirectory().search(query, { limit: 30 }),
    onSelect: (entry) => {
      input.value = entry.title;
      onSelect(entry);
      input.blur();
    },
    emptyText: "No buildings, labs or tests"
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!input.value.trim()) { input.focus(); return; }
    if (!combo.submit()) onMessage?.(`Nothing found for “${input.value.trim()}”`);
  });

  return {
    refresh: () => combo.refresh(),
    close: () => combo.close(),
    setText: (text) => combo.setText(text)
  };
}
