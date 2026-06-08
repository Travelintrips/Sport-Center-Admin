import { defineConfig } from "drizzle-kit";
import path from "path";

const rawUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  process.env.SUPABASE_DATABASE_URL_DEV ||
  process.env.PROD_DATABASE_URL;

if (!rawUrl) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const useSsl = /supabase\.(co|com|in)/.test(rawUrl);

// Supabase transaction pooler (port 6543) does not support the session
// features drizzle-kit needs for schema introspection; use the session
// pooler (port 5432) for migrations/push instead.
const url = useSsl
  ? rawUrl.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432")
  : rawUrl;

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  },
});
