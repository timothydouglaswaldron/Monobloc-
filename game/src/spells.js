// ============================================================================
//  spells.js — the spell editor. Schema-driven form on the left, a looping live
//  preview on the right (a caster fires the spell at a dummy). Saves to the
//  localStorage spell library and can hand the chosen spell back to the lobby.
// ============================================================================
import { defaultSpell, SPELL_TYPES, allSpells, readSpellLib, writeSpellLib, saveSpell }
  from "./spell.js";

const $ = (id) => document.getElementById(id);
const room = new URLSearchParams(location.search).get("room");

let spell = defaultSpell("New Spell");
try { const last = localStorage.getItem("brawler:spell"); const all = allSpells();
      if (last && all[last]) spell = { ...all[last] }; } catch {}

// --- form schema ------------------------------------------------------------
const FIELDS = [
  { k: "type", label: "Type", kind: "select", opts: SPELL_TYPES },
  { k: "damage", label: "Damage", min: 0, max: 30, step: 1 },
  { k: "kbBase", label: "Knockback", min: 0, max: 500, step: 10 },
  { k: "kbScale", label: "KB growth", min: 0, max: 30, step: 1 },
  { k: "angle", label: "Angle°", min: -90, max: 90, step: 2 },
  { k: "startup", label: "Startup s", min: 0, max: 0.6, step: 0.01 },
  { k: "active", label: "Active s", min: 0.02, max: 0.4, step: 0.01 },
  { k: "recovery", label: "Recovery s", min: 0.05, max: 0.7, step: 0.01 },
  { k: "reach", label: "Reach", min: 0, max: 90, step: 2, types: ["melee", "lunge"] },
  { k: "height", label: "Height", min: 0, max: 90, step: 2, types: ["melee", "lunge"] },
  { k: "oy", label: "Y offset", min: -50, max: 20, step: 2 },
  { k: "selfVx", label: "Dash speed", min: 0, max: 600, step: 20, types: ["lunge"] },
  { k: "projSpeed", label: "Proj speed", min: 0, max: 700, step: 20, types: ["projectile"] },
  { k: "projRange", label: "Proj range", min: 0, max: 800, step: 20, types: ["projectile"] },
  { k: "projW", label: "Proj W", min: 2, max: 30, step: 1, types: ["projectile"] },
  { k: "projH", label: "Proj H", min: 2, max: 30, step: 1, types: ["projectile"] },
  { k: "color", label: "Color", kind: "color" },
];

function buildForm() {
  const root = $("form"); root.innerHTML = "";
  for (const f of FIELDS) {
    if (f.types && !f.types.includes(spell.type)) continue;   // hide irrelevant fields
    const row = document.createElement("div"); row.className = "fld";
    const lab = document.createElement("label"); lab.textContent = f.label; row.appendChild(lab);
    if (f.kind === "select") {
      const sel = document.createElement("select");
      for (const o of f.opts) { const op = document.createElement("option"); op.value = o; op.textContent = o; sel.appendChild(op); }
      sel.value = spell[f.k];
      sel.onchange = () => { spell[f.k] = sel.value; buildForm(); };
      row.appendChild(sel);
    } else if (f.kind === "color") {
      const c = document.createElement("input"); c.type = "color"; c.value = spell[f.k];
      c.oninput = () => { spell[f.k] = c.value; };
      row.appendChild(c);
    } else {
      const r = document.createElement("input"); r.type = "range";
      r.min = f.min; r.max = f.max; r.step = f.step; r.value = spell[f.k];
      const n = document.createElement("input"); n.type = "number";
      n.min = f.min; n.max = f.max; n.step = f.step; n.value = spell[f.k];
      const sync = (v) => { spell[f.k] = Number(v); r.value = v; n.value = v; };
      r.oninput = () => sync(r.value);
      n.oninput = () => sync(n.value);
      row.appendChild(r); row.appendChild(n);
    }
    root.appendChild(row);
  }
  $("name").value = spell.name || "";
}

