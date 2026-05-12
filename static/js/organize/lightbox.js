/* organize/lightbox.js — lightbox viewer */

// ── Lightbox ──────────────────────────────────────────────────────────────
  function openLightbox(i){lbIndex=i;showLbPhoto();document.getElementById('lightbox').classList.add('show');}
  function closeLightbox(){document.getElementById('lightbox').classList.remove('show');}
  function lbNav(dir){lbIndex=(lbIndex+dir+allPhotos.length)%allPhotos.length;showLbPhoto();}
  function showLbPhoto(){
    const p=allPhotos[lbIndex];
    document.getElementById('lb-img').src=`/uploads/user_${window._userId}/inbox/${p.stored_filename}`;
    document.getElementById('lb-date').textContent=fmtDate(p.date_taken);
    const parts=[p.label,p.variety,p.season?`${SE[p.season]} ${p.season} ${p.season_year||''}`:null].filter(Boolean);
    document.getElementById('lb-info').textContent=parts.join(' · ')||'unlabeled';
  }
  document.getElementById('lightbox').addEventListener('click',function(e){if(e.target===this)closeLightbox();});

  // ── Image editor ──────────────────────────────────────────────────────────