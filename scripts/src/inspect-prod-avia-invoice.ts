import { loadSecretsFromGSM } from "../../artifacts/api-server/src/lib/secretLoader";

process.env.NODE_ENV = "production";
await loadSecretsFromGSM();

const {
  db,
  pool,
  companyInvoicesTable,
  companyInvoiceItemsTable,
  bookingsTable,
  usersTable,
  bankMutationsTable,
  bankReconciliationMatchesTable,
} = await import("@workspace/db");
const { and, eq, gte, ilike, lte, or } = await import("drizzle-orm");

const invoices = await db
  .select({
    id: companyInvoicesTable.id,
    invoiceNumber: companyInvoicesTable.invoiceNumber,
    companyCustomerId: companyInvoicesTable.companyCustomerId,
    companyName: usersTable.companyName,
    userName: usersTable.name,
    periodMonth: companyInvoicesTable.periodMonth,
    totalAmount: companyInvoicesTable.totalAmount,
    grandTotal: companyInvoicesTable.grandTotal,
    pphRate: companyInvoicesTable.pphRate,
    pphAmount: companyInvoicesTable.pphAmount,
    netAmount: companyInvoicesTable.netAmount,
    paidAmount: companyInvoicesTable.paidAmount,
    remainingAmount: companyInvoicesTable.remainingAmount,
    status: companyInvoicesTable.status,
    paidAt: companyInvoicesTable.paidAt,
    paymentMethod: companyInvoicesTable.paymentMethod,
  })
  .from(companyInvoicesTable)
  .leftJoin(usersTable, eq(usersTable.id, companyInvoicesTable.companyCustomerId))
  .where(or(
    eq(companyInvoicesTable.invoiceNumber, "INV-202607-0002"),
    and(
      eq(companyInvoicesTable.periodMonth, "2026-07"),
      or(
        ilike(usersTable.companyName, "%AVIA%"),
        ilike(usersTable.name, "%AVIA%"),
      ),
    ),
  ));

const output = [];
for (const invoice of invoices) {
  const items = await db
    .select({
      id: companyInvoiceItemsTable.id,
      bookingId: companyInvoiceItemsTable.bookingId,
      bookingDate: companyInvoiceItemsTable.bookingDate,
      totalAmount: companyInvoiceItemsTable.totalAmount,
      orderNumber: companyInvoiceItemsTable.orderNumber,
    })
    .from(companyInvoiceItemsTable)
    .where(eq(companyInvoiceItemsTable.invoiceId, invoice.id));
  const bookingIds = items
    .map((item) => item.bookingId)
    .filter((id): id is number => id != null);
  const bookings = bookingIds.length > 0
    ? await db
        .select({
          id: bookingsTable.id,
          orderNumber: bookingsTable.orderNumber,
          bookingDate: bookingsTable.bookingDate,
          companyInvoiceId: bookingsTable.companyInvoiceId,
          netAmount: bookingsTable.netAmount,
          grandTotal: bookingsTable.grandTotal,
          paidAt: bookingsTable.paidAt,
          billingStatus: bookingsTable.billingStatus,
        })
        .from(bookingsTable)
        .where(or(
          ...bookingIds.map((bookingId) => eq(bookingsTable.id, bookingId)),
        ))
    : [];
  const bankMutations = await db
    .select({
      id: bankMutationsTable.id,
      transactionDate: bankMutationsTable.transactionDate,
      description: bankMutationsTable.description,
      amount: bankMutationsTable.amount,
      direction: bankMutationsTable.direction,
      status: bankMutationsTable.status,
      matchedOrderId: bankMutationsTable.matchedOrderId,
      accountingPosted: bankMutationsTable.accountingPosted,
      journalId: bankMutationsTable.journalId,
    })
    .from(bankMutationsTable)
    .where(or(
      eq(bankMutationsTable.amount, "5459459"),
      eq(bankMutationsTable.amount, "5459460"),
      ilike(bankMutationsTable.description, `%${invoice.invoiceNumber}%`),
      and(
        eq(bankMutationsTable.transactionDate, "2026-09-07"),
        gte(bankMutationsTable.amount, "5000000"),
        lte(bankMutationsTable.amount, "6500000"),
      ),
    ));
  const mutationIds = bankMutations.map((mutation) => mutation.id);
  const reconMatches = mutationIds.length > 0
    ? await db
        .select({
          id: bankReconciliationMatchesTable.id,
          mutationId: bankReconciliationMatchesTable.mutationId,
          candidateType: bankReconciliationMatchesTable.candidateType,
          candidateId: bankReconciliationMatchesTable.candidateId,
          matchScore: bankReconciliationMatchesTable.matchScore,
          amountMatch: bankReconciliationMatchesTable.amountMatch,
          dateMatch: bankReconciliationMatchesTable.dateMatch,
          status: bankReconciliationMatchesTable.status,
        })
        .from(bankReconciliationMatchesTable)
        .where(or(
          ...mutationIds.map((mutationId) => eq(bankReconciliationMatchesTable.mutationId, mutationId)),
        ))
    : [];
  output.push({ invoice, items, bookings, bankMutations, reconMatches });
}

console.log(JSON.stringify(output, null, 2));
await pool.end();