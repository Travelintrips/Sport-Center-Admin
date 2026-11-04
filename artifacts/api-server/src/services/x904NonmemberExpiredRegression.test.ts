import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Jest runs this workspace with artifacts/api-server as its working directory.
// __dirname is unavailable in the ESM runner used by GitHub Actions.
const worker = readFileSync(join(process.cwd(), 'src/services/x904NonmemberDailyAccessWorker.ts'), 'utf8');

describe('X904 nonmember expired state regression guard', () => {
  test('completed expired grants are not selected for reprocessing', () => {
    expect(worker).toContain("a.access_state IN ('pending','active')");
    expect(worker).toContain("a.access_state <> 'expired' AND p.status::text IN ('cancelled','rejected','refunded')");
    expect(worker).not.toContain("a.access_state IN ('pending','active','expired')");
  });
  test('completed readback still marks eligible suspension as expired', () => {
    expect(worker).toContain("SET access_state='expired'");
    expect(worker).toContain('last.result as any)?.readBackConfirmed === true');
  });
  test('all nonmember card and PIN grants require matching suspend ACK before expiry', () => {
    expect(worker).toContain("a.identity_type IN ('card','pin')");
    expect(worker).toContain("if (currentGroup === targetGroup && last.command_type === commandType)");
    expect(worker).toContain("SET access_state='review_required'");
    expect(worker).toContain("Group 2 alone does not prove this worker suspended the paid access");
    const group2Fallback = worker.slice(worker.indexOf("if (currentGroup === targetGroup) {"));
    expect(group2Fallback).not.toContain("SET access_state='expired'");
  });
});

test("paid expired review_required grants are eligible for safe reconciliation only after verified activation", () => {
  expect(worker).toContain("a.access_state='review_required' AND a.activated_at IS NOT NULL AND a.expires_at<=${now}");
  expect(worker).toContain("if (owners.rows.length > 0)");
  expect(worker).toContain("if (overlapping.rows.length) return");
  expect(worker).toContain("last.result as any)?.readBackConfirmed === true");
});
