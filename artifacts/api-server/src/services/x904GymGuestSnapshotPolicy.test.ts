import { x904CurrentGymGuestInSnapshot } from "./x904GymGuestSnapshotPolicy";

describe("X904 paid-guest checkout requires a recent physical inventory image",()=>{
  const now=Date.parse("2026-11-17T07:00:00.000Z");
  const user={pin:"345",name:"TEST REGISTERED",role:0,group:2,enabled:true};
  const make=(users:unknown[]= [user], observed_at="2026-11-17T06:59:00.000Z")=>({
    observed_at,user_count:users.length,users
  });
  test("valid verified machine identity is accepted without requiring an active Group 1",()=>{
    expect(x904CurrentGymGuestInSnapshot(make(),"345","TEST REGISTERED",now)).toBe(true);
    expect(x904CurrentGymGuestInSnapshot(make([{...user,group:1}]),"345","test  registered",now)).toBe(true);
  });
  test("stale or missing machine image must stop payment before booking",()=>{
    expect(x904CurrentGymGuestInSnapshot(null,"345","TEST REGISTERED",now)).toBe(false);
    expect(x904CurrentGymGuestInSnapshot(make([]),"345","TEST REGISTERED",now)).toBe(false);
    expect(x904CurrentGymGuestInSnapshot(make([user],"2026-11-17T06:54:00.000Z"),"345","TEST REGISTERED",now)).toBe(false);
    expect(x904CurrentGymGuestInSnapshot(make([user],"2026-11-17T07:01:00.000Z"),"345","TEST REGISTERED",now)).toBe(false);
    expect(x904CurrentGymGuestInSnapshot({...make(),user_count:999},"345","TEST REGISTERED",now)).toBe(false);
  });
  test("wrong PIN/name, disabled, privileged, duplicate and invalid groups are rejected",()=>{
    expect(x904CurrentGymGuestInSnapshot(make(),"999","TEST REGISTERED",now)).toBe(false);
    expect(x904CurrentGymGuestInSnapshot(make(),"345","OTHER",now)).toBe(false);
    expect(x904CurrentGymGuestInSnapshot(make([{...user,enabled:false}]),"345","TEST REGISTERED",now)).toBe(false);
    expect(x904CurrentGymGuestInSnapshot(make([{...user,role:14}]),"345","TEST REGISTERED",now)).toBe(false);
    expect(x904CurrentGymGuestInSnapshot(make([{...user,group:3}]),"345","TEST REGISTERED",now)).toBe(false);
    expect(x904CurrentGymGuestInSnapshot(make([user,user]),"345","TEST REGISTERED",now)).toBe(false);
  });
});
