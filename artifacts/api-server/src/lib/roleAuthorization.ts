export type ManagedRole = "customer" | "staff" | "admin_booking" | "admin" | "finance" | "super_admin";
export const MANAGED_ROLES: ManagedRole[] = ["customer", "staff", "admin_booking", "admin", "finance", "super_admin"];
export function canEditRole(actor: {id:number;role:string;status:string}, target: {id:number;role:string}, proposed: string): boolean {
  if (actor.status !== "active" || actor.id === target.id) return false;
  if (!MANAGED_ROLES.includes(proposed as ManagedRole) || target.role === "owner") return false;
  if (actor.role === "owner") return true;
  return actor.role === "super_admin" && target.role !== "super_admin" && proposed !== "super_admin";
}
export function isSessionCurrent(tokenRole:string, account: {role:string;status:string|null} | null): boolean {
  return Boolean(account && account.status === "active" && account.role === tokenRole);
}
