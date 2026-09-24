// URL-safe paths for files in public/ (pure, tested with node --test).
//
// Local development runs on Windows, whose file system ignores capitalisation
// and where the dev server accepts unencoded names; GitHub Pages is
// case-sensitive and needs every path segment URL-encoded. These helpers make
// a path behave the same in both places.

// Encodes each path segment once ("my photo.png" -> "my%20photo.png"), keeping
// segments that are already encoded. A "?query" is left as written; "#" is part
// of the file name ("Block #2.png" -> "Block%20%232.png"), as files are never
// addressed by fragment.
export function encodeAssetPath(path) {
  const [, pathname = "", suffix = ""] = /^([^?]*)(.*)$/s.exec(String(path ?? "")) || [];
  const encoded = pathname.split("/").map((segment) => {
    if (!segment || segment === "." || segment === "..") return segment;
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch { /* a literal "%": encode it */ }
    return encodeURIComponent(decoded);
  }).join("/");
  return `${encoded}${suffix}`;
}

// Path of `requested` inside a folder listing (["101.jpg", "Sub/Photo.PNG"]),
// matched exactly, else ignoring capitalisation and URL encoding. Returns the
// listed spelling, or null when the file is not in the listing.
export function findListedFile(requested, listing) {
  if (!requested || !listing) return null;
  const list = listing instanceof Set ? listing : new Set(listing);
  if (list.has(requested)) return requested;
  let decoded = requested;
  try { decoded = decodeURIComponent(requested); } catch { /* keep as written */ }
  if (list.has(decoded)) return decoded;
  const wanted = decoded.toLowerCase();
  for (const name of list) if (name.toLowerCase() === wanted) return name;
  return null;
}
