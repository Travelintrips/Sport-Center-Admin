#!/usr/bin/env node
// Removes generated types/* files that conflict with Zod schema const exports in api.ts.
// Orval generates both a Zod const (api.ts) and a TS type (types/*.ts) for params schemas,
// causing TS2308 duplicate export errors when both are re-exported from index.ts.

const fs = require("fs");
const path = require("path");

const zodSrc = path.resolve(__dirname, "../../lib/api-zod/src");
const generatedApi = path.join(zodSrc, "generated/api.ts");
const typesDir = path.join(zodSrc, "generated/types");
const typesIndex = path.join(typesDir, "index.ts");

if (!fs.existsSync(generatedApi)) {
  console.log("generated/api.ts not found, skipping patch");
  process.exit(0);
}

// Collect all names exported as const from api.ts
const apiContent = fs.readFileSync(generatedApi, "utf8");
const constExports = new Set(
  [...apiContent.matchAll(/^export const (\w+)/gm)].map((m) => m[1])
);

if (!fs.existsSync(typesDir)) {
  console.log("generated/types not found, skipping patch");
  process.exit(0);
}

// Convert kebab-case filename to PascalCase type name
function toPascalCase(str) {
  return str
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

let indexContent = fs.existsSync(typesIndex)
  ? fs.readFileSync(typesIndex, "utf8")
  : "";

let removed = 0;
for (const file of fs.readdirSync(typesDir)) {
  if (!file.endsWith(".ts") || file === "index.ts") continue;
  const baseName = file.replace(/\.ts$/, "");
  const pascalName = toPascalCase(baseName);
  if (constExports.has(pascalName)) {
    const filePath = path.join(typesDir, file);
    fs.unlinkSync(filePath);
    // Also remove from types/index.ts
    indexContent = indexContent
      .replace(new RegExp(`export \\* from './${baseName}';\n?`, "g"), "")
      .replace(new RegExp(`export \\* from './${baseName}';\r?\n?`, "g"), "");
    removed++;
    console.log(`  Removed conflicting type: ${file} (${pascalName})`);
  }
}

if (fs.existsSync(typesIndex)) {
  fs.writeFileSync(typesIndex, indexContent.trim() + "\n");
}

console.log(`patch-zod-index: removed ${removed} conflicting type file(s)`);
