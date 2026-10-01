export type CstWaGatewayGroup = {
  id: string;
  deviceId: string;
  jid: string;
  name: string;
  subject: string | null;
  participantCount: number;
  isActive: boolean;
};

export type CstWaGatewaySendResult = {
  status: string;
  messageId: string;
};

export type CstWaGatewayDevice = {
  deviceId: string;
  name: string;
  enabled: boolean;
  status: string;
  phoneNumber: string | null;
  workerId: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  companyId: string;
};

function normalizeBaseUrl(value: unknown): string {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function gatewayToken(): string {
  return String(process.env.CST_WA_GATEWAY_TOKEN ?? "").trim();
}

function gatewayBaseUrl(): string {
  return normalizeBaseUrl(process.env.CST_WA_GATEWAY_URL);
}

export function getCstWaGatewayPublicConfig(): {
  configured: boolean;
  baseUrl: string;
} {
  const baseUrl = gatewayBaseUrl();
  return {
    configured: Boolean(baseUrl && gatewayToken()),
    baseUrl,
  };
}

async function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = gatewayBaseUrl();
  const token = gatewayToken();
  if (!baseUrl || !token) {
    throw new Error("CST WA Gateway belum dikonfigurasi di environment server");
  }

  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
}

export async function listCstWaGatewayDevices(): Promise<CstWaGatewayDevice[]> {
  const response = await gatewayFetch("/v1/devices");
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof body?.error === "string" ? body.error : `HTTP_${response.status}`;
    throw new Error(`CST WA Gateway devices gagal: ${code}`);
  }
  if (!Array.isArray(body?.devices)) {
    throw new Error("CST WA Gateway devices response tidak valid");
  }

  return body.devices.flatMap((value): CstWaGatewayDevice[] => {
    if (!value || typeof value !== "object") return [];
    const device = value as Record<string, unknown>;
    if (
      typeof device.deviceId !== "string" ||
      typeof device.name !== "string" ||
      typeof device.enabled !== "boolean" ||
      typeof device.status !== "string"
    ) return [];
    return [{
      deviceId: device.deviceId,
      name: device.name,
      enabled: device.enabled,
      status: device.status,
      phoneNumber: typeof device.phoneNumber === "string" ? device.phoneNumber : null,
      workerId: typeof device.workerId === "string" ? device.workerId : null,
      lastHeartbeatAt: typeof device.lastHeartbeatAt === "string" ? device.lastHeartbeatAt : null,
      lastError: typeof device.lastError === "string" ? device.lastError : null,
      companyId: typeof device.companyId === "string" ? device.companyId : "",
    }];
  });
}

export async function listCstWaGatewayGroups(deviceId?: string): Promise<CstWaGatewayGroup[]> {
  const query = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : "";
  const response = await gatewayFetch(`/v1/groups${query}`);
  if (!response.ok) {
    throw new Error(`CST WA Gateway groups gagal: HTTP ${response.status}`);
  }

  const body = await response.json() as { groups?: unknown };
  if (!Array.isArray(body.groups)) {
    throw new Error("CST WA Gateway groups response tidak valid");
  }

  return body.groups.flatMap((value): CstWaGatewayGroup[] => {
    if (!value || typeof value !== "object") return [];
    const group = value as Record<string, unknown>;
    if (
      typeof group.id !== "string" ||
      typeof group.deviceId !== "string" ||
      typeof group.jid !== "string" ||
      typeof group.name !== "string"
    ) return [];
    return [{
      id: group.id,
      deviceId: group.deviceId,
      jid: group.jid,
      name: group.name,
      subject: typeof group.subject === "string" ? group.subject : null,
      participantCount: typeof group.participantCount === "number" ? group.participantCount : 0,
      isActive: group.isActive !== false,
    }];
  });
}

