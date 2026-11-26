import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Sport Center DEV startup OFF gates", () => {
  const source = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");

  test("explicit scheduler=false prevents startScheduler while preserving default", () => {
    expect(source).toMatch(
      /if \(process\.env\.SPORT_CENTER_SCHEDULER_ENABLED !== "false"\) \{\s*startScheduler\(\);\s*\}/,
    );
    expect(source.match(/startScheduler\(\);/g)).toHaveLength(1);
  });

  test("explicit Sheets auto worker=false prevents worker startup", () => {
    expect(source).toMatch(
      /if \(process\.env\.BOOKING_SHEETS_AUTO_WORKER_ENABLED !== "false"\) \{\s*startBookingSheetsAutoWorker\(\);\s*\}/,
    );
    expect(source.match(/startBookingSheetsAutoWorker\(\);/g)).toHaveLength(1);
  });
});
