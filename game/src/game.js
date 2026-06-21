// ============================================================================
//  BRAWLER — engine. Fixed-timestep physics, percent-based knockback.
//  Tunables live in CFG. Stage is loaded from a JSON map (see stage.js).
// ============================================================================
import { buildColliders, findSpawns, worldSize } from "./stage.js";
import { makeSpriteCanvas, spriteBounds } from "./char.js";
import { initTouch } from "./touch.js";
import { BUILTIN_SPELLS } from "./spell.js";

const CFG = {
  // --- view (camera output resolution; the world is bigger, see WORLD) ---
  width: 640, height: 360,
  maxZoom: 2.0, camLerp: 6, camPadX: 150, camPadY: 130,
  followZoom: 1.15,                   // mobile: fixed zoom while following the player (lower = wider FOV)
  gravity: 1400, fastFallMul: 1.9, maxFallSpeed: 1100,
  // --- ground movement ---
  runAccel: 4200, runSpeed: 230, groundFriction: 2600,
  // --- air movement ---
  airAccel: 2200, airSpeed: 215, airDrag: 120,
  // --- jumping (feel) ---
  jumpVel: 480, doubleJumpVel: 460, maxJumps: 2,
  jumpCutMul: 0.45, coyoteTime: 0.10, jumpBuffer: 0.12,
  // --- combat ---
  hitstopPerDamage: 0.004, hitstopMax: 0.16, attackBuffer: 0.18, comboGrace: 0.22,
  // --- juice ---
  shakeDamp: 9, squashRecover: 14,
  // --- stage ---
  blastPad: 220,
  startCountdown: 3.5,   // seconds of "3·2·1·GO" before a match begins
  // --- sprites + hitboxes (size derived from a fighter's lit-pixel bounds) ---
  spriteScale: 1.7,     // world px per sprite pixel (bigger = larger fighters)
  refSpritePx: 24,      // a "full" sprite is 24px tall; hitboxes scale vs this
  // --- stocks / respawn (Smash-style) ---
  lives: 3,
  spawnDelay: 0.9,      // s frozen at the spawn point after a KO
  spawnInvuln: 1.6,     // s of invulnerability after dropping back in
  // --- netcode (lower delay = snappier remotes, more correction on packet loss) ---
  netSendHz: 30,        // snapshot rate to the server
  netDelay: 55,         // ms remotes render behind real time (interpolation buffer)
  netExtrapMax: 160,    // ms we extrapolate forward from velocity when packets lag
};

const MOVES = {
  jab1: { startup:0.03, active:0.06, recovery:0.13, reach:30, height:24, oy:-22,
          damage:3, kbBase:60,  kbScale:2,  angle:-8  },
  jab2: { startup:0.03, active:0.06, recovery:0.14, reach:32, height:24, oy:-22,
          damage:3, kbBase:70,  kbScale:2,  angle:-8  },
  slam: { startup:0.10, active:0.10, recovery:0.30, reach:42, height:34, oy:-22,
          damage:11, kbBase:240, kbScale:14, angle:-44 },
  dashPunch: { startup:0.10, active:0.12, recovery:0.30, reach:40, height:30, oy:-22,
               damage:9, kbBase:210, kbScale:12, angle:-26, selfVx:360 },
};
const COMBO = ["jab1", "jab2", "slam"];

const DEFAULT_SPELL = BUILTIN_SPELLS["Dash Punch"];
const CHARS = {
  striker: { color:"#54e0c8", spell: DEFAULT_SPELL },
  rival:   { color:"#e0688a", spell: DEFAULT_SPELL },
  amber:   { color:"#e0b85a", spell: DEFAULT_SPELL },
  azure:   { color:"#6a9cf0", spell: DEFAULT_SPELL },
  violet:  { color:"#b06af0", spell: DEFAULT_SPELL },
  lime:    { color:"#7ee06a", spell: DEFAULT_SPELL },
  ember:   { color:"#f0823a", spell: DEFAULT_SPELL },
};
const ROSTER = ["striker", "rival", "amber", "azure", "violet", "lime", "ember"];

// --- Map-derived globals (set in applyMap) ---
let CELL = 20;
let WORLD = { w: 1280, h: 720 };
let platforms = [];
let spawns = [];
let floorY = Infinity;   // hard floor — fighters never fall below the main ground

// ----------------------------------------------------------------------------
//  Input
// ----------------------------------------------------------------------------
const keys = Object.create(null);
const pressed = Object.create(null);
const KEYMAP = {
  KeyA:"left", ArrowLeft:"left", KeyD:"right", ArrowRight:"right",
  KeyW:"jump", ArrowUp:"jump", Space:"jump",
  KeyS:"down", ArrowDown:"down",
  KeyJ:"attack", KeyK:"special", KeyR:"reset", KeyP:"freeze",
};
// Don't capture keys while the user is typing in a form field (e.g. naming a
// player in the lobby) — otherwise mapped letters get preventDefault'd away.
function typingInField(e) {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
addEventListener("keydown", e => {
  if (typingInField(e)) return;
  const a = KEYMAP[e.code]; if (!a) return;
  e.preventDefault();
  if (!keys[a]) pressed[a] = true;
  keys[a] = true;
});
addEventListener("keyup", e => {
  if (typingInField(e)) return;
  const a = KEYMAP[e.code]; if (!a) return;
  e.preventDefault();
  keys[a] = false;
});

const padHeld = Object.create(null);
const padPrev = Object.create(null);
const padPressed = Object.create(null);
addEventListener("gamepadconnected", e => console.log("gamepad:", e.gamepad.id));

// On-screen touch controller feeds the same action set.
const touchHeld = Object.create(null);
const touchPressed = Object.create(null);
function pressTouch(act) { if (!touchHeld[act]) touchPressed[act] = true; touchHeld[act] = true; }
function releaseTouch(act) { touchHeld[act] = false; }

// Touch/mobile detection — drives the on-screen controls and the follow-camera.
const MOBILE = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0 ||
               new URLSearchParams(location.search).has("touch");

function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let gp = null;
  for (const p of pads) if (p) { gp = p; break; }
  const next = Object.create(null);
  if (gp) {
    const b = i => gp.buttons[i] && gp.buttons[i].pressed;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    next.left  = b(14) || ax < -0.4;  next.right = b(15) || ax > 0.4;
    next.jump  = b(12) || ay < -0.5;  next.down  = b(13) || ay > 0.5;
    next.attack = b(0); next.special = b(1); next.reset = b(9); next.freeze = b(8);
  }
  for (const k of ["left","right","jump","down","attack","special","reset","freeze"]) {
    padPressed[k] = !!next[k] && !padPrev[k];
    padHeld[k] = !!next[k];
    padPrev[k] = !!next[k];
  }
}

