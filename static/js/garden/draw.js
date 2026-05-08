/* garden/draw.js */

// ── Main draw ──────────────────────────────────────────────────────────────
function redraw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // Background
  ctx.fillStyle='#1a1a1a';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  drawGrid();
  drawGardenBorder();

  // Draw items by layer order
  const layerOrder=['ground','structures','plants'];
  for(const lid of layerOrder){
    const layer=state.layers.find(l=>l.id===lid);
    if(layer&&!layer.visible) continue;
    state.items.filter(i=>i.layer===lid).forEach(drawItem);
  }

  drawSelectionHandles();
  updateScaleBar();
}

function drawGrid(){
  if(!state.snapGrid) return;
  ctx.strokeStyle='rgba(255,255,255,.04)';
  ctx.lineWidth=1;
  const step=state.scale*state.snapSize;
  const startX=state.offsetX%step, startY=state.offsetY%step;
  for(let x=startX;x<canvas.width;x+=step){ ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke(); }
  for(let y=startY;y<canvas.height;y+=step){ ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke(); }
}

function drawGardenBorder(){
  const tl=worldToCanvas(0,0);
  const br=worldToCanvas(state.gardenW,state.gardenH);
  const w=br.x-tl.x, h=br.y-tl.y;
  ctx.fillStyle='rgba(255,255,255,.03)';
  ctx.fillRect(tl.x,tl.y,w,h);
  ctx.strokeStyle='rgba(151,196,89,.5)';
  ctx.lineWidth=2; ctx.setLineDash([8,4]);
  ctx.strokeRect(tl.x,tl.y,w,h);
  ctx.setLineDash([]);

  // Dimension labels
  ctx.fillStyle='rgba(151,196,89,.7)';
  ctx.font=`12px DM Sans`;
  ctx.textAlign='center';
  ctx.fillText(`${state.gardenW}ft`, (tl.x+br.x)/2, tl.y-8);
  ctx.textAlign='right';
  ctx.save(); ctx.translate(tl.x-8,(tl.y+br.y)/2); ctx.rotate(-Math.PI/2);
  ctx.fillText(`${state.gardenH}ft`,0,0); ctx.restore();
  ctx.textAlign='left';
}

