import { PgDialect } from "drizzle-orm/pg-core";
import { recoverPaidGymPostEnrollment } from "./x904PaidGymPostEnrollmentRecovery";
import { pool as appDatabasePool } from "@workspace/db";

const FLAGS = [
  "GYM_X904_POST_ENROLLMENT_RECOVERY_ENABLED",
  "GYM_X904_NONMEMBER_ACCESS_ENABLED",
  "GYM_X904_MANUAL_ACCESS_ENABLED",
  "GYM_X904_USER_WRITE_ENABLED",
  "GYM_X904_NONMEMBER_ONLY_PIN",
  "GYM_X904_AUTOMATIC_REQUESTED_BY",
] as const;
const previous = Object.fromEntries(FLAGS.map(key => [key, process.env[key]]));
const date = new Date("2026-11-19T10:00:00Z"); // 17:00 WIB

function enable() {
  process.env.GYM_X904_POST_ENROLLMENT_RECOVERY_ENABLED="true";
  process.env.GYM_X904_NONMEMBER_ACCESS_ENABLED="true";
  process.env.GYM_X904_MANUAL_ACCESS_ENABLED="true";
  process.env.GYM_X904_USER_WRITE_ENABLED="true";
  process.env.GYM_X904_AUTOMATIC_REQUESTED_BY="301";
  delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
}
afterEach(() => {
  for (const key of FLAGS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key]=previous[key];
  }
});
afterAll(async () => { await appDatabasePool.end(); });

function fakeStore(inserted: boolean, updateAccepted=true) {
  const texts: string[]=[];
  let txCalls=0;
  const dialect=new PgDialect();
  const tx={
    execute: async (query:any) => {
      const text=dialect.sqlToQuery(query).sql;
      texts.push(text);
      if (text.includes("INSERT INTO sport_center.x904_nonmember_daily_access"))
        return {rows: inserted ? [{access_id:7,booking_id:1829,payment_id:899,user_pin:"16",device_uid:345}] : []};
      if (text.includes("UPDATE sport_center.x904_nonmember_daily_access"))
        return {rows:updateAccepted?[{access_id:7}]:[]};
      return {rows:[]};
    },
  };
  const store={transaction:async (fn:any) => {txCalls++;return fn(tx)}};
  return {store:store as any,texts,called:()=>txCalls};
}
test("default OFF cannot create any paid grant", async () => {
  enable();
  process.env.GYM_X904_POST_ENROLLMENT_RECOVERY_ENABLED="false";
  const fake=fakeStore(true);
  expect(await recoverPaidGymPostEnrollment(fake.store,date,301)).toBe(0);
  expect(fake.called()).toBe(0);
});
test("reject invalid actor, rollout PIN restriction, or closed Gym", async () => {
  enable();
  const f=fakeStore(true);
  expect(await recoverPaidGymPostEnrollment(f.store,date,0)).toBe(0);
  process.env.GYM_X904_NONMEMBER_ONLY_PIN="16";
  expect(await recoverPaidGymPostEnrollment(f.store,date,301)).toBe(0);
  delete process.env.GYM_X904_NONMEMBER_ONLY_PIN;
  expect(await recoverPaidGymPostEnrollment(f.store,new Date("2026-11-19T17:00:00Z"),301)).toBe(0);
  expect(f.called()).toBe(0);
});
test("exact paid/approved identity + fresh Group 2 route creates ONLY scoped PIN grant and audit", async () => {
  enable();
  const f=fakeStore(true);
  expect(await recoverPaidGymPostEnrollment(f.store,date,301)).toBe(1);
  expect(f.called()).toBe(1);
  const all=f.texts.join("\n");
  for(const proof of [
    "FINAL_PAYMENT_APPROVED", "gym_public_guest", "23:00", "group",
    "sport_center.x904_verified_nonmember_identities",
    "sport_center.gym_vis_card_reservations",
    "sport_center.gym_x904_member_mapping",
    "sport_center.gym_x904_access_snapshots",
    "x904_guest_pin_post_enrollment_auto_recovered",
  ]) expect(all).toContain(proof);
  expect(all).not.toContain("INSERT INTO sport_center.x904_user_commands");
  expect(all).not.toContain("UPDATE sport_center.sport_payments");
  expect(all).not.toContain("ACTIVATE_USER");
});
test("no eligible paid booking is an idempotent no-op", async () => {
  enable();
  const f=fakeStore(false);
  expect(await recoverPaidGymPostEnrollment(f.store,date,301)).toBe(0);
  expect(f.texts.some(x=>x.includes("INSERT INTO sport_center.audit_logs"))).toBe(false);
});
test("failed verification cannot claim success or write audit", async () => {
  enable();
  const f=fakeStore(true,false);
  await expect(recoverPaidGymPostEnrollment(f.store,date,301)).rejects.toThrow("GRANT_AUTHORIZATION_FAILED");
  expect(f.texts.some(x=>x.includes("INSERT INTO sport_center.audit_logs"))).toBe(false);
});