// ----------------------------------------------------------------------------
//  Fighter — `control` is "local" (you), "cpu" (AI we simulate), or
//  "remote" (another player; driven by interpolated network snapshots).
// ----------------------------------------------------------------------------
const DEFAULT_BOUNDS = { x0: 0, y0: 0, x1: 15, y1: 23, w: 16, h: 24 }; // wireframe size

function makeFighter(spec) {
  // resolve the character (direct, or from a key + optional wire sprite JSON)
  let char = spec.char ? { ...spec.char } : { ...(CHARS[spec.charKey] || CHARS.striker) };
  if (spec.color) char.color = spec.color;
  if (spec.spriteJSON && !char.sprite) {
    char.sprite = makeSpriteCanvas(spec.spriteJSON);
    char.boundsPx = spriteBounds(spec.spriteJSON);
  }
  if (spec.spell) char.spell = spec.spell;          // chosen B-button spell
  if (!char.spell) char.spell = DEFAULT_SPELL;
  // body size = lit-pixel bounds * scale (so hurtbox matches what's drawn)
  const b = char.boundsPx || DEFAULT_BOUNDS;
  const w = Math.max(8, Math.round(b.w * CFG.spriteScale));
  const h = Math.max(12, Math.round(b.h * CFG.spriteScale));
  return {
    id: spec.id ?? null, name: spec.name, control: spec.control,
    char, color: char.color, isPlayer: spec.control === "local",
    x: 0, y: 0, w, h, vx: 0, vy: 0, facing: 1,
    onGround: false, jumps: CFG.maxJumps, coyote: 0, buffer: 0,
    percent: 0, squashX: 1, squashY: 1,
    attack: null, comboStep: -1, comboGrace: 0, atkBuf: 0, hitstop: 0, aiTimer: 0,
    lives: CFG.lives, out: false, respawn: 0, invuln: 0,   // stocks / respawn
    netBuf: [],
  };
}

// Session ties the engine to the network layer. In solo, net stays null and
// amHost stays true, so every fighter is simulated locally exactly as before.
const session = { mode: "solo", amHost: true, myId: null, net: null };

const state = {
  fighters: [], particles: [], projectiles: [], shake: 0, shakeX: 0, shakeY: 0, flash: 0, t: 0,
  freezeCPU: false, cam: { cx: 640, cy: 360, zoom: 1 }, map: null,
  phase: "fighting", countdown: 0, winner: null, matchSize: 0,   // match lifecycle
};

// True for fighters this client is the authority for (simulates + sends).
function isMine(f) { return f.control === "local" || (session.amHost && f.control === "cpu"); }

const IDLE_INPUT = { left:false, right:false, jump:false, down:false,
                     jumpPressed:false, attackPressed:false, specialPressed:false };

function applyMap(map) {
  state.map = map;
  CELL = map.cell;
  WORLD = worldSize(map);
  platforms = buildColliders(map);
  spawns = findSpawns(map);
  // floor = top of the widest solid platform (the main ground); fighters can't
  // fall below it, so they're only ever KO'd off the sides or top.
  let ground = null;
  for (const p of platforms) if (p.solid && (!ground || p.w > ground.w)) ground = p;
  floorY = ground ? ground.y : WORLD.h;
  state.cam = { cx: WORLD.w / 2, cy: WORLD.h / 2, zoom: 1 };
}

function spawnAt(slot, n) {
  return spawns.length
    ? spawns[slot % spawns.length]
    : { x: WORLD.w * (slot + 1) / (n + 1), y: WORLD.h * 0.62 };
}

// Build fighters from a roster of specs: { id, name, charKey, control, slot }.
function buildRoster(specs) {
  state.fighters = specs.map((spec) => {
    const f = makeFighter(spec);
    const sp = spawnAt(spec.slot, specs.length);
    f.x = sp.x - f.w / 2; f.y = sp.y - f.h - 4;
    return f;
  });
  state.particles.length = 0;
  state.projectiles.length = 0;
  state.shake = 0; state.flash = 0;
  state.cam = { cx: WORLD.w / 2, cy: WORLD.h / 2, zoom: 1 };
}

// Reconcile the live fighter list against a roster (late-join, leave, host
// migration) WITHOUT resetting fighters that are already in the match.
export function syncRoster(specs, amHost) {
  session.amHost = amHost;
  const ids = new Set(specs.map((s) => s.id));
  state.fighters = state.fighters.filter((f) => ids.has(f.id));   // drop those who left
  for (const s of specs) {
    const f = state.fighters.find((x) => x.id === s.id);
    if (!f) {                                       // new fighter — drop them in at spawn
      const nf = makeFighter(s);
      const sp = spawnAt(s.slot, specs.length);
      nf.x = sp.x - nf.w / 2; nf.y = sp.y - nf.h - 4;
      state.fighters.push(nf);
    } else {                                        // existing — refresh control (host migration) + name
      f.control = s.control; f.isPlayer = s.control === "local"; f.name = s.name;
    }
  }
}

