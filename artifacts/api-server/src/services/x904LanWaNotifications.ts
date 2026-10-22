import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendCstWaGatewayGroupMessage, listCstWaGatewayGroups } from "../lib/cstWaGateway";

/**
 * Send observed LAN scans from the EXISTING authenticated VMSC -> PROD
 * snapshot. These are observations, not verified membership check-ins.
 * Feature is off by default; activation cutoff forbids historic backfill.
 */
export async function dispatchX904LanScanNotifications(): Promise<void> {
  if (process.env.GYM_X904_LAN_WA_ENABLED !== "true") return;
  const groupId = String(process.env.GYM_X904_WA_GROUP_ID ?? "").trim();
  const activation = String(process.env.GYM_X904_LAN_WA_ACTIVATED_AT ?? "").trim();
  if (!groupId || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(activation) ||
      !Number.isFinite(Date.parse(activation))) {
    throw new Error("X904 LAN WhatsApp requires group ID and explicit UTC activation time");
  }

  // Never notify on an unfinished snapshot; event ID dedupes repeated syncs.
  await db.execute(sql`
    INSERT INTO sport_center.gym_x904_lan_wa_outbox (event_id, group_id, body)
    SELECT l.event_id, ${groupId},
      ('ABSENSI TERBACA X904' || chr(10) ||
       'Nama: ' || left(u.display_name,80) || chr(10) ||
       'Tanggal dan jam (WIB): ' || left(l.device_time,16) || chr(10) ||
       'Status: Tercatat pada mesin (belum diverifikasi)' || chr(10) ||
       'Event: ' || l.event_id)
    FROM sport_center.gym_x904_lan_logs l
    JOIN sport_center.gym_x904_lan_state s
      ON s.device_serial=l.device_serial AND s.last_snapshot_id=l.last_seen_snapshot
    JOIN sport_center.gym_x904_lan_users u
      ON u.device_serial=l.device_serial AND u.user_pin=l.user_pin
      -- Every authenticated machine scan is an observation, including operator roles.
      -- Role does not imply member check-in or verification.
    WHERE l.device_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
      AND (l.device_time::timestamp AT TIME ZONE 'Asia/Jakarta') >= ${activation}::timestamptz
      AND (l.device_time::timestamp AT TIME ZONE 'Asia/Jakarta') <= now()+interval '2 minutes'
      AND l.device_serial=${String(process.env.GYM_X904_DEVICE_SERIAL ?? "TDBD234200545")}
    ON CONFLICT (event_id) DO NOTHING
  `);

  const claimed = await db.execute(sql`
    UPDATE sport_center.gym_x904_lan_wa_outbox o
    SET status='sending', locked_until=now()+interval '2 minutes', attempts=attempts+1
    WHERE o.event_id IN (
      SELECT event_id FROM sport_center.gym_x904_lan_wa_outbox
      WHERE group_id=${groupId} AND
        ((status IN ('pending','failed') AND next_attempt_at<=now()) OR
         (status='sending' AND locked_until<now()))
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING event_id,body
  `);
  if (!claimed.rows.length) return;
  const eventId=String(claimed.rows[0].event_id);
  try {
    const registeredGroupId = groupId.endsWith("@g.us")
      ? (await listCstWaGatewayGroups("sport-center-report")).find(g => g.jid === groupId && g.isActive)?.id
      : groupId;
    if (!registeredGroupId) throw new Error("X904 target group not registered on sport-center-report");
    const result=await sendCstWaGatewayGroupMessage({
      groupId: registeredGroupId, text:String(claimed.rows[0].body),
      idempotencyKey:`x904-lan-event-${eventId}`,
    });
    const delivered=["delivered","read"].includes(result.status.toLowerCase());
    await db.execute(sql`
      UPDATE sport_center.gym_x904_lan_wa_outbox
      SET status=${delivered ? "sent" : "pending_ack"},
          gateway_message_id=${result.messageId},
          locked_until=NULL, sent_at=CASE WHEN ${delivered} THEN now() ELSE sent_at END,
          last_error=NULL
      WHERE event_id=${eventId} AND status='sending'
    `);
  } catch (err) {
    const reason=err instanceof Error ? err.message : "gateway_failed";
    await db.execute(sql`
      UPDATE sport_center.gym_x904_lan_wa_outbox
      SET status='failed',locked_until=NULL,next_attempt_at=now()+interval '1 minute',
          last_error=${reason.slice(0,250)}
      WHERE event_id=${eventId} AND status='sending'
    `);
  }
}


