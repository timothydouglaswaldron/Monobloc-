// ============================================================================
//  select.js — player-facing character + spell select with a live preview that
//  shows the chosen fighter running, attacking (A combo), and casting its spell
//  (B). Premade content only: chars from public/chars/index.json, built-in spells.
// ============================================================================
import { makeSpriteCanvas, spriteBounds } from "./char.js";
import { BUILTIN_SPELLS } from "./spell.js";

const $ = (id) => document.getElementById(id);
const base = import.meta.env.BASE_URL;
const room = new URLSearchParams(location.search).get("room");

const chosen = { char: null, spell: null };   // char = JSON, spell = spell object

$("name").value = localStorage.getItem("brawler:name") || ("P" + Math.floor(Math.random() * 90 + 10));
$("name").addEventListener("input", () => localStorage.setItem("brawler:name", $("name").value || "P"));

// --- premade characters -----------------------------------------------------
async function loadChars() {
  let list = [];
  try { list = await (await fetch(`${base}chars/index.json`)).json(); } catch {}
  const wrap = $("chars");
  for (const entry of list) {
    let json; try { json = await (await fetch(`${base}chars/${entry.file}.json`)).json(); } catch { continue; }
    const card = document.createElement("div");
    card.className = "card";
    const cv = makeSpriteCanvas(json);
    const view = document.createElement("canvas");
    view.width = cv.width; view.height = cv.height;
    view.style.height = "64px"; view.style.width = (cv.width / cv.height * 64) + "px";
    view.getContext("2d").drawImage(cv, 0, 0);
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = entry.name || json.name;
    card.append(view, nm);
    card.onclick = () => {
      chosen.char = json; setPreviewChar(json);
      for (const c of wrap.children) c.classList.toggle("sel", c === card);
      refresh();
    };
    wrap.appendChild(card);
  }
}

// --- premade spells ---------------------------------------------------------
function loadSpells() {
  const wrap = $("spells");
  for (const [name, sp] of Object.entries(BUILTIN_SPELLS)) {
    const el = document.createElement("div");
    el.className = "spell";
    el.innerHTML = `<div class="nm"><span class="swatch" style="background:${sp.color}"></span>${name}</div>
      <div class="meta">${sp.type} · ${sp.damage} dmg · kb ${sp.kbBase}</div>`;
    el.onclick = () => {
      chosen.spell = sp;
      for (const c of wrap.children) c.classList.toggle("sel", c === el);
      refresh();
    };
    wrap.appendChild(el);
  }
}

function refresh() { $("join").disabled = !(chosen.char && chosen.spell); }

$("join").onclick = () => {
  if (!chosen.char || !chosen.spell) return;
  localStorage.setItem("brawler:name", $("name").value || "P");
  localStorage.setItem("brawler:charDraft", JSON.stringify(chosen.char));
  localStorage.setItem("brawler:spell", chosen.spell.name);
  location.href = `${base}lobby.html${room ? "?room=" + encodeURIComponent(room) : ""}`;
};

// ============================================================================
//  Preview — loops RUN → ATTACK → SPELL using the chosen sprite + spell.
// ============================================================================
const pv = $("preview"), px = pv.getContext("2d");
const GROUND = pv.height - 54, SCALE = 5, CASTER = 70;
const FAR = pv.width - 64;        // dummy distance for projectiles (melee distance is computed)
let sprite = null, bounds = null;
let t = 0, last = performance.now(), groundScroll = 0, proj = null;
let dmx = 0, dvx = 0, dmy = 0, dvy = 0, dbx = FAR;   // dummy base x + recoil offset
const dust = [], pops = [];

function setPreviewChar(json) { sprite = makeSpriteCanvas(json); bounds = spriteBounds(json); t = 0; }