// Solo roster: you + CPUs, exactly the old behavior.
function reset() {
  buildRoster(ROSTER.map((key, i) => ({
    id: "L" + i, name: i === 0 ? "P1" : "CPU" + i, charKey: key,
    control: i === 0 ? "local" : "cpu", slot: i,
  })));
}

// ----------------------------------------------------------------------------
//  Physics helpers
// ----------------------------------------------------------------------------
function approach(v, target, delta) {
  if (v < target) return Math.min(v + delta, target);
  if (v > target) return Math.max(v - delta, target);
  return v;
}
function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ----------------------------------------------------------------------------
//  Fighter update (movement + collision + jump feel)
// ----------------------------------------------------------------------------
function updateFighter(f, dt, input) {
  if (f.out) return;                                 // eliminated — out of play
  if (f.invuln > 0) f.invuln -= dt;
  if (f.respawn > 0) {                               // frozen at the spawn point
    f.respawn -= dt; f.vx = 0; f.vy = 0;
    if (f.respawn <= 0) f.invuln = Math.max(f.invuln, CFG.spawnInvuln);
    return;
  }
  // first action ends spawn invulnerability early (Smash-style)
  if (f.invuln > 0 && (input.attackPressed || input.specialPressed)) f.invuln = 0;
  if (f.hitstop > 0) { f.hitstop -= dt; return; }
  const wasGround = f.onGround;

  let move = 0;
  if (input.left)  move -= 1;
  if (input.right) move += 1;
  if (move !== 0) f.facing = move;

  const canAct = !f.attack || f.attack.phase === "recovery";
  const curMove = f.attack ? f.attack.def : null;
  const lunging = curMove && curMove.selfVx && f.attack.phase !== "recovery";

  if (move !== 0 && canAct) {
    const accel = f.onGround ? CFG.runAccel : CFG.airAccel;
    const top   = f.onGround ? CFG.runSpeed : CFG.airSpeed;
    f.vx = approach(f.vx, move * top, accel * dt);
  } else if (!lunging) {
    const drag = f.onGround ? CFG.groundFriction : CFG.airDrag;
    f.vx = approach(f.vx, 0, drag * dt);
  }

  if (input.jumpPressed) f.buffer = CFG.jumpBuffer;
  f.buffer = Math.max(0, f.buffer - dt);
  if (f.onGround) f.coyote = CFG.coyoteTime;
  else f.coyote = Math.max(0, f.coyote - dt);

  if (f.buffer > 0 && canAct) {
    if (f.coyote > 0) {
      f.vy = -CFG.jumpVel; f.buffer = 0; f.coyote = 0;
      f.jumps = CFG.maxJumps - 1; f.onGround = false; spawnDust(f, 8);
    } else if (f.jumps > 0) {
      f.vy = -CFG.doubleJumpVel; f.buffer = 0; f.jumps--; spawnDust(f, 6);
    }
  }
  if (!input.jump && f.vy < 0) f.vy *= Math.pow(CFG.jumpCutMul, dt * 60) || 1;

  let g = CFG.gravity;
  if (!f.onGround && input.down && f.vy > -40) g *= CFG.fastFallMul;
  f.vy = Math.min(f.vy + g * dt, CFG.maxFallSpeed);

  f.x += f.vx * dt;
  resolveX(f);
  f.onGround = false;
  f.y += f.vy * dt;
  resolveY(f, input.down);

  // hard floor: never let a fighter fall below the main ground (catches edges/void)
  if (f.y + f.h > floorY) { f.y = floorY - f.h; if (f.vy > 0) f.vy = 0; f.onGround = true; }

  if (f.onGround) {
    f.jumps = CFG.maxJumps;
    if (!wasGround && f.vy >= 0) {
      const impact = Math.min(1, Math.abs(f._lastFallVy || 0) / 700);
      f.squashX = 1 + 0.35 * impact;
      f.squashY = 1 - 0.30 * impact;
      if (impact > 0.3) spawnDust(f, 10);
    }
  }
  f._lastFallVy = f.vy;

  // attacks: A = combo string, B = special
  if (input.attackPressed) f.atkBuf = CFG.attackBuffer;
  f.atkBuf = Math.max(0, f.atkBuf - dt);
  f.comboGrace = Math.max(0, f.comboGrace - dt);
  if (f.comboGrace === 0 && !f.attack) f.comboStep = -1;

  if (input.specialPressed && canAct) {
    startMove(f, f.char.spell, "special");
    f.comboStep = -1; f.atkBuf = 0;
  } else if (f.atkBuf > 0) {
    const canChain = f.comboStep >= 0 && f.comboStep < COMBO.length - 1 &&
                     (f.attack ? f.attack.canCancel : f.comboGrace > 0);
    if (canChain) {
      const k = COMBO[++f.comboStep]; startMove(f, MOVES[k], k); f.atkBuf = 0;
    } else if (!f.attack) {
      f.comboStep = 0; startMove(f, MOVES[COMBO[0]], COMBO[0]); f.atkBuf = 0;
    }
  }
  updateAttack(f, dt);

  f.squashX = approach(f.squashX, 1, CFG.squashRecover * dt * Math.abs(f.squashX - 1 || 1));
  f.squashY = approach(f.squashY, 1, CFG.squashRecover * dt * Math.abs(f.squashY - 1 || 1));

  if (f.x < -CFG.blastPad || f.x > WORLD.w + CFG.blastPad ||
      f.y > WORLD.h + CFG.blastPad || f.y < -CFG.blastPad - 120) {
    koFighter(f);
  }
}

