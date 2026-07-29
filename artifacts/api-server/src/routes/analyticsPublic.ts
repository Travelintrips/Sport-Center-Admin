import { Router } from "express";
import { google } from "googleapis";

const router = Router();

// Simple in-memory cache (5 minutes)
let cache: { data: PublicStats; expiresAt: number } | null = null;

interface PublicStats {
  users30d: number;
  pageViews30d: number;
  sessions30d: number;
  activeUsers: number;
  configured: boolean;
}

async function fetchGA4Stats(): Promise<PublicStats> {
  const credJson = process.env["GA4_SERVICE_ACCOUNT_JSON"];
  const propertyId = process.env["GA4_PROPERTY_ID"];

  if (!credJson || !propertyId) {
    return { users30d: 0, pageViews30d: 0, sessions30d: 0, activeUsers: 0, configured: false };
  }

  let credentials: object;
  try {
    credentials = JSON.parse(credJson);
  } catch {
    return { users30d: 0, pageViews30d: 0, sessions30d: 0, activeUsers: 0, configured: false };
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });

  const analyticsdata = google.analyticsdata({ version: "v1beta", auth });

  // Fetch 30-day report and realtime in parallel
  const [report, realtime] = await Promise.all([
    analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        metrics: [
          { name: "totalUsers" },
          { name: "screenPageViews" },
          { name: "sessions" },
        ],
      },
    }),
    analyticsdata.properties.runRealtimeReport({
      property: `properties/${propertyId}`,
      requestBody: {
        metrics: [{ name: "activeUsers" }],
      },
    }),
  ]);

  const row = report.data.rows?.[0]?.metricValues ?? [];
  const users30d = parseInt(row[0]?.value ?? "0", 10);
  const pageViews30d = parseInt(row[1]?.value ?? "0", 10);
  const sessions30d = parseInt(row[2]?.value ?? "0", 10);

  const rtRow = realtime.data.rows?.[0]?.metricValues ?? [];
  const activeUsers = parseInt(rtRow[0]?.value ?? "0", 10);

  return { users30d, pageViews30d, sessions30d, activeUsers, configured: true };
}

router.get("/api/analytics/public-stats", async (_req, res) => {
  try {
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
      return res.json(cache.data);
    }

    const data = await fetchGA4Stats();
    cache = { data, expiresAt: now + 5 * 60 * 1000 }; // 5 minutes
    res.json(data);
  } catch (err: any) {
    console.error("[analytics] Error fetching GA4 stats:", err?.message ?? err);
    // Return unconfigured rather than a 500 so frontend hides gracefully
    res.json({ users30d: 0, pageViews30d: 0, sessions30d: 0, activeUsers: 0, configured: false });
  }
});

export default router;