$("name").addEventListener("input", (e) => (spell.name = e.target.value));

// --- toolbar ----------------------------------------------------------------
$("new").onclick = () => { spell = defaultSpell("New Spell"); buildForm(); };
$("save").onclick = () => {
  spell.name = (spell.name || "untitled").trim() || "untitled";
  saveSpell({ ...spell });
  localStorage.setItem("brawler:spell", spell.name);
  flash(`saved '${spell.name}'`);
  buildForm();
};
$("use").onclick = () => {
  spell.name = (spell.name || "untitled").trim() || "untitled";
  saveSpell({ ...spell });
  localStorage.setItem("brawler:spell", spell.name);
  location.href = room ? `${import.meta.env.BASE_URL}lobby.html?room=${encodeURIComponent(room)}`
                       : `${import.meta.env.BASE_URL}lobby.html`;
};
$("load").onclick = () => openLoad();

function openLoad() {
  const all = allSpells();
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;z-index:60;background:rgba(8,9,11,.85);display:grid;place-items:center";
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const btn = "background:#15191e;border:1px solid #2a2f36;color:#cfd2d6;border-radius:5px;padding:8px;font:inherit;font-size:12px;cursor:pointer";
  const panel = document.createElement("div");
  panel.style.cssText = "width:300px;max-height:80vh;overflow:auto;background:#0d0f12;border:1px solid #1c1f24;border-radius:10px;padding:18px";
  panel.innerHTML = `<div style="color:#b06af0;font-weight:700;letter-spacing:.12em;font-size:12px;margin-bottom:12px">SPELLS</div>`;
  const lib = readSpellLib();
  for (const n of Object.keys(all)) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #14171b";
    const b = document.createElement("button"); b.textContent = n + (lib[n] ? "" : "  (built-in)");
    b.style.cssText = btn + ";flex:1;text-align:left";
    b.onclick = () => { spell = { ...all[n] }; buildForm(); ov.remove(); flash(`loaded '${n}'`); };
    row.appendChild(b);
    if (lib[n]) {
      const d = document.createElement("button"); d.textContent = "✕"; d.style.cssText = btn + ";color:#6a7078";
      d.onclick = () => { const l = readSpellLib(); delete l[n]; writeSpellLib(l); ov.remove(); openLoad(); };
      row.appendChild(d);
    }
    panel.appendChild(row);
  }
  const close = document.createElement("button"); close.textContent = "Close"; close.style.cssText = btn + ";margin-top:12px;width:100%";
  close.onclick = () => ov.remove(); panel.appendChild(close);
  ov.appendChild(panel); document.body.appendChild(ov);
}

let flashMsg = "", flashT = 0;
function flash(m) { flashMsg = m; flashT = 2.2; }

// --- live preview -----------------------------------------------------------
// Every slider has a visible effect: timing bar (startup/active/recovery),
// projectile/melee visuals, and the dummy recoils by knockback at the chosen
// angle with a floating damage number (so Damage/Knockback/KB growth/Angle show).
const pv = $("pv"), ctx = pv.getContext("2d");
const GROUND = 180, CASTER = 70, HOME = 290;
let t = 0, proj = null, hitFlash = 0, last = performance.now();
let dmx = 0, dmy = 0, dvx = 0, dvy = 0;   // dummy recoil offset + velocity
const pops = [];                           // floating damage numbers

