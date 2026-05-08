/* garden/init.js */

// ── Dark mode ──────────────────────────────────────────────────────────────
function toggleDarkMode(){
  const isLight = document.body.classList.toggle('light-mode');
  document.getElementById('dark-toggle').textContent = isLight ? '☀️' : '🌙';
  localStorage.setItem('garden-dark-mode', isLight ? 'light' : 'dark');
  redraw(); // redraw canvas with new bg
}

function initDarkMode(){
  const saved = localStorage.getItem('garden-dark-mode');
  if(saved === 'light'){
    document.body.classList.add('light-mode');
    document.getElementById('dark-toggle').textContent = '☀️';
  }
}

function doLogout(){ fetch('/api/logout',{method:'POST'}).then(()=>window.location.href='/'); }

init();