import { readFileSync } from "node:fs";

describe("signed X904 booking evidence reader migration", () => {
  const file=readFileSync("migrations/20261112_x904_signed_booking_scan_reader.sql","utf8");
  test("permits documented signed punch 0 and 255 for backend only",()=>{
    expect(file).toContain("attendance_status IN (0,255)");
    expect(file).toContain("verification_type IN (1,4,15)");
    expect(file).toContain("FOR SELECT TO sport_center_app");
    expect(file).toContain("capture_source='trusted_vmsc_ingress'");
    expect(file).toContain("evidence_status='protocol_verified'");
  });
  test("does not open public roles or mutate attendance history",()=>{
    expect(file).not.toMatch(/\bTO\s+(?:public|anon|authenticated)\b/i);
    expect(file).not.toMatch(/\b(?:DELETE|TRUNCATE|UPDATE)\s+sport_center\./i);
    expect(file).not.toMatch(/\bGRANT\s+(?:INSERT|UPDATE|DELETE)\b/i);
    expect(file).toContain("X904_ATTESTATION_TABLE_RLS_REQUIRED");
  });
});
