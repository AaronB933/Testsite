/* upload.js — Upload page with progress bar, pause, resume, cancel */

const VIDEO_EXTS = new Set(['.mp4','.mov','.avi','.mkv','.m4v','.wmv','.flv','.webm','.3gp']);
const dropZone    = document.getElementById('drop-zone');
const fileInput   = document.getElementById('file-input');
const folderInput = document.getElementById('folder-input');

// ── Upload state ───────────────────────────────────────────────────────────
let uploadQueue   = [];
let uploadPaused  = false;
let uploadCancelled = false;
let uploadRunning = false;

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/api/me');
  if (res.status === 401) { window.location.href = '/'; return; }
  const user = await res.json();
  window._userId = user.id;
  document.getElementById('nav-username').textContent = user.username;
  loadInbox();
}

// ── Drag & drop ────────────────────────────────────────────────────────────
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

// ── Progress bar ───────────────────────────────────────────────────────────
function showProgress(total) {
  document.getElementById('upload-progress').style.display = 'block';
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-pct').textContent = '0%';
  document.getElementById('progress-count').textContent = `0 / ${total}`;
  document.getElementById('progress-label').textContent = 'Uploading...';
  document.getElementById('progress-status').textContent = '';
  document.getElementById('btn-pause').style.display = 'inline-block';
  document.getElementById('btn-resume').style.display = 'none';
}

function updateProgress(done, total, ok, dupes, errors, undated) {
  const pct = Math.round((done / total) * 100);
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';
  document.getElementById('progress-count').textContent = `${done} / ${total}`;
  const parts = [];
  if (ok)      parts.push(`${ok} added`);
  if (dupes)   parts.push(`${dupes} duplicate${dupes>1?'s':''}`);
  if (undated) parts.push(`${undated} undated`);
  if (errors)  parts.push(`${errors} error${errors>1?'s':''}`);
  document.getElementById('progress-status').textContent = parts.join(' · ');
}

function hideProgress() {
  document.getElementById('upload-progress').style.display = 'none';
}

function setPaused(paused) {
  document.getElementById('btn-pause').style.display  = paused ? 'none' : 'inline-block';
  document.getElementById('btn-resume').style.display = paused ? 'inline-block' : 'none';
  document.getElementById('progress-label').textContent = paused ? '⏸ Paused' : 'Uploading...';
}

// ── Pause / Resume / Cancel ────────────────────────────────────────────────
function pauseUpload() {
  uploadPaused = true;
  setPaused(true);
}

function resumeUpload() {
  uploadPaused = false;
  setPaused(false);
}

function cancelUpload() {
  uploadCancelled = true;
  uploadPaused = false;
  document.getElementById('progress-label').textContent = 'Cancelling...';
}

// ── Handle files ───────────────────────────────────────────────────────────
async function handleFiles(files) {
  if (!files.length) return;
  if (uploadRunning) { showToast('Upload already in progress', 'warn'); return; }

  const videos   = files.filter(f => VIDEO_EXTS.has(ext(f.name)));
  const toUpload = files.filter(f => !VIDEO_EXTS.has(ext(f.name)));

  if (videos.length) showToast(`${videos.length} video${videos.length>1?'s':''} skipped`, 'warn');
  if (!toUpload.length) return;

  // Reset state
  uploadPaused    = false;
  uploadCancelled = false;
  uploadRunning   = true;

  const total = toUpload.length;
  let done = 0, ok = 0, dupes = 0, errors = 0, undated = 0;

  showProgress(total);

  for (const file of toUpload) {
    // Cancelled
    if (uploadCancelled) break;

    // Paused — wait until resumed
    while (uploadPaused && !uploadCancelled) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (uploadCancelled) break;

    // Upload single file
    const fd = new FormData();
    fd.append('file', file);
    const d = document.getElementById('manual-date').value;
    if (d) fd.append('date', d);

    try {
      const res  = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.status === 422 && data.error === 'no_date') {
        noDate.push(file.name);
        errors++;
      } else if (res.status === 409 && data.error === 'duplicate') {
        dupes++;
      } else if (data.success) {
        ok++;
      } else {
        errors++;
      }
    } catch {
      errors++;
    }

    done++;
    updateProgress(done, total, ok, dupes, errors, undated);
  }

  // Done
  uploadRunning = false;

  if (uploadCancelled) {
    showToast(`Upload cancelled — ${ok} photo${ok!==1?'s':''} saved`, 'warn');
  } else {
    const parts = [];
    if (ok)      parts.push(`${ok} photo${ok>1?'s':''} added`);
    if (dupes)   parts.push(`${dupes} duplicate${dupes>1?'s':''} skipped`);
    if (undated) parts.push(`${undated} labeled "undated" (no EXIF date)`);
    if (errors)  parts.push(`${errors} failed`);
    if (parts.length) showToast(parts.join(' · '), ok > 0 ? 'success' : 'warn');
  }

  // Wait a moment then hide progress bar
  await new Promise(r => setTimeout(r, 2000));
  hideProgress();

  fileInput.value = ''; folderInput.value = '';
  if (ok > 0) loadInbox();
}

// ── Inbox ──────────────────────────────────────────────────────────────────
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

// ── Helpers ────────────────────────────────────────────────────────────────
function ext(name) { return name.slice(name.lastIndexOf('.')).toLowerCase(); }