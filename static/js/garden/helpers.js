/* garden/helpers.js */

// ── Export PNG ─────────────────────────────────────────────────────────────
function exportPNG(){
  const link=document.createElement('a');
  link.download='garden_plan.png';
  link.href=canvas.toDataURL('image/png');
  link.click();
  showToast('Garden exported as PNG');
}

// ── Helpers ────────────────────────────────────────────────────────────────
function showToast(msg,type='success'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`show toast-${type}`;
  clearTimeout(t._timer); t._timer=setTimeout(()=>t.className='',3500);
}
// ── Add plants to bed ──────────────────────────────────────────────────────
let addPlantsBedId = null;
let addPlantsBadge = null;

function openAddPlantsModal(bedId){
  addPlantsBedId = bedId;
  addPlantsBadge = null;
  const spacing = parseFloat(document.getElementById('prop-spacing').value)||2;
  document.getElementById('add-plants-spacing').value = spacing;
  document.getElementById('add-plants-size').value = 1;
  document.getElementById('add-plants-exact').value = '';

  // Populate badge grid — draggable into canvas AND clickable to select
  const grid = document.getElementById('add-plants-grid');
  if(!badges.length){
    grid.innerHTML='<div style="grid-column:1/-1;font-size:.78rem;color:#666;padding:.5rem;">No badges yet — create some in Badge Creation</div>';
  } else {
    grid.innerHTML = badges.map((b,idx)=>`
      <div onclick="selectAddBadge(${idx},this)"
           draggable="true"
           ondragstart="dragBadgeFromModal(event,${idx})"
           title="Click to select · Drag onto canvas to place"
           style="background:#1a1a1a;border-radius:8px;border:2px solid #3a3a3a;padding:.4rem;cursor:grab;text-align:center;transition:border-color .15s;user-select:none;">
        <img src="${b.url}" style="width:100%;aspect-ratio:1;object-fit:contain;pointer-events:none;" onerror="this.parentElement.style.display='none'"/>
        <div style="font-size:.6rem;color:#888;margin-top:.2rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.name}</div>
      </div>`).join('');
  }

  updateAddPlantsCount();
  updateExactHint();
  document.getElementById('add-plants-modal').classList.add('show');
}

function dragBadgeFromModal(e, idx){
  // Allow dragging from modal onto the canvas — sets badge + closes modal
  draggingBadge = badges[idx];
  addPlantsBadge = badges[idx];
  e.dataTransfer.setData('text/plain', JSON.stringify({url:badges[idx].url, name:badges[idx].name}));
  e.dataTransfer.effectAllowed = 'copy';
  // Close modal after short delay so drop can fire
  setTimeout(()=>document.getElementById('add-plants-modal').classList.remove('show'), 100);
}

function selectAddBadge(idx, el){
  addPlantsBadge = badges[idx];
  document.querySelectorAll('#add-plants-grid > div').forEach(d=>d.style.borderColor='#3a3a3a');
  el.style.borderColor='var(--g600)';
  updateAddPlantsCount();
}

function updateAddPlantsCount(){
  const bed = getItem(addPlantsBedId);
  if(!bed) return;
  const spacing = parseFloat(document.getElementById('add-plants-spacing').value)||2;
  const cols = Math.floor(bed.wFt/spacing)+1;
  const rows = Math.floor(bed.hFt/spacing)+1;
  const total = cols * rows;
  document.getElementById('add-plants-count').textContent =
    `Fill Bed will place ≈ ${total} plants in ${bed.wFt}ft × ${bed.hFt}ft bed at ${spacing}ft spacing`;
  updateExactHint();
}

function updateExactHint(){
  const bed = getItem(addPlantsBedId);
  if(!bed) return;
  const bedArea = bed.wFt * bed.hFt;
  const maxCount = Math.floor(bedArea * 2); // cap at 2x bed area sq ft
  document.getElementById('add-plants-exact-hint').textContent = `(max ${maxCount})`;
  document.getElementById('add-plants-exact').max = maxCount;
}

function clampExactCount(){
  const bed = getItem(addPlantsBedId);
  if(!bed) return;
  const maxCount = Math.floor(bed.wFt * bed.hFt * 2);
  const input = document.getElementById('add-plants-exact');
  let val = parseInt(input.value)||0;
  if(val > maxCount) input.value = maxCount;
  if(val < 1 && input.value !== '') input.value = 1;
}

