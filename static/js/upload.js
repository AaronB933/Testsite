/* upload.js */

const VIDEO_EXTS = new Set(['.mp4','.mov','.avi','.mkv','.m4v','.wmv','.flv','.webm','.3gp']);
  const dropZone   = document.getElementById('drop-zone');
  const fileInput  = document.getElementById('file-input');
  const folderInput= document.getElementById('folder-input');

  async function init() {
    const res = await fetch('/api/me');
    if (res.status === 401) { window.location.href = '/'; return; }
    const user = await res.json();
    window._userId = user.id;
    document.getElementById('nav-username').textContent = user.username;
    loadInbox();
  }

  // ── Drag & drop ───────────────────────────────────────────────────────────
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', async e => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    handleFiles(await collectDroppedFiles(e.dataTransfer));
  });
  fileInput.addEventListener('change', () => handleFiles(Array.from(fileInput.files)));
  folderInput.addEventListener('change', () => handleFiles(Array.from(folderInput.files)));

  async function collectDroppedFiles(dt) {
    const files = [];
    for (const item of Array.from(dt.items || [])) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry?.isDirectory) files.push(...await readDir(entry));
      else { const f = item.getAsFile(); if (f) files.push(f); }
    }
    return files.length ? files : Array.from(dt.files || []);
  }

  function readDir(dir) {
    return new Promise(resolve => {
      const results = []; const reader = dir.createReader();
      function batch() {
        reader.readEntries(async entries => {
          if (!entries.length) { resolve(results); return; }
          for (const e of entries) {
            if (e.isFile) results.push(await new Promise(r => e.file(r)));
            else if (e.isDirectory) results.push(...await readDir(e));
          }
          batch();
        });
      }
      batch();
    });
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  async function handleFiles(files) {
    if (!files.length) return;
    const videos = files.filter(f => VIDEO_EXTS.has(ext(f.name)));
    const toUpload = files.filter(f => !VIDEO_EXTS.has(ext(f.name)));
    if (videos.length) showToast('Can not handle videos', 'warn');
    if (!toUpload.length) return;

    document.getElementById('spinner-overlay').classList.add('show');
    let ok = 0, dupes = 0, noDate = [];

    for (const file of toUpload) {
      const fd = new FormData();
      fd.append('file', file);
      const d = document.getElementById('manual-date').value;
      if (d) fd.append('date', d);
      try {
        const res = await fetch('/api/upload', { method:'POST', body:fd });
        const data = await res.json();
        if (res.status === 422 && data.error === 'no_date') noDate.push(file.name);
        else if (res.status === 409 && data.error === 'duplicate') dupes++;
        else if (data.success) ok++;
      } catch { showToast('Upload failed — server running?', 'error'); }
    }

    document.getElementById('spinner-overlay').classList.remove('show');

    if (noDate.length) {
      document.getElementById('date-warning').style.display = 'block';
    } else {
      document.getElementById('date-warning').style.display = 'none';
    }

    // Build summary message
    const parts = [];
    if (ok) parts.push(`${ok} photo${ok > 1 ? 's' : ''} added`);
    if (dupes) parts.push(`${dupes} duplicate${dupes > 1 ? 's' : ''} skipped`);
    if (noDate.length) parts.push(`${noDate.length} need a date`);

    if (parts.length) {
      const type = (dupes > 0 && ok === 0) ? 'warn' : (dupes > 0 ? 'warn' : 'success');
      setTimeout(() => showToast(parts.join(' · '), type), 100);
    }

    if (ok) {
      fileInput.value = ''; folderInput.value = '';
      loadInbox();
    }
  }


  // ── Inbox ─────────────────────────────────────────────────────────────────
  const INBOX_PAGE = 50;
  let inboxPhotos = [], inboxPage = 1;

  async function loadInbox() {
    const data = await fetch('/api/photos/label/inbox').then(r => r.json());
    inboxPhotos = data.photos || data;
    inboxPage = 1;
    document.getElementById('inbox-count').textContent =
      `${inboxPhotos.length} photo${inboxPhotos.length !== 1 ? 's' : ''}`;
    renderInbox();
  }

  function renderInbox() {
    const wrap = document.getElementById('photo-grid-wrap');
    if (!inboxPhotos.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="icon">🌱</div><p>Your inbox is empty — drop some photos above</p></div>`;
      return;
    }
    const shown = inboxPhotos.slice(0, inboxPage * INBOX_PAGE);
    wrap.innerHTML = `<div class="photo-grid">${shown.map(p => `
      <div class="photo-card">
        <img src="/uploads/user_${window._userId}/inbox/${p.stored_filename}" loading="lazy"
             onerror="this.style.background='#EAF3DE';this.style.height='155px'">
        <div class="info">
          <div class="p-date">${fmtDate(p.date_taken)}</div>
          <div class="p-label">${p.label || 'unlabeled'}</div>
        </div>
      </div>
    `).join('')}</div>
    ${shown.length < inboxPhotos.length ? `
      <div style="text-align:center;padding:1.5rem;">
        <span style="font-size:.82rem;color:#B4B2A9;margin-right:1rem;">Showing ${shown.length} of ${inboxPhotos.length}</span>
        <button onclick="inboxPage++;renderInbox()" style="padding:.45rem 1rem;border-radius:8px;background:#F1EFE8;border:1px solid #D3D1C7;font-family:inherit;font-size:.85rem;cursor:pointer;">Load more</button>
      </div>` : ''}`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function ext(name) { return name.slice(name.lastIndexOf('.')).toLowerCase(); }