import {parseX904Attlog} from "./x904AdmsAttlog";
describe("X904 candidate ATTLOG parser, disabled until device validation",()=>{
 it("parses only explicitly recognized four-column rows",()=>{
  expect(parseX904Attlog("123\t2026-10-12 17:00:00\t0\t1\n")).toEqual([{pin:"123",deviceTime:"2026-10-12 17:00:00",status:0,verify:1}]);
 });
 it("rejects biometrics, malformed timestamps and oversized inputs",()=>{
  expect(()=>parseX904Attlog("123\t2026-10-12 17:00:00\t0\t1\tFACE")).toThrow();
  expect(()=>parseX904Attlog("123\tno-date\t0\t1")).toThrow();
  expect(()=>parseX904Attlog("123\t2026-02-31 11:00:00\t0\t1")).toThrow();
  expect(()=>parseX904Attlog("123\t2026-10-12 25:00:00\t0\t1")).toThrow();
  expect(()=>parseX904Attlog("X".repeat(32769))).toThrow();
 });
});
