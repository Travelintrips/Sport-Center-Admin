import test from "node:test";
import assert from "node:assert/strict";
import { getBookingPaymentCapture } from "./bookingPaymentCapture.ts";

const groupBooking = {
  groupRef: "CART-MVI6CQT9-XTGP",
  groupNetTotalPayment: 23933700,
  downPayment: 13933700,
  status: "pending_payment",
  groupPayments: [{ paymentType: "dp", status: "confirmed", amount: 13933700 }],
};

test("Falcons: confirmed DP on sibling exposes exact group pelunasan", () => {
  const result = getBookingPaymentCapture(groupBooking, []);
  assert.equal(result.canRecord, true);
  assert.equal(result.paymentType, "pelunasan");
  assert.equal(result.amount, 10000000);
  assert.equal(result.confirmedAmount, 13933700);
});
test("an unconfirmed pelunasan prevents another upload", () => {
  const result = getBookingPaymentCapture({ ...groupBooking,
    groupPayments: [...groupBooking.groupPayments, { paymentType: "pelunasan", status: "pending", amount: 10000000 }],
  }, []);
  assert.equal(result.canRecord, false);
});
test("fully paid groups cannot collect more", () => {
  const result = getBookingPaymentCapture({ ...groupBooking,
    groupPayments: [...groupBooking.groupPayments, { paymentType: "pelunasan", status: "confirmed", amount: 10000000 }],
  }, []);
  assert.equal(result.canRecord, false);
  assert.equal(result.remaining, 0);
});
test("not having group ledger must not assume unpaid", () => {
  const result = getBookingPaymentCapture({ ...groupBooking, groupPayments: undefined }, []);
  assert.equal(result.canRecord, false);
});
test("single booking without previous payment keeps first-payment form", () => {
  const result = getBookingPaymentCapture({ grandTotal: 200000, status: "pending_payment" }, []);
  assert.equal(result.canRecord, true);
  assert.equal(result.amount, 200000);
  assert.equal(result.paymentType, "full_payment");
});
test("first DP uses configured amount, not full group total", () => {
  const result = getBookingPaymentCapture({
    groupRef: "GROUP", groupPayments: [], groupTotalPayment: 600000,
    downPayment: 300000, status: "pending_payment",
  }, []);
  assert.equal(result.canRecord, true);
  assert.equal(result.amount, 300000);
  assert.equal(result.paymentType, "dp");
});

test("SC-1741: confirmed full_payment 100k after one-hour extension opens 100k pelunasan", () => {
  const result = getBookingPaymentCapture({
    grandTotal: 200000, totalPrice: 200000, status: "confirmed", downPayment: 0,
  }, [{ paymentType: "full_payment", status: "confirmed", amount: 100000 }]);
  assert.equal(result.canRecord, true);
  assert.equal(result.paymentType, "pelunasan");
  assert.equal(result.hasConfirmedPartial, true);
  assert.equal(result.amount, 100000);
  assert.equal(result.remaining, 100000);
});

test("SC-1741 pending proof cannot collect the same pelunasan twice", () => {
  const result = getBookingPaymentCapture({ grandTotal: 200000, status: "confirmed" },
    [{ paymentType: "full_payment", status: "confirmed", amount: 100000 },
     { paymentType: "pelunasan", status: "pending", amount: 100000 }]);
  assert.equal(result.canRecord, false);
});

test("confirmed full_payment with no remaining balance never displays collection", () => {
  const result = getBookingPaymentCapture({ grandTotal: 200000, status: "confirmed" },
    [{ paymentType: "full_payment", status: "confirmed", amount: 200000 }]);
  assert.equal(result.canRecord, false);
  assert.equal(result.remaining, 0);
});

test("cancelled and refunded booking cannot accept additional payment", () => {
  for (const status of ["cancelled", "refunded"]) {
    const result = getBookingPaymentCapture({ grandTotal: 200000, status },
      [{ paymentType: "full_payment", status: "confirmed", amount: 100000 }]);
    assert.equal(result.canRecord, false);
  }
});

test("group prior full_payment now partial from a price increase collects only difference", () => {
  const result = getBookingPaymentCapture({
    groupRef: "GRP-TEST", groupPayments: [{ status: "confirmed", paymentType: "full_payment", amount: 100000 }],
    groupNetTotalPayment: 200000, status: "confirmed",
  }, []);
  assert.equal(result.canRecord, true);
  assert.equal(result.amount, 100000);
  assert.equal(result.paymentType, "pelunasan");
});

test("waiting_confirmation or pending_payment blocks repeat pelunasan upload", () => {
  for (const paymentStatus of ["waiting_confirmation", "pending_payment"]) {
    const result = getBookingPaymentCapture({ grandTotal: 200000, status: "confirmed" },
      [{ paymentType: "full_payment", status: "confirmed", amount: 100000 },
       { paymentType: "pelunasan", status: paymentStatus, amount: 100000 }]);
    assert.equal(result.canRecord, false);
  }
});

test("completed bookings are not reopened for balance capture", () => {
  const result = getBookingPaymentCapture({grandTotal:200000,status:"completed"},
    [{status:"confirmed",paymentType:"full_payment",amount:100000}]);
  assert.equal(result.canRecord,false);
});
