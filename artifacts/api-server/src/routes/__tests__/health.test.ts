/**
 * health.test.ts
 *
 * Unit tests for /health, /healthz, and /readiness endpoints.
 *
 * Strategy:
 *   - /health and /healthz: pure unit tests — no DB, no network.
 *   - /readiness: mocks the pg pool so we can test both success and failure
 *     paths without a live database connection.
 *
 * Run: pnpm --filter @workspace/api-server run test
 */

import { jest } from "@jest/globals";

// ── Mock @workspace/db before the router is imported ──────────────────────────
// health.ts imports `pool` from @workspace/db; we replace it with a lightweight
// mock so tests do not require a live database.
const mockQuery = jest.fn<() => Promise<void>>();
const mockRelease = jest.fn<() => void>();
const mockConnect = jest.fn<() => Promise<{ query: typeof mockQuery; release: typeof mockRelease }>>();

jest.unstable_mockModule("@workspace/db", () => ({
  pool: { connect: mockConnect },
  // Re-export everything else as empty stubs — add as needed
  db: {},
}));

jest.unstable_mockModule("@workspace/api-zod", () => ({
  HealthCheckResponse: {
    parse: (v: unknown) => v,
  },
}));

// Dynamic import AFTER mocks are registered
const { default: express } = await import("express");
const { default: healthRouter } = await import("../health.js");

const app = express();
app.use(healthRouter);

const { default: supertest } = await import("supertest");
const request = supertest(app);

// ── /health ───────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request.get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("includes uptime and timestamp", async () => {
    const res = await request.get("/health");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.timestamp).toBe("string");
    // ISO 8601 format
    expect(() => new Date(res.body.timestamp)).not.toThrow();
  });

  it("requires no authentication", async () => {
    // No Authorization header — must still succeed
    const res = await request.get("/health").set({});
    expect(res.status).toBe(200);
  });

  it("does not expose any secret value", async () => {
    const res = await request.get("/health");
    const body = JSON.stringify(res.body);
    // Should not contain common secret-looking patterns
    expect(body).not.toMatch(/password|secret|key|token/i);
  });
});

// ── /healthz (legacy alias) ───────────────────────────────────────────────────

describe("GET /healthz", () => {
  it("returns 200 with status ok", async () => {
    const res = await request.get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

// ── /readiness ────────────────────────────────────────────────────────────────

describe("GET /readiness — DB reachable", () => {
  beforeEach(() => {
    mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
    mockQuery.mockResolvedValue(undefined);
    mockRelease.mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 when DB is reachable", async () => {
    const res = await request.get("/readiness");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.db).toBe("reachable");
  });

  it("includes latencyMs and timestamp", async () => {
    const res = await request.get("/readiness");
    expect(typeof res.body.latencyMs).toBe("number");
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("issues SELECT 1 and releases the client", async () => {
    await request.get("/readiness");
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith("SELECT 1");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

describe("GET /readiness — DB unreachable", () => {
  beforeEach(() => {
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED 5432"));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns 503 when DB is unreachable", async () => {
    const res = await request.get("/readiness");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("error");
    expect(res.body.db).toBe("unreachable");
  });

  it("does not expose connection credentials in error response", async () => {
    // Simulate an error containing a real-looking connection string
    mockConnect.mockRejectedValue(
      new Error("connect ECONNREFUSED postgresql://admin:s3cr3t@db.supabase.co:5432/postgres"),
    );
    const res = await request.get("/readiness");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("s3cr3t");
    // Credential portion should be masked
    expect(body).not.toMatch(/postgresql:\/\/[^*]/);
  });
});
