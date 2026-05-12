/* organize/sidebar.js — sidebar loading and context menus */

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
    updateZoomClass(160);
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
    // Undated count — find it in label list
    const undatedLabel = labelData.labels.find(l=>l.label==='undated');
    const undatedEl = document.getElementById('sb-undated-count');
    if(undatedEl) undatedEl.textContent = undatedLabel ? undatedLabel.count : 0;

    // Label list (flat)
    document.getElementById('label-list').innerHTML=labelData.labels.map(l=>`
      <div class="sb-item" id="sb-label-${l.label}" onclick="loadView('label:${l.label}',this)" oncontextmenu="showSidebarCtx(event,'label',{label:'${l.label}'})">
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
    // Only show years that have photos, plus current year as default
    const currentYear = new Date().getFullYear();
    const yearsWithPhotos = Object.keys(tree).map(Number).sort((a,b)=>b-a);
    const years = yearsWithPhotos.length ? yearsWithPhotos : [currentYear];
    // Always include current year if not already there
    if(!years.includes(currentYear)) years.unshift(currentYear);
    document.getElementById('year-tree').innerHTML=years.map(year=>{
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


  // ── Sidebar right-click context menus ─────────────────────────────────────
  let _sidebarCtx = { type: null, label: null, year: null, season: null };

  function showSidebarCtx(e, type, data) {
    e.preventDefault();
    e.stopPropagation();
    _sidebarCtx = { type, ...data };

    const menu = document.getElementById('sidebar-ctx-menu');
    let html = '';

    if (type === 'label') {
      html = `
        <div class="ctx-item" onclick="sidebarCtxAddLabel()">➕ Add label folder</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item danger" onclick="sidebarCtxDeleteLabel('${data.label}')">🗑 Delete "${data.label}" folder</div>`;
    } else if (type === 'labels-section') {
      html = `<div class="ctx-item" onclick="sidebarCtxAddLabel()">➕ Add label folder</div>`;
    } else if (type === 'year') {
      html = `
        <div class="ctx-item" onclick="sidebarCtxAddYear()">➕ Add year folder</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item danger" onclick="sidebarCtxDeleteYear(${data.year})">🗑 Delete ${data.year} folder</div>`;
    } else if (type === 'year-section') {
      html = `<div class="ctx-item" onclick="sidebarCtxAddYear()">➕ Add year folder</div>`;
    } else if (type === 'season') {
      html = `
        <div class="ctx-item danger" onclick="sidebarCtxDeleteSeason(${data.year},'${data.season}')">🗑 Delete ${data.season} ${data.year} folder</div>`;
    } else if (type === 'plant') {
      html = `
        <div class="ctx-item" onclick="sidebarCtxAddPlant()">➕ Add plant folder</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item danger" onclick="sidebarCtxDeletePlant('${data.label}')">🗑 Delete "${data.label}" plant folder</div>`;
    } else if (type === 'plant-section') {
      html = `<div class="ctx-item" onclick="sidebarCtxAddPlant()">➕ Add plant folder</div>`;
    }

    if (!html) return;
    menu.innerHTML = html;
    menu.classList.add('show');
    let x = e.clientX, y = e.clientY;
    if (x + 180 > window.innerWidth) x = window.innerWidth - 185;
    if (y + 120 > window.innerHeight) y = window.innerHeight - 125;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }

  function closeSidebarCtx() { document.getElementById('sidebar-ctx-menu').classList.remove('show'); }

  // ── Add/delete actions ──────────────────────────────────────────────────────
  async function sidebarCtxAddLabel() {
    closeSidebarCtx();
    const name = prompt('New label folder name:');
    if (!name?.trim()) return;
    // Create folder on disk via organize endpoint
    const res = await fetch('/api/organize/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'label', name: name.trim() })
    });
    if ((await res.json()).success) { showToast(`Created "${name}" folder`); await loadSidebar(); }
  }

  async function sidebarCtxDeleteLabel(label) {
    closeSidebarCtx();
    if (!confirm(`Delete the "${label}" label folder? Photos will NOT be deleted — only the folder organization.`)) return;
    const res = await fetch('/api/organize/delete-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'label', name: label })
    });
    if ((await res.json()).success) { showToast(`Deleted "${label}" folder`); await loadSidebar(); }
  }

  async function sidebarCtxAddYear() {
    closeSidebarCtx();
    const year = prompt('Year to add (e.g. 2020):');
    if (!year || isNaN(year)) return;
    const res = await fetch('/api/organize/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'year', year: parseInt(year) })
    });
    if ((await res.json()).success) { showToast(`Created ${year} folder`); await loadSidebar(); }
  }

  async function sidebarCtxDeleteYear(year) {
    closeSidebarCtx();
    if (!confirm(`Delete the ${year} folder? Photos inside will NOT be deleted from your archive.`)) return;
    const res = await fetch('/api/organize/delete-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'year', year })
    });
    if ((await res.json()).success) { showToast(`Deleted ${year} folder`); await loadSidebar(); }
  }

  async function sidebarCtxDeleteSeason(year, season) {
    closeSidebarCtx();
    if (!confirm(`Delete ${season} ${year} folder? Photos will NOT be deleted.`)) return;
    const res = await fetch('/api/organize/delete-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'season', year, season })
    });
    if ((await res.json()).success) { showToast(`Deleted ${season} ${year} folder`); await loadSidebar(); }
  }

  async function sidebarCtxAddPlant() {
    closeSidebarCtx();
    const name = prompt('New plant folder name:');
    if (!name?.trim()) return;
    const res = await fetch('/api/organize/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'plant', name: name.trim() })
    });
    if ((await res.json()).success) { showToast(`Created "${name}" plant folder`); await loadSidebar(); }
  }

  async function sidebarCtxDeletePlant(label) {
    closeSidebarCtx();
    if (!confirm(`Delete the "${label}" plant folder? Photos will NOT be deleted.`)) return;
    const res = await fetch('/api/organize/delete-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'plant', name: label })
    });
    if ((await res.json()).success) { showToast(`Deleted "${label}" plant folder`); await loadSidebar(); }
  }