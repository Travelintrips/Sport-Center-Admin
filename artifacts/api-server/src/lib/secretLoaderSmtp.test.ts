import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

let payload: Record<string, unknown>;
const request = jest.fn(async ({ url }: { url: string }) => {
  if (url.includes("SUPABASE_PROD_AUDIT_DATABASE_URL")) throw new Error("404 not found");
  return { data: { payload: { data: Buffer.from(JSON.stringify(payload)).toString("base64") } } };
});
jest.unstable_mockModule("google-auth-library", () => ({ GoogleAuth: class { async getClient() { return { request }; } } }));
const { loadSecretsFromGSM } = await import("./secretLoader");
const savedEnv = process.env;

describe("GCP SMTP secret loading", () => {
  beforeEach(() => {
    process.env = { ...savedEnv, APP_ENV: "production", NODE_ENV: "production", GCP_PROJECT_ID: "isolated-test-project", GCP_SECRET_ID: "isolated-test-secret", SESSION_SECRET: "test-signing-secret" };
    delete process.env.GCP_SECRET_MANAGER_BOOTSTRAP_JSON;
    request.mockClear();
  });
  afterAll(() => { process.env = savedEnv; });

  it("loads SMTP values from the same flat GCP bundle as the database", async () => {
    payload = { SUPABASE_DATABASE_URL: "postgresql://test:placeholder@localhost/test", SMTP_FROM: "admin@example.com", SMTP_PASS: "test-smtp-password", SMTP_HOST: "smtp.hostinger.com", SMTP_PORT: "465", SMTP_SECURE: "true" };
    const result = await loadSecretsFromGSM();
    expect(result.fatal).toEqual([]);
    expect(result.loaded).toEqual(expect.arrayContaining(["SMTP_FROM", "SMTP_PASS", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE"]));
    expect(process.env.SMTP_PASS).toBe("test-smtp-password");
  });

  it("selects DEV overrides without importing production SMTP credentials", async () => {
    process.env.APP_ENV = "development"; process.env.NODE_ENV = "development";
    payload = { SUPABASE_DATABASE_URL: "postgresql://prod:placeholder@localhost/prod", SUPABASE_DATABASE_URL_DEV: "postgresql://dev:placeholder@localhost/dev", SMTP_FROM_DEV: "dev@example.com", SMTP_PASS_DEV: "dev-password", SMTP_FROM: "prod@example.com", SMTP_PASS: "prod-password" };
    await loadSecretsFromGSM();
    expect(process.env.SMTP_FROM).toBe("dev@example.com");
    expect(process.env.SMTP_PASS).toBe("dev-password");
  });

  it("supports nested sections and the SMTP_PASSWORD alias", async () => {
    payload = { prod: { database_url: "postgresql://test:placeholder@localhost/test", smtp_from: "owner@example.com", SMTP_PASSWORD: "alias-password", smtp_user: "mailbox@example.com" } };
    await loadSecretsFromGSM();
    expect(process.env.SMTP_PASS).toBe("alias-password");
    expect(process.env.SMTP_USER).toBe("mailbox@example.com");
    expect(process.env.SMTP_PASSWORD).toBeUndefined();
  });
});
