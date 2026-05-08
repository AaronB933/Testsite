/* tracker.js — Plant Tracker page */

const BUG_PRESETS = ['Thrips','Aphids','Spider Mites','Fungus Gnats','Whitefly','Mealybugs','Scale','Caterpillars','Leafminers'];
  const DISEASE_PRESETS = ['Powdery Mildew','Botrytis (Gray Mold)','Root Rot','Downy Mildew','Leaf Spot','Fusarium Wilt','Rust','Damping Off'];
  const POT_SIZES = ['4"','6"','8"','10"','12"','14"','16"+'];

  let allPlants = [], currentPlantId = null, selectedArchiveId = null, pendingPhotoFile = null;

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    const res = await fetch('/api/me');
    if (res.status === 401) { window.location.href = '/'; return; }
    const user = await res.json();
    window._userId = user.id;
    document.getElementById('nav-username').textContent = user.username;
    await loadPlants();
    loadTypePresets();
  }

  // ── Plant list ────────────────────────────────────────────────────────────
  async function loadPlants() {
    allPlants = await fetch('/api/tracker/plants').then(r => r.json());
    renderPlantList(allPlants);
  }

  function renderPlantList(plants) {
    const list = document.getElementById('plant-list');
    if (!plants.length) {
      list.innerHTML = `<div class="empty-list"><div class="icon">🪴</div><p>No plants yet<br>Click + Add Plant to start</p></div>`;
      return;
    }
    list.innerHTML = plants.map(p => {
      const sub = [p.plant_type, p.variety].filter(Boolean).join(' · ');
      const issuesDot = p.active_issues > 0 ? `<div class="issue-dot" title="${p.active_issues} active issue${p.active_issues>1?'s':''}"></div>` : '';
      const potBadge = p.pot_size ? `<span class="pr-pot">${p.pot_size}</span>` : '';
      return `
        <div class="plant-row ${p.id === currentPlantId ? 'active' : ''}" onclick="selectPlant(${p.id})">
          <div class="pr-icon">🪴</div>
          <div class="pr-info">
            <div class="pr-name">${p.name}</div>
            <div class="pr-sub">${sub || 'No type set'}</div>
          </div>
          <div class="pr-badges">${issuesDot}${potBadge}</div>
        </div>`;
    }).join('');
  }

  function filterPlants() {
    const q = document.getElementById('plant-search').value.toLowerCase();
    renderPlantList(allPlants.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.plant_type||'').toLowerCase().includes(q) ||
      (p.variety||'').toLowerCase().includes(q)
    ));
  }

  // ── Select plant ──────────────────────────────────────────────────────────
  async function selectPlant(id) {
    currentPlantId = id;
    renderPlantList(allPlants);
    await loadDetail(id);
  }

  async function loadDetail(id) {
    const [plant, care, issues, photos] = await Promise.all([
      fetch(`/api/tracker/plants/${id}`).then(r => r.json()),
      fetch(`/api/tracker/plants/${id}/care`).then(r => r.json()),
      fetch(`/api/tracker/plants/${id}/issues`).then(r => r.json()),
      fetch(`/api/tracker/plants/${id}/photos`).then(r => r.json())
    ]);
    renderDetail(plant, care, issues, photos);
  }

  function renderDetail(plant, care, issues, photos) {
    const p = plant;
    const bugs = issues.filter(i => i.category === 'bug');
    const diseases = issues.filter(i => i.category === 'disease');
    const activeIssues = issues.filter(i => i.status === 'active').length;

    // Last care dates
    const lastWatered = care.find(c => c.care_type === 'watered');
    const lastFertilized = care.find(c => c.care_type === 'fertilized');
    const lastSprayed = care.find(c => c.care_type === 'sprayed');

    function daysSince(d) {
      if (!d) return null;
      const diff = Math.floor((Date.now() - new Date(d+'T00:00:00')) / 86400000);
      return diff;
    }

    function daysLabel(d, warnAt, badAt) {
      if (!d) return { text: 'Never', cls: 'bad' };
      const days = daysSince(d);
      const cls = days >= badAt ? 'bad' : days >= warnAt ? 'warn' : 'good';
      return { text: days === 0 ? 'Today' : `${days}d ago`, cls };
    }

    const wl = daysLabel(lastWatered?.care_date, 5, 10);
    const fl = daysLabel(lastFertilized?.care_date, 14, 30);
    const sl = daysLabel(lastSprayed?.care_date, 14, 30);

    document.getElementById('detail').innerHTML = `
      <div class="detail-inner">

        <!-- Header -->
        <div class="plant-header">
          <div class="ph-top">
            <div>
              <div class="ph-title">${p.name}</div>
              <div class="ph-sub">${[p.plant_type, p.variety].filter(Boolean).join(' · ') || 'No type set'}
                ${p.location ? ' · 📍 ' + p.location : ''}</div>
            </div>
            <div class="ph-actions">
              <button class="btn-sm btn-sm-ghost" onclick="openPlantModal(${p.id})">✏️ Edit</button>
              <button class="btn-sm btn-sm-red" onclick="confirmDeletePlant(${p.id})">🗑</button>
            </div>
          </div>
          <div class="ph-info-grid">
            <div class="info-chip">
              <div class="ic-label">Pot Size</div>
              <div class="ic-value">${p.pot_size || '—'}</div>
            </div>
            <div class="info-chip">
              <div class="ic-label">Acquired</div>
              <div class="ic-value">${p.acquired_date ? fmtDate(p.acquired_date) : '—'}</div>
            </div>
            <div class="info-chip">
              <div class="ic-label">💧 Last Watered</div>
              <div class="ic-value ${wl.cls}">${wl.text}</div>
            </div>
            <div class="info-chip">
              <div class="ic-label">🌿 Last Fertilized</div>
              <div class="ic-value ${fl.cls}">${fl.text}</div>
            </div>
            <div class="info-chip">
              <div class="ic-label">💨 Last Sprayed</div>
              <div class="ic-value ${sl.cls}">${sl.text}</div>
            </div>
            <div class="info-chip">
              <div class="ic-label">⚠ Active Issues</div>
              <div class="ic-value ${activeIssues > 0 ? 'bad' : 'good'}">${activeIssues || 'None'}</div>
            </div>
          </div>
        </div>

        <!-- Care log -->
        <div class="section-card">
          <div class="sc-header">
            <div class="sc-title">Care History</div>
            <button class="btn-sm btn-sm-green" onclick="openCareModal(${p.id})">+ Log Event</button>
          </div>
          ${care.length ? `
          <table class="care-table">
            <thead><tr>
              <th>Type</th><th>Date</th><th>Product</th><th>Amount</th><th>Notes</th><th></th>
            </tr></thead>
            <tbody>${care.map(c => `
              <tr>
                <td><span class="care-badge cb-${c.care_type}">${c.care_type}</span></td>
                <td>${fmtDate(c.care_date)}</td>
                <td>${c.product || '—'}</td>
                <td>${c.amount || '—'}</td>
                <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.notes || '—'}</td>
                <td><button class="btn-sm btn-sm-red" onclick="deleteCare(${c.id})">✕</button></td>
              </tr>`).join('')}
            </tbody>
          </table>` : `<p style="font-size:.82rem;color:var(--gray200);">No care events logged yet.</p>`}
        </div>

        <!-- Bug issues -->
        <div class="section-card">
          <div class="sc-header">
            <div class="sc-title">🐛 Bug / Pest Issues</div>
            <button class="btn-sm btn-sm-green" onclick="openIssueModal(${p.id},'bug')">+ Add Issue</button>
          </div>
          ${bugs.length ? bugs.map(i => renderIssue(i)).join('') : `<p style="font-size:.82rem;color:var(--gray200);">No bug issues recorded.</p>`}
        </div>

        <!-- Disease issues -->
        <div class="section-card">
          <div class="sc-header">
            <div class="sc-title">🍄 Disease Issues</div>
            <button class="btn-sm btn-sm-green" onclick="openIssueModal(${p.id},'disease')">+ Add Issue</button>
          </div>
          ${diseases.length ? diseases.map(i => renderIssue(i)).join('') : `<p style="font-size:.82rem;color:var(--gray200);">No disease issues recorded.</p>`}
        </div>

        <!-- Photos -->
        <div class="section-card">
          <div class="sc-header">
            <div class="sc-title">📷 Photos (${photos.length})</div>
            <button class="btn-sm btn-sm-green" onclick="openPhotoModal(${p.id})">+ Add Photo</button>
          </div>
          ${photos.length ? `<div class="photo-grid">${photos.map(ph => {
            const src = ph.archive_photo_id
              ? `/uploads/user_${window._userId}/inbox/${ph.stored_filename}`
              : `/uploads/user_${window._userId}/tracker/${p.id}/${ph.stored_filename}`;
            return `<div class="tp-card" onclick="openLightbox('${src}')">
              <button class="tp-del" onclick="event.stopPropagation();deleteTrackerPhoto(${ph.id})">✕</button>
              <img src="${src}" loading="lazy" onerror="this.style.background='#EAF3DE'">
              <div class="tp-caption">${ph.caption || fmtDate(ph.taken_date) || '—'}</div>
            </div>`;
          }).join('')}</div>` : `<p style="font-size:.82rem;color:var(--gray200);">No photos yet.</p>`}
        </div>

        <!-- Notes -->
        <div class="section-card">
          <div class="sc-header">
            <div class="sc-title">📝 Notes</div>
            <button class="btn-sm btn-sm-ghost" onclick="openPlantModal(${p.id})">Edit</button>
          </div>
          ${p.notes ? `<div class="notes-text">${escHtml(p.notes)}</div>` : `<p class="notes-empty">No notes added.</p>`}
        </div>

      </div>`;
  }

  function renderIssue(i) {
    const icon = i.category === 'bug' ? '🐛' : '🍄';
    const cls = i.status === 'active' ? 'active-issue' : 'resolved-issue';
    const statusBadge = `<span class="status-badge ${i.status === 'active' ? 'sb-active' : 'sb-resolved'}">${i.status}</span>`;
    const resolveBtn = i.status === 'active'
      ? `<button class="btn-sm btn-sm-ghost" onclick="resolveIssue(${i.id})">✅ Resolve</button>`
      : '';
    return `
      <div class="issue-item ${cls}">
        <div class="issue-icon">${icon}</div>
        <div class="issue-info">
          <div class="issue-name">${i.issue_name} ${statusBadge}</div>
          <div class="issue-meta">${i.first_seen ? 'First seen: ' + fmtDate(i.first_seen) : ''}${i.resolved_date ? ' · Resolved: ' + fmtDate(i.resolved_date) : ''}</div>
          ${i.notes ? `<div class="issue-notes">${escHtml(i.notes)}</div>` : ''}
        </div>
        <div class="issue-actions">
          ${resolveBtn}
          <button class="btn-sm btn-sm-red" onclick="deleteIssue(${i.id})">✕</button>
        </div>
      </div>`;
  }

  // ── Plant modal ───────────────────────────────────────────────────────────
  async function openPlantModal(plantId = null) {
    document.getElementById('pm-id').value = plantId || '';
    document.getElementById('plant-modal-title').textContent = plantId ? 'Edit Plant' : 'Add Plant';
    if (plantId) {
      const p = await fetch(`/api/tracker/plants/${plantId}`).then(r => r.json());
      document.getElementById('pm-name').value = p.name || '';
      document.getElementById('pm-pot').value = p.pot_size || '';
      document.getElementById('pm-type').value = p.plant_type || '';
      document.getElementById('pm-variety').value = p.variety || '';
      document.getElementById('pm-location').value = p.location || '';
      document.getElementById('pm-acquired').value = p.acquired_date || '';
      document.getElementById('pm-notes').value = p.notes || '';
    } else {
      ['pm-name','pm-type','pm-variety','pm-location','pm-notes'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('pm-pot').value = '';
      document.getElementById('pm-acquired').value = '';
    }
    document.getElementById('plant-modal').classList.add('show');
    setTimeout(() => document.getElementById('pm-name').focus(), 50);
  }

  function closePlantModal() { document.getElementById('plant-modal').classList.remove('show'); }

  async function savePlant() {
    const name = document.getElementById('pm-name').value.trim();
    if (!name) { showToast('Plant name is required', 'warn'); return; }
    const id = document.getElementById('pm-id').value;
    const body = {
      name,
      plant_type: document.getElementById('pm-type').value.trim(),
      variety: document.getElementById('pm-variety').value.trim(),
      pot_size: document.getElementById('pm-pot').value,
      location: document.getElementById('pm-location').value.trim(),
      acquired_date: document.getElementById('pm-acquired').value || null,
      notes: document.getElementById('pm-notes').value.trim()
    };
    const url = id ? `/api/tracker/plants/${id}` : '/api/tracker/plants';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) {
      closePlantModal();
      showToast(id ? 'Plant updated' : 'Plant added');
      await loadPlants();
      loadTypePresets();
      if (!id && data.id) { currentPlantId = data.id; renderPlantList(allPlants); await loadDetail(data.id); }
      else if (id) await loadDetail(parseInt(id));
    } else showToast(data.error || 'Failed', 'error');
  }

  async function confirmDeletePlant(id) {
    if (!confirm('Delete this plant and all its care logs, issues, and photos?')) return;
    await fetch(`/api/tracker/plants/${id}`, { method: 'DELETE' });
    showToast('Plant deleted');
    currentPlantId = null;
    document.getElementById('detail').innerHTML = `<div class="detail-empty"><div class="icon">🌿</div><p>Select a plant to view details</p></div>`;
    await loadPlants();
  }

  // ── Care modal ────────────────────────────────────────────────────────────
  let carePlantId = null;
  function openCareModal(plantId) {
    carePlantId = plantId;
    document.getElementById('cm-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('cm-product').value = '';
    document.getElementById('cm-amount').value = '';
    document.getElementById('cm-notes').value = '';
    loadProductPresets();
    document.getElementById('care-modal').classList.add('show');
  }
  function closeCareModal() { document.getElementById('care-modal').classList.remove('show'); }

  async function loadProductPresets() {
    const type = document.getElementById('cm-type').value;
    const presets = await fetch(`/api/tracker/presets/products/${type}`).then(r => r.json());
    document.getElementById('product-presets').innerHTML = presets.map(p => `<option value="${escHtml(p)}">`).join('');
  }

  async function saveCare() {
    const care_type = document.getElementById('cm-type').value;
    const care_date = document.getElementById('cm-date').value;
    if (!care_date) { showToast('Date is required', 'warn'); return; }
    const body = {
      care_type, care_date,
      product: document.getElementById('cm-product').value.trim(),
      amount: document.getElementById('cm-amount').value.trim(),
      notes: document.getElementById('cm-notes').value.trim()
    };
    const res = await fetch(`/api/tracker/plants/${carePlantId}/care`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      closeCareModal();
      showToast(`${care_type} logged`);
      await loadPlants();
      await loadDetail(carePlantId);
    } else showToast(data.error || 'Failed', 'error');
  }

  async function deleteCare(id) {
    await fetch(`/api/tracker/care/${id}`, { method: 'DELETE' });
    showToast('Entry removed');
    await loadPlants();
    await loadDetail(currentPlantId);
  }

  // ── Issue modal ───────────────────────────────────────────────────────────
  let issuePlantId = null;
  function openIssueModal(plantId, category = 'bug') {
    issuePlantId = plantId;
    document.getElementById('im-id').value = '';
    document.getElementById('im-issue-modal-title');
    document.getElementById('im-category').value = category;
    document.getElementById('im-name').value = '';
    document.getElementById('im-status').value = 'active';
    document.getElementById('im-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('im-notes').value = '';
    updateIssueNames();
    document.getElementById('issue-modal').classList.add('show');
  }
  function closeIssueModal() { document.getElementById('issue-modal').classList.remove('show'); }

  function updateIssueNames() {
    const cat = document.getElementById('im-category').value;
    const presets = cat === 'bug' ? BUG_PRESETS : DISEASE_PRESETS;
    document.getElementById('issue-presets').innerHTML = presets.map(p => `<option value="${p}">`).join('');
  }

  async function saveIssue() {
    const name = document.getElementById('im-name').value.trim();
    if (!name) { showToast('Issue name required', 'warn'); return; }
    const body = {
      category: document.getElementById('im-category').value,
      issue_name: name,
      status: document.getElementById('im-status').value,
      first_seen: document.getElementById('im-date').value || null,
      notes: document.getElementById('im-notes').value.trim()
    };
    const res = await fetch(`/api/tracker/plants/${issuePlantId}/issues`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      closeIssueModal(); showToast('Issue added');
      await loadPlants(); await loadDetail(issuePlantId);
    } else showToast(data.error || 'Failed', 'error');
  }

  async function resolveIssue(id) {
    const today = new Date().toISOString().split('T')[0];
    await fetch(`/api/tracker/issues/${id}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ status: 'resolved', resolved_date: today, notes: '' })
    });
    showToast('Issue marked resolved');
    await loadPlants(); await loadDetail(currentPlantId);
  }

  async function deleteIssue(id) {
    await fetch(`/api/tracker/issues/${id}`, { method: 'DELETE' });
    showToast('Issue removed');
    await loadPlants(); await loadDetail(currentPlantId);
  }

  // ── Photo modal ───────────────────────────────────────────────────────────
  let photoPlantId = null;
  async function openPhotoModal(plantId) {
    photoPlantId = plantId;
    selectedArchiveId = null; pendingPhotoFile = null;
    document.getElementById('phm-caption').value = '';
    document.getElementById('phm-date').value = '';
    document.getElementById('phm-archive-id').value = '';
    document.getElementById('photo-preview').style.display = 'none';
    document.getElementById('photo-file-input').value = '';
    switchPhotoTab('upload', document.querySelector('.tab-btn'));

    // Load archive photos for picker - use /api/photos/all for full list
    const archData = await fetch('/api/photos/all?view=all').then(r => r.json());
    const archivePhotos = archData.photos || [];
    window._trackerArchivePhotos = archivePhotos;
    renderTrackerArchive('all', '');
    document.getElementById('photo-modal').classList.add('show');
  }

  function renderTrackerArchive(org, q){
    const photos = (window._trackerArchivePhotos||[]).filter(p =>
      !q || (p.label||'').toLowerCase().includes(q) ||
      (p.variety||'').toLowerCase().includes(q) ||
      (p.season||'').toLowerCase().includes(q)
    );
    const SE = {spring:'🌸',summer:'☀️',fall:'🍂',winter:'❄️'};
    const grid = document.getElementById('archive-picker');

    if(org === 'label'){
      const groups = {};
      photos.forEach(p => { const k = p.label||'(unlabeled)'; if(!groups[k]) groups[k]=[]; groups[k].push(p); });
      grid.style.display = 'block';
      grid.innerHTML = Object.keys(groups).sort().map(label => `
        <div style="margin-bottom:.6rem;">
          <div style="font-size:.65rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gray200);padding:.3rem 0 .2rem;">🌱 ${label}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(65px,1fr));gap:.3rem;">
            ${groups[label].map(p => trackerThumb(p)).join('')}
          </div>
        </div>`).join('');
    } else if(org === 'season'){
      const ORDER = ['spring','summer','fall','winter','(no season)'];
      const groups = {spring:[],summer:[],fall:[],winter:[],'(no season)':[]};
      photos.forEach(p => { const k=p.season||'(no season)'; if(!groups[k]) groups[k]=[]; groups[k].push(p); });
      grid.style.display = 'block';
      grid.innerHTML = ORDER.filter(s=>groups[s]&&groups[s].length).map(season => `
        <div style="margin-bottom:.6rem;">
          <div style="font-size:.65rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gray200);padding:.3rem 0 .2rem;">${SE[season]||'📷'} ${season}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(65px,1fr));gap:.3rem;">
            ${groups[season].map(p => trackerThumb(p)).join('')}
          </div>
        </div>`).join('');
    } else {
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(65px,1fr))';
      grid.innerHTML = photos.map(p => trackerThumb(p)).join('');
    }
  }

  function trackerThumb(p){
    return `<img src="/thumbnails/user_${window._userId}/inbox/${p.stored_filename}"
      style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent;"
      onclick="selectArchivePhoto(${p.id},this)"
      onerror="this.style.display='none'"
      loading="lazy"
      title="${p.label||''}${p.variety?' · '+p.variety:''}">`;
  }
  function closePhotoModal() { document.getElementById('photo-modal').classList.remove('show'); }

  function switchPhotoTab(tab, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('photo-tab-upload').style.display = tab === 'upload' ? 'block' : 'none';
    document.getElementById('photo-tab-archive').style.display = tab === 'archive' ? 'block' : 'none';
  }

  function handlePhotoFile(file) {
    if (!file) return;
    pendingPhotoFile = file;
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('photo-preview-img').src = e.target.result;
      document.getElementById('photo-preview').style.display = 'block';
    };
    reader.readAsDataURL(file);
  }

  function selectArchivePhoto(id, el) {
    selectedArchiveId = id;
    document.querySelectorAll('.ap-thumb').forEach(t => t.classList.remove('selected'));
    el.classList.add('selected');
  }

  async function savePhoto() {
    const caption = document.getElementById('phm-caption').value.trim();
    const taken_date = document.getElementById('phm-date').value || null;
    const isUpload = document.getElementById('photo-tab-upload').style.display !== 'none';

    if (isUpload && pendingPhotoFile) {
      const fd = new FormData();
      fd.append('file', pendingPhotoFile);
      fd.append('caption', caption);
      if (taken_date) fd.append('taken_date', taken_date);
      const res = await fetch(`/api/tracker/plants/${photoPlantId}/photos`, { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) { closePhotoModal(); showToast('Photo added'); await loadDetail(photoPlantId); }
      else showToast(data.error || 'Failed', 'error');
    } else if (!isUpload && selectedArchiveId) {
      const res = await fetch(`/api/tracker/plants/${photoPlantId}/photos`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ archive_photo_id: selectedArchiveId, caption, taken_date })
      });
      const data = await res.json();
      if (data.success) { closePhotoModal(); showToast('Photo linked'); await loadDetail(photoPlantId); }
      else showToast(data.error || 'Failed', 'error');
    } else {
      showToast('Please select or upload a photo', 'warn');
    }
  }

  async function deleteTrackerPhoto(id) {
    await fetch(`/api/tracker/photos/${id}`, { method: 'DELETE' });
    showToast('Photo removed');
    await loadDetail(currentPlantId);
  }

  // ── Presets ───────────────────────────────────────────────────────────────
  async function loadTypePresets() {
    const presets = await fetch('/api/tracker/presets/types').then(r => r.json());
    document.getElementById('type-presets').innerHTML = presets.map(p => `<option value="${escHtml(p)}">`).join('');
  }

  // ── Lightbox ──────────────────────────────────────────────────────────────
  function openLightbox(src) {
    document.getElementById('lb-img').src = src;
    document.getElementById('lightbox').classList.add('show');
  }
  function closeLightbox() { document.getElementById('lightbox').classList.remove('show'); }
  document.getElementById('lightbox').addEventListener('click', function(e) { if (e.target === this) closeLightbox(); });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['plant-modal','care-modal','issue-modal','photo-modal'].forEach(id =>
        document.getElementById(id).classList.remove('show'));
      closeLightbox();
    }
    if (e.key === 'Enter' && document.getElementById('plant-modal').classList.contains('show') && document.activeElement.tagName !== 'TEXTAREA') savePlant();
    if (e.key === 'Enter' && document.getElementById('care-modal').classList.contains('show') && document.activeElement.tagName !== 'TEXTAREA') saveCare();
    if (e.key === 'Enter' && document.getElementById('issue-modal').classList.contains('show') && document.activeElement.tagName !== 'TEXTAREA') saveIssue();
  });

  // ── Close modals on backdrop click ────────────────────────────────────────
  ['plant-modal','care-modal','issue-modal','photo-modal'].forEach(id => {
    document.getElementById(id).addEventListener('click', function(e) {
      if (e.target === this) this.classList.remove('show');
    });
  });

  // Photo drop zone
  const pdz = document.getElementById('photo-drop-zone');
  pdz.addEventListener('dragover', e => { e.preventDefault(); pdz.classList.add('dragover'); });
  pdz.addEventListener('dragleave', () => pdz.classList.remove('dragover'));
  pdz.addEventListener('drop', e => { e.preventDefault(); pdz.classList.remove('dragover'); handlePhotoFile(e.dataTransfer.files[0]); });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  }
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function showToast(msg, type='success') {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = `show toast-${type}`;
    clearTimeout(t._timer); t._timer = setTimeout(() => t.className = '', 3500);
  }
  function doLogout() { fetch('/api/logout',{method:'POST'}).then(()=>window.location.href='/'); }


  function toggleDarkMode(){
    const isDark = document.documentElement.classList.toggle('dark-mode');
    localStorage.setItem('site-dark-mode', isDark ? 'dark' : 'light');
    // Update toggle button text on any page
    const btn = document.getElementById('dark-mode-toggle');
    if(btn) btn.textContent = isDark ? '☀️' : '🌙';
  }
  // Init toggle button state
  (function(){
    const btn = document.getElementById('dark-mode-toggle');
    if(btn) btn.textContent = document.documentElement.classList.contains('dark-mode') ? '☀️' : '🌙';
  })();

  init();