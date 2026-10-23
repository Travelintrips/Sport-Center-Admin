import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendCstWaGatewayGroupMessage, listCstWaGatewayGroups } from "../lib/cstWaGateway";

/**
 * Send observed LAN scans from the EXISTING authenticated VMSC -> PROD
 * snapshot. These are observations, not verified membership check-ins.
 * Durable database digest configuration is the opt-in; explicit env false disables dispatch.\n * Activation cutoff forbids historic backfill.
 */
/**
 * X904 LAN digest: one message for new scans collected over two minutes.
 * Historical per-event outbox rows remain untouched for audit/ACK.
 * Requires sport_center.gym_x904_lan_wa_batches and _batch_events migration.
 */
export async function dispatchX904LanScanNotifications(): Promise<void> {
  if (process.env.GYM_X904_LAN_WA_ENABLED === "false") return;
  const groupId = String(process.env.GYM_X904_WA_GROUP_ID ?? "95862c59-6b11-4d86-bea0-e69546c827d6").trim();
  const serial = String(process.env.GYM_X904_DEVICE_SERIAL ?? "TDBD234200545");
  // Historical batches used the JID while some deployments use the registered UUID.
  // Both identify the same approved Sport Center group; never strand durable batches.
  const approvedGroupJid = "120363428216180040@g.us";
  const approvedGroupUuid = "95862c59-6b11-4d86-bea0-e69546c827d6";
  const groupAliases = groupId === approvedGroupJid || groupId === approvedGroupUuid
    ? [approvedGroupJid, approvedGroupUuid] : [groupId];
  if (!groupId) throw new Error("X904 LAN digest requires group ID");
  // A durable activation watermark, recorded once in the database, prevents
  // replay after deployments or restarts without adding Hostinger secrets.
  const config = await db.execute(sql`SELECT activated_at FROM sport_center.gym_x904_lan_wa_digest_config
    WHERE config_key='main' AND enabled=true`);
  if (!config.rows.length) {
    // The database may be reachable but point to another PROD instance.
    // Log non-secret database identity and config presence; never bypass opt-in.
    const identity = await db.execute(sql`SELECT current_database() AS database_name,
      current_schema() AS schema_name,
      inet_server_port() AS server_port,
      (SELECT count(*)::int FROM sport_center.gym_x904_lan_wa_digest_config) AS config_rows,
      (SELECT count(*)::int FROM sport_center.gym_x904_lan_wa_batches) AS batch_rows,
      (SELECT count(*)::int FROM sport_center.gym_x904_lan_logs) AS scan_rows`);
    console.error("[x904-digest] config missing in runtime database; dispatch blocked", {
      database: identity.rows[0], expectedConfig: "main/enabled",
    });
    return;
  }
  const activation = new Date(String(config.rows[0].activated_at)).toISOString();

  // A transaction-scoped advisory lock serializes batch creation across Hostinger replicas.
  // Use received_at, not the machine's editable clock, to delimit the quiet collection window.
  try {
    await db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(90420261023::bigint) AS acquired`);
    if (lock.rows[0]?.acquired !== true) return;
    const pending = await tx.execute(sql`
      SELECT l.event_id,l.device_serial,l.user_pin,l.device_time,l.received_at,
        COALESCE(NULLIF(trim(u.display_name),''),'Pengguna X904') AS display_name
      FROM sport_center.gym_x904_lan_logs l
      JOIN sport_center.gym_x904_lan_state s
        ON s.device_serial=l.device_serial AND s.last_snapshot_id=l.last_seen_snapshot
      LEFT JOIN sport_center.gym_x904_lan_users u
        ON u.device_serial=l.device_serial AND u.user_pin=l.user_pin
      LEFT JOIN sport_center.gym_x904_lan_wa_batch_events be ON be.event_id=l.event_id
      LEFT JOIN sport_center.gym_x904_lan_wa_outbox old ON old.event_id=l.event_id
      WHERE l.device_serial=${serial} AND be.event_id IS NULL AND old.event_id IS NULL
        AND l.received_at>=${activation}::timestamptz
        AND l.device_time ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
        AND (l.device_time::timestamp AT TIME ZONE 'Asia/Jakarta')<=now()+interval '2 minutes'
      ORDER BY l.received_at,l.event_id LIMIT 100`);
    if (!pending.rows.length) return;
    const first = new Date(String(pending.rows[0].received_at)).getTime();
    if (Date.now() < first + 120000) return;
    const cutoff = first + 120000;
    const eligible = pending.rows.filter(r => new Date(String(r.received_at)).getTime() < cutoff);
    if (!eligible.length) return;
    const people = new Map<string,{name:string;times:string[]}>();
    for (const r of eligible) {
      const pin = String(r.user_pin);
      const key = String(r.device_serial) + ":" + pin;
      const entry = people.get(key) ?? {name:String(r.display_name).slice(0,80),times:[]};
      entry.times.push(String(r.device_time));
      people.set(key,entry);
    }
    const sorted = [...people.values()].map(person => {
      person.times.sort();
      return person;
    }).sort((a,b)=>a.times[0].localeCompare(b.times[0]));
    const times = eligible.map(r=>String(r.device_time)).sort();
    const lines = sorted.map((person,i) => {
      const repeats = person.times.slice(1).map(t=>t.slice(11)+" WIB").join(", ");
      return `${i+1}. ${person.name} — ${person.times[0].slice(11)} WIB` +
        (repeats ? `\n   Scan ulang: ${repeats}` : "") +
        "\n   Kartu: Belum tersedia\n   Status: Tercatat di mesin, belum diverifikasi";
    });
    const body = [
      "✅ *REKAP ABSENSI GYM SPORT CENTER*",
      "📅 Tanggal: "+times[0].slice(0,10),
      "🕒 Periode: "+times[0].slice(11)+"–"+times[times.length-1].slice(11)+" WIB",
      "📍 Perangkat: X904",
      "",
      "*DAFTAR ABSENSI*",
      ...lines,
      "",
      "*RINGKASAN*",
      "👥 Total orang: "+people.size,
      "📋 Total scan: "+eligible.length,
      "⏳ Status: Observasi mesin, menunggu verifikasi",
      "🏋️ SELAMAT BEROLAHRAGA 🏆",
    ].join("\n");
    const batchId = "x904-lan-digest-" + String(eligible[0].event_id);
    await tx.execute(sql`INSERT INTO sport_center.gym_x904_lan_wa_batches
      (batch_id,group_id,body) VALUES (${batchId},${groupId},${body})
      ON CONFLICT (batch_id) DO NOTHING`);
    for (const row of eligible) {
      await tx.execute(sql`INSERT INTO sport_center.gym_x904_lan_wa_batch_events
        (event_id,batch_id) VALUES (${String(row.event_id)},${batchId})
        ON CONFLICT (event_id) DO NOTHING`);
    }
  });
  } catch (err) {
    // A batch already committed must still be delivered if later scan collection fails.
    console.error("[x904-digest] batch collection failed; continuing to drain pending batches", err);
  }

  // Only one dispatcher can claim a batch; Gateway idempotency is stable across retries.
  const claim = await db.execute(sql`
    UPDATE sport_center.gym_x904_lan_wa_batches b
    SET status='sending',locked_until=now()+interval '2 minutes',attempts=attempts+1
    WHERE b.batch_id IN (
      SELECT batch_id FROM sport_center.gym_x904_lan_wa_batches
      WHERE group_id IN (${sql.join(groupAliases.map(alias => sql`${alias}`), sql`, `)}) AND
        ((status IN ('pending','failed') AND next_attempt_at<=now())
         OR (status='sending' AND locked_until<now()))
      ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING batch_id,body`);
  if (!claim.rows.length) {
    const backlog = await db.execute(sql`SELECT group_id,status,COUNT(*)::int AS count FROM sport_center.gym_x904_lan_wa_batches WHERE status IN ('pending','failed') AND next_attempt_at<=now() GROUP BY group_id,status`);
    console.warn("[x904-digest] no batch claimed", { configuredGroup: groupId, aliases: groupAliases, backlog: backlog.rows });
    return;
  }
  console.info("[x904-digest] batch claimed", { batchId: String(claim.rows[0].batch_id) });
  const batchId = String(claim.rows[0].batch_id);
  try {
    const registeredGroupId = groupId === approvedGroupUuid ? approvedGroupUuid : groupId.endsWith("@g.us")
      ? (await listCstWaGatewayGroups("sport-center-report")).find(g=>g.jid===groupId && g.isActive)?.id
      : groupId;
    if (!registeredGroupId) throw new Error("X904 target group not registered on sport-center-report");
    const result = await sendCstWaGatewayGroupMessage({
      groupId:registeredGroupId,text:String(claim.rows[0].body),idempotencyKey:batchId,
    });
    const delivered = ["delivered","read"].includes(result.status.toLowerCase());
    await db.execute(sql`UPDATE sport_center.gym_x904_lan_wa_batches
      SET status=${delivered?"sent":"pending_ack"},gateway_message_id=${result.messageId},
        locked_until=NULL,sent_at=CASE WHEN ${delivered} THEN now() ELSE sent_at END,last_error=NULL
      WHERE batch_id=${batchId} AND status='sending'`);
  } catch(err) {
    const reason=err instanceof Error?err.message:"gateway_failed";
    await db.execute(sql`UPDATE sport_center.gym_x904_lan_wa_batches
      SET status='failed',locked_until=NULL,next_attempt_at=now()+interval '1 minute',
        last_error=${reason.slice(0,250)}
      WHERE batch_id=${batchId} AND status='sending'`);
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
