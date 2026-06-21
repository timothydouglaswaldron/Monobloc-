// ============================================================================
//  char.js — shared character sprite format. Imported by BOTH game and the
//  character creator, so they agree on how a sprite is stored and drawn.
//
//  A character is plain JSON:
//    { name, w, h, palette: ["#rrggbb", ...], pixels: ["rows...", ...] }
//  Each pixel char is '.' (transparent) or an index into `palette` encoded as a
//  single base-62 character. Full-color art, but files stay compact + readable.
// ============================================================================

const INDEX = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function emptyChar(w, h, name = "untitled") {
  return { name, w, h, palette: [], pixels: Array.from({ length: h }, () => ".".repeat(w)) };
}

export function getPixel(ch, x, y) {
  if (x < 0 || x >= ch.w || y < 0 || y >= ch.h) return null;
  const c = ch.pixels[y][x];
  if (c === ".") return null;
  const i = INDEX.indexOf(c);
  return i >= 0 ? ch.palette[i] : null;
}

export function setPixel(ch, x, y, color) {
  if (x < 0 || x >= ch.w || y < 0 || y >= ch.h) return;
  let token = ".";
  if (color) {
    let i = ch.palette.indexOf(color);
    if (i < 0) {
      if (ch.palette.length >= INDEX.length) return;  // palette full (62 colors)
      ch.palette.push(color); i = ch.palette.length - 1;
    }
    token = INDEX[i];
  }
  const row = ch.pixels[y];
  if (row[x] === token) return;
  ch.pixels[y] = row.slice(0, x) + token + row.slice(x + 1);
}

// Drop unused palette colors and reindex — keeps saved files tidy.
export function compactPalette(ch) {
  const used = new Set();
  for (const row of ch.pixels) for (const c of row) if (c !== ".") used.add(c);
  const keep = [...used].map((c) => INDEX.indexOf(c)).filter((i) => i >= 0).sort((a, b) => a - b);
  const remap = {}, newPal = [];
  keep.forEach((oldI) => { remap[INDEX[oldI]] = INDEX[newPal.length]; newPal.push(ch.palette[oldI]); });
  ch.pixels = ch.pixels.map((row) => [...row].map((c) => (c === "." ? "." : remap[c])).join(""));
  ch.palette = newPal;
}

// Bounding box of the non-transparent pixels (in cell units). Used so a
// fighter's body/hitboxes match what's actually drawn — no empty padding.
export function spriteBounds(ch) {
  let x0 = ch.w, y0 = ch.h, x1 = -1, y1 = -1;
  for (let y = 0; y < ch.h; y++)
    for (let x = 0; x < ch.w; x++)
      if (getPixel(ch, x, y)) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (x1 < 0) return { x0: 0, y0: 0, x1: ch.w - 1, y1: ch.h - 1, w: ch.w, h: ch.h };
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Render the sprite to an offscreen canvas at native (1px = 1 cell) resolution.
// The game draws this scaled with smoothing off for crisp pixels. (Browser only.)
export function makeSpriteCanvas(ch) {
  const cv = document.createElement("canvas");
  cv.width = ch.w; cv.height = ch.h;
  const cx = cv.getContext("2d");
  for (let y = 0; y < ch.h; y++)
    for (let x = 0; x < ch.w; x++) {
      const col = getPixel(ch, x, y);
      if (col) { cx.fillStyle = col; cx.fillRect(x, y, 1, 1); }
    }
  return cv;
}

// One pixel-row per line — readable + git-diff friendly.
export function serializeChar(ch) {
  compactPalette(ch);
  const pix = ch.pixels.map((r) => "    " + JSON.stringify(r)).join(",\n");
  return `{
  "name": ${JSON.stringify(ch.name)},
  "w": ${ch.w},
  "h": ${ch.h},
  "palette": ${JSON.stringify(ch.palette)},
  "pixels": [
${pix}
  ]
}
`;
}
