const _sentMsgTexts = new Map<string, number>();

export function trackSentMessage(msg: string): void {
  const key = msg.trim().toLowerCase().substring(0, 120);
  _sentMsgTexts.set(key, Date.now());
  setTimeout(() => _sentMsgTexts.delete(key), 60 * 1000);
}

export function isBotEcho(msg: string): boolean {
  const key = msg.trim().toLowerCase().substring(0, 120);
  const ts = _sentMsgTexts.get(key);
  return !!ts && Date.now() - ts < 60 * 1000;
}

/**
 * Fonnte may append a provider footer when it echoes an outbound message
 * into the inbound webhook. Mina's initial greeting must never be treated as
 * customer input for the active booking session.
 */
export function isMinaGreetingEcho(msg: string): boolean {
  return /^Halo! Aku Mina asisten Sport Center\b/i.test(msg.trimStart());
}

/**
 * Fonnte's free-package/reply mode can echo an outbound Mina message into
 * the inbound webhook with a provider footer. The echoed text may also
 * contain a quoted-message header, so it cannot be detected reliably by
 * checking the first line or by the short-lived outbound cache alone.
 */
export function isFonnteProviderEcho(msg: string): boolean {
  return /(?:^|\n)\s*>?\s*[_*~]?\s*sent\s+via\s+fonnte\.com\s*[_*~]?\s*(?:\n|$)/im.test(msg);
}
