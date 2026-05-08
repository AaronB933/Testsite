/* garden/groupings.js */

// ── Open modal ─────────────────────────────────────────────────────────────
function openGroupingModal(itemId){
  grpSourceId = itemId;
  const item = getItem(itemId);
  if(!item) return;

  // Pre-fill from existing grouping or plant
  if(item.type === 'grouping'){
    document.getElementById('grp-count').value = item.grpCount||12;
    document.getElementById('grp-w').value = item.wFt||6;
    document.getElementById('grp-h').value = item.hFt||4;
    document.getElementById('grp-plant-size').value = item.grpPlantSize||0.5;
    document.getElementById('grp-view-mode').value = item.viewMode||'expanded';
    grpShape = item.grpShape||'rect';
    grpFreePath = item.grpFreePath||[];
  } else {
    document.getElementById('grp-count').value = 12;
    document.getElementById('grp-w').value = 6;
    document.getElementById('grp-h').value = 4;
    document.getElementById('grp-plant-size').value = item.plantSize||1.5;
    document.getElementById('grp-view-mode').value = 'expanded';
    grpShape = 'rect';
    grpFreePath = [];
  }

  // Update shape tab
  document.querySelectorAll('[id^="grp-shape-"]').forEach(b=>b.classList.remove('active'));
  document.getElementById('grp-shape-'+grpShape).classList.add('active');

  // Load badge image for preview
  grpPreviewBadgeImg = null;
  const badgeUrl = item.badgeUrl||(item.type==='grouping'?item.grpBadgeUrl:null);
  if(badgeUrl){
    const img = new Image();
    img.onload = ()=>{ grpPreviewBadgeImg=img; updateGrpPreview(); };
    img.src = badgeUrl;
  }

  setupGrpFreehandCanvas();
  updateGrpPreview();
  document.getElementById('grouping-modal').classList.add('show');
}

