// Read-only UID attestation after disabled-first SDK creation and group-2 readback.
// Never executes a write command or returns user names to logs.
import ZKLib from "node-zklib";
import commands from "node-zklib/constants.js";
function fail(code){throw new Error(code);}
function check(ok,code){if(!ok)fail(code);}
function authKey(value,session){
 let n=BigInt(value),k=0n;
 for(let i=0n;i<32n;i++)k=(k<<1n)|((n>>i)&1n);
 const b=Buffer.alloc(4);b.writeUInt32LE(Number((k+BigInt(session??0))&0xffffffffn));
 for(let i=0;i<4;i++)b[i]^=[90,75,83,79][i];
 return Buffer.from([b[2]^50,b[3]^50,50,b[1]^50]);
}
let input="";for await(const chunk of process.stdin){
 input+=chunk;if(input.length>16384)fail("INPUT_TOO_LARGE");
}
let zk;
try{
 const p=JSON.parse(input||"{}");
 check(p.deviceIp==="192.168.100.185"&&p.deviceSerial==="TDBD234200545"&&p.sendEnabled==="false","DEVICE_GUARD_FAILED");
 check(typeof p.commKey==="string"&&/^[0-9]{1,10}$/.test(p.commKey),"COMM_KEY_INVALID");
 check(typeof p.userPin==="string"&&/^[1-9][0-9]{2}$/.test(p.userPin),"PIN_INVALID");
 check(typeof p.expectedName==="string"&&/^[A-Za-z0-9 ._-]{2,24}$/.test(p.expectedName),"NAME_INVALID");
 check(Number.isInteger(p.expectedCount)&&p.expectedCount>0&&p.expectedCount<=10000,"COUNT_INVALID");
 zk=new ZKLib(p.deviceIp,4370,8000,4000);
 await zk.createSocket();
 const tcp=zk.zklibTcp;
 check(tcp?.socket,"TCP_SOCKET_MISSING");
 const proof=await tcp.executeCmd(commands.COMMANDS.CMD_AUTH,authKey(p.commKey,tcp.sessionId));
 check(Buffer.isBuffer(proof)&&proof.length>=2&&proof.readUInt16LE(0)===2000,"AUTH_FAILED");
 const users=await tcp.getUsers();
 check(!users.err&&Array.isArray(users.data)&&users.data.length===p.expectedCount,"ROSTER_CHANGED");
 const matches=users.data.filter(x=>String(x.userId)===p.userPin);
 check(matches.length===1&&String(matches[0].name)===p.expectedName&&Number(matches[0].role)===0,"IDENTITY_CHANGED");
 const uid=Number(matches[0].uid);
 check(Number.isInteger(uid)&&uid>0&&uid<65535,"UID_INVALID");
 console.log(JSON.stringify({uidVerified:true,deviceUid:uid}));
}catch(e){
 const code=/^[A-Z0-9_]{1,64}$/.test(e?.message??"")?e.message:"READBACK_FAILED";
 console.log(JSON.stringify({uidVerified:false,errorCode:code}));
 process.exitCode=1;
}finally{if(zk)try{await zk.disconnect()}catch{}}
