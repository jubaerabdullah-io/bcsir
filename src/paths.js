/**
 * Resolve a file from Vite's public/ directory in a way that works both:
 *   - locally with `npm run dev`
 *   - after `vite build` on GitHub Pages (including repository sub-paths)
 *
 * Vite replaces import.meta.env.BASE_URL at build time. Using document.baseURI
 * keeps relative builds portable instead of hard-coding a repository name.
 */
export function publicAssetUrl(assetPath) {
  const value = String(assetPath ?? "").trim();
  if (!value) return new URL(import.meta.env.BASE_URL || "./", document.baseURI).href;

  if (/^(?:https?:)?\/\//i.test(value) || /^(?:data|blob):/i.test(value)) {
    return value;
  }

  const cleanPath = value.replace(/^\/+/, "");
  const base = import.meta.env.BASE_URL || "./";
  return new URL(`${base}${cleanPath}`, document.baseURI).href;
}


/**
 * Return browser-decodable image candidates for shop photos/logos.
 * Supports explicit PNG/JPG/JPEG/WEBP/AVIF/GIF/SVG paths, bare filenames,
 * and extension-less filenames. Bare logo/photo filenames are resolved inside
 * public/images/logos or public/images/shops first, then from public/ root.
 */
export function publicImageCandidates(assetPath, kind = "generic") {
  const value = String(assetPath ?? "").trim();
  if (!value) return [];

  if (/^(?:https?:)?\/\//i.test(value) || /^(?:data|blob):/i.test(value)) {
    return [value];
  }

  const clean = value.replace(/^\.\//, "").replace(/^public\//i, "").replace(/^\/+/, "");
  const hasSlash = clean.includes("/");
  const filename = clean.split("/").filter(Boolean).at(-1) || clean;
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(clean)?.[1]?.toLowerCase() || "";
  const supportedExtensions = ["png", "jpg", "jpeg", "webp", "avif", "gif", "svg"];
  const baseDirs = kind === "logo"
    ? ["images/logos", ""]
    : kind === "shop"
      ? ["images/shops", ""]
      : [""];

  const rawCandidates = [clean];
  if (!hasSlash) baseDirs.forEach((dir) => rawCandidates.push(dir ? `${dir}/${clean}` : clean));
  // Also repair common QGIS paths such as `logos/shops/brand.jpg` by
  // resolving their filename from the standard image folders.
  const preferredDirs = kind === "logo"
    ? ["images/logos", "logos", "images/shops", "shops", "images", ""]
    : kind === "shop"
      ? ["images/shops", "shops", "images/logos", "logos", "images", ""]
      : [""];
  preferredDirs.forEach((dir) => rawCandidates.push(dir ? `${dir}/${filename}` : filename));

  const expanded = [];
  rawCandidates.forEach((candidate) => {
    expanded.push(candidate);
    if (!extension) supportedExtensions.forEach((ext) => expanded.push(`${candidate}.${ext}`));
  });

  return [...new Set(expanded.map((candidate) => publicAssetUrl(candidate)))];
}
