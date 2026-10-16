// DEV-only VMSC worker: reads non-sensitive metadata from a pluggable local adapter.
// Default adapter is a safe simulator; no writes to the X904 device.
const base=process.env.X904_VMSC_DEV_API_URL;
const token=process.env.X904_VMSC_WORKER_TOKEN_DEV;
if(!base||!token||token.length<32||!/^https:\/\//.test(base)) throw Error('DEV_API_CONFIG_REQUIRED');
const root=base.replace(/\/$/,'');
if(!root.endsWith('/api')) throw Error('DEV_API_BASE_MUST_END_IN_API');
const headers={'content-type':'application/json','x-vmsc-worker-token':token};
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function post(path,body){
 const res=await fetch(root+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 if(!res.ok) throw Error('API_HTTP_'+res.status);
 return res.json();
}
async function execute(command){
 if(command==='device_info') return {adapter:'simulated',model:'DEV-MOCK-X904',readOnly:true};
 if(command==='clock_read') return {adapter:'simulated',clock:new Date().toISOString(),readOnly:true};
 throw Error('COMMAND_NOT_ALLOWED');
}
async function once(){
 const {job}=await post('/internal/dev/x904-vmsc/claim',{});
 if(!job)return;
 let payload;
 try {payload={id:job.id,claimToken:job.claimToken,status:'completed',result:await execute(job.command_type)};}
 catch {payload={id:job.id,claimToken:job.claimToken,status:'failed',errorCode:'DEVICE_READ_FAILED'};}
 let ack;
 for(let attempt=0;attempt<4;attempt++){
   try {ack=await post('/internal/dev/x904-vmsc/result',payload);break;}
   catch(error){if(attempt===3)throw error;await sleep(1000*(attempt+1));}
 }
 if(ack?.ack!=='RESULT_VERIFIED')throw Error('RESULT_ACK_MISSING');
 const response=await fetch(root+'/internal/dev/x904-vmsc/receipt/'+encodeURIComponent(job.id),{headers,signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('RECEIPT_HTTP_'+response.status);
 const receipt=await response.json();
 if(receipt.receipt?.verified!==true||receipt.receipt?.status!==payload.status)throw Error('SERVER_RECEIPT_NOT_VERIFIED');
 console.log('E2E_ACK_VERIFIED',job.id);
}
for(;;){try{await once()}catch(e){console.error('DEV_WORKER_CHECK_FAILED',e.message)}await sleep(15000)}
