// VMSC-only one-command executor. No scheduled execution or PROD activation by default.
// Never logs biometric templates, member names, machine password or PIN.
import ZKLib from "node-zklib";
import commands from "node-zklib/constants.js";
import { decodeUserData72 } from "node-zklib/utils.js";
const run=process.argv.includes("--execute-claimed");
function fail(message){throw new Error(message);}
function requireValue(ok,message){if(!ok)fail(message);}
function authKey(value,session){
 let n=BigInt(value),k=0n;
 for(let i=0n;i<32n;i++)k=(k<<1n)|((n>>i)&1n);
 const b=Buffer.alloc(4);
 b.writeUInt32LE(Number((k+BigInt(session??0))&0xffffffffn));
 for(let i=0;i<4;i++)b[i]^=[90,75,83,79][i];
 return Buffer.from([b[2]^50,b[3]^50,50,b[1]^50]);
}
function encode72({uid,userId,name,role=0,password="",cardno=0}){
 requireValue(Number.isInteger(uid)&&uid>0&&uid<65535,"INVALID_UID");
 requireValue(/^[0-9]{1,8}$/.test(userId),"INVALID_PIN");
 requireValue(typeof name==="string"&&/^[A-Za-z0-9 ._-]{2,24}$/.test(name),"INVALID_NAME");
 requireValue(Number.isInteger(role)&&role>=0&&role<255,"INVALID_ROLE");
 requireValue(typeof password==="string"&&/^[\x20-\x7e]{0,8}$/.test(password),"UNSAFE_EXISTING_PASSWORD_ENCODING");
 requireValue(Number.isSafeInteger(cardno)&&cardno>=0&&cardno<=4294967295,"INVALID_CARD_NUMBER");
 const buf=Buffer.alloc(72);
 buf.writeUInt16LE(uid,0);
 buf.writeUInt8(role,2);
 buf.write(password,3,8,"ascii");
 buf.write(name,11,24,"ascii");
 buf.writeUInt32LE(cardno,35);
 buf.write(userId,48,9,"ascii");
 const read=decodeUserData72(buf);
 requireValue(read.uid===uid&&String(read.userId)===userId&&read.name===name&&read.role===role
   &&read.password===password&&read.cardno===cardno,"ENCODING_ROUNDTRIP_FAILED");
 return buf;
}
const select=(users,pin)=>users.filter(u=>String(u.userId)===pin);
function preserved(original,next,exceptUid=null){
 const expected=original.filter(u=>Number(u.uid)!==exceptUid);
 const received=new Map(next.map(u=>[Number(u.uid),u]));
 return expected.every(u=>{
   const x=received.get(Number(u.uid));
   return x&&String(x.userId)===String(u.userId)&&String(x.name)===String(u.name)
     &&Number(x.role)===Number(u.role)&&String(x.password)===String(u.password)
     &&Number(x.cardno)===Number(u.cardno);
 });
}
function safeError(err){
 const word=err instanceof Error?err.message:"UNKNOWN";
 return /^[A-Z0-9_]{1,64}$/.test(word)?word:"EXECUTION_FAILED";
}
let data="";for await(const part of process.stdin){data+=part;if(data.length>16384)fail("INPUT_TOO_LARGE");}
const cfg=JSON.parse(data||"{}");
const c=cfg.command??{};
const dry=!run;
if(dry){
 const test=encode72({uid:60000,userId:"99123456",name:"X904 CI TEST"});
 requireValue(test.length===72&&decodeUserData72(test).uid===60000,"SELF_TEST_FAILED");
 console.log(JSON.stringify({readBackConfirmed:true,dryRun:true,test:"X904_CUD_ENCODING_PASS"}));
 process.exit(0);
}
requireValue(cfg.deviceIp==="192.168.100.185"&&cfg.deviceSerial==="TDBD234200545"
 &&cfg.sendEnabled==="false"&&cfg.userWriteEnabled==="true","LOCAL_WRITE_GUARD_DISABLED");
requireValue(typeof cfg.commKey==="string"&&/^[0-9]{1,10}$/.test(cfg.commKey),"AUTH_CONFIGURATION_MISSING");
requireValue(c.deviceSerial==="TDBD234200545"&&
  /^[0-9a-f-]{36}$/i.test(c.commandId??"")&&/^[0-9a-f-]{36}$/i.test(c.leaseToken??""),"NO_TRUSTED_LEASE");
requireValue(["CREATE_USER","UPDATE_USER","DELETE_USER"].includes(c.commandType),"COMMAND_DENIED");
requireValue(typeof c.userPin==="string"&&/^[0-9]{1,8}$/.test(c.userPin),"INVALID_PIN");
const payload=c.payload??{};
if(c.commandType!=="DELETE_USER")
 requireValue(typeof payload.name==="string"&&/^[A-Za-z0-9 ._-]{2,24}$/.test(payload.name),"INVALID_NAME");
