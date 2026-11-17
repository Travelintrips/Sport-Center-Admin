/** Read-only check used before a public PIN booking is allowed to reach payment.
 * Inventory alone can outlive physical X904 enrollment. */
export function x904CurrentGymGuestInSnapshot(
  snapshot: unknown, pin: string, name: string, nowMs = Date.now(),
): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const s=snapshot as Record<string,unknown>;
  const observed=new Date(String(s.observed_at ?? ""));
  const age=nowMs-observed.getTime();
  const members=Array.isArray(s.users) ? s.users : [];
  if (!Number.isFinite(age) || age<0 || age>5*60_000 ||
      members.length!==Number(s.user_count)) return false;
  const normalize=(value: unknown) =>
    String(value ?? "").trim().replace(/\s+/g," ").toLocaleUpperCase("id-ID");
  return members.filter((entry:unknown)=>{
    const u=entry as Record<string,unknown>;
    return String(u.pin)===pin && normalize(u.name)===normalize(name) &&
      Number(u.role)===0 && u.enabled===true && [1,2].includes(Number(u.group));
  }).length===1;
}
