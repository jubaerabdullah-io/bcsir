// The search box: buildings, rooms of the floor plans, laboratories, research
// divisions and testing services in one list (the campus directory, directory.js).
//
// It is all that is shown at first. Focusing it lists the places used last
// (recents.js); typing lists the matches. Choosing one opens that place: the box
// then carries its name and a Close button, which closes the place and leaves the
// empty box again. The Directions button beside the search icon (shown while the
// box is empty) opens the directions panel in the box's place (directions-ui.js).
import { createCombobox } from "./combobox.js";

// getRecent()      the places used last, as directory entries
// onClearRecent()  forgets them
// onSelect(entry)  a result was chosen
// onClose()        the Close button: the open place should close
export function createSearch({ getDirectory, getRecent, onClearRecent, onSelect, onClose, onMessage }) {
  const form = document.querySelector("#campus-search");
  const input = document.querySelector("#campus-search-input");
  const closeButton = document.querySelector("#campus-search-clear");
  const directionsButton = document.querySelector("#directions-open");
  let place = ""; // name of the open place (the one its card shows), or ""

  // Close takes the place of the Directions button while the box holds anything.
  function updateButtons() {
    const filled = Boolean(input.value || place);
    closeButton.hidden = !filled;
    directionsButton.hidden = filled;
  }

  function reset() {
    place = "";
    combo.setText("");
    updateButtons();
    onClose?.();
  }

  const combo = createCombobox({
    input,
    list: document.querySelector("#campus-search-results"),
    search: (query) => getDirectory().search(query, { limit: 30 }),
    suggest: () => getRecent?.() || [],
    onClearSuggestions: onClearRecent,
    onSelect: (entry) => {
      // Named at once: a room's floor is loaded before its card can show.
      place = entry.title;
      input.value = entry.title;
      updateButtons();
      onSelect(entry);
      input.blur();
    },
    onClear: reset,
    emptyText: "Nothing",
    fitToScreen: true
  });

  input.addEventListener("input", updateButtons);
  // Leaving the box without choosing: it names the open place again.
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === input || !place || input.value === place) return;
      input.value = place;
      updateButtons();
    }, 150);
  });
  closeButton.addEventListener("click", reset);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!input.value.trim()) { input.focus(); return; }
    if (!combo.submit()) onMessage?.(`Nothing found for “${input.value.trim()}”`);
  });
  updateButtons();

  return {
    refresh: () => combo.refresh(),
    close: () => combo.close(),
    // The place whose card is open, by name; null when none is. Text being typed
    // for another search is left alone when a place closes.
    showPlace(title) {
      const next = title || "";
      if (next) input.value = next;
      else if (input.value === place) input.value = "";
      place = next;
      combo.close();
      updateButtons();
    }
  };
}
