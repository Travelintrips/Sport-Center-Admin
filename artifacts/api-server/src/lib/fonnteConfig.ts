import { db, settingsTable } from "@workspace/db";

export const CUSTOMER_DEVICE_ENV = "FONNTE_CUSTOMER_DEVICE";

export type FonnteConfig = {
  adminToken: string;
  customerToken: string;
};

export type MinaDeviceResolution = {
  deviceNumber: string;
  source: "settings" | "environment" | "missing";
};

export function selectFonnteToken(config: FonnteConfig, useCustomerToken: boolean): string {
  return useCustomerToken ? config.customerToken : config.adminToken;
}

export function resolveFonnteToken(settingsValue: unknown, environmentValue: unknown): string {
  return String(settingsValue ?? "").trim() || String(environmentValue ?? "").trim();
}

export function normalizeFonnteDevice(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const withoutSuffix = raw.replace(/@c\.us$/i, "").trim();
  if (!/^[+0-9().\s-]+$/.test(withoutSuffix)) return "";
  let digits = withoutSuffix.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;
  return /^628\d{8,11}$/.test(digits) ? digits : "";
}

export async function resolveMinaFonnteDevice(): Promise<MinaDeviceResolution> {
  try {
    const [settings] = await db
      .select({ device: settingsTable.fonnteCustomerDevice })
      .from(settingsTable)
      .limit(1);
    const configured = String(settings?.device ?? "").trim();
    if (configured) {
      const deviceNumber = normalizeFonnteDevice(configured);
      return {
        deviceNumber,
        source: deviceNumber ? "settings" : "missing",
      };
    }
  } catch {
    // A missing/older schema must not prevent the env fallback from working.
  }

  const deviceNumber = normalizeFonnteDevice(process.env[CUSTOMER_DEVICE_ENV]);
  return {
    deviceNumber,
    source: deviceNumber ? "environment" : "missing",
  };
}

export async function validateMinaFonnteWebhookDevice(
  body: Record<string, unknown>,
  configuredDevice?: unknown,
): Promise<{
  accepted: boolean;
  providedDevice: string | null;
  configuredDevice: string | null;
  source: MinaDeviceResolution["source"];
}> {
  const resolved = configuredDevice === undefined
    ? await resolveMinaFonnteDevice()
    : {
        deviceNumber: normalizeFonnteDevice(configuredDevice),
        source: "settings" as const,
      };
  const normalizedConfiguredDevice = resolved.deviceNumber || null;
  if (!Object.prototype.hasOwnProperty.call(body, "device")) {
    return {
      accepted: Boolean(normalizedConfiguredDevice),
      providedDevice: null,
      configuredDevice: normalizedConfiguredDevice,
      source: resolved.source,
    };
  }

  const providedDevice = normalizeFonnteDevice(body.device);
  return {
    accepted: Boolean(normalizedConfiguredDevice && providedDevice === normalizedConfiguredDevice),
    providedDevice: providedDevice || null,
    configuredDevice: normalizedConfiguredDevice,
    source: resolved.source,
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
      adminToken: resolveFonnteToken(settings?.adminToken, process.env.FONNTE_TOKEN),
      customerToken: resolveFonnteToken(settings?.customerToken, process.env.FONNTE_CUSTOMER_TOKEN),
    };
  } catch {
    return {
      adminToken: resolveFonnteToken(undefined, process.env.FONNTE_TOKEN),
      customerToken: resolveFonnteToken(undefined, process.env.FONNTE_CUSTOMER_TOKEN),
    };
  }
}