function setGrpShape(shape, btn){
  grpShape = shape;
  document.querySelectorAll('[id^="grp-shape-"]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const hint = document.getElementById('grp-freehand-hint');
  hint.style.display = shape==='free' ? 'block' : 'none';
  if(shape==='free') grpFreePath=[];
  updateGrpPreview();
}

// ── Freehand canvas setup ──────────────────────────────────────────────────
function setupGrpFreehandCanvas(){
  const pc = document.getElementById('grp-preview-canvas');
  pc.onmousedown = e => {
    if(grpShape!=='free') return;
    grpFreeDrawing=true; grpFreePath=[];
    const pos=getGrpCanvasPos(e,pc);
    grpFreePath.push(pos);
  };
  pc.onmousemove = e => {
    if(!grpFreeDrawing||grpShape!=='free') return;
    const pos=getGrpCanvasPos(e,pc);
    grpFreePath.push(pos);
    updateGrpPreview();
  };
  pc.onmouseup = ()=>{ grpFreeDrawing=false; updateGrpPreview(); };
  pc.onmouseleave = ()=>{ grpFreeDrawing=false; };
}

function getGrpCanvasPos(e, canvas){
  const r=canvas.getBoundingClientRect();
  return {
    x:(e.clientX-r.left)/r.width,   // normalized 0-1
    y:(e.clientY-r.top)/r.height
  };
}

// ── Honeycomb packing ──────────────────────────────────────────────────────
function honeycombPoints(wFt, hFt, plantSizeFt){
  const spacing = plantSizeFt * 1.15; // slight gap between plants
  const points = [];
  const rows = Math.ceil(hFt / (spacing * 0.866)) + 1;
  const cols = Math.ceil(wFt / spacing) + 1;
  for(let r=0; r<rows; r++){
    const offset = (r%2===0) ? 0 : spacing/2;
    for(let c=0; c<cols; c++){
      const px = c*spacing + offset;
      const py = r*spacing*0.866;
      if(px<=wFt && py<=hFt) points.push({x:px/wFt, y:py/hFt});
    }
  }
  return points;
}

function pointInShape(nx, ny, shape, freePath){
  if(shape==='rect') return nx>=0&&nx<=1&&ny>=0&&ny<=1;
  if(shape==='ellipse'){
    const dx=nx-0.5, dy=ny-0.5;
    return (dx*dx)/(0.5*0.5)+(dy*dy)/(0.5*0.5)<=1;
  }
  if(shape==='free'&&freePath.length>2){
    // Ray casting
    let inside=false;
    for(let i=0,j=freePath.length-1;i<freePath.length;j=i++){
      const xi=freePath[i].x,yi=freePath[i].y;
      const xj=freePath[j].x,yj=freePath[j].y;
      if(((yi>ny)!==(yj>ny))&&(nx<(xj-xi)*(ny-yi)/(yj-yi)+xi)) inside=!inside;
    }
    return inside;
  }
  return nx>=0&&nx<=1&&ny>=0&&ny<=1;
}

function getPackedPoints(wFt, hFt, plantSizeFt, targetCount, shape, freePath){
  // Get all honeycomb candidates inside shape
  const candidates = honeycombPoints(wFt, hFt, plantSizeFt)
    .filter(p => pointInShape(p.x, p.y, shape, freePath));

  if(candidates.length <= targetCount) return candidates;

  // If we have more than needed, pick evenly distributed subset
  const step = candidates.length / targetCount;
  const result = [];
  for(let i=0; i<targetCount; i++){
    result.push(candidates[Math.min(Math.round(i*step), candidates.length-1)]);
  }
  return result;
}

// ── Preview canvas rendering ───────────────────────────────────────────────
function updateGrpPreview(){
  const pc = document.getElementById('grp-preview-canvas');
  const pctx = pc.getContext('2d');
  const pw=pc.width, ph=pc.height;
  pctx.clearRect(0,0,pw,ph);

  // Dark background
  pctx.fillStyle='#1a1a1a'; pctx.fillRect(0,0,pw,ph);

  const count = parseInt(document.getElementById('grp-count').value)||12;
  const wFt = parseFloat(document.getElementById('grp-w').value)||6;
  const hFt = parseFloat(document.getElementById('grp-h').value)||4;
  const plantSizeFt = parseFloat(document.getElementById('grp-plant-size').value)||0.5;

  const pad = 16;
  const scaleX = (pw-pad*2)/wFt;
  const scaleY = (ph-pad*2)/hFt;
  const scale = Math.min(scaleX, scaleY);
  const ox = (pw - wFt*scale)/2;
  const oy = (ph - hFt*scale)/2;

  // Draw shape outline
  pctx.strokeStyle='rgba(151,196,89,.5)';
  pctx.lineWidth=1.5; pctx.setLineDash([4,3]);
  if(grpShape==='rect'){
    pctx.strokeRect(ox,oy,wFt*scale,hFt*scale);
  } else if(grpShape==='ellipse'){
    pctx.beginPath();
    pctx.ellipse(ox+wFt*scale/2, oy+hFt*scale/2, wFt*scale/2, hFt*scale/2, 0, 0, Math.PI*2);
    pctx.stroke();
  } else if(grpShape==='free'&&grpFreePath.length>2){
    pctx.beginPath();
    grpFreePath.forEach((p,i)=>{
      const cx=ox+p.x*wFt*scale, cy=oy+p.y*hFt*scale;
      i===0?pctx.moveTo(cx,cy):pctx.lineTo(cx,cy);
    });
    pctx.closePath(); pctx.stroke();
  }
  pctx.setLineDash([]);

  // Pack points
  const pts = getPackedPoints(wFt, hFt, plantSizeFt, count, grpShape, grpFreePath);
  const r = Math.max(3, (plantSizeFt/2)*scale);

  pts.forEach(p=>{
    const cx = ox + p.x*wFt*scale;
    const cy = oy + p.y*hFt*scale;
    if(grpPreviewBadgeImg){
      pctx.drawImage(grpPreviewBadgeImg, cx-r, cy-r, r*2, r*2);
    } else {
      pctx.fillStyle='rgba(59,109,17,.8)';
      pctx.beginPath(); pctx.arc(cx,cy,r,0,Math.PI*2); pctx.fill();
      pctx.fillStyle='#97C459'; pctx.font=`${Math.max(6,r*.8)}px DM Sans`;
      pctx.textAlign='center'; pctx.textBaseline='middle';
      pctx.fillText('🌱',cx,cy);
    }
  });

  document.getElementById('grp-packed-count').textContent =
    `${pts.length} plants packed · ${count} requested`;
}

// ── Apply grouping ─────────────────────────────────────────────────────────
function applyGrouping(){
  const sourceItem = getItem(grpSourceId);
  if(!sourceItem) return;

  const count = parseInt(document.getElementById('grp-count').value)||12;
  const wFt = parseFloat(document.getElementById('grp-w').value)||6;
  const hFt = parseFloat(document.getElementById('grp-h').value)||4;
  const plantSizeFt = parseFloat(document.getElementById('grp-plant-size').value)||0.5;
  const viewMode = document.getElementById('grp-view-mode').value;

  const badgeUrl = sourceItem.badgeUrl||(sourceItem.type==='grouping'?sourceItem.grpBadgeUrl:null);
  const badgeName = sourceItem.name||'Plant';

  const pts = getPackedPoints(wFt, hFt, plantSizeFt, count, grpShape, grpFreePath);

  const grouping = {
    type: 'grouping',
    x: sourceItem.x, y: sourceItem.y,
    wFt, hFt,
    grpCount: pts.length,
    grpShape, grpFreePath: [...grpFreePath],
    grpPlantSize: plantSizeFt,
    grpBadgeUrl: badgeUrl,
    grpBadgeImg: grpPreviewBadgeImg,
    grpPoints: pts,          // normalized 0-1 positions
    name: badgeName,
    viewMode,
    layer: 'plants',
    rotation: 0
  };

  // Remove source item, add grouping
  state.items = state.items.filter(i=>i.id!==grpSourceId);
  addItem(grouping);

  document.getElementById('grouping-modal').classList.remove('show');
  showToast(`Grouping created with ${pts.length} plants`);
  redraw();
}

// ── Draw grouping on canvas ────────────────────────────────────────────────
function drawGroupingItem(item){
  const isSelected = item.id===state.selectedId;
  const isHovered = item.id===hoveredId;
  const tl = worldToCanvas(item.x, item.y);
  const w = item.wFt*state.scale, h = item.hFt*state.scale;
  const cx = tl.x+w/2, cy = tl.y+h/2;

  // Draw shape outline
  ctx.strokeStyle = isSelected?'#97C459':isHovered?'rgba(151,196,89,.5)':'rgba(255,255,255,.12)';
  ctx.lineWidth = isSelected?2:1;
  ctx.setLineDash([5,3]);

  if(item.grpShape==='rect'){
    ctx.strokeRect(tl.x,tl.y,w,h);
  } else if(item.grpShape==='ellipse'){
    ctx.beginPath();
    ctx.ellipse(cx,cy,w/2,h/2,0,0,Math.PI*2);
    ctx.stroke();
  } else if(item.grpShape==='free'&&item.grpFreePath&&item.grpFreePath.length>2){
    ctx.beginPath();
    item.grpFreePath.forEach((p,i)=>{
      const fx=tl.x+p.x*w, fy=tl.y+p.y*h;
      i===0?ctx.moveTo(fx,fy):ctx.lineTo(fx,fy);
    });
    ctx.closePath(); ctx.stroke();
  }
  ctx.setLineDash([]);

  if(item.viewMode==='compact'){
    // Compact — one large icon + count badge
    const r = Math.min(w,h)*0.35;
    if(item.grpBadgeImg){
      ctx.drawImage(item.grpBadgeImg, cx-r, cy-r, r*2, r*2);
    } else {
      ctx.fillStyle='rgba(59,109,17,.7)';
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#97C459'; ctx.font=`${Math.max(14,r*.8)}px DM Sans`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('🌱',cx,cy);
    }
    // Count badge
    const badgeR=18;
    ctx.fillStyle='#27500A';
    ctx.beginPath(); ctx.arc(cx+r*.7,cy-r*.7,badgeR,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#97C459'; ctx.font='bold 11px DM Sans';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('×'+item.grpCount,cx+r*.7,cy-r*.7);
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';

  } else {
    // Expanded — all icons packed
    const pts = item.grpPoints||[];
    const r = Math.max(3, (item.grpPlantSize/2)*state.scale);
    pts.forEach(p=>{
      const px = tl.x + p.x*w;
      const py = tl.y + p.y*h;
      if(item.grpBadgeImg){
        ctx.drawImage(item.grpBadgeImg, px-r, py-r, r*2, r*2);
      } else {
        ctx.fillStyle='rgba(59,109,17,.8)';
        ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2); ctx.fill();
      }
    });
    // Count label
    ctx.fillStyle='rgba(0,0,0,.6)';
    ctx.beginPath(); ctx.roundRect(cx-22,tl.y+h-16,44,14,4); ctx.fill();
    ctx.fillStyle='#97C459'; ctx.font='bold 9px DM Sans';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('×'+item.grpCount,cx,tl.y+h-9);
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  }

  // Toggle view button (small circle top-right)
  if(isSelected||isHovered){
    const bx=tl.x+w-10, by=tl.y+10;
    ctx.fillStyle='rgba(39,80,10,.9)';
    ctx.beginPath(); ctx.arc(bx,by,10,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#97C459'; ctx.font='9px DM Sans';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(item.viewMode==='compact'?'⊞':'⊟',bx,by);
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
  }

  if(isHovered||isSelected) drawLabel(item);
}

// ── Toggle / ungroup ───────────────────────────────────────────────────────
function toggleGroupingView(id){
  const item=getItem(id);
  if(!item) return;
  item.viewMode = item.viewMode==='compact' ? 'expanded' : 'compact';
  pushHistory(); redraw();
  showToast(item.viewMode==='compact'?'Compact view':'Expanded view','info');
}

function ungroupItem(id){
  const item=getItem(id);
  if(!item||item.type!=='grouping') return;
  const pts=item.grpPoints||[];
  const spacing=item.grpPlantSize*1.5;
  pts.forEach(p=>{
    const wx=item.x+p.x*item.wFt;
    const wy=item.y+p.y*item.hFt;
    state.items.push({
      id: Date.now()+'_'+Math.random().toString(36).slice(2),
      type:'plant', x:wx, y:wy,
      wFt:spacing, hFt:spacing,
      plantSize:item.grpPlantSize, spacing,
      name:item.name, badgeUrl:item.grpBadgeUrl,
      badgeImg:item.grpBadgeImg, layer:'plants', rotation:0
    });
  });
  state.items=state.items.filter(i=>i.id!==id);
  if(state.selectedId===id){state.selectedId=null;hideSelProps();}
  pushHistory(); redraw();
  showToast(`Ungrouped ${pts.length} plants`);
}

// Handle click on toggle button (top-right corner of grouping)
function checkGroupingToggleClick(item, cx, cy){
  const tl=worldToCanvas(item.x,item.y);
  const w=item.wFt*state.scale, h=item.hFt*state.scale;
  const bx=tl.x+w-10, by=tl.y+10;
  const rect=overlay.getBoundingClientRect();
  const scx=cx, scy=cy;
  return Math.sqrt((scx-bx)**2+(scy-by)**2)<12;
}