import { calculateExactFinalAllocations } from "./groupFinalAllocation";

describe("group final allocation after a confirmed DP", () => {
  const bookings = [
    {id: 1592, grandTotal: 1375500},
    {id: 1594, grandTotal: 3301200},
  ];
  it("uses exact remaining booking balance, not independent proportional rounding", () => {
    const allocations = calculateExactFinalAllocations(bookings, [
      { bookingId: 1592, amount: 800786 },
      { bookingId: 1594, amount: 1921890 },
    ], 1954024);
    expect(allocations).toEqual([
      {bookingId: 1592, amount: "574714"},
      {bookingId: 1594, amount: "1379310"},
    ]);
  });
  it("Falcons: all 9 final allocations match each child invoice and sum to Rp10m", () => {
    const amounts = [
      1375500, 1375500, 1375500,
      3301200, 3301200, 3301200, 3301200, 3301200, 3301200,
    ];
    const previous = [
      800787, 800786, 800787,
      1921890, 1921890, 1921890, 1921890, 1921890, 1921890,
    ];
    const all = amounts.map((grandTotal, i) => ({ id: 1591 + i, grandTotal }));
    const paid = previous.map((amount, i) => ({ bookingId: 1591 + i, amount }));
    const final = calculateExactFinalAllocations(all, paid, 10000000);
    expect(final).not.toBeNull();
    expect(final!.reduce((sum, a) => sum + Number(a.amount), 0)).toBe(10000000);
    for (let i = 0; i < all.length; i++) {
      expect(Number(final![i].amount) + previous[i]).toBe(amounts[i]);
    }
  });
  it("falls back for group invoice/tax mismatch", () => {
    expect(calculateExactFinalAllocations(bookings,
      [{bookingId: 1592, amount: 800786}], 1000000)).toBeNull();
  });
  it("rejects overpaid booking", () => {
    expect(calculateExactFinalAllocations(bookings,
      [{bookingId: 1592, amount: 1500000}], 3000000)).toBeNull();
  });
});
