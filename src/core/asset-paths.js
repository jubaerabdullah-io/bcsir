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

const REMOTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const INLINE = /^(?:data|blob):/i;

// Path in public/ of an organisation's file, from the value written in its data.
// Every organisation has its own folder in public/models/ and public/image/
// (public/models/bcsir/, public/image/bcsir/), and files any organisation may use
// are in the "shared" folder. `folder` is "models" or "image". The data may name a
// file with or without those folders; all of these give models/bcsir/tree.glb for
// organisation "bcsir":
//   "tree.glb"  "/models/tree.glb"  "models/tree.glb"  "models/bcsir/tree.glb"
// and "shared/tree.glb" gives models/shared/tree.glb. Remote URLs are kept.
export function orgAssetPath(folder, value, orgId) {
  const text = String(value ?? "").trim();
  if (!text || REMOTE.test(text) || INLINE.test(text)) return text;
  let rest = text.replace(/^\.\//, "").replace(/^\/+/, "").replace(/^public\//i, "");
  if (rest.toLowerCase().startsWith(`${folder}/`)) rest = rest.slice(folder.length + 1);
  if (rest.startsWith("shared/") || !orgId || rest.startsWith(`${orgId}/`)) return `${folder}/${rest}`;
  return `${folder}/${orgId}/${rest}`;
}

// The same file relative to the organisation's own folder ("buildings/igcrt.glb"),
// or null for a remote URL or a shared file.
export function orgAssetKey(folder, value, orgId) {
  const full = orgAssetPath(folder, value, orgId);
  const prefix = `${folder}/${orgId}/`;
  return full.startsWith(prefix) ? full.slice(prefix.length) : null;
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
