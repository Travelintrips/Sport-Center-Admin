import express from "express";
import supertest from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { usersTable } from "../../../../lib/db/src/schema/users";
import { createPasswordResetToken, PASSWORD_RESET_TTL_MS } from "../lib/passwordReset";
import { hashPassword, verifyPassword } from "../lib/auth";

const dialect = new PgDialect();
let user = { id: 7, email: "owner@example.com", passwordHash: "", name: "Owner", role: "admin", accountStatus: "active" };
let emailConfigured = true;
let updateConflict = false;
const sentEmail = jest.fn<(_recipient: string, _url: string) => Promise<void>>();
const config = jest.fn(() => { if (!emailConfigured) throw new Error("Missing SMTP"); return {}; });
const updateConditions: string[] = [];
const queryDb = {
  select: () => ({ from: () => ({ where: (condition: SQL) => ({ limit: async () => {
    const { params } = dialect.sqlToQuery(condition);
    return params.includes(user.email) || params.includes(user.id) ? [{ ...user }] : [];
  } }) }) }),
  update: () => ({ set: (values: { passwordHash: string }) => ({ where: (condition: SQL) => ({ returning: async () => {
    const compiled = dialect.sqlToQuery(condition);
    updateConditions.push(compiled.sql);
    if (updateConflict || !compiled.params.includes(user.passwordHash)) return [];
    user.passwordHash = values.passwordHash;
    return [{ id: user.id, passwordHash: user.passwordHash }];
  } }) }) }),
};

jest.unstable_mockModule("@workspace/db", () => ({ db: queryDb, usersTable }));
jest.unstable_mockModule("../lib/passwordResetEmail", () => ({ getPasswordResetEmailConfig: config, sendPasswordResetEmail: sentEmail }));
jest.unstable_mockModule("../lib/appUrl", () => ({ getBaseUrl: async () => "https://sc.travelintrips.co.id" }));
jest.unstable_mockModule("../lib/fonnteConfig", () => ({ getFonnteConfig: async () => ({ customerToken: "test-token", customerDevice: "test-device" }) }));
jest.unstable_mockModule("../lib/whatsappSafety", () => ({ allowWhatsAppProviderSend: () => true }));
jest.unstable_mockModule("../lib/logger", () => ({ logger: { debug: jest.fn() } }));

let app: ReturnType<typeof express>;
let originalHash: string;
const logger = { error: jest.fn() };
const newPassword = "new-password-123";

beforeEach(async () => {
  jest.resetModules();
  process.env.SESSION_SECRET = "isolated-password-recovery-test-secret";
  process.env.NODE_ENV = "production";
  originalHash = await hashPassword("old-password-123");
  user = { id: 7, email: "owner@example.com", passwordHash: originalHash, name: "Owner", role: "admin", accountStatus: "active" };
  emailConfigured = true; updateConflict = false; updateConditions.length = 0;
  sentEmail.mockReset(); sentEmail.mockResolvedValue(undefined); logger.error.mockClear();
  const { default: router } = await import("./auth-social");
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.log = logger as typeof req.log; next(); });
  app.use(router);
});
afterEach(() => { jest.restoreAllMocks(); });

