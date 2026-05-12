/* organize/editor.js — image editor (rotate, resize, restore) */

function openEditorModal(photoId){
    currentEditorPhotoId = photoId;
    editorPendingOp = null;
    const photo = allPhotos.find(p=>p.id===photoId);
    if(!photo) return;
    const src = `/uploads/user_${window._userId}/inbox/${photo.stored_filename}?t=${Date.now()}`;
    document.getElementById('editor-preview').src = src;
    document.getElementById('editor-modal').style.display = 'flex';
    setEditorUnsaved(false);
  }

  function setEditorUnsaved(hasChanges){
    document.getElementById('editor-unsaved').style.display = hasChanges ? 'inline' : 'none';
    document.getElementById('editor-changed-badge').style.display = hasChanges ? 'block' : 'none';
    const saveBtn = document.getElementById('editor-save-btn');
    saveBtn.disabled = !hasChanges;
    saveBtn.style.opacity = hasChanges ? '1' : '.4';
    saveBtn.style.cursor = hasChanges ? 'pointer' : 'not-allowed';
  }

  function closeEditorModal(){
    if(editorPendingOp){
      showConfirm('Unsaved Changes',
        'You have unsaved edits. Discard them?',
        'Discard', ()=>{
          editorPendingOp = null;
          document.getElementById('editor-modal').style.display = 'none';
          currentEditorPhotoId = null;
          vsUpdate(true);
        });
      return;
    }
    document.getElementById('editor-modal').style.display = 'none';
    currentEditorPhotoId = null;
    vsUpdate(true);
  }

  function editRotate(degrees){
    if(!currentEditorPhotoId) return;
    // Stack rotations — if there's already a pending rotation, add to it
    if(editorPendingOp && editorPendingOp.type === 'rotate'){
      editorPendingOp.params.degrees = (editorPendingOp.params.degrees + degrees) % 360;
    } else {
      editorPendingOp = {type:'rotate', params:{degrees}};
    }
    // Show preview using CSS transform (no server call yet)
    const preview = document.getElementById('editor-preview');
    const currentRot = parseInt(preview.dataset.rot||'0');
    const newRot = (currentRot + degrees) % 360;
    preview.dataset.rot = newRot;
    preview.style.transform = `rotate(${newRot}deg)`;
    setEditorUnsaved(true);
    showToast(`Rotate ${degrees > 0 ? '↻' : '↺'} ${Math.abs(degrees)}° — click Save to apply`, 'info');
  }

  function editResize(){
    if(!currentEditorPhotoId) return;
    const w = parseInt(document.getElementById('resize-w').value)||0;
    const h = parseInt(document.getElementById('resize-h').value)||0;
    if(!w && !h){ showToast('Enter width or height','warn'); return; }
    editorPendingOp = {type:'resize', params:{width:w, height:h}};
    setEditorUnsaved(true);
    showToast(`Resize queued — click Save to apply`, 'info');
  }

  async function editSave(){
    if(!editorPendingOp || !currentEditorPhotoId) return;
    const op = editorPendingOp;
    const url = `/api/photos/${currentEditorPhotoId}/${op.type}`;
    const res = await fetch(url, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(op.params)
    });
    const data = await res.json();
    if(data.success){
      editorPendingOp = null;
      setEditorUnsaved(false);
      // Reset CSS transform and reload actual saved image
      const preview = document.getElementById('editor-preview');
      preview.style.transform = '';
      preview.dataset.rot = '0';
      const t = Date.now();
      const photo = allPhotos.find(p=>p.id===currentEditorPhotoId);
      preview.src = `/uploads/user_${window._userId}/inbox/${photo.stored_filename}?t=${t}`;
      showToast('Changes saved');
      vsUpdate(true);
    } else showToast(data.error||'Save failed','error');
  }

  function editDiscard(){
    if(!editorPendingOp){ showToast('No pending changes','info'); return; }
    editorPendingOp = null;
    setEditorUnsaved(false);
    // Reset CSS transform
    const preview = document.getElementById('editor-preview');
    preview.style.transform = '';
    preview.dataset.rot = '0';
    // Reload original from server
    const photo = allPhotos.find(p=>p.id===currentEditorPhotoId);
    preview.src = `/uploads/user_${window._userId}/inbox/${photo.stored_filename}?t=${Date.now()}`;
    showToast('Changes discarded');
  }

  async function editRestoreOriginal(){
    if(!currentEditorPhotoId) return;
    showConfirm('Restore Original?',
      'This will replace the current photo with the original backup. Any edits will be lost.',
      'Restore', async()=>{
        const res = await fetch(`/api/photos/${currentEditorPhotoId}/restore-original`, {method:'POST'});
        const data = await res.json();
        if(data.success){
          editorPendingOp = null;
          setEditorUnsaved(false);
          const preview = document.getElementById('editor-preview');
          preview.style.transform = '';
          preview.dataset.rot = '0';
          const photo = allPhotos.find(p=>p.id===currentEditorPhotoId);
          preview.src = `/uploads/user_${window._userId}/inbox/${photo.stored_filename}?t=${Date.now()}`;
          showToast('Original restored');
          vsUpdate(true);
        } else showToast(data.error||'No backup found','warn');
      });
  }

  // ── Confirm dialog ────────────────────────────────────────────────────────
  function showConfirm(title,msg,okLabel,cb){
    confirmCallback=cb;
    document.getElementById('confirm-title').textContent=title;
    document.getElementById('confirm-msg').textContent=msg;
    document.getElementById('confirm-ok-btn').textContent=okLabel;
    document.getElementById('confirm-dialog').classList.add('show');
  }
  function closeConfirm(){document.getElementById('confirm-dialog').classList.remove('show');confirmCallback=null;}
  async function confirmOk(){const cb=confirmCallback;closeConfirm();if(cb)await cb();}

  // ── Helpers ───────────────────────────────────────────────────────────────


  function toggleDarkMode(){
    const isDark = document.documentElement.classList.toggle('dark-mode');
    localStorage.setItem('site-dark-mode', isDark ? 'dark' : 'light');
    // Update toggle button text on any page
    const btn = document.getElementById('dark-mode-toggle');
    if(btn) btn.textContent = isDark ? '☀️' : '🌙';
  }
  // Init toggle button state
  (function(){
    const btn = document.getElementById('dark-mode-toggle');
    if(btn) btn.textContent = document.documentElement.classList.contains('dark-mode') ? '☀️' : '🌙';
  })();

  init();