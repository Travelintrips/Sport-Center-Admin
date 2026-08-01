import { Router } from "express";
import { google } from "googleapis";

const router = Router();

// Simple in-memory cache (5 minutes)
let cache: { data: AnalyticsReport; expiresAt: number } | null = null;

export interface TopPage {
  title: string;
  views: number;
  activeUsers: number;
  events: number;
  bounceRate: number;
}

export interface AnalyticsReport {
  configured: boolean;
  dateRange: string; // e.g. "4 Jul – 31 Jul 2026"
  activeUsers: number;        // realtime
  newUsers30d: number;
  avgEngagementTimeSec: number; // seconds
  totalEvents30d: number;
  totalUsers30d: number;
  pageViews30d: number;
  sessions30d: number;
  topPages: TopPage[];
}

const EMPTY: AnalyticsReport = {
  configured: false,
  dateRange: "",
  activeUsers: 0,
  newUsers30d: 0,
  avgEngagementTimeSec: 0,
  totalEvents30d: 0,
  totalUsers30d: 0,
  pageViews30d: 0,
  sessions30d: 0,
  topPages: [],
};

function buildDateRange(): string {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 27);
  const fmt = (d: Date) =>
    d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

async function fetchGA4Stats(): Promise<AnalyticsReport> {
  const credJson = process.env["GA4_SERVICE_ACCOUNT_JSON"];
  const propertyId = process.env["GA4_PROPERTY_ID"];

  if (!credJson || !propertyId) return EMPTY;

  let credentials: object;
  try {
    credentials = JSON.parse(credJson);
  } catch {
    return EMPTY;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });

  const analyticsdata = google.analyticsdata({ version: "v1beta", auth });

  const [summary, topPagesRes, realtime] = await Promise.all([
    // Summary metrics
    analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        metrics: [
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "screenPageViews" },
          { name: "sessions" },
          { name: "averageSessionDuration" },
          { name: "eventCount" },
        ],
      },
    }),
    // Top pages
    analyticsdata.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "pageTitle" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "activeUsers" },
          { name: "eventCount" },
          { name: "bounceRate" },
        ],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: "5",
      },
    }),
    // Realtime active users
    analyticsdata.properties.runRealtimeReport({
      property: `properties/${propertyId}`,
      requestBody: { metrics: [{ name: "activeUsers" }] },
    }),
  ]);

  const row = summary.data.rows?.[0]?.metricValues ?? [];
  const totalUsers30d = parseInt(row[0]?.value ?? "0", 10);
  const newUsers30d = parseInt(row[1]?.value ?? "0", 10);
  const pageViews30d = parseInt(row[2]?.value ?? "0", 10);
  const sessions30d = parseInt(row[3]?.value ?? "0", 10);
  const avgEngagementTimeSec = parseFloat(row[4]?.value ?? "0");
  const totalEvents30d = parseInt(row[5]?.value ?? "0", 10);

  const rtRow = realtime.data.rows?.[0]?.metricValues ?? [];
  const activeUsers = parseInt(rtRow[0]?.value ?? "0", 10);

  const topPages: TopPage[] = (topPagesRes.data.rows ?? []).map((r) => ({
    title: r.dimensionValues?.[0]?.value ?? "-",
    views: parseInt(r.metricValues?.[0]?.value ?? "0", 10),
    activeUsers: parseInt(r.metricValues?.[1]?.value ?? "0", 10),
    events: parseInt(r.metricValues?.[2]?.value ?? "0", 10),
    bounceRate: parseFloat(r.metricValues?.[3]?.value ?? "0"),
  }));

  return {
    configured: true,
    dateRange: buildDateRange(),
    activeUsers,
    newUsers30d,
    avgEngagementTimeSec,
    totalEvents30d,
    totalUsers30d,
    pageViews30d,
    sessions30d,
    topPages,
  };
}

router.get("/analytics/public-stats", async (_req, res) => {
  try {
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
      res.json(cache.data);
      return;
    }
    const data = await fetchGA4Stats();
    cache = { data, expiresAt: now + 5 * 60 * 1000 };
    res.json(data);
  } catch (err: any) {
    console.error("[analytics] Error fetching GA4 stats:", err?.message ?? err);
    res.json(EMPTY);
  }
});

export default router;
