import {convertValue} from './decoder.js';
const colors=['#7fb8e6','#d5ae72','#82c9b4','#c6a0df','#e99191','#c5cd83','#98a6e8','#80cfd3'];
const number=v=>new Intl.NumberFormat('en',{maximumSignificantDigits:6}).format(v);
export function reducePoints(points,buckets=800) {
 if(points.length<=buckets*2)return points;
 const result=[points[0]],size=points.length/buckets;
 for(let i=0;i<buckets;i++){
  const slice=points.slice(Math.floor(i*size),Math.floor((i+1)*size));if(!slice.length)continue;
  let min=slice[0],max=slice[0];for(const p of slice){if(p.y<min.y)min=p;if(p.y>max.y)max=p;}
  result.push(...(min.x<=max.x?[min,max]:[max,min]));
 }
 result.push(points.at(-1));return result;
}
export function drawCharts(container,rows,selected,settings) {
 container.replaceChildren();const disposers=[],groups=new Map();
 for(const field of selected){
  for(let i=0;i<rows.length;i++){
   const r=rows[i],d=r.decoded;if(!d||!(field in d.values))continue;
   if(settings.axis==='time'&&r.time===null)continue;
   const kind=settings.axis==='time'?r.timeKind:'sample';
   const [y,unit]=convertValue(d.values[field],d.units[field],settings);
   const key=unit+'|'+kind;
   if(!groups.has(key))groups.set(key,{unit,kind,series:new Map()});const group=groups.get(key);
   if(!group.series.has(field))group.series.set(field,[]);
   const invalid=d.invalidFields.includes(field),over=d.overrangeFields.includes(field),sim=!!(d.status&0x100);
   const excluded=!Number.isFinite(y)||(invalid&&!settings.includeErrors)||(over&&settings.hideOverrange)||(sim&&settings.hideSimulation);
   group.series.get(field).push({x:settings.axis==='time'?r.time:i+1,y:excluded?null:y,row:r,flag:invalid?'Error':over?'Overrange':sim?'Simulation':''});
  }
 }
 if(!groups.size){const p=document.createElement('p');p.className='empty';p.textContent=selected.size?'No chartable readings for this selection.':'Select measurements to plot.';container.append(p);return ()=>{};}
 for(const group of groups.values()){
  if(settings.axis==='time')for(const ps of group.series.values())ps.sort((a,b)=>a.x-b.x);
  const card=document.createElement('section');card.className='chart-card';
  const top=document.createElement('div');top.className='chart-head';
  const title=document.createElement('h3');title.textContent=group.unit||'Value';
  const tools=document.createElement('div');tools.className='chart-tools';
  const note=document.createElement('span');note.className='muted';note.textContent=group.kind==='wall'?'Time · timezone unspecified':group.kind==='instant'?'Time · UTC':'Sample order';
  top.append(title,note,tools);card.append(top);
  const legend=document.createElement('div');legend.className='legend';let c=0;
  const series=[...group.series].map(([name,points])=>({name,points,color:colors[c++%colors.length]}));
  for(const s of series){const span=document.createElement('span');span.textContent=s.name;span.style.color=s.color;legend.append(span);}card.append(legend);
  const wrap=document.createElement('div');wrap.className='canvas-wrap';const canvas=document.createElement('canvas');canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${group.unit} chart, ${series.map(s=>s.name).join(', ')}. Use plus and minus buttons to zoom and arrow keys to pan. Full values are available in the data table.`);wrap.append(canvas);
  const tip=document.createElement('output');tip.className='chart-tip';tip.hidden=true;wrap.append(tip);card.append(wrap);
  const foot=document.createElement('p');foot.className='chart-foot muted';card.append(foot);container.append(card);
  let low=Infinity,high=-Infinity;
  for(const s of series)for(const p of s.points)if(p.y!==null){low=Math.min(low,p.x);high=Math.max(high,p.x);}
  if(!Number.isFinite(low)){foot.textContent='No finite readings match the current filters.';continue;}
  const domain=[low,high===low?high+1:high];let range=[...domain],width=0,plot,rendered=[];
  const ctx=canvas.getContext('2d');
  function draw(){
   width=wrap.clientWidth;const height=260,ratio=window.devicePixelRatio||1;canvas.width=width*ratio;canvas.height=height*ratio;canvas.style.height=height+'px';ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
   plot={left:68,right:width-20,top:20,bottom:210};let ymin=Infinity,ymax=-Infinity,count=0,shown=0;
   const visible=series.map(s=>{const pts=s.points.filter(p=>p.x>=range[0]&&p.x<=range[1]);for(const p of pts)if(p.y!==null){ymin=Math.min(ymin,p.y);ymax=Math.max(ymax,p.y);count++;}return {...s,visible:pts};});
   if(!Number.isFinite(ymin)){foot.textContent='No readings in this zoom range.';return;}
   const pad=(ymax-ymin||Math.abs(ymin)*.1||1)*.12;ymin-=pad;ymax+=pad;
   const xp=x=>plot.left+(x-range[0])/(range[1]-range[0])*(plot.right-plot.left),yp=y=>plot.bottom-(y-ymin)/(ymax-ymin)*(plot.bottom-plot.top);
   ctx.font='11px system-ui';ctx.lineWidth=1;
   for(let i=0;i<=4;i++){const y=plot.top+(plot.bottom-plot.top)*i/4;ctx.strokeStyle='#27313b';ctx.beginPath();ctx.moveTo(plot.left,y);ctx.lineTo(plot.right,y);ctx.stroke();ctx.fillStyle='#95a1ac';ctx.textAlign='right';ctx.fillText(number(ymax-(ymax-ymin)*i/4),plot.left-10,y+4);}
   ctx.textAlign='center';for(let i=0;i<3;i++){const x=range[0]+(range[1]-range[0])*i/2;let label=number(x);if(group.kind!=='sample')label=new Date(x).toISOString().replace('T',' ').slice(0,16);ctx.textAlign=i===0?'left':i===2?'right':'center';ctx.fillText(label,xp(x),237);}
   rendered=[];
   for(const s of visible){
    const segments=[];let segment=[];for(const p of s.visible){if(p.y===null){if(segment.length)segments.push(segment);segment=[];}else segment.push(p);}if(segment.length)segments.push(segment);
    for(const seg of segments){const reduced=reducePoints(seg,Math.max(100,Math.floor(width)));shown+=reduced.length;ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineWidth=1.5;ctx.beginPath();reduced.forEach((p,i)=>{i?ctx.lineTo(xp(p.x),yp(p.y)):ctx.moveTo(xp(p.x),yp(p.y));rendered.push({...p,name:s.name,color:s.color,px:xp(p.x),py:yp(p.y)});});ctx.stroke();
     for(const p of reduced)if(p.flag||reduced.length<100){ctx.beginPath();if(p.flag){ctx.rect(xp(p.x)-3,yp(p.y)-3,6,6);}else ctx.arc(xp(p.x),yp(p.y),2.5,0,Math.PI*2);ctx.fill();}
    }
   }
   foot.textContent=`${count.toLocaleString()} readings${shown<count?` · ${shown.toLocaleString()} rendered; min/max preserved`:''} · Drag to zoom · Double-click to reset · Squares mark flagged readings`;
  }
  function zoom(factor){const center=(range[0]+range[1])/2,half=(range[1]-range[0])*factor/2;range=[Math.max(domain[0],center-half),Math.min(domain[1],center+half)];if(range[1]<=range[0])range=[...domain];draw();}
  for(const [label,action] of [['+',()=>zoom(.5)],['−',()=>zoom(2)],['Reset',()=>{range=[...domain];draw();}]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.className='small';button.setAttribute('aria-label',label==='+'?'Zoom in':label==='−'?'Zoom out':'Reset chart zoom');button.onclick=action;tools.append(button);}
  canvas.onmousemove=e=>{if(!rendered.length)return;const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;let nearest=null,dist=Infinity;for(const p of rendered){const distance=Math.hypot(p.px-x,p.py-y);if(distance<dist){dist=distance;nearest=p;}}if(dist>45){tip.hidden=true;return;}tip.hidden=false;tip.textContent=`${nearest.name}: ${number(nearest.y)} ${group.unit} · ${nearest.row.timestamp||`Sample ${nearest.x}`} · ${nearest.row.source}, row ${nearest.row.row}${nearest.flag?' · '+nearest.flag:''}`;};
  canvas.onmouseleave=()=>{tip.hidden=true;};let anchor=null;
  canvas.onpointerdown=e=>{anchor=e.offsetX;canvas.setPointerCapture(e.pointerId);};
  canvas.onpointerup=e=>{if(anchor!==null&&Math.abs(e.offsetX-anchor)>15){const toX=v=>range[0]+(Math.max(plot.left,Math.min(plot.right,v))-plot.left)/(plot.right-plot.left)*(range[1]-range[0]);const a=toX(anchor),b=toX(e.offsetX);if(a!==b)range=[Math.min(a,b),Math.max(a,b)];draw();}anchor=null;};
  canvas.ondblclick=()=>{range=[...domain];draw();};
  canvas.onkeydown=e=>{if(e.key==='+'||e.key==='='){zoom(.5);e.preventDefault();}else if(e.key==='-'){zoom(2);e.preventDefault();}else if(['ArrowLeft','ArrowRight'].includes(e.key)){const delta=(range[1]-range[0])*.2*(e.key==='ArrowLeft'?-1:1);if(range[0]+delta>=domain[0]&&range[1]+delta<=domain[1]){range=range.map(x=>x+delta);draw();}e.preventDefault();}};
  const observer=new ResizeObserver(draw);observer.observe(wrap);disposers.push(()=>observer.disconnect());draw();
 }
 return ()=>disposers.forEach(fn=>fn());
}
