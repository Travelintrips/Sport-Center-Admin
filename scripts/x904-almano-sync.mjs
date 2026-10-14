import ZKLib from "node-zklib";
import constants from "node-zklib/constants.js";
import { normalizeUsers, normalizeLogs, sendSnapshot } from "./x904-almano-snapshot.mjs";

const readConfig = () => new Promise((resolve, reject) => {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    text += chunk;
    if (text.length > 8192) reject(new Error("INPUT_TOO_LARGE"));
  });
  process.stdin.on("end", () => {
    try { resolve(JSON.parse(text.trim())); } catch { reject(new Error("INVALID_CONFIG")); }
  });
});
const bounded = async (task, limit, socket) => {
  let timer;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => { timer = setTimeout(() => {
        try { socket?.destroy(); } catch { /* ignore */ }
        reject(new Error("DEVICE_READ_TIMEOUT"));
      }, limit); }),
    ]);
  } finally { clearTimeout(timer); }
};
function buildAuthKey(text, sessionId) {
  if (typeof text !== "string" || !/^\d{1,10}$/.test(text) ||
      BigInt(text) > 4294967295n) throw new Error("INVALID_COMM_KEY");
  let n = BigInt(text), k = 0n;
  for (let i = 0n; i < 32n; i++) k = (k << 1n) | ((n >> i) & 1n);
  const v = Number((k + BigInt(sessionId ?? 0)) & 0xffffffffn);
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  for (let i = 0; i < 4; i++) b[i] ^= [90, 75, 83, 79][i];
  return Buffer.from([b[2] ^ 50, b[3] ^ 50, 50, b[1] ^ 50]);
}

const mode = process.argv.includes("--sync") ? "sync" : "dry-run";
let machine = null;
let stage = "configuration";
try {
  const cfg = await readConfig();
  if (cfg?.target !== "DEV" || !/^192\.168\.100\.185$/.test(cfg.deviceIp ?? "") ||
      typeof cfg.commKey !== "string") throw new Error("INVALID_DEV_CONFIGURATION");
  machine = new ZKLib(cfg.deviceIp, 4370, 8000, 4000);
  stage = "tcp_connect";
  await bounded(() => machine.createSocket(), 15000, machine?.zklibTcp?.socket);
  const tcp = machine.zklibTcp;
  stage = "authentication";
  const packet = buildAuthKey(cfg.commKey, tcp.sessionId);
  const response = await bounded(() => tcp.executeCmd(constants.COMMANDS.CMD_AUTH, packet), 12000, tcp.socket);
  if (!Buffer.isBuffer(response) || response.length < 2 ||
      response.readUInt16LE(0) !== 2000) throw new Error("DEVICE_AUTH_FAILED");
  stage = "device_info";
  const info = await bounded(() => tcp.executeCmd(constants.COMMANDS.CMD_GET_FREE_SIZES, ""), 12000, tcp.socket);
  if (!Buffer.isBuffer(info) || info.length < 76 || info.readUInt16LE(0) !== 2000) {
    throw new Error("DEVICE_INFO_FAILED");
  }
  const reportedUsers = info.readUInt32LE(24), reportedLogs = info.readUInt32LE(40);
  stage = "users";
  const userReply = await bounded(() => tcp.getUsers(), 25000, tcp.socket);
  if (userReply.err) throw new Error("USER_TRANSFER_INCOMPLETE");
  const users = normalizeUsers(userReply.data);
  stage = "logs";
  const logReply = await bounded(() => tcp.getAttendances(() => {}), 90000, tcp.socket);
  if (logReply.err) throw new Error("LOG_TRANSFER_INCOMPLETE");
  const logs = normalizeLogs(logReply.data);
  if (users.length !== reportedUsers || logs.length !== reportedLogs) throw new Error("DEVICE_COUNT_MISMATCH");
  console.log("read_authenticated=true");
  console.log("device_user_count=" + users.length);
  console.log("device_log_count=" + logs.length);
  if (mode === "dry-run") {
    console.log("mode=dry-run; no network upload; machine unchanged");
  } else {
    stage = "dev_ingest";
    const receipt = await sendSnapshot({
      endpoint: cfg.endpoint, serial: cfg.serial, ingestKey: cfg.ingestKey, users, logs,
    });
    console.log("durable_database_ack=" + receipt.durableAck);
    console.log("stored_users=" + receipt.users);
    console.log("stored_logs=" + receipt.logs);
    console.log("snapshot_id=" + receipt.snapshotId);
  }
} catch (error) {
  console.error("FAILED_STAGE=" + stage);
  console.error("failure_code=" + (error instanceof Error ? error.message.replace(/[^A-Z0-9_]/g, "").slice(0, 60) : "UNKNOWN"));
  process.exitCode = 1;
} finally {
  try { await machine?.disconnect(); } catch { /* no device changes */ }
}
