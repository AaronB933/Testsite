/* badges.js — Badge Creation page */

let sourceFile = null;
  let resultImageData = null;
  let currentBg = 'transparent';
  let allArchivePhotos = [];

  // Draw tool state
  let activeTool = 'rect';  // 'rect' or 'lasso'
  let isDrawing = false;
  let drawStart = {x:0, y:0};
  let lassoPoints = [];
  let selectionData = null;  // {type, coords} — bounding box or lasso path
  let sourceImage = null;    // HTMLImageElement of loaded photo

  async function init(){
    const res = await fetch('/api/me');
    if(res.status===401){ window.location.href='/'; return; }
    const user = await res.json();
    window._userId = user.id;
    document.getElementById('nav-username').textContent = user.username;
    loadArchive();
    setupDrawTool();
    setTool('rect');
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  function switchTab(tab, btn){
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-upload').style.display = tab==='upload' ? 'block' : 'none';
    document.getElementById('tab-archive').style.display = tab==='archive' ? 'block' : 'none';
  }

  // ── Tool selection ────────────────────────────────────────────────────────
  function setTool(tool){
    activeTool = tool;
    document.getElementById('tool-rect').classList.toggle('active', tool==='rect');
    document.getElementById('tool-lasso').classList.toggle('active', tool==='lasso');
    document.getElementById('tool-hint').textContent =
      tool==='rect' ? 'Click and drag a rectangle around your subject'
                    : 'Click and drag to draw a freehand lasso';
    clearSelectionDraw();
  }

  // ── Draw tool setup ───────────────────────────────────────────────────────
  function setupDrawTool(){
    const dc = document.getElementById('draw-canvas');
    if(!dc) return;

    dc.addEventListener('mousedown', e => {
      if(!sourceImage) return;
      isDrawing = true;
      const pos = getCanvasPos(e, dc);
      drawStart = pos;
      lassoPoints = [pos];
      clearSelectionDraw();
    });

    dc.addEventListener('mousemove', e => {
      if(!isDrawing || !sourceImage) return;
      const pos = getCanvasPos(e, dc);
      const ctx = dc.getContext('2d');
      ctx.clearRect(0,0,dc.width,dc.height);

      if(activeTool === 'rect'){
        const x = Math.min(pos.x, drawStart.x);
        const y = Math.min(pos.y, drawStart.y);
        const w = Math.abs(pos.x - drawStart.x);
        const h = Math.abs(pos.y - drawStart.y);
        ctx.strokeStyle = '#3B6D11';
        ctx.lineWidth = 2;
        ctx.setLineDash([6,3]);
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = 'rgba(59,109,17,.08)';
        ctx.fillRect(x, y, w, h);
      } else {
        // Lasso
        lassoPoints.push(pos);
        ctx.beginPath();
        ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        lassoPoints.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.strokeStyle = '#3B6D11';
        ctx.lineWidth = 2;
        ctx.setLineDash([6,3]);
        ctx.stroke();
        ctx.fillStyle = 'rgba(59,109,17,.08)';
        ctx.fill();
      }
    });

    dc.addEventListener('mouseup', e => {
      if(!isDrawing) return;
      isDrawing = false;
      const pos = getCanvasPos(e, dc);

      if(activeTool === 'rect'){
        // Store bounding box in image coords
        const scaleX = sourceImage.naturalWidth / dc.width;
        const scaleY = sourceImage.naturalHeight / dc.height;
        const x = Math.round(Math.min(pos.x, drawStart.x) * scaleX);
        const y = Math.round(Math.min(pos.y, drawStart.y) * scaleY);
        const w = Math.round(Math.abs(pos.x - drawStart.x) * scaleX);
        const h = Math.round(Math.abs(pos.y - drawStart.y) * scaleY);
        if(w > 10 && h > 10){
          selectionData = {type:'rect', x, y, width:w, height:h};
          showToast('Selection set — click Remove Background', 'info');
        }
      } else {
        // Lasso — store scaled points
        if(lassoPoints.length > 5){
          const scaleX = sourceImage.naturalWidth / dc.width;
          const scaleY = sourceImage.naturalHeight / dc.height;
          const scaled = lassoPoints.map(p=>({
            x: Math.round(p.x * scaleX),
            y: Math.round(p.y * scaleY)
          }));
          selectionData = {type:'lasso', points: scaled};
          showToast('Lasso set — click Remove Background', 'info');
        }
      }
    });

    // Touch support
    dc.addEventListener('touchstart', e=>{ e.preventDefault(); dc.dispatchEvent(new MouseEvent('mousedown', getTouchPos(e))); }, {passive:false});
    dc.addEventListener('touchmove',  e=>{ e.preventDefault(); dc.dispatchEvent(new MouseEvent('mousemove', getTouchPos(e))); }, {passive:false});
    dc.addEventListener('touchend',   e=>{ e.preventDefault(); dc.dispatchEvent(new MouseEvent('mouseup',   getTouchPos(e))); }, {passive:false});
  }

  function getCanvasPos(e, canvas){
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY
    };
  }

  function getTouchPos(e){
    const t = e.touches[0] || e.changedTouches[0];
    return {clientX: t.clientX, clientY: t.clientY};
  }

  function clearSelectionDraw(){
    selectionData = null;
    lassoPoints = [];
    const dc = document.getElementById('draw-canvas');
    if(dc) dc.getContext('2d').clearRect(0,0,dc.width,dc.height);
  }

  function clearSelection(){
    clearSelectionDraw();
    showToast('Selection cleared', 'info');
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  const dz = document.getElementById('drop-zone');
  dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', ()=>dz.classList.remove('dragover'));
  dz.addEventListener('drop', e=>{ e.preventDefault(); dz.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); });

  function handleFile(file){
    if(!file) return;
    sourceFile = file;
    const reader = new FileReader();
    reader.onload = e => showSource(e.target.result);
    reader.readAsDataURL(file);
  }

  function showSource(src){
    const sc = document.getElementById('source-canvas');
    const dc = document.getElementById('draw-canvas');
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      // Set canvas dimensions to match image aspect
      sc.width  = img.naturalWidth;
      sc.height = img.naturalHeight;
      dc.width  = img.naturalWidth;
      dc.height = img.naturalHeight;
      sc.getContext('2d').drawImage(img, 0, 0);
      clearSelectionDraw();
    };
    img.src = src;
    document.getElementById('source-wrap').style.display = 'block';
  }

  function clearSource(){
    sourceFile = null;
    sourceImage = null;
    selectionData = null;
    document.getElementById('source-wrap').style.display = 'none';
    document.getElementById('result-empty').style.display = 'block';
    document.getElementById('result-wrap').style.display = 'none';
    resultImageData = null;
    document.querySelectorAll('.arch-thumb.selected').forEach(t=>t.classList.remove('selected'));
  }

  // ── Archive ───────────────────────────────────────────────────────────────
  async function loadArchive(){
    const data = await fetch('/api/photos/all?view=all').then(r=>r.json());
    allArchivePhotos = data.photos || [];
    renderArchive(allArchivePhotos);
  }

  let badgeArchOrg = 'all';

  function setBadgeArchOrg(org, btn){
    badgeArchOrg = org;
    document.querySelectorAll('#badge-arch-tabs button').forEach(b=>b.style.background='none');
    btn.style.background='white';
    filterArchive();
  }

  function renderArchive(photos){
    const SE = {spring:'🌸',summer:'☀️',fall:'🍂',winter:'❄️'};
    const grid = document.getElementById('archive-grid');

    const makeThumb = p => `<img class="arch-thumb" src="/thumbnails/user_${window._userId}/inbox/${p.stored_filename}"
      data-src="/uploads/user_${window._userId}/inbox/${p.stored_filename}"
      data-id="${p.id}" onclick="selectArchivePhoto(this)"
      onerror="this.style.display='none'" loading="lazy"
      title="${p.label||''}${p.variety?' · '+p.variety:''}">`;

    if(badgeArchOrg === 'label'){
      const groups = {};
      photos.forEach(p=>{ const k=p.label||'(unlabeled)'; if(!groups[k]) groups[k]=[]; groups[k].push(p); });
      grid.style.display = 'block';
      grid.innerHTML = Object.keys(groups).sort().map(label=>`
        <div style="margin-bottom:.6rem;">
          <div style="font-size:.65rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gray200);padding:.3rem 0 .2rem;">🌱 ${label} (${groups[label].length})</div>
          <div class="archive-grid" style="display:grid;max-height:none;">${groups[label].map(makeThumb).join('')}</div>
        </div>`).join('');
    } else if(badgeArchOrg === 'season'){
      const ORDER = ['spring','summer','fall','winter','(no season)'];
      const groups = {spring:[],summer:[],fall:[],winter:[],'(no season)':[]};
      photos.forEach(p=>{ const k=p.season||'(no season)'; if(!groups[k]) groups[k]=[]; groups[k].push(p); });
      grid.style.display = 'block';
      grid.innerHTML = ORDER.filter(s=>groups[s]&&groups[s].length).map(season=>`
        <div style="margin-bottom:.6rem;">
          <div style="font-size:.65rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gray200);padding:.3rem 0 .2rem;">${SE[season]||'📷'} ${season} (${groups[season].length})</div>
          <div class="archive-grid" style="display:grid;max-height:none;">${groups[season].map(makeThumb).join('')}</div>
        </div>`).join('');
    } else {
      grid.style.display = 'grid';
      grid.innerHTML = photos.map(makeThumb).join('');
    }
  }

  function filterArchive(){
    const q = document.getElementById('arch-search').value.toLowerCase();
    const filtered = allArchivePhotos.filter(p=>
      !q ||
      (p.label||'').toLowerCase().includes(q) ||
      (p.variety||'').toLowerCase().includes(q) ||
      (p.season||'').toLowerCase().includes(q)
    );
    renderArchive(filtered);
  }

  function selectArchivePhoto(el){
    document.querySelectorAll('.arch-thumb.selected').forEach(t=>t.classList.remove('selected'));
    el.classList.add('selected');
    showSource(el.dataset.src);
    sourceFile = null;
  }

  // ── Background removal ────────────────────────────────────────────────────
  async function removeBackground(){
    const sc = document.getElementById('source-canvas');
    if(!sourceImage){ showToast('Select a photo first','warn'); return; }

    const smsg = document.getElementById('spinner-msg'); if(smsg) smsg.textContent = selectionData ? '✨ SAM: Segmenting your selection...' : 'Removing background...';
    document.getElementById('spinner-overlay').classList.add('show');

    try {
      let blob;

      if(selectionData){
        // Crop to selection first, then remove background
        const offscreen = document.createElement('canvas');
        const ctx = offscreen.getContext('2d');

        if(selectionData.type === 'rect'){
          offscreen.width  = selectionData.width;
          offscreen.height = selectionData.height;
          ctx.drawImage(sourceImage,
            selectionData.x, selectionData.y, selectionData.width, selectionData.height,
            0, 0, selectionData.width, selectionData.height
          );
        } else {
          // Lasso — get bounding box of path, mask outside
          const pts = selectionData.points;
          const minX = Math.min(...pts.map(p=>p.x));
          const minY = Math.min(...pts.map(p=>p.y));
          const maxX = Math.max(...pts.map(p=>p.x));
          const maxY = Math.max(...pts.map(p=>p.y));
          offscreen.width  = maxX - minX;
          offscreen.height = maxY - minY;
          // Clip to lasso path then draw image
          ctx.beginPath();
          pts.forEach((p,i) => i===0 ? ctx.moveTo(p.x-minX,p.y-minY) : ctx.lineTo(p.x-minX,p.y-minY));
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(sourceImage, -minX, -minY);
        }

        blob = await new Promise(res => offscreen.toBlob(res, 'image/jpeg', 0.95));
      } else {
        // No selection — use full image
        if(sourceFile){
          blob = sourceFile;
        } else {
          const srcEl = document.getElementById('source-canvas');
          blob = await new Promise(res => srcEl.toBlob(res, 'image/jpeg', 0.95));
        }
      }

      const formData = new FormData();
      formData.append('file', blob, 'photo.jpg');

      // Send selection data to backend for SAM-guided removal
      if(selectionData){
        formData.append('selection', JSON.stringify(selectionData));
      }

      const res = await fetch('/api/badges/remove-background', {
        method: 'POST',
        body: formData
      });

      if(!res.ok){
        const err = await res.json();
        throw new Error(err.error || 'Failed');
      }

      const resultBlob = await res.blob();
      resultImageData = URL.createObjectURL(resultBlob);

      document.getElementById('result-empty').style.display = 'none';
      document.getElementById('result-wrap').style.display = 'block';
      drawBadgeCanvas();
      showToast('Background removed!');
    } catch(e){
      showToast(e.message || 'Background removal failed', 'error');
    } finally {
      document.getElementById('spinner-overlay').classList.remove('show');
    }
  }

  // ── Canvas rendering ──────────────────────────────────────────────────────
  function drawBadgeCanvas(){
    if(!resultImageData) return;
    const canvas = document.getElementById('badge-canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      canvas.width  = img.width;
      canvas.height = img.height;
      if(currentBg !== 'transparent'){
        ctx.fillStyle = currentBg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      const wrap = document.getElementById('badge-canvas-wrap');
      wrap.style.background = currentBg === 'transparent'
        ? 'repeating-conic-gradient(#f0f0f0 0% 25%,white 0% 50%) 0 0 / 16px 16px'
        : currentBg;
    };
    img.src = resultImageData;
  }

  function setBg(bg, el){
    currentBg = bg;
    document.querySelectorAll('.bg-opt').forEach(b=>b.classList.remove('active'));
    if(el) el.classList.add('active');
    drawBadgeCanvas();
  }

  // ── Download ──────────────────────────────────────────────────────────────
  function downloadBadge(format){
    if(!resultImageData){ showToast('No badge to download','warn'); return; }
    const canvas = document.getElementById('badge-canvas');
    const mime = format==='png' ? 'image/png' : 'image/jpeg';
    canvas.toBlob(blob=>{
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `badge.${format}`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, mime, 0.95);
  }

  async function saveToBadges(){
    if(!resultImageData){ showToast('No badge to save','warn'); return; }
    const canvas = document.getElementById('badge-canvas');
    canvas.toBlob(async blob=>{
      const fd = new FormData();
      fd.append('file', blob, `badge_${Date.now()}.png`);
      const res = await fetch('/api/badges/save', { method:'POST', body:fd });
      const data = await res.json();
      if(data.success) showToast('Badge saved to your badges folder');
      else showToast('Save failed','error');
    }, 'image/png');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function showToast(msg,type='success'){
    const t=document.getElementById('toast');
    t.textContent=msg;t.className=`show toast-${type}`;
    clearTimeout(t._timer);t._timer=setTimeout(()=>t.className='',4000);
  }


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

// ── Saved badges panel ─────────────────────────────────────────────────────
async function loadSavedBadges(){
  const res = await fetch('/api/garden/badges').then(r=>r.json());
  const grid = document.getElementById('saved-badges-grid');
  if(!grid) return;
  if(!res.length){
    grid.innerHTML='<div style="text-align:center;padding:1rem;color:var(--gray200);font-size:.82rem;grid-column:1/-1;">No saved badges yet — create one above</div>';
    return;
  }
  grid.innerHTML = res.map(b=>`
    <div style="text-align:center;cursor:pointer;" onclick="loadSavedBadge('${b.url}','${b.name}')"
         title="Click to reload for editing">
      <div style="background:repeating-conic-gradient(#f0f0f0 0% 25%,white 0% 50%) 0 0/16px 16px;
                  border-radius:10px;border:2px solid var(--gray100);padding:.5rem;
                  transition:border-color .15s;" onmouseover="this.style.borderColor='var(--g600)'"
                  onmouseout="this.style.borderColor='var(--gray100)'">
        <img src="${b.url}" style="width:100%;aspect-ratio:1;object-fit:contain;display:block;"
             onerror="this.parentElement.parentElement.style.display='none'"/>
      </div>
      <div style="font-size:.68rem;color:var(--gray600);margin-top:.3rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.name}</div>
    </div>`).join('');
}

function loadSavedBadge(url, name){
  // Load saved badge as source for re-editing
  showSource(url);
  sourceFile = null;
  showToast('Badge loaded — draw a selection and remove background to clean it up', 'info');
  // Switch to upload tab so canvas is visible
  switchTab('upload', document.querySelector('.tab-btn'));
}

async function init(){
  const res = await fetch('/api/me');
  if(res.status===401){ window.location.href='/'; return; }
  const user = await res.json();
  window._userId = user.id;
  document.getElementById('nav-username').textContent = user.username;
  loadArchive();
  setupDrawTool();
  setTool('rect');
  loadSavedBadges();
}