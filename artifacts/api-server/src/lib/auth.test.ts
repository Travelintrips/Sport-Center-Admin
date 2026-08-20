import { describe, expect, it } from "@jest/globals";
import bcrypt from "bcryptjs";
import { hashPassword, isValidPasswordHash, verifyPassword } from "./auth";

describe("password hashing", () => {
  it("creates a bcrypt hash that verifies and rejects the old password", async () => {
    const oldPassword = "old-password";
    const newPassword = "new-password-123";
    const hash = await hashPassword(newPassword);

    expect(isValidPasswordHash(hash)).toBe(true);
    expect((await verifyPassword(newPassword, hash)).valid).toBe(true);
    expect((await verifyPassword(oldPassword, hash)).valid).toBe(false);
  });

  it.each([{}, "[object Promise]", null, ""])("rejects invalid persisted hash value %p", (value) => {
    expect(isValidPasswordHash(value)).toBe(false);
  });

  it("rejects non-bcrypt object serialization even when bcrypt can hash a password", async () => {
    const hash = await bcrypt.hash("new-password-123", 12);
    expect(isValidPasswordHash(hash)).toBe(true);
    expect(isValidPasswordHash({ hash })).toBe(false);
  });
});