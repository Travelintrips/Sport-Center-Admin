import { createHash } from "node:crypto";
import { sendCstWaGatewayTextMessage } from "./cstWaGateway";
import { logger } from "./logger";

function splitMessage(message: string, maxLength = 8000): string[] {
  const text = message.trim();
  if (!text) return [];
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut < Math.floor(maxLength * 0.6)) cut = maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function sendMinaGatewayText(input: {
  deviceId: string;
  phone: string;
  message: string;
  replyToProviderMessageId?: string;
}): Promise<boolean> {
  if (!input.deviceId || !input.phone) return false;
  const chunks = splitMessage(input.message);
  if (!chunks.length) return false;

  for (const [index, text] of chunks.entries()) {
    const digest = createHash("sha256")
      .update([
        input.deviceId,
        input.phone,
        input.replyToProviderMessageId ?? "",
        String(index),
        text,
      ].join("|"))
      .digest("hex")
      .slice(0, 48);

    try {
      const queued = await sendCstWaGatewayTextMessage({
        deviceId: input.deviceId,
        to: input.phone,
        text,
        idempotencyKey: `mina:${digest}`,
        ...(input.replyToProviderMessageId
          ? { replyToProviderMessageId: input.replyToProviderMessageId }
          : {}),
      });
      logger.info(
        {
          provider: "cst_gateway",
          deviceId: input.deviceId,
          messageId: queued.messageId,
          status: queued.status,
          chunk: index + 1,
          chunks: chunks.length,
        },
        "[wa] Mina outbound queued",
      );
    } catch (error) {
      logger.error(
        {
          provider: "cst_gateway",
          deviceId: input.deviceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "[wa] Mina outbound failed",
      );
      return false;
    }
  }

  return true;
}