export async function syncCstWaGatewayGroups(deviceId: string): Promise<{ status: string; jobs: string[] }> {
  const response = await gatewayFetch("/v1/groups/sync", {
    method: "POST",
    body: JSON.stringify({ deviceId }),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof body?.error === "string" ? body.error : `HTTP_${response.status}`;
    if (code === "ENABLED_DEVICE_NOT_FOUND") {
      throw new Error(
        `Device ${deviceId} belum tersedia untuk company milik API Client sport-center. ` +
        "Buka CST WA Gateway → Device, samakan Company device dengan Company API Client sport-center, lalu coba sinkronkan lagi.",
      );
    }
    if (code === "FORBIDDEN" && body?.requiredScope === "groups:write") {
      throw new Error(
        "API Client sport-center belum memiliki permission groups:write. Aktifkan Manage groups di CST WA Gateway → API Clients.",
      );
    }
    throw new Error(`CST WA Gateway group sync gagal: ${code}`);
  }
  return {
    status: typeof body?.status === "string" ? body.status : "sync_queued",
    jobs: Array.isArray(body?.jobs) ? body!.jobs.map(String) : [],
  };
}

export async function sendCstWaGatewayGroupMessage(input: {
  groupId: string;
  text: string;
  idempotencyKey: string;
}): Promise<CstWaGatewaySendResult> {
  const response = await gatewayFetch("/v1/messages", {
    method: "POST",
    headers: {
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      groupId: input.groupId,
      type: "text",
      text: input.text,
    }),
  });

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof body?.error === "string" ? body.error : `HTTP_${response.status}`;
    throw new Error(`CST WA Gateway send gagal: ${code}`);
  }

  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const status = typeof body?.status === "string" ? body.status : "";
  if (!messageId || !status) {
    throw new Error("CST WA Gateway send response tidak valid");
  }
  return { status, messageId };
}


export function getCstWaGatewayMinaDeviceId(): string {
  return String(process.env.CST_WA_MINA_DEVICE_ID ?? "mina-ai-sport-center").trim() || "mina-ai-sport-center";
}

export function getCstWaGatewayReportDeviceId(): string {
  return String(process.env.CST_WA_REPORT_DEVICE_ID ?? "sport-center-report").trim() || "sport-center-report";
}

export async function sendCstWaGatewayDirectMessage(input: {
  deviceId?: string;
  to: string;
  text: string;
  idempotencyKey: string;
}): Promise<CstWaGatewaySendResult> {
  const response = await gatewayFetch("/v1/messages", {
    method: "POST",
    headers: {
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify({
      deviceId: input.deviceId ?? getCstWaGatewayMinaDeviceId(),
      to: input.to,
      type: "text",
      text: input.text,
    }),
  });

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof body?.error === "string" ? body.error : `HTTP_${response.status}`;
    throw new Error(`CST WA Gateway direct send gagal: ${code}`);
  }

  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const status = typeof body?.status === "string" ? body.status : "";
  if (!messageId || !status) {
    throw new Error("CST WA Gateway direct send response tidak valid");
  }
  return { status, messageId };
}

export type CstWaGatewayInboundEvent = {
  deliveryId: string;
  eventType: string;
  companyId: string;
  deviceId: string;
  payload: unknown;
  createdAt: string;
};

export async function getCstWaGatewayInboundEvent(
  eventId: string,
): Promise<CstWaGatewayInboundEvent> {
  const response = await gatewayFetch(`/v1/inbound-events/${encodeURIComponent(eventId)}`);
  if (!response.ok) {
    throw new Error(`CST WA Gateway inbound verification gagal: HTTP ${response.status}`);
  }

  const body = await response.json() as Record<string, unknown>;
  if (
    typeof body.deliveryId !== "string" ||
    typeof body.eventType !== "string" ||
    typeof body.companyId !== "string" ||
    typeof body.deviceId !== "string" ||
    typeof body.createdAt !== "string"
  ) {
    throw new Error("CST WA Gateway inbound verification response tidak valid");
  }

  return {
    deliveryId: body.deliveryId,
    eventType: body.eventType,
    companyId: body.companyId,
    deviceId: body.deviceId,
    payload: body.payload,
    createdAt: body.createdAt,
  };
}
