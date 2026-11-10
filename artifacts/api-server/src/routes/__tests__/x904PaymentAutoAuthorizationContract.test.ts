import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(process.cwd(),'src/routes/payments.ts'),'utf8');
describe('Gym verified PIN auto authorization on confirmed payment',()=>{
  const scope = src.slice(src.indexOf('// A verified machine PIN needs no second financial confirmation.'),src.indexOf('return claimed;',src.indexOf('// A verified machine PIN needs no second financial confirmation.')));
  test('requires actual confirmed full payment, matching verified registry and device inventory',()=>{
    expect(scope).toContain('status === "confirmed"');
    expect(scope).toContain('claimed.paymentType !== "dp"');
    expect(scope).toContain("r.verification_state='verified'");
    expect(scope).toContain('r.revoked_at IS NULL');
    expect(scope).toContain('u.device_role=0');
    expect(scope).toContain('a.payment_id=${claimed.id}');
    expect(scope).toContain('claimed.proofUrl');
    expect(scope).toContain('gym_x904_member_mapping');
  });
  test('fresh authenticated snapshot, exact identity, atomic audit, no machine command',()=>{
    expect(scope).toContain('gym_x904_access_snapshots');
    expect(scope).toContain('users.length===Number(last.user_count)');
    expect(scope).toContain('String(grant.verified_name)');
    expect(scope).toContain("SET verification_state='verified',access_state='pending'");
    expect(scope).toContain('tx.insert(auditLogsTable)');
    expect(scope).not.toContain('INSERT INTO sport_center.x904_user_commands');
  });
});
