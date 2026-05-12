/* organize/actions.js — context menu, labels, trash, download, organize */

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