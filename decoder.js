// Chapter 7 packet layouts. Multi-byte readings are big-endian, as verified by supplied samples.
export const MODELS = ['Unknown','XS770A','XS530','XS550','XS822','XS540'];
export function float16(bits) {
  const sign = bits & 0x8000 ? -1 : 1, exponent = bits >> 10 & 31, fraction = bits & 1023;
  return exponent === 31 ? (fraction ? NaN : sign * Infinity) : sign * (exponent ? 2 ** (exponent - 15) * (1 + fraction / 1024) : 2 ** -14 * fraction / 1024);
}
const statusCommon = {31:'Failure',30:'Function check',29:'Out of specification',28:'Maintenance required',27:'Electronics fault',26:'Sensor or actuator fault',24:'OFF mode',23:'Outside sensor limits',22:'Environmental conditions outside specification',21:'Maintenance required',19:'Battery low',17:'Simulation active',13:'Network settings missing',12:'Unable to connect to gateway'};
const detailCommon = {31:'CPU failure',30:'Battery low',29:'Ambient temperature above limit',28:'Ambient temperature below limit',25:'Radio module memory failure',24:'Measurement module memory failure',23:'Network settings missing',22:'Unable to connect to gateway',21:'Measurement module not connected',20:'Software not found',19:'Firmware update required',18:'Diagnostic simulation',17:'Measurement simulation',16:'OFF mode',14:'Measurement module hardware failure'};
const diagnosticMaps = {
 XS770A: [{31:'Failure',30:'Function check',29:'Out of specification',28:'Maintenance required',27:'Electronics fault',26:'Sensor or actuator fault',25:'Installation problem',24:'Out of service',23:'Outside sensor limits',22:'Environmental conditions outside specification',21:'Maintenance required',20:'Battery critically low',19:'Battery low',17:'Simulation active',0:'Detail information available'}, {31:'Voltage low',30:'Battery low',29:'Temperature high',28:'Temperature low',25:'Vibration sensor electrical failure',24:'Temperature sensor electrical failure',23:'Sensor not provisioned',22:'Sensor not joined',21:'Vibration sensor overflow',20:'Temperature sensor overflow',19:'Memory failure',18:'Out of service (reserved for future use)',17:'Simulation mode',16:'OFF mode'}],
 XS530: [{...statusCommon,11:'Firmware update required'}, {...detailCommon,13:'Sensor failure',10:'Pressure outside specification',4:'Temperature outside specification'}],
 XS550: [{...statusCommon,11:'Firmware update required'}, {...detailCommon,13:'Reference junction sensor failure',12:'Reference junction temperature outside specification',11:'Sensor 1 failure',10:'Sensor 1 temperature outside specification',5:'Sensor 2 failure',4:'Sensor 2 temperature outside specification'}],
 XS822: [{...statusCommon,11:'Firmware update required'}, {...detailCommon,4:'Temperature outside specification'}],
 XS540: [{...statusCommon}, {...detailCommon}]
};
delete diagnosticMaps.XS540[1][19];
for (let channel=1; channel<=4; channel++) {
 const bit = 12 - (channel-1)*3;
 diagnosticMaps.XS540[1][bit]=`Sensor ${channel} failure`;
 diagnosticMaps.XS540[1][bit-1]=`Sensor ${channel} vibration outside specification`;
 diagnosticMaps.XS540[1][bit-2]=`Sensor ${channel} temperature outside specification`;
}
function describeBits(word,map,label) {
 const result=[];
 for(let bit=31;bit>=0;bit--) if((word>>>bit)&1) result.push(`${label} bit ${bit}: ${map[bit] || `Unknown ${label.toLowerCase()} bit ${bit}`}`);
 return result;
}
function bytesFrom(text,encoding) {
 const value=text.trim();
 if(!value) throw Error('Missing payload');
 if(encoding==='hex') {
  const clean=value.replace(/^0x/i,'').replace(/\s/g,'');
  if(!/^[\da-f]+$/i.test(clean)) throw Error('Invalid hexadecimal character');
  if(clean.length%2) throw Error('Hexadecimal requires an even number of digits');
  return Uint8Array.from(clean.match(/../g),x=>parseInt(x,16));
 }
 const clean=value.replace(/\s/g,'');
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)||clean.length%4===1||(/=/.test(clean)&&clean.length%4!==0)) throw Error('Invalid Base64 alphabet, padding, or length');
 let decoded;
 try {decoded=atob(clean);} catch {throw Error('Invalid Base64 encoding');}
 if(btoa(decoded).replace(/=+$/,'')!==clean.replace(/=+$/,'')) throw Error('Invalid Base64 trailing bits');
 return Uint8Array.from(decoded,c=>c.charCodeAt(0));
}
export function decode(payload,{encoding='auto',model='Unknown'}={}) {
 if(typeof payload!=='string') throw Error('Payload must be text');
 if(!['auto','hex','base64'].includes(encoding)) throw Error('Unknown encoding');
 if(encoding==='auto') {
  const candidates=[]; const errors=[];
  for(const mode of ['hex','base64']) {try {candidates.push(decode(payload,{encoding:mode,model}));}catch(e){errors.push(e.message);}}
  if(candidates.length===2) throw Error('Ambiguous encoding: choose Hex or Base64');
  if(candidates.length===1) return candidates[0];
  if(!payload.trim()) throw Error('Missing payload');
  throw Error(`Cannot decode payload. Hex: ${errors[0]}. Base64: ${errors[1]}`);
 }
 const b=bytesFrom(payload,encoding), d=new DataView(b.buffer);
 const type=b[0]===0x80 && b.length>=2?d.getUint16(0):b[0];
 const r={type,label:'',hex:Array.from(b,x=>x.toString(16).padStart(2,'0')).join(' '),encoding,values:{},units:{},status:null,flags:[],invalidFields:[],overrangeFields:[],diagnostics:[],warnings:[]};
 const length=n=>{if(b.length!==n)throw Error(`Packet 0x${type.toString(16)} length: expected ${n} bytes, received ${b.length}`);};
 const add=(name,value,unit='')=>{r.values[name]=value;r.units[name]=unit;if(typeof value==='number'&&!Number.isFinite(value)){r.warnings.push(`${name}: nonfinite value (${String(value)})`);r.invalidFields.push(name);}};
 const measured=(fields,trap=false,shared=false)=>{
  r.status=d.getUint16(trap?2:1);
  let known=0x100|(trap?0:7); r.measurementCount=trap?null:r.status&7;
  fields.forEach((name,i)=>{
   const err=shared?15:15-i,over=shared?12:12-i;
   known|=(1<<err)|(1<<over);
   if(r.status&(1<<err)){r.flags.push(`${name}: measurement error`);r.invalidFields.push(name);}
   if(r.status&(1<<over)){r.flags.push(`${name}: overrange`);r.overrangeFields.push(name);}
  });
  if(r.status&0x100)r.flags.push('Simulation mode');
  const unknown=r.status & ~known & 0xffff;
  if(unknown)r.warnings.push(`Reserved status bits set: 0x${unknown.toString(16).padStart(4,'0')}`);
 };
 if(type>=0x10&&type<=0x13) {
  const axis=['Z','XYZ','X','Y'][type-0x10]; const n=type<=0x11?3:2;
  length(n===3?9:7);r.label=`${axis} vibration`;
  const fields=['Acceleration','Velocity','Temperature'].slice(0,n).map(x=>axis+x);
  fields.forEach((name,i)=>add(name,float16(d.getUint16(3+i*2)),['m/s²','mm/s','°C'][i]));measured(fields);
 } else if([0x20,0x21,0x30,0x31].includes(type)) {
  length(7); const name={32:'Temperature1',33:'Temperature2',48:'Pressure',49:'Temperature3'}[type];r.label=name;
  add(name,d.getFloat32(3),type===0x30?'MPa':'°C');measured([name]);
 } else if(type>=0x51&&type<=0x58) {
  length(9);const ch=Math.floor((type-0x51)/2)+1,extended=type%2===0;
  r.label=`Channel ${ch} ${extended?'extended':'basic'} vibration`;
  const names=extended?['AccelerationRMS','AccelerationCF','VelocityPeak']:['AccelerationPeak','VelocityRMS','Temperature'];
  const units=extended?['m/s²','ratio','mm/s']:['m/s²','mm/s','°C'];
  const fields=names.map(x=>`CH${ch}${x}`);
  fields.forEach((name,i)=>add(name,float16(d.getUint16(3+i*2)),units[i]));measured(fields,false,true);
 } else if(type===0x8000||type===0x8001) {
  length(8);r.label=type===0x8000?'Trap condition':'Trap temperature';
  const field=type===0x8000?'TrapCondition':'TrapTemperature';
  add(field,type===0x8000?d.getUint32(4):d.getFloat32(4),type===0x8000?'state':'°C');measured([field],true,true);
  if(type===0x8000){if(r.values[field]>4)throw Error('Invalid trap condition: expected 0–4');r.values.TrapConditionText=['Unmeasured','Good','Cold','Blow through','Measuring'][r.values[field]];}
 } else if(type===0x40) {
  length(8);r.label='Health report';
  add('Uptime',b[1]*65536+b[2]*256+b[3],'min');add('BatteryLeft',b[4]/2,'%');
  // Manual defines unsigned RSSI magnitude handled as negative; SNR is UINT8 / 4.
  add('rssi',-b[5],'dBm');add('per',b[6],'%');add('snr',b[7]/4,'dB');
  if(b[4]>200)r.warnings.push('Battery value exceeds 100%');if(b[6]>100)r.warnings.push('Packet error rate exceeds 100%');
 } else if(type===0x41) {
  length(9);r.label='Diagnostics';add('DiagnosticStatus',d.getUint32(1));add('DiagnosticDetail',d.getUint32(5));
  const maps=diagnosticMaps[model]||[{31:'Failure',30:'Function check',29:'Out of specification',28:'Maintenance required'},{}];
  r.diagnostics=[...describeBits(r.values.DiagnosticStatus,maps[0],'Status'),...describeBits(r.values.DiagnosticDetail,maps[1],'Detail')];
  if(!r.diagnostics.length)r.diagnostics.push('No diagnostic bits set');
  if(!diagnosticMaps[model])r.warnings.push('Select a sensor model to interpret model-specific diagnostic bits');
 } else if(type===0x42) {
  length(11);r.label='Initialization';const chars=b.slice(1);if(chars.some(x=>x>127))throw Error('Tag name contains non-ASCII bytes');
  const end=chars.indexOf(0);add('TagName',String.fromCharCode(...(end<0?chars:chars.slice(0,end))));
 } else if(type===0x43) {
  length(9);r.label='GPS';add('Longitude',d.getFloat32(1),'° longitude');add('Latitude',d.getFloat32(5),'° latitude');
 } else if(type>=0x44&&type<=0x46) {
  length(9);r.label='Precise GPS';const name=['AccurateLongitude','AccurateLatitude','AccurateAltitude'][type-0x44];add(name,d.getFloat64(1),['° longitude','° latitude','m'][type-0x44]);
 } else if(type===0x47) {
  length(9);r.label='Equipment';add('VendorID',d.getUint32(1));add('DeviceType',d.getUint16(5));add('DeviceRevision',d.getUint16(7));
 } else throw Error(`Unsupported packet type 0x${(type??0).toString(16)}`);
 for(const [name,value] of Object.entries(r.values))if(/Longitude|Latitude/.test(name)&&Number.isFinite(value)&&Math.abs(value)>(name.includes('Longitude')?180:90)){r.warnings.push(`${name}: coordinate outside valid range`);r.invalidFields.push(name);}
 return r;
}
export function isChartable(name,value) {return typeof value==='number'&&!['DiagnosticStatus','DiagnosticDetail','VendorID','DeviceType','DeviceRevision'].includes(name);}
export function convertValue(value,unit,{temperature='native',pressure='native'}={}) {
 if(unit==='°C'&&temperature==='fahrenheit')return [value*9/5+32,'°F'];
 if(unit==='MPa'&&pressure!=='native')return [value*(pressure==='bar'?10:145.03773773020923),pressure==='bar'?'bar':'psi'];
 return [value,unit];
}
