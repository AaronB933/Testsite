/* garden/canvas.js */

// ── Init ───────────────────────────────────────────────────────────────────
async function init(){
  const res = await fetch('/api/me');
  if(res.status===401){ window.location.href='/'; return; }
  const user = await res.json();
  window._userId = user.id;
  document.getElementById('nav-username').textContent = user.username;

  initDarkMode();
  resizeCanvases();
  window.addEventListener('resize', ()=>{ resizeCanvases(); redraw(); });

  setupCanvasEvents();
  loadBadges();
  loadArchiveTextures();
  updateGardenSize();
  pushHistory();
  redraw();
  updateLayersList();
}

function resizeCanvases(){
  const area = document.getElementById('canvas-area');
  const w = area.clientWidth;
  const h = area.clientHeight;
  canvas.width  = overlay.width  = w;
  canvas.height = overlay.height = h;
  overlay.style.width = canvas.style.width = w+'px';
  overlay.style.height = canvas.style.height = h+'px';
}

// ── Tools ──────────────────────────────────────────────────────────────────
function setTool(t){
  activeTool = t;
  document.querySelectorAll('.panel-btn[id^="tool-"]').forEach(b=>b.classList.remove('active'));
  const btn = document.getElementById('tool-'+t);
  if(btn) btn.classList.add('active');
  canvas.style.cursor = t==='pan' ? 'grab' : t==='select' ? 'default' : 'crosshair';
}

