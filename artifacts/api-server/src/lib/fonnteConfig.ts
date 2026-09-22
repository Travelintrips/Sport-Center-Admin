import { db, settingsTable } from "@workspace/db";

export const CUSTOMER_DEVICE_ENV = "FONNTE_CUSTOMER_DEVICE";
export const CUSTOMER_INBOUND_DEVICES_ENV = "FONNTE_CUSTOMER_INBOUND_DEVICES";

export type FonnteConfig = {
  adminToken: string;
  adminTokenSource: FonnteValueSource;
  customerToken: string;
  customerTokenSource: FonnteValueSource;
  customerDevice: string;
  customerDeviceSource: MinaDeviceResolution["source"];
};

export type FonnteValueSource = "settings" | "environment" | "missing";

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

export function resolveFonnteValueSource(settingsValue: unknown, environmentValue: unknown): FonnteValueSource {
  if (String(settingsValue ?? "").trim()) return "settings";
  if (String(environmentValue ?? "").trim()) return "environment";
  return "missing";
}

export function normalizeFonnteDeviceList(value: unknown): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  return [...new Set(
    raw
      .split(/[,;|\n]+/)
      .map((item) => normalizeFonnteDevice(item))
      .filter(Boolean),
  )];
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

export function resolveMinaFonnteDeviceValue(
  settingsValue: unknown,
  environmentValue: unknown = process.env[CUSTOMER_DEVICE_ENV],
): MinaDeviceResolution {
  const configured = String(settingsValue ?? "").trim();
  if (configured) {
    const deviceNumber = normalizeFonnteDevice(configured);
    return {
      deviceNumber,
      source: deviceNumber ? "settings" : "missing",
    };
  }

  const deviceNumber = normalizeFonnteDevice(environmentValue);
  return {
    deviceNumber,
    source: deviceNumber ? "environment" : "missing",
  };
}

export async function resolveMinaFonnteDevice(): Promise<MinaDeviceResolution> {
  try {
    const [settings] = await db
      .select({ device: settingsTable.fonnteCustomerDevice })
      .from(settingsTable)
      .limit(1);
    return resolveMinaFonnteDeviceValue(settings?.device);
  } catch {
    // A missing/older schema must not prevent the env fallback from working.
  }

  return resolveMinaFonnteDeviceValue(undefined);
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
  const allowedDevices = new Set([
    ...(normalizedConfiguredDevice ? [normalizedConfiguredDevice] : []),
    ...normalizeFonnteDeviceList(process.env[CUSTOMER_INBOUND_DEVICES_ENV]),
  ]);
  return {
    accepted: Boolean(providedDevice && allowedDevices.has(providedDevice)),
    providedDevice: providedDevice || null,
    configuredDevice: normalizedConfiguredDevice,
    source: resolved.source,
  };
}

export async function getFonnteConfig(): Promise<FonnteConfig> {
  const minaDevice = await resolveMinaFonnteDevice();
  let settingsTokens: {
    adminToken?: unknown;
    customerToken?: unknown;
  } = {};

  try {
    const [settings] = await db
      .select({
        adminToken: settingsTable.fonnteToken,
        customerToken: settingsTable.fonnteCustomerToken,
      })
      .from(settingsTable)
      .limit(1);
    settingsTokens = settings ?? {};
  } catch {
    // Token schema drift must not hide a valid Settings DB device.
  }

  return {
    adminToken: resolveFonnteToken(settingsTokens.adminToken, process.env.FONNTE_TOKEN),
    adminTokenSource: resolveFonnteValueSource(settingsTokens.adminToken, process.env.FONNTE_TOKEN),
    customerToken: resolveFonnteToken(settingsTokens.customerToken, process.env.FONNTE_CUSTOMER_TOKEN),
    customerTokenSource: resolveFonnteValueSource(settingsTokens.customerToken, process.env.FONNTE_CUSTOMER_TOKEN),
    customerDevice: minaDevice.deviceNumber,
    customerDeviceSource: minaDevice.source,
  };
}