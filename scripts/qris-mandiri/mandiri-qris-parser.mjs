/** Pure parser for Mandiri QRIS merchant notification text. No network or DB side effects. */
export function parseMandiriQrisEmail(body) {
  if (typeof body !== "string") throw new TypeError("Email body must be text");
  const field = (label) => {
    const escaped = label.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
    const m = body.match(new RegExp("^\\s*" + escaped + "\\s*:\\s*(.*?)\\s*$", "im"));
    return m?.[1]?.trim() || null;
  };
  const money = (value) => {
    if (!value || !/^\d{1,3}(?:,\d{3})*(?:\.\d{2})?$|^\d+(?:\.\d{2})?$/.test(value)) return null;
    const n = Number(value.replace(/,/g, ""));
    return Number.isSafeInteger(Math.round(n * 100)) ? Math.round(n * 100) : null;
  };
  const status = /(?:TRASAKSI|TRANSAKSI)\s+BERHASIL/i.test(body) ? "reported_success" : "unrecognized";
  const date = field("Tanggal Transaksi"), time = field("Waktu Transaksi");
  const reference = field("Nomor Referensi");
  const amountCents = money(field("Nominal Transaksi"));
  const totalCents = money(field("Total"));
  const tipCents = money(field("TIP"));
  const validDate = !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date+"T00:00:00Z"));
  const validTime = !!time && /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time);
  const valid = status === "reported_success" && !!reference && /^[a-zA-Z0-9-]{6,64}$/.test(reference) && validDate && validTime && amountCents !== null && totalCents !== null && tipCents !== null && amountCents + tipCents === totalCents;
  return {
    valid, status, merchant: field("Nama Toko"), acquirer: field("Nama Acquirer"),
    reference, transactionDate: date, transactionTime: time,
    payerBank: field("Pembayaran dari"), payerName: field("Nama Customer"),
    issuerRrn: field("Issuer RRN"), amountCents, tipCents, totalCents,
    // PANs deliberately excluded; never log or expose raw email text.
    matchStatus: "requires_reconciliation"
  };
}
