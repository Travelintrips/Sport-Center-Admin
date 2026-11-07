import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const app = read("artifacts/api-server/src/app.ts");
const main = read("artifacts/sport-center/src/main.tsx");
const admin = read("artifacts/sport-center/src/App.tsx");
const recovery = read("artifacts/sport-center/src/lib/staleChunkRecovery.ts");

test("missing old Vite assets cannot fall through to HTML 200", () => {
  assert.match(app, /app\.use\("\/assets", express\.static/);
  assert.match(app, /fallthrough: false/);
  assert.match(app, /res\.status\(404\)\.type\("text\/plain"\)/);
  assert.match(app, /app\.get\("\/\{\*path\}"/);
  assert.match(app, /Static file not found/);
});
test("HTML revalidates while content-hashed assets cache immutably", () => {
  assert.match(app, /maxAge: "1y"/);
  assert.match(app, /immutable: true/);
  assert.match(app, /no-cache, must-revalidate/);
});
test("stale imports recover once per old entry and route, without endless refresh", () => {
  assert.match(main, /addEventListener\("vite:preloadError"/);
  assert.match(admin, /recoverStaleChunk\(error\)/);
  assert.match(recovery, /Failed to fetch dynamically imported module/);
  assert.match(recovery, /window\.sessionStorage\.getItem\(key\)/);
  assert.match(recovery, /window\.sessionStorage\.setItem\(key, "1"\)/);
  assert.match(recovery, /reloadScheduled = true/);
  assert.match(recovery, /window\.location\.reload\(\)/);
  assert.match(recovery, /if \(!isStaleChunkError\(error\)\) return false/);
});
test("existing error boundary stays available after a failed recovery", () => {
  assert.match(admin, /AdminErrorBoundary/);
  assert.match(admin, /Muat Ulang/);
  assert.match(admin, /this\.state\.error\.message/);
  assert.match(main, /createRoot/);
});
