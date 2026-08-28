import { validatePaymentMetadataUpdate } from "./paymentMetadataUpdate";

const transferCurrent = { paymentMethod: "Transfer Bank", paymentProvider: null };
const qrisCurrent = { paymentMethod: "QRIS", paymentProvider: "mandiri_direct" };

describe("validatePaymentMetadataUpdate", () => {
  it("accepts method-only update to Transfer Bank and clears provider", () => {
    const r = validatePaymentMetadataUpdate(
      { paymentMethod: "Transfer Bank" },
      qrisCurrent,
    );
    expect(r).toEqual({
      ok: true,
      update: {
        paymentMethod: "Transfer Bank",
        paymentProvider: "unknown",
        providerName: "manual",
      },
    });
  });

  it("accepts method-only update to QRIS and forces mandiri_direct provider", () => {
    const r = validatePaymentMetadataUpdate(
      { paymentMethod: "QRIS" },
      transferCurrent,
    );
    expect(r).toEqual({
      ok: true,
      update: {
        paymentMethod: "QRIS",
        paymentProvider: "mandiri_direct",
        providerName: "mandiri_direct",
      },
    });
  });

  it("always forces mandiri_direct when method is QRIS, even if provider already valid", () => {
    const r = validatePaymentMetadataUpdate({ paymentMethod: "QRIS" }, qrisCurrent);
    expect(r).toEqual({
      ok: true,
      update: {
        paymentMethod: "QRIS",
        paymentProvider: "mandiri_direct",
        providerName: "mandiri_direct",
      },
    });
  });

  it("forces mandiri_direct on legacy QRIS rows that still store paylabs", () => {
    const r = validatePaymentMetadataUpdate(
      { paymentMethod: "QRIS" },
      { paymentMethod: "QRIS", paymentProvider: "paylabs" },
    );
    expect(r).toEqual({
      ok: true,
      update: {
        paymentMethod: "QRIS",
        paymentProvider: "mandiri_direct",
        providerName: "mandiri_direct",
      },
    });
  });

  it("accepts provider-only update on a QRIS payment (normalized to mandiri_direct)", () => {
    const r = validatePaymentMetadataUpdate(
      { paymentProvider: "mandiri_direct" },
      { paymentMethod: "QRIS", paymentProvider: "unknown" },
    );
    expect(r).toEqual({
      ok: true,
      update: { paymentProvider: "mandiri_direct", providerName: "mandiri_direct" },
    });
  });

  it("accepts both fields together", () => {
    const r = validatePaymentMetadataUpdate(
      { paymentMethod: "QRIS", paymentProvider: "mandiri_direct" },
      transferCurrent,
    );
    expect(r).toEqual({
      ok: true,
      update: {
        paymentMethod: "QRIS",
        paymentProvider: "mandiri_direct",
        providerName: "mandiri_direct",
      },
    });
  });

  it("accepts revision identifiers without validating settlement ownership", () => {
    const r = validatePaymentMetadataUpdate({
      paymentMethod: "QRIS",
      companyId: 1,
      bankAccountId: "1640006707220",
    }, transferCurrent);
    expect(r).toEqual({
      ok: true,
      update: {
        paymentMethod: "QRIS",
        paymentProvider: "mandiri_direct",
        providerName: "mandiri_direct",
        companyId: 1,
        bankAccountId: "1640006707220",
      },
    });
  });

  it("rejects provider on a non-QRIS payment", () => {
    const r = validatePaymentMetadataUpdate(
      { paymentProvider: "mandiri_direct" },
      transferCurrent,
    );
    expect(r).toEqual({
      ok: false,
      error: "Provider hanya boleh diisi untuk pembayaran QRIS.",
    });
  });

  it("rejects invalid provider values", () => {
    const r = validatePaymentMetadataUpdate({ paymentProvider: "gopay" }, qrisCurrent);
    expect(r.ok).toBe(false);
  });

  it("rejects explicit 'unknown' provider", () => {
    const r = validatePaymentMetadataUpdate({ paymentProvider: "unknown" }, qrisCurrent);
    expect(r.ok).toBe(false);
  });

  it.each(["status", "amount", "paidAt", "notes", "providerOrderId"])(
    "rejects forbidden financial/status field '%s'",
    (field) => {
      const r = validatePaymentMetadataUpdate(
        { paymentMethod: "QRIS", [field]: "x" },
        transferCurrent,
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain(field);
    },
  );

  it("rejects unknown fields", () => {
    const r = validatePaymentMetadataUpdate({ foo: 1 }, transferCurrent);
    expect(r).toEqual({ ok: false, error: "Field 'foo' tidak dikenal" });
  });

  it("rejects empty body (no changes)", () => {
    const r = validatePaymentMetadataUpdate({}, transferCurrent);
    expect(r.ok).toBe(false);
  });

  it("rejects empty/blank method", () => {
    expect(validatePaymentMetadataUpdate({ paymentMethod: "  " }, transferCurrent).ok).toBe(false);
    expect(validatePaymentMetadataUpdate({ paymentMethod: 5 }, transferCurrent).ok).toBe(false);
  });

  it("rejects non-object bodies", () => {
    expect(validatePaymentMetadataUpdate(null, transferCurrent).ok).toBe(false);
    expect(validatePaymentMetadataUpdate([], transferCurrent).ok).toBe(false);
    expect(validatePaymentMetadataUpdate("x", transferCurrent).ok).toBe(false);
  });

  it("rejects overly long method", () => {
    const r = validatePaymentMetadataUpdate(
      { paymentMethod: "x".repeat(121) },
      transferCurrent,
    );
    expect(r.ok).toBe(false);
  });
});
