import { formatCorporateInvoiceNumber } from "./corporateInvoiceNumber";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("CST corporate invoice sequence and Roman issuance months", () => {
  test("anchors the GM CGK November 2026 example at 060", () => {
    expect(formatCorporateInvoiceNumber(60, "2026-11-27"))
      .toBe("060/INVOICE-CST/XI/2026");
    expect(formatCorporateInvoiceNumber(61, "2026-11-27"))
      .toBe("061/INVOICE-CST/XI/2026");
  });

  test("Roman month is based on issuance date, across year boundaries", () => {
    const months = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
    months.forEach((roman, index) => {
      const month = String(index + 1).padStart(2, "0");
      expect(formatCorporateInvoiceNumber(100, `2026-${month}-01`))
        .toBe(`100/INVOICE-CST/${roman}/2026`);
    });
    expect(formatCorporateInvoiceNumber(102, "2027-01-01")).toBe("102/INVOICE-CST/I/2027");
  });

  test("rejects invalid serials and months", () => {
    expect(() => formatCorporateInvoiceNumber(0, "2026-11-27")).toThrow();
    expect(() => formatCorporateInvoiceNumber(60, "2026-13-27")).toThrow();
    expect(() => formatCorporateInvoiceNumber(60.5, "2026-11-27")).toThrow();
  });

  test("registry migration and invoices cannot share or re-issue sequence per company", () => {
    const migration = readFileSync(resolve(process.cwd(), "../../scripts/migrate.ts"), "utf8");
    expect(migration).toContain("START WITH 60");
    expect(migration).toContain("UNIQUE (document_type, document_key)");
    expect(migration).toContain("GRP-1794579653965-75664");
    const route = readFileSync(resolve(process.cwd(), "src/routes/companyInvoices.ts"), "utf8");
    expect(route).toContain('allocateCorporateInvoiceNumber(');
    expect(route).toContain('"monthly", String(inv.id), query => tx.execute(query)');
    const resolver = readFileSync(resolve(process.cwd(), "src/lib/invoiceResolver.ts"), "utf8");
    expect(resolver).toContain('allocateCorporateInvoiceNumber("group", groupRef)');
  });
});