describe("Sport Center password recovery routes", () => {
  it("uses the same response for registered and unknown emails", async () => {
    const known = await supertest(app).post("/auth/forgot-password").send({ email: " Owner@Example.com ", channel: "email", source: "admin" });
    const unknown = await supertest(app).post("/auth/forgot-password").send({ email: "unknown@example.com", channel: "email" });
    expect(known.status).toBe(202); expect(unknown.status).toBe(202); expect(known.body).toEqual(unknown.body);
    expect(sentEmail).toHaveBeenCalledTimes(1);
    const [recipient, url] = sentEmail.mock.calls[0];
    expect(recipient).toBe(user.email);
    expect(new URL(url).origin).toBe("https://sc.travelintrips.co.id");
    expect(new URL(url).pathname).toBe("/reset-password");
    expect(new URL(url).search).toBe("?source=admin");
    expect(new URL(url).hash).toContain("token=");
    expect(known.body.token).toBeUndefined();
  });

  it("fails uniformly when email configuration is missing", async () => {
    emailConfigured = false;
    for (const email of [user.email, "unknown@example.com"]) {
      const response = await supertest(app).post("/auth/forgot-password").send({ email, channel: "email" });
      expect(response.status).toBe(503);
    }
    expect(sentEmail).not.toHaveBeenCalled();
  });

  it("does not expose an account when the email provider rejects delivery", async () => {
    sentEmail.mockRejectedValue(new Error("provider rejected message"));
    const known = await supertest(app).post("/auth/forgot-password").send({ email: user.email, channel: "email" });
    const unknown = await supertest(app).post("/auth/forgot-password").send({ email: "unknown@example.com", channel: "email" });
    expect(known.status).toBe(202); expect(known.body).toEqual(unknown.body);
    expect(logger.error).toHaveBeenCalledWith({ userId: user.id, channel: "email" }, "Password reset email delivery failed");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("provider rejected");
  });

  it("limits repeated requests for an address, including unknown accounts", async () => {
    for (let index = 0; index < 3; index++) {
      expect((await supertest(app).post("/auth/forgot-password").send({ email: "unknown@example.com", channel: "email" })).status).toBe(202);
    }
    const response = await supertest(app).post("/auth/forgot-password").send({ email: "unknown@example.com", channel: "email" });
    expect(response.status).toBe(429); expect(response.headers["retry-after"]).toBe("900");
  });

  it("changes the password with a valid link and rejects both the old password and link reuse", async () => {
    const token = createPasswordResetToken(user);
    const result = await supertest(app).post("/auth/reset-password").send({ token, newPassword });
    expect(result.status).toBe(200); expect(result.body.token).toBeUndefined(); expect(user.role).toBe("admin");
    expect((await verifyPassword(newPassword, user.passwordHash)).valid).toBe(true);
    expect((await verifyPassword("old-password-123", user.passwordHash)).valid).toBe(false);
    expect((await supertest(app).post("/auth/reset-password").send({ token, newPassword: "another-password-123" })).status).toBe(400);
    expect(updateConditions[0]).toContain('"password_hash" =');
  });

  it("does not overwrite a password changed by another request", async () => {
    const token = createPasswordResetToken(user);
    updateConflict = true;
    const response = await supertest(app).post("/auth/reset-password").send({ token, newPassword });
    expect(response.status).toBe(400); expect(user.passwordHash).toBe(originalHash);
  });

  it("rejects expired or modified links without updating a password", async () => {
    const issued = Date.now();
    const token = createPasswordResetToken(user);
    jest.spyOn(Date, "now").mockReturnValue(issued + PASSWORD_RESET_TTL_MS + 10);
    expect((await supertest(app).post("/auth/reset-password").send({ token, newPassword })).status).toBe(400);
    expect((await supertest(app).post("/auth/reset-password").send({ token: token + ".extra", newPassword })).status).toBe(400);
    expect(user.passwordHash).toBe(originalHash);
  });

  it("rejects a disabled account and an oversized password", async () => {
    const token = createPasswordResetToken(user);
    user.accountStatus = "suspended";
    expect((await supertest(app).post("/auth/reset-password").send({ token, newPassword })).status).toBe(400);
    expect((await supertest(app).post("/auth/reset-password").send({ token, newPassword: "a".repeat(73) })).status).toBe(400);
    expect(user.passwordHash).toBe(originalHash);
  });

  it("rejects an incorrect WhatsApp code and never logs or returns the code", async () => {
    Object.assign(user, { phone: "081234567890" });
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: true }), { status: 200 }));
    const sent = await supertest(app).post("/auth/forgot-password").send({ email: user.email, channel: "whatsapp" });
    expect(sent.status).toBe(202);
    const providerBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const otp = /\*(\d{6})\*/.exec(providerBody.message)![1];
    expect(JSON.stringify(sent.body)).not.toContain(otp);
    const wrongCode = otp === "111111" ? "222222" : "111111";
    for (let count = 0; count < 5; count++) {
      expect((await supertest(app).post("/auth/reset-password").send({ email: user.email, otp: wrongCode, newPassword })).status).toBe(400);
    }
    expect((await supertest(app).post("/auth/reset-password").send({ email: user.email, otp, newPassword })).status).toBe(400);
    expect(user.passwordHash).toBe(originalHash);
  });

  it("resets with an accepted WhatsApp code and prevents reuse", async () => {
    Object.assign(user, { phone: "081234567890" });
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: true }), { status: 200 }));
    const sent = await supertest(app).post("/auth/forgot-password").send({ email: user.email });
    expect(sent.status).toBe(202);
    const providerBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const otp = /\*(\d{6})\*/.exec(providerBody.message)![1];
    const body = { email: user.email, otp, newPassword };
    expect((await supertest(app).post("/auth/reset-password").send(body)).status).toBe(200);
    expect((await verifyPassword(newPassword, user.passwordHash)).valid).toBe(true);
    expect((await verifyPassword("old-password-123", user.passwordHash)).valid).toBe(false);
    expect((await supertest(app).post("/auth/reset-password").send(body)).status).toBe(400);
  });

  it("does not accept a WhatsApp code rejected by the provider", async () => {
    Object.assign(user, { phone: "081234567890" });
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: false }), { status: 200 }));
    const sent = await supertest(app).post("/auth/forgot-password").send({ email: user.email, channel: "whatsapp" });
    expect(sent.status).toBe(503);
    const providerBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const otp = /\*(\d{6})\*/.exec(providerBody.message)![1];
    expect((await supertest(app).post("/auth/reset-password").send({ email: user.email, otp, newPassword })).status).toBe(400);
    expect(user.passwordHash).toBe(originalHash);
  });
});
