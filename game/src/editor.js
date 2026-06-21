// ============================================================================
//  editor.js — visual map editor. Paint tiles or stamp prefab pieces onto the
//  grid, pan/zoom, and save straight into maps/ (File System Access API, with a
//  download fallback). Shares the map format + geometry with the game via stage.js.
// ============================================================================
import { TILE, emptyMap, getTile, setTile, worldSize, serializeMap } from "./stage.js";

// --- palettes ---------------------------------------------------------------
const COLORS = {
  [TILE.SOLID]:  "#2f3946",
  [TILE.ONEWAY]: "#3a4a5a",
  [TILE.SPAWN]:  "#54e0c8",
  [TILE.EMPTY]:  "#15181d",
};
const PAINTS = [
  { name: "Solid",   t: TILE.SOLID },
  { name: "One-way", t: TILE.ONEWAY },
  { name: "Spawn",   t: TILE.SPAWN },
  { name: "Erase",   t: TILE.EMPTY },
];
// Stamps are filled rectangles of one tile type, sized in cells.
const STAMPS = [
  { name: "Ground 8x2", w: 8, h: 2, t: TILE.SOLID },
  { name: "Block 4x1",  w: 4, h: 1, t: TILE.SOLID },
  { name: "Block 2x2",  w: 2, h: 2, t: TILE.SOLID },
  { name: "Pillar 1x4", w: 1, h: 4, t: TILE.SOLID },
  { name: "Ledge 6",    w: 6, h: 1, t: TILE.ONEWAY },
  { name: "Ledge 10",   w: 10, h: 1, t: TILE.ONEWAY },
];

// --- state ------------------------------------------------------------------
let map = null;
const tool = { mode: "paint", tile: TILE.SOLID, stamp: null };
const view = { x: 0, y: 0, zoom: 1 };       // world->screen: screen = world*zoom + offset
let saveHandle = null;                       // FileSystemFileHandle once saved/opened
let hover = { c: -1, r: -1 };
const pointer = { down: false, button: 0, panning: false, lastC: -1, lastR: -1 };
let spaceDown = false;

const cv = document.getElementById("c");
const ctx = cv.getContext("2d");

