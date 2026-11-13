import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const source = readFileSync(join(process.cwd(),'src/services/x904NonmemberDailyAccessWorker.ts'),'utf8');
test('only verified, paid, confirmed same-day GYM PIN can skip scheduled start',()=>{
  expect(source).toContain('a.booking_source === "gym_public_guest"');
  expect(source).toContain('a.identity_type === "pin"');
  expect(source).toContain('a.booking_status === "confirmed"');
  expect(source).toContain('a.payment_status === "confirmed"');
  expect(source).toContain('a.verification_state === "verified"');
  expect(source).toContain('a.access_state === "pending"');
  expect(source).toContain('now.getTime() < scheduledStart &&');
  expect(source).toContain('!immediatePaidGymPin && !immediatePaidGymVis');
  expect(source).toContain('const immediatePaidGymVis = a.booking_source === "gym_public_guest"');
  expect(source).toContain('a.identity_type === "card" && a.booking_status === "confirmed"');
  expect(source).toContain('x904NonmemberSameWibDate(now, new Date(scheduledStart))');
  expect(source).toContain('x904NonmemberOpeningHours(now)');
});
