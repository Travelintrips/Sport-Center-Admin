import { db, settingsTable } from "@workspace/db";

export const MINA_FONNTE_DEVICE = "6282321301338";

export type FonnteConfig = {
  adminToken: string;
  customerToken: string;
};

export function selectFonnteToken(config: FonnteConfig, useCustomerToken: boolean): string {
  return useCustomerToken ? config.customerToken : config.adminToken;
}

export function normalizeFonnteDevice(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return digits;
}

export function validateMinaFonnteWebhookDevice(body: Record<string, unknown>): {
  accepted: boolean;
  providedDevice: string | null;
} {
  if (!Object.prototype.hasOwnProperty.call(body, "device")) {
    return { accepted: true, providedDevice: null };
  }

  const providedDevice = normalizeFonnteDevice(body.device);
  return {
    accepted: providedDevice === MINA_FONNTE_DEVICE,
    providedDevice: providedDevice || null,
  };
}

export async function getFonnteConfig(): Promise<FonnteConfig> {
  try {
    const [settings] = await db
      .select({
        adminToken: settingsTable.fonnteToken,
        customerToken: settingsTable.fonnteCustomerToken,
      })
      .from(settingsTable)
      .limit(1);

    return {
      adminToken: settings?.adminToken?.trim() || process.env.FONNTE_TOKEN?.trim() || "",
      customerToken:
        settings?.customerToken?.trim() ||
        process.env.FONNTE_CUSTOMER_TOKEN?.trim() ||
        "",
    };
  } catch {
    return {
      adminToken: process.env.FONNTE_TOKEN?.trim() || "",
      customerToken: process.env.FONNTE_CUSTOMER_TOKEN?.trim() || "",
    };
  }
}