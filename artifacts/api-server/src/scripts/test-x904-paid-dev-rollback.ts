import { randomBytes, randomUUID } from "node:crypto";
if (process.env.NODE_ENV !== "development") throw Error("DEV_ONLY");
const url = process.env.SUPABASE_DATABASE_URL_DEV;
if (!url || !new URL(url).username.endsWith(".xssrfshdrtdfupgqwfdw")) throw Error("WRONG_DEV_DATABASE");
const { db, pool } = await import("@workspace/db");
const { sql } = await import("drizzle-orm");
const id = randomBytes(12).toString("hex");
const email = `x904-paid-${id}@example.invalid`;
const pin = String(10000000 + randomBytes(4).readUInt32BE(0) % 80000000);
const name = `X904 Paid DEV ${id}`;
const marker = `X904-PAID-DEV-${id}`;
let passed = false;
try {
  try {
    await db.transaction(async tx => {
      const user = await tx.execute(sql`INSERT INTO sport_center.users (name,email,phone,role) VALUES (${name},${email},${"000"+pin},'customer') RETURNING id`);
      const customerId = Number(user.rows[0]?.id);
      const membership = await tx.execute(sql`INSERT INTO sport_center.sport_memberships (name,email,phone,start_date,end_date,months,total_price,status,notes) VALUES (${name},${email},${"000"+pin},'2026-11-04','2026-12-04',1,300000,'pending_payment',${marker}) RETURNING id`);
      const membershipId = Number(membership.rows[0]?.id);
      await tx.execute(sql`INSERT INTO sport_center.gym_x904_lan_users (device_serial,user_pin,device_uid,display_name,device_role,last_seen_snapshot) VALUES ('TDBD234200545',${pin},999999,${name},0,${randomUUID()}::uuid)`);
      await tx.execute(sql`INSERT INTO sport_center.gym_x904_member_mapping (device_serial,user_pin,membership_id,status,verified_at,verified_by) VALUES ('TDBD234200545',${pin},${membershipId},'verified',now(),'paid-dev-rollback-test')`);
      const payment = await tx.execute(sql`INSERT INTO sport_center.sport_membership_payments (membership_id,period_start,period_end,months,amount,status,payment_method,payment_proof_url) VALUES (${membershipId},'2026-11-04','2026-12-04',1,300000,'waiting_confirmation','qris',${"dev://"+marker}) RETURNING id`);
      const paymentId = Number(payment.rows[0]?.id);
      await tx.execute(sql`INSERT INTO sport_center.sport_bookings (order_number,customer_name,customer_email,customer_phone,facility_id,booking_date,start_time,end_time,duration_hours,total_price,status,membership_id,membership_payment_id,customer_id,source) VALUES (${marker},${name},${email},${"000"+pin},6,'2026-11-04','00:00','00:00',0,300000,'pending_payment',${membershipId},${paymentId},${customerId},'gym_membership_payment')`);
      await tx.execute(sql`UPDATE sport_center.sport_membership_payments SET status='confirmed',confirmed_at=now(),settlement_provider_code='mandiri_direct',mutation_key=${marker},accounting_ref=${marker},updated_at=now() WHERE id=${paymentId}`);
      await tx.execute(sql`UPDATE sport_center.sport_memberships SET status='active' WHERE id=${membershipId}`);
      await tx.execute(sql`INSERT INTO sport_center.x904_automatic_entitlement_events (membership_id,payment_id,reason,event_key) VALUES (${membershipId},${paymentId},'PAYMENT_CONFIRMED',${marker}) ON CONFLICT (event_key) DO NOTHING`);
      await tx.execute(sql`INSERT INTO sport_center.x904_automatic_entitlement_events (membership_id,payment_id,reason,event_key) VALUES (${membershipId},${paymentId},'PAYMENT_CONFIRMED',${marker}) ON CONFLICT (event_key) DO NOTHING`);
      const proof = await tx.execute(sql`SELECT (SELECT count(*)::int FROM sport_center.users WHERE id=${customerId}) AS customers,(SELECT count(*)::int FROM sport_center.sport_memberships WHERE id=${membershipId} AND status='active') AS memberships,(SELECT count(*)::int FROM sport_center.sport_membership_payments WHERE id=${paymentId} AND status='confirmed') AS payments,(SELECT count(*)::int FROM sport_center.sport_bookings WHERE membership_payment_id=${paymentId}) AS bookings,(SELECT count(*)::int FROM sport_center.gym_x904_member_mapping WHERE membership_id=${membershipId} AND user_pin=${pin} AND status='verified') AS mappings,(SELECT count(*)::int FROM sport_center.x904_automatic_entitlement_events WHERE event_key=${marker}) AS events`);
      const counts = proof.rows[0];
      console.log("X904_PAID_DEV_COUNTS",JSON.stringify(counts));
      if (!["customers","memberships","payments","bookings","mappings","events"].every(k=>Number(counts?.[k])===1)) throw Error("E2E_COUNTS_FAILED");
      passed = true;
      throw Error("EXPECTED_E2E_ROLLBACK");
    });
  } catch (error) {
    if (!(error instanceof Error && error.message==="EXPECTED_E2E_ROLLBACK" && passed)) throw error;
  }
  const left = await db.execute(sql`SELECT (SELECT count(*)::int FROM sport_center.sport_memberships WHERE notes=${marker}) AS memberships,(SELECT count(*)::int FROM sport_center.x904_automatic_entitlement_events WHERE event_key=${marker}) AS events,(SELECT count(*)::int FROM sport_center.users WHERE email=${email}) AS customers`);
  if (Object.values(left.rows[0] ?? {}).some(n=>Number(n)!==0)) throw Error("ROLLBACK_LEFTOVER");
  console.log("X904_PAID_DEV_E2E_ROLLBACK_PASS");
} finally { await pool.end(); }
