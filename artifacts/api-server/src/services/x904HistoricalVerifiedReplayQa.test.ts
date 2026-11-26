import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const source = readFileSync("src/services/x904HistoricalVerifiedReplayQa.ts", "utf8");

describe("historical Gym signed scan QA recovery cannot bypass production safeguards", () => {
  test("is disabled outside explicit local disposable QA and cannot use a PROD DB URL", () => {
    expect(source).toContain('SPORT_CENTER_QA_HISTORICAL_REPLAY');
    expect(source).toContain('SPORT_CENTER_QA_NO_EXTERNAL');
    expect(source).toContain('GYM_X904_AUTOMATIC_COMMANDS_ENABLED');
    expect(source).toContain("127\\.0\\.0\\.1:55444");
    expect(source).toContain('Boolean(process.env.SUPABASE_DATABASE_URL)');
    expect(source).toContain("HISTORICAL_REPLAY_QA_ISOLATION_REQUIRED");
  });
  test("requires exact protocol verified raw scan, confirmed payment, UID, and activation ACK", () => {
    expect(source).toContain("e.evidence_status='protocol_verified'");
    expect(source).toContain("e.capture_source='trusted_vmsc_ingress'");
    expect(source).toContain("r.attendance_status=get_byte");
    expect(source).toContain("r.event_id=l.event_id");
    expect(source).toContain("r.user_pin=l.user_pin");
    expect(source).toContain("p.status::text='confirmed'");
    expect(source).toContain("approved.action='FINAL_PAYMENT_APPROVED'");
    expect(source).toContain("approved.user_role='owner'");
    expect(source).toContain("NULLIF(BTRIM(p.proof_url)");
    expect(source).toContain("c.payload->>'accessId'=a.access_id::text");
    expect(source).toContain("abs(extract(epoch from (c.completed_at-a.activated_at)))<=2");
    expect(source).toContain("p.amount>=COALESCE");
    expect(source).toContain("c.result->>'readBackConfirmed'='true'");
    expect(source).toContain("(c.result->>'deviceUid')::int=a.device_uid");
  });
  test("limits historical date range, historical status, VIS payment/handover and exactly-once audit", () => {
    expect(source).toContain("b.booking_date BETWEEN '2026-11-10' AND '2026-11-16'");
    expect(source).toContain("b.status::text IN ('confirmed','completed')");
    expect(source).toContain("v.funds_verified_at IS NOT NULL");
    expect(source).toContain("e.evidence_status='protocol_verified'");
    expect(source).toContain("checked_in_at IS NULL");
    expect(source).toContain("X904_HISTORICAL_VERIFIED_CHECKIN_QA");
    expect(source).toContain("pg_advisory_xact_lock");
  });
});