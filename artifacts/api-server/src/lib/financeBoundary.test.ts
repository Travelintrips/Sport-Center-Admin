import { afterEach, describe, expect, it } from "vitest";
import {
  getSportCenterFinanceMode,
  isCentralFinanceMode,
  shouldRunLegacyFinanceWrites,
} from "./financeBoundary";

const originalMode = process.env.SPORT_CENTER_FINANCE_MODE;

afterEach(() => {
  if (originalMode === undefined) {
    delete process.env.SPORT_CENTER_FINANCE_MODE;
  } else {
    process.env.SPORT_CENTER_FINANCE_MODE = originalMode;
  }
});

describe("Sport Center finance boundary mode", () => {
  it("defaults to legacy so existing production processing remains safe", () => {
    delete process.env.SPORT_CENTER_FINANCE_MODE;
    expect(getSportCenterFinanceMode()).toBe("legacy");
    expect(shouldRunLegacyFinanceWrites()).toBe(true);
  });

  it("supports shadow without disabling legacy downstream processing", () => {
    process.env.SPORT_CENTER_FINANCE_MODE = "shadow";
    expect(getSportCenterFinanceMode()).toBe("shadow");
    expect(shouldRunLegacyFinanceWrites()).toBe(true);
    expect(isCentralFinanceMode()).toBe(false);
  });

  it("disables downstream Sport Center finance writes only in central mode", () => {
    process.env.SPORT_CENTER_FINANCE_MODE = "central";
    expect(getSportCenterFinanceMode()).toBe("central");
    expect(shouldRunLegacyFinanceWrites()).toBe(false);
    expect(isCentralFinanceMode()).toBe(true);
  });

  it("fails closed to legacy for unknown values", () => {
    process.env.SPORT_CENTER_FINANCE_MODE = "unsupported";
    expect(getSportCenterFinanceMode()).toBe("legacy");
    expect(shouldRunLegacyFinanceWrites()).toBe(true);
  });
});