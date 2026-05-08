/* garden/state.js */

// ═══════════════════════════════════════════════════════════════════════════
// GARDEN PLANNER — full canvas-based 2D layout tool
// ═══════════════════════════════════════════════════════════════════════════

const canvas  = document.getElementById('garden-canvas');
const overlay = document.getElementById('overlay-canvas');
const ctx     = canvas.getContext('2d');
const octx    = overlay.getContext('2d');

// ── State ──────────────────────────────────────────────────────────────────
let state = {
  gardenW: 30,    // feet
  gardenH: 20,    // feet
  scale: 32,      // px per foot
  offsetX: 60,    // canvas pan offset
  offsetY: 60,
  snapGrid: true,
  snapSize: 1,    // feet
  items: [],      // all items on canvas
  layers: [{id:'ground',name:'Ground',visible:true},{id:'structures',name:'Structures',visible:true},{id:'plants',name:'Plants',visible:true}],
  selectedId: null,
  currentLayoutId: null,
  currentLayoutName: 'My Garden'
};

let activeTool = 'select';
let isPanning = false;
let isDrawing = false;
let panStart = {x:0,y:0};
let drawStart = {x:0,y:0};
let drawCurrent = {x:0,y:0};
let dragItem = null;
let dragOffset = {x:0,y:0};
let isResizing = false;
let resizeHandle = null;

// Undo/redo
let history = [];
let historyIdx = -1;

// Badges and textures
let badges = [];
let textures = [];   // [{id, name, pattern, tileUrl}]
let selectedTexturePhotoId = null;

// Hover state
let hoveredId = null;