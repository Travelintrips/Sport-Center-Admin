// Live database-backed integration test for isolated CST-DEV only.
// This starts an ephemeral localhost API and an explicitly simulated VMSC worker.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import express from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import router from "../routes/x904VmscTwoWayDev";

if(process.env.NODE_ENV === "production" || process.env.APP_ENV !== "development")
  throw Error("DEV_ENV_REQUIRED");
if(!process.env.SUPABASE_DATABASE_URL_DEV?.includes("xssrfshdrtdfupgqwfdw"))
  throw Error("ISOLATED_CST_DEV_DATABASE_REQUIRED");
if(process.env.SUPABASE_DATABASE_URL && process.env.SUPABASE_DATABASE_URL === process.env.SUPABASE_DATABASE_URL_DEV)
  throw Error("DEV_PROD_DATABASE_MUST_DIFFER");

process.env.X904_VMSC_COMMANDS_DEV_ENABLED="true";
const secret=randomBytes(32).toString("hex");
process.env.X904_VMSC_WORKER_TOKEN_DEV=secret;
const ids:string[]=[];
const headers={"content-type":"application/json","x-vmsc-worker-token":secret};
let server:any;
let base="";
async function listen(){
 const app=express();
 app.use(express.json({limit:"8kb"}));
 app.use("/api",router);
 server=await new Promise<any>((resolve,reject)=>{
   const s=app.listen(0,"127.0.0.1",()=>resolve(s));
   s.on("error",reject);
 });
 base="http://127.0.0.1:"+server.address().port+"/api";
}
async function close(){
 if(server){await new Promise<void>((resolve,reject)=>server.close((e:any)=>e?reject(e):resolve()));server=null;}
}
async function request(path:string,payload?:unknown,auth=true){
 const res=await fetch(base+path,{method:payload===undefined?"GET":"POST",
   headers:auth?headers:{"content-type":"application/json"},
   body:payload===undefined?undefined:JSON.stringify(payload)});
 const text=await res.text();
 return {status:res.status,body:JSON.parse(text)};
}
async function queue(type:string,expiry="5 minutes"){
 const id=randomUUID();ids.push(id);
 await db.execute(sql`INSERT INTO sport_center.x904_vmsc_commands
 (id,device_id,command_type,status,expires_at)
 VALUES (${id}::uuid,'VMSC',${type},'queued',now()+${expiry}::interval)`);
 return id;
}
async function workerOnce(){
 await new Promise<void>((resolve,reject)=>{
   const child=spawn(process.execPath,["scripts/vmsc-two-way/worker-dev.mjs","--once"],{
     cwd:process.cwd(),env:{...process.env,X904_VMSC_DEV_API_URL:base,X904_VMSC_WORKER_TOKEN_DEV:secret},
     stdio:["ignore","pipe","pipe"]});
   let stdout="",stderr="";
   child.stdout.on("data",(x)=>stdout+=String(x));
   child.stderr.on("data",(x)=>stderr+=String(x));
   child.on("error",reject);
   child.on("exit",(code)=>code===0&&stdout.includes("E2E_ACK_VERIFIED")?resolve():
       reject(Error("WORKER_FAILED "+code+" "+stderr.slice(0,500))));
 });
}
try {
 await listen();
 assert.equal((await request("/internal/dev/x904-vmsc/claim",{},false)).status,403,"unauthenticated");
 const id=await queue("device_info");
 await workerOnce();
 const first=await request("/internal/dev/x904-vmsc/receipt/"+id);
 assert.equal(first.body.receipt?.status,"completed");
 assert.equal(first.body.receipt?.verified,true);
 const stored=await db.execute(sql`SELECT result_json FROM sport_center.x904_vmsc_commands WHERE id=${id}::uuid`);
 assert.equal((stored.rows[0]?.result_json as any)?.adapter,"simulated");
 assert.equal((await request("/internal/dev/x904-vmsc/claim",{})).body.job,null,"no duplicate claims");
 await close();await listen();
 const afterRestart=await request("/internal/dev/x904-vmsc/receipt/"+id);
 assert.equal(afterRestart.body.receipt?.verified,true,"persistent receipt after restart");
 const second=await queue("clock_read");
 const claim=await request("/internal/dev/x904-vmsc/claim",{});
 assert.equal(claim.body.job?.id,second);
 const token=claim.body.job.claimToken;
 const payload={id:second,claimToken:token,status:"completed",result:{adapter:"simulated",clock:"2000-01-01T00:00:00Z"}};
 assert.equal((await request("/internal/dev/x904-vmsc/result",payload)).body.ack,"RESULT_VERIFIED");
 assert.equal((await request("/internal/dev/x904-vmsc/result",payload)).body.duplicate,true,"idempotent callback");
 assert.equal((await request("/internal/dev/x904-vmsc/result",{...payload,result:{changed:true}})).status,409,"reject conflicting callback");
 const receipt=await request("/internal/dev/x904-vmsc/receipt/"+second);
 assert.equal(receipt.body.receipt?.verified,true);
 console.log("VMSC_DEV_FULL_MOCK_E2E_PASS claim result persisted_ack retry_duplicate conflict restart");
} finally {
 await close();
 for(const id of ids) {
   await db.execute(sql`DELETE FROM sport_center.x904_vmsc_command_receipts WHERE command_id=${id}::uuid`).catch(()=>{});
   await db.execute(sql`DELETE FROM sport_center.x904_vmsc_commands WHERE id=${id}::uuid`).catch(()=>{});
 }
}
