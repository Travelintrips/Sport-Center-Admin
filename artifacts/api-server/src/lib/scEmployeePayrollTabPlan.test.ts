import {describe,it,expect} from "@jest/globals";
import {planPayrollDraft,salaryTabTitle,previousPayrollPeriod} from "./scEmployeePayrollTabPlan";
const rows=Array.from({length:34},()=>Array<unknown>(13).fill(""));
rows[7]=["NO","NAMA","UANG MAKAN","Hari Kerja","PERSENTASE","Total Salary","kasbon","Sisa Gaji","","","","",""];
rows[8]=[1,"ROBBY",2250000,26,110000,2860000,1500000,"=F9-G9","Sea Bank","901074114776","","Gaji CST 1",10020000];
rows[9]=[2,"MELSA",null,null,null,1500000,null,1500000,"BLU BCA","009576880969"];
rows[10]=[3,"FELICIA JUSTIANI",1900000,26,350000,9100000,null,"=F11-G11","BCA","5440115952"];
rows[11]=[4,"ANGELIA NIRWANA",1060000,26,190000,4940000,null,6000000,"BCA","544053888"];
rows[12]=[5,"RIPAN",null,null,null,4525000,null,4525000,"BCA","4061495864"];
rows[13]=["TOTAL","","","","","","TOTAL",28135000,"","","","Total Gaji",61805000];
describe("New monthly payroll tab planning",()=>{
 it("uses November 2026 as the December source, including year rollover",()=>{
  expect(previousPayrollPeriod("2026-12")).toBe("2026-11");
  expect(previousPayrollPeriod("2027-01")).toBe("2026-12");
  expect(salaryTabTitle("2026-12")).toBe("Gaji Desember 2026");
 });
 it("clears prior month's manual payroll numbers but retains formulas and identity",()=>{
  const plan=planPayrollDraft("2026-12",rows);
  expect(plan.sourceTitle).toBe("Gaji November 2026");
  expect(plan.targetTitle).toBe("Gaji Desember 2026");
  expect(plan.employeeCount).toBe(5);
  expect(plan.clearCells).toEqual(expect.arrayContaining(["C9","D9","E9","F9","G9","F10","H10","H14","M9","M14"]));
  expect(plan.clearCells).not.toContain("H9");
  expect(plan.clearCells).not.toContain("H11");
  expect(plan.clearCells).not.toContain("G14");
  expect(plan.clearCells).not.toContain("B9");
  expect(plan.clearCells).not.toContain("J9");
  expect(plan.retainedFormulas).toBe(2);
 });
 it("rejects a blank template instead of making a misleading new tab",()=>{
  expect(()=>planPayrollDraft("2026-12",Array.from({length:30},()=>[]))).toThrow("PAYROLL_TEMPLATE_EMPLOYEE_COUNT_UNSAFE");
 });
});
