// "tank" style: an elevated concrete water tank (the Water Tank in the PPDC
// courtyard; no close photo of it, so this is the usual design): four columns
// tied by bracing beams, the tank box with a cornice on top, a ladder.
import { concrete, mix, valueNoise } from "./atlas.mjs";

export const regions = {
  tank: [0, 0, 256, 256],
  column: [256, 0, 64, 256],
  roof: [320, 0, 128, 128],
  concrete: [0, 272, 64, 64],
  dark: [64, 272, 64, 64],
  metal: [128, 272, 64, 64]
};
const SWATCH = { concrete: [196, 194, 186], dark: [96, 96, 92], metal: [90, 92, 96] };
export const swatches = Object.keys(SWATCH);

// Weathered concrete: formwork lines and dark rain streaks running down.
function paintWeathered(atlas, region, seed) {
  atlas.paint(region, (x, y, w, h) => {
    let c = concrete([204, 202, 194], x, y, seed, 4, 8);
    const streak = Math.max(0, valueNoise(x, 0, 9, seed + 1) - 0.55) / 0.45 * (0.3 + 0.7 * y / h);
    c = mix(c, [120, 118, 110], streak * 0.45);
    if (y % 32 === 0) c = mix(c, [150, 148, 140], 0.5);
    return c;
  });
}

export async function paint(atlas) {
  paintWeathered(atlas, regions.tank, 11);
  paintWeathered(atlas, regions.column, 13);
  atlas.paint(regions.roof, (x, y) => concrete([176, 174, 166], x, y, 15, 5, 12));
  for (const [name, color] of Object.entries(SWATCH)) atlas.paint(regions[name], (x, y) => concrete(color, x, y, 60, 2, 0));
}

export function build(mesh, { W, D, H }) {
  const { box } = mesh;
  const tankH = Math.min(4.5, Math.max(2, H * 0.22));
  const tank0 = H - tankH;
  const cx = W / 2 - 1.2, cz = D / 2 - 1.2; // column centres
  const col = 0.32; // half width
  for (const [x, z] of [[-cx, -cz], [cx, -cz], [-cx, cz], [cx, cz]]) {
    box([x - col, x + col], [0, tank0], [z - col, z + col], "+z -z +x -x", "column", 0.95);
    box([x - 0.6, x + 0.6], [0, 0.35], [z - 0.6, z + 0.6], "+z -z +x -x +y", "concrete", 0.9);
  }
  // Bracing beams about every 4 m, round the four columns.
  for (let y = 4; y < tank0 - 1.5; y += 4) {
    const t = 0.18;
    box([-cx, cx], [y - t, y + t], [-cz - t, -cz + t], "+z -z +y -y", "concrete", 0.95);
    box([-cx, cx], [y - t, y + t], [cz - t, cz + t], "+z -z +y -y", "concrete", 0.95);
    box([-cx - t, -cx + t], [y - t, y + t], [-cz, cz], "+x -x +y -y", "concrete", 0.95);
    box([cx - t, cx + t], [y - t, y + t], [-cz, cz], "+x -x +y -y", "concrete", 0.95);
  }
  // Tank: body, underside, cornice, roof with a hatch.
  box([-W / 2 + 0.25, W / 2 - 0.25], [tank0, H - 0.35], [-D / 2 + 0.25, D / 2 - 0.25], "+z -z +x -x -y", "tank", 1);
  box([-W / 2, W / 2], [H - 0.35, H], [-D / 2, D / 2], "+z -z +x -x -y", "concrete", 1);
  mesh.rect([0, H, 0], [0, 1, 0], [1, 0, 0], W, D, "roof", 1);
  box([-0.6, 0.6], [H, H + 0.4], [-0.6, 0.6], "+z -z +x -x +y", "dark", 0.9);
  // Ladder on the front-right column, up to the cornice.
  box([cx - 0.2, cx + 0.2], [0.35, H - 0.35], [cz + col, cz + col + 0.05], "+z", "metal", 1);
}
