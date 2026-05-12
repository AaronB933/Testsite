/* organize/view.js — loadView and photo rendering */

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