function hitDummy() {
  hitFlash = 0.18;
  const power = (spell.kbBase + spell.kbScale * 50) * 0.32;   // sample 50% damage
  const ang = (spell.angle * Math.PI) / 180;
  dvx += Math.cos(ang) * power;
  dvy += Math.sin(ang) * power;             // negative angle launches up
  pops.push({ x: HOME + dmx, y: GROUND - 46, life: 0.9, dmg: spell.damage });
}

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
  if (flashT > 0) flashT -= dt;
  const cycle = spell.startup + spell.active + spell.recovery + 0.7;
  const ct = t % cycle;
  const aS = spell.startup, aE = spell.startup + spell.active;
  const inActive = ct >= aS && ct < aE;
  if (ct < dt) proj = null;                 // reset at loop start
  if (spell.type === "projectile" && inActive && !proj && ct - aS < dt + 0.001)
    proj = { x: CASTER + 14, y: GROUND - 20, vx: spell.projSpeed * 0.5 };

  // dummy springs back to home after a recoil
  dvx += -dmx * 70 * dt; dvy += -dmy * 70 * dt;
  const damp = Math.exp(-7 * dt); dvx *= damp; dvy *= damp;
  dmx += dvx * dt; dmy += dvy * dt;
  if (dmy > 0) { dmy = 0; if (dvy > 0) dvy = 0; }   // feet never go below the ground line

  ctx.clearRect(0, 0, pv.width, pv.height);
  drawTiming(ct);
  ctx.strokeStyle = "#242c36"; ctx.beginPath(); ctx.moveTo(0, GROUND); ctx.lineTo(pv.width, GROUND); ctx.stroke();

  const dash = (spell.type === "lunge" && inActive) ? 14 : 0;
  drawGuy(CASTER + dash, 0, "#54e0c8");
  const dx = HOME + dmx;
  drawGuy(dx, dmy, hitFlash > 0 ? "#ffffff" : "#e0688a");

  if ((spell.type === "melee" || spell.type === "lunge") && inActive) {
    const x = CASTER + dash + 10, y = GROUND - 26 + spell.oy * 0.4;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, spell.reach * 0.6, Math.max(4, spell.height * 0.6));
    if (x + spell.reach * 0.6 >= dx - 6 && hitFlash <= 0) hitDummy();
  }
  if (proj) {
    proj.x += proj.vx * dt;
    ctx.fillStyle = spell.color;
    ctx.fillRect(proj.x - spell.projW / 2, proj.y - spell.projH / 2, spell.projW, spell.projH);
    if (Math.abs(proj.x - dx) < 10) { hitDummy(); proj = null; }
    else if (proj.x > CASTER + spell.projRange * 0.5 || proj.x > pv.width) proj = null;
  }
  if (hitFlash > 0) hitFlash -= dt;

  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]; p.life -= dt; p.y -= 22 * dt;
    if (p.life <= 0) { pops.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, p.life * 2.2);
    ctx.fillStyle = "#fff"; ctx.font = "bold 13px ui-monospace, monospace"; ctx.textAlign = "center";
    ctx.fillText(Math.round(p.dmg) + "%", p.x, p.y);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = "#5a5f66"; ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left";
  const phase = ct < aS ? "startup" : ct < aE ? "ACTIVE" : ct < aE + spell.recovery ? "recovery" : "—";
  ctx.fillText(`${spell.type}  ·  ${phase}`, 8, 16);
  if (flashT > 0) { ctx.fillStyle = "#b06af0"; ctx.textAlign = "right"; ctx.fillText(flashMsg, pv.width - 8, 16); }

  requestAnimationFrame(loop);
}

function drawGuy(x, yoff, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.strokeRect(x - 8, GROUND - 36 + yoff, 16, 36);
}

function drawTiming(ct) {
  const total = spell.startup + spell.active + spell.recovery || 1;
  const x0 = 20, w = pv.width - 40, y = pv.height - 22;
  const segs = [["#3a4049", spell.startup], ["#54e0c8", spell.active], ["#4a3f57", spell.recovery]];
  let x = x0;
  for (const [c, d] of segs) { const sw = (d / total) * w; ctx.fillStyle = c; ctx.fillRect(x, y, Math.max(1, sw - 1), 5); x += sw; }
  // playhead
  const px = x0 + Math.min(1, ct / total) * w;
  ctx.fillStyle = "#fff"; ctx.fillRect(px - 1, y - 2, 2, 9);
  ctx.fillStyle = "#5a5f66"; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "left";
  ctx.fillText("startup · active · recovery", x0, y - 4);
}

buildForm();
requestAnimationFrame(loop);
