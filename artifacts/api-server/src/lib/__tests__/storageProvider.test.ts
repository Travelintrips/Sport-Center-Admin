/**
 * Storage-provider regression guard.
 *
 * Sport Center must use Supabase Storage in every runtime. These checks prevent
 * an environment-specific Replit provider from being reintroduced accidentally.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

describe("storage provider", () => {
  it("contains no Replit runtime routing", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.resolve(here, "../storage.ts"), "utf8");

    expect(source.toLowerCase()).not.toContain("replit");
    expect(source).toContain("uploadToStorage");
  });
});
