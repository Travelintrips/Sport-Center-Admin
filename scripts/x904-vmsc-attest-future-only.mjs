import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE="C:/SportCenter-X904-Gateway";
const RAW=BASE+"/state/raw-hex/x904-next-events.local.json";
const CURSOR=BASE+"/state/x904-attest-future-only.json";
const SERIAL="TDBD234200545";
const ENDPOINT="https://sc.travelintrips.co.id/api/internal/gym-x904/vmsc/attest";
const methods=new Set([1,4,15]);
export function decodePackedTime(packed) {
  let n=packed;
  const sec=n%60;n=(n-sec)/60;
  const min=n%60;n=(n-min)/60;
  const hour=n%24;n=(n-hour)/24;
  const day=n%31+1;n=(n-(day-1))/31;
  const month=n%12;n=(n-month)/12;
  const year=n+2000;
  const dt=new Date(Date.UTC(year,month,day,hour,min,sec));
  if(year<2020||year>2100||dt.getUTCFullYear()!==year||dt.getUTCMonth()!==month||dt.getUTCDate()!==day)return null;
  const pad=v=>String(v).padStart(2,"0");
  return String(year)+"-"+pad(month+1)+"-"+pad(day)+" "+pad(hour)+":"+pad(min)+":"+pad(sec);
}
export function parseAttestableRecord(row,nowMs,cutoverMs) {
  if(!row||!Number.isSafeInteger(row.index)||row.index<0||typeof row.hex!=="string"||
     !/^[a-f0-9]{80}$/.test(row.hex))return null;
  const b=Buffer.from(row.hex,"hex");
  if(b.readUInt16LE(0)!==row.index+1)return null;
  const pin=b.subarray(2,11).toString("ascii").split("\0")[0];
  if(!/^\d{1,9}$/.test(pin))return null;
  const method=b.readUInt8(26),punch=b.readUInt8(31);
  if(!methods.has(method)||![0,255].includes(punch))return null;
  const occurred=decodePackedTime(b.readUInt32LE(27));
  if(!occurred)return null;
  const at=Date.parse(occurred.replace(" ","T")+"+07:00");
  if(!Number.isFinite(at)||at<=cutoverMs||at>nowMs+120000||nowMs-at>15*60000)return null;
  const today=new Date(nowMs+7*3600000).toISOString().slice(0,10);
  if(occurred.slice(0,10)!==today)return null;
  return {index:row.index,pin,occurred,rawHex:row.hex};
}
export function signAttestation(row,key,issuedAt) {
  const body={serial:SERIAL,index:row.index,pin:row.pin,occurred:row.occurred,
    rawHex:row.rawHex,issuedAt,readAuthenticated:true};
  const canonical=[SERIAL,body.index,body.pin,body.occurred,body.rawHex,body.issuedAt,"true"].join("|");
  return {body,signature:createHmac("sha256",key).update(canonical).digest("hex")};
}
function freshRead(cfg) {
  return new Promise((resolve,reject)=>{
    const child=spawn("C:/Program Files/nodejs/node.exe",
      [BASE+"/migration/x904-new-events-local-collector.mjs","--dry-run"],
      {cwd:BASE,stdio:["pipe","pipe","pipe"],windowsHide:true});
    let stdout="";
    child.stdout.on("data",b=>{stdout+=b.toString();if(stdout.length>12000)child.kill();});
    child.stderr.on("data",()=>{});
    child.on("error",reject);
    child.on("close",c=>{
      if(c!==0||!stdout.includes("read_authenticated=true")||
         !stdout.includes("LOCAL_ONLY_NO_DATABASE_WRITE=true"))return reject(Error("AUTHENTICATED_READ_FAILED"));
      resolve(stdout);
    });
    child.stdin.end(JSON.stringify({target:"PROD",deviceIp:"192.168.100.185",commKey:cfg.commKey}));
  });
}
async function cursor() {
  try {
    const c=JSON.parse(await readFile(CURSOR,"utf8"));
    if(Number.isFinite(c.cutoverMs)&&c.cutoverMs>0&&Array.isArray(c.sent))return c;
  }catch{}
  const c={cutoverMs:Date.now(),sent:[]};
  await writeFile(CURSOR+".tmp",JSON.stringify(c));
  await rename(CURSOR+".tmp",CURSOR);
  return c;
}
export async function run() {
  if(process.env.X904_ATTEST_SEND_ENABLED!=="true") {
    console.log("ATTEST_DISABLED_NO_DEVICE_READ");return;
  }
  const config=JSON.parse(await new Promise((resolve,reject)=>{
    let s="";process.stdin.setEncoding("utf8");
    process.stdin.on("data",chunk=>{s+=chunk;if(s.length>4096)reject(Error("CONFIG_TOO_LARGE"));});
    process.stdin.on("end",()=>resolve(s));
  }));
  if(config?.target!=="PROD"||!/^\d{1,10}$/.test(String(config.commKey??""))||
     typeof config.attestKey!=="string"||config.attestKey.length<32||
     config.endpoint!==ENDPOINT)throw Error("CONFIG_NOT_READY");
  const c=await cursor();
  const output=await freshRead(config);
  const count=Number(/device_log_count=(\d+)/.exec(output)?.[1]??-1);
  if(!Number.isSafeInteger(count)||count<1)throw Error("DEVICE_COUNT_UNAVAILABLE");
  const rows=JSON.parse(await readFile(RAW,"utf8"));
  if(!Array.isArray(rows)||rows.length>1000000)throw Error("CAPTURE_INVALID");
  const seen=new Set(c.sent);
  const now=Date.now();
  const eligible=rows.map(r=>parseAttestableRecord(r,now,c.cutoverMs))
    .filter(r=>r&&r.index<count&&!seen.has(r.index)).slice(0,10);
  if(!eligible.length){console.log("NO_NEW_ELIGIBLE_SIGNED_RECORDS");return;}
  for(const row of eligible) {
    const proof=signAttestation(row,config.attestKey,new Date().toISOString());
    const response=await fetch(ENDPOINT,{method:"POST",redirect:"error",
      headers:{"content-type":"application/json","x-gym-vmsc-signature":proof.signature},
      body:JSON.stringify(proof.body),signal:AbortSignal.timeout(12000)});
    if(!response.ok){console.log("ATTEST_REJECTED_STATUS="+response.status);break;}
    const body=await response.json();
    if(body?.ok!==true||body?.accepted!==1){console.log("ATTEST_ACK_INVALID");break;}
    c.sent.push(row.index);c.sent=c.sent.slice(-300);
    await writeFile(CURSOR+".next",JSON.stringify(c));
    await rename(CURSOR+".next",CURSOR);
    console.log("ATTEST_ACK_PASS_INDEX="+row.index);
  }
}
if(process.argv[1] && fileURLToPath(import.meta.url).toLowerCase()===process.argv[1].toLowerCase()) {
  run().catch(e=>{console.error("ATTEST_FAIL="+String(e?.message||"UNKNOWN").replace(/[^A-Z0-9_]/g,""));process.exitCode=1;});
}