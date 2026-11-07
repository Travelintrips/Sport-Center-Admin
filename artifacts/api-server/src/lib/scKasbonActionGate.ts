import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

/** Additional control beyond normal authenticated admin access.
 * Set ONLY on the API server: SC_KASBON_ACTION_PASSWORD_HASH (bcrypt hash)
 * and SC_KASBON_ACTION_SIGNING_KEY (64+ hex chars, independent random key).
 * No built-in default, no plaintext secret or privileged role bypass.
 */
type Grant = {uid:number;employeeId:string;recordId:number;expires:number};
const attempts = new Map<string,{failures:number;until:number}>();
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 15*60*1000;
const GRANT_MS = 90*1000;
function secrets() {
 const hash=process.env.SC_KASBON_ACTION_PASSWORD_HASH ?? "";
 const key=process.env.SC_KASBON_ACTION_SIGNING_KEY ?? "";
 if(!/^\$2[aby]\$\d\d\$/.test(hash) || !/^[0-9a-f]{64,}$/i.test(key))return null;
 return {hash,key};
}
export function kasbonGateConfigured():boolean { return secrets()!==null; }
export async function verifyKasbonPassword(password:unknown,userId:number,limiterKey:string):Promise<{status:"ok";token:string;expiresInSeconds:number}|{status:"disabled"|"locked"|"invalid"}> {
 const conf=secrets();
 if(!conf)return {status:"disabled"};
 if(!Number.isSafeInteger(userId)||userId<1)return {status:"invalid"};
 const id=String(userId)+":"+limiterKey;
 const current=attempts.get(id);
 if(current&&current.failures>=MAX_ATTEMPTS&&Date.now()<current.until)return {status:"locked"};
 if(typeof password!=="string"||password.length<12||password.length>256)return {status:"invalid"};
 const ok=await bcrypt.compare(password,conf.hash);
 if(!ok){
  const count=(current&&Date.now()<current.until?current.failures:0)+1;
  attempts.set(id,{failures:count,until:Date.now()+COOLDOWN_MS});
  return {status:count>=MAX_ATTEMPTS?"locked":"invalid"};
 }
 attempts.delete(id);
 return {status:"ok",token:"",expiresInSeconds:Math.round(GRANT_MS/1000)};
}
export function issueKasbonGrant(userId:number,employeeId:string,recordId:number):string {
 const conf=secrets();if(!conf)throw Error("KASBON_GATE_DISABLED");
 const payload:Grant={uid:userId,employeeId,recordId,expires:Date.now()+GRANT_MS};
 const encoded=Buffer.from(JSON.stringify(payload)).toString("base64url");
 const signature=createHmac("sha256",Buffer.from(conf.key,"hex")).update(encoded).digest("base64url");
 return encoded+"."+signature;
}
export function checkKasbonGrant(token:unknown,userId:number,employeeId:string,recordId:number):boolean {
 const conf=secrets();
 if(!conf||typeof token!=="string"||token.length>1400)return false;
 const parts=token.split(".");
 if(parts.length!==2||!parts.every(part=>/^[A-Za-z0-9_-]+$/.test(part)))return false;
 const expected=createHmac("sha256",Buffer.from(conf.key,"hex")).update(parts[0]).digest();
 let actual:Buffer;
 try {actual=Buffer.from(parts[1],"base64url");} catch {return false;}
 if(actual.length!==expected.length||!timingSafeEqual(expected,actual))return false;
 try{
  const payload=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8")) as Grant;
  return payload.uid===userId && payload.employeeId===employeeId && payload.recordId===recordId &&
   Number.isSafeInteger(payload.expires)&&payload.expires>Date.now()&&payload.expires<=Date.now()+GRANT_MS;
 }catch{return false;}
}
