// The landing page: which addresses show it, and its wording and files.
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { opensMap, viewMode } from "../src/core/view-mode.js";
import * as content from "../src/landing/content.js";

const root = fileURLToPath(new URL("..", import.meta.url));

test("an address that names no map shows the landing page; map addresses are unchanged", () => {
  assert.equal(opensMap(""), false);
  assert.equal(opensMap("?utm_source=mail"), false);
  assert.equal(opensMap("?org=bcsir"), true);
  assert.equal(opensMap("?buildingid=101"), true, "the printed QR codes still open the map");
  assert.equal(opensMap("?place=bcsir-room"), true);
  assert.equal(opensMap("?maps"), true, "the organisation picker");

  // The check written into index.html (it runs before the scripts load) agrees.
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const [, source] = /if \(!(\/.+?\/)\.test\(location\.search\)\)/.exec(html);
  const inline = new RegExp(source.slice(1, -1));
  for (const search of ["", "?utm_source=mail", "?org=bcsir", "?buildingid=101", "?place=x", "?maps", "?x=1&org=bcsir"]) {
    assert.equal(inline.test(search), opensMap(search), search);
  }
});

test("the flat map and the frame switch are off unless the address asks for them", () => {
  assert.deepEqual(viewMode("?org=bcsir"), { flat: false, embed: false });
  assert.deepEqual(viewMode("?org=bcsir&view=2d&embed=1"), { flat: true, embed: true });
  assert.deepEqual(viewMode("?org=bcsir&view=3d"), { flat: false, embed: false });
  // An organisation can be flat by its own org.json, whatever the address says.
  assert.equal(viewMode("?org=bcsir-2d", { view_mode: "2d" }).flat, true);
  assert.equal(viewMode("?org=bcsir", { view_mode: "3d" }).flat, false);
});

// Every text a visitor reads (not ids, icons, links or file names).
function visibleTexts(value, key = "", texts = []) {
  // The office address is a postal address, written as it is ("13-H", "Dhaka-1000").
  const hidden = new Set(["id", "icon", "url", "file", "poster", "logo", "email", "query", "org", "target", "endpoint", "address"]);
  if (typeof value === "string") { if (!hidden.has(key)) texts.push(value); }
  else if (Array.isArray(value)) value.forEach((item) => visibleTexts(item, key, texts));
  else if (value && typeof value === "object") Object.entries(value).forEach(([name, item]) => visibleTexts(item, name, texts));
  return texts;
}

test("the landing page wording has no hyphens or dashes", () => {
  const texts = visibleTexts(content);
  assert.ok(texts.length > 80);
  for (const text of texts) assert.doesNotMatch(text, /[-‐-―]/, text);
});

test("the showcase maps, their pictures and the logo exist", () => {
  assert.ok(existsSync(path.join(root, "public", content.BRAND.logo)), content.BRAND.logo);
  assert.deepEqual(content.SHOWCASE.items.map((item) => item.tier), ["Premium", "Standard", "Basic"]);
  for (const item of content.SHOWCASE.items) {
    assert.ok(existsSync(path.join(root, "public", item.poster)), item.poster);
    assert.ok(existsSync(path.join(root, "public/data", item.org, "org.json")), `public/data/${item.org}`);
  }
  // Premium is Taqwa Fabrics, shown locked; Standard is the full BCSIR 3D map;
  // Basic is the flat map made from the QGIS repository (npm run data:pull-2d).
  assert.deepEqual(content.SHOWCASE.items.map((item) => [item.org, item.locked === true]), [["taqwafabrics", true], ["bcsir", false], ["bcsir-2d", false]]);
  const basic = JSON.parse(readFileSync(path.join(root, "public/data/bcsir-2d/org.json"), "utf8"));
  assert.equal(basic.view_mode, "2d", "the Basic map is always flat");
  const source = JSON.parse(readFileSync(path.join(root, "public/data/bcsir-2d/source.json"), "utf8"));
  assert.match(source.repository, /bcsir-qgis-map$/);
  assert.match(source.commit, /^[0-9a-f]{40}$/);
  for (const file of ["BCSIRBoundary.geojson", "BuildingBoundary.geojson", "ConnectedRoad.geojson", "Pathway.geojson", "InternalBoundary.geojson", "ConnectedRoads/v0/r2.json"]) {
    assert.ok(existsSync(path.join(root, "public/data/bcsir-2d", file)), file);
  }
  // A mark on a feature ("*") has an entry in FOOTNOTES, even when its note is still empty.
  for (const item of content.SHOWCASE.items) for (const feature of item.features) {
    const mark = /\*+$/.exec(feature)?.[0];
    if (mark) assert.ok(mark in content.FOOTNOTES, feature);
  }
});

