import {decode} from './decoder.js';
const fromHex=text=>Uint8Array.from(text.match(/../g)||[],part=>parseInt(part,16));
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
  if(row.error||!envelope?.radioFrame||envelope.values.LoRaWANDeviceAddress!==address||!envelope.encrypted)continue;
  if(envelope.values.LoRaWANFPort===0){envelope.warnings.push('AppSKey decryption skipped: FPort 0 uses a network key');continue;}
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
   const decoded=decode(plaintextBase64,{encoding:'base64',model:options.model,profile:options.profile});
   decoded.warnings.push('Decrypted with supplied AppSKey; MIC not verified. Counter high bits are user-supplied; wrong keys/counters can produce misleading values.');
   row.radioEnvelope=envelope;row.decoded=decoded;row.decryption.status='decoded_unverified';
  }catch{envelope.warnings.push('Key/counter produced unrecognized application bytes; confirm AppSKey, target address and session counter.');}
  plain.fill(0);
 }
 return rows;
}