function drawFighter(cx, feetY, sx, sy, color) {
  if (!sprite) {
    px.strokeStyle = color; px.lineWidth = 2;
    px.strokeRect(cx - 12 * sx, feetY - 60 * sy, 24 * sx, 60 * sy);
    return;
  }
  const w = bounds.w * SCALE * sx, h = bounds.h * SCALE * sy;
  px.imageSmoothingEnabled = false;
  px.drawImage(sprite, bounds.x0, bounds.y0, bounds.w, bounds.h, cx - w / 2, feetY - h, w, h);
}

function dummy(color, hit) {
  const x = dbx + dmx, fy = GROUND + dmy;
  px.globalAlpha = 0.5;
  px.strokeStyle = hit ? "#fff" : color; px.lineWidth = 2;
  px.strokeRect(x - 11, fy - 50, 22, 50);
  px.globalAlpha = 1;
}

function recoil(spell) {
  const power = (spell.kbBase + spell.kbScale * 50) * 0.06;
  const a = (spell.angle * Math.PI) / 180;
  dvx += Math.cos(a) * power; dvy += Math.sin(a) * power;
  pops.push({ x: dbx + dmx, y: GROUND - 60, life: 0.9, dmg: spell.damage });
}

let hitFlash = 0;

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
  const sp = chosen.spell;
  // phase timings
  const RUN = 1.6, ATK = 1.2, SPL = sp ? sp.startup + sp.active + sp.recovery + 0.6 : 0.0001;
  const total = RUN + ATK + SPL;
  const ct = t % total;
  if (ct < dt) { proj = null; }                  // new cycle

  // dummy spring-back
  dvx += -dmx * 70 * dt; dvy += -dmy * 70 * dt;
  const damp = Math.exp(-7 * dt); dvx *= damp; dvy *= damp;
  dmx += dvx * dt; dmy += dvy * dt;
  if (dmy > 0) { dmy = 0; if (dvy > 0) dvy = 0; }
  if (hitFlash > 0) hitFlash -= dt;

  // melee/lunge reach short, so park the dummy right at the hitbox edge so the
  // hit (and damage) lands; projectiles keep the dummy far so the shot travels.
  let dTarget = FAR;
  if (sp && sp.type !== "projectile") {
    const dash = sp.type === "lunge" ? 16 : 0;
    dTarget = CASTER + dash + 12 + sp.reach * 0.7 + 4;
  }
  dbx += (dTarget - dbx) * Math.min(1, dt * 8);

  px.clearRect(0, 0, pv.width, pv.height);

  // ground + scrolling dashes (faster during RUN to sell motion)
  const running = ct < RUN;
  groundScroll = (groundScroll + (running ? 260 : 40) * dt) % 24;
  px.strokeStyle = "#242c36"; px.lineWidth = 1;
  px.beginPath(); px.moveTo(0, GROUND); px.lineTo(pv.width, GROUND); px.stroke();
  px.strokeStyle = "#1a1e24";
  for (let x = -24 + (24 - groundScroll); x < pv.width; x += 24) {
    px.beginPath(); px.moveTo(x, GROUND + 6); px.lineTo(x + 10, GROUND + 6); px.stroke();
  }

  let label = "";
  if (ct < RUN) {
    // ---- RUN: bob + lean + foot dust ----
    label = "run";
    const ph = ct * 13;
    const bob = Math.abs(Math.sin(ph)) * 7;
    const sx = 1 + Math.sin(ph * 2) * 0.04, sy = 1 - Math.sin(ph * 2) * 0.05;
    if (Math.sin(ph) < 0 && Math.sin(ph - dt * 13) >= 0)
      dust.push({ x: CASTER - 6, y: GROUND, vx: -60 - Math.random() * 40, vy: -20, life: 0.4 });
    drawFighter(CASTER, GROUND - bob, sx, sy, "#54e0c8");
  } else if (ct < RUN + ATK) {
    // ---- ATTACK: jab · jab · slam ----
    label = "attack";
    const at = ct - RUN;
    const beats = [0.0, 0.32, 0.64];             // jab, jab, slam
    let nudge = 0, active = false, reach = 26, big = false;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i], dur = i === 2 ? 0.16 : 0.1;
      if (at >= b && at < b + dur) { active = true; nudge = 10; reach = i === 2 ? 40 : 26; big = i === 2; }
    }
    drawFighter(CASTER + nudge, GROUND, 1, 1, "#54e0c8");
    if (active) {
      const x = CASTER + nudge + 12, y = GROUND - 34, h = big ? 34 : 22;
      px.strokeStyle = "#fff"; px.lineWidth = 1.5; px.strokeRect(x, y, reach, h);
      if (x + reach >= dbx + dmx - 6 && hitFlash <= 0) { hitFlash = 0.14; recoil({ kbBase: big ? 240 : 70, kbScale: 4, angle: -20, damage: big ? 10 : 3 }); }
    }
  } else if (sp) {
    // ---- SPELL ----
    label = "spell · " + sp.name;
    const st = ct - RUN - ATK;
    const aS = sp.startup, aE = sp.startup + sp.active, inActive = st >= aS && st < aE;
    const dash = (sp.type === "lunge" && inActive) ? 16 : 0;
    drawFighter(CASTER + dash, GROUND, 1, 1, "#54e0c8");
    if (sp.type === "projectile" && inActive && !proj && st - aS < dt + 0.001)
      proj = { x: CASTER + 20, y: GROUND - 28, vx: sp.projSpeed * 0.45 };
    if ((sp.type === "melee" || sp.type === "lunge") && inActive) {
      const x = CASTER + dash + 12, y = GROUND - 30 + sp.oy * 0.4;
      px.strokeStyle = sp.color; px.lineWidth = 1.5;
      px.strokeRect(x, y, sp.reach * 0.7, Math.max(5, sp.height * 0.7));
      if (x + sp.reach * 0.7 >= dbx + dmx - 6 && hitFlash <= 0) { hitFlash = 0.16; recoil(sp); }
    }
  }

  if (proj) {
    proj.x += proj.vx * dt;
    px.fillStyle = chosen.spell.color;
    px.fillRect(proj.x - chosen.spell.projW / 2, proj.y - chosen.spell.projH / 2, chosen.spell.projW, chosen.spell.projH);
    if (Math.abs(proj.x - (dbx + dmx)) < 12) { hitFlash = 0.16; recoil(chosen.spell); proj = null; }
    else if (proj.x > pv.width) proj = null;
  }

  // dummy + particles
  if (chosen.char) dummy("#e0688a", hitFlash > 0);
  for (let i = dust.length - 1; i >= 0; i--) {
    const d = dust[i]; d.life -= dt; if (d.life <= 0) { dust.splice(i, 1); continue; }
    d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 200 * dt;
    px.globalAlpha = d.life * 1.6; px.fillStyle = "#3a3f47"; px.fillRect(d.x, d.y, 2, 2); px.globalAlpha = 1;
  }
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]; p.life -= dt; p.y -= 22 * dt; if (p.life <= 0) { pops.splice(i, 1); continue; }
    px.globalAlpha = Math.min(1, p.life * 2.2); px.fillStyle = "#fff";
    px.font = "bold 12px ui-monospace, monospace"; px.textAlign = "center";
    px.fillText(Math.round(p.dmg) + "%", p.x, p.y); px.globalAlpha = 1;
  }

  $("pvlabel").textContent = sprite ? label : "";
  $("pvhint").textContent = !chosen.char ? "pick a character to preview"
    : !chosen.spell ? "pick a spell to see it cast" : "";
}

// rAF drives it when visible; a timer keeps it animating if the tab is throttled
let lastRaf = performance.now();
function frame(now) { lastRaf = now; tick(now); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
setInterval(() => { const now = performance.now(); if (now - lastRaf > 100) tick(now); }, 60);

loadChars();
loadSpells();
