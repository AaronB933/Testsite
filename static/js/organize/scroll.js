/* organize/scroll.js — zoom, virtual scroll, drag select */

// ── Zoom ──────────────────────────────────────────────────────────────────
  function setZoom(size){
    vsCardSize = size;
    document.documentElement.style.setProperty('--card-size', size+'px');
    document.querySelectorAll('.zoom-btn').forEach(b=>{
      b.classList.toggle('active', parseInt(b.dataset.size)===size);
    });
    if(allPhotos.length) initVirtualScroll();
  }


  // ── Mouse wheel zoom ───────────────────────────────────────────────────────
  const ZOOM_MIN = 40;   // ~500+ photos visible
  const ZOOM_MAX = 400;  // very large cards

  document.getElementById('main-area').addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return; // only Ctrl+scroll
    e.preventDefault();
    const delta = e.deltaY > 0 ? -12 : 12;
    const newSize = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, vsCardSize + delta));
    if (newSize !== vsCardSize) {
      vsCardSize = newSize;
      document.documentElement.style.setProperty('--card-size', newSize + 'px');
      // Update zoom buttons if still in range
      document.querySelectorAll('.zoom-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.size) === newSize);
      });
      if (allPhotos.length) initVirtualScroll();
    }
  }, { passive: false });

  // Also allow plain scroll on the main area (no ctrl) for smoother feel
  // Show zoom level indicator briefly
  let _zoomToast = null;
  function showZoomLevel() {
    const cols = Math.max(1, Math.floor((document.getElementById('main-area').clientWidth - 64 + VS_GAP) / (vsCardSize + VS_GAP)));
    const msg = `${cols} columns · ${vsCardSize}px cards`;
    clearTimeout(_zoomToast);
    const el = document.getElementById('zoom-indicator');
    if (el) { el.textContent = msg; el.style.opacity = '1'; _zoomToast = setTimeout(() => el.style.opacity = '0', 1500); }
  }


  function updateZoomClass(size) {
    const wrap = document.getElementById('grid-wrap');
    if (wrap) wrap.classList.toggle('zoom-compact', size < 160);
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