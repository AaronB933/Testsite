/* organize/init.js — page initialization and event listeners */

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