import { x904CourtAccessWindow, x904CourtAdmissionAllowed } from './x904CourtAccessWindow';
const date = '2026-11-27';
const at = (t: string) => new Date(`${date}T${t}+07:00`);
const base = { date, start:'19:00', end:'21:00', now:at('19:30:00'), confirmedAt:at('18:00:00'), paymentStatus:'confirmed', bookingStatus:'confirmed', verified:true };
describe('strict court access policy for verified PIN and VIS', () => {
  test.each(['PIN','VIS'])('%s allows only the booked interval', () => {
    expect(x904CourtAdmissionAllowed({...base,now:at('18:59:59')})).toBe(false);
    expect(x904CourtAdmissionAllowed({...base,now:at('19:00:00')})).toBe(true);
    expect(x904CourtAdmissionAllowed(base)).toBe(true);
    expect(x904CourtAdmissionAllowed({...base,now:at('21:00:00')})).toBe(false);
  });
  test.each(['cancelled','completed','pending_payment'])('rejects booking %s', bookingStatus => expect(x904CourtAdmissionAllowed({...base,bookingStatus})).toBe(false));
  test.each(['pending','rejected','refunded'])('rejects payment %s', paymentStatus => expect(x904CourtAdmissionAllowed({...base,paymentStatus})).toBe(false));
  test('requires verified identity and prior confirmation', () => {
    expect(x904CourtAdmissionAllowed({...base,verified:false})).toBe(false);
    expect(x904CourtAdmissionAllowed({...base,confirmedAt:null})).toBe(false);
    expect(x904CourtAdmissionAllowed({...base,confirmedAt:at('20:00:00')})).toBe(false);
  });
  test.each([['23:00','06:00'],['05:00','07:00'],['21:00','23:01'],['19:00','19:00'],['19:99','21:00'],['21:00','23:00:01'],['05:59:59','07:00'],['24:00','23:00']])('rejects invalid window %s–%s', (start,end) => expect(x904CourtAccessWindow(date,start,end)).toBeNull());
});
