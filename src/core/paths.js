import { encodeAssetPath } from "./asset-paths.js";

/**
 * Resolve a file from Vite's public/ directory in a way that works both:
 *   - locally with `npm run dev`
 *   - after `vite build` on GitHub Pages (including repository sub-paths)
 *
 * Vite replaces import.meta.env.BASE_URL at build time. Using document.baseURI
 * keeps relative builds portable instead of hard-coding a repository name.
 * Each path segment is URL-encoded (spaces, #, non-ASCII names), because GitHub
 * Pages does not accept the raw names that the local dev server tolerates.
 */
export function publicAssetUrl(assetPath) {
  const value = String(assetPath ?? "").trim();
  if (!value) return new URL(import.meta.env.BASE_URL || "./", document.baseURI).href;

  if (/^(?:https?:)?\/\//i.test(value) || /^(?:data|blob):/i.test(value)) {
    return value;
  }

  const cleanPath = encodeAssetPath(value.replace(/^\/+/, ""));
  const base = import.meta.env.BASE_URL || "./";
  return new URL(`${base}${cleanPath}`, document.baseURI).href;
}

// Reads a JSON file of public/. The copy in the browser's cache is checked with
// the server first, so a file that was edited is read fresh.
export async function fetchPublicJSON(file) {
  const response = await fetch(publicAssetUrl(file), { cache: "no-cache" });
  if (!response.ok) throw new Error(`${file}: ${response.status} ${response.statusText}`);
  return response.json();
}
