import { describe, expect, it } from "@jest/globals";
import { extractGmailBodyText } from "./gmailMandiriQrisDevSource";

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

describe("Gmail Mandiri QRIS DEV source helpers", () => {
  it("prefers text/plain MIME body", () => {
    const body = extractGmailBodyText({
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64url("TRANSAKSI BERHASIL\nTotal: 300,000.00") } },
          { mimeType: "text/html", body: { data: b64url("<b>wrong fallback</b>") } },
        ],
      },
    });
    expect(body).toContain("TRANSAKSI BERHASIL");
    expect(body).toContain("300,000.00");
    expect(body).not.toContain("wrong fallback");
  });

  it("converts HTML fallback to readable text", () => {
    const body = extractGmailBodyText({
      payload: {
        mimeType: "text/html",
        body: { data: b64url("<p>TRANSAKSI BERHASIL</p><p>Total: 300,000.00</p>") },
      },
    });
    expect(body).toContain("TRANSAKSI BERHASIL");
    expect(body).toContain("Total: 300,000.00");
  });
});
