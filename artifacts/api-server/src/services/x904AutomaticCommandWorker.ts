import {createHash} from "node:crypto";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {resolvePaidX904Automation} from "./gymMembershipEntitlement";

/** Only explicitly allowlisted machine identities may receive automated commands. */
export async function processX904AutomaticCommands(): Promise<void> {
  if(process.env.GYM_X904_AUTOMATIC_COMMANDS_ENABLED!=="true")return;
  const pins=(process.env.GYM_X904_AUTOMATIC_ALLOWED_PINS??"").split(",").map(x=>x.trim()).filter(Boolean);
  // Explicit single-user rollout only; no bulk access mutations.
  if(pins.length!==1 || !/^[0-9]{1,8}$/.test(pins[0]))return;
  const actor=Number(process.env.GYM_X904_AUTOMATIC_REQUESTED_BY);
  if(!Number.isSafeInteger(actor)||actor<=0)return;
  // A command must be attributable to the dedicated non-login system identity.
  // Do not accept a human admin/customer numeric ID from configuration.
  const verifiedActor=await db.execute(sql`
    SELECT id FROM sport_center.users
     WHERE id=${actor} AND name='X904 AUTOMATION SERVICE'
       AND registration_source='system_x904_automation'
       AND account_status='inactive' AND email IS NULL AND password_hash IS NULL
  `);
  if(verifiedActor.rows.length!==1)return;
  const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  const events=await db.execute(sql`SELECT event_id,membership_id,event_key FROM sport_center.x904_automatic_entitlement_events
    WHERE state='pending' ORDER BY event_id LIMIT 20`);
  for(const ev of events.rows){
    await db.transaction(async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(904201)`);
      const event=await tx.execute(sql`SELECT event_id,membership_id,event_key FROM sport_center.x904_automatic_entitlement_events
        WHERE event_id=${Number(ev.event_id)} AND state='pending' FOR UPDATE`);
      if(event.rows.length!==1)return;
      const membershipId=Number(event.rows[0].membership_id);
      // A queued command is not completion. Only a confirmed machine read-back
      // may close the event; hold failures for explicit investigation.
      const sent=await tx.execute(sql`SELECT state,result FROM sport_center.x904_user_commands
        WHERE device_serial='TDBD234200545' AND payload->>'source'='AUTO_MEMBERSHIP_PAYMENT'
          AND payload->>'eventId'=${String(ev.event_id)}
        ORDER BY created_at DESC LIMIT 1`);
      if(sent.rows.length){
        const last=sent.rows[0];
        if(last.state==='completed' && (last.result as any)?.readBackConfirmed===true){
          await tx.execute(sql`UPDATE sport_center.x904_automatic_entitlement_events
            SET state='processed',processed_at=now(),result='{"status":"readback_confirmed"}'::jsonb
            WHERE event_id=${Number(ev.event_id)}`);
        }else if(last.state==='failed'){
          await tx.execute(sql`UPDATE sport_center.x904_automatic_entitlement_events
            SET state='review_required',result='{"status":"device_command_failed"}'::jsonb
            WHERE event_id=${Number(ev.event_id)}`);
        }
        return;
      }
      const candidates=await tx.execute(sql`SELECT m.start_date,m.end_date,m.status::text AS status,
        mp.user_pin,u.device_uid,u.display_name,u.device_role
        FROM sport_center.sport_memberships m
        JOIN sport_center.gym_x904_member_mapping mp ON mp.membership_id=m.id AND mp.status='verified'
        JOIN sport_center.gym_x904_lan_users u ON u.device_serial=mp.device_serial AND u.user_pin=mp.user_pin
        WHERE m.id=${membershipId} AND mp.device_serial='TDBD234200545'
          AND mp.user_pin=${pins[0]}`);
      if(candidates.rows.length!==1)return;
      const m=candidates.rows[0];
      if(!Number.isSafeInteger(Number(m.device_uid)) || Number(m.device_uid)<=0 ||
        !String(m.display_name).trim() || Number(m.device_role)!==0)return;
      const payments=await tx.execute(sql`SELECT p.id,p.period_start,p.period_end,p.status,p.amount,
        count(b.id)::integer AS booking_count FROM sport_center.sport_membership_payments p
        LEFT JOIN sport_center.sport_bookings b ON b.membership_payment_id=p.id
        WHERE p.membership_id=${membershipId} GROUP BY p.id`);
      // No financial history cannot prove non-payment. Never suspend a legacy
      // membership on an empty payment ledger.
      const sourcesComplete=payments.rows.length>0 && payments.rows.every(p=>
        p.status!=="waiting_confirmation" && p.status!=="pending_payment" &&
        (p.status!=="confirmed" || (Number(p.amount)>0 && Number(p.booking_count)===1)));
      const entitlement=resolvePaidX904Automation({
        today,membershipStart:String(m.start_date),membershipEnd:String(m.end_date),
        membershipStatus:String(m.status),paymentSourcesComplete:sourcesComplete,
        payments:payments.rows.map(p=>({id:Number(p.id),periodStart:String(p.period_start),
          periodEnd:String(p.period_end),status:String(p.status),amount:Number(p.amount)}))
      });
      if(entitlement!=="active"&&entitlement!=="suspended")return;
      const snap=await tx.execute(sql`SELECT observed_at,user_count,users FROM sport_center.gym_x904_access_snapshots
        WHERE device_serial='TDBD234200545' ORDER BY snapshot_id DESC LIMIT 1`);
      if(snap.rows.length!==1)return;
      const x=snap.rows[0],users=Array.isArray(x.users)?x.users:[],age=Date.now()-new Date(String(x.observed_at)).getTime();
      if(age<0||age>300000||users.length!==Number(x.user_count))return;
      const entries=users.filter((v:any)=>String(v.pin)===pins[0]&&String(v.name)===String(m.display_name)&&Number(v.role)===0);
      if(entries.length!==1||entries[0].enabled!==true)return;
      const group=Number(entries[0].group);
      const command=entitlement==="active"&&group===2?"ACTIVATE_USER":entitlement==="suspended"&&group===1?"SUSPEND_USER":null;
      if(!command){
        if((entitlement==="active"&&group===1)||(entitlement==="suspended"&&group===2)){
          await tx.execute(sql`UPDATE sport_center.x904_automatic_entitlement_events
            SET state='processed',processed_at=now(),result='{"status":"already_correct"}'::jsonb
            WHERE event_id=${Number(ev.event_id)}`);
        }
        return;
      }
      const previous=await tx.execute(sql`SELECT state,completed_at,result FROM sport_center.x904_user_commands
        WHERE device_serial='TDBD234200545' AND user_pin=${pins[0]}
          AND command_type IN ('SUSPEND_USER','ACTIVATE_USER')
        ORDER BY created_at DESC LIMIT 1`);
      if(previous.rows.length){
        const last=previous.rows[0];
        if(last.state!=="completed" || (last.result as any)?.readBackConfirmed!==true ||
          !last.completed_at || new Date(String(x.observed_at)).getTime()<=new Date(String(last.completed_at)).getTime())return;
      }
      const pending=await tx.execute(sql`SELECT 1 FROM sport_center.x904_user_commands WHERE device_serial='TDBD234200545'
        AND user_pin=${pins[0]} AND state IN ('queued','claimed') LIMIT 1`);
      if(pending.rows.length)return;
      const key="x904auto_"+createHash("sha256").update(String(event.rows[0].event_key)+":"+command+":"+pins[0]).digest("hex").slice(0,44);
      const payload=JSON.stringify({expectedUid:Number(m.device_uid),expectedName:String(m.display_name),source:"AUTO_MEMBERSHIP_PAYMENT",membershipId,eventId:Number(ev.event_id)});
      await tx.execute(sql`INSERT INTO sport_center.x904_user_commands
        (device_serial,command_type,user_pin,payload,requested_by,idempotency_key)
        VALUES ('TDBD234200545',${command},${pins[0]},${payload}::jsonb,${actor},${key})
        ON CONFLICT (idempotency_key) DO NOTHING`);
      // Keep pending until the device has executed and confirmed read-back.
      // Next worker cycle resolves the event against its actual machine command.

    });
  }
}