function resolveX(f) {
  for (const p of platforms) {
    if (!p.solid) continue;
    if (aabb(f.x, f.y, f.w, f.h, p.x, p.y, p.w, p.h)) {
      if (f.vx > 0) f.x = p.x - f.w;
      else if (f.vx < 0) f.x = p.x + p.w;
      f.vx = 0;
    }
  }
}

function resolveY(f, holdingDown) {
  for (const p of platforms) {
    if (!aabb(f.x, f.y, f.w, f.h, p.x, p.y, p.w, p.h)) continue;
    if (f.vy >= 0) {
      const feetPrev = f.y + f.h - f.vy * (1/60);
      const fromAbove = feetPrev <= p.y + 6;
      if (p.solid || (fromAbove && !holdingDown)) {
        f.y = p.y - f.h; f.vy = 0; f.onGround = true;
      }
    } else if (p.solid) {
      f.y = p.y + p.h; f.vy = 0;
    }
  }
}

// ----------------------------------------------------------------------------
//  Attacks + knockback
// ----------------------------------------------------------------------------
// def = a move object (from MOVES for the combo, or a spell for the special).
// tag is the string we put on the wire (a MOVES key, or "special").
function startMove(f, def, tag) {
  f.attack = { def, tag, t: 0, phase: "startup", canCancel: false, hit: new Set(), fired: false };
  if (def.selfVx) f.vx = f.facing * def.selfVx;
  if (def.selfVy) f.vy = def.selfVy;
}

function updateAttack(f, dt) {
  if (!f.attack) return;
  const a = f.attack, m = a.def;
  a.t += dt;
  if (a.t < m.startup) a.phase = "startup";
  else if (a.t < m.startup + m.active) a.phase = "active";
  else if (a.t < m.startup + m.active + m.recovery) a.phase = "recovery";
  else { f.attack = null; f.comboGrace = CFG.comboGrace; return; }
  a.canCancel = a.phase === "recovery";

  if (a.phase !== "active") return;

  if (m.type === "projectile") {
    if (!a.fired) { a.fired = true; spawnProjectile(f, m); }   // fire once
    return;
  }
  // melee / lunge — a hitbox in front
  const hb = hitboxRect(f, m);
  for (const o of state.fighters) {
    if (o === f || a.hit.has(o) || o.out || o.invuln > 0) continue;
    if (aabb(hb.x, hb.y, hb.w, hb.h, o.x, o.y, o.w, o.h)) {
      a.hit.add(o);
      resolveHit(f, o, m);
    }
  }
}

// Hitbox reach/size scale with the fighter's body height — a small fighter has a
// small, close hitbox (no invisible hands / oversized boxes on big fighters).
function hitboxRect(f, m) {
  const s = f.h / (CFG.refSpritePx * CFG.spriteScale);   // 1.0 for a full-size sprite
  const reach = m.reach * s, height = m.height * s, oy = m.oy * s;
  const cx = f.x + f.w / 2;
  const x = f.facing > 0 ? cx : cx - reach;
  return { x, y: f.y + f.h / 2 + oy, w: reach, h: height };
}

function applyHit(attacker, victim, m) {
  if (victim.out || victim.invuln > 0) return;   // can't hit the dead or invulnerable
  victim.percent += m.damage;
  const power = m.kbBase + m.kbScale * victim.percent;
  const ang = (m.angle * Math.PI) / 180;
  victim.vx = Math.cos(ang) * power * attacker.facing;
  victim.vy = Math.sin(ang) * power;
  victim.onGround = false;
  victim.attack = null; victim.comboStep = -1; victim.comboGrace = 0;

  const hs = Math.min(CFG.hitstopMax, m.damage * CFG.hitstopPerDamage + 0.03);
  attacker.hitstop = hs;
  victim.hitstop = hs * 1.1;

  hitFx(victim, m);
}

// Cosmetic impact feedback (sparks, shake, flash) — shown on whoever is watching
// the contact, including the attacker landing a hit on a remote opponent.
function hitFx(victim, m) {
  state.shake = Math.min(16, state.shake + 4 + m.damage * 0.5);
  state.flash = 0.08;
  spawnHitSpark(victim, m);
}

// Attacker-authoritative: if the victim is ours, apply now; otherwise tell the
// victim's client to apply it — but still show the impact + hitstop locally so
// landing a hit on a remote opponent feels the same as a local one.
function resolveHit(attacker, victim, m) {
  if (isMine(victim)) { applyHit(attacker, victim, m); return; }
  if (session.net) {
    // send the resolved params so the victim can apply any spell without knowing it
    session.net.sendHit({ to: victim.id, dmg: m.damage, kb: m.kbBase, ks: m.kbScale,
                          ang: m.angle, fac: attacker.facing });
    attacker.hitstop = Math.min(CFG.hitstopMax, m.damage * CFG.hitstopPerDamage + 0.03);
    hitFx(victim, m);
  }
}

// Incoming hit from a remote attacker — apply the carried params to our fighter.
export function receiveHit(h) {
  const v = state.fighters.find((f) => f.id === h.to);
  if (!v || !isMine(v) || v.out || v.invuln > 0) return;
  v.percent += h.dmg;
  const power = h.kb + h.ks * v.percent;
  const ang = (h.ang * Math.PI) / 180;
  v.vx = Math.cos(ang) * power * h.fac; v.vy = Math.sin(ang) * power;
  v.onGround = false; v.attack = null; v.comboStep = -1; v.comboGrace = 0;
  v.hitstop = Math.min(CFG.hitstopMax, h.dmg * CFG.hitstopPerDamage + 0.03) * 1.1;
  hitFx(v, { damage: h.dmg });
}

