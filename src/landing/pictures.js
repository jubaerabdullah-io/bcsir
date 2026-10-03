// The pictures of the first page (the laptop and phone under the hero, and one
// picture for each feature card).
//
// The artwork is public/image/ui/<file>.svg. Those files are 2 to 9 MB each
// (photos and screenshots are stored inside the SVG), far too heavy to send to a
// visitor, so `npm run landing:images` draws each one once and saves it as WebP
// in the widths below: public/landing/ui/<file>-<width>.webp. The page asks for
// the width that fits the screen. Run the command again after changing an SVG.
export const PICTURE_SOURCE = "image/ui";
export const PICTURE_FOLDER = "landing/ui";

//   hero   the laptop and phone: cut to the drawing (the empty space around it
//          is removed), 3:2
//   card   a feature card: the whole square artwork
//   widths   the copies saved (px)
//   ratio    width / height
//   sizes    how wide the page draws it (landing.css), so the browser can choose
// index.html asks for the hero picture before the page's script has loaded; its
// list of files and `sizes` there must be the same as here (tests/landing.test.mjs).
export const PICTURE_KINDS = {
  hero: { widths: [720, 1200, 1600], ratio: 3 / 2, sizes: "(min-width: 964px) 900px, calc(100vw - 32px)" },
  card: { widths: [720, 1080], ratio: 1, sizes: "(min-width: 1200px) 568px, (min-width: 961px) calc(50vw - 32px), (min-width: 624px) 560px, calc(100vw - 32px)" }
};

export const pictureFile = (file, width) => `${PICTURE_FOLDER}/${file}-${width}.webp`;
