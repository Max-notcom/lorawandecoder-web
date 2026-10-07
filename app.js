import {decode,isChartable,convertValue} from './decoder.js';
import {markDuplicates,parseDelimited,detectDelimiter,filterRows,pageNumbers,DATA_GROUPS,matchesDataKind} from './data.js';
import {drawCharts} from './charts.js';
import {saveDataset,loadDataset,clearDataset} from './storage.js';
const $=id=>document.getElementById(id);
let rows=[],selected=new Set(),fields=[],page=0,source='Pasted input',busy=false,restoring=false,loadedText=null,disposeCharts=()=>{},worker=null,job=0,storageQueue=Promise.resolve();
const pending=new Map();const PAGE_SIZE=50;
const settingIDs=['model','temperature','pressure','axis','highlight','includeErrors','hideOverrange','hideSimulation'];
const getSettings=()=>Object.fromEntries(settingIDs.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]));
const message=(text,type='')=>{$('message').textContent=text;$('message').className='message '+type;};
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const formatNumber=value=>Number.isFinite(value)?new Intl.NumberFormat('en',{maximumSignificantDigits:7}).format(value):String(value);
function ensureWorker(){
 if(worker)return;
 worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{const task=pending.get(data.id);if(!task)return;pending.delete(data.id);data.error?task.reject(Error(data.error)):task.resolve(data);};
 worker.onerror=()=>{for(const task of pending.values())task.reject(Error('Background processing failed. Reload this page and try again.'));pending.clear();worker.terminate();worker=null;};
}
function request(data){ensureWorker();return new Promise((resolve,reject)=>{const id=++job;pending.set(id,{resolve,reject});try{worker.postMessage({id,...data});}catch(e){pending.delete(id);reject(e);}});}
function setBusy(value){busy=value;for(const id of [...settingIDs,'persist','clearSaved','selectAll','selectNone'])$(id).disabled=value;$('decode').disabled=value;$('export').disabled=value||!rows.length;$('clear').disabled=value;$('file').disabled=value;$('example').disabled=value;$('model').disabled=value;$('decode').textContent=value?'Decoding…':'Decode input →';}
function persistCurrent(){
 if(restoring||!$('persist').checked)return;
 const dataset={rows,settings:getSettings(),selected:[...selected]};
 $('storageStatus').textContent='Saving latest dataset locally…';
 storageQueue=storageQueue.catch(()=>{}).then(()=>saveDataset(dataset)).then(()=>{$('storageStatus').textContent=$('persist').checked?'Latest dataset saved in this browser.':'Storage off';}).catch(e=>{$('storageStatus').textContent=`Could not save locally: ${e.message}. Current data is still available; export it to keep a copy.`;});
}
function refreshFields(preserve=false){
 const previous=new Set(fields);
 fields=[...new Set(rows.flatMap(r=>Object.entries(r.decoded?.values||{}).filter(([k,v])=>isChartable(k,v)).map(([k])=>k)))];
 selected=preserve?new Set(fields.filter(f=>selected.has(f)||!previous.has(f))):new Set(fields);
 const fragment=document.createDocumentFragment();for(const f of fields){const label=el('label',undefined,'check'),input=el('input');input.type='checkbox';input.checked=selected.has(f);input.value=f;input.onchange=()=>{input.checked?selected.add(f):selected.delete(f);renderCharts();persistCurrent();};label.append(input,document.createTextNode(f));fragment.append(label);}
 $('series').replaceChildren(fragment);if(!fields.length)$('series').append(el('span','No numeric measurements available.','muted'));
 $('seriesCount').textContent=fields.length?`· ${fields.length} available`:'';refreshTableFilters();
}
function renderCharts(){disposeCharts();const settings=getSettings();const timed=rows.filter(r=>r.time!==null).length;const wall=rows.some(r=>r.timeKind==='wall'),instant=rows.some(r=>r.timeKind==='instant');
 $('timeNote').textContent=settings.axis==='time'?`${timed.toLocaleString()} of ${rows.length.toLocaleString()} rows have usable timestamps.${wall?' Timezone-free timestamps are shown as supplied.':''}${wall&&instant?' Wall-clock and offset-aware timestamps are plotted separately.':''}`:'';
 disposeCharts=drawCharts($('charts'),rows,selected,settings);
}
function refreshTableFilters(){
 const select=$('dataFilter'),previous=select.value,options=[el('option','All data types')];options[0].value='all';
 const categories=el('optgroup');categories.label='Measurement groups';
 for(const [key,[label]] of Object.entries(DATA_GROUPS)){const option=el('option',label);option.value='group:'+key;option.disabled=!rows.some(r=>matchesDataKind(r,option.value));categories.append(option);}options.push(categories);
 const names=[...new Set(rows.flatMap(r=>Object.keys(r.decoded?.values||{})))].sort(),measurements=el('optgroup');measurements.label='Specific fields';
 for(const name of names){const option=el('option',name);option.value='field:'+name;measurements.append(option);}if(names.length)options.push(measurements);
 const types=new Map();for(const r of rows)if(r.decoded)types.set(r.decoded.type,r.decoded.label);
 const packets=el('optgroup');packets.label='Packet types';for(const [type,label] of types){const option=el('option',`${label} · 0x${type.toString(16)}`);option.value='type:'+type;packets.append(option);}if(types.size)options.push(packets);
 select.replaceChildren(...options);select.value=[...select.options].some(o=>o.value===previous&&!o.disabled)?previous:'all';
}
function filteredRows(){return filterRows(rows,{status:$('rowFilter').value,kind:$('dataFilter').value,query:$('tableSearch').value});}
function renderTable(){
 const view=filteredRows(),pages=Math.ceil(view.length/PAGE_SIZE);page=Math.max(0,Math.min(page,pages-1));const fragment=document.createDocumentFragment(),settings=getSettings();
 for(const r of view.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)){
  const tr=el('tr');if(r.duplicate&&$('highlight').checked)tr.className='row-duplicate';
  const identity=el('td',undefined,'source');identity.append(el('strong',`Row ${r.row}`),el('div',r.source,'muted'),el('div',`Line ${r.line}`,'muted'));if(r.duplicate&&$('highlight').checked)identity.append(el('span','Repeated','badge warning'));
  const time=el('td',r.timestamp||'—','time');if(r.timestampError)time.append(el('div',r.timestampError,'issue'));else if(r.timeKind==='wall')time.append(el('div','Timezone unspecified','muted'));else if(r.timeKind==='instant')time.append(el('div','Offset-aware / epoch','muted'));
  const raw=el('td',r.raw||'(empty)','raw'),values=el('td'),details=el('td',undefined,'row-details');
  if(r.error)values.append(el('div',r.error,'issue'));
  else {const d=r.decoded;values.append(el('div',d.special?d.label:`${d.label} · 0x${d.type.toString(16)}`,'muted'));
   if(d.type===0x41||d.type===0x47)values.append(el('span','Technical fields in details','muted'));
   else for(const [name,value] of Object.entries(d.values)){
    const line=el('div',undefined,'measurement');line.append(el('span',name));const [converted,unit]=typeof value==='number'?convertValue(value,d.units[name],settings):[value,''];line.append(el('b',`${typeof converted==='number'?formatNumber(converted):converted}${unit?' '+unit:''}`));
    if(d.invalidFields.includes(name))line.append(el('span',' · error','issue'));else if(d.overrangeFields.includes(name))line.append(el('span',' · overrange','warning'));values.append(line);
   }
   const warned=d.flags.length||d.warnings.length;details.append(el('span',d.special?'Special':warned?'Flagged':'Decoded','badge'+(warned?' warning':'')));
   const disclosure=el('details'),summary=el('summary','Inspect'),content=el('pre');
   const full=Object.entries(d.values).map(([k,v])=>`${k}: ${String(v)}${d.units[k]?' '+d.units[k]:''}`);
   content.textContent=[`Encoding: ${d.encoding}`,`Bytes: ${d.hex}`,d.status===null?'':`Measurement status: 0x${d.status.toString(16).padStart(4,'0')}`,d.measurementCount==null?'':`Measurement count: ${d.measurementCount}`,...full,...d.flags,...d.warnings,...d.diagnostics].filter(Boolean).join('\n');disclosure.append(summary,content);details.append(disclosure);
  }
  tr.append(identity,time,raw,values,details);fragment.append(tr);
 }
 if(!view.length){const tr=el('tr'),td=el('td',rows.length?'No records match this filter.':'No dataset loaded.','empty');td.colSpan=5;tr.append(td);fragment.append(tr);}
 $('tbody').replaceChildren(fragment);$('pageInfo').textContent=view.length?`${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE,view.length)} of ${view.length.toLocaleString()} rows · page ${page+1}/${pages}`:'0 rows';$('prev').disabled=page===0;$('next').disabled=page>=pages-1;
 const buttons=pageNumbers(pages,page).map(number=>{if(number===null)return el('span','…','muted');const button=el('button',String(number),'small');button.type='button';button.setAttribute('aria-label',`Page ${number}`);if(number===page+1)button.setAttribute('aria-current','page');button.onclick=()=>{page=number-1;renderTable();$('pageNumbers').querySelector('[aria-current=page]')?.focus();};return button;});$('pageNumbers').replaceChildren(...buttons);$('pageInput').max=Math.max(1,pages);$('pageInput').value=page+1;$('pageInput').disabled=!pages;$('goPage').disabled=!pages;$('pageInput').setCustomValidity('');
}
function renderSummary(){const valid=rows.filter(r=>r.decoded).length,issues=rows.filter(r=>r.error||r.timestampError||r.decoded?.flags.length||r.decoded?.warnings.length).length;for(const [id,n] of [['total',rows.length],['valid',valid],['errors',issues],['duplicates',rows.filter(r=>r.duplicate).length]])$(id).textContent=n.toLocaleString();$('export').disabled=busy||!rows.length;}
function render(){renderSummary();renderCharts();renderTable();}
function updateColumnHints(){const first=$('input').value.replace(/^\ufeff/,'').split(/\r?\n/)[0]||'';if(!detectDelimiter(first))return;try{const headers=parseDelimited(first,detectDelimiter(first))[0]?.cells||[];$('columns').replaceChildren(...['auto','none',...headers.map(h=>h.trim()).filter(h=>h&&h!=='data')].map(v=>{const o=el('option');o.value=v;return o;}));}catch{/* Full import reports malformed input. */}}
$('decode').onclick=async()=>{
 if(busy)return;setBusy(true);message('Decoding input locally…');
 const mode=$('importMode').value;
 try {
  const result=await request({text:loadedText??$('input').value,options:{source,encoding:$('encoding').value,model:$('model').value,timestampColumn:$('timestampColumn').value.trim()||'auto',timestampFormat:$('timestampFormat').value}});
  rows=mode==='append'?[...rows,...result.rows]:result.rows;markDuplicates(rows);if(!rows.some(r=>r.time!==null))$('axis').value='sample';page=0;refreshFields(mode==='append');render();persistCurrent();
  const errors=rows.filter(r=>r.error).length,tsErrors=rows.filter(r=>r.timestampError).length;
  message(`${rows.length.toLocaleString()} rows loaded · ${rows.filter(r=>r.decoded).length.toLocaleString()} decoded${errors?` · ${errors.toLocaleString()} payload issues`:''}${tsErrors?` · ${tsErrors} timestamp issues`:''}. Original order retained.`,errors||tsErrors?'':'success');
 }catch(e){message(`${e.message}. The previous dataset has been kept.`, 'error');}finally{setBusy(false);}
};
$('input').oninput=()=>{loadedText=null;source='Pasted input';$('source').textContent='Pasted input · CSV payload header must be named data';updateColumnHints();};
$('file').onchange=async()=>{const file=$('file').files[0];if(!file)return;try{message('Reading file locally…');const text=await file.text();loadedText=text;$('input').value=text.slice(0,8000);$('input').readOnly=text.length>8000;source=file.name;$('source').textContent=`${file.name} · ${(file.size/1024).toFixed(1)} KB · ready to decode${text.length>8000?' · preview truncated; full file will decode':''}`;updateColumnHints();message('File ready. Choose settings, then Decode input.');}catch(e){message(`Could not read file: ${e.message}`,'error');}finally{$('file').value='';}};
$('pasteMode').onclick=()=>{loadedText=null;$('input').readOnly=false;$('input').value='';source='Pasted input';$('source').textContent='Pasted input · CSV payload header must be named data';$('input').focus();};
$('example').onclick=()=>{loadedText=null;$('input').readOnly=false;$('input').value='data,ts\nEAAANmFADE8w,2026-10-06 (09:00:00.000)\nEQAASRJA4058,2026-10-06 (09:15:00.000)\nEAAANmFADE8w,2026-10-06 (09:30:00.000)';source='Example';$('source').textContent='Example · three packets including one repeated payload';updateColumnHints();message('Example ready. Select Decode input.');};
$('model').onchange=()=>{for(const r of rows)if(r.decoded?.type===0x41){try{r.decoded=decode(r.raw,{encoding:r.decoded.encoding,model:$('model').value});}catch(e){r.error=e.message;}}render();persistCurrent();};
for(const id of settingIDs.filter(id=>id!=='model'))$(id).onchange=()=>{render();persistCurrent();};
const resetTablePage=()=>{page=0;renderTable();};$('rowFilter').onchange=resetTablePage;$('dataFilter').onchange=resetTablePage;
let searchTimer;$('tableSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(resetTablePage,150);};
$('resetFilters').onclick=()=>{clearTimeout(searchTimer);$('rowFilter').value='all';$('dataFilter').value='all';$('tableSearch').value='';resetTablePage();};
$('prev').onclick=()=>{page--;renderTable();};$('next').onclick=()=>{page++;renderTable();};
$('pageInput').oninput=()=>{$('pageInput').setCustomValidity('');};
$('pageJump').onsubmit=event=>{event.preventDefault();const input=$('pageInput'),value=Number(input.value),pages=Math.ceil(filteredRows().length/PAGE_SIZE);if(!Number.isInteger(value)||value<1||value>pages){input.setCustomValidity(`Enter a page from 1 to ${Math.max(1,pages)}.`);input.reportValidity();return;}page=value-1;renderTable();};
function setSelection(all){selected=new Set(all?fields:[]);for(const box of $('series').querySelectorAll('input'))box.checked=all;renderCharts();persistCurrent();}
$('selectAll').onclick=()=>setSelection(true);$('selectNone').onclick=()=>setSelection(false);
$('export').onclick=async()=>{if(busy||!rows.length)return;$('export').disabled=true;try{message('Preparing CSV locally…');const {csv}=await request({action:'export',rows});const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=el('a');a.href=url;a.download='decoded-payloads.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);message('CSV exported with native units and full decoded precision.','success');}catch(e){message(`Export failed: ${e.message}`,'error');}finally{$('export').disabled=!rows.length;}};
$('clear').onclick=()=>{rows=[];page=0;refreshFields();render();persistCurrent();message('Current dataset cleared.');};
function queueClear(){storageQueue=storageQueue.catch(()=>{}).then(clearDataset).then(()=>{$('storageStatus').textContent=$('persist').checked?'Saved dataset cleared. Future changes will be remembered.':'Storage off · saved dataset removed.';}).catch(e=>{$('storageStatus').textContent=`Could not clear saved data: ${e.message}`;});}
$('persist').onchange=()=>{try{if($('persist').checked){localStorage.setItem('payload-decoder-remember','1');persistCurrent();}else{localStorage.removeItem('payload-decoder-remember');queueClear();}}catch(e){$('persist').checked=false;$('storageStatus').textContent=`Browser storage unavailable: ${e.message}`;}};
$('clearSaved').onclick=queueClear;
async function restore(){
 try{
  if(localStorage.getItem('payload-decoder-remember')!=='1')return;
  restoring=true;$('persist').checked=true;setBusy(true);message('Restoring locally saved dataset…');const saved=await loadDataset();
  if(saved){rows=saved.rows;for(const id of settingIDs)if(saved.settings&&id in saved.settings){if($(id).type==='checkbox')$(id).checked=!!saved.settings[id];else $(id).value=saved.settings[id];}markDuplicates(rows);refreshFields();selected=new Set((saved.selected||fields).filter(f=>fields.includes(f)));for(const box of $('series').querySelectorAll('input'))box.checked=selected.has(box.value);render();message(`Restored ${rows.length.toLocaleString()} rows from this browser.`, 'success');$('storageStatus').textContent='Latest dataset restored from this browser.';}
  else {message('Ready for input. Browser storage is enabled.');$('storageStatus').textContent='Storage enabled · no saved dataset.';}
 }catch(e){message(`Saved data could not be restored: ${e.message}. Import a file or clear saved data.`,'error');}finally{restoring=false;setBusy(false);}
}
restore();
