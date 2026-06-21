// ============================================================================
//  creator.js — pixel character editor. Same shape as the map editor, but the
//  grid is the sprite's pixels and the "palette" is a full color picker.
//  Sprites are 16x24 (2 cubes wide x 3 tall, 8px/cube). Saves JSON into chars/.
// ============================================================================
import { emptyChar, getPixel, setPixel, makeSpriteCanvas, serializeChar } from "./char.js";

const W = 16, H = 24;                 // sprite resolution

const SWATCHES = [
  "#0a0a0c", "#cfd2d6", "#54e0c8", "#246b61", "#e0688a", "#8a3450",
  "#e0b85a", "#6a9cf0", "#b06af0", "#7ee06a", "#f0823a", "#2a2f36",
];

let ch = null;
const tool = { mode: "paint", color: "#54e0c8" };
const view = { x: 0, y: 0, zoom: 1 };      // world(px-cell)->screen
let saveHandle = null;
let hover = { x: -1, y: -1 };
const pointer = { down: false, button: 0, panning: false, lastX: -1, lastY: -1 };
let spaceDown = false, flipPreview = false;

const cv = document.getElementById("c");
const ctx = cv.getContext("2d");
const pv = document.getElementById("pv"), pvc = pv.getContext("2d");
const pvg = document.getElementById("pvg"), pvgc = pvg.getContext("2d");

