/* garden/ui.js */

// ── Properties panel ───────────────────────────────────────────────────────
function showSelProps(item){
  document.getElementById('sel-props').style.display='block';
  document.getElementById('sel-name').value=item.name||'';
  if(item.type==='fence'||item.type==='drip'){
    document.getElementById('sel-w').value='';
    document.getElementById('sel-h').value='';
  } else {
    document.getElementById('sel-w').value=(item.wFt||1).toFixed(1);
    document.getElementById('sel-h').value=(item.hFt||1).toFixed(1);
  }
  document.getElementById('sel-rot').value=item.rotation||0;

  // Plant count for beds
  const pc=document.getElementById('plant-count-display');
  if(item.type==='grouping'){
    drawGroupingItem(item);
    return;
  }

  if(item.type==='bed'){
    const spacing=parseFloat(document.getElementById('prop-spacing').value)||2;
    const cols=Math.floor(item.wFt/spacing)+1;
    const rows=Math.floor(item.hFt/spacing)+1;
    pc.style.display='block';
    pc.textContent=`≈ ${cols*rows} plants at ${spacing}ft spacing`;
  } else { pc.style.display='none'; }
}

function hideSelProps(){ document.getElementById('sel-props').style.display='none'; }

function updateSelectedProp(prop,val){
  const item=state.items.find(i=>i.id===state.selectedId);
  if(!item) return;
  item[prop]=val;
  pushHistory();
  redraw();
}

// ── Context menu ───────────────────────────────────────────────────────────
function showCtxMenu(x,y,item){
  const menu=document.getElementById('ctx-menu');
  menu.innerHTML=`
    <div class="ctx-item" onclick="openEditModal(getItem('${item.id}'));hideCtxMenu()">✏️ Edit</div>
    ${item.type==='bed'?`<div class="ctx-item" onclick="openAddPlantsModal('${item.id}');hideCtxMenu()">🌱 Add Plants to Bed</div>`:''}
    ${item.type==='plant'?`<div class="ctx-item" onclick="openGroupingModal('${item.id}');hideCtxMenu()">🌿 Create Grouping</div>`:''}
    ${item.type==='grouping'?`<div class="ctx-item" onclick="openGroupingModal('${item.id}');hideCtxMenu()">✏️ Edit Grouping</div><div class="ctx-item" onclick="toggleGroupingView('${item.id}');hideCtxMenu()">👁 Toggle View</div><div class="ctx-item" onclick="ungroupItem('${item.id}');hideCtxMenu()">💥 Ungroup</div>`:''}
    <div class="ctx-item" onclick="duplicateItem('${item.id}');hideCtxMenu()">⧉ Duplicate</div>
    <div class="ctx-item" onclick="rotateItem('${item.id}',90);hideCtxMenu()">↻ Rotate 90°</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="bringToFront('${item.id}');hideCtxMenu()">⬆ Bring to Front</div>
    <div class="ctx-item" onclick="sendToBack('${item.id}');hideCtxMenu()">⬇ Send to Back</div>
    <div class="ctx-sep"></div>
    <div class="ctx-item danger" onclick="deleteItem('${item.id}');hideCtxMenu()">🗑 Delete</div>`;
  menu.classList.add('show');
  let mx=x, my=y;
  if(mx+170>window.innerWidth) mx=window.innerWidth-175;
  if(my+200>window.innerHeight) my=window.innerHeight-205;
  menu.style.left=mx+'px'; menu.style.top=my+'px';
}

function hideCtxMenu(){ document.getElementById('ctx-menu').classList.remove('show'); }
document.addEventListener('click',()=>hideCtxMenu());

function getItem(id){ return state.items.find(i=>i.id===id); }
function duplicateItem(id){
  const orig=getItem(id);
  if(!orig) return;
  const copy={...orig,id:Date.now()+'_copy',x:(orig.x||0)+1,y:(orig.y||0)+1};
  state.items.push(copy);
  if(copy.badgeImg) copy.badgeImg=orig.badgeImg;
  pushHistory(); redraw();
}
function rotateItem(id,deg){
  const item=getItem(id);
  if(!item) return;
  item.rotation=((item.rotation||0)+deg)%360;
  pushHistory(); redraw();
}
function bringToFront(id){
  const idx=state.items.findIndex(i=>i.id===id);
  if(idx===-1) return;
  state.items.push(state.items.splice(idx,1)[0]);
  pushHistory(); redraw();
}
function sendToBack(id){
  const idx=state.items.findIndex(i=>i.id===id);
  if(idx===-1) return;
  state.items.unshift(state.items.splice(idx,1)[0]);
  pushHistory(); redraw();
}
function deleteItem(id){
  state.items=state.items.filter(i=>i.id!==id);
  if(state.selectedId===id){ state.selectedId=null; hideSelProps(); }
  pushHistory(); redraw();
}

