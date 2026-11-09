/**
 * Historical verified payroll names for SC employees.
 * A single global alias is unsafe: historical payroll months used different
 * spelling. Changes require independent verification of both the identity and
 * employee row in that month's worksheet.
 */
const historicalNames:Record<string,Record<string,{name:string;row:number}>>={
 "2026-10":{SC003:{name:"ROBY RAHMAN",row:8}},
 "2026-11":{SC003:{name:"ROBBY RAHMAN",row:9}},
};
export function resolvePayrollIdentity(employeeId:string,fullName:string,period:string){
 if(employeeId==="SC003" && !["ROBBY RAHMAN","ROBBY"].includes(fullName.trim().replace(/\\s+/g," ").toUpperCase()))
  throw Error("SALARY_EMPLOYEE_ALIAS_IDENTITY_CHANGED");
 const mapped=historicalNames[period]?.[employeeId];
 return {name:mapped?.name??fullName,expectedRow:mapped?.row??null};
}
