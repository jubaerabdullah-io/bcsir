// Makes the pictures of the landing page's first screen from the artwork in
// public/image/ui/*.svg (see src/landing/pictures.js):
//   public/landing/ui/<file>-<width>.webp
// The SVG files themselves are never sent to a visitor.
//
//   npm run landing:images
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { FEATURES } from "../src/landing/content.js";
import { PICTURE_FOLDER, PICTURE_KINDS, PICTURE_SOURCE, pictureFile } from "../src/landing/pictures.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = path.join(root, "public");
// The artwork is 1080 px wide at 72 dpi; drawn twice as large, then reduced.
const DENSITY = 144;
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

// The box around everything that is drawn (the hero artwork is mostly empty).
async function drawnBox(image) {
  const { data, info } = await image.clone().ensureAlpha().extractChannel("alpha").raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] < 8) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) throw new Error("the picture is empty");
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

// The drawing alone, centred on a clear canvas of the wanted shape.
async function cutToShape(image, ratio) {
  const box = await drawnBox(image);
  const cut = await image.clone().extract(box).png().toBuffer();
  const width = Math.max(box.width, Math.ceil(box.height * ratio));
  const height = Math.max(box.height, Math.ceil(box.width / ratio));
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const left = Math.floor((width - box.width) / 2);
  const top = Math.floor((height - box.height) / 2);
  return sharp(cut).extend({ left, right: width - box.width - left, top, bottom: height - box.height - top, background: clear }).png().toBuffer();
}

async function build(file, kind) {
  const { widths, ratio } = PICTURE_KINDS[kind];
  const source = path.join(publicDir, PICTURE_SOURCE, `${file}.svg`);
  const drawn = sharp(await sharp(source, { unlimited: true, density: DENSITY }).png().toBuffer());
  const picture = kind === "hero" ? await cutToShape(drawn, ratio) : await drawn.png().toBuffer();
  const sizes = [];
  for (const width of widths) {
    const target = path.join(publicDir, pictureFile(file, width));
    await sharp(picture)
      .resize({ width, height: Math.round(width / ratio), fit: "fill", kernel: "lanczos3" })
      .webp({ quality: 80, alphaQuality: 90, effort: 6, smartSubsample: true })
      .toFile(target);
    sizes.push(`${width}px ${kb((await stat(target)).size)}`);
  }
  console.log(`${`${file}.svg`.padEnd(16)} ${kb((await stat(source)).size).padStart(8)}  ->  ${sizes.join(", ")}`);
}

await mkdir(path.join(publicDir, PICTURE_FOLDER), { recursive: true });
await build(FEATURES.picture.file, "hero");
for (const item of FEATURES.items) await build(item.file, "card");
