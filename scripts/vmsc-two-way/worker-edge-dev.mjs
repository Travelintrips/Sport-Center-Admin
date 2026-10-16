// Dedicated Supabase CST-DEV Edge Function worker. Physical read only; no writes to X904.
import {readDevice} from "./device-readonly.mjs";
const endpoint="https://xssrfshdrtdfupgqwfdw.supabase.co/functions/v1/x904-vmsc-commands-dev/";
const secret=process.env.X904_VMSC_WORKER_TOKEN_DEV;
if(!secret||secret.length<32||process.env.X904_VMSC_PHYSICAL_READ_DEV!=="true")throw Error("DEV_CONFIG_NOT_READY");
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
async function call(path,payload) {
 const res=await fetch(endpoint+path,{method:"POST",headers:{"content-type":"application/json","x-vmsc-worker-token":secret},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
 const output=await res.json().catch(()=>({}));
 if(!res.ok)throw Error("DEV_API_HTTP_"+res.status);
 return output;
}
async function one(){
 const {job}=await call("claim",{});
 if(!job)return console.log("NO_DEV_JOB");
 if(job.command_type!=="device_info")throw Error("UNSUPPORTED_DEV_COMMAND");
 let status="completed",result=null,errorCode=null;
 try {result=await readDevice(job.command_type);}
 catch(e){status="failed";errorCode=String(e?.message||"DEVICE_READ_FAILURE").slice(0,80);}
 const payload={id:job.id,claimToken:job.claimToken,status,result,errorCode};
 let ack;
 for(let attempt=0;attempt<4;attempt++){
  try {ack=await call("result",payload);break;}
  catch(e){if(attempt===3)throw e;await pause(1000*(attempt+1));}
 }
 if(ack?.ack!=="RESULT_VERIFIED")throw Error("RESULT_ACK_NOT_VERIFIED");
 const receipt=await call("receipt",{id:job.id});
 if(!receipt.receipt?.verified||receipt.receipt.status!==status)throw Error("PERSISTENT_RECEIPT_MISSING");
 console.log("PHYSICAL_DEV_ACK_VERIFIED",job.id,status,result?.adapter??"no-adapter");
}
if(process.argv.includes("--once"))await one(); else while(true){try{await one()}catch(e){console.error("DEV_WORKER_ERROR",e.message)}await pause(15000)}
