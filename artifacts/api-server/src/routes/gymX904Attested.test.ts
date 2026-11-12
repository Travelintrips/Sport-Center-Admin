import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import { createHmac } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";

const rawId="b".repeat(64);
const execMock=jest.fn(async (statement:any)=>{
  const q=new PgDialect().sqlToQuery(statement).sql;
  if(q.includes("SELECT l.event_id")) return {rows:[{event_id:rawId}]};
  if(q.includes("SELECT device_serial,user_pin,device_time")) return {rows:[]};
  if(q.includes("SELECT evidence_status,raw_hex")) return {rows:[]};
  return {rows:[]};
});
const transactionMock=jest.fn(async (f:(tx:any)=>Promise<any>)=>f({execute:execMock}));
const processMock=jest.fn(async()=> "review_required");
jest.unstable_mockModule("@workspace/db",()=>({db:{transaction:transactionMock}}));
jest.unstable_mockModule("../services/processX904Event",()=>({processX904Event:processMock}));
const {default:router}=await import("./gymX904Attested.js");

const serial="TDBD234200545";
const secret="ci-only-x904-attestation-hmac-test-4567";
const old=Object.fromEntries(["GYM_X904_VMSC_ATTEST_ENABLED","GYM_X904_VMSC_ATTEST_KEY","GYM_X904_DEVICE_SERIAL"].map(k=>[k,process.env[k]]));
const localParts=(date:Date)=>new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);
const localStamp=(date:Date)=>{
  const parts=localParts(date);
  const v=(type:string)=>parts.find(p=>p.type===type)?.value||"00";
  return `${v("year")}-${v("month")}-${v("day")} ${v("hour")}:${v("minute")}:${v("second")}`;
};
function rawRecord(index:number,pin:string,occurred:string,state:number) {
  const d=new Uint8Array(40);
  const buf=Buffer.from(d);
  buf.writeUInt16LE(index+1,0);
  buf.write(pin,2,"ascii");
  const [ymd,hms]=occurred.split(" ");
  const [year,month,day]=ymd.split("-").map(Number);
  const [hour,min,sec]=hms.split(":").map(Number);
  const packed=((((((year-2000)*12+(month-1))*31+(day-1))*24+hour)*60+min)*60+sec);
  buf.writeUInt32LE(packed,27);
  buf[26]=15;
  buf[31]=state;
  return buf.toString("hex");
}
function signedRequest(state:number,at:Date=new Date(),signatureOverride?:string) {
  const occurred=localStamp(at);
  const issuedAt=new Date().toISOString();
  const index=101;
  const pin="700";
  const rawHex=rawRecord(index,pin,occurred,state);
  const b={serial,index,pin,occurred,rawHex,issuedAt,readAuthenticated:true};
  const sig=createHmac("sha256",secret).update([serial,index,pin,occurred,rawHex,issuedAt,"true"].join("|")).digest("hex");
  return request(app).post("/internal/gym-x904/vmsc/attest")
    .set("x-gym-vmsc-signature",signatureOverride||sig).send(b);
}
const app=express();
app.use(express.json());
app.use(router);

describe("signed X904 VMSC attendance state compatibility — isolated route",()=>{
  beforeAll(()=>{
    process.env.GYM_X904_VMSC_ATTEST_ENABLED="true";
    process.env.GYM_X904_VMSC_ATTEST_KEY=secret;
    process.env.GYM_X904_DEVICE_SERIAL=serial;
  });
  beforeEach(()=>{execMock.mockClear();transactionMock.mockClear();processMock.mockClear();});
  afterAll(()=>{
    for(const [k,v] of Object.entries(old)) {
      if(v===undefined) delete process.env[k];
      else process.env[k]=v;
    }
  });
  test("existing signed punch 0 remains accepted",async()=>{
    const r=await signedRequest(0);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ok:true,accepted:1});
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(processMock).toHaveBeenCalledTimes(1);
  });
  test("signed valid undefined punch 255 accepted without treating it as door unlock",async()=>{
    const r=await signedRequest(255);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ok:true,accepted:1,outcome:"review_required"});
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
  test("unrecognized status is rejected before any database writes",async()=>{
    const r=await signedRequest(2);
    expect(r.status).toBe(422);
    expect(transactionMock).not.toHaveBeenCalled();
  });
  test("wrong signature is rejected",async()=>{
    const r=await signedRequest(255,new Date(),"0".repeat(64));
    expect(r.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });
  test("stale physical scan is rejected",async()=>{
    const r=await signedRequest(255,new Date(Date.now()-3*3600*1000));
    expect([409,422]).toContain(r.status);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
