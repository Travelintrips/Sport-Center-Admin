import { describe, expect, it } from "@jest/globals";
import { isReplaceableMatchOnRerun } from "./bankMatchingPolicy.js";

describe("bank matching rerun policy", () => {
  it("replaces only active candidates", () => {
    expect(isReplaceableMatchOnRerun("candidate")).toBe(true);
    expect(isReplaceableMatchOnRerun("rejected")).toBe(false);
    expect(isReplaceableMatchOnRerun("approved")).toBe(false);
  });
});