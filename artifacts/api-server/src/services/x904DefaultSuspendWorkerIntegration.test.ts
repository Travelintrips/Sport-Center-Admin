import { jest } from "@jest/globals";
jest.unstable_mockModule("@workspace/db", () => ({ db: { execute: jest.fn(), transaction: jest.fn() } }));
const { processX904NewOrdinaryUserDefaultSuspend } = await import("./x904NewOrdinaryUserDefaultSuspend.js");

const observedAt = new Date("2026-11-12T05:03:00.000Z");
const oldUser = { pin: "50", name: "EXISTING", role: 0, group: 2, enabled: true };
const newUser = { pin: "801", name: "NEW VISITOR", role: 0, group: 1, enabled: true };
const snapshots = [
  {snapshot_id: 101, observed_at: new Date("2026-11-12T05:00:00Z"), user_count: 1, users: [oldUser]},
  {snapshot_id: 102, observed_at: observedAt, user_count: 2, users: [oldUser,newUser]},
  {snapshot_id: 103, observed_at: new Date("2026-11-12T05:06:00Z"), user_count: 2, users: [oldUser,newUser]},
];
const keys = [
  "GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED",
  "GYM_X904_NONMEMBER_ACCESS_ENABLED",
  "GYM_X904_MANUAL_ACCESS_ENABLED",
  "GYM_X904_USER_WRITE_ENABLED",
  "GYM_X904_NEW_USER_IDENTITY_AUDIT_ENABLED",
  "GYM_X904_AUTOMATIC_REQUESTED_BY",
  "GYM_X904_NEW_USER_BASELINE_AT",
  "GYM_X904_NEW_USER_ONLY_PIN",
] as const;

function makeStore(options: { handled?: boolean; pendingGrant?: boolean; verifiedRegistry?: boolean; historicalReenrollment?: boolean } = {}) {
  let outside = 0, inside = 0;
  const txExecute = jest.fn(async () => {
    inside++;
    if (inside === 2) return { rows: [{snapshot_id: 103}] };
    if (inside === 3) return {rows: options.historicalReenrollment
      ? [{snapshot_id: 50, observed_at: new Date("2026-11-11T05:00:00Z"), previous: {name:"OLD VISITOR",role:0}}]
      : []};
    if (inside === 4 && options.historicalReenrollment) return {rows:[{n:3}]};
    const inventoryStep = options.historicalReenrollment ? 5 : 4;
    if (inside === inventoryStep) return {rows:[{device_uid:801,display_name:"NEW VISITOR",device_role:0}]};
    if (inside === inventoryStep+2 && options.pendingGrant) return {rows:[{exists:true}]};
    if (inside === inventoryStep+4 && options.verifiedRegistry) return {rows:[{exists:true}]};
    return {rows:[]};
  });
  const store = {
    execute: jest.fn(async () => {
      outside++;
      if (outside===1) return {rows:[{ok:1}]};
      if (outside===2) return {rows:[]};
      if (outside===3) return {rows:[{overdue_count:0}]};
      if (outside===4) return {rows:[...snapshots].reverse()};
      if (outside===5) return {rows:options.handled ? [{user_pin:"801",latest_command_at:new Date("2026-11-12T05:04:00Z")}] : []};
      throw new Error("unexpected top-level query");
    }),
    transaction: jest.fn(async (callback: (tx: any) => Promise<any>) => callback({execute:txExecute})),
  };
  return {store,txExecute};
}

describe("X904 30-minute default suspend: isolated worker execution", () => {
  const saved = Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  beforeEach(() => {
    process.env.GYM_X904_NEW_USER_DEFAULT_SUSPEND_ENABLED="true";
    process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED="true";
    process.env.GYM_X904_MANUAL_ACCESS_ENABLED="true";
    process.env.GYM_X904_USER_WRITE_ENABLED="true";
    process.env.GYM_X904_NEW_USER_IDENTITY_AUDIT_ENABLED="false";
    process.env.GYM_X904_AUTOMATIC_REQUESTED_BY="301";
    process.env.GYM_X904_NEW_USER_BASELINE_AT="2026-11-12T04:59:00Z";
    delete process.env.GYM_X904_NEW_USER_ONLY_PIN;
  });
  afterAll(() => {
    for (const k of keys) {
      if (saved[k]===undefined) delete process.env[k];
      else process.env[k]=saved[k];
    }
  });
  test("new role-0 snapshot queues one guarded device command", async () => {
    const {store,txExecute}=makeStore();
    await processX904NewOrdinaryUserDefaultSuspend(store as any,new Date("2026-11-12T05:08:00Z"));
    expect(store.transaction).toHaveBeenCalledTimes(1);
    expect(txExecute).toHaveBeenCalledTimes(9);
  });
  test("already handled in this enrollment epoch never queues again", async () => {
    const {store}=makeStore({handled:true});
    await processX904NewOrdinaryUserDefaultSuspend(store as any,new Date("2026-11-12T05:08:00Z"));
    expect(store.transaction).not.toHaveBeenCalled();
  });
  test("pending paid entitlement is never suspended", async () => {
    const {store,txExecute}=makeStore({pendingGrant:true});
    await processX904NewOrdinaryUserDefaultSuspend(store as any,new Date("2026-11-12T05:08:00Z"));
    expect(txExecute).toHaveBeenCalledTimes(6);
  });
  test("verified reused PIN without revocation cannot be queued", async () => {
    const {store,txExecute}=makeStore({historicalReenrollment:true,verifiedRegistry:true});
    await processX904NewOrdinaryUserDefaultSuspend(store as any,new Date("2026-11-12T05:08:00Z"));
    expect(txExecute).toHaveBeenCalledTimes(9);
  });
  test("reused PIN with two absence snapshots and revoked registry can queue once", async () => {
    const {store,txExecute}=makeStore({historicalReenrollment:true});
    await processX904NewOrdinaryUserDefaultSuspend(store as any,new Date("2026-11-12T05:08:00Z"));
    expect(txExecute).toHaveBeenCalledTimes(10);
  });
});
