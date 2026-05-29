export async function getPublicConfig() {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const res = await fetch(`${base}/api/config/public`);
  if (!res.ok) throw new Error("Failed to load public config");
  return await res.json();
}
