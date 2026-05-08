/**
 * shared.js — Utilities shared across all Plant Archive pages.
 * Loaded on every page via <script src="/static/js/shared.js">
 */

// ── Dark mode ──────────────────────────────────────────────────────────────
(function () {
  if (localStorage.getItem('site-dark-mode') === 'dark') {
    document.documentElement.classList.add('dark-mode');
  }
})();

function toggleDarkMode() {
  const isDark = document.documentElement.classList.toggle('dark-mode');
  localStorage.setItem('site-dark-mode', isDark ? 'dark' : 'light');
  const btn = document.getElementById('dark-mode-toggle');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
}

function initDarkModeToggle() {
  const btn = document.getElementById('dark-mode-toggle');
  if (btn) btn.textContent = document.documentElement.classList.contains('dark-mode') ? '☀️' : '🌙';
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `show toast-${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = '', 4000);
}

// ── Date formatting ────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return 'Unknown date';
  // Handle both "2026-04-25" and "2026-04-25T00:00:00" from PostgreSQL
  const clean = d.includes('T') ? d : d + 'T00:00:00';
  const dt = new Date(clean);
  if (isNaN(dt)) return 'Unknown date';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Auth ───────────────────────────────────────────────────────────────────
function doLogout() {
  fetch('/api/logout', { method: 'POST' }).then(() => window.location.href = '/');
}

async function requireAuth() {
  const res = await fetch('/api/me');
  if (res.status === 401) { window.location.href = '/'; return null; }
  const user = await res.json();
  window._userId = user.id;
  const el = document.getElementById('nav-username');
  if (el) el.textContent = user.username;
  return user;
}

// ── Spinner ────────────────────────────────────────────────────────────────
function showSpinner(msg = 'Working...') {
  const el = document.getElementById('spinner-msg') || document.getElementById('spinner-overlay');
  if (document.getElementById('spinner-msg')) document.getElementById('spinner-msg').textContent = msg;
  const overlay = document.getElementById('spinner-overlay');
  if (overlay) overlay.classList.add('show');
}

function hideSpinner() {
  const overlay = document.getElementById('spinner-overlay');
  if (overlay) overlay.classList.remove('show');
}

// ── Archive photo picker (shared organized picker) ─────────────────────────
// Used by tracker, badges, and garden planner texture modal
const ArchivePicker = {
  photos: [],
  org: 'all',
  containerId: null,
  onSelect: null,
  userId: null,

  async load(containerId, onSelectFn, org = 'all') {
    this.containerId = containerId;
    this.onSelect = onSelectFn;
    this.org = org;
    this.userId = window._userId;
    const data = await fetch('/api/photos/all?view=all').then(r => r.json());
    this.photos = data.photos || [];
    this.render('all', '');
  },

  setOrg(org) {
    this.org = org;
    this.render(org, document.getElementById('arch-search')?.value || '');
  },

  filter(q) {
    this.render(this.org, q);
  },

  render(org, q) {
    const SE = { spring: '🌸', summer: '☀️', fall: '🍂', winter: '❄️' };
    const uid = this.userId || window._userId;
    const photos = this.photos.filter(p =>
      !q ||
      (p.label || '').toLowerCase().includes(q.toLowerCase()) ||
      (p.variety || '').toLowerCase().includes(q.toLowerCase()) ||
      (p.season || '').toLowerCase().includes(q.toLowerCase())
    );

    const makeThumb = (p) =>
      `<img src="/thumbnails/user_${uid}/inbox/${p.stored_filename}"
        style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid transparent;transition:border-color .15s;"
        data-photo-id="${p.id}"
        data-full="/uploads/user_${uid}/inbox/${p.stored_filename}"
        onclick="ArchivePicker._click(this,${p.id})"
        onerror="this.style.display='none'"
        loading="lazy"
        title="${p.label || ''}${p.variety ? ' · ' + p.variety : ''}${p.season ? ' · ' + p.season : ''}">`;

    const grid = document.getElementById(this.containerId);
    if (!grid) return;

    if (org === 'label') {
      const groups = {};
      photos.forEach(p => {
        const k = p.label || '(unlabeled)';
        if (!groups[k]) groups[k] = [];
        groups[k].push(p);
      });
      grid.style.cssText = 'display:block;';
      grid.innerHTML = Object.keys(groups).sort().map(label => `
        <div style="margin-bottom:.75rem;">
          <div style="font-size:.67rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gray200);padding:.35rem 0 .25rem;">🌱 ${label} (${groups[label].length})</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:.35rem;">
            ${groups[label].map(makeThumb).join('')}
          </div>
        </div>`).join('');

    } else if (org === 'season') {
      const ORDER = ['spring', 'summer', 'fall', 'winter', '(no season)'];
      const groups = { spring: [], summer: [], fall: [], winter: [], '(no season)': [] };
      photos.forEach(p => {
        const k = p.season || '(no season)';
        if (!groups[k]) groups[k] = [];
        groups[k].push(p);
      });
      grid.style.cssText = 'display:block;';
      grid.innerHTML = ORDER.filter(s => groups[s] && groups[s].length).map(season => `
        <div style="margin-bottom:.75rem;">
          <div style="font-size:.67rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gray200);padding:.35rem 0 .25rem;">${SE[season] || '📷'} ${season.charAt(0).toUpperCase() + season.slice(1)} (${groups[season].length})</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:.35rem;">
            ${groups[season].map(makeThumb).join('')}
          </div>
        </div>`).join('');

    } else {
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:.35rem;';
      grid.innerHTML = photos.map(makeThumb).join('');
    }
  },

  _click(el, photoId) {
    // Highlight selected
    const container = document.getElementById(this.containerId);
    if (container) container.querySelectorAll('img').forEach(i => i.style.borderColor = 'transparent');
    el.style.borderColor = 'var(--g600)';
    const photo = this.photos.find(p => p.id === photoId);
    if (this.onSelect) this.onSelect(photoId, photo, el);
  },

  renderTabBar(containerId, searchId) {
    return `
      <div style="display:flex;gap:.25rem;background:var(--gray50);border-radius:9px;padding:3px;margin-bottom:.5rem;" id="${containerId}-tabs">
        <button onclick="ArchivePicker.setOrg('all');this.closest('[id$=tabs]').querySelectorAll('button').forEach(b=>b.style.cssText='');this.style.cssText='background:white;border-radius:7px;'"
          style="flex:1;padding:.35rem;border-radius:7px;font-size:.73rem;font-family:inherit;cursor:pointer;border:none;background:white;">All</button>
        <button onclick="ArchivePicker.setOrg('label');this.closest('[id$=tabs]').querySelectorAll('button').forEach(b=>b.style.cssText='');this.style.cssText='background:white;border-radius:7px;'"
          style="flex:1;padding:.35rem;border-radius:7px;font-size:.73rem;font-family:inherit;cursor:pointer;border:none;background:none;">🌱 By Plant</button>
        <button onclick="ArchivePicker.setOrg('season');this.closest('[id$=tabs]').querySelectorAll('button').forEach(b=>b.style.cssText='');this.style.cssText='background:white;border-radius:7px;'"
          style="flex:1;padding:.35rem;border-radius:7px;font-size:.73rem;font-family:inherit;cursor:pointer;border:none;background:none;">🍂 By Season</button>
      </div>
      <input id="${searchId}" type="text" placeholder="Search by name, variety, season..."
        oninput="ArchivePicker.filter(this.value)"
        style="width:100%;padding:.38rem .65rem;border:1px solid var(--gray100);border-radius:8px;font-family:inherit;font-size:.82rem;margin-bottom:.5rem;outline:none;"/>`;
  }
};