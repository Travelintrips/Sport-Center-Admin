import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createPasswordResetToken, isValidResetPassword, matchesPasswordResetUser, PASSWORD_RESET_TTL_MS, verifyPasswordResetToken } from "./passwordReset";
import { createToken, verifyToken } from "./auth";

const user = { id: 7, email: "owner@example.com", passwordHash: "original-credential" };

describe("password recovery links", () => {
  beforeEach(() => { process.env.SESSION_SECRET = "isolated-password-recovery-test-secret"; });
  afterEach(() => { jest.restoreAllMocks(); });

  it("works with the same signing secret after a process restart", () => {
    const token = createPasswordResetToken(user);
    const payload = verifyPasswordResetToken(token);
    expect(payload?.subject).toBe(user.id);
    expect(matchesPasswordResetUser(payload!, user)).toBe(true);
    expect(token).not.toContain(user.passwordHash);
  });

  it("cannot be used as a login bearer token or accept a login token as recovery", () => {
    expect(verifyToken(createPasswordResetToken(user))).toBeNull();
    expect(verifyPasswordResetToken(createToken(user.id, "admin"))).toBeNull();
  });

  it("rejects tampering and malformed input", () => {
    const token = createPasswordResetToken(user);
    const [data, signature] = token.split(".");
    for (const value of [null, {}, "", token + ".extra", data + "." + "0".repeat(64), "A" + data + "." + signature, "a".repeat(2049)]) {
      expect(verifyPasswordResetToken(value)).toBeNull();
    }
  });

  it("expires at the 15 minute boundary", () => {
    const issued = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(issued);
    const token = createPasswordResetToken(user);
    jest.spyOn(Date, "now").mockReturnValue(issued + PASSWORD_RESET_TTL_MS);
    expect(verifyPasswordResetToken(token)).toBeNull();
  });

  it("invalidates every outstanding link after a password or identity change", () => {
    const payload = verifyPasswordResetToken(createPasswordResetToken(user))!;
    expect(matchesPasswordResetUser(payload, { ...user, passwordHash: "new-credential" })).toBe(false);
    expect(matchesPasswordResetUser(payload, { ...user, email: "different@example.com" })).toBe(false);
    expect(matchesPasswordResetUser(payload, { ...user, id: 8 })).toBe(false);
  });

  it("allows an email owner to set an initial password without an existing hash", () => {
    const account = { ...user, passwordHash: null };
    const payload = verifyPasswordResetToken(createPasswordResetToken(account))!;
    expect(matchesPasswordResetUser(payload, account)).toBe(true);
    expect(matchesPasswordResetUser(payload, { ...account, passwordHash: "initialized" })).toBe(false);
  });

  it("enforces bcrypt's byte boundary, including multibyte input", () => {
    expect(isValidResetPassword("12345678")).toBe(true);
    expect(isValidResetPassword("a".repeat(72))).toBe(true);
    expect(isValidResetPassword("a".repeat(73))).toBe(false);
    expect(isValidResetPassword("short")).toBe(false);
    expect(isValidResetPassword("🔐".repeat(19))).toBe(false);
    expect(isValidResetPassword({ length: 8 })).toBe(false);
  });
});
