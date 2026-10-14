import { test } from "node:test";
import { strict as assert } from "node:assert";
import { deviceTimestamp, normalizeUsers, normalizeLogs, sendSnapshot } from "./x904-almano-prod-snapshot.mjs";

const users = normalizeUsers([{uid: 1, role: 0, userId: "123", name: "Gym Member", password: "DO_NOT_EXPORT", cardno: 9182}]);
const logs = normalizeLogs([{userSn: 1, deviceUserId: "123", recordTime: new Date(2026, 9, 14, 14, 3, 5)}]);
const base = { endpoint: "https://nzdweipzckfszczzqtuw.supabase.co/functions/v1/x904-lan-prod/api", serial: "TDBD234200545", ingestKey: "e".repeat(48), users, logs,
  snapshotId: "eca99644-16da-44de-91f5-442ce935b0cf" };

test("sanitizes credential, card and biometric fields", () => {
  assert.deepEqual(users, [{pin: "123", uid: 1, name: "Gym Member", role: 0}]);
  assert.deepEqual(logs, [{index: 0, pin: "123", uid: 1, occurred: "2026-10-14 14:03:05"}]);
  assert.equal(deviceTimestamp(new Date(2026, 9, 14, 14, 3, 5)), "2026-10-14 14:03:05");
  assert.throws(() => normalizeUsers([{...users[0]}, {...users[0]}]), /INVALID_USER_DATA/);
  assert.throws(() => normalizeLogs([{deviceUserId: "", userSn: 1, recordTime: new Date()}]), /INVALID_LOG_DATA/);
});

test("accepts only verified durable user and log ACK", async () => {
  const stages = [];
  const fake = async (url, opts) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(opts.body);
    stages.push(path);
    assert.equal(opts.headers["x-gym-lan-key"], base.ingestKey);
    assert.equal(body.readAuthenticated, true);
    assert.equal(body.snapshotId, base.snapshotId);
    const response = {ok: true, snapshotId: base.snapshotId};
    if (path.endsWith("/users")) response.acknowledged = body.users.length;
    if (path.endsWith("/logs")) { response.acknowledged = body.events.length; response.storedOrRefreshed = body.events.length; }
    if (path.endsWith("/complete")) { response.verifiedStored = true; response.users = 1; response.logs = 1; }
    return {ok: true, json: async () => response};
  };
  const result = await sendSnapshot({...base, fetchImpl: fake});
  assert.deepEqual(stages, [
    "/functions/v1/x904-lan-prod/api/internal/gym-x904/lan/users",
    "/functions/v1/x904-lan-prod/api/internal/gym-x904/lan/logs",
    "/functions/v1/x904-lan-prod/api/internal/gym-x904/lan/complete",
  ]);
  assert.equal(result.durableAck, true);
  assert.equal(result.logs, 1);
});

test("rejects unauthorised target, incomplete ACK and never advances to completion", async () => {
  await assert.rejects(sendSnapshot({...base, endpoint:"http://dev.example.com/api", fetchImpl:async()=>{throw Error("should not connect")}}), /UNAPPROVED_PROD_ENDPOINT/);
  await assert.rejects(sendSnapshot({...base, endpoint:"https://sportcenter.travelintrips.co.id/api", fetchImpl:async()=>{throw Error("should not connect")}}), /UNAPPROVED_PROD_ENDPOINT/);
  let calls = 0;
  await assert.rejects(sendSnapshot({...base, fetchImpl:async () => {
    calls++;
    return {ok:true,json:async()=>({ok:true,snapshotId:base.snapshotId,acknowledged:0})};
  }}), /INCOMPLETE_USER_ACK/);
  assert.equal(calls,1);
});

test("accepts no success when final durable ACK fails", async () => {
  let called = 0;
  await assert.rejects(sendSnapshot({...base, fetchImpl: async (url,opts) => {
    called++;
    const path=new URL(url).pathname;
    const body=JSON.parse(opts.body);
    const reply = {ok:true,snapshotId:base.snapshotId};
    if(path.endsWith("/users")) reply.acknowledged=body.users.length;
    if(path.endsWith("/logs")) {reply.acknowledged=body.events.length;reply.storedOrRefreshed=body.events.length;}
    if(path.endsWith("/complete")) {reply.verifiedStored=true;reply.users=1;reply.logs=0;}
    return {ok:true,json:async()=>reply};
  }}), /INCOMPLETE_DURABLE_ACK/);
  assert.equal(called,3);
});

test("never accepts a failed HTTP status as ACK", async () => {
  await assert.rejects(sendSnapshot({...base,fetchImpl:async()=>({ok:false,status:403})}), /INGEST_HTTP_403/);
});