// ── Edit modal ─────────────────────────────────────────────────────────────
let editingId=null;
function openEditModal(item){
  if(!item) return;
  editingId=item.id;
  document.getElementById('em-name').value=item.name||'';
  const isBed=item.type==='bed';
  const isPlant=item.type==='plant';
  document.getElementById('em-bed-fields').style.display=isBed?'block':'none';
  document.getElementById('em-plant-fields').style.display=isPlant?'block':'none';
  if(isBed){
    document.getElementById('em-w').value=(item.wFt||1).toFixed(1);
    document.getElementById('em-h').value=(item.hFt||1).toFixed(1);
    document.getElementById('em-color').value=item.color||'#3a5c2a';
    // Populate texture dropdown
    const sel=document.getElementById('em-texture');
    sel.innerHTML='<option value="">None (solid color)</option>'+
      textures.map(t=>`<option value="${t.id}" ${item.textureId===t.id?'selected':''}>${t.name}</option>`).join('');
  }
  if(isPlant){
    document.getElementById('em-plant-size').value=item.plantSize||1;
    document.getElementById('em-plant-spacing').value=item.spacing||2;
  }
  document.getElementById('edit-modal-title').textContent=`Edit ${item.type.charAt(0).toUpperCase()+item.type.slice(1)}`;
  document.getElementById('edit-modal').classList.add('show');
}

function closeEditModal(){ document.getElementById('edit-modal').classList.remove('show'); editingId=null; }

function applyEdit(){
  const item=getItem(editingId);
  if(!item){ closeEditModal(); return; }
  item.name=document.getElementById('em-name').value;
  if(item.type==='grouping'){
    drawGroupingItem(item);
    return;
  }

  if(item.type==='bed'){
    item.wFt=parseFloat(document.getElementById('em-w').value)||item.wFt;
    item.hFt=parseFloat(document.getElementById('em-h').value)||item.hFt;
    item.color=document.getElementById('em-color').value;
    const texId=document.getElementById('em-texture').value;
    item.textureId=texId||null;
  }
  if(item.type==='plant'){
    item.plantSize=parseFloat(document.getElementById('em-plant-size').value)||1;
    item.spacing=parseFloat(document.getElementById('em-plant-spacing').value)||2;
    item.wFt=item.spacing; item.hFt=item.spacing;
  }
  closeEditModal();
  showSelProps(item);
  pushHistory(); redraw();
}

// ── Garden size ────────────────────────────────────────────────────────────
function updateGardenSize(){
  state.gardenW=parseFloat(document.getElementById('prop-garden-w').value)||30;
  state.gardenH=parseFloat(document.getElementById('prop-garden-h').value)||20;
  redraw();
}

// ── Zoom / pan ─────────────────────────────────────────────────────────────
function zoom(factor){
  state.scale=Math.max(8,Math.min(120,state.scale*factor));
  redraw();
}

function resetView(){
  const area=document.getElementById('canvas-area');
  const scaleX=(area.clientWidth-120)/state.gardenW;
  const scaleY=(area.clientHeight-120)/state.gardenH;
  state.scale=Math.min(scaleX,scaleY,60);
  state.offsetX=60; state.offsetY=80;
  redraw();
}

function toggleSnap(){
  state.snapGrid=!state.snapGrid;
  const btn=document.getElementById('snap-btn');
  btn.classList.toggle('active',state.snapGrid);
  btn.textContent=state.snapGrid?'Grid On':'Grid Off';
  redraw();
}

function updateScaleBar(){
  document.getElementById('scale-bar').textContent=
    `${state.gardenW}ft × ${state.gardenH}ft · 1ft = ${Math.round(state.scale)}px`;
}