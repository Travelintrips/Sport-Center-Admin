import {chooseX904AutomaticCommand,x904MachineCommandResult,x904AutomaticCommandKey} from "./x904AutomationDecision";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {resolvePaidX904Automation} from "./gymMembershipEntitlement";

/** Start only under explicit production opt-in; never run in isolated E2E mode. */
export function startX904AutomaticCommandWorker(): void {
  if(process.env.GYM_X904_AUTOMATIC_COMMANDS_ENABLED!=="true")return;
  let running=false;
  const tick=async()=>{
    if(running)return;
    running=true;
    try { await processX904AutomaticCommands(); }
    catch(error) { console.error('[x904-automatic] worker cycle failed',error instanceof Error?error.message:String(error)); }
    finally {running=false;}
  };
  void tick();
  const interval=setInterval(()=>void tick(),60_000);
  interval.unref();
}

/** Only explicitly allowlisted machine identities may receive automated commands. */
export async function processX904AutomaticCommands(store: Pick<typeof db,'execute'|'transaction'> = db): Promise<void> {
  if(process.env.GYM_X904_AUTOMATIC_COMMANDS_ENABLED!=="true")return;
  // Roll out to verified members only under a separate explicit opt-in.
  // Existing production configuration remains single-PIN until approved.
  const allVerified=process.env.GYM_X904_AUTOMATIC_SCOPE==="all_verified";
  const pins=(process.env.GYM_X904_AUTOMATIC_ALLOWED_PINS??"").split(",").map(x=>x.trim()).filter(Boolean);
  if(!allVerified && (pins.length!==1 || !/^[0-9]{1,8}$/.test(pins[0])))return;
  // Only one outstanding automatic machine mutation at a time.
  if(allVerified) {
    const outstanding=await store.execute(sql`SELECT 1 FROM sport_center.x904_user_commands
      WHERE device_serial='TDBD234200545'
        AND payload->>'source'='AUTO_MEMBERSHIP_PAYMENT'
        AND state IN ('queued','claimed') LIMIT 1`);
    if(outstanding.rows.length)return;
  }
  const actor=Number(process.env.GYM_X904_AUTOMATIC_REQUESTED_BY);
  if(!Number.isSafeInteger(actor)||actor<=0)return;
  // A command must be attributable to the dedicated non-login system identity.
  // Do not accept a human admin/customer numeric ID from configuration.
  const verifiedActor=await store.execute(sql`
    SELECT id FROM sport_center.users
     WHERE id=${actor} AND name='X904 AUTOMATION SERVICE'
       AND registration_source='system_x904_automation'
       AND account_status='inactive' AND email IS NULL AND password_hash IS NULL
  `);
  if(verifiedActor.rows.length!==1)return;
  const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
  const events=await store.execute(sql`SELECT event_id,membership_id,event_key FROM sport_center.x904_automatic_entitlement_events
    WHERE state='pending' ORDER BY event_id LIMIT 20`);
  for(const ev of events.rows){
    await store.transaction(async tx=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(904201)`);
      const event=await tx.execute(sql`SELECT event_id,membership_id,event_key FROM sport_center.x904_automatic_entitlement_events
        WHERE event_id=${Number(ev.event_id)} AND state='pending' FOR UPDATE`);
      if(event.rows.length!==1)return;
      const membershipId=Number(event.rows[0].membership_id);
      // A queued command is not completion. Only a confirmed machine read-back
      // may close the event; hold failures for explicit investigation.
      const sent=await tx.execute(sql`SELECT state,result,created_at,completed_at,count(*) OVER()::int AS attempt_count FROM sport_center.x904_user_commands
        WHERE device_serial='TDBD234200545' AND payload->>'source'='AUTO_MEMBERSHIP_PAYMENT'
          AND payload->>'eventId'=${String(ev.event_id)}
        ORDER BY created_at DESC LIMIT 1`);
      if(sent.rows.length){
        const last=sent.rows[0];
        if(x904MachineCommandResult(String(last.state),(last.result as any)?.readBackConfirmed===true)==='processed'){
          await tx.execute(sql`UPDATE sport_center.x904_automatic_entitlement_events
            SET state='processed',processed_at=now(),result='{"status":"readback_confirmed"}'::jsonb
            WHERE event_id=${Number(ev.event_id)}`);
          return;
        }else if(x904MachineCommandResult(String(last.state),(last.result as any)?.readBackConfirmed===true)==='review_required'){
          // Retry only definite DEVICE_BUSY (no device mutation acknowledged).
          // Any ambiguous failure requires human review: never blindly replay a door command.
          const retryable=String((last.result as any)?.errorCode)==="DEVICE_BUSY" &&
            (last.result as any)?.readBackConfirmed===false && !!last.completed_at;
          const count=Number(last.attempt_count);
          if(!retryable || !Number.isSafeInteger(count) || count>=3){
            await tx.execute(sql`UPDATE sport_center.x904_automatic_entitlement_events
              SET state='review_required',result=${JSON.stringify({status:"device_command_failed_or_retry_exhausted"})}::jsonb
              WHERE event_id=${Number(ev.event_id)}`);
            return;
          }
          // One minute minimum cooldown; the next fresh snapshot must independently
          // establish that the member remains in suspended Group 2.
          if(Date.now()-new Date(String(last.completed_at)).getTime()<60_000)return;
        }else{return;}
      }
      const candidates=await tx.execute(sql`SELECT m.start_date,m.end_date,m.status::text AS status,
        mp.user_pin,u.device_uid,u.display_name,u.device_role
        FROM sport_center.sport_memberships m
        JOIN sport_center.gym_x904_member_mapping mp ON mp.membership_id=m.id AND mp.status='verified'
        JOIN sport_center.gym_x904_lan_users u ON u.device_serial=mp.device_serial AND u.user_pin=mp.user_pin
        WHERE m.id=${membershipId} AND mp.device_serial='TDBD234200545'
          ${allVerified ? sql`` : sql`AND mp.user_pin=${pins[0]}`}`);
      if(candidates.rows.length!==1)return;
      const m=candidates.rows[0];
      const pin=String(m.user_pin);
      if(!/^[0-9]{1,8}$/.test(pin))return;
      if(allVerified) {
        // A machine PIN must belong to exactly one verified membership.
        const owners=await tx.execute(sql`SELECT count(*)::int AS count FROM sport_center.gym_x904_member_mapping
          WHERE device_serial='TDBD234200545' AND status='verified' AND user_pin=${pin}`);
        if(Number(owners.rows[0]?.count)!==1)return;
      }
      if(!Number.isSafeInteger(Number(m.device_uid)) || Number(m.device_uid)<=0 ||
        !String(m.display_name).trim() || Number(m.device_role)!==0)return;
      const payments=await tx.execute(sql`SELECT p.id,p.period_start,p.period_end,p.status,p.amount,
        count(b.id)::integer AS booking_count FROM sport_center.sport_membership_payments p
        LEFT JOIN sport_center.sport_bookings b ON b.membership_payment_id=p.id
        WHERE p.membership_id=${membershipId} GROUP BY p.id`);
      // No financial history cannot prove non-payment. Never suspend a legacy
      // membership on an empty payment ledger.
      // A future pending renewal cannot revoke already-confirmed access today.
      // Keep incomplete histories fail-closed when no paid period covers today.
      const paidToday=payments.rows.some(p=>p.status==="confirmed" && Number(p.amount)>0 &&
        String(p.period_start)<=today && String(p.period_end)>=today && Number(p.booking_count)===1);
      const sourcesComplete=paidToday || (payments.rows.length>0 && payments.rows.every(p=>
        p.status!=="waiting_confirmation" && p.status!=="pending_payment" &&
        (p.status!=="confirmed" || (Number(p.amount)>0 && Number(p.booking_count)===1))));
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
      // Machine names may differ only by casing/spacing from synchronized user rows.
      // PIN, enrolled UID, role and unique verified mapping are checked separately.
      // Access snapshots do not expose UID; never infer it from the snapshot.
      const normalizeName=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ').toLocaleUpperCase('id-ID');
      const entries=users.filter((v:any)=>String(v.pin)===pin &&
        normalizeName(v.name)===normalizeName(m.display_name) && Number(v.role)===0);
      if(entries.length!==1||entries[0].enabled!==true)return;
      const group=Number(entries[0].group);
      const command=chooseX904AutomaticCommand(entitlement,group);
      if(!command){
        if((entitlement==="active"&&group===1)||(entitlement==="suspended"&&group===2)){
          await tx.execute(sql`UPDATE sport_center.x904_automatic_entitlement_events
            SET state='processed',processed_at=now(),result='{"status":"already_correct"}'::jsonb
            WHERE event_id=${Number(ev.event_id)}`);
        }
        return;
      }
      const previous=await tx.execute(sql`SELECT state,completed_at,result FROM sport_center.x904_user_commands
        WHERE device_serial='TDBD234200545' AND user_pin=${pin}
          AND command_type IN ('SUSPEND_USER','ACTIVATE_USER')
        ORDER BY created_at DESC LIMIT 1`);
      if(previous.rows.length){
        const last=previous.rows[0];
        const retryBusy=sent.rows.length>0 && String(sent.rows[0].state)==="failed" &&
          String((sent.rows[0].result as any)?.errorCode)==="DEVICE_BUSY" &&
          (sent.rows[0].result as any)?.readBackConfirmed===false;
        if(retryBusy){
          if(!last.completed_at || new Date(String(x.observed_at)).getTime()<=new Date(String(last.completed_at)).getTime())return;
        }else if(last.state!=="completed" || (last.result as any)?.readBackConfirmed!==true ||
          !last.completed_at || new Date(String(x.observed_at)).getTime()<=new Date(String(last.completed_at)).getTime())return;
      }
      const pending=await tx.execute(sql`SELECT 1 FROM sport_center.x904_user_commands WHERE device_serial='TDBD234200545'
        AND user_pin=${pin} AND state IN ('queued','claimed') LIMIT 1`);
      if(pending.rows.length)return;
      const attempt=sent.rows.length ? Number(sent.rows[0].attempt_count)+1 : 1;
      // One stable idempotency key per bounded retry attempt.
      const key=x904AutomaticCommandKey(String(event.rows[0].event_key)+':attempt:'+attempt,command,pin);
      const payload=JSON.stringify({expectedUid:Number(m.device_uid),expectedName:String(m.display_name),source:"AUTO_MEMBERSHIP_PAYMENT",membershipId,eventId:Number(ev.event_id)});
      await tx.execute(sql`INSERT INTO sport_center.x904_user_commands
        (device_serial,command_type,user_pin,payload,requested_by,idempotency_key)
        VALUES ('TDBD234200545',${command},${pin},${payload}::jsonb,${actor},${key})
        ON CONFLICT (idempotency_key) DO NOTHING`);
      // Keep pending until the device has executed and confirmed read-back.
      // Next worker cycle resolves the event against its actual machine command.

    });
    if(allVerified) {
      // Never create a second machine command while the first awaits VMSC.
      const queued=await store.execute(sql`SELECT 1 FROM sport_center.x904_user_commands
        WHERE device_serial='TDBD234200545' AND payload->>'source'='AUTO_MEMBERSHIP_PAYMENT'
          AND state IN ('queued','claimed') LIMIT 1`);
      if(queued.rows.length)return;
    }
  }
}
