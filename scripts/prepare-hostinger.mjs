import path from "node:path";
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
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

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(apiDist, outputDir, { recursive: true });
await cp(webDist, path.join(outputDir, "public"), { recursive: true });

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
