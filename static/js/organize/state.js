/* organize/state.js — shared state variables */

/* organize.js — Organize Photos page */

const SE = {spring:'🌸',summer:'☀️',fall:'🍂',winter:'❄️'};
  const SO = ['spring','summer','fall','winter'];
  // YEARS is now dynamic — built from actual photo data in renderYearTree

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