function addExactPlants(){
  if(!addPlantsBadge){ showToast('Select a badge first','warn'); return; }
  const bed = getItem(addPlantsBedId);
  if(!bed){ document.getElementById('add-plants-modal').classList.remove('show'); return; }

  const count = parseInt(document.getElementById('add-plants-exact').value)||0;
  if(count < 1){ showToast('Enter a number of plants','warn'); return; }

  const plantSize = parseFloat(document.getElementById('add-plants-size').value)||1;
  const spacing = parseFloat(document.getElementById('add-plants-spacing').value)||2;

  // Calculate optimal grid to fit exactly `count` plants
  // Find cols that gives closest to count rows
  let bestCols = 1, bestRows = count;
  for(let c=1; c<=count; c++){
    const r = Math.ceil(count/c);
    // Prefer grid closest to bed aspect ratio
    const aspectBed = bed.wFt/bed.hFt;
    const aspectGrid = c/r;
    if(Math.abs(aspectGrid-aspectBed) < Math.abs(bestCols/bestRows-aspectBed)){
      bestCols=c; bestRows=r;
    }
  }

  // Distribute evenly across bed
  const spacingX = bed.wFt / Math.max(bestCols, 1);
  const spacingY = bed.hFt / Math.max(bestRows, 1);
  const startX = bed.x + spacingX/2 - plantSize/2;
  const startY = bed.y + spacingY/2 - plantSize/2;

  let placed = 0;
  outer: for(let r=0; r<bestRows; r++){
    for(let c=0; c<bestCols; c++){
      if(placed >= count) break outer;
      addItem({
        type:'plant',
        x: startX + c*spacingX,
        y: startY + r*spacingY,
        wFt: spacing, hFt: spacing,
        plantSize, spacing,
        name: addPlantsBadge.name||'Plant',
        badgeUrl: addPlantsBadge.url,
        badgeImg: null, layer:'plants', rotation:0
      });
      placed++;
    }
  }

  document.getElementById('add-plants-modal').classList.remove('show');
  showToast(`Placed ${placed} ${addPlantsBadge.name} plants`);
  redraw();
}

function fillBedWithPlants(){
  if(!addPlantsBadge){ showToast('Select a badge first','warn'); return; }
  const bed = getItem(addPlantsBedId);
  if(!bed){ document.getElementById('add-plants-modal').classList.remove('show'); return; }

  const spacing = parseFloat(document.getElementById('add-plants-spacing').value)||2;
  const plantSize = parseFloat(document.getElementById('add-plants-size').value)||1;

  const cols = Math.floor(bed.wFt/spacing)+1;
  const rows = Math.floor(bed.hFt/spacing)+1;
  const padX = (bed.wFt - (cols-1)*spacing)/2;
  const padY = (bed.hFt - (rows-1)*spacing)/2;

  let count=0;
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const px = bed.x + padX + c*spacing - plantSize/2;
      const py = bed.y + padY + r*spacing - plantSize/2;
      if(px>=bed.x-0.1 && px+plantSize<=bed.x+bed.wFt+0.1 &&
         py>=bed.y-0.1 && py+plantSize<=bed.y+bed.hFt+0.1){
        addItem({
          type:'plant', x:px, y:py,
          wFt:spacing, hFt:spacing,
          plantSize, spacing,
          name:addPlantsBadge.name||'Plant',
          badgeUrl:addPlantsBadge.url,
          badgeImg:null, layer:'plants', rotation:0
        });
        count++;
      }
    }
  }

  document.getElementById('add-plants-modal').classList.remove('show');
  showToast(`Placed ${count} ${addPlantsBadge.name} plants`);
  redraw();
}


// ══════════════════════════════════════════════════════════════════════════
// PLANT GROUPINGS
// ══════════════════════════════════════════════════════════════════════════

let grpShape = 'rect';        // 'rect' | 'ellipse' | 'free'
let grpSourceId = null;       // plant item that triggered the modal
let grpFreePath = [];         // freehand points (normalized 0-1)
let grpFreeDrawing = false;
let grpPreviewBadgeImg = null;