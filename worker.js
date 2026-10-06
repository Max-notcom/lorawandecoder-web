import {processInput,markDuplicates,exportCSV} from './data.js';
self.onmessage=({data})=>{
 try {
  if(data.action==='export'){self.postMessage({id:data.id,csv:exportCSV(data.rows)});return;}
  const rows=processInput(data.text,data.options);markDuplicates(rows);self.postMessage({id:data.id,rows});
 }catch(e){self.postMessage({id:data.id,error:e.message});}
};
