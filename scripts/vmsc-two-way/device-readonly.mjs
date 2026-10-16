// VMSC physical, READ-ONLY adapter. Never sends attendance, controls doors or writes users.
// Requires an authorized credential delivered to the VMSC host outside source control.
import ZKLib from "node-zklib";
import constants from "node-zklib/constants.js";
function authKey(text,sessionId){
 if(typeof text!=="string"||!/^\d{1,10}$/.test(text)||BigInt(text)>4294967295n)throw Error("INVALID_COMM_KEY");
 let n=BigInt(text), k=0n;
 for(let i=0n;i<32n;i++) k=(k<<1n)|((n>>i)&1n);
 const v=Number((k+BigInt(sessionId??0))&0xffffffffn);
 const b=Buffer.alloc(4);b.writeUInt32LE(v);
 for(let i=0;i<4;i++)b[i]^=[90,75,83,79][i];
 return Buffer.from([b[2]^50,b[3]^50,50,b[1]^50]);
}
export async function readDevice(command){
 if(command!=="device_info")throw Error("PHYSICAL_OPERATION_NOT_ALLOWED");
 if(process.env.X904_VMSC_PHYSICAL_READ_DEV!=="true")throw Error("PHYSICAL_READ_NOT_ENABLED");
 const key=process.env.X904_VMSC_X904_COMM_KEY;
 if(!key)throw Error("MISSING_DEVICE_READ_CREDENTIAL");
 const ip=process.env.X904_VMSC_X904_IP;
 if(ip!=="192.168.100.185")throw Error("DEVICE_IP_NOT_ALLOWED");
 let device;
 try{
  device=new ZKLib(ip,4370,8000,4000);
  await device.createSocket();
  const tcp=device.zklibTcp;
  const auth=await tcp.executeCmd(constants.COMMANDS.CMD_AUTH,authKey(key,tcp.sessionId));
  if(!Buffer.isBuffer(auth)||auth.length<2||auth.readUInt16LE(0)!==2000)throw Error("DEVICE_AUTH_FAILED");
  const info=await tcp.executeCmd(constants.COMMANDS.CMD_GET_FREE_SIZES,"");
  if(!Buffer.isBuffer(info)||info.length<76||info.readUInt16LE(0)!==2000)throw Error("DEVICE_INFO_FAILED");
  const users=info.readUInt32LE(24),logs=info.readUInt32LE(40);
  if(users>100000||logs>1000000)throw Error("INVALID_DEVICE_COUNTS");
  return {adapter:"physical-readonly",readAuthenticated:true,users,logs,readAt:new Date().toISOString()};
 } finally {try{await device?.disconnect()}catch{}}
}
