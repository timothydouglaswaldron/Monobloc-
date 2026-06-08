/* demos.js — renders the Demos page.
   Tracks load from the CMS (GET /api/tracks); if the store isn't configured
   yet (or we're on a static preview with no functions), it falls back to the
   inline `window.DEMOS` list so the page always works.
   Per-track anonymous notes load from /api/notes and post (held for approval). */
(() => {
  const list     = document.getElementById('demoList');
  const videoBox = document.getElementById('demoVideo');
  const titleEl  = document.getElementById('demoTitle');
  const descEl   = document.getElementById('demoDesc');
  const audioBox = document.getElementById('demoAudio');
  const audioEl  = document.getElementById('demoAudioEl');
  const audioDl  = document.getElementById('demoAudioDl');
  const notesList   = document.getElementById('notesList');
  const notesForm   = document.getElementById('notesForm');
  const notesInput  = document.getElementById('notesInput');
  const notesStatus = document.getElementById('notesStatus');
  if (!list || !videoBox) return;

  let tracks = [];
  let current = 0;
  let notesAbort = null;

  const escapeHtml = (s = '') =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Accept a raw 11-char YouTube id OR any YouTube URL form.
  const ytId = (s = '') => {
    const m = String(s).match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
    if (m) return m[1];
    return /^[\w-]{11}$/.test(s) ? s : null;
  };

  const embedHTML = (t) => {
    if (t.youtube) {
      const id = ytId(t.youtube);
      if (id) return '<iframe src="https://www.youtube-nocookie.com/embed/' + id +
        '?rel=0" title="' + escapeHtml(t.title || 'demo') + '" loading="lazy" frameborder="0" ' +
        'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
        'allowfullscreen></iframe>';
    }
    if (t.vimeo) {
      const id = String(t.vimeo).match(/\d+/);
      if (id) return '<iframe src="https://player.vimeo.com/video/' + id[0] +
        '" title="' + escapeHtml(t.title || 'demo') + '" loading="lazy" frameborder="0" ' +
        'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
    }
    if (t.src) {
      return '<video controls preload="metadata" playsinline src="' + escapeHtml(t.src) + '"' +
        (t.poster ? ' poster="' + escapeHtml(t.poster) + '"' : '') + '></video>';
    }
    return '<div class="demos__placeholder">video coming soon..</div>';
  };

  // ---- Notes ----------------------------------------------------------------
  const fmtTime = (ts) => {
    try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (_) { return ''; }
  };

  const renderNotes = (notes) => {
    if (!notesList) return;
    notesList.innerHTML = '';
    if (!notes || !notes.length) return;
    notes.forEach((n) => {
      const li = document.createElement('li');
      li.className = 'note';
      const body = document.createElement('p');
      body.className = 'note__body';
      body.textContent = n.body;                 // textContent = no HTML injection
      const meta = document.createElement('span');
      meta.className = 'note__meta';
      meta.textContent = fmtTime(n.ts);
      li.appendChild(body);
      li.appendChild(meta);
      notesList.appendChild(li);
    });
  };

  const loadNotes = (trackId) => {
    if (!notesList) return;
    if (notesAbort) notesAbort.abort();
    notesAbort = new AbortController();
    notesList.innerHTML = '<li class="notes-empty">loading notes..</li>';
    fetch('/api/notes/?track=' + encodeURIComponent(trackId), { signal: notesAbort.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => renderNotes(d.notes))
      .catch((err) => {
        if (err === 'AbortError' || (err && err.name === 'AbortError')) return;
        notesList.innerHTML = '';
      });
  };

  if (notesForm) {
    notesForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = tracks[current];
      if (!t) return;
      const text = (notesInput.value || '').trim();
      if (!text) return;
      notesStatus.textContent = 'sending..';
      fetch('/api/notes/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track: t.id, body: text }),
      })
        .then((r) => {
          if (r.status === 201) {
            notesInput.value = '';
            notesStatus.textContent = 'posted.';
            loadNotes(t.id);
          } else if (r.status === 422) {
            notesStatus.textContent = 'that note can’t be posted.';
          } else if (r.status === 429) {
            notesStatus.textContent = 'easy — you are posting too fast. try again in a minute.';
          } else {
            notesStatus.textContent = '';
          }
        })
        .catch(() => { notesStatus.textContent = ''; });
    });
  }

  // ---- Audio (song) ---------------------------------------------------------
  const setAudio = (t) => {
    if (!audioBox || !audioEl) return;
    const url = t && t.audio ? String(t.audio) : '';
    if (!url) {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
      audioBox.hidden = true;
      return;
    }
    audioEl.src = url;
    if (audioDl) {
      audioDl.href = url + (url.indexOf('?') === -1 ? '?' : '&') + 'download=1';
      audioDl.setAttribute('download', '');
    }
    audioBox.hidden = false;
  };

  // ---- Selection ------------------------------------------------------------
  const select = (i) => {
    const t = tracks[i];
    if (!t) return;
    current = i;
    [...list.children].forEach((el, idx) => {
      const on = idx === i;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-current', on ? 'true' : 'false');
    });
    videoBox.innerHTML = embedHTML(t);
    setAudio(t);
    if (titleEl) titleEl.textContent = t.title || '';
    if (descEl)  descEl.textContent  = t.description || '';
    if (notesStatus) notesStatus.textContent = '';
    loadNotes(t.id);
    const hash = '#' + (i + 1);
    if (location.hash !== hash) history.replaceState(null, '', hash);
  };

  const buildList = () => {
    list.innerHTML = '';
    tracks.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'demo-track';
      b.innerHTML =
        '<span class="demo-track__num" aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="demo-track__title">' + escapeHtml(t.title || ('Track ' + (i + 1))) + '</span>';
      b.addEventListener('click', () => select(i));
      list.appendChild(b);
    });
  };

  const start = () => {
    if (!tracks.length) {
      videoBox.innerHTML = '<div class="demos__placeholder">no demos yet..</div>';
      if (notesList) notesList.innerHTML = '';
      return;
    }
    buildList();
    const fromHash = parseInt((location.hash || '').replace('#', ''), 10);
    const idx = (Number.isInteger(fromHash) && fromHash >= 1 && fromHash <= tracks.length) ? fromHash - 1 : 0;
    select(idx);
  };

  // Inline fallback content gets synthetic ids so notes still wire up.
  const fallback = () =>
    (Array.isArray(window.DEMOS) ? window.DEMOS : []).map((t, i) => ({ id: t.id || ('local-' + (i + 1)), ...t }));

  // Load tracks from the CMS, fall back to inline list on any failure.
  fetch('/api/tracks/')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => {
      tracks = (d && d.configured && Array.isArray(d.tracks) && d.tracks.length) ? d.tracks : fallback();
      start();
    })
    .catch(() => { tracks = fallback(); start(); });
})();
