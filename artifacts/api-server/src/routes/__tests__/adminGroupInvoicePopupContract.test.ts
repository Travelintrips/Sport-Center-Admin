import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "../sport-center/src/pages/admin/Bookings.tsx"), "utf8");
const invoiceButton = source.split('title={`Invoice Grup ${b.groupRef}`}')[1]?.split("Inv. Grup")[0] ?? "";

describe("Admin group invoice preview contract", () => {
  it("opens an immediate loading tab and does not write the invoice into a blank popup asynchronously", () => {
    expect(invoiceButton).toContain('window.open("about:blank", "_blank")');
    expect(invoiceButton).toContain("Sedang memuat invoice grup...");
    expect(invoiceButton).toContain("URL.createObjectURL(new Blob([html]");
    expect(invoiceButton).toContain("win.location.replace(url)");
    expect(invoiceButton).not.toContain("win.document.write(html)");
  });
  it("fetches the full group invoice with Admin token without putting the token in a URL", () => {
    expect(invoiceButton).toContain('encodeURIComponent(b.groupRef)');
    expect(invoiceButton).toContain("Authorization: `Bearer ${token}`");
    expect(invoiceButton).toContain('cache: "no-store"');
  });
  it("shows errors for popup blocking, lost Admin session and invoice server failure", () => {
    expect(invoiceButton).toContain("Izinkan pop-up");
    expect(invoiceButton).toContain("Sesi Admin tidak tersedia");
    expect(invoiceButton).toContain("Data invoice grup tidak ditemukan");
    expect(invoiceButton).toContain("Server invoice gagal");
    expect(invoiceButton).toContain("Invoice grup gagal dibuka");
  });
});
