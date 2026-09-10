export type AdditionalCharge = {
  name: string;
  amount: number;
};

const MAX_ITEMS = 20;
const MAX_NAME_LENGTH = 120;
const MAX_AMOUNT = 1_000_000_000;

function invalid(message: string): never {
  throw new Error(`Biaya tambahan tidak valid: ${message}`);
}

export function normalizeAdditionalCharges(input: unknown): AdditionalCharge[] {
  if (input == null) return [];
  if (!Array.isArray(input)) invalid("format harus berupa array");
  if (input.length > MAX_ITEMS) invalid(`maksimal ${MAX_ITEMS} item`);

  return input.map((raw, index) => {
    if (!raw || typeof raw !== "object") invalid(`item ke-${index + 1} tidak valid`);
    const value = raw as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const amount = typeof value.amount === "number" ? value.amount : Number(value.amount);

    if (!name) invalid(`nama item ke-${index + 1} wajib diisi`);
    if (name.length > MAX_NAME_LENGTH) invalid(`nama item ke-${index + 1} terlalu panjang`);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      invalid(`nominal item ke-${index + 1} harus berupa bilangan bulat positif`);
    }
    if (amount > MAX_AMOUNT) invalid(`nominal item ke-${index + 1} terlalu besar`);

    return { name, amount };
  });
}

export function additionalChargesTotal(charges: AdditionalCharge[]): number {
  return charges.reduce((total, charge) => total + charge.amount, 0);
}