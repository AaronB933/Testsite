/* garden/badges_tex.js */

// ── Badges ─────────────────────────────────────────────────────────────────
let draggingBadge = null;
let hasUnsavedChanges = false;

function dragBadge(e, idx){
  draggingBadge = badges[idx];
  e.dataTransfer.setData('text/plain', JSON.stringify({url:badges[idx].url, name:badges[idx].name}));
  e.dataTransfer.effectAllowed = 'copy';
}

function clickPlaceBadge(idx){
  // Place badge at center of current view
  const badge = badges[idx];
  const cx = canvas.width/2, cy = canvas.height/2;
  const {x:wx, y:wy} = canvasToWorld(cx, cy);
  const spacing = parseFloat(document.getElementById('prop-spacing').value)||2;
  addItem({
    type:'plant', x:snapFt(wx-spacing/2), y:snapFt(wy-spacing/2),
    wFt:spacing, hFt:spacing,
    plantSize:1.5, spacing,
    name:badge.name||'Plant', badgeUrl:badge.url,
    badgeImg:null, layer:'plants', rotation:0
  });
  showToast(`Placed ${badge.name} — drag to reposition`,'info');
}


async function loadBadges(){
  const data=await fetch('/api/garden/badges').then(r=>r.json());
  badges=data;
  const grid=document.getElementById('badges-grid');
  if(!badges.length){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:.75rem;font-size:.72rem;color:#666;">No badges yet — create some in Badge Creation</div>';
    return;
  }
  grid.innerHTML=badges.map((b,idx)=>{
    return `<div class="badge-item" draggable="true"
         ondragstart="dragBadge(event,${String(idx)})"
         onclick="clickPlaceBadge(${String(idx)})"
         title="Drag onto canvas or click to place">
      <img src="${b.url}" onerror="this.parentElement.style.opacity=0.4"/>
      <div class="badge-name">${b.name}</div>
    </div>`;
  }).join('');
}

// ── Textures ───────────────────────────────────────────────────────────────
let allArchiveForTex = [];
let texOrg = 'label'; // 'label' | 'season' | 'all'

async function loadArchiveTextures(){
  const data = await fetch('/api/photos/all?view=all').then(r=>r.json());
  allArchiveForTex = data.photos || [];
  renderTexArchive();
}

function setTexOrg(mode, btn){
  texOrg = mode;
  document.querySelectorAll('.tab-btn-sm').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderTexArchive();
}

function filterTexArchive(){
  renderTexArchive();
}

function renderTexArchive(){
  const q = (document.getElementById('tex-search')?.value||'').toLowerCase();
  const photos = allArchiveForTex.filter(p=>
    !q ||
    (p.label||'').toLowerCase().includes(q) ||
    (p.variety||'').toLowerCase().includes(q) ||
    (p.season||'').toLowerCase().includes(q)
  );

  const grid = document.getElementById('texture-archive-grid');

  if(texOrg === 'all'){
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill,minmax(78px,1fr))';
    grid.style.gap = '.4rem';
    grid.innerHTML = photos.map(p=>texThumb(p)).join('');
    return;
  }

  if(texOrg === 'label'){
    // Group by label
    const groups = {};
    photos.forEach(p=>{
      const key = p.label || '(unlabeled)';
      if(!groups[key]) groups[key]=[];
      groups[key].push(p);
    });
    grid.style.display = 'block';
    grid.innerHTML = Object.keys(groups).sort().map(label=>`
      <div style="margin-bottom:.75rem;">
        <div class="archive-group-header">🌱 ${label} (${groups[label].length})</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:.35rem;">
          ${groups[label].map(p=>texThumb(p)).join('')}
        </div>
      </div>`).join('');
    return;
  }

  if(texOrg === 'season'){
    const SE = {spring:'🌸',summer:'☀️',fall:'🍂',winter:'❄️'};
    const ORDER = ['spring','summer','fall','winter','(no season)'];
    const groups = {spring:[],summer:[],fall:[],winter:[],'(no season)':[]};
    photos.forEach(p=>{
      const key = p.season || '(no season)';
      if(!groups[key]) groups[key]=[];
      groups[key].push(p);
    });
    grid.style.display = 'block';
    grid.innerHTML = ORDER.filter(s=>groups[s]&&groups[s].length).map(season=>`
      <div style="margin-bottom:.75rem;">
        <div class="archive-group-header">${SE[season]||'📷'} ${season.charAt(0).toUpperCase()+season.slice(1)} (${groups[season].length})</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:.35rem;">
          ${groups[season].map(p=>texThumb(p)).join('')}
        </div>
      </div>`).join('');
    return;
  }
}

