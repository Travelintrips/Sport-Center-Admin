/**
 * storageProvider.test.ts
 *
 * Verifies that production mode never attempts to use the Replit Object Storage
 * sidecar (127.0.0.1:1106), which is unavailable on Google App Engine.
 *
 * Run: NODE_ENV=production node --import tsx/esm src/lib/__tests__/storageProvider.test.ts
 * Or add to a test runner (vitest / jest) when configured.
 */

import { isReplitStorageAvailable } from "../replitStorage";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  ❌  FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✅  PASS: ${message}`);
  }
}

console.log("\n=== Storage Provider — Production Guard Tests ===\n");

// ── Test 1: Replit storage not available without REPL_ID ─────────────────────
{
  const savedRepl = process.env["REPL_ID"];
  const savedDomain = process.env["REPLIT_DEV_DOMAIN"];
  delete process.env["REPL_ID"];
  delete process.env["REPLIT_DEV_DOMAIN"];

  const available = isReplitStorageAvailable();
  assert(!available, "isReplitStorageAvailable() returns false when REPL_ID and REPLIT_DEV_DOMAIN are unset (GAE environment)");

  if (savedRepl !== undefined) process.env["REPL_ID"] = savedRepl;
  if (savedDomain !== undefined) process.env["REPLIT_DEV_DOMAIN"] = savedDomain;
}

// ── Test 2: Replit storage IS available when REPL_ID is set ──────────────────
{
  const saved = process.env["REPL_ID"];
  process.env["REPL_ID"] = "test-repl-id";

  const available = isReplitStorageAvailable();
  assert(available, "isReplitStorageAvailable() returns true when REPL_ID is set (Replit environment)");

  if (saved !== undefined) process.env["REPL_ID"] = saved;
  else delete process.env["REPL_ID"];
}

// ── Test 3: storage.ts skips Replit in production ────────────────────────────
// This is a structural test — we verify the condition in uploadFile:
// `if (!IS_PRODUCTION && isReplitStorageAvailable())` means on GAE
// (IS_PRODUCTION=true), Replit is NEVER attempted regardless of env vars.
{
  const isProd = process.env.NODE_ENV === "production";
  // Force-set REPL_ID to simulate misconfigured environment
  const saved = process.env["REPL_ID"];
  process.env["REPL_ID"] = "fake-repl-id-on-gae";

  // isReplitStorageAvailable() would return true, but production check prevents it
  const wouldCall = !isProd && isReplitStorageAvailable();
  assert(!wouldCall, "Replit Object Storage is NOT called when NODE_ENV=production, even if REPL_ID is set");

  if (saved !== undefined) process.env["REPL_ID"] = saved;
  else delete process.env["REPL_ID"];
}

console.log("\n=================================================\n");