// ----------------------------------------------------------------------------
//  Projectiles
// ----------------------------------------------------------------------------
function spawnProjectile(f, m) {
  const s = f.h / (CFG.refSpritePx * CFG.spriteScale);
  const x = f.x + f.w / 2, y = f.y + f.h / 2 + (m.oy || -12) * s;
  const vx = f.facing * m.projSpeed;
  state.projectiles.push({
    x, y, vx, w: m.projW, h: m.projH, color: m.color || "#fff",
    life: m.projRange / Math.max(1, m.projSpeed),
    ownerId: f.id, mine: isMine(f), def: m,
  });
  if (isMine(f) && session.net) {
    session.net.sendProj({ owner: f.id, x: Math.round(x), y: Math.round(y), vx: Math.round(vx),
      w: m.projW, h: m.projH, color: m.color, range: m.projRange,
      dmg: m.damage, kb: m.kbBase, ks: m.kbScale, ang: m.angle });
  }
}

// A projectile from a remote owner — visual only (its owner resolves hits).
export function receiveProj(p) {
  state.projectiles.push({
    x: p.x, y: p.y, vx: p.vx, w: p.w, h: p.h, color: p.color || "#fff",
    life: p.range / Math.max(1, Math.abs(p.vx)), ownerId: p.owner, mine: false, def: null,
  });
}

function updateProjectiles(dt) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    p.x += p.vx * dt; p.life -= dt;
    let dead = p.life <= 0 || p.x < -50 || p.x > WORLD.w + 50;
    if (!dead && p.mine) {
      const owner = state.fighters.find((f) => f.id === p.ownerId);
      for (const o of state.fighters) {
        if (o.id === p.ownerId || o.out || o.invuln > 0) continue;
        if (aabb(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, o.x, o.y, o.w, o.h)) {
          if (owner) resolveHit(owner, o, p.def);
          spawnHitSpark(o, p.def); dead = true; break;
        }
      }
    }
    if (dead) state.projectiles.splice(i, 1);
  }
}

function koFighter(f) {
  state.shake = 18; state.flash = 0.12;
  spawnBurst(f.x + f.w / 2, f.y + f.h / 2, f.color, 26);
  f.lives -= 1;
  f.vx = 0; f.vy = 0; f.percent = 0; f.jumps = CFG.maxJumps;
  f.attack = null; f.hitstop = 0; f.comboStep = -1; f.comboGrace = 0;
  if (f.lives <= 0) { f.out = true; f.respawn = 0; f.invuln = 0; return; }
  // Smash-style respawn: appear at the top spawn, frozen + invulnerable briefly.
  const sp = spawns.length ? spawns[0] : { x: WORLD.w / 2, y: 60 };
  f.x = sp.x - f.w / 2; f.y = 40;          // appear near the top, then drop in
  f.respawn = CFG.spawnDelay;
  f.invuln = CFG.spawnDelay + CFG.spawnInvuln;
}

// ----------------------------------------------------------------------------
//  Particles
// ----------------------------------------------------------------------------
function spawnDust(f, n) {
  for (let i = 0; i < n; i++) state.particles.push({
    x: f.x + f.w / 2 + (Math.random() - 0.5) * f.w, y: f.y + f.h,
    vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 80,
    life: 0.4, max: 0.4, col: "#3a3f47", r: 2,
  });
}
function spawnHitSpark(f) {
  const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, s = 120 + Math.random() * 220;
    state.particles.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.32, max: 0.32, col: "#ffffff", r: 2.5 });
  }
}
function spawnBurst(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 140 + Math.random() * 280;
    state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.6, max: 0.6, col, r: 3 });
  }
}
function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt;
    if (p.life <= 0) { state.particles.splice(i, 1); continue; }
    p.vy += 600 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
}

