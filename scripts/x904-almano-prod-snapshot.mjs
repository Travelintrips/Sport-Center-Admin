import { randomUUID } from "node:crypto";

const pinPattern = /^[A-Za-z0-9_-]{1,50}$/;
const stamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const intRange = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;

export function deviceTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("INVALID_DEVICE_TIME");
  const fmt = (v) => String(v).padStart(2, "0");
  const text = [
    String(date.getFullYear()).padStart(4, "0"), "-",
    fmt(date.getMonth() + 1), "-", fmt(date.getDate()), " ",
    fmt(date.getHours()), ":", fmt(date.getMinutes()), ":", fmt(date.getSeconds()),
  ].join("");
  if (!stamp.test(text)) throw new Error("INVALID_DEVICE_TIME");
  return text;
}

export function normalizeUsers(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 500) throw new Error("INVALID_USER_COUNT");
  const seen = new Set();
  return rows.map((row) => {
    const pin = String(row?.userId ?? "").trim();
    const name = String(row?.name ?? "").trim();
    if (!pinPattern.test(pin) || seen.has(pin) || !intRange(row?.uid, 0, 65535) ||
        !intRange(row?.role, 0, 255) || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) {
      throw new Error("INVALID_USER_DATA");
    }
    seen.add(pin);
    // NEVER forward password, card number, fingerprints or other fields from the SDK.
    return { pin, uid: row.uid, name, role: row.role };
  });
}

export function normalizeLogs(rows) {
  if (!Array.isArray(rows) || rows.length > 1000000) throw new Error("INVALID_LOG_COUNT");
  return rows.map((row, index) => {
    const pin = String(row?.deviceUserId ?? "").trim();
    const uid = row?.userSn;
    if (!pinPattern.test(pin) || !intRange(uid, 0, 65535)) throw new Error("INVALID_LOG_DATA");
    return { index, pin, uid, occurred: deviceTimestamp(row.recordTime) };
  });
}

export async function sendSnapshot({ endpoint, serial, ingestKey, users, logs,
                                     fetchImpl = fetch, snapshotId = randomUUID() }) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.hostname !== "nzdweipzckfszczzqtuw.supabase.co" ||
      url.pathname !== "/functions/v1/x904-lan-prod/api") {
    throw new Error("UNAPPROVED_PROD_ENDPOINT");
  }
  if (serial !== "TDBD234200545" || !/^[A-Za-z0-9_-]{4,100}$/.test(serial) ||
      typeof ingestKey !== "string" || ingestKey.length < 32) throw new Error("INVALID_CONNECTOR_CONFIGURATION");
  if (!Array.isArray(users) || users.length < 1 || users.length > 500 ||
      !Array.isArray(logs) || logs.length > 1000000) throw new Error("INVALID_SNAPSHOT");
  const post = async (path, extra) => {
    const result = await fetchImpl(new URL(path, url.href + "/"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-gym-lan-key": ingestKey },
      body: JSON.stringify({ serial, snapshotId, readAuthenticated: true, ...extra }),
      signal: AbortSignal.timeout(25000),
      redirect: "error",
    });
    if (!result.ok) {
      let reason = "UNKNOWN";
      try {
        const failed = await result.json();
        const raw = [failed?.error, failed?.errorClass].filter(v => typeof v === "string").join("_");
        reason = raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "UNKNOWN";
      } catch { /* do not log response bodies or secrets */ }
      throw new Error("INGEST_HTTP_" + result.status + "_" + reason);
    }
    const data = await result.json();
    if (data?.ok !== true || data?.snapshotId !== snapshotId) throw new Error("INVALID_INGEST_ACK");
    return data;
  };
  const acceptedUsers = await post("internal/gym-x904/lan/users", { users, userCount: users.length });
  if (acceptedUsers.acknowledged !== users.length) throw new Error("INCOMPLETE_USER_ACK");
  for (let offset = 0; offset < logs.length; offset += 500) {
    const batch = logs.slice(offset, offset + 500);
    const ack = await post("internal/gym-x904/lan/logs", {
      events: batch, offset, deviceLogCount: logs.length,
    });
    if (ack.acknowledged !== batch.length || ack.storedOrRefreshed !== batch.length) {
      throw new Error("INCOMPLETE_LOG_ACK");
    }
  }
  // The final ACK is accepted ONLY after database counts are verified server-side.
  const receipt = await post("internal/gym-x904/lan/complete", {
    userCount: users.length, deviceLogCount: logs.length,
  });
  if (receipt.verifiedStored !== true || receipt.users !== users.length ||
      receipt.logs !== logs.length) throw new Error("INCOMPLETE_DURABLE_ACK");
  return { users: receipt.users, logs: receipt.logs, durableAck: true, snapshotId };
}
