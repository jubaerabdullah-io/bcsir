// Bridge to the ORIGINAL BCSIR routing implementation.
//
// connection_check.js is a Node script: it reads files with fs/promises and runs
// its checks at import time, so a browser cannot import it directly. Instead of
// re-implementing (or copying) the algorithm, this module reads the unmodified
// file and extracts the exact source text of its routing functions. Vite serves
// that text as the virtual module "virtual:bcsir-routing"; the verification
// scripts evaluate the same text. The original file is never written.
import { readFileSync } from "node:fs";
import path from "node:path";

export const ORIGINAL_ROUTING_FILE = "connection_check.js";
export const ORIGINAL_ROUTING_FUNCTIONS = ["buildGraph", "dijkstra", "isGraphConnected", "findConnectedComponents"];

// Returns the index just past the matching closing brace. Skips strings,
// template literals, regex-free comments; sufficient for plain function bodies.
function matchBrace(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "/" && next === "/") { i = source.indexOf("\n", i); if (i < 0) break; continue; }
    if (char === "/" && next === "*") { i = source.indexOf("*/", i + 2) + 1; continue; }
    if (char === '"' || char === "'" || char === "`") {
      for (i += 1; i < source.length && source[i] !== char; i += 1) if (source[i] === "\\") i += 1;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return i + 1;
  }
  throw new Error("Unbalanced braces while extracting the original routing function.");
}

export function extractFunction(source, name) {
  const pattern = new RegExp("^function\\s+" + name + "\\s*\\(", "m");
  const match = pattern.exec(source);
  if (!match) throw new Error(`function ${name}() was not found in ${ORIGINAL_ROUTING_FILE}.`);
  const open = source.indexOf("{", match.index);
  return source.slice(match.index, matchBrace(source, open));
}

export function readOriginalRoutingSource(root) {
  return readFileSync(path.join(root, ORIGINAL_ROUTING_FILE), "utf8");
}

// ES module text: the verbatim function declarations plus named exports.
export function buildRoutingModule(root) {
  const source = readOriginalRoutingSource(root);
  const bodies = ORIGINAL_ROUTING_FUNCTIONS.map((name) => extractFunction(source, name));
  return [
    `// Generated at build time from ${ORIGINAL_ROUTING_FILE} (unmodified). Do not edit.`,
    ...bodies,
    `export { ${ORIGINAL_ROUTING_FUNCTIONS.join(", ")} };`,
    ""
  ].join("\n\n");
}

// Node helper for tests/verification: import the generated module text.
export async function importOriginalRouting(root) {
  const code = buildRoutingModule(root);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
