import {decode} from './decoder.js';
const measurementTypes={XS770A:[0x10,0x11,0x12,0x13],XS530:[0x30,0x31],XS550:[0x20,0x21],XS822:[0x8000,0x8001],XS540:[0x51,0x52,0x53,0x54,0x55,0x56,0x57,0x58]};
const fromHex=text=>Uint8Array.from(text.match(/../g)||[],part=>parseInt(part,16));
export function decodeApplicationCandidate(payload,options={}) {
 const decoded=decode(payload,{encoding:'base64',model:options.model,profile:options.profile});
 if(decoded.reservedStatusBits)throw Error('Reserved sensor status bits are set; candidate may have the wrong key/counter or an unsupported format');
 const selectedTypes=measurementTypes[options.model],isMeasurement=Object.values(measurementTypes).some(types=>types.includes(decoded.type));
 if(selectedTypes&&isMeasurement&&!selectedTypes.includes(decoded.type))throw Error('Decrypted measurement type does not match the selected sensor model');
 return decoded;
}
export async function decryptRadioFrames(rows,options={}) {
 const secret=options.appSKey?.trim().replace(/\s/g,'');delete options.appSKey;
 if(!secret)return rows;
 if(!/^[a-fA-F0-9]{32}$/.test(secret))throw Error('AppSKey must contain 32 hexadecimal digits');
 const address=options.deviceAddress?.trim().replace(/^0x/i,'').toUpperCase();
 if(!/^[A-F0-9]{8}$/.test(address||''))throw Error('A target device address of 8 hexadecimal digits is required');
 const high=options.counterHigh??0;
 if(!Number.isInteger(high)||high<0||high>65535)throw Error('Frame-counter high bits must be an integer from 0 to 65535');
 if(!globalThis.crypto?.subtle)throw Error('Local decryption requires HTTPS or localhost with Web Crypto');
 const rawKey=fromHex(secret),key=await crypto.subtle.importKey('raw',rawKey,'AES-CBC',false,['encrypt']);rawKey.fill(0);
 for(const row of rows){
  const envelope=row.decoded;
  if(row.error||!envelope?.radioFrame||!envelope.encrypted)continue;
  if(envelope.values.LoRaWANFPort===0){envelope.values.LoRaWANPayloadStatus='Encrypted MAC commands: FPort 0 requires a network key; AppSKey is not used';envelope.warnings.push('AppSKey decryption skipped: FPort 0 uses a network key');continue;}
  if(envelope.values.LoRaWANDeviceAddress!==address){if(envelope.values.LoRaWANDeviceAddress)envelope.values.LoRaWANPayloadStatus=`Encrypted: device ${envelope.values.LoRaWANDeviceAddress} is outside selected target ${address}; key not applied`;continue;}
  if(envelope.values.LoRaWANFPort>223){envelope.warnings.push('AppSKey decryption skipped for reserved/test port');continue;}
  const cipher=fromHex(envelope.values.LoRaWANEncryptedPayload||''),frame=fromHex(envelope.hex.replaceAll(' ','')),counter=high*65536+envelope.values.LoRaWANFCnt16;
  const plain=new Uint8Array(cipher.length),direction=[0x60,0xa0].includes(envelope.type)?1:0;
  for(let offset=0;offset<cipher.length;offset+=16){
   const block=new Uint8Array(16);block[0]=1;block[5]=direction;block.set(frame.slice(1,5),6);new DataView(block.buffer).setUint32(10,counter,true);block[15]=offset/16+1;
   // The first CBC block with a zero IV equals AES(block); discard the padding block.
   const stream=new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv:new Uint8Array(16)},key,block));
   for(let i=0;i<Math.min(16,cipher.length-offset);i++)plain[offset+i]=cipher[offset+i]^stream[i];
  }
  const plaintextBase64=btoa(String.fromCharCode(...plain));
  row.decryption={status:'plaintext_not_recognized',address,counter,authenticated:false,plaintextBase64};
  if(direction===1){row.decryption.status='downlink_plaintext';envelope.values.LoRaWANPayloadStatus='Decrypted downlink bytes (MIC unverified); not sensor readings';envelope.diagnostics.push('Decrypted downlink application bytes (base64): '+plaintextBase64);plain.fill(0);continue;}
  try{
   const decoded=decodeApplicationCandidate(plaintextBase64,options);
   decoded.warnings.push('Decrypted with supplied AppSKey; MIC not verified. Counter high bits are user-supplied; wrong keys/counters can produce misleading values.');
   row.radioEnvelope=envelope;row.decoded=decoded;row.decryption.status='decoded_unverified';
  }catch(error){row.decryption.status='plaintext_rejected';row.decryption.reason=error.message;envelope.values.LoRaWANPayloadStatus='Decryption candidate not accepted; confirm key, counter, session and model';envelope.warnings.push('Candidate rejection: '+error.message);}
  plain.fill(0);
 }
 return rows;
}