function drawItem(item){
  if(item.type==='fence'||item.type==='drip'){
    const s=worldToCanvas(item.x1,item.y1);
    const e=worldToCanvas(item.x2,item.y2);
    ctx.strokeStyle=item.type==='fence'?'#FFB300':'#42A5F5';
    ctx.lineWidth=item.id===state.selectedId?4:3;
    ctx.setLineDash(item.type==='drip'?[6,4]:[]);
    ctx.beginPath();
    ctx.moveTo(s.x,s.y);
    if(item.type==='drip' && item.cpx!=null){
      // Curved drip line using quadratic bezier control point
      const cp=worldToCanvas(item.cpx,item.cpy);
      ctx.quadraticCurveTo(cp.x,cp.y,e.x,e.y);
    } else {
      ctx.lineTo(e.x,e.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw dots for drip along the curve
    if(item.type==='drip'){
      const steps=Math.max(8,Math.floor(Math.sqrt((item.x2-item.x1)**2+(item.y2-item.y1)**2)/1.2));
      for(let i=0;i<=steps;i++){
        const t=i/steps;
        let px,py;
        if(item.cpx!=null){
          // Bezier point
          px=(1-t)**2*item.x1+2*(1-t)*t*item.cpx+t**2*item.x2;
          py=(1-t)**2*item.y1+2*(1-t)*t*item.cpy+t**2*item.y2;
        } else {
          px=item.x1+(item.x2-item.x1)*t;
          py=item.y1+(item.y2-item.y1)*t;
        }
        const p=worldToCanvas(px,py);
        ctx.fillStyle='#42A5F5';
        ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill();
      }
      // Draw control point handle when selected
      if(item.id===state.selectedId && item.cpx!=null){
        const cp=worldToCanvas(item.cpx,item.cpy);
        ctx.strokeStyle='rgba(66,165,245,.4)'; ctx.lineWidth=1; ctx.setLineDash([3,2]);
        ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(cp.x,cp.y); ctx.lineTo(e.x,e.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle='#42A5F5'; ctx.strokeStyle='white'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(cp.x,cp.y,8,0,Math.PI*2); ctx.fill(); ctx.stroke();
      }
    }
    // Hover label
    if(item.id===hoveredId) drawLabel(item);
    return;
  }

  if(item.type==='grouping'){
    drawGroupingItem(item);
    return;
  }

  if(item.type==='bed'){
    const tl=worldToCanvas(item.x,item.y);
    const w=item.wFt*state.scale, h=item.hFt*state.scale;
    const isSelected=item.id===state.selectedId;
    const isHovered=item.id===hoveredId;

    ctx.save();

    // Texture or solid fill
    if(item.textureId){
      const tex=textures.find(t=>t.id===item.textureId);
      if(tex&&tex.pattern){
        ctx.fillStyle=tex.pattern;
      } else { ctx.fillStyle=item.color||'#3a5c2a'; }
    } else { ctx.fillStyle=item.color||'#3a5c2a'; }

    ctx.fillRect(tl.x,tl.y,w,h);

    // Border
    ctx.strokeStyle=isSelected?'#97C459':isHovered?'rgba(151,196,89,.6)':'rgba(255,255,255,.15)';
    ctx.lineWidth=isSelected?2.5:1.5;
    ctx.strokeRect(tl.x,tl.y,w,h);

    // Plant spacing dots inside bed
    drawSpacingDots(item,tl,w,h);

    ctx.restore();

    if(item.id===hoveredId||isSelected) drawLabel(item);
    return;
  }

  if(item.type==='plant'){
    const spacing=item.spacing||parseFloat(document.getElementById('prop-spacing').value)||2;
    const plantSize=item.plantSize||1;
    const cx=worldToCanvas(item.x+spacing/2,item.y+spacing/2);
    const r=(plantSize/2)*state.scale;
    const isSelected=item.id===state.selectedId;
    const isHovered=item.id===hoveredId;

    ctx.save();
    ctx.translate(cx.x,cx.y);
    if(item.rotation) ctx.rotate(item.rotation*Math.PI/180);

    // Draw badge image or fallback circle
    if(item.badgeImg){
      ctx.drawImage(item.badgeImg,-r,-r,r*2,r*2);
    } else {
      ctx.fillStyle='rgba(59,109,17,.6)';
      ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#97C459'; ctx.font=`${Math.max(10,r*.8)}px DM Sans`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('🌱',0,0);
    }

    // Selection ring
    if(isSelected){
      ctx.strokeStyle='#97C459'; ctx.lineWidth=2.5;
      ctx.setLineDash([4,2]);
      ctx.beginPath(); ctx.arc(0,0,r+4,0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Spacing circle (faint)
    const sr=(spacing/2)*state.scale;
    ctx.strokeStyle=isHovered?'rgba(151,196,89,.4)':'rgba(255,255,255,.08)';
    ctx.lineWidth=1; ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.arc(cx.x,cx.y,sr,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);

    if(item.id===hoveredId||isSelected) drawLabel(item);
  }
}

function drawSpacingDots(bed,tl,w,h){
  const spacing=parseFloat(document.getElementById('prop-spacing').value)||2;
  const dotR=3;
  ctx.fillStyle='rgba(151,196,89,.3)';
  const cols=Math.floor(bed.wFt/spacing);
  const rows=Math.floor(bed.hFt/spacing);
  const padX=(bed.wFt-cols*spacing)/2;
  const padY=(bed.hFt-rows*spacing)/2;
  for(let r=0;r<=rows;r++){
    for(let c=0;c<=cols;c++){
      const px=tl.x+(padX+c*spacing)*state.scale;
      const py=tl.y+(padY+r*spacing)*state.scale;
      ctx.beginPath(); ctx.arc(px,py,dotR,0,Math.PI*2); ctx.fill();
    }
  }
}

function drawLabel(item){
  const pos = item.type==='fence'||item.type==='drip'
    ? worldToCanvas((item.x1+item.x2)/2,(item.y1+item.y2)/2)
    : worldToCanvas(item.x+(item.wFt||1)/2, item.y-(item.type==='plant'?0.3:0));

  const label=item.name||'';
  if(!label) return;

  ctx.font='bold 12px DM Sans';
  const tw=ctx.measureText(label).width;
  ctx.fillStyle='rgba(0,0,0,.75)';
  ctx.beginPath();
  ctx.roundRect(pos.x-tw/2-6,pos.y-18,tw+12,22,6);
  ctx.fill();
  ctx.fillStyle='white';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(label,pos.x,pos.y-7);
  ctx.textAlign='left'; ctx.textBaseline='alphabetic';
}

function drawSelectionHandles(){
  if(!state.selectedId) return;
  const item=state.items.find(i=>i.id===state.selectedId);
  if(!item||item.type==='fence'||item.type==='drip') return;

  // Bottom-right resize handle for beds
  if(item.type==='grouping'){
    drawGroupingItem(item);
    return;
  }

  if(item.type==='bed'){
    const br=worldToCanvas(item.x+item.wFt,item.y+item.hFt);
    ctx.fillStyle='#97C459';
    ctx.strokeStyle='white'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.arc(br.x,br.y,7,0,Math.PI*2);
    ctx.fill(); ctx.stroke();
  }
}