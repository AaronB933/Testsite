/* organize.js — Organize Photos page */

const SE = {spring:'🌸',summer:'☀️',fall:'🍂',winter:'❄️'};
  const SO = ['spring','summer','fall','winter'];
  const YEARS = Array.from({length:12},(_,i)=>2026-i);

  let allPhotos=[], currentView='all', selectedIds=new Set();
  let openYears=new Set(), openPlants=new Set();
  let lbIndex=0, confirmCallback=null, isTrashView=false;
  let labelPresets=[], varietyPresets={};  // cached presets
  let currentEditorPhotoId=null;
  let editorPendingOp=null;  // {type, params} — queued operation not yet saved

  // Virtual scroll state
  let vsCardSize = 160;      // px — current zoom level
  let vsColumns = 1;         // calculated from container width
  let vsRowHeight = 0;       // card height + gap
  let vsRenderedStart = -1;  // first rendered photo index
  let vsRenderedEnd = -1;    // last rendered photo index
  let vsRafId = null;
  const VS_BUFFER_ROWS = 2;  // extra rows above/below viewport
  const VS_GAP = 14;         // px — matches .85rem gap

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init(){
    const res=await fetch('/api/me');
    if(res.status===401){window.location.href='/';return;}
    const user=await res.json();
    window._userId=user.id;
    document.getElementById('nav-username').textContent=user.username;
    const params=new URLSearchParams(window.location.search);
    await loadSidebar();
    const year=params.get('year'),season=params.get('season');
    if(year&&season){
      openYears.add(parseInt(year));
      await loadSidebar();
      loadView(`year:${year}:${season}`,document.getElementById(`sb-${year}-${season}`));
    } else {
      loadView('all',document.getElementById('sb-all'));
    }
    setupDragSelect();
    setupVirtualScroll();
    setZoom(160);
    loadLabelPresets();
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  async function loadSidebar(){
    const [labelData,plantTree,yearTree,trashed,stats]=await Promise.all([
      fetch('/api/labels').then(r=>r.json()),
      fetch('/api/plant-tree').then(r=>r.json()),
      fetch('/api/year-tree').then(r=>r.json()),
      fetch('/api/photos/trash').then(r=>r.json()),
      fetch('/api/stats').then(r=>r.json())
    ]);
    document.getElementById('sb-all-count').textContent=stats.total;
    document.getElementById('sb-inbox-count').textContent=labelData.inbox_count;
    document.getElementById('sb-trash-count').textContent=trashed.length;

    // Label list (flat)
    document.getElementById('label-list').innerHTML=labelData.labels.map(l=>`
      <div class="sb-item" id="sb-label-${l.label}" onclick="loadView('label:${l.label}',this)">
        <span style="text-transform:capitalize">🌱 ${l.label}</span>
        <span class="sb-count">${l.count}</span>
      </div>`).join('');

    renderPlantTree(plantTree);
    renderYearTree(yearTree);
  }

  function renderPlantTree(tree){
    const labels=Object.keys(tree).sort();
    document.getElementById('plant-tree').innerHTML=labels.map(label=>{
      const varieties=tree[label];
      const total=Object.values(varieties).reduce((a,b)=>a+b,0);
      const isOpen=openPlants.has(label);
      // variety sub-rows
      const varRows=Object.entries(varieties).sort((a,b)=>{
        if(a[0]==='no-variety') return -1;
        if(b[0]==='no-variety') return 1;
        return a[0].localeCompare(b[0]);
      }).map(([variety,count])=>`
        <div class="variety-row" id="vr-${label}-${variety}"
             onclick="loadView('plant:${label}:${variety}',this)">
          <span class="vl">└ <span style="text-transform:capitalize">${variety==='no-variety'?'No variety':variety}</span></span>
          <span class="sb-count">${count}</span>
        </div>`).join('');
      return `
        <div>
          <div class="tree-row ${isOpen?'open':''}" id="pt-row-${label}"
               onclick="togglePlant('${label}')">
            <span class="tl"><span class="chevron">▶</span><span style="text-transform:capitalize">🌿 ${label}</span></span>
            <span class="tree-total">${total}</span>
          </div>
          <div class="sub-rows ${isOpen?'open':''}" id="pt-sub-${label}">${varRows}</div>
        </div>`;
    }).join('');
  }

  function togglePlant(label){
    const row=document.getElementById(`pt-row-${label}`);
    const sub=document.getElementById(`pt-sub-${label}`);
    if(sub.classList.contains('open')){openPlants.delete(label);row.classList.remove('open');sub.classList.remove('open');}
    else{openPlants.add(label);row.classList.add('open');sub.classList.add('open');}
  }

  function renderYearTree(tree){
    document.getElementById('year-tree').innerHTML=YEARS.map(year=>{
      const seasons=tree[year]||{};
      const total=Object.values(seasons).reduce((a,b)=>a+b,0);
      const isOpen=openYears.has(year);
      const sRows=SO.map(s=>`
        <div class="sub-row" id="sb-${year}-${s}" onclick="loadView('year:${year}:${s}',this)">
          <span class="sl">${SE[s]} <span style="text-transform:capitalize">${s}</span></span>
          <span class="sb-count">${seasons[s]||0}</span>
        </div>`).join('');
      return `
        <div>
          <div class="tree-row ${isOpen?'open':''}" id="yr-row-${year}" onclick="toggleYear(${year})">
            <span class="tl"><span class="chevron">▶</span><span>${year}</span></span>
            <span class="tree-total">${total||0}</span>
          </div>
          <div class="sub-rows ${isOpen?'open':''}" id="yr-seasons-${year}">${sRows}</div>
        </div>`;
    }).join('');
  }

  function toggleYear(year){
    const row=document.getElementById(`yr-row-${year}`);
    const secs=document.getElementById(`yr-seasons-${year}`);
    if(secs.classList.contains('open')){openYears.delete(year);row.classList.remove('open');secs.classList.remove('open');}
    else{openYears.add(year);row.classList.add('open');secs.classList.add('open');}
  }

  // ── Load view ─────────────────────────────────────────────────────────────
  async function loadView(view, el){
    clearSelection();
    currentView = view;
    allPhotos = [];
    isTrashView = (view==='trash');

    document.querySelectorAll('.sb-item,.sub-row,.variety-row,.tree-row').forEach(i=>i.classList.remove('active'));
    if(el) el.classList.add('active');

    let title='';
    if(view==='all') title='All photos';
    else if(view==='inbox') title='📥 Inbox';
    else if(view==='trash') title='🗑 Trash';
    else if(view.startsWith('label:')) title=`🌱 ${view.slice(6)}`;
    else if(view.startsWith('plant:')){
      const parts=view.split(':');
      title=`🌿 ${parts[1]}${parts[2]!=='no-variety'?' › '+parts[2]:''}`;
    } else if(view.startsWith('year:')){
      const parts=view.split(':');
      if(parts[2]) title=`${SE[parts[2]]} ${parts[2].charAt(0).toUpperCase()+parts[2].slice(1)} ${parts[1]}`;
      else title=`📅 ${parts[1]}`;
    }

    document.getElementById('view-title').textContent=title;
    document.getElementById('view-count').textContent='Loading...';
    document.getElementById('grid-wrap').innerHTML=`<div class="empty-state"><div class="icon">⏳</div><p>Loading...</p></div>`;

    const tbRight=document.getElementById('toolbar-right');
    if(isTrashView){
      tbRight.innerHTML=`
        <button class="btn btn-ghost" onclick="restoreSelected()">↩ Restore</button>
        <button class="btn btn-red" onclick="permanentDeleteSelected()">✕ Delete Forever</button>`;
    } else { tbRight.innerHTML=''; }

    // Fetch ALL photos upfront — virtual scroller handles rendering
    const r = await fetch(`/api/photos/all?view=${encodeURIComponent(view)}`).then(r=>r.json());
    allPhotos = r.photos || [];

    document.getElementById('view-count').textContent=
      `${allPhotos.length} photo${allPhotos.length!==1?'s':''}`;

    if(!allPhotos.length){
      document.getElementById('grid-wrap').innerHTML=`<div class="empty-state"><div class="icon">${isTrashView?'🗑':'🌱'}</div><p>${isTrashView?'Trash is empty':'No photos here yet'}</p></div>`;
      return;
    }

    initVirtualScroll();
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────
  function setZoom(size){
    vsCardSize = size;
    document.documentElement.style.setProperty('--card-size', size+'px');
    document.querySelectorAll('.zoom-btn').forEach(b=>{
      b.classList.toggle('active', parseInt(b.dataset.size)===size);
    });
    if(allPhotos.length) initVirtualScroll();
  }

  // ── Virtual scroll engine ─────────────────────────────────────────────────
  function initVirtualScroll(){
    // Calculate grid geometry
    const main = document.getElementById('main-area');
    const gridWidth = main.clientWidth - 64; // subtract padding
    vsColumns = Math.max(1, Math.floor((gridWidth + VS_GAP) / (vsCardSize + VS_GAP)));
    vsRowHeight = vsCardSize + 60 + VS_GAP; // card img + info height + gap

    const totalRows = Math.ceil(allPhotos.length / vsColumns);
    const totalHeight = totalRows * vsRowHeight;

    // Build virtual container
    document.getElementById('grid-wrap').innerHTML = `
      <div id="virtual-wrap" style="position:relative;height:${totalHeight}px;">
        <div id="virtual-spacer-top" style="height:0px;"></div>
        <div class="photo-grid" id="photo-grid" style="position:absolute;width:100%;left:0;"></div>
        <div id="virtual-spacer-bottom" style="height:0px;"></div>
      </div>`;

    vsRenderedStart = -1;
    vsRenderedEnd = -1;
    vsUpdate(true);
  }

  function vsUpdate(force=false){
    if(!allPhotos.length) return;
    const main = document.getElementById('main-area');
    const scrollTop = main.scrollTop;
    const viewH = main.clientHeight;

    // Which rows are visible
    const firstVisRow = Math.max(0, Math.floor(scrollTop / vsRowHeight) - VS_BUFFER_ROWS);
    const lastVisRow  = Math.min(
      Math.ceil(allPhotos.length / vsColumns) - 1,
      Math.floor((scrollTop + viewH) / vsRowHeight) + VS_BUFFER_ROWS
    );

    const newStart = firstVisRow * vsColumns;
    const newEnd   = Math.min(allPhotos.length - 1, (lastVisRow + 1) * vsColumns - 1);

    // Skip if visible range hasn't changed (unless forced e.g. after zoom)
    if(!force && newStart === vsRenderedStart && newEnd === vsRenderedEnd) return;
    vsRenderedStart = newStart;
    vsRenderedEnd   = newEnd;

    // Update spacers so scrollbar is accurate
    const topH = firstVisRow * vsRowHeight;
    const botH = Math.max(0, (Math.ceil(allPhotos.length/vsColumns) - lastVisRow - 1) * vsRowHeight);
    const st = document.getElementById('virtual-spacer-top');
    const sb = document.getElementById('virtual-spacer-bottom');
    if(st) st.style.height = topH + 'px';
    if(sb) sb.style.height = botH + 'px';

    // Render only visible slice
    const grid = document.getElementById('photo-grid');
    if(!grid) return;
    grid.style.top = topH + 'px';
    grid.innerHTML = allPhotos.slice(newStart, newEnd + 1).map((p, localIdx) => {
      const i = newStart + localIdx;
      const src = `/thumbnails/user_${window._userId}/inbox/${p.stored_filename}`;
      const sel = selectedIds.has(p.id) ? 'selected' : '';  // selection preserved across zoom
      const badge = p.season ? `<span class="season-badge badge-${p.season}">${SE[p.season]} ${p.season} ${p.season_year||''}</span>` : '';
      const variety = p.variety ? `<div class="p-variety">↳ ${p.variety}</div>` : '';
      return `
        <div class="photo-card ${sel}" data-id="${p.id}" data-index="${i}"
             onmousedown="cardMD(event,${p.id})"
             onclick="cardClick(event,${p.id})"
             ondblclick="openLightbox(${i})"
             oncontextmenu="showCtx(event,${p.id})">
          <div class="sel-check">✓</div>
          <img src="${src}" loading="lazy" onerror="this.style.background='#EAF3DE';this.style.height='${vsCardSize}px'">
          <div class="info">
            <div class="p-date">${fmtDate(p.date_taken)}</div>
            <div class="p-label">${p.label||'unlabeled'}</div>
            ${variety}${badge}
          </div>
        </div>`;
    }).join('');
  }

  function vsScheduleUpdate(){
    if(vsRafId) return;
    vsRafId = requestAnimationFrame(()=>{ vsRafId=null; vsUpdate(); });
  }

  function setupVirtualScroll(){
    const main = document.getElementById('main-area');
    main.addEventListener('scroll', vsScheduleUpdate, {passive:true});
    window.addEventListener('resize', ()=>{
      if(allPhotos.length) initVirtualScroll();
    });
  }

  // renderGrid — re-renders currently visible cards (e.g. after selection change)
  function renderGrid(photos){
    // For virtual scroll, just refresh the visible window
    vsUpdate();
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  function cardMD(e,id){e.stopPropagation();}
  function cardClick(e,id){
    if(e.ctrlKey||e.metaKey){toggleSel(id);}
    else if(e.shiftKey&&selectedIds.size>0){
      const ids=allPhotos.map(p=>p.id);
      const last=Array.from(selectedIds).pop();
      const a=ids.indexOf(last),b=ids.indexOf(id);
      ids.slice(Math.min(a,b),Math.max(a,b)+1).forEach(i=>selectedIds.add(i));
      vsUpdate();updateSelBar();
    } else {
      if(selectedIds.has(id)&&selectedIds.size===1){clearSelection();}
      else{selectedIds.clear();selectedIds.add(id);vsUpdate();updateSelBar();}
    }
  }
  function toggleSel(id){
    if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);
    const card=document.querySelector(`.photo-card[data-id="${id}"]`);
    if(card)card.classList.toggle('selected',selectedIds.has(id));
    updateSelBar();
  }
  function clearSelection(){selectedIds.clear();document.querySelectorAll('.photo-card.selected').forEach(c=>c.classList.remove('selected'));updateSelBar();}
  function selectAll(){allPhotos.forEach(p=>selectedIds.add(p.id));vsUpdate();updateSelBar();}
  function updateSelBar(){
    const bar=document.getElementById('sel-bar');
    bar.classList.toggle('show',selectedIds.size>0);
    document.getElementById('sel-count').textContent=`${selectedIds.size} selected`;
  }

  // ── Drag select ───────────────────────────────────────────────────────────
  // Uses mathematical index calculation instead of DOM rect cache.
  // This works perfectly with virtual scroll — no DOM dependency for selection.
  function setupDragSelect(){
    const main = document.getElementById('main-area');
    const box  = document.getElementById('drag-select-box');

    let dragging = false;
    let startX = 0, startY = 0;       // mouse position at drag start (viewport coords)
    let startScrollTop = 0;            // scrollTop at drag start
    let pendingMouseX = 0, pendingMouseY = 0;
    let rafId = null, scrollRafId = null;
    let ctrlHeld = false;
    let preSelIds = new Set();         // ids selected before drag started (for ctrl mode)

    const SCROLL_ZONE  = 80;   // px from edge triggers auto-scroll
    const SCROLL_SPEED = 14;   // px per auto-scroll frame

    // Convert viewport Y → document Y (accounts for scroll)
    function viewportToDocY(vy){ return vy + main.scrollTop; }
    function viewportToDocX(vx){
      const mainRect = main.getBoundingClientRect();
      return vx - mainRect.left;
    }

    // Calculate selected indices using row/col math from scroll position
    // Strategy: find which rows the selection rect spans, then which cols
    function calcSelectedIndices(mouseX1, mouseY1, mouseX2, mouseY2){
      if(!allPhotos.length || vsColumns < 1 || vsRowHeight < 1) return new Set();

      const mainRect = main.getBoundingClientRect();
      const containerW = main.clientWidth - 64; // subtract padding
      const cardW = Math.floor((containerW - VS_GAP * (vsColumns - 1)) / vsColumns);

      // Convert viewport mouse coords to position within virtual grid
      // The grid starts at offsetTop of virtual-wrap relative to main-area
      const wrap = document.getElementById('virtual-wrap');
      const gridTop = wrap ? wrap.getBoundingClientRect().top - mainRect.top : 0;

      // Selection rect in grid-relative coords
      const selTop    = Math.min(mouseY1, mouseY2) - mainRect.top - gridTop;
      const selBottom = Math.max(mouseY1, mouseY2) - mainRect.top - gridTop;
      const selLeft   = Math.min(mouseX1, mouseX2) - mainRect.left;
      const selRight  = Math.max(mouseX1, mouseX2) - mainRect.left;

      // Which rows does the selection span?
      const firstRow = Math.max(0, Math.floor(selTop / vsRowHeight));
      const lastRow  = Math.min(
        Math.ceil(allPhotos.length / vsColumns) - 1,
        Math.floor(selBottom / vsRowHeight)
      );

      const selected = new Set();
      for(let row = firstRow; row <= lastRow; row++){
        for(let col = 0; col < vsColumns; col++){
          const idx = row * vsColumns + col;
          if(idx >= allPhotos.length) break;

          // Card bounds in grid-relative coords
          const cardLeft  = col * (cardW + VS_GAP);
          const cardRight = cardLeft + cardW;

          // Check horizontal overlap
          if(cardLeft < selRight && cardRight > selLeft){
            selected.add(allPhotos[idx].id);
          }
        }
      }
      return selected;
    }

    function applyFrame(){
      rafId = null;
      const mx = pendingMouseX, my = pendingMouseY;

      // How much has the container scrolled since drag started?
      const scrollDelta = main.scrollTop - startScrollTop;

      // The visual start point moves UP as we scroll down
      const effectiveStartY = startY - scrollDelta;

      // Draw selection box in viewport coords using scroll-adjusted start
      const bx = Math.min(mx, startX),           by = Math.min(my, effectiveStartY);
      const bw = Math.abs(mx - startX),           bh = Math.abs(my - effectiveStartY);
      box.style.left = bx+'px'; box.style.top = by+'px';
      box.style.width = bw+'px'; box.style.height = bh+'px';

      // Pass scroll-adjusted start Y for accurate index calculation
      const newSel = calcSelectedIndices(startX, effectiveStartY, mx, my);

      // Merge with pre-drag selection if ctrl held
      const finalSel = ctrlHeld
        ? new Set([...preSelIds, ...newSel])
        : newSel;

      // Update selectedIds and DOM for visible cards only
      selectedIds.clear();
      finalSel.forEach(id => selectedIds.add(id));

      document.querySelectorAll('.photo-card').forEach(card => {
        const id = parseInt(card.dataset.id);
        card.classList.toggle('selected', selectedIds.has(id));
      });

      updateSelBar();
    }

    // Auto-scroll when near edges
    function autoScrollLoop(){
      scrollRafId = null;
      if(!dragging) return;
      const mainRect = main.getBoundingClientRect();
      const my = pendingMouseY;
      if(my > mainRect.bottom - SCROLL_ZONE){
        main.scrollTop += SCROLL_SPEED;
      } else if(my < mainRect.top + SCROLL_ZONE){
        main.scrollTop = Math.max(0, main.scrollTop - SCROLL_SPEED);
      }
      // vsUpdate runs from scroll event — no need to call it here
      if(!rafId) rafId = requestAnimationFrame(applyFrame);
      scrollRafId = requestAnimationFrame(autoScrollLoop);
    }

    main.addEventListener('mousedown', e => {
      if(e.target.closest('.photo-card') ||
         e.target.closest('.sel-bar')    ||
         e.target.closest('.toolbar')    ||
         e.button !== 0) return;

      dragging = true;
      ctrlHeld = e.ctrlKey || e.metaKey;
      startX = e.clientX;
      startY = e.clientY;
      pendingMouseX = startX;
      pendingMouseY = startY;
      startScrollTop = main.scrollTop;
      preSelIds = ctrlHeld ? new Set(selectedIds) : new Set();

      box.style.cssText=`display:block;left:${startX}px;top:${startY}px;width:0;height:0;`;

      if(!ctrlHeld) { selectedIds.clear(); document.querySelectorAll('.photo-card.selected').forEach(c=>c.classList.remove('selected')); updateSelBar(); }

      scrollRafId = requestAnimationFrame(autoScrollLoop);
    });

    document.addEventListener('mousemove', e => {
      if(!dragging) return;
      pendingMouseX = e.clientX;
      pendingMouseY = e.clientY;
      ctrlHeld = e.ctrlKey || e.metaKey;
      if(!rafId) rafId = requestAnimationFrame(applyFrame);
    });

    document.addEventListener('mouseup', () => {
      if(!dragging) return;
      dragging = false;
      box.style.display = 'none';
      if(rafId){ cancelAnimationFrame(rafId); rafId = null; }
      if(scrollRafId){ cancelAnimationFrame(scrollRafId); scrollRafId = null; }
    });
  }

  // ── Context menu ──────────────────────────────────────────────────────────
  function showCtx(e,id){
    e.preventDefault();e.stopPropagation();
    closeCtx();
    if(!selectedIds.has(id)){clearSelection();selectedIds.add(id);vsUpdate();updateSelBar();}
    const menu=document.getElementById('ctx-menu');
    if(isTrashView){
      menu.innerHTML=`
        <div class="ctx-item" onclick="restoreSelected()"><span class="ctx-icon">↩</span> Restore</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item danger" onclick="permanentDeleteSelected()"><span class="ctx-icon">✕</span> Delete Forever</div>`;
    } else {
      menu.innerHTML=`
        <div class="ctx-item" onclick="closeCtx();showLabelPopup()"><span class="ctx-icon">🏷</span> Set Label</div>
        <div class="ctx-item" onclick="closeCtx();showVarietyPopup()"><span class="ctx-icon">🌸</span> Set Variety</div>
        <div class="ctx-item" onclick="closeCtx();openEditorModal(${id})"><span class="ctx-icon">✏️</span> Edit Photo</div>
        <div class="ctx-item" onclick="closeCtx();downloadSelected()"><span class="ctx-icon">⬇</span> Download</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item danger" onclick="closeCtx();trashSelected()"><span class="ctx-icon">🗑</span> Move to Trash</div>`;
    }
    menu.classList.add('show');
    let x=e.clientX,y=e.clientY;
    if(x+190>window.innerWidth)x=window.innerWidth-195;
    if(y+160>window.innerHeight)y=window.innerHeight-165;
    menu.style.left=x+'px';menu.style.top=y+'px';
  }
  function closeCtx(){document.getElementById('ctx-menu').classList.remove('show');}
  document.addEventListener('click',e=>{
    if(!e.target.closest('#ctx-menu'))closeCtx();
    if(!e.target.closest('#label-popup')&&!e.target.closest('#ctx-menu'))closeLabelPopup();
    if(!e.target.closest('#variety-popup')&&!e.target.closest('#ctx-menu'))closeVarietyPopup();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeCtx();closeLabelPopup();closeVarietyPopup();closeLightbox();}
    if((e.key==='Delete'||e.key==='Backspace')&&selectedIds.size&&!isTrashView&&document.activeElement.tagName!=='INPUT'){trashSelected();}
  });

  // ── Label popup ───────────────────────────────────────────────────────────
  function showLabelPopup(){
    if(!selectedIds.size){showToast('Select some photos first','warn');return;}
    const popup=document.getElementById('label-popup');
    document.getElementById('lp-label').value='';
    document.getElementById('lp-variety').value='';
    popup.classList.add('show');
    popup.style.left=(window.innerWidth/2-140)+'px';
    popup.style.top=(window.innerHeight/2-100)+'px';
    setTimeout(()=>document.getElementById('lp-label').focus(),50);
  }
  function closeLabelPopup(){document.getElementById('label-popup').classList.remove('show');}

  async function applyLabel(){
    const label=document.getElementById('lp-label').value.trim();
    const variety=document.getElementById('lp-variety').value.trim();
    if(!label){showToast('Plant name is required','warn');return;}
    closeLabelPopup();
    const res=await fetch('/api/photos/label',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({photo_ids:Array.from(selectedIds),label,variety})
    });
    const data=await res.json();
    if(data.success){
      showToast(`Labeled ${data.updated} photo${data.updated!==1?'s':''}${variety?` as "${label} › ${variety}"`:`as "${label}"`}`);
      clearSelection();await loadSidebar();
      loadLabelPresets(); // refresh presets with any new labels
      varietyPresets = {}; // clear variety cache
      loadView(currentView,document.querySelector('.sb-item.active,.sub-row.active,.variety-row.active'));
    } else showToast(data.error||'Failed','error');
  }

  // enter key in label popup
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('lp-variety').addEventListener('keydown',e=>{if(e.key==='Enter')applyLabel();});
    document.getElementById('lp-label').addEventListener('keydown',e=>{if(e.key==='Enter')applyLabel();});
    document.getElementById('vp-variety').addEventListener('keydown',e=>{if(e.key==='Enter')applyVariety();});
  });

  // ── Variety-only popup ────────────────────────────────────────────────────
  function showVarietyPopup(){
    if(!selectedIds.size){showToast('Select some photos first','warn');return;}
    const popup=document.getElementById('variety-popup');
    document.getElementById('vp-variety').value='';
    loadVarietyPresetsForPopup();
    popup.classList.add('show');
    popup.style.left=(window.innerWidth/2-130)+'px';
    popup.style.top=(window.innerHeight/2-70)+'px';
    setTimeout(()=>document.getElementById('vp-variety').focus(),50);
  }
  function closeVarietyPopup(){document.getElementById('variety-popup').classList.remove('show');}

  async function applyVariety(){
    const variety=document.getElementById('vp-variety').value.trim();
    closeVarietyPopup();
    const res=await fetch('/api/photos/variety',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({photo_ids:Array.from(selectedIds),variety})
    });
    const data=await res.json();
    if(data.success){
      showToast(`Variety "${variety||'cleared'}" set on ${data.updated} photo${data.updated!==1?'s':''}`);
      clearSelection();await loadSidebar();
      loadView(currentView,document.querySelector('.sb-item.active,.sub-row.active,.variety-row.active'));
    } else showToast(data.error||'Failed','error');
  }

  // ── Label/Variety presets ─────────────────────────────────────────────────
  async function loadLabelPresets(){
    labelPresets = await fetch('/api/presets/labels').then(r=>r.json());
    const dl = document.getElementById('lp-label-list');
    if(dl) dl.innerHTML = labelPresets.map(l=>`<option value="${l}">`).join('');
  }

  async function updateVarietyDropdown(){
    const label = document.getElementById('lp-label').value.trim().toLowerCase();
    if(!label) return;
    // Load varieties for this label (cached)
    if(!varietyPresets[label]){
      const vars = await fetch(`/api/presets/varieties?label=${encodeURIComponent(label)}`).then(r=>r.json());
      varietyPresets[label] = vars;
    }
    const dl = document.getElementById('lp-variety-list');
    if(dl) dl.innerHTML = (varietyPresets[label]||[]).map(v=>`<option value="${v}">`).join('');
  }

  async function loadVarietyPresetsForPopup(){
    const vars = await fetch('/api/presets/varieties').then(r=>r.json());
    const dl = document.getElementById('vp-variety-list');
    if(dl) dl.innerHTML = vars.map(v=>`<option value="${v}">`).join('');
  }

  // ── Download ──────────────────────────────────────────────────────────────
  async function downloadSelected(){
    if(!selectedIds.size){showToast('Select photos first','warn');return;}
    const ids = Array.from(selectedIds);
    if(ids.length === 1){
      // Single file — direct download
      const photo = allPhotos.find(p=>p.id===ids[0]);
      if(!photo) return;
      const a = document.createElement('a');
      a.href = `/uploads/user_${window._userId}/inbox/${photo.stored_filename}`;
      a.download = photo.stored_filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      return;
    }
    // Multiple files — download as zip
    showToast(`Preparing ${ids.length} photos as zip...`, 'info');
    const label = currentView.startsWith('label:') ? currentView.slice(6) : 'plant_archive_photos';
    const folder_name = label.replace(/[^a-z0-9_]/gi,'_');
    const res = await fetch('/api/photos/download-zip', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({photo_ids: ids, folder_name})
    });
    if(!res.ok){ showToast('Download failed','error'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${folder_name}.zip`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${ids.length} photos as zip`);
  }

  // ── Trash ─────────────────────────────────────────────────────────────────
  function trashSelected(){
    if(!selectedIds.size)return;
    const count=selectedIds.size;
    showConfirm('Move to Trash?',
      `${count} photo${count>1?'s':''} will be moved to trash. You can restore them later.`,
      'Move to Trash',async()=>{
        const ids=Array.from(selectedIds);
        const CHUNK=50; let trashed=0;
        document.getElementById('spinner-msg').textContent=`Deleting ${ids.length} photos...`;
        document.getElementById('spinner-overlay').classList.add('show');
        for(let i=0;i<ids.length;i+=CHUNK){
          const chunk=ids.slice(i,i+CHUNK);
          const res=await fetch('/api/photos/trash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({photo_ids:chunk})});
          const data=await res.json();
          if(data.success) trashed+=data.trashed;
        }
        document.getElementById('spinner-overlay').classList.remove('show');
        showToast(`${trashed} photo${trashed!==1?'s':''} moved to trash`);
        clearSelection();
        await loadSidebar();
        const activeEl = document.querySelector('.sb-item.active,.sub-row.active,.variety-row.active');
        await loadView(currentView, activeEl);
        // Force virtual scroll reset after data changes
        if(allPhotos.length) initVirtualScroll();
      });
  }

  async function restoreSelected(){
    if(!selectedIds.size){showToast('Select photos first','warn');return;}
    const res=await fetch('/api/photos/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({photo_ids:Array.from(selectedIds)})});
    const data=await res.json();
    if(data.success){showToast(`${data.restored} photo${data.restored!==1?'s':''} restored`);clearSelection();await loadSidebar();loadView('trash',document.getElementById('sb-trash'));}
    else showToast('Failed','error');
  }

  function permanentDeleteSelected(){
    if(!selectedIds.size){showToast('Select photos first','warn');return;}
    const count=selectedIds.size;
    showConfirm('Delete Forever?',
      `Permanently delete ${count} photo${count>1?'s':''}? This cannot be undone.`,
      'Delete Forever',async()=>{
        const res=await fetch('/api/photos/delete-permanent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({photo_ids:Array.from(selectedIds)})});
        const data=await res.json();
        if(data.success){showToast(`${data.deleted} photo${data.deleted!==1?'s':''} permanently deleted`);clearSelection();await loadSidebar();await loadView('trash',document.getElementById('sb-trash'));if(allPhotos.length)initVirtualScroll();}
        else showToast('Failed','error');
      });
  }

  // ── Organize ──────────────────────────────────────────────────────────────
  async function runPlantOrganize(){
    document.getElementById('spinner-msg').textContent='Organizing plant folders...';
    document.getElementById('spinner-overlay').classList.add('show');
    const res=await fetch('/api/organize/plants',{method:'POST'});
    const data=await res.json();
    document.getElementById('spinner-overlay').classList.remove('show');
    if(data.success){showToast(`✓ ${data.organized} photos organized into plant folders${data.skipped?` · ${data.skipped} skipped (no label)`:''}`, 'info');await loadSidebar();}
    else showToast('Organize failed','error');
  }

  async function runSeasonOrganize(){
    document.getElementById('spinner-msg').textContent='Organizing by year & season...';
    document.getElementById('spinner-overlay').classList.add('show');
    const res=await fetch('/api/organize/seasons',{method:'POST'});
    const data=await res.json();
    document.getElementById('spinner-overlay').classList.remove('show');
    if(data.success){showToast(`✓ ${data.organized} photos organized${data.skipped?` · ${data.skipped} skipped`:''}`,'info');await loadSidebar();}
    else showToast('Organize failed','error');
  }

  // ── Lightbox ──────────────────────────────────────────────────────────────
  function openLightbox(i){lbIndex=i;showLbPhoto();document.getElementById('lightbox').classList.add('show');}
  function closeLightbox(){document.getElementById('lightbox').classList.remove('show');}
  function lbNav(dir){lbIndex=(lbIndex+dir+allPhotos.length)%allPhotos.length;showLbPhoto();}
  function showLbPhoto(){
    const p=allPhotos[lbIndex];
    document.getElementById('lb-img').src=`/uploads/user_${window._userId}/inbox/${p.stored_filename}`;
    document.getElementById('lb-date').textContent=fmtDate(p.date_taken);
    const parts=[p.label,p.variety,p.season?`${SE[p.season]} ${p.season} ${p.season_year||''}`:null].filter(Boolean);
    document.getElementById('lb-info').textContent=parts.join(' · ')||'unlabeled';
  }
  document.getElementById('lightbox').addEventListener('click',function(e){if(e.target===this)closeLightbox();});

  // ── Image editor ──────────────────────────────────────────────────────────
  function openEditorModal(photoId){
    currentEditorPhotoId = photoId;
    editorPendingOp = null;
    const photo = allPhotos.find(p=>p.id===photoId);
    if(!photo) return;
    const src = `/uploads/user_${window._userId}/inbox/${photo.stored_filename}?t=${Date.now()}`;
    document.getElementById('editor-preview').src = src;
    document.getElementById('editor-modal').style.display = 'flex';
    setEditorUnsaved(false);
  }

  function setEditorUnsaved(hasChanges){
    document.getElementById('editor-unsaved').style.display = hasChanges ? 'inline' : 'none';
    document.getElementById('editor-changed-badge').style.display = hasChanges ? 'block' : 'none';
    const saveBtn = document.getElementById('editor-save-btn');
    saveBtn.disabled = !hasChanges;
    saveBtn.style.opacity = hasChanges ? '1' : '.4';
    saveBtn.style.cursor = hasChanges ? 'pointer' : 'not-allowed';
  }

  function closeEditorModal(){
    if(editorPendingOp){
      showConfirm('Unsaved Changes',
        'You have unsaved edits. Discard them?',
        'Discard', ()=>{
          editorPendingOp = null;
          document.getElementById('editor-modal').style.display = 'none';
          currentEditorPhotoId = null;
          vsUpdate(true);
        });
      return;
    }
    document.getElementById('editor-modal').style.display = 'none';
    currentEditorPhotoId = null;
    vsUpdate(true);
  }

  function editRotate(degrees){
    if(!currentEditorPhotoId) return;
    // Stack rotations — if there's already a pending rotation, add to it
    if(editorPendingOp && editorPendingOp.type === 'rotate'){
      editorPendingOp.params.degrees = (editorPendingOp.params.degrees + degrees) % 360;
    } else {
      editorPendingOp = {type:'rotate', params:{degrees}};
    }
    // Show preview using CSS transform (no server call yet)
    const preview = document.getElementById('editor-preview');
    const currentRot = parseInt(preview.dataset.rot||'0');
    const newRot = (currentRot + degrees) % 360;
    preview.dataset.rot = newRot;
    preview.style.transform = `rotate(${newRot}deg)`;
    setEditorUnsaved(true);
    showToast(`Rotate ${degrees > 0 ? '↻' : '↺'} ${Math.abs(degrees)}° — click Save to apply`, 'info');
  }

  function editResize(){
    if(!currentEditorPhotoId) return;
    const w = parseInt(document.getElementById('resize-w').value)||0;
    const h = parseInt(document.getElementById('resize-h').value)||0;
    if(!w && !h){ showToast('Enter width or height','warn'); return; }
    editorPendingOp = {type:'resize', params:{width:w, height:h}};
    setEditorUnsaved(true);
    showToast(`Resize queued — click Save to apply`, 'info');
  }

  async function editSave(){
    if(!editorPendingOp || !currentEditorPhotoId) return;
    const op = editorPendingOp;
    const url = `/api/photos/${currentEditorPhotoId}/${op.type}`;
    const res = await fetch(url, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(op.params)
    });
    const data = await res.json();
    if(data.success){
      editorPendingOp = null;
      setEditorUnsaved(false);
      // Reset CSS transform and reload actual saved image
      const preview = document.getElementById('editor-preview');
      preview.style.transform = '';
      preview.dataset.rot = '0';
      const t = Date.now();
      const photo = allPhotos.find(p=>p.id===currentEditorPhotoId);
      preview.src = `/uploads/user_${window._userId}/inbox/${photo.stored_filename}?t=${t}`;
      showToast('Changes saved');
      vsUpdate(true);
    } else showToast(data.error||'Save failed','error');
  }

  function editDiscard(){
    if(!editorPendingOp){ showToast('No pending changes','info'); return; }
    editorPendingOp = null;
    setEditorUnsaved(false);
    // Reset CSS transform
    const preview = document.getElementById('editor-preview');
    preview.style.transform = '';
    preview.dataset.rot = '0';
    // Reload original from server
    const photo = allPhotos.find(p=>p.id===currentEditorPhotoId);
    preview.src = `/uploads/user_${window._userId}/inbox/${photo.stored_filename}?t=${Date.now()}`;
    showToast('Changes discarded');
  }

  async function editRestoreOriginal(){
    if(!currentEditorPhotoId) return;
    showConfirm('Restore Original?',
      'This will replace the current photo with the original backup. Any edits will be lost.',
      'Restore', async()=>{
        const res = await fetch(`/api/photos/${currentEditorPhotoId}/restore-original`, {method:'POST'});
        const data = await res.json();
        if(data.success){
          editorPendingOp = null;
          setEditorUnsaved(false);
          const preview = document.getElementById('editor-preview');
          preview.style.transform = '';
          preview.dataset.rot = '0';
          const photo = allPhotos.find(p=>p.id===currentEditorPhotoId);
          preview.src = `/uploads/user_${window._userId}/inbox/${photo.stored_filename}?t=${Date.now()}`;
          showToast('Original restored');
          vsUpdate(true);
        } else showToast(data.error||'No backup found','warn');
      });
  }

  // ── Confirm dialog ────────────────────────────────────────────────────────
  function showConfirm(title,msg,okLabel,cb){
    confirmCallback=cb;
    document.getElementById('confirm-title').textContent=title;
    document.getElementById('confirm-msg').textContent=msg;
    document.getElementById('confirm-ok-btn').textContent=okLabel;
    document.getElementById('confirm-dialog').classList.add('show');
  }
  function closeConfirm(){document.getElementById('confirm-dialog').classList.remove('show');confirmCallback=null;}
  async function confirmOk(){const cb=confirmCallback;closeConfirm();if(cb)await cb();}

  // ── Helpers ───────────────────────────────────────────────────────────────


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