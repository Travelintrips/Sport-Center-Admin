import { jest } from '@jest/globals';
jest.unstable_mockModule('@workspace/db',()=>({db:{execute:jest.fn()}}));
const {processX904GuestBookingLifecycle}=await import('./x904GuestBookingLifecycle.js');
test('disabled by default, never reads or changes bookings',async()=>{
  const prev=process.env.GYM_X904_GUEST_BOOKING_LIFECYCLE_ENABLED;
  delete process.env.GYM_X904_GUEST_BOOKING_LIFECYCLE_ENABLED;
  const store={execute:jest.fn(async()=>({rows:[]}))};
  try { await processX904GuestBookingLifecycle(store as any);expect(store.execute).not.toHaveBeenCalled(); }
  finally { if(prev===undefined)delete process.env.GYM_X904_GUEST_BOOKING_LIFECYCLE_ENABLED;else process.env.GYM_X904_GUEST_BOOKING_LIFECYCLE_ENABLED=prev; }
});
test('enabled path requires paid verified guest, real UID-matched scan, expired access and suspend ACK',async()=>{
  const prev=process.env.GYM_X904_GUEST_BOOKING_LIFECYCLE_ENABLED;
  process.env.GYM_X904_GUEST_BOOKING_LIFECYCLE_ENABLED='true';
  const store={execute:jest.fn(async(query:any)=>{
    const statement=query.queryChunks.map((x:any)=>typeof x==='string'?x:(x.value?.join?.('')??'')).join('');
    for(const condition of ["b.source='gym_public_guest'","l.device_uid=a.device_uid","p.status='confirmed'","a.access_state='expired'","readBackConfirmed'='true'","afterGroup'='2'","b.checked_in_at IS NULL"])
      expect(statement).toContain(condition);
    return {rows:[{id:1809,order_number:'SC-1773'}]};
  })};
  try {expect(await processX904GuestBookingLifecycle(store as any,new Date('2026-11-11T16:10:00Z'))).toHaveLength(1);}
  finally {if(prev===undefined)delete process.env.GYM_X904_GUEST_BOOKING_LIFECYCLE_ENABLED;else process.env.GYM_X904_GUEST_BOOKING_LIFECYCLE_ENABLED=prev;}
});
