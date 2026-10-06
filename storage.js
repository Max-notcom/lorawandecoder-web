const openDB=()=>new Promise((resolve,reject)=>{
 const request=indexedDB.open('payload-decoder',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('session');
 request.onsuccess=()=>resolve(request.result);
 request.onerror=()=>reject(request.error);
 request.onblocked=()=>reject(Error('Local storage is blocked by another open tab'));
});
async function transaction(mode,action){
 const db=await openDB();
 try{return await new Promise((resolve,reject)=>{const tx=db.transaction('session',mode),req=action(tx.objectStore('session'));let result;req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error('Storage transaction cancelled'));tx.onerror=()=>reject(tx.error);});}
 finally{db.close();}
}
export const saveDataset=dataset=>transaction('readwrite',store=>store.put({version:1,...dataset},'latest'));
export const loadDataset=async()=>{const value=await transaction('readonly',store=>store.get('latest'));if(value&&(!Array.isArray(value.rows)||value.version!==1||value.rows.some(r=>typeof r.raw!=='string'||!Number.isInteger(r.row))))throw Error('Saved dataset is invalid; clear it and import again');return value;};
export const clearDataset=()=>transaction('readwrite',store=>store.delete('latest'));
