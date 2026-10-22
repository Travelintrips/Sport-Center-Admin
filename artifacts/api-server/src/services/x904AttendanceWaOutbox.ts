import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendCstWaGatewayGroupMessage } from "../lib/cstWaGateway";

/** Opt-in, database-backed delivery. Gateway idempotency key is the immutable X904 event ID. */
export async function dispatchX904AttendanceWhatsApp(): Promise<void> {
  const groupId = String(process.env.GYM_X904_WA_GROUP_ID ?? "").trim();
  if (process.env.GYM_X904_WA_NOTIFY_ENABLED !== "true" || !groupId) return;
  // Batch digest only at the top of each two-hour WIB window; avoid per-scan group spam.
  const wibHour = (new Date().getUTCHours() + 7) % 24;
  if (wibHour % 2 !== 0 || new Date().getUTCMinutes() >= 5) return;
  // Atomic claim: concurrent scheduler instances cannot claim the same pending event.
  const claimed = await db.execute(sql`
    UPDATE sport_center.gym_x904_wa_outbox o SET status='sending',
      locked_until=now()+interval '2 minutes', attempts=attempts+1
    WHERE o.event_id IN (
      SELECT event_id FROM sport_center.gym_x904_wa_outbox
      WHERE (status IN ('pending','failed') AND next_attempt_at<=now())
         OR (status='sending' AND locked_until<now())
      ORDER BY created_at ASC LIMIT 80 FOR UPDATE SKIP LOCKED
    ) RETURNING event_id,member_name,user_pin,device_time,verification_method,attempts
  `);
  if (claimed.rows.length === 0) return;
  const rows = claimed.rows;
  const lines = rows.map((row,index) => {
    const time = String(row.device_time).slice(11,16);
    const isCard = String(row.verification_method) === 'card';
    const name = isCard ? `Kartu (PIN ${String(row.user_pin)})` : String(row.member_name).slice(0,35);
    return `${index+1}. ${name} ${time} ${isCard ? '💳' : '✅'}`;
  });
  const day = String(rows[0].device_time).slice(0,10);
  const text = `ABSENSI GYM X904\n${day}\n\n${lines.join("\n")}\n\nTotal: ${rows.length} absensi terverifikasi`;
  const ids = rows.map(row=>String(row.event_id));
  // Digest key is stable across retries for this claimed batch.
  const { createHash } = await import("node:crypto");
  const digestKey = createHash("sha256").update(ids.slice().sort().join("|")).digest("hex");
  try {
    const sent = await sendCstWaGatewayGroupMessage({
      groupId, text, idempotencyKey: `x904-digest-${digestKey}`,
    });
    for (const eventId of ids) {
      await db.execute(sql`UPDATE sport_center.gym_x904_wa_outbox
        SET status='sent',sent_at=now(),locked_until=NULL,gateway_message_id=${sent.messageId},last_error=NULL
        WHERE event_id=${eventId} AND status='sending'`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gateway delivery failed";
    for (const eventId of ids) {
      await db.execute(sql`UPDATE sport_center.gym_x904_wa_outbox
        SET status='failed',locked_until=NULL,last_error=${message.slice(0,300)},
          next_attempt_at=now()+interval '5 minutes'
        WHERE event_id=${eventId} AND status='sending'`);
    }
  }
}
