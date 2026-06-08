/* vfd.js — black & white VFD "car-radio" spectrum visualiser for the Demos player.

   Binds to the existing <audio id="demoAudioEl">. demos.js still owns the source:
   it sets audioEl.src and unhides #demoAudio when a track has audio. This script
   only replaces the native <audio controls> with a custom monochrome transport
   plus a dot-matrix spectrum analyser driven by the Web Audio API.

   If the audio is cross-origin without CORS (so the AnalyserNode reads silence),
   it transparently falls back to a procedural animation so the display is never
   dead while a track is playing. Respects prefers-reduced-motion. */
(() => {
  const audio  = document.getElementById('demoAudioEl');
  const screen = document.getElementById('vfdScreen');
  const root   = document.getElementById('vfd');
  if (!audio || !screen || !root) return;

  const playBtn = document.getElementById('vfdPlay');
  const curEl   = document.getElementById('vfdCur');
  const durEl   = document.getElementById('vfdDur');
  const seek    = document.getElementById('vfdSeek');
  const fill    = document.getElementById('vfdFill');
  const head    = document.getElementById('vfdHead');

  const ctx2d = screen.getContext('2d', { alpha: false });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // ---- Web Audio graph (created lazily on first play; needs a user gesture) ----
  let actx = null, analyser = null, freq = null, srcNode = null, audioOK = false;
  const ensureAudio = () => {
    if (actx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      actx = new AC();
      srcNode = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;
      freq = new Uint8Array(analyser.frequencyBinCount);
      srcNode.connect(analyser);
      analyser.connect(actx.destination);
      audioOK = true;
    } catch (_) {
      audioOK = false; // e.g. cross-origin taint — fall back to procedural mode
    }
  };

  // ---- Canvas sizing (device-pixel sharp, responsive grid) --------------------
  let W = 0, H = 0, COLS = 28, ROWS = 16;
  let levels = [], peaks = [];
  const resize = () => {
    const r = screen.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    screen.width  = Math.round(W * dpr);
    screen.height = Math.round(H * dpr);
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    COLS = Math.max(16, Math.min(38, Math.round(W / 15)));
    ROWS = Math.max(10, Math.min(22, Math.round(H / 9)));
    if (levels.length !== COLS) {
      levels = new Array(COLS).fill(0);
      peaks  = new Array(COLS).fill(0);
    }
  };
  if (window.ResizeObserver) new ResizeObserver(resize).observe(screen);
  window.addEventListener('resize', resize);

  // ---- Per-column targets -----------------------------------------------------
  // Map COLS columns over a log slice of the spectrum (low freqs get more detail).
  const colTargets = (out) => {
    if (audioOK && analyser) {
      analyser.getByteFrequencyData(freq);
      let sum = 0;
      const bins = freq.length;
      const minBin = 2, maxBin = Math.floor(bins * 0.72);
      const ratio = maxBin / minBin;
      for (let c = 0; c < COLS; c++) {
        const lo = Math.floor(minBin * Math.pow(ratio, c / COLS));
        const hi = Math.max(lo + 1, Math.floor(minBin * Math.pow(ratio, (c + 1) / COLS)));
        let m = 0;
        for (let b = lo; b < hi; b++) m = Math.max(m, freq[b]);
        sum += m;
        // perceptual curve + gentle low-end tame / high-end lift
        let v = Math.pow(m / 255, 0.9);
        out[c] = Math.min(1, v * 1.25);
      }
      if (sum > 40) return true; // real signal present
    }
    return false; // caller will synthesise
  };

  // Procedural fallback — pseudo-spectrum that breathes while audio plays.
  let seed = Math.random() * 1000;
  const synthTargets = (out, t) => {
    const beat = 0.5 + 0.5 * Math.pow(Math.abs(Math.sin(t * 1.9)), 0.6);
    for (let c = 0; c < COLS; c++) {
      const x = c / COLS;
      const env = Math.pow(1 - x, 0.7);                       // tilt toward lows
      const w = Math.sin(t * 2.3 + c * 0.55 + seed)
              + 0.6 * Math.sin(t * 4.1 + c * 0.31)
              + 0.4 * Math.sin(t * 7.7 + c * 0.9);
      const v = env * (0.35 + 0.4 * beat) * (0.55 + 0.45 * (w / 2 + 0.5));
      out[c] = Math.max(0, Math.min(1, v));
    }
  };

  // ---- Render -----------------------------------------------------------------
  const target = [];
  let raf = 0, lastT = 0;

  const draw = (now) => {
    raf = requestAnimationFrame(draw);
    const t = now / 1000;
    if (target.length !== COLS) target.length = COLS;

    const playing = !audio.paused && !audio.ended;
    let got = false;
    if (playing) got = colTargets(target);
    if (playing && !got) synthTargets(target, t);
    if (!playing) for (let c = 0; c < COLS; c++) target[c] = 0;

    // Cell geometry
    const padX = W * 0.012, padY = H * 0.10;
    const gridW = W - padX * 2, gridH = H - padY * 2;
    const pitchX = gridW / COLS, pitchY = gridH / ROWS;
    const cw = pitchX * 0.74, ch = pitchY * 0.66;
    const ox = padX + (pitchX - cw) / 2;
    const oy = padY;

    ctx2d.setTransform(Math.min(window.devicePixelRatio || 1, 2), 0, 0,
                       Math.min(window.devicePixelRatio || 1, 2), 0, 0);
    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, W, H);

    const rrect = (x, y, w, h, r) => {
      const rr = Math.min(r, w / 2, h / 2);
      ctx2d.beginPath();
      ctx2d.moveTo(x + rr, y);
      ctx2d.arcTo(x + w, y, x + w, y + h, rr);
      ctx2d.arcTo(x + w, y + h, x, y + h, rr);
      ctx2d.arcTo(x, y + h, x, y, rr);
      ctx2d.arcTo(x, y, x + w, y, rr);
      ctx2d.closePath();
    };

    for (let c = 0; c < COLS; c++) {
      // ease toward target (fast attack, slow release — like a real meter)
      const tv = target[c];
      const cur = levels[c];
      levels[c] = tv > cur ? cur + (tv - cur) * 0.55 : cur + (tv - cur) * 0.16;
      const lit = levels[c] * ROWS;

      // peak hold (falls slowly)
      if (lit > peaks[c]) peaks[c] = lit;
      else peaks[c] = Math.max(lit, peaks[c] - 0.09);
      const peakRow = Math.min(ROWS - 1, Math.floor(peaks[c]));

      const cx = ox + c * pitchX;
      for (let rIdx = 0; rIdx < ROWS; rIdx++) {
        const fromBottom = rIdx; // 0 = bottom row
        const y = padY + (ROWS - 1 - rIdx) * pitchY + (pitchY - ch) / 2;
        const on = fromBottom < lit;
        const isPeak = fromBottom === peakRow && peaks[c] > 0.4;
        const isBase = fromBottom === 0;

        let a; // alpha / brightness
        if (isPeak)      a = 1.0;
        else if (on)     a = 0.78 - 0.018 * fromBottom; // slight fade up the column
        else if (isBase) a = 0.16;                       // always-faint baseline row
        else             a = 0.05;                       // unlit phosphor dot

        ctx2d.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
        if (on || isPeak) {
          ctx2d.shadowColor = 'rgba(255,255,255,0.55)';
          ctx2d.shadowBlur = isPeak ? 8 : 4;
        } else {
          ctx2d.shadowBlur = 0;
        }
        rrect(cx, y, cw, ch, Math.min(cw, ch) * 0.28);
        ctx2d.fill();
      }
    }
    ctx2d.shadowBlur = 0;
    lastT = t;
  };

  const startLoop = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const stopLoop  = () => {
    if (reduce.matches) { cancelAnimationFrame(raf); raf = 0; }
  };

  // ---- Transport --------------------------------------------------------------
  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return m + ':' + String(ss).padStart(2, '0');
  };

  const setPlayingUI = (on) => {
    root.classList.toggle('is-playing', on);
    if (playBtn) playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');
  };

  const toggle = () => {
    ensureAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };
  if (playBtn) playBtn.addEventListener('click', toggle);

  audio.addEventListener('play',  () => { setPlayingUI(true); startLoop(); });
  audio.addEventListener('playing', () => { setPlayingUI(true); startLoop(); });
  audio.addEventListener('pause', () => { setPlayingUI(false); });
  audio.addEventListener('ended', () => { setPlayingUI(false); });

  const updateTime = () => {
    if (curEl) curEl.textContent = fmt(audio.currentTime);
    if (durEl) durEl.textContent = fmt(audio.duration);
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    if (fill) fill.style.width = pct + '%';
    if (head) head.style.left = pct + '%';
    if (seek) seek.setAttribute('aria-valuenow', Math.round(pct));
  };
  audio.addEventListener('timeupdate', updateTime);
  audio.addEventListener('loadedmetadata', updateTime);
  audio.addEventListener('durationchange', updateTime);
  // New track loaded by demos.js → reset transport + peaks
  audio.addEventListener('emptied', () => {
    setPlayingUI(false);
    peaks = peaks.map(() => 0);
    levels = levels.map(() => 0);
    updateTime();
  });

  // Scrubbing
  const seekToClientX = (clientX) => {
    if (!seek || !audio.duration) return;
    const r = seek.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    audio.currentTime = p * audio.duration;
    updateTime();
  };
  let scrubbing = false;
  if (seek) {
    seek.addEventListener('pointerdown', (e) => {
      scrubbing = true; seek.setPointerCapture(e.pointerId); seekToClientX(e.clientX);
    });
    seek.addEventListener('pointermove', (e) => { if (scrubbing) seekToClientX(e.clientX); });
    seek.addEventListener('pointerup',   (e) => { scrubbing = false; });
    seek.addEventListener('keydown', (e) => {
      if (!audio.duration) return;
      if (e.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); e.preventDefault(); }
      else if (e.key === ' ' || e.key === 'Enter') { toggle(); e.preventDefault(); }
    });
  }

  // Initial paint so the unlit grid is visible before playback
  resize();
  requestAnimationFrame(draw);
  // In reduced-motion mode we still want the idle grid, but no continuous loop
  // while paused; the loop self-sustains only while playing (handled above).
})();
