// ============================================================================
//  touch.js — on-screen controller for touch devices. Injects a D-pad + JUMP/
//  A/B buttons and feeds them into the engine's action set via press/release
//  callbacks. Shown only on coarse-pointer devices (or with ?touch to force it).
// ============================================================================

// --- haptics ---------------------------------------------------------------
// Android: Vibration API. iOS (no Vibration API): toggle a hidden
// <input type="checkbox" switch>, which emits a system haptic on iOS 17.4+.
let hapticLabel = null;
function setupHaptics() {
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0;overflow:hidden";
  const inp = document.createElement("input");
  inp.type = "checkbox";
  inp.setAttribute("switch", "");        // iOS haptic switch
  label.appendChild(inp);
  document.body.appendChild(label);
  hapticLabel = label;
}
function haptic(ms) {
  try { if (typeof navigator.vibrate === "function" && navigator.vibrate(ms)) return; } catch {}
  // iOS fallback: a toggle of the switch input produces a subtle system tap
  if (hapticLabel) { try { hapticLabel.click(); } catch {} }
}

export function initTouch(press, release) {
  const coarse = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  if (!coarse && !new URLSearchParams(location.search).has("touch")) return;

  // Block pinch-to-zoom (iOS Safari ignores user-scalable=no, then gets "stuck"
  // zoomed because it also can't zoom back out). Killing the gesture avoids it.
  const stop = (e) => e.preventDefault();
  for (const ev of ["gesturestart", "gesturechange", "gestureend"])
    document.addEventListener(ev, stop, { passive: false });
  // also block multi-finger pinch via touchmove
  document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); },
    { passive: false });

  injectStyles();
  setupHaptics();

  const pad = document.createElement("div");
  pad.id = "touchpad";
  pad.innerHTML = `
    <div class="tp-dpad">
      <button class="tp-btn d up"    data-act="jump"></button>
      <button class="tp-btn d left"  data-act="left"></button>
      <button class="tp-btn d right" data-act="right"></button>
      <button class="tp-btn d down"  data-act="down"></button>
    </div>
    <div class="tp-face">
      <button class="tp-btn f jump" data-act="jump">JMP</button>
      <button class="tp-btn f b"    data-act="special">B</button>
      <button class="tp-btn f a"    data-act="attack">A</button>
    </div>`;
  document.body.appendChild(pad);

  for (const btn of pad.querySelectorAll(".tp-btn")) {
    const act = btn.dataset.act;
    const down = (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch {}
      btn.classList.add("on");
      haptic(act === "attack" || act === "special" ? 18 : 9);   // tap feedback
      press(act);
    };
    const up   = (e) => { e.preventDefault(); btn.classList.remove("on"); release(act); };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}

function injectStyles() {
  const s = document.createElement("style");
  s.textContent = `
    #touchpad { position: fixed; inset: 0; z-index: 5; pointer-events: none;
      font-family: ui-monospace, monospace; -webkit-user-select: none; user-select: none; }
    #touchpad .tp-btn { pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent;
      position: absolute; border: 2px solid rgba(84,224,200,.5); background: rgba(20,24,28,.5);
      color: rgba(84,224,200,.85); font-weight: 700; backdrop-filter: blur(2px); }
    #touchpad .tp-btn.on { background: rgba(84,224,200,.28); border-color: #54e0c8; }

    /* D-pad bottom-left, cross layout */
    #touchpad .tp-dpad { position: absolute; left: 18px; bottom: 22px; width: 168px; height: 168px; pointer-events: none; }
    #touchpad .d { width: 56px; height: 56px; border-radius: 10px; }
    #touchpad .d.up    { left: 56px; top: 0; }
    #touchpad .d.left  { left: 0; top: 56px; }
    #touchpad .d.right { left: 112px; top: 56px; }
    #touchpad .d.down  { left: 56px; top: 112px; }

    /* face buttons bottom-right */
    #touchpad .tp-face { position: absolute; right: 18px; bottom: 22px; width: 170px; height: 170px; pointer-events: none; }
    #touchpad .f { border-radius: 50%; display: grid; place-items: center; }
    #touchpad .f.a    { width: 76px; height: 76px; right: 0;  bottom: 8px; font-size: 26px; }
    #touchpad .f.b    { width: 68px; height: 68px; right: 84px; bottom: 30px; font-size: 22px;
      border-color: rgba(224,104,138,.55); color: rgba(224,104,138,.9); }
    #touchpad .f.b.on { background: rgba(224,104,138,.28); border-color: #e0688a; }
    #touchpad .f.jump { width: 62px; height: 62px; right: 18px; bottom: 96px; font-size: 12px;
      border-color: rgba(224,184,90,.55); color: rgba(224,184,90,.9); }
    #touchpad .f.jump.on { background: rgba(224,184,90,.28); border-color: #e0b85a; }

    @media (max-width: 480px) {
      #touchpad .tp-dpad, #touchpad .tp-face { transform: scale(.92); transform-origin: bottom; }
    }`;
  document.head.appendChild(s);
}
