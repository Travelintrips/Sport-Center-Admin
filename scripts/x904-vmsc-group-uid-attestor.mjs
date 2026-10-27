// VMSC-only read-only UID/PIN attestation. No machine mutations.
// Run under the same exclusive X904 sync mutex as the subsequent SDK group write.
import ZKLib from "node-zklib";
import commands from "node-zklib/constants.js";
function fail(code){throw new Error(code)}
function requireSafe(ok,code){if(!ok)fail(code)}
function authKey(value,session){
 let n=BigInt(value),k=0n;
 for(let i=0n;i<32n;i++)k=(k<<1n)|((n>>i)&1n);
 const b=Buffer.alloc(4);b.writeUInt32LE(Number((k+BigInt(session??0))&0xffffffffn));
 for(let i=0;i<4;i++)b[i]^=[90,75,83,79][i];
 return Buffer.from([b[2]^50,b[3]^50,50,b[1]^50]);
}
let input="";for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)fail("INPUT_TOO_LARGE")}
let zk;
try{
 const cfg=JSON.parse(input||"{}"),c=cfg.command??{},p=c.payload??{};
 requireSafe(cfg.deviceIp==="192.168.100.185"&&cfg.deviceSerial==="TDBD234200545"&&cfg.sendEnabled==="false","LOCAL_GUARD_FAILED");
 requireSafe(typeof cfg.commKey==="string"&&/^[0-9]{1,10}$/.test(cfg.commKey),"AUTH_CONFIGURATION_MISSING");
 requireSafe(["SUSPEND_USER","ACTIVATE_USER"].includes(c.commandType)&&c.deviceSerial===cfg.deviceSerial,"COMMAND_DENIED");
 requireSafe(/^[0-9a-f-]{36}$/i.test(c.commandId??"")&&/^[0-9a-f-]{36}$/i.test(c.leaseToken??""),"NO_TRUSTED_LEASE");
 requireSafe(typeof c.userPin==="string"&&/^[0-9]{1,8}$/.test(c.userPin)&&Number.isInteger(p.expectedUid)&&p.expectedUid>0&&p.expectedUid<65535&&typeof p.expectedName==="string","EXPECTED_IDENTITY_REQUIRED");
 zk=new ZKLib(cfg.deviceIp,4370,8000,4000);
 await zk.createSocket();
 const tcp=zk.zklibTcp;
 requireSafe(tcp?.socket,"TCP_AUTH_REQUIRED");
 const reply=await tcp.executeCmd(commands.COMMANDS.CMD_AUTH,authKey(cfg.commKey,tcp.sessionId));
 requireSafe(Buffer.isBuffer(reply)&&reply.length>=2&&reply.readUInt16LE(0)===2000,"AUTH_FAILED");
 const result=await tcp.getUsers();
 requireSafe(!result.err&&Array.isArray(result.data)&&result.data.length>0&&result.data.length<=10000,"USER_READ_FAILED");
 const matches=result.data.filter(u=>String(u.userId)===c.userPin);
 requireSafe(matches.length===1,"PIN_MISSING_OR_AMBIGUOUS");
 const user=matches[0];
 requireSafe(Number(user.uid)===p.expectedUid&&String(user.name)===p.expectedName&&Number(user.role)===0,"TARGET_CHANGED_REVIEW_REQUIRED");
 console.log(JSON.stringify({uidAttestedByWorker:true,verifiedUid:Number(user.uid),verifiedPin:c.userPin,verifiedName:String(user.name),userCount:result.data.length}));
}catch(e){
 const code=/^[A-Z0-9_]{1,64}$/.test(e?.message??"")?e.message:"ATTESTATION_FAILED";
 console.log(JSON.stringify({uidAttestedByWorker:false,errorCode:code}));
 process.exitCode=1;
}finally{if(zk)try{await zk.disconnect()}catch{}}
