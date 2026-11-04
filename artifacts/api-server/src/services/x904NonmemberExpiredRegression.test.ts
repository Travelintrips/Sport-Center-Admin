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
    expect(worker).toContain("access_state=${unpaidVis006 ? 'pending' : 'expired'}");
    expect(worker).toContain('last.result as any)?.readBackConfirmed === true');
  });
});
