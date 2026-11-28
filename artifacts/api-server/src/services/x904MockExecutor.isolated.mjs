// Disposable PostgreSQL QA ONLY. Never has network/device access to VMSC/X904.
import pg from "pg";
const url = process.env.X904_NONMEMBER_ISOLATED_PG_URL;
if (process.env.NODE_ENV !== "test" ||
    !/^postgres(?:ql)?:\/\/[^@/]+@127\.0\.0\.1:5544[45]\/x904_nonmember_safe2(?:\?|$)/.test(url ?? ""))
  throw new Error("REFUSE_NON_LOCAL_ISOLATED_DATABASE");
const [kind,accessIdRaw,atRaw,pin,name,uidRaw,groupRaw] = process.argv.slice(2);
const accessId=Number(accessIdRaw),uid=Number(uidRaw),group=Number(groupRaw),at=new Date(atRaw);
if (!Number.isSafeInteger(accessId) || !Number.isSafeInteger(uid) ||
    ![1,2].includes(group) || !Number.isFinite(at.getTime()) ||
    !((kind==="ACTIVATE_USER" && group===1) || (kind==="SUSPEND_USER" && group===2)))
  throw Error("BAD_MOCK_EXECUTOR_PARAMETERS");
const client=new pg.Client({connectionString:url});
await client.connect();
try {
  await client.query("BEGIN");
  const a=await client.query(`SELECT access_id,user_pin,device_uid,verified_name FROM sport_center.x904_nonmember_daily_access WHERE access_id=$1`,[accessId]);
  if(a.rows.length!==1 || a.rows[0].user_pin!==pin || a.rows[0].device_uid!==uid || a.rows[0].verified_name!==name)
    throw Error("GRANT_IDENTITY_MISMATCH");
  const cmds=await client.query(`SELECT command_id,command_type,state,payload FROM sport_center.x904_user_commands
    WHERE payload->>'accessId'=$1 AND command_type=$2 AND state='queued'
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[String(accessId),kind]);
  if(cmds.rows.length!==1 || Number(cmds.rows[0].payload.expectedUid)!==uid)
    throw Error("QUEUED_COMMAND_MISSING_OR_UID_MISMATCH");
  await client.query(`UPDATE sport_center.x904_user_commands
    SET state='completed', completed_at=$2, result=$3::jsonb WHERE command_id=$1 AND state='queued'`,
    [cmds.rows[0].command_id,at,JSON.stringify({readBackConfirmed:true,deviceUid:uid,afterGroup:group})]);
  const snap=new Date(at.getTime()+1000);
  await client.query(`INSERT INTO sport_center.gym_x904_access_snapshots(device_serial,observed_at,user_count,users)
    VALUES('TDBD234200545',$1,1,jsonb_build_array(jsonb_build_object('pin',$2::text,'name',$3::text,'role',0,'group',$4::int,'enabled',true)))`,[snap,pin,name,group]);
  await client.query("COMMIT");
  console.info("MOCK_EXECUTOR_ACK_OK",kind,accessId,group);
} catch(e) { await client.query("ROLLBACK"); throw e; }
finally { await client.end(); }
