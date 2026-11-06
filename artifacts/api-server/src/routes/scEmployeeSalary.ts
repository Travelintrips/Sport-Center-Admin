/** Validate nullable whole-rupiah salary from admin input or PG numeric(15,2). */
export function parseEmployeeSalary(value: unknown): { salary: string | null } | { error: string } {
  if (value === null || value === undefined || value === "") return {salary: null};
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,12})(?:\.00)?$/.test(value))
    return {error: "Gaji harus nominal rupiah tanpa pemisah, maksimal 13 digit"};
  return {salary: value.replace(/\.00$/, "") + ".00"};
}
