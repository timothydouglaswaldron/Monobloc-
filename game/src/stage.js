// ============================================================================
//  stage.js — shared map format + geometry. Imported by BOTH game and editor,
//  so they can never disagree on what a tile means.
//
//  A map is plain JSON:
//    { name, cols, rows, cell, tiles: ["....#=....", ...] }
//  one character per grid cell:
//    '.' empty   '#' solid block   '=' one-way ledge   'S' spawn point
// ============================================================================

export const TILE = { EMPTY: ".", SOLID: "#", ONEWAY: "=", SPAWN: "S" };

export function emptyMap(cols, rows, cell = 20, name = "untitled") {
  const tiles = Array.from({ length: rows }, () => TILE.EMPTY.repeat(cols));
  return { name, cols, rows, cell, tiles };
}

export function getTile(map, c, r) {
  if (r < 0 || r >= map.rows || c < 0 || c >= map.cols) return TILE.EMPTY;
  return map.tiles[r][c] || TILE.EMPTY;
}

export function setTile(map, c, r, ch) {
  if (r < 0 || r >= map.rows || c < 0 || c >= map.cols) return;
  const row = map.tiles[r];
  if (row[c] === ch) return;
  map.tiles[r] = row.slice(0, c) + ch + row.slice(c + 1);
}

export function worldSize(map) {
  return { w: map.cols * map.cell, h: map.rows * map.cell };
}

// Merge horizontal runs of solid/one-way tiles into AABB colliders.
// Solid blocks fill their cell; one-way ledges are a thin lip on the cell's top.
export function buildColliders(map) {
  const out = [];
  const cell = map.cell;
  for (let r = 0; r < map.rows; r++) {
    const row = map.tiles[r];
    let c = 0;
    while (c < map.cols) {
      const ch = row[c];
      if (ch === TILE.SOLID || ch === TILE.ONEWAY) {
        let c2 = c;
        while (c2 < map.cols && row[c2] === ch) c2++;
        const x = c * cell, w = (c2 - c) * cell, y = r * cell;
        if (ch === TILE.SOLID) out.push({ x, y, w, h: cell, solid: true });
        else out.push({ x, y, w, h: 8, solid: false });
        c = c2;
      } else c++;
    }
  }
  return out;
}

// Spawn points as pixel coords (cell center x, cell bottom y).
export function findSpawns(map) {
  const cell = map.cell, out = [];
  for (let r = 0; r < map.rows; r++)
    for (let c = 0; c < map.cols; c++)
      if (map.tiles[r][c] === TILE.SPAWN)
        out.push({ x: c * cell + cell / 2, y: r * cell + cell });
  return out;
}

// Serialize with one tile-row per line — readable and git-diff friendly.
export function serializeMap(map) {
  const rows = map.tiles.map((t) => "    " + JSON.stringify(t)).join(",\n");
  return `{
  "name": ${JSON.stringify(map.name)},
  "cols": ${map.cols},
  "rows": ${map.rows},
  "cell": ${map.cell},
  "tiles": [
${rows}
  ]
}
`;
}
