import { normalizeX904VisitorName } from "./x904VisitorName";

test("store a human name separately from a VIS card identity", () => {
  expect(normalizeX904VisitorName("  Budi   Santoso ")).toBe("Budi Santoso");
  expect(normalizeX904VisitorName("Siti Aisyah")).toBe("Siti Aisyah");
  expect(normalizeX904VisitorName("VIS002")).toBe("VIS002");
});
test("fail closed for missing or unsafe names", () => {
  expect(normalizeX904VisitorName("")).toBeNull();
  expect(normalizeX904VisitorName(null)).toBeNull();
  expect(normalizeX904VisitorName("A")).toBeNull();
  expect(normalizeX904VisitorName("Budi | paid")).toBeNull();
  expect(normalizeX904VisitorName("<script>")).toBeNull();
  expect(normalizeX904VisitorName("X".repeat(101))).toBeNull();
});