test("menus: four solutions, the showcase beside them, ten industries", () => {
  const labels = content.NAV.map((entry) => entry.label);
  assert.deepEqual(labels, ["Solutions", "Showcase", "Industries"]);
  assert.equal(content.ABOUT, undefined, "the About us section was removed");
  assert.deepEqual(content.NAV[0].menu.map((item) => item.label), ["Indoor Map", "Indoor Navigation", "Indoor Tracking", "3D and 2D Maps"]);
  assert.deepEqual(content.NAV[2].menu.map((item) => item.label), ["Retail", "Hospitals", "Security", "Airports", "Campuses and offices", "Facility management", "Events", "Hotels & Resorts", "Industry", "Garments"]);
});

test("the first page: the headline and the four feature cards, each with its artwork and light pictures", async () => {
  const { default: sharp } = await import("sharp");
  const { PICTURE_KINDS, PICTURE_SOURCE, pictureFile } = await import("../src/landing/pictures.js");
  const { FEATURES } = content;
  assert.equal(FEATURES.title, "Maps that know the inside of the building.");
  assert.deepEqual(FEATURES.items.map((item) => item.file), ["3dbuilding", "game", "route", "indoor"]);
  for (const item of FEATURES.items) {
    assert.ok(item.title && item.alt, item.file);
    assert.equal(item.points.length, 4, item.file);
  }
  // One card shows them one at a time: its arrows have names, and it moves on
  // by itself after `seconds` (0 switches that off).
  assert.ok(FEATURES.previous && FEATURES.next);
  assert.ok(Number.isFinite(FEATURES.seconds) && FEATURES.seconds >= 0);
  // The artwork is never sent to a visitor: the page shows the WebP copies made
  // from it by `npm run landing:images`, in every width the page may ask for.
  for (const [picture, kind] of [[FEATURES.picture, "hero"], ...FEATURES.items.map((item) => [item, "card"])]) {
    assert.ok(existsSync(path.join(root, "public", PICTURE_SOURCE, `${picture.file}.svg`)), `${picture.file}.svg`);
    const { widths, ratio } = PICTURE_KINDS[kind];
    for (const width of widths) {
      const file = path.join(root, "public", pictureFile(picture.file, width));
      assert.ok(existsSync(file), `${pictureFile(picture.file, width)}: run npm run landing:images`);
      assert.ok(statSync(file).size < 160 * 1024, `${pictureFile(picture.file, width)} is light`);
      const meta = await sharp(file).metadata();
      assert.deepEqual([meta.width, meta.height], [width, Math.round(width / ratio)], pictureFile(picture.file, width));
    }
  }
});

test("the landing page's font and first picture are asked for by index.html, from this site only", async () => {
  const { PICTURE_KINDS, pictureFile } = await import("../src/landing/pictures.js");
  const html = readFileSync(path.join(root, "index.html"), "utf8");
  const css = readFileSync(path.join(root, "src/landing/landing.css"), "utf8");
  const script = readFileSync(path.join(root, "src/landing/landing.js"), "utf8");
  // The same files and the same `sizes` as the picture on the page, or the browser would fetch it twice.
  const { widths, sizes } = PICTURE_KINDS.hero;
  const srcset = widths.map((width) => `./${pictureFile(content.FEATURES.picture.file, width)} ${width}w`).join(", ");
  assert.ok(html.includes(`imagesrcset="${srcset}"`), "index.html asks for the hero picture in the widths of pictures.js");
  assert.ok(html.includes(`imagesizes="${sizes}"`), "index.html uses the hero picture's sizes of pictures.js");
  assert.ok(html.includes('<link rel="preload" as="font" type="font/woff2" crossorigin href="./fonts/manrope-latin.woff2">'));
  assert.ok(html.includes("<!-- landing files -->"), "the mark a build replaces with the page's script and stylesheet");
  // The font is served with the site: every file landing.css names is in public/fonts/.
  const fonts = [...css.matchAll(/url\("\/(fonts\/[^"]+)"\)/g)].map((match) => match[1]);
  assert.ok(fonts.includes("fonts/manrope-latin.woff2"));
  for (const font of fonts) assert.ok(existsSync(path.join(root, "public", font)), font);
  for (const [name, text] of [["index.html", html], ["landing.css", css], ["landing.js", script]]) assert.doesNotMatch(text, /fonts\.(googleapis|gstatic)\.com/, name);
});