// ── Canvas setup ───────────────────────────────────────────────────────────
function setupCanvasEvents(){
  // Use overlay for interaction
  overlay.style.pointerEvents = 'all';
  overlay.style.cursor = 'default';

  overlay.addEventListener('mousedown', onMouseDown);
  overlay.addEventListener('mousemove', onMouseMove);
  overlay.addEventListener('mouseup',   onMouseUp);
  overlay.addEventListener('mouseleave',()=>{ hoveredId=null; redraw(); });
  overlay.addEventListener('wheel', onWheel, {passive:false});
  overlay.addEventListener('contextmenu', onContextMenu);
  overlay.addEventListener('dblclick', onDblClick);

  // Drag badge from panel onto canvas
  // Must allow dragover on overlay AND canvas area
  overlay.addEventListener('dragover', e=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
  overlay.addEventListener('drop', onBadgeDrop);
  // Also handle drag on the canvas itself
  canvas.addEventListener('dragover', e=>{ e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
  canvas.addEventListener('drop', onBadgeDrop);
}

// ── Coordinate helpers ─────────────────────────────────────────────────────
function canvasToWorld(cx,cy){ return { x:(cx-state.offsetX)/state.scale, y:(cy-state.offsetY)/state.scale }; }
function worldToCanvas(wx,wy){ return { x:wx*state.scale+state.offsetX, y:wy*state.scale+state.offsetY }; }
function snapFt(v){ return state.snapGrid ? Math.round(v/state.snapSize)*state.snapSize : v; }

// ── Hit test ───────────────────────────────────────────────────────────────
function hitTest(wx,wy){
  // Reverse iterate so top items are checked first
  for(let i=state.items.length-1;i>=0;i--){
    const item = state.items[i];
    if(!layerVisible(item.layer)) continue;
    if(itemHit(item,wx,wy)) return item;
  }
  return null;
}

function itemHit(item,wx,wy){
  if(item.type==='fence'||item.type==='drip'){
    // Line hit test
    const dx=item.x2-item.x1, dy=item.y2-item.y1;
    const len=Math.sqrt(dx*dx+dy*dy);
    if(len===0) return false;
    const t=((wx-item.x1)*dx+(wy-item.y1)*dy)/(len*len);
    if(t<0||t>1) return false;
    const px=item.x1+t*dx, py=item.y1+t*dy;
    return Math.sqrt((wx-px)**2+(wy-py)**2) < 0.3;
  }
  // Grouping hit test — check bounding box
  if(item.type==='grouping'){
    return wx>=item.x&&wx<=item.x+item.wFt&&wy>=item.y&&wy<=item.y+item.hFt;
  }
  // For plants use spacing/2 as hit radius (center of plant)
  // This means clicking anywhere within the spacing circle selects it
  if(item.type==='plant'){
    const spacing = item.spacing||item.wFt||2;
    const pcx = item.x + spacing/2;
    const pcy = item.y + spacing/2;
    const dist = Math.sqrt((wx-pcx)**2+(wy-pcy)**2);
    // Minimum hit radius of 0.75ft so small-spacing plants are still clickable
    return dist <= Math.max(spacing/2, 0.75);
  }
  // Rect (bed)
  const hw=(item.wFt||1)/2, hh=(item.hFt||1)/2;
  const cx=item.x+hw, cy=item.y+hh;
  if(item.rotation){
    const rad=-item.rotation*Math.PI/180;
    const rx=(wx-cx)*Math.cos(rad)-(wy-cy)*Math.sin(rad);
    const ry=(wx-cx)*Math.sin(rad)+(wy-cy)*Math.cos(rad);
    return Math.abs(rx)<=hw && Math.abs(ry)<=hh;
  }
  return wx>=item.x&&wx<=item.x+item.wFt&&wy>=item.y&&wy<=item.y+item.hFt;
}

function layerVisible(layerId){
  const l=state.layers.find(l=>l.id===layerId);
  return l?l.visible:true;
}

// ── Mouse events ───────────────────────────────────────────────────────────
function onMouseDown(e){
  const rect=overlay.getBoundingClientRect();
  const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
  const {x:wx,y:wy}=canvasToWorld(cx,cy);

  if(activeTool==='pan'||e.button===1){
    isPanning=true;
    panStart={x:e.clientX,y:e.clientY};
    overlay.style.cursor='grabbing';
    return;
  }

  if(activeTool==='select'){
    // Check grouping toggle button click
    if(state.selectedId||hoveredId){
      const gid=state.selectedId||hoveredId;
      const git=state.items.find(i=>i.id===gid&&i.type==='grouping');
      if(git){
        const rect2=overlay.getBoundingClientRect();
        if(checkGroupingToggleClick(git,e.clientX-rect2.left,e.clientY-rect2.top)){
          toggleGroupingView(git.id);
          return;
        }
      }
    }
    const hit=hitTest(wx,wy);
    // Check drip control point first
    if(state.selectedId){
      const sel=state.items.find(i=>i.id===state.selectedId);
      if(sel&&sel.type==='drip'&&sel.cpx!=null){
        const cp=worldToCanvas(sel.cpx,sel.cpy);
        const rect2=overlay.getBoundingClientRect();
        const scx=e.clientX-rect2.left, scy=e.clientY-rect2.top;
        if(Math.abs(scx-cp.x)<12&&Math.abs(scy-cp.y)<12){
          isResizing=true; resizeHandle='drip-cp'; dragItem=sel; return;
        }
      }
    }
    if(hit){
      // Check resize handles for beds
      if(state.selectedId===hit.id){
        const rh=getResizeHandle(hit,cx,cy);
        if(rh){ isResizing=true; resizeHandle=rh; dragItem=hit; return; }
      }
      state.selectedId=hit.id;
      dragItem=hit;
      dragOffset={x:wx-(hit.x||hit.x1||0), y:wy-(hit.y||hit.y1||0)};
      showSelProps(hit);
      redraw();
    } else {
      state.selectedId=null;
      hideSelProps();
      redraw();
    }
    return;
  }

  // Drawing tools
  if(['bed','fence','drip'].includes(activeTool)){
    isDrawing=true;
    drawStart={x:snapFt(wx),y:snapFt(wy)};
    drawCurrent={...drawStart};
  }
}

function onMouseMove(e){
  const rect=overlay.getBoundingClientRect();
  const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
  const {x:wx,y:wy}=canvasToWorld(cx,cy);

  if(isPanning){
    state.offsetX+=e.clientX-panStart.x;
    state.offsetY+=e.clientY-panStart.y;
    panStart={x:e.clientX,y:e.clientY};
    redraw();
    return;
  }

  if(isResizing && dragItem){
    handleResize(dragItem,wx,wy);
    showSelProps(dragItem);
    redraw();
    return;
  }

  if(dragItem && activeTool==='select' && !isResizing){
    // Plants drag freely, beds snap to grid
    if(dragItem.type==='plant'||dragItem.type==='grouping'){
      dragItem.x=wx-dragOffset.x;
      dragItem.y=wy-dragOffset.y;
    } else {
      dragItem.x=snapFt(wx-dragOffset.x);
      dragItem.y=snapFt(wy-dragOffset.y);
    }
    showSelProps(dragItem);
    redraw();
    return;
  }

  if(isDrawing){
    drawCurrent={x:snapFt(wx),y:snapFt(wy)};
    drawPreview();
    return;
  }

  // Hover
  const hit=hitTest(wx,wy);
  const newHov=hit?hit.id:null;
  if(newHov!==hoveredId){ hoveredId=newHov; redraw(); }

  // Cursor for resize handles
  if(activeTool==='select'&&state.selectedId){
    const sel=state.items.find(i=>i.id===state.selectedId);
    if(sel){ const rh=getResizeHandle(sel,cx,cy); overlay.style.cursor=rh?'nwse-resize':'default'; }
  }
}

function onMouseUp(e){
  overlay.style.cursor = activeTool==='pan'?'grab':'default';

  if(isPanning){ isPanning=false; return; }

  if(isResizing){ isResizing=false; resizeHandle=null; dragItem=null; pushHistory(); return; }

  if(dragItem){ dragItem=null; pushHistory(); return; }

  if(isDrawing){
    isDrawing=false;
    const rect=overlay.getBoundingClientRect();
    const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
    const {x:wx,y:wy}=canvasToWorld(cx,cy);
    const ex=snapFt(wx), ey=snapFt(wy);

    if(activeTool==='bed'){
      const x=Math.min(drawStart.x,ex), y=Math.min(drawStart.y,ey);
      const w=Math.abs(ex-drawStart.x), h=Math.abs(ey-drawStart.y);
      if(w>0.3&&h>0.3){
        addItem({type:'bed',x,y,wFt:w,hFt:h,name:'Garden Bed',color:'#3a5c2a',layer:'ground',textureId:null});
      }
    } else if(activeTool==='fence'){
      if(Math.abs(ex-drawStart.x)+Math.abs(ey-drawStart.y)>0.3){
        addItem({type:'fence',x1:drawStart.x,y1:drawStart.y,x2:ex,y2:ey,x:drawStart.x,y:drawStart.y,wFt:1,hFt:1,name:'Fence',color:'#8B6914',layer:'structures'});
      }
    } else if(activeTool==='drip'){
      if(Math.abs(ex-drawStart.x)+Math.abs(ey-drawStart.y)>0.3){
        // Set default control point at midpoint slightly offset for a natural curve
        const cpx=(drawStart.x+ex)/2, cpy=(drawStart.y+ey)/2-1;
        addItem({type:'drip',x1:drawStart.x,y1:drawStart.y,x2:ex,y2:ey,
                 cpx,cpy,
                 x:drawStart.x,y:drawStart.y,wFt:1,hFt:1,
                 name:'Drip Line',color:'#1565C0',layer:'structures'});
      }
    }
    octx.clearRect(0,0,overlay.width,overlay.height);
    redraw();
  }
}

function onWheel(e){
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.91;
  const rect=overlay.getBoundingClientRect();
  const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
  state.offsetX = cx - (cx - state.offsetX)*factor;
  state.offsetY = cy - (cy - state.offsetY)*factor;
  state.scale  *= factor;
  state.scale   = Math.max(8, Math.min(120, state.scale));
  redraw();
}

function onDblClick(e){
  const rect=overlay.getBoundingClientRect();
  const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
  const {x:wx,y:wy}=canvasToWorld(cx,cy);
  const hit=hitTest(wx,wy);
  if(hit) openEditModal(hit);
}

function onContextMenu(e){
  e.preventDefault();
  const rect=overlay.getBoundingClientRect();
  const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
  const {x:wx,y:wy}=canvasToWorld(cx,cy);
  const hit=hitTest(wx,wy);
  if(hit){
    state.selectedId=hit.id;
    showSelProps(hit);
    redraw();
    showCtxMenu(e.clientX,e.clientY,hit);
  } else {
    hideCtxMenu();
  }
}

// ── Badge drop from panel ──────────────────────────────────────────────────
function onBadgeDrop(e){
  e.preventDefault();
  let badge = draggingBadge;
  if(!badge){
    try{ badge = JSON.parse(e.dataTransfer.getData('text/plain')||'{}'); } catch(err){ badge={}; }
  }
  draggingBadge = null;
  if(!badge||!badge.url) return;
  const rect = (e.target===overlay?overlay:canvas).getBoundingClientRect();
  const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
  const {x:wx,y:wy}=canvasToWorld(cx,cy);
  const spacing = parseFloat(document.getElementById('prop-spacing').value)||2;
  addItem({
    type:'plant', x:snapFt(wx-spacing/2), y:snapFt(wy-spacing/2),
    wFt:spacing, hFt:spacing,
    plantSize:1.5, spacing,
    name:badge.name||'Plant', badgeUrl:badge.url,
    badgeImg:null, layer:'plants', rotation:0
  });
}

// ── Resize handles ─────────────────────────────────────────────────────────
function getResizeHandle(item,cx,cy){
  if(!['bed'].includes(item.type)) return null;
  const br=worldToCanvas(item.x+item.wFt, item.y+item.hFt);
  if(Math.abs(cx-br.x)<8&&Math.abs(cy-br.y)<8) return 'br';
  return null;
}

function handleResize(item,wx,wy){
  if(resizeHandle==='br'){
    item.wFt=Math.max(0.5,snapFt(wx-item.x));
    item.hFt=Math.max(0.5,snapFt(wy-item.y));
  } else if(resizeHandle==='drip-cp'){
    item.cpx=wx; item.cpy=wy;
  }
}

// ── Draw preview during drawing ────────────────────────────────────────────
function drawPreview(){
  octx.clearRect(0,0,overlay.width,overlay.height);
  const s=worldToCanvas(drawStart.x,drawStart.y);
  const e=worldToCanvas(drawCurrent.x,drawCurrent.y);

  if(activeTool==='bed'){
    octx.strokeStyle='#97C459'; octx.lineWidth=2; octx.setLineDash([5,3]);
    octx.strokeRect(Math.min(s.x,e.x),Math.min(s.y,e.y),Math.abs(e.x-s.x),Math.abs(e.y-s.y));
    octx.fillStyle='rgba(151,196,89,.12)';
    octx.fillRect(Math.min(s.x,e.x),Math.min(s.y,e.y),Math.abs(e.x-s.x),Math.abs(e.y-s.y));
  } else {
    octx.strokeStyle=activeTool==='fence'?'#FFB300':'#42A5F5';
    octx.lineWidth=3; octx.setLineDash([6,3]);
    octx.beginPath(); octx.moveTo(s.x,s.y); octx.lineTo(e.x,e.y); octx.stroke();
  }
  octx.setLineDash([]);
}

// ── Add item ───────────────────────────────────────────────────────────────
function addItem(item){
  item.id = Date.now()+'_'+Math.random().toString(36).slice(2);
  if(!item.rotation) item.rotation=0;
  state.items.push(item);
  if(item.type==='plant'&&item.badgeUrl) loadBadgeImage(item);
  state.selectedId=item.id;
  showSelProps(item);
  pushHistory();
  redraw();
}

function loadBadgeImage(item){
  const img=new Image();
  img.crossOrigin='anonymous';
  img.onload=()=>{ item.badgeImg=img; redraw(); };
  img.src=item.badgeUrl;
}