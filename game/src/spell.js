// ============================================================================
//  spell.js — shared spell format + library. A spell is the B-button move.
//  Three types:
//    melee      — a hitbox in front of you
//    lunge      — melee + a forward dash (selfVx)
//    projectile — fires a travelling shot (projSpeed/projRange)
//  Timing in seconds; angle in degrees (0 = forward, negative = up). Hitbox
//  reach/height are in "full-size" world px and get scaled per fighter by the
//  engine. Spells persist in localStorage for reuse and travel over the wire.
// ============================================================================

export const SPELL_TYPES = ["melee", "lunge", "projectile"];

export function defaultSpell(name = "New Spell") {
  return {
    name, type: "projectile",
    startup: 0.12, active: 0.10, recovery: 0.32,
    damage: 8, kbBase: 200, kbScale: 11, angle: -18,
    reach: 40, height: 30, oy: -22,            // melee / lunge hitbox
    selfVx: 0,                                  // lunge dash speed
    projSpeed: 380, projRange: 420, projW: 13, projH: 9,  // projectile
    color: "#54e0c8",
  };
}

export const BUILTIN_SPELLS = {
  "Dash Punch": { name: "Dash Punch", type: "lunge", startup: 0.10, active: 0.12, recovery: 0.30,
    damage: 9, kbBase: 210, kbScale: 12, angle: -26, reach: 40, height: 30, oy: -22,
    selfVx: 360, projSpeed: 0, projRange: 0, projW: 0, projH: 0, color: "#54e0c8" },
  "Fireball": { name: "Fireball", type: "projectile", startup: 0.14, active: 0.06, recovery: 0.30,
    damage: 7, kbBase: 150, kbScale: 9, angle: -10, reach: 0, height: 0, oy: -20,
    selfVx: 0, projSpeed: 430, projRange: 520, projW: 14, projH: 10, color: "#f0823a" },
  "Uppercut": { name: "Uppercut", type: "melee", startup: 0.06, active: 0.08, recovery: 0.36,
    damage: 11, kbBase: 240, kbScale: 13, angle: -76, reach: 34, height: 46, oy: -34,
    selfVx: 0, projSpeed: 0, projRange: 0, projW: 0, projH: 0, color: "#e0b85a" },
};

const LIB_KEY = "brawler:spells";
export function readSpellLib() { try { return JSON.parse(localStorage.getItem(LIB_KEY) || "{}"); } catch { return {}; } }
export function writeSpellLib(l) { localStorage.setItem(LIB_KEY, JSON.stringify(l)); }
export function saveSpell(s) { const l = readSpellLib(); l[s.name] = s; writeSpellLib(l); }

// Built-ins + user-saved, keyed by name (user spells win on name clash).
export function allSpells() { return { ...BUILTIN_SPELLS, ...readSpellLib() }; }
