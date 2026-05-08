/* home.js */

const SEASON_ORDER = ['spring','summer','fall','winter'];
  const SEASON_EMOJI = { spring:'🌸', summer:'☀️', fall:'🍂', winter:'❄️' };

  async function init() {
    const res = await fetch('/api/me');
    if (res.status === 401) { window.location.href = '/'; return; }
    const user = await res.json();
    window._userId = user.id;
    document.getElementById('nav-username').textContent = user.username;
    document.getElementById('hero-greeting').textContent = `Welcome back, ${user.username}`;

    const stats = await fetch('/api/stats').then(r => r.json());
    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-labels').textContent = stats.label_count;
    document.getElementById('stat-inbox').textContent = stats.inbox_count;
    document.getElementById('stat-organized').textContent = stats.organized_count;

    // Year grid
    const tree = stats.year_tree || {};
    const years = Object.keys(tree).map(Number).sort((a,b) => b - a);

    if (years.length) {
      document.getElementById('year-grid').innerHTML = years.map(year => {
        const seasons = tree[year];
        const total = Object.values(seasons).reduce((a,b) => a+b, 0);
        const pips = SEASON_ORDER
          .filter(s => seasons[s])
          .map(s => `<span class="season-pip pip-${s}">${SEASON_EMOJI[s]} ${seasons[s]}</span>`)
          .join('');
        return `
          <a href="/organize?year=${year}" class="year-card">
            <div class="yr-num">${year}</div>
            <div class="yr-seasons">${pips}</div>
            <div class="yr-total">${total} photo${total !== 1 ? 's' : ''}</div>
          </a>`;
      }).join('');
    }
  }