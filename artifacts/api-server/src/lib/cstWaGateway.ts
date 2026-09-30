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

export async function listCstWaGatewayGroups(): Promise<CstWaGatewayGroup[]> {
  const response = await gatewayFetch("/v1/groups");
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