// ----------------------------------------------------------------------------
//  Boot
// ----------------------------------------------------------------------------
async function boot() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}chars/striker.json`);
    if (!res.ok) throw new Error();
    ch = await res.json();
  } catch {
    ch = emptyChar(W, H, "untitled");
  }
  buildSwatches();
  resize(); fitView(); syncBar();
  requestAnimationFrame(loop);
}

// ----------------------------------------------------------------------------
//  Swatches + tools
// ----------------------------------------------------------------------------
function buildSwatches() {
  const wrap = document.getElementById("swatches");
  wrap.innerHTML = "";
  const erase = document.createElement("button");
  erase.className = "sw erase"; erase.title = "transparent (erase)";
  erase.onclick = () => setTool("erase");
  wrap.appendChild(erase);
  SWATCHES.forEach((c) => {
    const b = document.createElement("button");
    b.className = "sw"; b.style.background = c; b.dataset.color = c;
    b.onclick = () => pickColor(c);
    wrap.appendChild(b);
  });
}

function pickColor(c) {
  tool.mode = "paint"; tool.color = c;
  document.getElementById("color").value = c;
  document.getElementById("hex").textContent = c;
  setTool("paint");
  markSwatch();
}
function setTool(mode) {
  tool.mode = mode;
  for (const id of ["paint", "erase", "pick"])
    document.getElementById("t-" + id).classList.toggle("sel", id === mode);
  markSwatch();
}
function markSwatch() {
  document.querySelectorAll(".sw").forEach((el) =>
    el.classList.toggle("sel", tool.mode === "paint" && el.dataset.color === tool.color));
  document.querySelector(".sw.erase").classList.toggle("sel", tool.mode === "erase");
}

document.getElementById("color").addEventListener("input", (e) => pickColor(e.target.value));
document.getElementById("t-paint").onclick = () => setTool("paint");
document.getElementById("t-erase").onclick = () => setTool("erase");
document.getElementById("t-pick").onclick = () => setTool("pick");

// ----------------------------------------------------------------------------
//  View
// ----------------------------------------------------------------------------
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view._w = r.width; view._h = r.height;
}
addEventListener("resize", resize);

function fitView() {
  const z = Math.min(view._w / W, view._h / H) * 0.82;
  view.zoom = z;
  view.x = (view._w - W * z) / 2;
  view.y = (view._h - H * z) / 2;
}
function screenToPixel(sx, sy) {
  return { x: Math.floor((sx - view.x) / view.zoom), y: Math.floor((sy - view.y) / view.zoom) };
}

// ----------------------------------------------------------------------------
//  Editing
// ----------------------------------------------------------------------------
function applyAt(x, y) {
  if (tool.mode === "pick") {
    const c = getPixel(ch, x, y);
    if (c) pickColor(c);
    return;
  }
  const erase = tool.mode === "erase" || pointer.button === 2;
  setPixel(ch, x, y, erase ? null : tool.color);
}
function paintLine(x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  for (;;) {
    applyAt(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

// ----------------------------------------------------------------------------
//  Pointer + keys
// ----------------------------------------------------------------------------
cv.addEventListener("contextmenu", (e) => e.preventDefault());
cv.addEventListener("pointerdown", (e) => {
  cv.setPointerCapture(e.pointerId);
  pointer.down = true; pointer.button = e.button;
  if (e.button === 1 || spaceDown) { pointer.panning = true; return; }
  const p = screenToPixel(e.offsetX, e.offsetY);
  if (e.altKey) { const c = getPixel(ch, p.x, p.y); if (c) pickColor(c); return; }
  pointer.lastX = p.x; pointer.lastY = p.y;
  applyAt(p.x, p.y);
});
cv.addEventListener("pointermove", (e) => {
  const p = screenToPixel(e.offsetX, e.offsetY);
  hover = p;
  if (!pointer.down) return;
  if (pointer.panning) { view.x += e.movementX; view.y += e.movementY; return; }
  paintLine(pointer.lastX, pointer.lastY, p.x, p.y);
  pointer.lastX = p.x; pointer.lastY = p.y;
});
cv.addEventListener("pointerup", () => { pointer.down = false; pointer.panning = false; });
cv.addEventListener("pointerleave", () => { hover = { x: -1, y: -1 }; });
cv.addEventListener("wheel", (e) => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const nz = Math.max(2, Math.min(60, view.zoom * f));
  const wx = (e.offsetX - view.x) / view.zoom, wy = (e.offsetY - view.y) / view.zoom;
  view.zoom = nz; view.x = e.offsetX - wx * nz; view.y = e.offsetY - wy * nz;
}, { passive: false });

addEventListener("keydown", (e) => {
  if (e.code === "Space") spaceDown = true;
  if (e.target.tagName === "INPUT") return;
  if (e.key === "b") setTool("paint");
  if (e.key === "e") setTool("erase");
  if (e.key === "i") setTool("pick");
  if (e.key === "f") fitView();
  if (e.key === "x") flipPreview = !flipPreview;
});
addEventListener("keyup", (e) => { if (e.code === "Space") spaceDown = false; });

// ----------------------------------------------------------------------------
//  Toolbar
// ----------------------------------------------------------------------------
document.getElementById("name").addEventListener("input", (e) => (ch.name = e.target.value));
document.getElementById("new").onclick = () => {
  if (!confirm("New character? Unsaved changes will be lost.")) return;
  ch = emptyChar(W, H, "untitled"); saveHandle = null; fitView(); syncBar();
};
// --- saved-characters library (persists in localStorage for later use) ------
const LIB_KEY = "brawler:chars";
function readLib() { try { return JSON.parse(localStorage.getItem(LIB_KEY) || "{}"); } catch { return {}; } }
function writeLib(l) { localStorage.setItem(LIB_KEY, JSON.stringify(l)); }

document.getElementById("save").onclick = () => {
  const name = (ch.name || "untitled").trim() || "untitled";
  ch.name = name; syncBar();
  const text = serializeChar(ch);                  // compacts palette + serializes
  const lib = readLib(); lib[name] = JSON.parse(text); writeLib(lib);  // store by name
  localStorage.setItem("brawler:charDraft", text); // also the active fighter
  flashStatus("saved '" + name + "'");
};

document.getElementById("open").onclick = openLoad;

function openLoad() {
  const lib = readLib();
  const names = Object.keys(lib);
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;z-index:60;background:rgba(8,9,11,.85);display:grid;place-items:center";
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const btn = "background:#15191e;border:1px solid #2a2f36;color:#cfd2d6;border-radius:5px;padding:8px;font:inherit;font-size:12px;cursor:pointer";

  const panel = document.createElement("div");
  panel.style.cssText = "width:320px;max-width:92vw;max-height:80vh;overflow:auto;background:#0d0f12;border:1px solid #1c1f24;border-radius:10px;padding:18px";
  panel.innerHTML = `<div style="color:#54e0c8;font-weight:700;letter-spacing:.12em;font-size:12px;margin-bottom:12px">SAVED FIGHTERS</div>`;

  if (!names.length) {
    const e = document.createElement("div");
    e.style.cssText = "color:#5a5f66;font-size:12px;margin-bottom:8px";
    e.textContent = "No saved fighters yet — make one and hit Save.";
    panel.appendChild(e);
  }
  for (const n of names) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #14171b";
    const load = document.createElement("button");
    load.textContent = n; load.style.cssText = btn + ";flex:1;text-align:left";
    load.onclick = () => { ch = JSON.parse(JSON.stringify(lib[n])); fitView(); syncBar(); ov.remove(); flashStatus("loaded '" + n + "'"); };
    const del = document.createElement("button");
    del.textContent = "✕"; del.title = "delete"; del.style.cssText = btn + ";color:#6a7078";
    del.onclick = () => { const l = readLib(); delete l[n]; writeLib(l); ov.remove(); openLoad(); };
    row.appendChild(load); row.appendChild(del); panel.appendChild(row);
  }

  const acts = document.createElement("div");
  acts.style.cssText = "display:flex;gap:8px;margin-top:14px";
  const imp = document.createElement("button"); imp.textContent = "Import file"; imp.style.cssText = btn + ";flex:1";
  imp.onclick = () => { ov.remove(); importFile(); };
  const exp = document.createElement("button"); exp.textContent = "Export file"; exp.style.cssText = btn + ";flex:1";
  exp.onclick = () => downloadText((ch.name || "untitled") + ".json", serializeChar(ch));
  const close = document.createElement("button"); close.textContent = "Close"; close.style.cssText = btn + ";flex:1";
  close.onclick = () => ov.remove();
  acts.append(imp, exp, close);
  panel.appendChild(acts);
  ov.appendChild(panel);
  document.body.appendChild(ov);
}

function importFile() {
  const apply = async (file) => { try { ch = JSON.parse(await file.text()); fitView(); syncBar(); } catch {} };
  if (window.showOpenFilePicker) {
    window.showOpenFilePicker({ types: [{ description: "Character", accept: { "application/json": [".json"] } }] })
      .then(async ([h]) => apply(await h.getFile())).catch(() => {});
  } else {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
    inp.onchange = () => apply(inp.files[0]); inp.click();
  }
}
document.getElementById("play").onclick = () => {
  localStorage.setItem("brawler:charDraft", serializeChar(ch));
  window.open(`${import.meta.env.BASE_URL}index.html?char=__draft`, "_blank");
};

// When opened from a multiplayer room (?room=CODE), this IS the required
// character step: the Play button becomes "Join game" and returns to the lobby.
const mpRoom = new URLSearchParams(location.search).get("room");
if (mpRoom) {
  const doJoin = () => {
    localStorage.setItem("brawler:charDraft", serializeChar(ch));
    location.href = `${import.meta.env.BASE_URL}lobby.html?room=${encodeURIComponent(mpRoom)}`;
  };
  const play = document.getElementById("play");
  play.textContent = "Join game ›";
  play.onclick = doJoin;
  // Always-visible floating button — the top toolbar can overflow off-screen on mobile.
  const fab = document.createElement("button");
  fab.textContent = "Join game ›";
  fab.className = "go";
  fab.style.cssText =
    "position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:50;" +
    "padding:13px 30px;font-size:15px;box-shadow:0 8px 24px -6px #000";
  fab.onclick = doJoin;
  document.body.appendChild(fab);
}
function downloadText(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
let statusTimer = 0;
function flashStatus(msg) {
  const el = document.getElementById("status");
  el.textContent = msg; clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (el.textContent = ""), 2500);
}
function syncBar() {
  document.getElementById("name").value = ch.name || "";
  document.getElementById("size").textContent = `${ch.w}×${ch.h}`;
}

// ----------------------------------------------------------------------------
//  Render
// ----------------------------------------------------------------------------
function loop() { draw(); drawPreviews(); requestAnimationFrame(loop); }

function draw() {
  ctx.clearRect(0, 0, view._w, view._h);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.zoom, view.zoom);

  // transparency checkerboard
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      ctx.fillStyle = (x + y) & 1 ? "#141619" : "#0e1013";
      ctx.fillRect(x, y, 1, 1);
    }
  // pixels
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = getPixel(ch, x, y);
      if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
    }
  // grid
  ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1 / view.zoom;
  ctx.beginPath();
  for (let x = 0; x <= W; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y++) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  // cube guides (every 8px = one map cube)
  ctx.strokeStyle = "rgba(84,224,200,0.25)"; ctx.lineWidth = 1.5 / view.zoom;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 8) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += 8) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  // hover
  if (hover.x >= 0 && hover.x < W && hover.y >= 0 && hover.y < H) {
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 / view.zoom;
    ctx.strokeRect(hover.x, hover.y, 1, 1);
  }
  ctx.restore();
}

function drawPreviews() {
  const sprite = makeSpriteCanvas(ch);
  // x6 preview
  const s = 6;
  pv.width = W * s; pv.height = H * s;
  pvc.imageSmoothingEnabled = false;
  pvc.clearRect(0, 0, pv.width, pv.height);
  blit(pvc, sprite, W * s, H * s);
  // in-game size preview (fighter box ~22x34, show at 3x)
  const gw = 22, gh = 34, gs = 3;
  pvg.width = gw * gs; pvg.height = gh * gs;
  pvgc.imageSmoothingEnabled = false;
  pvgc.clearRect(0, 0, pvg.width, pvg.height);
  blit(pvgc, sprite, gw * gs, gh * gs);
}
function blit(c2d, sprite, dw, dh) {
  c2d.save();
  if (flipPreview) { c2d.translate(dw, 0); c2d.scale(-1, 1); }
  c2d.drawImage(sprite, 0, 0, dw, dh);
  c2d.restore();
}

boot();
window.__creator = { get char() { return ch; }, tool, view, applyAt, pickColor };
