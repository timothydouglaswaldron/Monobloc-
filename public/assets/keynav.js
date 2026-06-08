/* keynav.js — JRPG-style keyboard navigation
   ↑/↓/←/→ moves focus between interactive items in DOM order.
   Enter activates the focused link/button (handled natively).
   Visual cursor is shown via :focus-visible CSS on each item type.
*/
(() => {
  const SELECTORS = '.navbar__logo, .btn-ghost, .media-link, .product__buy, .demo-track';

  const isVisible = (el) =>
    el.offsetParent !== null &&
    !el.disabled &&
    !el.hasAttribute('aria-hidden');

  const items = () => [...document.querySelectorAll(SELECTORS)].filter(isVisible);

  const setSelected = (el) => {
    document.querySelectorAll('.kbd-focus').forEach(n => n.classList.remove('kbd-focus'));
    if (el) {
      el.classList.add('kbd-focus');
      el.focus({ preventScroll: false });
    }
  };

  const move = (delta) => {
    const list = items();
    if (list.length === 0) return;
    const cur = list.indexOf(document.activeElement);
    const next = cur < 0
      ? (delta > 0 ? 0 : list.length - 1)
      : (cur + delta + list.length) % list.length;
    setSelected(list[next]);
  };

  // Track input mode so only ONE JRPG cursor ever shows: mouse mode reveals the
  // hover cursor, keyboard mode reveals the focus cursor. Moving the mouse exits
  // keyboard mode (and clears the keyboard-cursor class).
  const exitKbd = () => {
    document.body.classList.remove('using-kbd');
    document.querySelectorAll('.kbd-focus').forEach(n => n.classList.remove('kbd-focus'));
  };
  document.addEventListener('mousemove',   exitKbd, { passive: true });
  document.addEventListener('pointerdown', exitKbd, { passive: true });

  document.addEventListener('keydown', (e) => {
    // Don't hijack browser shortcuts
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Any keyboard navigation key → keyboard mode (suppresses hover cursors).
    if (e.key === 'Tab' || e.key.indexOf('Arrow') === 0) {
      document.body.classList.add('using-kbd');
    }

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        move(-1);
        break;
      // Enter on a focused <a>/<button> activates natively — no handling needed.
    }
  });
})();

/* rpg-dialogue.js — RPG-style dialogue boxes.
   • "Shop" → shows a "the shop is closed.." message (no navigation).
   • "Demos" → asks for a password; correct answer unlocks and opens /demos/. */
(() => {
  const DEMO_PASSWORD = 'Dean';
  const SHOP_MSG = 'the shop is closed..';
  const ASK_MSG  = 'enter password..';
  const caretSpan = '<span class="rpg-dialogue__caret">▏</span>';
  let open = false;

  const SHOP_RE  = /^\/?shop\/?$/i;
  const DEMOS_RE = /^\/?demos\/?$/i;
  const matchLink = (el, re) => {
    const a = el && el.closest && el.closest('a[href]');
    if (!a) return null;
    const path = (a.getAttribute('href') || '').replace(/^https?:\/\/[^/]+/i, '');
    return re.test(path) ? a : null;
  };

  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const buildOverlay = (innerHTML, label) => {
    const overlay = document.createElement('div');
    overlay.className = 'rpg-dialogue';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    if (label) overlay.setAttribute('aria-label', label);
    overlay.innerHTML = '<div class="rpg-dialogue__box">' + innerHTML + '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    return overlay;
  };

  // Typewriter reveal. Calls done() when the message is fully shown.
  const typewriter = (el, msg, done) => {
    if (reduceMotion()) { el.textContent = msg; done && done(); return { finish() {}, isTyping: () => false }; }
    let i = 0, typing = true, timer = null;
    const tick = () => {
      if (i <= msg.length) {
        el.innerHTML = msg.slice(0, i) + (i < msg.length ? caretSpan : '');
        i++;
        timer = setTimeout(tick, 55);
      } else { typing = false; done && done(); }
    };
    tick();
    return {
      finish() { if (!typing) return; typing = false; if (timer) clearTimeout(timer); el.textContent = msg; done && done(); },
      isTyping: () => typing
    };
  };

  const closer = (overlay, onKey) => () => {
    open = false;
    if (onKey) document.removeEventListener('keydown', onKey, true);
    overlay.classList.remove('is-open');
    setTimeout(() => overlay.remove(), 200);
  };

  // ===== Shop: closed message =====
  const showShopClosed = () => {
    if (open) return; open = true;
    const overlay = buildOverlay(
      '<p class="rpg-dialogue__text" id="rpgText"></p>' +
      '<span class="rpg-dialogue__next" aria-hidden="true">▼</span>',
      SHOP_MSG);
    const tw = typewriter(overlay.querySelector('#rpgText'), SHOP_MSG);
    let onKey;
    const close = closer(overlay, (e) => onKey(e));
    const dismiss = () => { if (tw.isTyping()) tw.finish(); else close(); };
    onKey = (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dismiss(); }
    };
    overlay.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKey, true);
  };

  // ===== Demos: password gate =====
  const showDemosGate = () => {
    if (open) return; open = true;
    const overlay = buildOverlay(
      '<p class="rpg-dialogue__text" id="rpgText"></p>' +
      '<form class="rpg-dialogue__form" id="rpgForm" hidden>' +
        '<span class="rpg-dialogue__prompt" aria-hidden="true">&gt;</span>' +
        '<input class="rpg-dialogue__input" id="rpgInput" type="password" ' +
          'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="password">' +
        '<button type="submit" class="rpg-dialogue__enter" aria-label="Submit password">Enter</button>' +
      '</form>',
      ASK_MSG);

    const textEl = overlay.querySelector('#rpgText');
    const form   = overlay.querySelector('#rpgForm');
    const input  = overlay.querySelector('#rpgInput');
    const box    = overlay.querySelector('.rpg-dialogue__box');

    let onKey;
    const close = closer(overlay, (e) => onKey(e));

    const tw = typewriter(textEl, ASK_MSG, () => { form.hidden = false; input.focus(); });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value === DEMO_PASSWORD) {
        try { sessionStorage.setItem('demosUnlocked', '1'); } catch (_) {}
        textEl.textContent = 'access granted.';
        form.hidden = true;
        setTimeout(() => { window.location.href = '/demos/'; }, 450);
      } else {
        input.value = '';
        textEl.textContent = 'access denied..';
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        input.focus();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { close(); return; }   // backdrop click closes
      if (tw.isTyping()) tw.finish();                  // skip typing
    });
    onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
  };

  const trigger = (el) => {
    if (matchLink(el, SHOP_RE))  { showShopClosed(); return true; }
    if (matchLink(el, DEMOS_RE)) { showDemosGate();  return true; }
    return false;
  };

  // Capture phase so we beat native link navigation.
  document.addEventListener('click', (e) => {
    if (trigger(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // Keyboard activation (Enter) on a focused Shop/Demos link.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (trigger(document.activeElement)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
