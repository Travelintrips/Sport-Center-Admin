import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendCstWaGatewayGroupMessage } from "../lib/cstWaGateway";

/**
 * One independently verified event -> one durable WhatsApp delivery.
 * All leasing and retry state is on the server; browser tabs are irrelevant.
 * Gateway responses other than delivered/read are NOT final acknowledgements.
 */
export async function dispatchX904AttendanceWhatsApp(): Promise<void> {
  const groupId = String(process.env.GYM_X904_WA_GROUP_ID ?? "").trim();
  if (process.env.GYM_X904_WA_NOTIFY_ENABLED !== "true" || !groupId) return;

  // Recover persisted batches first, including interrupted sends. A stable
  // idempotency key is reused even when the HTTP response was lost.
  const recovered = await db.execute(sql`
    UPDATE sport_center.gym_x904_wa_batches b
    SET status='sending', locked_until=now()+interval '2 minutes',
        attempts=b.attempts+1
    WHERE b.batch_id IN (
      SELECT batch_id FROM sport_center.gym_x904_wa_batches
      WHERE group_id=${groupId} AND
        ((status='failed' AND next_attempt_at<=now())
         OR (status='sending' AND locked_until<now()))
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING batch_id,body
  `);
  if (recovered.rows.length) {
    await sendBatch(String(recovered.rows[0].batch_id), groupId, String(recovered.rows[0].body));
    return;
  }

  // Claim only a single event at a time; atomic row locks prevent competing
  // schedulers from enqueuing a second group message for the same event.
  const claimed = await db.execute(sql`
    UPDATE sport_center.gym_x904_wa_outbox o
    SET status='sending',locked_until=now()+interval '2 minutes',
        attempts=attempts+1
    WHERE o.event_id IN (
      SELECT event_id FROM sport_center.gym_x904_wa_outbox
      WHERE batch_id IS NULL AND ((status='pending' AND next_attempt_at<=now()) 
        OR (status='sending' AND locked_until<now()))
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING event_id,member_name,user_pin,device_time,verification_method
  `);
  if (!claimed.rows.length) return;
  const event = claimed.rows[0];
  const eventId = String(event.event_id);
  const batchId = createHash("sha256").update(eventId).digest("hex");
  const timestamp = String(event.device_time).replace("T", " ").slice(0,16);
  const name = String(event.member_name).slice(0,80);
  const method = String(event.verification_method);
  const body = `ABSENSI SPORT CENTER X904\nNama: ${name}\nTanggal dan jam (WIB): ${timestamp}\nMetode: ${method}\nEvent: ${eventId}`;
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`
        INSERT INTO sport_center.gym_x904_wa_batches
          (batch_id,group_id,body,status,locked_until,attempts)
        VALUES (${batchId},${groupId},${body},'sending',now()+interval '2 minutes',1)
        ON CONFLICT (batch_id) DO NOTHING
      `);
      await tx.execute(sql`
        UPDATE sport_center.gym_x904_wa_outbox
        SET batch_id=${batchId} WHERE event_id=${eventId}
          AND status='sending' AND batch_id IS NULL
      `);
    });
  } catch (error) {
    await db.execute(sql`
      UPDATE sport_center.gym_x904_wa_outbox
      SET status='pending',locked_until=NULL,
          next_attempt_at=now()+interval '1 minute'
      WHERE event_id=${eventId} AND batch_id IS NULL AND status='sending'
    `);
    throw error;
  }
  await sendBatch(batchId, groupId, body);
}

async function sendBatch(batchId: string, groupId: string, body: string): Promise<void> {
  try {
    const result = await sendCstWaGatewayGroupMessage({
      groupId, text: body, idempotencyKey: `x904-event-${batchId}`,
    });
    const final = ["delivered", "read"].includes(result.status.toLowerCase());
    await db.transaction(async tx => {
      await tx.execute(sql`
        UPDATE sport_center.gym_x904_wa_batches
        SET status=${final ? "sent" : "pending_ack"},
            gateway_message_id=${result.messageId},locked_until=NULL,
            sent_at=CASE WHEN ${final} THEN now() ELSE sent_at END
        WHERE batch_id=${batchId} AND status='sending'
      `);
      await tx.execute(sql`
        UPDATE sport_center.gym_x904_wa_outbox
        SET status=${final ? "sent" : "pending_ack"},
            gateway_message_id=${result.messageId},locked_until=NULL,
            sent_at=CASE WHEN ${final} THEN now() ELSE sent_at END
        WHERE batch_id=${batchId} AND status='sending'
      `);
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Gateway request failed";
    await db.transaction(async tx => {
      await tx.execute(sql`
        UPDATE sport_center.gym_x904_wa_batches
        SET status='failed',locked_until=NULL,
            next_attempt_at=now()+interval '1 minute'
        WHERE batch_id=${batchId} AND status='sending'
      `);
      await tx.execute(sql`
        UPDATE sport_center.gym_x904_wa_outbox
        SET status='failed',locked_until=NULL,last_error=${reason.slice(0,300)},
            next_attempt_at=now()+interval '1 minute'
        WHERE batch_id=${batchId} AND status='sending'
      `);
    });
  }
}
