// Short, friendly building names for small spaces (the walk-mode minimap).
//
// name_en_short when the data has one (IGCRT, INARS, Dhaka Lab…); otherwise
// name_en without the "BCSIR" prefix and the "(near …)" notes. Always:
// Residential Quarter 07 -> Quarter 07, Research Laboratories -> Lab. When still
// longer than `max` characters: an "Institute of …" name becomes its initials
// (IBSPS), long common words are shortened (Residential -> Res., Building -> Bldg),
// and what is left is cut at a word, with "…".
const ALWAYS = [
  [/^Residential Quarter\b/i, "Quarter"],
  [/^Dr\.\s+/i, ""],
  [/^Res\. Quarter's Garage\b/i, "Garage"],
  [/\bResearch Laborator(y|ies)\b/i, "Lab"],
  [/\bLaboratories\b/i, "Lab"]
];
const WHEN_LONG = [
  [/\bBash Bhaban\s+/i, ""],
  [/\s*& Quarter$/i, ""],
  [/\bResearch (Division|Institute|Center|Centre)\b/i, "$1"],
  [/\bResidential\b/i, "Res."],
  [/\bBuilding\b/i, "Bldg"],
  [/\s+Division$/i, ""],
  [/\bCent(er|re)\b/i, "Ctr"]
];
const SMALL_WORDS = new Set(["of", "and", "&", "for", "the"]);

const tidy = (text) => String(text || "").replace(/\s+/g, " ").trim();

function cut(text, max) {
  if (text.length <= max) return text;
  let out = "";
  for (const word of text.split(" ")) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > max - 1) break;
    out = next;
  }
  return `${(out || text.slice(0, max - 1)).replace(/[\s&,-]+$/, "")}…`;
}

export function shortBuildingName(properties = {}, { max = 26 } = {}) {
  const short = tidy(properties.name_en_short);
  let name = short || tidy(String(properties.name_en || "").replace(/\s*\(.*$/, "").replace(/^BCSIR\s+/i, ""));
  if (!name) return "";
  if (name === name.toLowerCase()) name = name.replace(/\b\w/g, (letter) => letter.toUpperCase());
  if (!short) for (const [pattern, replacement] of ALWAYS) name = tidy(name.replace(pattern, replacement));
  if (name.length > max && !short && /^Institute\b/i.test(name)) {
    name = name.split(" ").filter((word) => !SMALL_WORDS.has(word.toLowerCase())).map((word) => word[0].toUpperCase()).join("");
  }
  if (name.length > max) for (const [pattern, replacement] of WHEN_LONG) name = tidy(name.replace(pattern, replacement));
  return cut(name.charAt(0).toUpperCase() + name.slice(1), max);
}

// The name in at most two lines of about `width` characters (split at a word); up
// to `oneLine` characters it stays on one line.
export function wrapName(name, width = 13, oneLine = 15) {
  if (name.length <= oneLine) return [name];
  const words = name.split(" ");
  let first = words[0];
  let i = 1;
  while (i < words.length && `${first} ${words[i]}`.length <= Math.max(width, Math.ceil(name.length / 2))) first += ` ${words[i++]}`;
  const rest = words.slice(i).join(" ");
  return rest ? [first, rest] : [first];
}
