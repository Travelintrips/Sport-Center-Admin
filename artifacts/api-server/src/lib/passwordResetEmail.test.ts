import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

const sendMail = jest.fn<() => Promise<{ accepted: string[] }>>();
const close = jest.fn();
const createTransport = jest.fn(() => ({ sendMail, close }));
jest.unstable_mockModule("nodemailer", () => ({ default: { createTransport } }));
const { getPasswordResetEmailConfig, sendPasswordResetEmail } = await import("./passwordResetEmail");
const savedEnv = process.env;

describe("password reset email delivery", () => {
  beforeEach(() => {
    process.env = { ...savedEnv, SMTP_FROM: "admin@example.com", SMTP_PASS: "test-password" };
    for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_SECURE", "SMTP_PASSWORD"]) delete process.env[key];
    createTransport.mockClear(); sendMail.mockReset(); close.mockClear();
    sendMail.mockResolvedValue({ accepted: ["recipient@example.com"] });
  });
  afterAll(() => { process.env = savedEnv; });

  it("preserves the existing Gmail configuration with SMTP_FROM and SMTP_PASS", () => {
    expect(getPasswordResetEmailConfig().options).toMatchObject({ service: "gmail", auth: { user: "admin@example.com", pass: "test-password" } });
  });

  it("supports a custom SMTP host and encrypted port 465", () => {
    process.env.SMTP_HOST = "smtp.hostinger.com"; process.env.SMTP_PORT = "465"; process.env.SMTP_USER = "mailbox@example.com";
    expect(getPasswordResetEmailConfig().options).toMatchObject({ host: "smtp.hostinger.com", port: 465, secure: true, auth: { user: "mailbox@example.com" } });
  });

  it("requires TLS for port 587", () => {
    process.env.SMTP_HOST = "smtp.example.com";
    expect(getPasswordResetEmailConfig().options).toMatchObject({ port: 587, secure: false, requireTLS: true });
  });

  it("fails closed when SMTP credentials are missing", () => {
    delete process.env.SMTP_PASS;
    expect(() => getPasswordResetEmailConfig()).toThrow("configuration is incomplete");
  });

  it("sends a plain email to the registered recipient and closes the transport", async () => {
    await sendPasswordResetEmail("recipient@example.com", "https://sc.travelintrips.co.id/reset-password#token=example");
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "recipient@example.com", text: expect.stringContaining("#token=example") }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects a refused delivery and closes the transport", async () => {
    sendMail.mockResolvedValue({ accepted: [] });
    await expect(sendPasswordResetEmail("recipient@example.com", "https://example.com/reset-password")).rejects.toThrow("rejected");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
