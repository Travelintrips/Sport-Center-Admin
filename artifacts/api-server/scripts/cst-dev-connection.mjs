// CST-DEV ONLY: convert a verified dedicated (IPv6) Supabase URI to the
// existing, independently verified shared transaction pooler (IPv4).
// This uses the same database password, never logs or stores a credential.
// Dedicated host and shared host formats are documented by Supabase.
// The exact shared cluster hostname is pinned from CST's working VPS config;
// do not derive aws-[INDEX] from the region or guess pooler topology.
export const CST_DEV_PROJECT_REF = "xssrfshdrtdfupgqwfdw";
export const CST_DEV_SHARED_POOLER_HOST = "aws-1-ap-southeast-2.pooler.supabase.com";
const DEDICATED_HOST = `db.${CST_DEV_PROJECT_REF}.supabase.co`;

export function normalizeCstDevTransactionPooler(raw) {
  let uri;
  try { uri = new URL(raw); }
  catch { throw new Error("CST_DEV_DSN_INVALID"); }
  // A copied Supabase Connect URI contains a placeholder until an operator
  // supplies the existing database password. Refuse it before network access.
  const passwordText = decodeURIComponent(uri.password);
  if (/YOUR[-_ ]?(?:DATABASE[-_ ]?)?PASSWORD|YOUR_PASSWORD|\\[.*PASSWORD.*\\]/i.test(passwordText)) {
    throw new Error("CST_DEV_PASSWORD_PLACEHOLDER_NOT_REPLACED");
  }
  const validProtocol = ["postgresql:", "postgres:"].includes(uri.protocol);
  const user = decodeURIComponent(uri.username);
  const shared = uri.hostname === CST_DEV_SHARED_POOLER_HOST &&
    user === `postgres.${CST_DEV_PROJECT_REF}` &&
    ["5432", "6543"].includes(uri.port);
  const dedicated = uri.hostname === DEDICATED_HOST &&
    user === "postgres" && uri.port === "6543";
  if (!validProtocol || !uri.password || uri.pathname !== "/postgres" ||
      !(dedicated || shared) || uri.hash) {
    throw new Error("CST_DEV_DSN_SCOPE_OR_FORMAT_DENIED");
  }
  uri.hostname = CST_DEV_SHARED_POOLER_HOST;
  uri.username = `postgres.${CST_DEV_PROJECT_REF}`;
  uri.port = "6543";
  return { connectionString: uri.toString(), source: dedicated ? "dedicated" : "shared" };
}