function texThumb(p){
  return `<img style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid transparent;transition:border-color .15s;"
       src="/thumbnails/user_${window._userId}/inbox/${p.stored_filename}"
       data-photo-id="${p.id}"
       data-full="/uploads/user_${window._userId}/inbox/${p.stored_filename}"
       onclick="selectTexture(this,${p.id})"
       onerror="this.style.display='none'"
       loading="lazy"
       title="${p.label||''}${p.variety?' · '+p.variety:''}${p.season?' · '+p.season:''}">`;
}

function selectTexture(el,photoId){
  document.querySelectorAll('#texture-archive-grid img').forEach(i=>i.style.borderColor='transparent');
  el.style.borderColor='var(--g600)';
  selectedTexturePhotoId=photoId;
  document.getElementById('texture-preview-wrap').style.display='block';
  document.getElementById('texture-preview-img').src=el.dataset.full;
}

function openTextureModal(){
  document.getElementById('texture-modal').classList.add('show');
}

async function addSelectedTexture(){
  if(!selectedTexturePhotoId){ showToast('Select a photo first','warn'); return; }
  // Create a canvas pattern from the photo
  const thumbUrl=document.querySelector(`#texture-archive-grid img[data-photo-id="${selectedTexturePhotoId}"]`)?.dataset.full;
  if(!thumbUrl) return;
  const img=new Image();
  img.crossOrigin='anonymous';
  img.onload=()=>{
    // Tile the image
    const offscreen=document.createElement('canvas');
    offscreen.width=img.width; offscreen.height=img.height;
    offscreen.getContext('2d').drawImage(img,0,0);
    const pattern=ctx.createPattern(offscreen,'repeat');
    const id='tex_'+Date.now();
    const name='Texture '+(textures.length+1);
    textures.push({id,name,pattern,tileUrl:thumbUrl,photoId:selectedTexturePhotoId});
    renderTexturePanel();
    document.getElementById('texture-modal').classList.remove('show');
    showToast(`Texture "${name}" added`);
    // Update texture dropdown in edit modal
    const sel=document.getElementById('em-texture');
    sel.innerHTML='<option value="">None (solid color)</option>'+
      textures.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  };
  img.src=thumbUrl;
}

function renderTexturePanel(){
  const grid=document.getElementById('texture-grid');
  grid.innerHTML=textures.map(t=>`
    <div class="texture-item" onclick="applyTextureToSelected('${t.id}')">
      <img src="${t.tileUrl}" onerror="this.style.background='#3a3a3a'"/>
      <div class="tex-name">${t.name}</div>
    </div>`).join('');
}

function applyTextureToSelected(texId){
  const item=getItem(state.selectedId);
  if(!item||item.type!=='bed'){ showToast('Select a garden bed first','warn'); return; }
  item.textureId=texId;
  pushHistory(); redraw(); showToast('Texture applied');
}

// ── Layers ─────────────────────────────────────────────────────────────────
function updateLayersList(){
  document.getElementById('layers-list').innerHTML=[...state.layers].reverse().map(l=>`
    <div class="layer-item ${l.id===state.selectedId?'selected':''}">
      <span class="layer-vis ${l.visible?'on':''}" onclick="toggleLayer('${l.id}')">👁</span>
      <span style="flex:1">${l.name}</span>
    </div>`).join('');
}

function toggleLayer(id){
  const l=state.layers.find(l=>l.id===id);
  if(l){ l.visible=!l.visible; updateLayersList(); redraw(); }
}

function addLayer(){
  const name=prompt('Layer name:','New Layer');
  if(!name) return;
  const id='layer_'+Date.now();
  state.layers.push({id,name,visible:true});
  updateLayersList();
}

