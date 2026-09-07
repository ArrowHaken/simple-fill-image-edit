// Keep the selected area obvious without changing the actual edit mask.
export function drawSelection(ctx,{draft,preview,visible,zoom}) {
  if(!visible||!draft)return;
  const styles=getComputedStyle(document.documentElement);
  const target=styles.getPropertyValue('--selection-target').trim();
  ctx.save();ctx.lineWidth=1.5/zoom;ctx.setLineDash([6/zoom,4/zoom]);ctx.lineJoin='round';
  function outline(paths,color){
    ctx.strokeStyle=color;
    for(const points of paths||[]){
      if(points.length<2)continue;
      ctx.beginPath();ctx.moveTo(...points[0]);
      for(const point of points.slice(1))ctx.lineTo(...point);
      ctx.closePath();ctx.stroke();
    }
  }
  if(draft.box){
    // Reuse the previous workbench's translucent green selection treatment.
    const b=draft.box;
    ctx.fillStyle='rgba(8,125,101,.24)';
    ctx.fillRect(b.x_min,b.y_min,b.x_max-b.x_min,b.y_max-b.y_min);
    ctx.strokeStyle=preview?target:styles.getPropertyValue('--cc-focus-ring').trim();
    ctx.strokeRect(b.x_min,b.y_min,b.x_max-b.x_min,b.y_max-b.y_min);
  }else if(preview?.outlines){
    outline(preview.outlines.target,target);
  }
  ctx.setLineDash([]);
  if(!preview)for(const point of draft.points){
    ctx.beginPath();ctx.arc(point.x,point.y,4/zoom,0,Math.PI*2);
    ctx.fillStyle=point.label?target:styles.getPropertyValue('--cc-danger-text').trim();
    ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5/zoom;ctx.stroke();
  }
  ctx.restore();
}