if(c.commandType!=="CREATE_USER")
 requireValue(Number.isInteger(payload.expectedUid)&&payload.expectedUid>0&&payload.expectedUid<65535
   &&typeof payload.expectedName==="string"&&payload.expectedName.length>0&&payload.expectedName.length<=80,
   "EXPECTED_IDENTITY_REQUIRED");
const zk=new ZKLib(cfg.deviceIp,4370,8000,4000);
let beforeCount=null,afterCount=null,targetUid=null;
async function snapshot(tcp){
 const result=await tcp.getUsers();
 requireValue(!result.err&&Array.isArray(result.data),"USER_READBACK_FAILED");
 requireValue(result.data.length>=1&&result.data.length<=10000,"USER_COUNT_OUT_OF_RANGE");
 return result.data;
}
try{
 await zk.createSocket();
 const tcp=zk.zklibTcp;
 requireValue(tcp?.socket,"TCP_AUTH_REQUIRED");
 const proof=await tcp.executeCmd(commands.COMMANDS.CMD_AUTH,authKey(cfg.commKey,tcp.sessionId));
 requireValue(Buffer.isBuffer(proof)&&proof.length>=2&&proof.readUInt16LE(0)===2000,"AUTH_FAILED");
 const before=await snapshot(tcp);
 beforeCount=before.length;
 const matching=select(before,c.userPin);
 let packet,command,exceptUid=null;
 if(c.commandType==="CREATE_USER"){
   requireValue(matching.length===0,"PIN_ALREADY_PRESENT");
   const taken=new Set(before.map(x=>Number(x.uid)));
   targetUid=Array.from({length:4000},(_,i)=>60000+i).find(n=>n<65535&&!taken.has(n));
   requireValue(Number.isInteger(targetUid),"RESERVED_UID_EXHAUSTED");
   packet=encode72({uid:targetUid,userId:c.userPin,name:payload.name});
   command=commands.COMMANDS.CMD_USER_WRQ;
 }else{
   requireValue(matching.length===1,"PIN_MISSING_OR_AMBIGUOUS");
   const target=matching[0];
   requireValue(Number(target.uid)===payload.expectedUid&&String(target.name)===payload.expectedName,
     "TARGET_CHANGED_REVIEW_REQUIRED");
   requireValue(Number(target.role)===0,"PROTECTED_DEVICE_ACCOUNT");
   targetUid=Number(target.uid);
   exceptUid=targetUid;
   if(c.commandType==="UPDATE_USER"){
     packet=encode72({uid:targetUid,userId:c.userPin,name:payload.name,role:target.role,
       password:target.password??"",cardno:Number(target.cardno??0)});
     command=commands.COMMANDS.CMD_USER_WRQ;
   }else{
     packet=Buffer.alloc(2);packet.writeUInt16LE(targetUid);
     command=commands.COMMANDS.CMD_DELETE_USER;
   }
 }
 const reply=await tcp.executeCmd(command,packet);
 requireValue(Buffer.isBuffer(reply)&&reply.length>=2&&reply.readUInt16LE(0)===2000,"DEVICE_COMMAND_NO_ACK");
 const after=await snapshot(tcp);
 afterCount=after.length;
 requireValue(preserved(before,after,exceptUid),"EXISTING_USERS_CHANGED_REVIEW_REQUIRED");
 const now=select(after,c.userPin);
 if(c.commandType==="CREATE_USER"){
   requireValue(after.length===before.length+1 && now.length===1 && Number(now[0].uid)===targetUid
     &&String(now[0].name)===payload.name &&Number(now[0].role)===0,"CREATE_READBACK_MISMATCH");
 }else if(c.commandType==="UPDATE_USER"){
   requireValue(after.length===before.length && now.length===1 && Number(now[0].uid)===targetUid
     &&String(now[0].name)===payload.name,"UPDATE_READBACK_MISMATCH");
 }else{
   requireValue(after.length===before.length-1 && now.length===0
     &&!after.some(u=>Number(u.uid)===targetUid),"DELETE_READBACK_MISMATCH");
 }
 console.log(JSON.stringify({readBackConfirmed:true,deviceUid:targetUid,
   beforeCount,afterCount,errorCode:null}));
}catch(e){
 console.log(JSON.stringify({readBackConfirmed:false,deviceUid:targetUid,
   beforeCount,afterCount,errorCode:safeError(e)}));
 process.exitCode=1;
}finally{try{await zk.disconnect()}catch{}}