// ----------------------------------------------------------------------------
//  CPU
// ----------------------------------------------------------------------------
function nearestOpponent(f) {
  let best = null, bd = Infinity;
  for (const o of state.fighters) {
    if (o === f || o.out) continue;
    const d = Math.hypot(o.x - f.x, o.y - f.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
function aiInput(f, dt) {
  const p = nearestOpponent(f);
  if (!p) return IDLE_INPUT;
  f.aiTimer -= dt;
  const dx = (p.x + p.w / 2) - (f.x + f.w / 2);
  const dist = Math.abs(dx);
  const inp = { left:false, right:false, jump:false, down:false,
                jumpPressed:false, attackPressed:false, specialPressed:false };
  if (dist > 40) { if (dx < 0) inp.left = true; else inp.right = true; }
  if (p.y + p.h < f.y - 10 && f.onGround && f.aiTimer < 0) {
    inp.jumpPressed = true; inp.jump = true; f.aiTimer = 0.8;
  }
  if (dist < 50 && f.aiTimer < 0) {
    if (Math.random() < 0.25) inp.specialPressed = true; else inp.attackPressed = true;
    f.aiTimer = 0.30;
  }
  return inp;
}

function playerInput() {
  return {
    left:  !!keys.left  || !!padHeld.left  || !!touchHeld.left,
    right: !!keys.right || !!padHeld.right || !!touchHeld.right,
    jump:  !!keys.jump  || !!padHeld.jump  || !!touchHeld.jump,
    down:  !!keys.down  || !!padHeld.down  || !!touchHeld.down,
    jumpPressed:    !!pressed.jump    || !!padPressed.jump    || !!touchPressed.jump,
    attackPressed:  !!pressed.attack  || !!padPressed.attack  || !!touchPressed.attack,
    specialPressed: !!pressed.special || !!padPressed.special || !!touchPressed.special,
  };
}

// ----------------------------------------------------------------------------
//  Loop
// ----------------------------------------------------------------------------
const STEP = 1 / 120;
let acc = 0, last = performance.now();

function tick(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  while (acc >= STEP) {
    step(STEP); acc -= STEP;
    for (const k in pressed) pressed[k] = false;
    for (const k in touchPressed) touchPressed[k] = false;
  }
  render();
}

let lastRaf = performance.now();
function frame(now) { lastRaf = now; tick(now); requestAnimationFrame(frame); }

function step(dt) {
  pollGamepad();
  // reset/freeze are solo conveniences; ignore in multiplayer
  if ((pressed.reset || padPressed.reset) && session.mode === "solo") reset();
  if ((pressed.freeze || padPressed.freeze) && session.mode === "solo")
    state.freezeCPU = !state.freezeCPU;

  // pre-fight countdown: fighters wait at spawn
  if (state.phase === "countdown") {
    state.countdown -= dt;
    if (state.countdown <= 0) state.phase = "fighting";
    updateParticles(dt); updateCamera(dt); state.t += dt;
    return;
  }

  const frozen = state.phase === "over";   // match decided — fighters hold

  for (const f of state.fighters) {
    if (frozen) { if (f.control === "remote") interpolateRemote(f); continue; }
    if (f.control === "remote") { interpolateRemote(f); continue; }  // network-driven
    const input = f.control === "local" ? playerInput()
                : state.freezeCPU ? IDLE_INPUT
                : aiInput(f, dt);
    updateFighter(f, dt, input);
  }
  updateParticles(dt);
  updateProjectiles(dt);
  updateCamera(dt);

  state.shake = Math.max(0, state.shake - CFG.shakeDamp * dt * Math.max(1, state.shake));
  state.shakeX = (Math.random() - 0.5) * state.shake;
  state.shakeY = (Math.random() - 0.5) * state.shake;
  if (state.flash > 0) state.flash = Math.max(0, state.flash - dt);
  state.t += dt;

  // last fighter standing wins
  if (state.phase === "fighting" && state.matchSize >= 2) {
    const alive = state.fighters.filter((f) => !f.out);
    if (alive.length <= 1) endMatch(alive[0] || null);
  }

  if (session.net) netTick(dt);   // send snapshots for fighters we own
}

// --- networking glue (no-ops in solo) --------------------------------------
let netAcc = 0;

function snapshotFighter(f) {
  return {
    id: f.id,
    x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10,
    vx: Math.round(f.vx), vy: Math.round(f.vy),
    facing: f.facing, pct: Math.round(f.percent), g: f.onGround ? 1 : 0,
    atk: f.attack ? f.attack.tag : null, ap: f.attack ? f.attack.phase : null,
    lv: f.lives, out: f.out ? 1 : 0, inv: f.invuln > 0 ? 1 : 0,
  };
}

function netTick(dt) {
  netAcc += dt;
  if (netAcc < 1 / CFG.netSendHz) return;
  netAcc = 0;
  const snaps = state.fighters.filter(isMine).map(snapshotFighter);
  if (snaps.length) session.net.sendSnapshots(snaps);
}

// Buffer an incoming snapshot for a remote fighter.
export function receiveSnapshot(snap) {
  const f = state.fighters.find((x) => x.id === snap.id);
  if (f && f.control === "remote") f.netBuf.push({ ...snap, t: performance.now() });
}

// Drive a remote fighter from buffered snapshots. We render a short netDelay in
// the past and interpolate between the two bracketing snapshots; if none is far
// enough ahead (packets lagging), we extrapolate forward from the latest using
// its velocity (capped) so motion stays continuous instead of stalling.
function interpolateRemote(f) {
  const buf = f.netBuf;
  if (!buf.length) return;
  const target = performance.now() - CFG.netDelay;
  while (buf.length >= 2 && buf[1].t <= target) buf.shift();

  let s;
  if (buf.length >= 2 && buf[0].t <= target) {       // interpolate
    const a = buf[0], b = buf[1], span = b.t - a.t || 1;
    const u = Math.max(0, Math.min(1, (target - a.t) / span));
    f.x = a.x + (b.x - a.x) * u; f.y = a.y + (b.y - a.y) * u; s = b;
  } else {                                           // extrapolate from newest
    s = buf[buf.length - 1];
    const ahead = Math.min(CFG.netExtrapMax, Math.max(0, target - s.t)) / 1000;
    f.x = s.x + s.vx * ahead; f.y = s.y + s.vy * ahead;
  }
  f.vx = s.vx; f.vy = s.vy; f.facing = s.facing;
  f.percent = s.pct; f.onGround = !!s.g;
  if (s.lv !== undefined) f.lives = s.lv;
  f.out = !!s.out; f.invuln = s.inv ? 0.1 : 0;        // mirror stock state for display + hit guards
  // resolve the move def for rendering: combo moves from MOVES, special from this fighter's spell
  if (s.atk) {
    const def = s.atk === "special" ? f.char.spell : MOVES[s.atk];
    f.attack = def ? { def, tag: s.atk, phase: s.ap, t: 0, canCancel: false, hit: new Set() } : null;
  } else f.attack = null;
}

function updateCamera(dt) {
  let cx, cy, zoom;
  const minZoom = Math.max(CFG.width / WORLD.w, CFG.height / WORLD.h);

  const live = state.fighters.filter((f) => !f.out);
  if (MOBILE) {
    // Mobile: anchor to the local player (or any live fighter) at a fixed zoom.
    const me = state.fighters.find((f) => f.control === "local" && !f.out) || live[0];
    zoom = CFG.followZoom;
    cx = me ? me.x + me.w / 2 : WORLD.w / 2;
    cy = me ? me.y + me.h / 2 : WORLD.h / 2;
  } else {
    // Desktop: frame all live fighters.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of (live.length ? live : state.fighters)) {
      minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x + f.w);
      minY = Math.min(minY, f.y); maxY = Math.max(maxY, f.y + f.h);
    }
    const boxW = (maxX - minX) + CFG.camPadX * 2;
    const boxH = (maxY - minY) + CFG.camPadY * 2;
    zoom = Math.min(CFG.width / boxW, CFG.height / boxH);
    cx = (minX + maxX) / 2; cy = (minY + maxY) / 2;
  }

  zoom = Math.max(minZoom, Math.min(CFG.maxZoom, zoom));
  const halfW = CFG.width / (2 * zoom), halfH = CFG.height / (2 * zoom);
  cx = Math.max(halfW, Math.min(WORLD.w - halfW, cx));
  cy = Math.max(halfH, Math.min(WORLD.h - halfH, cy));
  const k = Math.min(1, dt * CFG.camLerp);
  const c = state.cam;
  c.cx += (cx - c.cx) * k; c.cy += (cy - c.cy) * k; c.zoom += (zoom - c.zoom) * k;
}

// ----------------------------------------------------------------------------
//  Render
// ----------------------------------------------------------------------------
const cv = document.getElementById("game");
const ctx = cv.getContext("2d");

function fit() {
  const scale = Math.max(1, Math.floor(Math.min(
    window.innerWidth / CFG.width, window.innerHeight / CFG.height)));
  cv.width = CFG.width; cv.height = CFG.height;
  cv.style.width  = CFG.width  * scale + "px";
  cv.style.height = CFG.height * scale + "px";
}
addEventListener("resize", fit); fit();

function render() {
  ctx.clearRect(0, 0, CFG.width, CFG.height);
  ctx.save();
  ctx.translate(state.shakeX, state.shakeY);

  const cam = state.cam, inv = 1 / cam.zoom;
  ctx.translate(CFG.width / 2, CFG.height / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.cx, -cam.cy);

  drawGrid();

  ctx.strokeStyle = "#1a2028"; ctx.lineWidth = inv;
  ctx.strokeRect(0.5, 0.5, WORLD.w - 1, WORLD.h - 1);

  for (const p of platforms) {
    ctx.lineWidth = inv;
    ctx.strokeStyle = p.solid ? "#2f3946" : "#242c36";
    ctx.strokeRect(p.x + 0.5 * inv, p.y + 0.5 * inv, p.w - inv, p.h - inv);
    if (!p.solid) {
      ctx.strokeStyle = "#1c232b";
      ctx.beginPath(); ctx.moveTo(p.x, p.y + p.h); ctx.lineTo(p.x + p.w, p.y + p.h); ctx.stroke();
    }
  }

  for (const f of state.fighters) drawFighter(f);
  drawProjectiles();
  drawParticles();
  ctx.restore();

  drawHud();

  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${state.flash * 2})`;
    ctx.fillRect(0, 0, CFG.width, CFG.height);
  }

  drawCountdown();
}

// Big centered "3 · 2 · 1 · GO" before the match (results UI is DOM in mp.js).
function drawCountdown() {
  if (state.phase !== "countdown") return;
  const c = state.countdown;
  const n = Math.ceil(c - 0.5);
  const txt = n >= 1 ? String(n) : "GO";
  const frac = txt === "GO" ? c / 0.5 : (c - 0.5) % 1;   // 1→0 within each beat
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.globalAlpha = Math.max(0, Math.min(1, frac * 1.6));
  ctx.fillStyle = txt === "GO" ? "#54e0c8" : "#ffffff";
  ctx.font = `800 ${72 - frac * 14}px ui-monospace, monospace`;
  ctx.fillText(txt, CFG.width / 2, CFG.height / 2 - 10);
  ctx.restore();
}

function drawGrid() {
  ctx.strokeStyle = "#121519"; ctx.lineWidth = 1 / state.cam.zoom;
  ctx.beginPath();
  for (let x = 0; x <= WORLD.w; x += CELL) { ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.h); }
  for (let y = 0; y <= WORLD.h; y += CELL) { ctx.moveTo(0, y); ctx.lineTo(WORLD.w, y); }
  ctx.stroke();
}

function drawFighter(f) {
  if (f.out) return;                                  // eliminated — not drawn
  const cx = f.x + f.w / 2, by = f.y + f.h;
  const w = f.w * f.squashX, h = f.h * f.squashY;
  const x = cx - w / 2, y = by - h;
  const dummy = !f.isPlayer && state.freezeCPU;
  const inv = 1 / state.cam.zoom;
  const blink = (f.invuln > 0 || f.respawn > 0) && Math.floor(state.t * 12) % 2 === 0;
  const alpha = dummy ? 0.55 : (blink ? 0.3 : 1);

  const sprite = f.char.sprite;
  if (sprite) {
    const b = f.char.boundsPx || DEFAULT_BOUNDS;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, by);                       // anchor at feet
    ctx.scale(f.facing < 0 ? -1 : 1, 1);         // flip with facing
    ctx.drawImage(sprite, b.x0, b.y0, b.w, b.h, -w / 2, -h, w, h);  // crop to lit pixels = body
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = f.color; ctx.lineWidth = 2 * inv;
    ctx.setLineDash(dummy ? [4 * inv, 3 * inv] : []);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.beginPath();
    const ey = y + h * 0.3;
    ctx.moveTo(cx, ey); ctx.lineTo(cx + f.facing * (w / 2 - 2), ey);
    ctx.lineWidth = 2 * inv; ctx.stroke();
    ctx.restore();
  }

  if (dummy) {
    ctx.fillStyle = "#7a8088"; ctx.textAlign = "center";
    ctx.font = `600 ${8 * inv}px ui-monospace, monospace`;
    ctx.fillText("DUMMY", cx, y - 5 * inv);
  }
  drawHitbox(f, inv);
}

function drawHitbox(f, inv) {
  if (!f.attack || f.attack.def.type === "projectile") return;   // projectiles draw themselves
  const hb = hitboxRect(f, f.attack.def);
  if (f.attack.phase === "active") {
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5 * inv;
    ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
  } else if (f.attack.phase === "startup") {
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = inv;
    ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
  }
}

function drawProjectiles() {
  for (const p of state.projectiles) {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
    ctx.globalAlpha = 0.3;                       // soft trail behind it
    ctx.fillRect(p.x - p.w / 2 - p.vx * 0.012, p.y - p.h / 2, p.w, p.h);
    ctx.globalAlpha = 1;
  }
}

function drawParticles() {
  for (const p of state.particles) {
    const a = Math.max(0, p.life / p.max);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.col;
    const s = p.r * (0.5 + a * 0.5);
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  ctx.textAlign = "center";
  const slots = state.fighters.length;
  state.fighters.forEach((f, i) => {
    const bx = CFG.width * (i + 1) / (slots + 1);
    const by = CFG.height - 22;
    // name
    ctx.font = "600 8px ui-monospace, monospace";
    ctx.fillStyle = f.out ? "#4a4f57" : f.color;
    ctx.fillText(f.name, bx, by + 12);
    // percent (or OUT)
    if (f.out) {
      ctx.font = "700 14px ui-monospace, monospace"; ctx.fillStyle = "#4a4f57";
      ctx.fillText("OUT", bx, by);
    } else {
      const heat = Math.min(1, f.percent / 150);
      ctx.font = "700 18px ui-monospace, monospace";
      ctx.fillStyle = `rgb(${200 + heat * 55}, ${200 - heat * 140}, ${200 - heat * 150})`;
      ctx.fillText(Math.round(f.percent) + "%", bx, by);
    }
    // lives as dots
    const dots = Math.max(0, f.lives | 0);
    ctx.fillStyle = f.out ? "#3a3f47" : f.color;
    for (let d = 0; d < dots; d++) ctx.fillRect(bx - (dots * 5) / 2 + d * 5, by + 17, 3, 3);
  });
}

// ----------------------------------------------------------------------------
//  Boot — load the requested map (?map=name), or a localStorage draft from the
//  editor (?map=__draft), then start.
// ----------------------------------------------------------------------------
async function loadMap() {
  const name = new URLSearchParams(location.search).get("map") || "arena1";
  if (name === "__draft") {
    const raw = localStorage.getItem("brawler:draft");
    if (raw) return JSON.parse(raw);
  }
  const res = await fetch(`${import.meta.env.BASE_URL}maps/${name}.json`);
  if (!res.ok) throw new Error(`map "${name}" not found (${res.status})`);
  return res.json();
}

// Give each roster character a sprite if a chars/<key>.json exists. The creator's
// "Play" stores a draft (?char=__draft) which is shown on the player's fighter.
function applyCharJSON(key, json) {
  CHARS[key].sprite = makeSpriteCanvas(json);
  CHARS[key].boundsPx = spriteBounds(json);
}
async function loadSprites() {
  const base = import.meta.env.BASE_URL;
  const wantDraft = new URLSearchParams(location.search).get("char") === "__draft";
  let draftJSON = null;
  if (wantDraft) {
    const raw = localStorage.getItem("brawler:charDraft");
    if (raw) { try { draftJSON = JSON.parse(raw); } catch {} }
  }
  await Promise.all(ROSTER.map(async (key) => {
    if (draftJSON && key === ROSTER[0]) { applyCharJSON(key, draftJSON); return; }
    try {
      const r = await fetch(`${base}chars/${key}.json`);
      if (r.ok) applyCharJSON(key, await r.json());
    } catch {}
  }));
}

function fallbackMap() {
  return { name: "fallback", cols: 64, rows: 36, cell: 20,
    tiles: Array.from({ length: 36 }, (_, r) =>
      r >= 30 && r <= 31 ? ".".repeat(4) + "#".repeat(56) + ".".repeat(4)
                         : ".".repeat(64)) };
}

let loopStarted = false;
function startLoop() {
  if (loopStarted) return;
  loopStarted = true;
  initTouch(pressTouch, releaseTouch);   // on-screen controls on touch devices
  requestAnimationFrame(frame);
  // Hidden-tab fallback: rAF suspends when not painting; a timer keeps it alive.
  setInterval(() => {
    const now = performance.now();
    if (now - lastRaf > 100) tick(now);
  }, 100);
}

// ----------------------------------------------------------------------------
//  Public API
// ----------------------------------------------------------------------------
export { state, session, CFG, CHARS, applyMap, buildRoster, makeSpriteCanvas, startLoop };

// Build a per-fighter char def, optionally with a custom sprite canvas.
export function charDef(charKey, { color, sprite } = {}) {
  const base = CHARS[charKey] || CHARS.striker;
  return { ...base, color: color || base.color, sprite: sprite || base.sprite };
}

// Debug handle (prototype aid): inspect/poke from the console.
if (typeof window !== "undefined" && new URLSearchParams(location.search).has("debug"))
  window.__brawler = { state, CHARS, BUILTIN_SPELLS, step, pressed };

// Solo entry — used by the default game page (no ?room=).
export async function startSolo() {
  try { applyMap(await loadMap()); }
  catch (e) { console.error(e); applyMap(fallbackMap()); }
  try { await loadSprites(); } catch (e) { console.warn("sprites:", e); }
  reset();
  startLoop();
}

// Multiplayer entry — net layer supplies the room roster + map + session hooks.
export async function startMultiplayer({ net, myId, amHost, map, roster, onOver }) {
  session.mode = "mp"; session.net = net; session.myId = myId; session.amHost = amHost;
  session.onOver = onOver;
  applyMap(map || fallbackMap());
  buildRoster(roster);
  beginCountdown();
  startLoop();
}

// Start a match with the "3·2·1·GO" countdown (fighters wait at spawn).
function beginCountdown() {
  state.phase = "countdown";
  state.countdown = CFG.startCountdown;
  state.winner = null;
  state.matchSize = state.fighters.length;
}

// Last fighter standing — freeze, record the winner, notify the net layer (UI).
function endMatch(winner) {
  state.phase = "over";
  state.winner = winner ? { name: winner.name, color: winner.color } : null;
  if (session.onOver) session.onOver(state.winner);
}
