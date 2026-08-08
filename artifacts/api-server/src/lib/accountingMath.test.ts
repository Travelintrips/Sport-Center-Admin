import { jest } from "@jest/globals";

const mockSelect = jest.fn();
const mockInsert = jest.fn();

jest.unstable_mockModule("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
  accountingJournalsTable: {
    id: "id",
    paymentId: "payment_id",
    journalType: "journal_type",
    isReversal: "is_reversal",
  },
  accountingJournalLinesTable: {},
  taxTransactionsTable: {},
}));

jest.unstable_mockModule("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ left, right }),
  and: (...conditions: unknown[]) => conditions,
}));

const { extractBookingDpp } = await import("./accountingMath.js");
const { createJournalEntry } = await import("./accounting.js");

function selectResult(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: jest.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

function insertResult(returningRows: unknown[] = []) {
  return {
    values: jest.fn().mockImplementation((values: unknown) => ({
      returning: jest.fn().mockResolvedValue(returningRows),
      values,
    })),
  };
}

describe("confirmed booking payment accounting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("extracts DPP from an inclusive-PPN price", () => {
    const amounts = extractBookingDpp({
      totalPrice: "200000",
      grandTotal: "200000",
      ppnAmount: "19820",
    });

    expect(amounts).toEqual({ dpp: 180180, ppnAmount: 19820 });
    expect(amounts.dpp + amounts.ppnAmount).toBe(200000);
  });

  it("creates exactly one internal journal on a duplicate confirmation", async () => {
    const journalValues: Record<string, unknown>[] = [];
    let journalLookupCount = 0;

    mockSelect.mockImplementation(() =>
      selectResult(journalLookupCount++ === 0 ? [] : [{ id: 101 }]),
    );
    mockInsert
      .mockImplementationOnce(() => ({
        values: jest.fn().mockImplementation((values: Record<string, unknown>) => {
          journalValues.push(values);
          return { returning: jest.fn().mockResolvedValue([{ id: 101 }]) };
        }),
      }))
      .mockImplementationOnce(() => insertResult());

    await createJournalEntry(
      15,
      "SC-0015",
      180180,
      19820,
      "2026-08-08",
      "Transfer Bank",
      15,
    );
    await createJournalEntry(
      15,
      "SC-0015",
      180180,
      19820,
      "2026-08-08",
      "Transfer Bank",
      15,
    );

    expect(journalValues).toHaveLength(1);
    expect(journalValues[0]).toMatchObject({
      paymentId: 15,
      debitAmount: "200000",
      creditRevenueAmount: "180180",
      creditPpnAmount: "19820",
    });
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });
});