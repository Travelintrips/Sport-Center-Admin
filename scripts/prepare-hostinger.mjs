import path from "node:path";
import { cp, mkdir, rm, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const apiDist = path.join(repoRoot, "artifacts", "api-server", "dist");
const webDist = path.join(repoRoot, "artifacts", "sport-center", "dist", "public");
const outputDir = path.join(repoRoot, "dist");

async function assertDirectory(dir, label) {
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) {
      throw new Error(`${label} is not a directory: ${dir}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("is not a directory")) {
      throw error;
    }
    throw new Error(`${label} is missing: ${dir}`);
  }
}

await assertDirectory(apiDist, "API build output");
await assertDirectory(webDist, "Sport Center build output");

// Block a misleading successful release when a cached Gym X904 chunk is stale.
const assets = await readdir(path.join(webDist, "assets"));
const gymChunks = assets.filter((name) => /^GymX904-.*\.js$/.test(name));
if (gymChunks.length !== 1) throw new Error("Expected exactly one GymX904 production JS chunk");
const gymScript = await readFile(path.join(webDist, "assets", gymChunks[0]), "utf8");
if (!gymScript.includes("Sinkronisasi LAN via VMSC") ||
    gymScript.includes("Sinkronisasi LAN via ALMANO")) {
  throw new Error("Stale Gym X904 frontend detected: refusing Hostinger release");
}


await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(apiDist, outputDir, { recursive: true });
await cp(webDist, path.join(outputDir, "public"), { recursive: true });

// Tesseract.js otherwise downloads English language data at runtime. Hostinger
// may not allow/reliably reach that CDN, so ship the traineddata with the app.
await cp(
  path.join(repoRoot, "eng.traineddata"),
  path.join(outputDir, "eng.traineddata"),
);

await writeFile(
  path.join(outputDir, "index.js"),
  [
    '"use strict";',
    'console.log("[hostinger] dist launcher starting");',
    'import("./index.mjs").catch((error) => {',
    '  console.error("[hostinger] dist launcher failed", error);',
    '  process.exit(1);',
    '});',
    "",
  ].join("\n"),
  "utf8",
);

console.log("Prepared Hostinger Sport Center production bundle in ./dist");
