import {processInput,markDuplicates,exportCSV} from './data.js';
import {decryptRadioFrames} from './lorawan-crypto.js';
self.onmessage=async({data})=>{
 try {
  if(data.action==='export'){self.postMessage({id:data.id,csv:exportCSV(data.rows)});return;}
  const rows=processInput(data.text,data.options);if(data.options?.format==='lorawan')await decryptRadioFrames(rows,data.options);markDuplicates(rows);self.postMessage({id:data.id,rows});
 }catch(e){self.postMessage({id:data.id,error:e.message});}
};
