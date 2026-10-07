import {decode} from './decoder.js';

// Delimited text parser with quoted fields, multiline records and physical line provenance.
export function parseDelimited(text,delimiter=',') {
 const records=[];let fields=[],field='',quoted=false,closed=false,line=1,start=1;
 const pushField=()=>{fields.push(field);field='';closed=false;};
 const pushRecord=()=>{pushField();records.push({cells:fields,line:start});fields=[];start=line;};
 for(let i=0;i<text.length;i++) {
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else{field+=c;if(c==='\n')line++;}continue;}
  if(c==='"'){if(field||closed)throw Error(`Unexpected quote at line ${line}, column ${fields.length+1}`);quoted=true;continue;}
  if(c===delimiter){pushField();continue;}
  if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;line++;pushRecord();continue;}
  if(closed){if(c===' '||c==='\t')continue;throw Error(`Unexpected character after quote at line ${line}, column ${fields.length+1}`);}
  field+=c;
 }
 if(quoted)throw Error(`Unclosed quoted field at line ${start}, column ${fields.length+1}`);
 if(field||fields.length||closed)pushRecord();
 return records;
}
export function parseTimestamp(raw,format='auto') {
 const value=String(raw??'').trim();if(!value)return {time:null,timeKind:null};
 if(/^\d{10}$|^\d{13}$/.test(value))return {time:Number(value)*(value.length===10?1000:1),timeKind:'instant'};
 let match=value.match(/^(\d{4})-(\d{2})-(\d{2})(?:(?:T|\s+\(?|\()(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\)?(Z|[+-]\d{2}:?\d{2})?)?$/i);
 let parts;
 if(match)parts=[+match[1],+match[2],+match[3],+(match[4]||0),+(match[5]||0),+(match[6]||0),+(match[7]||'0').padEnd(3,'0'),match[8]];
 else {
  match=value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if(!match)throw Error(`Unrecognized timestamp: ${value}`);
  let a=+match[1],b=+match[2];
  if(format==='auto'&&a<=12&&b<=12&&a!==b)throw Error(`Ambiguous timestamp: ${value}; choose day/month/year or month/day/year`);
  const dmy=format==='dmy'||(format==='auto'&&a>12);
  parts=[+match[3],dmy?b:a,dmy?a:b,+(match[4]||0),+(match[5]||0),+(match[6]||0),0,null];
 }
 const [year,month,day,hour,minute,second,ms,zone]=parts;
 if(year<100||month<1||month>12||day<1||hour>23||minute>59||second>59)throw Error(`Invalid timestamp: ${value}`);
 const time=Date.UTC(year,month-1,day,hour,minute,second,ms),dt=new Date(time);
 if(dt.getUTCFullYear()!==year||dt.getUTCMonth()!==month-1||dt.getUTCDate()!==day)throw Error(`Invalid timestamp: ${value}`);
 if(!zone)return {time,timeKind:'wall'};
 let offset=0;
 if(zone.toUpperCase()!=='Z'){const z=zone.match(/^([+-])(\d{2}):?(\d{2})$/);if(+z[2]>23||+z[3]>59)throw Error(`Invalid timestamp offset: ${zone}`);offset=(+z[2]*60 + +z[3])*60000*(z[1]==='+'?1:-1);}
 return {time:time-offset,timeKind:'instant'};
}
export function detectDelimiter(text) {
 const counts={'\t':0,',':0,';':0};let quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){i++;continue;}quoted=!quoted;}else if(!quoted){if(c==='\n'||c==='\r')break;if(c in counts)counts[c]++;}}
 return Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]&&Math.max(...Object.values(counts))>0?Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0]:null;
}
export function parseInput(input,{source='Pasted input',timestampColumn='auto',timestampFormat='auto'}={}) {
 const text=String(input).replace(/^\ufeff/,'');if(!text.trim())throw Error('No input supplied');
 const first=text.split(/\r?\n/).find(s=>s.trim())||'';
 let records,structured=false;
 if(first.trim().startsWith('|')) {
  records=text.split(/\r?\n/).map((s,i)=>({cells:s.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(x=>x.trim()),line:i+1})).filter(r=>r.cells.some(Boolean)&&!r.cells.every(x=>/^:?-+:?$/.test(x)));
  structured=records[0].cells.some(x=>x==='data')||records[0].cells.length>1;
 } else {
  const delimiter=detectDelimiter(text);records=parseDelimited(text,delimiter||',');
  structured=!!delimiter||records[0]?.cells[0].trim()==='data';
  if(!structured)records=records.filter(r=>r.cells.some(c=>c.trim()));
 }
 let dataIndex=0,timeIndex=-1,headers=['data'];
 if(structured) {
  headers=records.shift().cells.map(x=>x.trim());
  const matches=headers.flatMap((x,i)=>x==='data'?[i]:[]);
  if(matches.length!==1)throw Error(matches.length?'Duplicate data headers: exactly one data column is required':'Missing data header: CSV/Excel tables require a column named data');
  dataIndex=matches[0];
  if(timestampColumn!=='none') {
   if(timestampColumn==='auto') {
    timeIndex=headers.findIndex(x=>/^(ts|timestamp|time|datetime|date|created_at|received_at)$/i.test(x));
    if(timeIndex<0) {
     const candidates=headers.flatMap((h,i)=>{if(i===dataIndex)return [];const vals=records.slice(0,10).map(r=>r.cells[i]).filter(Boolean);if(!vals.length)return [];try {return vals.every(v=>parseTimestamp(v,timestampFormat).time!==null)?[i]:[];}catch{return [];}});
     if(candidates.length===1)timeIndex=candidates[0];
    }
   } else {timeIndex=headers.indexOf(timestampColumn);if(timeIndex<0)throw Error(`Timestamp column not found: ${timestampColumn}`);}
  }
 }
 return records.map((rec,i)=>{
  const r={source,row:i+(structured?2:1),line:rec.line,column:'data',raw:rec.cells[dataIndex]??'',timestamp:timeIndex<0?'':rec.cells[timeIndex]??'',time:null,timeKind:null,error:null,timestampError:null};
  if(structured&&rec.cells.length!==headers.length)r.error=`Column count mismatch at line ${rec.line}: expected ${headers.length}, received ${rec.cells.length}`;
  try{Object.assign(r,parseTimestamp(r.timestamp,timestampFormat));}catch(e){r.timestampError=`Column ${headers[timeIndex]}: ${e.message}`;}
  r.timestampColumn=timeIndex<0?null:headers[timeIndex];return r;
 });
}
export function processInput(text,options={}) {
 return parseInput(text,options).map(r=>{if(!r.error){try{r.decoded=decode(r.raw,options);}catch(e){r.error=`Column data: ${e.message}`;}}return r;});
}
export function markDuplicates(rows) {
 const counts=new Map();for(const r of rows){if(r.decoded){const key=r.decoded.hex;counts.set(key,(counts.get(key)||0)+1);}}
 for(const r of rows)r.duplicate=!!r.decoded&&counts.get(r.decoded.hex)>1;
}
const safeCell=value=>{
 let s=String(value??'');
 if(typeof value!=='number'&&/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;
 return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
};
export function exportCSV(rows) {
 const fields=[...new Set(rows.flatMap(r=>Object.keys(r.decoded?.values||{})))];
 const headers=['Source','SourceRow','SourceLine','Timestamp','TimestampKind','RawPayload','PacketType',...fields.map(name=>{const unit=rows.find(r=>r.decoded?.units[name])?.decoded.units[name];return unit?`${name} (${unit})`:name;}),'MeasurementStatus','Flags','Warnings','Diagnostics','Error','TimestampError'];
 const lines=[headers.map(safeCell).join(',')];
 for(const r of rows){const d=r.decoded;lines.push([r.source,r.row,r.line,r.timestamp,r.timeKind,r.raw,d?(d.special?'special':`0x${d.type.toString(16)}`):'',...fields.map(k=>d?.values[k]??''),d?.status,d?.flags.join('; '),d?.warnings.join('; '),d?.diagnostics.join('; '),r.error,r.timestampError].map(safeCell).join(','));}
 return '\ufeff'+lines.join('\r\n');
}

export const DATA_GROUPS = {
 battery:['Battery life',name=>name==='BatteryLeft'],
 acceleration:['Acceleration',name=>name.includes('Acceleration')],
 velocity:['Velocity',name=>name.includes('Velocity')],
 temperature:['Temperature',name=>name.includes('Temperature')],
 pressure:['Pressure',name=>name==='Pressure'],
 health:['Health / radio',name=>['Uptime','BatteryLeft','rssi','per','snr'].includes(name)],
 diagnostics:['Diagnostics',name=>name.startsWith('Diagnostic')],
 location:['Location',name=>/Longitude|Latitude|Altitude/.test(name)],
 trap:['Trap condition',name=>name.startsWith('TrapCondition')],
 equipment:['Equipment',name=>['VendorID','DeviceType','DeviceRevision'].includes(name)],
 initialization:['Initialization',name=>name==='TagName'],
 special:['Special messages',name=>name==='SpecialMessage'],
 reporting:['Reporting interval',name=>name==='TransmissionInterval']
};
export function matchesDataKind(row,kind='all') {
 if(kind==='all')return true;
 if(!row.decoded)return false;
 const [mode,value]=kind.split(':');
 if(mode==='type')return row.decoded.type===Number(value);
 const names=Object.keys(row.decoded.values);
 return mode==='field'?names.includes(value):mode==='group'&&!!DATA_GROUPS[value]&&names.some(DATA_GROUPS[value][1]);
}
export function filterRows(rows,{status='all',kind='all',query=''}={}) {
 const search=query.trim().toLowerCase();
 if(status==='all'&&kind==='all'&&!search)return rows;
 return rows.filter(row=>{
  const d=row.decoded;
  if(status==='issues'&&!(row.error||row.timestampError||d?.flags.length||d?.warnings.length))return false;
  if(status==='duplicates'&&!row.duplicate)return false;
  if(!matchesDataKind(row,kind))return false;
  if(!search)return true;
  return [row.raw,row.source,row.row,row.timestamp,row.error,row.timestampError,d?.label,d?(d.special?'special':`0x${d.type.toString(16)}`):'',...Object.entries(d?.values||{}).map(([name,value])=>`${name} ${String(value)}`),...(d?.flags||[]),...(d?.warnings||[]),...(d?.diagnostics||[])].join(' ').toLowerCase().includes(search);
 });
}
export function pageNumbers(total,current) {
 if(!total)return [];
 const page=Math.max(1,Math.min(total,current+1));
 const values=[...new Set([1,total,...Array.from({length:5},(_,i)=>page+i-2).filter(p=>p>=1&&p<=total)])].sort((a,b)=>a-b),result=[];
 for(const value of values){if(result.length&&value-result.at(-1)>1)result.push(null);result.push(value);}
 return result;
}