/**
 * One-off 22 Oct 2026 X904 report delivery. Uses the existing gateway token
 * inside the Sport Center production server; no secret is exposed to operators.
 * Only the explicitly approved, fixed report ID is processed here.
 */
export async function dispatchX904OneTimeReport(): Promise<void> {
  const eventId = "x904-report-20261022-0500-2300-v1";
  // WhatsApp Gateway requires the UUID of the registered group, not its JID.
  const groupId = "95862c59-6b11-4d86-bea0-e69546c827d6";
  const claimed = await db.execute(sql`
    UPDATE sport_center.gym_x904_wa_one_time_reports o
    SET status='sending',locked_until=now()+interval '2 minutes',attempts=attempts+1
    WHERE o.report_id=${eventId} AND o.group_id=${groupId}
      AND ((o.status IN ('pending','failed') AND o.next_attempt_at<=now())
        OR (o.status='sending' AND o.locked_until<now()))
    RETURNING o.body
  `);
  if (claimed.rows.length === 0) return;
  try {
    const result = await sendCstWaGatewayGroupMessage({
      groupId, text: String(claimed.rows[0].body),
      idempotencyKey: eventId,
    });
    const delivered = ["delivered","read"].includes(result.status.toLowerCase());
    await db.execute(sql`
      UPDATE sport_center.gym_x904_wa_one_time_reports
      SET status=${delivered ? "sent" : "pending_ack"},
          gateway_message_id=${result.messageId},
          sent_at=CASE WHEN ${delivered} THEN now() ELSE sent_at END,
          locked_until=NULL,last_error=NULL
      WHERE report_id=${eventId} AND status='sending'
    `);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "gateway_failed";
    await db.execute(sql`
      UPDATE sport_center.gym_x904_wa_one_time_reports
      SET status='failed',locked_until=NULL,next_attempt_at=now()+interval '1 minute',
          last_error=${reason.slice(0,250)}
      WHERE report_id=${eventId} AND status='sending'
    `);
  }
}

/** Drain only the two user-authorized real-world test scans, independent of opt-in env.
 * The durable statuses and Gateway idempotency prevent repeated WhatsApp sends.
 */
export async function dispatchX904AuthorizedRealScanTest(): Promise<void> {
  const ids = [
    "6a05144da0af12c8f05111e9e74aa7d96aafed5a2647e4b30558010ec7ebad46",
    "957668a2de43315b1f941cc89a5e139dd0edeb49fdbf48242878286206b97b40",
  ];
  for (const eventId of ids) {
    const claim=await db.execute(sql`
      UPDATE sport_center.gym_x904_lan_wa_outbox
      SET status='sending',locked_until=now()+interval '2 minutes',attempts=attempts+1
      WHERE event_id=${eventId} AND group_id='120363428216180040@g.us'
        AND ((status IN ('pending','failed') AND next_attempt_at<=now())
          OR (status='sending' AND locked_until<now()))
      RETURNING body
    `);
    if (!claim.rows.length) continue;
    try {
      const result=await sendCstWaGatewayGroupMessage({
        groupId:"95862c59-6b11-4d86-bea0-e69546c827d6",
        text:String(claim.rows[0].body),idempotencyKey:`x904-lan-event-${eventId}`
      });
      const delivered=["delivered","read"].includes(result.status.toLowerCase());
      await db.execute(sql`
        UPDATE sport_center.gym_x904_lan_wa_outbox
        SET status=${delivered?"sent":"pending_ack"},
          gateway_message_id=${result.messageId}, locked_until=NULL,last_error=NULL,
          sent_at=CASE WHEN ${delivered} THEN now() ELSE sent_at END
        WHERE event_id=${eventId} AND status='sending'
      `);
    } catch(err) {
      const reason=err instanceof Error?err.message:"gateway_failed";
      await db.execute(sql`
        UPDATE sport_center.gym_x904_lan_wa_outbox
        SET status='failed', locked_until=NULL,next_attempt_at=now()+interval '1 minute',
          last_error=${reason.slice(0,250)}
        WHERE event_id=${eventId} AND status='sending'
      `);
    }
  }
}
