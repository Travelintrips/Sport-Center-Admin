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
