import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getCstWaGatewayMessageStatus, sendCstWaGatewayGroupMessage } from "../lib/cstWaGateway";

/** One daily, cumulative report per version, using the existing first-scan source ledger. */
export async function dispatchX904GymUsageReport(): Promise<void> {
  const groupId = String(process.env.GYM_X904_WA_GROUP_ID ?? "").trim();
  if (process.env.GYM_X904_GYM_USAGE_WA_ENABLED !== "true" || !groupId) return;
  // Reconcile pending delivery before claiming any newer report version.
  const outstanding = await db.execute(sql`SELECT report_date,gateway_message_id,claimed_version
    FROM sport_center.x904_gym_usage_wa_queue
    WHERE delivery_state='pending_ack' AND gateway_message_id IS NOT NULL
    ORDER BY report_date LIMIT 5`);
  for (const row of outstanding.rows) {
    const messageId=String(row.gateway_message_id);
    const state=await getCstWaGatewayMessageStatus(messageId);
    if (state !== 'delivered' && state !== 'read') continue;
    await db.execute(sql`UPDATE sport_center.x904_gym_usage_wa_queue
      SET delivery_state='sent',first_sent_at=COALESCE(first_sent_at,now()),
          last_sent_at=now(),claim_token=NULL,claim_at=NULL,last_error=NULL
      WHERE report_date=${String(row.report_date)}::date AND gateway_message_id=${messageId}
        AND claimed_version=${Number(row.claimed_version)} AND delivery_state='pending_ack'`);
  }
  const claim = await db.execute(sql`UPDATE sport_center.x904_gym_usage_wa_queue q
    SET claim_token=gen_random_uuid(),claim_at=now(),delivery_state='sending',
        claimed_version=CASE WHEN q.version>q.claimed_version THEN q.version ELSE q.claimed_version END,
        last_error=NULL
    WHERE q.report_date=(SELECT report_date FROM sport_center.x904_gym_usage_wa_queue
       WHERE (version>claimed_version OR delivery_state IN ('failed','sending'))
         AND delivery_state IN ('pending','sent','failed','sending')
         AND (claim_at IS NULL OR claim_at<now()-interval '3 minutes')
       ORDER BY report_date LIMIT 1 FOR UPDATE SKIP LOCKED)
      AND (q.version>q.claimed_version OR q.delivery_state IN ('failed','sending'))
    RETURNING report_date,claimed_version,claim_token`);
  if (!claim.rows.length) return;
  const row=claim.rows[0];
  const day=String(row.report_date).slice(0,10),version=Number(row.claimed_version),token=String(row.claim_token);
  const entries=await db.execute(sql`SELECT m.name,c.checked_in_at
    FROM sport_center.gym_x904_auto_checkin_sources a
    JOIN sport_center.gym_checkins c ON c.id=a.checkin_id
    JOIN sport_center.sport_memberships m ON m.id=a.membership_id
    WHERE a.checkin_date=${day}::date ORDER BY c.checked_in_at,m.id`);
  if (!entries.rows.length) {
    await db.execute(sql`UPDATE sport_center.x904_gym_usage_wa_queue
      SET delivery_state='failed',claim_token=NULL,claim_at=NULL,last_error='NO_VERIFIED_SOURCE_ROWS'
      WHERE report_date=${day}::date AND claim_token=${token}::uuid`);
    return;
  }
  const names=entries.rows.slice(0,150).map((e,i)=>{
    const time=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(String(e.checked_in_at)));
    return `${i+1}. ${String(e.name).slice(0,65)} — ${time} WIB`;
  });
  const body=`REKAP CHECK-IN OTOMATIS GYM X904\nTanggal: ${day} WIB\n👥 ${entries.rows.length} member (scan pertama/hari)\n\n${names.join('\n')}\n\nLaporan kumulatif v${version}`;
  const idempotencyKey=`x904-gym-usage-${day}-v${version}`;
  try {
    const result=await sendCstWaGatewayGroupMessage({groupId,text:body,idempotencyKey});
    const final=['delivered','read'].includes(result.status.toLowerCase());
    await db.execute(sql`UPDATE sport_center.x904_gym_usage_wa_queue
      SET delivery_state=${final?'sent':'pending_ack'},gateway_message_id=${result.messageId},
          first_sent_at=CASE WHEN ${final} THEN COALESCE(first_sent_at,now()) ELSE first_sent_at END,
          last_sent_at=CASE WHEN ${final} THEN now() ELSE last_sent_at END,
          claim_token=NULL,claim_at=NULL,last_error=NULL
      WHERE report_date=${day}::date AND claim_token=${token}::uuid
        AND claimed_version=${version} AND delivery_state='sending'`);
  } catch(error) {
    const reason=error instanceof Error?error.message:'GATEWAY_REQUEST_FAILED';
    await db.execute(sql`UPDATE sport_center.x904_gym_usage_wa_queue
      SET delivery_state='failed',claim_token=NULL,claim_at=NULL,last_error=${reason.slice(0,180)}
      WHERE report_date=${day}::date AND claim_token=${token}::uuid AND delivery_state='sending'`);
  }
}
