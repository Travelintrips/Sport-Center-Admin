import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendCstWaGatewayGroupMessage } from "../lib/cstWaGateway";

/** Opt-in, database-backed delivery. Gateway idempotency key is the immutable X904 event ID. */
export async function dispatchX904AttendanceWhatsApp(): Promise<void> {
  const groupId = String(process.env.GYM_X904_WA_GROUP_ID ?? "").trim();
  if (process.env.GYM_X904_WA_NOTIFY_ENABLED !== "true" || !groupId) return;
  // Atomic claim: concurrent scheduler instances cannot claim the same pending event.
  const claimed = await db.execute(sql`
    UPDATE sport_center.gym_x904_wa_outbox o SET status='sending',
      locked_until=now()+interval '2 minutes', attempts=attempts+1
    WHERE o.event_id IN (
      SELECT event_id FROM sport_center.gym_x904_wa_outbox
      WHERE (status IN ('pending','failed') AND next_attempt_at<=now())
         OR (status='sending' AND locked_until<now())
      ORDER BY created_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED
    ) RETURNING event_id,member_name,user_pin,device_time,attempts
  `);
  for (const row of claimed.rows) {
    const eventId = String(row.event_id);
    const name = String(row.member_name).slice(0,80);
    const pin = String(row.user_pin);
    const when = String(row.device_time);
    const text = `Absensi Gym X904\nNama: ${name}\nPIN: ${pin}\nWaktu: ${when} WIB\nEvent: ${eventId.slice(0,12)}`;
    try {
      const sent = await sendCstWaGatewayGroupMessage({
        groupId, text, idempotencyKey: `x904-attendance-${eventId}`,
      });
      await db.execute(sql`UPDATE sport_center.gym_x904_wa_outbox
        SET status='sent',sent_at=now(),locked_until=NULL,gateway_message_id=${sent.messageId},last_error=NULL
        WHERE event_id=${eventId} AND status='sending'`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gateway delivery failed";
      await db.execute(sql`UPDATE sport_center.gym_x904_wa_outbox
        SET status='failed',locked_until=NULL,last_error=${message.slice(0,300)},
          next_attempt_at=now()+(least(60,power(2,least(attempts,6))::integer)*interval '1 minute')
        WHERE event_id=${eventId} AND status='sending'`);
    }
  }
}
