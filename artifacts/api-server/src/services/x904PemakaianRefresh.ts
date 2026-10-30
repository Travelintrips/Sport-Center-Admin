import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendRekapPemakaianToAdmin } from "../lib/rekapPemakaian";

/**
 * Refresh the EXISTING Pemakaian Sport Center WA report for new X904 auto check-ins.
 * Manual check-in and ordinary booking paths still call sendRekapPemakaianToAdmin.
 * Ambiguous transport results are never retried automatically: sending twice to
 * the group is worse than flagging a delivery for investigation.
 */
export async function dispatchX904PemakaianRefresh(): Promise<void> {
  const eligible = await db.execute(sql`
    SELECT report_date,version FROM sport_center.x904_gym_usage_wa_queue
    WHERE report_date=(now() AT TIME ZONE 'Asia/Jakarta')::date
      AND version>0 ORDER BY report_date DESC LIMIT 1`);
  if (!eligible.rows.length) return;
  const day = String(eligible.rows[0].report_date).slice(0,10);
  const version = Number(eligible.rows[0].version);
  await db.execute(sql`INSERT INTO sport_center.x904_pemakaian_refresh(report_date)
    VALUES (${day}::date) ON CONFLICT(report_date) DO NOTHING`);
  const claimed = await db.execute(sql`UPDATE sport_center.x904_pemakaian_refresh
    SET status='sending',claimed_version=${version},claimed_at=now(),updated_at=now()
    WHERE report_date=${day}::date AND status IN ('pending','sent')
      AND notified_version<${version}
    RETURNING claimed_version`);
  if (!claimed.rows.length) return;
  try {
    const dispatched = await sendRekapPemakaianToAdmin(day);
    if (!dispatched) {
      await db.execute(sql`UPDATE sport_center.x904_pemakaian_refresh
        SET status='pending',claimed_at=NULL,updated_at=now()
        WHERE report_date=${day}::date AND status='sending' AND claimed_version=${version}`);
      return;
    }
    await db.execute(sql`UPDATE sport_center.x904_pemakaian_refresh
      SET status='sent',notified_version=${version},claimed_at=NULL,
          last_error=NULL,updated_at=now()
      WHERE report_date=${day}::date AND status='sending' AND claimed_version=${version}`);
  } catch (err) {
    const reason=err instanceof Error ? err.message : 'UNKNOWN_WA_ERROR';
    await db.execute(sql`UPDATE sport_center.x904_pemakaian_refresh
      SET status='unknown',last_error=${reason.slice(0,200)},updated_at=now()
      WHERE report_date=${day}::date AND status='sending' AND claimed_version=${version}`);
  }
}
