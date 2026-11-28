import { corporateGroupChargeBlocker, type GroupChargeBookingState } from "./corporateGroupChargeEligibility";
import { buildInvoiceHtml, type InvoiceData } from "./invoiceTemplate";

const row: GroupChargeBookingState = {
  status: "confirmed", payerType: "company", companyCustomerId: 59,
  billingStatus: "unbilled", companyInvoiceId: null,
  invoicePdfUrl: null, membershipPaymentId: null,
};
const options = { paymentCount: 0, invoiceItemCount: 0, groupStatus: "pending", overrideTotal: false };

describe("confirmed Corporate group charges pre-invoice safety", () => {
  test("permits 8 confirmed-but-unbilled sessions without payment", () => {
    expect(corporateGroupChargeBlocker(Array.from({length:8}, () => ({...row})), options)).toBeNull();
  });
  test("rejects paid, billed, PDF-issued, and invoice-linked groups", () => {
    expect(corporateGroupChargeBlocker([row], {...options, paymentCount:1})).toMatch(/pembayaran/);
    expect(corporateGroupChargeBlocker([row], {...options, invoiceItemCount:1})).toMatch(/invoice/);
    expect(corporateGroupChargeBlocker([{...row,billingStatus:"billed"}],options)).toMatch(/ditagih/);
    expect(corporateGroupChargeBlocker([{...row,invoicePdfUrl:"https://example.test/pdf"}],options)).toMatch(/PDF/);
    expect(corporateGroupChargeBlocker([{...row,status:"completed"}],options)).toMatch(/confirmed/);
  });
  test("one-time group consumption is a distinct invoice row, no double-counting", () => {
    const invoice = {
      invoiceNumber: "061/INVOICE-CST/XI/2026",
      invoiceDate: "2026-11-28", orderNumber: "CART-MW1YSNQL-RR62", status:"confirmed",
      customerName:"PT JAS AERO ENGINEERING SERVICES", customerPhone:"", customerEmail:"",
      facilityName:"Badminton Court A", bookingDate:"2026-11-04",
      startTime:"17:00",endTime:"19:00",durationHours:2,pricePerHour:100000,
      dpp:1561441,dppNilaiLain:0,ppnRate:11,ppnAmount:171759,
      grandTotal:1733200,pphRate:0,pphAmount:0,netAmount:1733200,
      centerName:"CST",centerAddress:"Jakarta",centerPhone:"",
      bankName:"Bank",bankAccount:"",bankAccountName:"CST",
      sessions:[{orderNumber:"SC-1709",facilityName:"Badminton Court A",
        bookingDate:"2026-11-04",startTime:"17:00",endTime:"19:00",
        durationHours:2,basePrice:200000,grandTotal:200000,status:"confirmed"}],
      additionalCharges:[{name:"Konsumsi Air Mineral - 1 Dus",amount:133200}],
    } satisfies InvoiceData;
    const html=buildInvoiceHtml(invoice);
    expect(html).toContain("Konsumsi Air Mineral - 1 Dus");
    expect(html).toContain("133.200");
    expect(html).toContain("Biaya tambahan grup (sekali)");
  });
});