// ── Undo/Redo ──────────────────────────────────────────────────────────────
function pushHistory(){
  hasUnsavedChanges = true;
  const snapshot=JSON.stringify({items:state.items.map(i=>({...i,badgeImg:null})),gardenW:state.gardenW,gardenH:state.gardenH});
  history=history.slice(0,historyIdx+1);
  history.push(snapshot);
  if(history.length>50) history.shift();
  historyIdx=history.length-1;
}

function undo(){
  if(historyIdx<=0){ showToast('Nothing to undo','info'); return; }
  historyIdx--;
  restoreHistory();
}

function redo(){
  if(historyIdx>=history.length-1){ showToast('Nothing to redo','info'); return; }
  historyIdx++;
  restoreHistory();
}

function restoreHistory(){
  const snap=JSON.parse(history[historyIdx]);
  state.items=snap.items;
  state.gardenW=snap.gardenW;
  state.gardenH=snap.gardenH;
  state.items.filter(i=>i.badgeUrl).forEach(loadBadgeImage);
  redraw();
}

document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){ e.preventDefault(); undo(); }
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.key==='z'&&e.shiftKey))){ e.preventDefault(); redo(); }
  if(e.key==='Delete'&&state.selectedId){ deleteItem(state.selectedId); }
  if(e.key==='Escape'){ state.selectedId=null; hideSelProps(); redraw(); }
});

// ── Save/Load ──────────────────────────────────────────────────────────────
function openSaveModal(){
  document.getElementById('save-name').value=state.currentLayoutName;
  document.getElementById('save-modal').classList.add('show');
  setTimeout(()=>document.getElementById('save-name').select(),50);
}

async function saveLayout(){
  const name=document.getElementById('save-name').value.trim()||'My Garden';
  state.currentLayoutName=name;
  const layout={
    gardenW:state.gardenW, gardenH:state.gardenH,
    items:state.items.map(i=>({...i,badgeImg:null,pattern:null})),
    layers:state.layers
  };
  const res=await fetch('/api/garden/layouts',{
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name,layout,id:state.currentLayoutId})
  });
  const data=await res.json();
  if(data.success){
    state.currentLayoutId=data.id;
    hasUnsavedChanges = false;
    showToast(`Saved "${name}"`);
    document.getElementById('save-modal').classList.remove('show');
  } else showToast('Save failed','error');
}

async function openLoadModal(){
  const data=await fetch('/api/garden/layouts').then(r=>r.json());
  const list=document.getElementById('layouts-list');
  if(!data.length){ list.innerHTML='<p style="color:#666;font-size:.82rem;padding:.5rem;">No saved layouts yet.</p>'; }
  else {
    list.innerHTML=data.map(l=>`
      <div style="display:flex;align-items:center;gap:.5rem;padding:.5rem;border-bottom:1px solid #3a3a3a;">
        <div style="flex:1;">
          <div style="font-size:.85rem;color:#ddd;">${l.name}</div>
          <div style="font-size:.68rem;color:#666;">${new Date(l.updated_at).toLocaleDateString()}</div>
        </div>
        <button class="ctb-btn" onclick="loadLayout(${l.id})">Load</button>
        <button class="ctb-btn" style="color:#e57373;" onclick="deleteLayout(${l.id},this)">✕</button>
      </div>`).join('');
  }
  document.getElementById('load-modal').classList.add('show');
}

async function loadLayout(id){
  const data=await fetch(`/api/garden/layouts/${id}`).then(r=>r.json());
  state.currentLayoutId=id;
  state.currentLayoutName=data.name;
  state.gardenW=data.layout.gardenW||30;
  state.gardenH=data.layout.gardenH||20;
  state.items=data.layout.items||[];
  state.layers=data.layout.layers||state.layers;
  state.items.filter(i=>i.badgeUrl).forEach(loadBadgeImage);
  document.getElementById('prop-garden-w').value=state.gardenW;
  document.getElementById('prop-garden-h').value=state.gardenH;
  document.getElementById('load-modal').classList.remove('show');
  updateLayersList();
  pushHistory(); redraw();
  showToast(`Loaded "${data.name}"`);
}

async function deleteLayout(id, btn){
  if(!confirm('Delete this layout?')) return;
  await fetch(`/api/garden/layouts/${id}`,{method:'DELETE'});
  btn.closest('div[style]').remove();
  showToast('Layout deleted');
}