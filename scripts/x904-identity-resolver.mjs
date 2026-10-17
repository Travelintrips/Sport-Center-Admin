// Isolated DEV identity candidate resolver. Exact-name matches are NOT proof of identity.
// Usage: node scripts/x904-identity-resolver.mjs machine.json members.json
// Inputs are explicitly exported admin snapshots; no PROD credential is used.
import fs from "node:fs";
const [machinePath,membersPath]=process.argv.slice(2);
if(!machinePath||!membersPath) throw new Error("Provide machine and membership snapshot JSON paths");
const machines=JSON.parse(fs.readFileSync(machinePath,"utf8"));
const members=JSON.parse(fs.readFileSync(membersPath,"utf8"));
if(!Array.isArray(machines)||!Array.isArray(members)) throw new Error("Snapshots must be arrays");
const norm=(s)=>String(s??"").trim().replace(/\s+/g," ").toLocaleLowerCase("id-ID");
const matchCounts=new Map();
for(const m of members){const k=norm(m.name);if(k)matchCounts.set(k,(matchCounts.get(k)||0)+1)}
const deviceCounts=new Map();
for(const u of machines){const k=norm(u.display_name);if(k)deviceCounts.set(k,(deviceCounts.get(k)||0)+1)}
const matches=[];
for(const u of machines){
 const k=norm(u.display_name);
 const candidate=members.find(m=>norm(m.name)===k);
 if(!k||!candidate||deviceCounts.get(k)!==1||matchCounts.get(k)!==1)continue;
 if(!/^[A-Za-z0-9_-]{1,50}$/.test(String(u.user_pin)))continue;
 matches.push({device_serial:String(u.device_serial),device_user_pin:String(u.user_pin),simulated_member_id:matches.length+1,classification:"exact_name_candidate_not_verified"});
}
if(new Set(matches.map(x=>x.device_serial+":"+x.device_user_pin)).size!==matches.length)throw new Error("Duplicate PIN candidates");
console.log(JSON.stringify({machine_records:machines.length,membership_records:members.length,unique_name_candidates:matches.length,identity_verified:0,changes_to_device:0}));
if(process.argv.includes("--export-dev-mock")){
 const out=process.argv[process.argv.indexOf("--export-dev-mock")+1];
 if(!out||!out.endsWith(".json"))throw new Error("Specify an explicit .json output path");
 fs.writeFileSync(out,JSON.stringify(matches,null,2),{mode:0o600});
 console.log("DEV_MOCK_EXPORTED="+out);
}
