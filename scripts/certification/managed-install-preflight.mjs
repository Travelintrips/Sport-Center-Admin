// Pre-deployment gate for ONE DEDICATED Sport Center installation per customer.
// No network calls. No credentials are logged. This does not certify the live device.
const errors = [];
const req = (name, minimum = 1) => {
  const value = String(process.env[name] ?? "").trim();
  if (value.length < minimum) errors.push(name + "_MISSING_OR_TOO_SHORT");
  return value;
};
const installId = req("SPORT_CENTER_INSTALLATION_ID", 4);
const app = req("SPORT_CENTER_PUBLIC_URL", 12);
const supabase = req("SUPABASE_URL", 20);
const database = req("SUPABASE_DATABASE_URL", 30);
const serial = req("GYM_X904_DEVICE_SERIAL", 4);
req("SUPABASE_SERVICE_ROLE_KEY", 32);
req("SESSION_SECRET", 32);
req("GYM_X904_EVENT_INGEST_KEY", 32);
req("CST_WA_GATEWAY_TOKEN", 32);
if (!/^[a-z0-9][a-z0-9-]{2,62}$/i.test(installId)) errors.push("INSTALLATION_ID_INVALID");
if (process.env.NODE_ENV !== "production") errors.push("NOT_PRODUCTION_MODE");
if (process.env.ALLOW_DEV_ON_PROD_DB === "true" || process.env.ALLOW_DEV_ON_PROD_STORAGE === "true") errors.push("UNSAFE_DEV_OVERRIDE");
let projectRef = "";
try {
  const u = new URL(supabase);
  if (u.protocol !== "https:" || !/^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname))
    errors.push("SUPABASE_URL_NOT_DEDICATED_PROJECT");
  projectRef = u.hostname.split(".")[0];
} catch { errors.push("SUPABASE_URL_INVALID"); }
try {
  const u = new URL(database);
  if (!["postgres:","postgresql:"].includes(u.protocol)) errors.push("DATABASE_PROTOCOL_INVALID");
  if (projectRef && ![u.hostname, u.username].some(part => part.includes(projectRef)))
    errors.push("DATABASE_SUPABASE_PROJECT_MISMATCH");
} catch { errors.push("DATABASE_URL_INVALID"); }
try {
  const u = new URL(app);
  if (u.protocol !== "https:") errors.push("PUBLIC_URL_HTTPS_REQUIRED");
  if (["sc.travelintrips.co.id","dev-sc.travelintrips.co.id","localhost"].includes(u.hostname))
    errors.push("EXISTING_CST_INSTALLATION_NOT_A_CUSTOMER");
} catch { errors.push("PUBLIC_URL_INVALID"); }
if (["nzdweipzckfszczzqtuw","xssrfshdrtdfupgqwfdw"].includes(projectRef))
  errors.push("CST_DATABASE_PROJECT_FORBIDDEN");
if (serial === "TDBD234200545") errors.push("CST_X904_SERIAL_FORBIDDEN");
const result = { mode:"single_customer_dedicated_install_preflight", issue:850, passed:errors.length===0,
  errors, projectIsNotCST:!["nzdweipzckfszczzqtuw","xssrfshdrtdfupgqwfdw"].includes(projectRef),
  nextGate:"Actual deployment-specific booking, payment, callback, VMSC device readback and restore E2E; preflight alone is not GO" };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 2;
