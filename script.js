(function () {
  const form = document.getElementById('fanForm');
  const usernameInput = document.getElementById('username');
  const avatarInput = document.getElementById('avatar');
  const msgInput = document.getElementById('msg');
  const favInput = document.getElementById('fav');
  const hpInput = document.getElementById('website');
  const submitBtn = document.getElementById('submitBtn');

  const unamePreview = document.querySelector('#preview .uname');
  const avatarPreview = document.getElementById('avatarPreview');
  const noPic = document.getElementById('noPic');
  const joinDate = document.getElementById('joinDate');
  const shoutOut = document.getElementById('shoutOut');

  const fanList = document.getElementById('fanList');
  const yearEl = document.getElementById('year');
  const hitCounter = document.getElementById('hitCounter');

  const HITS_KEY = 'monobloc_hits_v1';

  yearEl.textContent = new Date().getFullYear();

  // --- local-only visitor counter (cosmetic) ---
  let hits = parseInt(localStorage.getItem(HITS_KEY) || '0', 10);
  hits += 1;
  localStorage.setItem(HITS_KEY, String(hits));
  hitCounter.textContent = String(hits).padStart(6, '0');

  // --- live preview wiring ---
  function updateUsernamePreview() {
    const v = usernameInput.value.replace(/\s+/g, '_').trim();
    unamePreview.textContent = v ? v : '<username>';
  }

  function updateShoutPreview() {
    const v = msgInput.value.trim();
    shoutOut.textContent = v ? '“' + v + '”' : '“...”';
  }

  function showAvatar(dataUrl) {
    if (dataUrl) {
      avatarPreview.src = dataUrl;
      avatarPreview.style.visibility = 'visible';
      noPic.style.display = 'none';
    } else {
      avatarPreview.removeAttribute('src');
      avatarPreview.style.visibility = 'hidden';
      noPic.style.display = 'flex';
    }
  }

  let currentAvatarDataUrl = '';

  avatarInput.addEventListener('change', function () {
    const file = avatarInput.files && avatarInput.files[0];
    if (!file) { currentAvatarDataUrl = ''; showAvatar(''); return; }
    if (!/^image\//.test(file.type)) {
      alert('ERROR: that file aint an image.');
      avatarInput.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('ERROR: file is too large. 2MB max plz.');
      avatarInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      currentAvatarDataUrl = e.target.result;
      showAvatar(currentAvatarDataUrl);
    };
    reader.readAsDataURL(file);
  });

  usernameInput.addEventListener('input', updateUsernamePreview);
  msgInput.addEventListener('input', updateShoutPreview);

  // --- render helpers ---
  function renderFans(fans) {
    if (!fans || !fans.length) {
      fanList.innerHTML = '<p class="empty-note">No fans yet. Be the first!</p>';
      return;
    }
    fanList.innerHTML = '';
    fans.slice().reverse().forEach(function (f) {
      const entry = document.createElement('div');
      entry.className = 'fan-entry';

      if (f.avatar) {
        const img = document.createElement('img');
        img.className = 'mini-avatar';
        img.src = f.avatar;
        img.alt = f.username;
        img.loading = 'lazy';
        entry.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'mini-avatar placeholder';
        ph.textContent = ':)';
        entry.appendChild(ph);
      }

      const info = document.createElement('div');
      info.className = 'mini-info';

      const name = document.createElement('div');
      name.className = 'mini-name';
      name.textContent = f.username;
      info.appendChild(name);

      const date = document.createElement('div');
      date.className = 'mini-date';
      date.textContent = f.joined;
      info.appendChild(date);

      entry.appendChild(info);
      fanList.appendChild(entry);
    });
  }

  // --- API ---
  async function fetchFans() {
    try {
      const r = await fetch('/api/fans', { cache: 'no-store' });
      if (!r.ok) throw new Error('bad response');
      const data = await r.json();
      renderFans(data.fans || []);
    } catch (err) {
      fanList.innerHTML = '<p class="empty-note">(could not load fanbook)</p>';
    }
  }

  async function submitFan(payload) {
    const r = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = {};
    try { data = await r.json(); } catch { /* ignore */ }
    if (!r.ok) {
      throw new Error(data.error || ('HTTP ' + r.status));
    }
    return data;
  }

  // --- submit ---
  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const username = usernameInput.value.replace(/\s+/g, '_').trim();
    if (!/^[A-Za-z0-9_-]{2,20}$/.test(username)) {
      alert('username must be 2-20 chars, letters/numbers/_/- only.');
      usernameInput.focus();
      return;
    }

    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = 'sending...';

    try {
      const result = await submitFan({
        username: username,
        avatar: currentAvatarDataUrl || '',
        fav: favInput.value || '',
        message: msgInput.value.trim(),
        hp: hpInput ? hpInput.value : '',
      });

      if (result && result.fan) {
        joinDate.textContent = result.fan.joined;
      }
      alert('welcome to the fan club, ' + username + '!');

      form.reset();
      currentAvatarDataUrl = '';
      showAvatar('');
      updateUsernamePreview();
      updateShoutPreview();

      await fetchFans();
    } catch (err) {
      alert('ERROR: ' + (err.message || 'could not sign up'));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });

  // initial render
  fetchFans();
  updateUsernamePreview();
  updateShoutPreview();
})();
