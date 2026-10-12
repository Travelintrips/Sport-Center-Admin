/** X904 ADMS ATTLOG parser candidate. No writes, no biometric payloads.
 * These formats require verification against the physical X904 before activation.
 */
export type X904RawAttendance={pin:string;deviceTime:string;status:number;verify:number};
export function parseX904Attlog(raw:string):X904RawAttendance[] {
 if(typeof raw!=="string"||Buffer.byteLength(raw,"utf8")>32768)throw Error("ATTLOG size invalid");
 const lines=raw.split(/\r?\n/).filter(Boolean);
 if(lines.length>100)throw Error("ATTLOG too many rows");
 return lines.map((line)=>{
  const columns=line.split("\t");
  if(columns.length!==4)throw Error("ATTLOG unsupported column count");
  const [pin,deviceTime,statusRaw,verifyRaw]=columns;
  if(!/^[A-Za-z0-9_-]{1,50}$/.test(pin)|| !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(deviceTime)|| !/^\d{1,3}$/.test(statusRaw)|| !/^\d{1,3}$/.test(verifyRaw))throw Error("ATTLOG invalid field");
  const status=Number(statusRaw),verify=Number(verifyRaw);
  if(status>255||verify>255||!Number.isFinite(Date.parse(deviceTime.replace(" ","T")+"+07:00")))throw Error("ATTLOG invalid values");
  return {pin,deviceTime,status,verify};
 });
}
