/** Partial group payments with no withholding or VAT must post their own paid
 * amount, never the grandTotal of the representative child booking. */
export function resolvePartialPaymentGrossAmount(args: {
  paymentType: string;
  paymentAmount: number;
  proposedGross: number;
  ppnAmount: number;
  pphAmount: number;
}): number {
  if (["dp", "pelunasan"].includes(args.paymentType) &&
      args.ppnAmount === 0 && args.pphAmount === 0) {
    return args.paymentAmount;
  }
  return args.proposedGross;
}
