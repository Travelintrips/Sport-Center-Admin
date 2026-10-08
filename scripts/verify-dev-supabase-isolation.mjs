// Refuse DEV migrations if the GitHub secret aliases do not identify a
// single, verifiable Supabase DEV project distinct from PROD.
const apiUrl = process.env.SUPABASE_URL_DEV || "";
const databaseUrl = process.env.SUPABASE_DATABASE_URL_DEV || "";
const productionUrl = process.env.SUPABASE_URL_PROD || "";

function ref(value) {
  try {
    const u = new URL(value);
    const api = /^([a-z0-9]+)\.supabase\.co$/.exec(u.hostname);
    if (api) return api[1];
    const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname);
    if (direct) return direct[1];
    if (u.hostname.endsWith(".pooler.supabase.com")) {
      const pooled = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(u.username));
      if (pooled) return pooled[1];
    }
  } catch {}
  return null;
}
const dev = ref(apiUrl),db = ref(databaseUrl),prod = ref(productionUrl);
if (!dev || !db || !prod || dev !== db || dev === prod) {
  console.error("DEV_DB_ISOLATION=BLOCKED: distinct DEV/PROD Supabase identities are required.");
  process.exit(1);
}
console.log("DEV_DB_ISOLATION=PASS: project refs match DEV and differ from PROD.");