// ----------------------------------------------------------------------------
//  Boot: load arena1 as a starting point (falls back to a fresh map).
// ----------------------------------------------------------------------------
async function boot() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}maps/arena1.json`);
    if (!res.ok) throw new Error();
    map = await res.json();
  } catch {
    map = newMapTemplate();
  }
  buildPalette();
  selectPaint(TILE.SOLID);
  resize();
  fitView();
  syncBar();
  requestAnimationFrame(loop);
}

function newMapTemplate() {
  const m = emptyMap(64, 36, 20, "untitled");
  for (let c = 4; c < 60; c++) { setTile(m, c, 30, TILE.SOLID); setTile(m, c, 31, TILE.SOLID); }
  setTile(m, 20, 29, TILE.SPAWN);
  setTile(m, 43, 29, TILE.SPAWN);
  return m;
}

// ----------------------------------------------------------------------------
//  Palette UI
// ----------------------------------------------------------------------------
function buildPalette() {
  const paints = document.getElementById("paints");
  paints.innerHTML = "";
  PAINTS.forEach(p => {
    const b = document.createElement("button");
    b.className = "tool";
    b.dataset.paint = p.t;
    b.innerHTML = `<span class="swatch" style="background:${COLORS[p.t]}"></span>${p.name}`;
    b.onclick = () => selectPaint(p.t);
    paints.appendChild(b);
  });
  const stamps = document.getElementById("stamps");
  stamps.innerHTML = "";
  STAMPS.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "tool";
    b.dataset.stamp = i;
    b.innerHTML = `<span class="swatch" style="background:${COLORS[s.t]}"></span>${s.name}`;
    b.onclick = () => selectStamp(i);
    stamps.appendChild(b);
  });
}

function selectPaint(t) {
  tool.mode = "paint"; tool.tile = t; tool.stamp = null;
  highlight();
}
function selectStamp(i) {
  tool.mode = "stamp"; tool.stamp = STAMPS[i];
  highlight();
}
function highlight() {
  document.querySelectorAll(".tool").forEach(el => {
    const isPaint = tool.mode === "paint" && el.dataset.paint === tool.tile;
    const isStamp = tool.mode === "stamp" && el.dataset.stamp == STAMPS.indexOf(tool.stamp);
    el.classList.toggle("sel", isPaint || isStamp);
  });
}

// ----------------------------------------------------------------------------
//  View transform + canvas sizing
// ----------------------------------------------------------------------------
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view._w = r.width; view._h = r.height;
}
addEventListener("resize", () => { resize(); });

function fitView() {
  const { w, h } = worldSize(map);
  const z = Math.min(view._w / w, view._h / h) * 0.92;
  view.zoom = z;
  view.x = (view._w - w * z) / 2;
  view.y = (view._h - h * z) / 2;
}

function screenToCell(sx, sy) {
  const cell = map.cell;
  const wx = (sx - view.x) / view.zoom;
  const wy = (sy - view.y) / view.zoom;
  return { c: Math.floor(wx / cell), r: Math.floor(wy / cell) };
}

// ----------------------------------------------------------------------------
//  Editing
// ----------------------------------------------------------------------------
function applyAt(c, r) {
  if (tool.mode === "stamp" && tool.stamp) {
    const s = tool.stamp;
    for (let dy = 0; dy < s.h; dy++)
      for (let dx = 0; dx < s.w; dx++) setTile(map, c + dx, r + dy, s.t);
  } else {
    const t = pointer.button === 2 ? TILE.EMPTY : tool.tile;  // right-click erases
    setTile(map, c, r, t);
  }
}

// paint a line of cells so fast drags don't skip (paint mode only)
function paintLine(c0, r0, c1, r1) {
  const dx = Math.abs(c1 - c0), dy = Math.abs(r1 - r0);
  const sx = c0 < c1 ? 1 : -1, sy = r0 < r1 ? 1 : -1;
  let err = dx - dy, c = c0, r = r0;
  for (;;) {
    applyAt(c, r);
    if (c === c1 && r === r1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; c += sx; }
    if (e2 < dx) { err += dx; r += sy; }
  }
}

// ----------------------------------------------------------------------------
//  Pointer + keyboard
// ----------------------------------------------------------------------------
cv.addEventListener("contextmenu", e => e.preventDefault());

cv.addEventListener("pointerdown", e => {
  cv.setPointerCapture(e.pointerId);
  pointer.down = true; pointer.button = e.button;
  if (e.button === 1 || spaceDown) { pointer.panning = true; return; }
  const { c, r } = screenToCell(e.offsetX, e.offsetY);
  pointer.lastC = c; pointer.lastR = r;
  applyAt(c, r);
});

cv.addEventListener("pointermove", e => {
  const { c, r } = screenToCell(e.offsetX, e.offsetY);
  hover.c = c; hover.r = r;
  if (!pointer.down) return;
  if (pointer.panning) {
    view.x += e.movementX; view.y += e.movementY; return;
  }
  if (tool.mode === "paint") {
    paintLine(pointer.lastC, pointer.lastR, c, r);
  } else {
    applyAt(c, r);  // stamp follows drag
  }
  pointer.lastC = c; pointer.lastR = r;
});

cv.addEventListener("pointerup", () => { pointer.down = false; pointer.panning = false; });
cv.addEventListener("pointerleave", () => { hover.c = -1; hover.r = -1; });

cv.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const nz = Math.max(0.25, Math.min(4, view.zoom * factor));
  // zoom toward cursor
  const wx = (e.offsetX - view.x) / view.zoom;
  const wy = (e.offsetY - view.y) / view.zoom;
  view.zoom = nz;
  view.x = e.offsetX - wx * nz;
  view.y = e.offsetY - wy * nz;
}, { passive: false });

addEventListener("keydown", e => {
  if (e.code === "Space") { spaceDown = true; }
  if (e.target.tagName === "INPUT") return;
  if (e.key === "1") selectPaint(TILE.SOLID);
  if (e.key === "2") selectPaint(TILE.ONEWAY);
  if (e.key === "3") selectPaint(TILE.SPAWN);
  if (e.key === "0" || e.key === "e") selectPaint(TILE.EMPTY);
  if (e.key === "f") fitView();
});
addEventListener("keyup", e => { if (e.code === "Space") spaceDown = false; });

// ----------------------------------------------------------------------------
//  Toolbar actions
// ----------------------------------------------------------------------------
document.getElementById("name").addEventListener("input", e => { map.name = e.target.value; });

document.getElementById("new").onclick = () => {
  if (!confirm("Start a new map? Unsaved changes will be lost.")) return;
  map = newMapTemplate(); saveHandle = null;
  fitView(); syncBar();
};

document.getElementById("open").onclick = async () => {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: "Map", accept: { "application/json": [".json"] } }],
      });
      const file = await h.getFile();
      map = JSON.parse(await file.text());
      saveHandle = h;
      fitView(); syncBar();
    } catch { /* cancelled */ }
  } else {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json";
    inp.onchange = async () => {
      map = JSON.parse(await inp.files[0].text());
      fitView(); syncBar();
    };
    inp.click();
  }
};

document.getElementById("save").onclick = async () => {
  const text = serializeMap(map);
  const filename = `${map.name || "untitled"}.json`;
  if (window.showSaveFilePicker) {
    try {
      const h = saveHandle || await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Map", accept: { "application/json": [".json"] } }],
      });
      const w = await h.createWritable();
      await w.write(text); await w.close();
      saveHandle = h;
      flashStatus("saved " + h.name);
    } catch (err) { if (err && err.name !== "AbortError") downloadText(filename, text); }
  } else {
    downloadText(filename, text);
    flashStatus("downloaded " + filename);
  }
};

document.getElementById("play").onclick = () => {
  localStorage.setItem("brawler:draft", serializeMap(map));
  window.open(`${import.meta.env.BASE_URL}index.html?map=__draft`, "_blank");
};

function downloadText(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

let statusTimer = 0;
function flashStatus(msg) {
  const el = document.getElementById("status");
  el.textContent = msg; clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (el.textContent = ""), 2500);
}

function syncBar() {
  document.getElementById("name").value = map.name || "";
  document.getElementById("size").textContent = `${map.cols}×${map.rows} @ ${map.cell}px`;
}

// ----------------------------------------------------------------------------
//  Render loop
// ----------------------------------------------------------------------------
function loop() {
  draw();
  requestAnimationFrame(loop);
}

function draw() {
  const { w: W, h: H } = worldSize(map);
  const cell = map.cell;
  ctx.clearRect(0, 0, view._w, view._h);

  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.zoom, view.zoom);

  // backdrop
  ctx.fillStyle = "#0c0e11";
  ctx.fillRect(0, 0, W, H);

  // tiles
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const t = getTile(map, c, r);
      if (t === TILE.EMPTY) continue;
      const x = c * cell, y = r * cell;
      if (t === TILE.SOLID) {
        ctx.fillStyle = "#222b35"; ctx.fillRect(x, y, cell, cell);
        ctx.strokeStyle = "#3a4654"; ctx.lineWidth = 1 / view.zoom;
        ctx.strokeRect(x + 0.5 / view.zoom, y + 0.5 / view.zoom, cell - 1 / view.zoom, cell - 1 / view.zoom);
      } else if (t === TILE.ONEWAY) {
        ctx.fillStyle = "#3a4a5a"; ctx.fillRect(x, y, cell, 5);
      } else if (t === TILE.SPAWN) {
        ctx.strokeStyle = "#54e0c8"; ctx.lineWidth = 2 / view.zoom;
        ctx.strokeRect(x + cell * 0.2, y + cell * 0.2, cell * 0.6, cell * 0.6);
        ctx.fillStyle = "#54e0c8"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `${cell * 0.5}px ui-monospace, monospace`;
        ctx.fillText("S", x + cell / 2, y + cell / 2 + 1);
      }
    }
  }

  // grid
  ctx.strokeStyle = "#171b21"; ctx.lineWidth = 1 / view.zoom;
  ctx.beginPath();
  for (let x = 0; x <= W; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += cell) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  // world border
  ctx.strokeStyle = "#2a3340"; ctx.lineWidth = 1.5 / view.zoom;
  ctx.strokeRect(0, 0, W, H);

  // hover / ghost
  if (hover.c >= 0 && hover.r >= 0) {
    if (tool.mode === "stamp" && tool.stamp) {
      ctx.fillStyle = "rgba(84,224,200,0.18)";
      ctx.fillRect(hover.c * cell, hover.r * cell, tool.stamp.w * cell, tool.stamp.h * cell);
      ctx.strokeStyle = "#54e0c8"; ctx.lineWidth = 1 / view.zoom;
      ctx.strokeRect(hover.c * cell, hover.r * cell, tool.stamp.w * cell, tool.stamp.h * cell);
    } else {
      ctx.strokeStyle = "#54e0c8"; ctx.lineWidth = 1.5 / view.zoom;
      ctx.strokeRect(hover.c * cell, hover.r * cell, cell, cell);
    }
  }

  ctx.restore();
}

boot();

// expose for verification/debugging
window.__editor = { get map() { return map; }, tool, view, applyAt, selectPaint, selectStamp, STAMPS };
