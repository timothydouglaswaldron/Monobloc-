/* admin.js — Demos CMS console.
   Logs in by sending the password as the `x-admin-key` header to /api/admin
   (server-checked against ADMIN_PASSWORD). The key is kept in sessionStorage
   for the tab session only. Manages tracks + moderates anonymous notes. */
(() => {
  const $ = (id) => document.getElementById(id);
  const loginSec  = $('adminLogin');
  const consoleSec = $('adminConsole');
  const loginForm = $('loginForm');
  const passEl    = $('adminPass');
  const loginMsg  = $('loginMsg');

  let KEY = sessionStorage.getItem('mbAdminKey') || '';

  const api = (action, extra) =>
    fetch('/api/admin/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': KEY },
      body: JSON.stringify({ action, ...(extra || {}) }),
    });

  // ---- Tracks ---------------------------------------------------------------
  const trackForm = $('trackForm');
  const fields = ['Id', 'Title', 'Desc', 'Src', 'Audio', 'Poster'];
  const resetForm = () => {
    fields.forEach((f) => { $('tf' + f).value = ''; });
    $('trackFormHead').textContent = 'add a track';
    $('tfCancel').hidden = true;
    $('trackMsg').textContent = '';
  };

  const editTrack = (t) => {
    $('tfId').value = t.id || '';
    $('tfTitle').value = t.title || '';
    $('tfDesc').value = t.description || '';
    $('tfSrc').value = t.src || '';
    $('tfAudio').value = t.audio || '';
    $('tfPoster').value = t.poster || '';
    $('trackFormHead').textContent = 'edit track';
    $('tfCancel').hidden = false;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const renderTracks = (tracks) => {
    const ol = $('adminTracks');
    ol.innerHTML = '';
    if (!tracks || !tracks.length) {
      ol.innerHTML = '<li class="admin__empty">no tracks yet — add one below.</li>';
      return;
    }
    tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'admin__track';
      const src = t.src ? 'video' : 'no video';
      const label = document.createElement('span');
      label.className = 'admin__track-label';
      label.textContent = t.title + '  (' + src + ')';
      const actions = document.createElement('span');
      actions.className = 'admin__track-actions';
      const mk = (txt, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'admin__mini'; b.textContent = txt; b.addEventListener('click', fn); return b; };
      actions.appendChild(mk('↑', () => move(i, -1, tracks)));
      actions.appendChild(mk('↓', () => move(i, 1, tracks)));
      actions.appendChild(mk('edit', () => editTrack(t)));
      const del = mk('delete', () => delTrack(t));
      del.classList.add('admin__mini--danger');
      actions.appendChild(del);
      li.appendChild(label);
      li.appendChild(actions);
      ol.appendChild(li);
    });
  };

  const loadTracks = () => api('listTracks').then((r) => r.json()).then((d) => renderTracks(d.tracks || []));

  const move = (i, dir, tracks) => {
    const j = i + dir;
    if (j < 0 || j >= tracks.length) return;
    const order = tracks.map((t) => t.id);
    [order[i], order[j]] = [order[j], order[i]];
    api('reorder', { order }).then((r) => r.json()).then((d) => renderTracks(d.tracks || []));
  };

  const delTrack = (t) => {
    if (!confirm('Delete "' + t.title + '" and its notes?')) return;
    api('deleteTrack', { id: t.id }).then((r) => r.json()).then((d) => renderTracks(d.tracks || []));
  };

  if (trackForm) {
    trackForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const track = {
        id: $('tfId').value || undefined,
        title: $('tfTitle').value,
        description: $('tfDesc').value,
        src: $('tfSrc').value,
        audio: $('tfAudio').value,
        poster: $('tfPoster').value,
      };
      $('trackMsg').textContent = 'saving..';
      api('saveTrack', { track }).then((r) => r.json()).then((d) => {
        if (d.ok) { $('trackMsg').textContent = 'saved.'; resetForm(); renderTracks(d.tracks || []); }
        else { $('trackMsg').textContent = d.error || 'could not save.'; }
      }).catch(() => { $('trackMsg').textContent = 'could not save.'; });
    });
    $('tfCancel').addEventListener('click', resetForm);
  }

  // ---- Video upload (direct browser → Vercel Blob) --------------------------
  // Self-contained: no SDK/CDN. Two steps —
  //   1) POST /api/upload/ to mint a short-lived client token (admin-gated)
  //   2) PUT the file straight to the Blob API with that token (XHR = progress)
  const BLOB_API = 'https://vercel.com/api/blob';
  const BLOB_API_VERSION = '12';

  const getClientToken = (pathname) =>
    fetch('/api/upload/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'blob.generate-client-token',
        payload: { pathname, callbackUrl: location.origin + '/api/upload/', multipart: false, clientPayload: KEY },
      }),
    }).then(async (r) => {
      if (r.status === 401) throw new Error('unauthorized');
      if (r.status === 503) throw new Error('blob_not_configured');
      if (!r.ok) throw new Error('token_failed');
      const d = await r.json();
      if (!d.clientToken) throw new Error('token_failed');
      return d.clientToken;
    });

  const putToBlob = (pathname, file, clientToken, onProgress) =>
    new Promise((resolve, reject) => {
      const params = new URLSearchParams({ pathname });
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', BLOB_API + '/?' + params.toString());
      xhr.setRequestHeader('authorization', 'Bearer ' + clientToken);
      xhr.setRequestHeader('x-api-version', BLOB_API_VERSION);
      xhr.setRequestHeader('x-vercel-blob-access', 'public');
      xhr.setRequestHeader('x-content-type', file.type || 'video/mp4');
      xhr.setRequestHeader('content-type', file.type || 'video/mp4');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (_) { reject(new Error('bad_response')); }
        } else { reject(new Error('put_' + xhr.status)); }
      };
      xhr.onerror = () => reject(new Error('network'));
      xhr.send(file);
    });

  // Wire an upload button → file input → Blob, writing the result URL into a field.
  const wireUpload = ({ btnId, fileId, msgId, prefix, targetId, kind }) => {
    const btn = $(btnId), fileEl = $(fileId), msg = $(msgId);
    if (!btn || !fileEl) return;
    btn.addEventListener('click', async () => {
      const file = fileEl.files && fileEl.files[0];
      if (!file) { msg.textContent = 'pick a ' + kind + ' file first.'; return; }
      btn.disabled = true;
      msg.textContent = 'preparing upload..';
      try {
        const safeName = (file.name || kind).replace(/[^\w.\-]+/g, '_');
        const pathname = prefix + safeName;
        const clientToken = await getClientToken(pathname);
        msg.textContent = 'uploading.. 0%';
        const blob = await putToBlob(pathname, file, clientToken, (pct) => {
          msg.textContent = 'uploading.. ' + pct + '%';
        });
        if (!blob || !blob.url) throw new Error('no_url');
        $(targetId).value = blob.url;
        msg.textContent = 'uploaded ✓ — now click “save track”.';
      } catch (e) {
        const m = (e && e.message) ? String(e.message) : 'failed';
        msg.textContent =
          m === 'unauthorized' ? 'upload rejected — log out and back in.'
          : m === 'blob_not_configured' ? 'blob storage not set up yet.'
          : 'upload failed (' + m + ') — check the file and try again.';
      } finally {
        btn.disabled = false;
      }
    });
  };

  wireUpload({ btnId: 'tfUploadBtn', fileId: 'tfVideoFile', msgId: 'uploadMsg', prefix: 'demos/', targetId: 'tfSrc', kind: 'video' });
  wireUpload({ btnId: 'tfUploadAudioBtn', fileId: 'tfAudioFile', msgId: 'audioMsg', prefix: 'songs/', targetId: 'tfAudio', kind: 'song' });

  // ---- Session --------------------------------------------------------------
  const showConsole = () => {
    loginSec.hidden = true;
    consoleSec.hidden = false;
    loadTracks();
  };

  const tryKey = (key) =>
    fetch('/api/admin/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify({ action: 'verify' }),
    });

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = passEl.value;
    loginMsg.textContent = 'checking..';
    tryKey(key).then((r) => {
      if (r.ok) {
        KEY = key;
        sessionStorage.setItem('mbAdminKey', key);
        loginMsg.textContent = '';
        passEl.value = '';
        showConsole();
      } else if (r.status === 401) {
        loginMsg.textContent = 'wrong password.';
      } else if (r.status === 503) {
        loginMsg.textContent = 'admin not configured yet (set ADMIN_PASSWORD on Vercel).';
      } else {
        loginMsg.textContent = 'could not reach the server.';
      }
    }).catch(() => { loginMsg.textContent = 'could not reach the server.'; });
  });

  $('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem('mbAdminKey');
    KEY = '';
    location.reload();
  });

  // Auto-resume if a key is already stored this session.
  if (KEY) tryKey(KEY).then((r) => { if (r.ok) showConsole(); else { sessionStorage.removeItem('mbAdminKey'); KEY = ''; } }).catch(() => {});
})();
