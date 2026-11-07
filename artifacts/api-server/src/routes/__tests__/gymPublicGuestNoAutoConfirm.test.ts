import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('gym public guest payment proof safety', () => {
  test('gym_public_guest is explicitly excluded from proof auto-confirm', () => {
    const source = readFileSync(join(process.cwd(), 'src/routes/whatsapp.ts'), 'utf8');
    const start = source.indexOf('const autoConfirmEligible =');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, start + 900);
    expect(block).toContain('booking.source !== "gym_public_guest"');
    expect(block).toContain('booking.status === "pending_payment"');
  });
});
