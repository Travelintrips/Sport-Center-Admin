interface Turn {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

interface Session {
  turns: Turn[];
  lastActive: number;
}

const TTL_MS = 30 * 60 * 1000; // 30 menit tidak aktif → reset
const MAX_TURNS = 10;           // simpan 10 turn terakhir (5 user + 5 bot)

const store = new Map<string, Session>();

function evict(): void {
  const now = Date.now();
  for (const [phone, session] of store.entries()) {
    if (now - session.lastActive > TTL_MS) store.delete(phone);
  }
}

export function getHistory(phone: string): Array<{ role: "user" | "assistant"; content: string }> {
  evict();
  const session = store.get(phone);
  if (!session) return [];
  return session.turns.map(({ role, content }) => ({ role, content }));
}

export function appendTurn(phone: string, role: "user" | "assistant", content: string): void {
  evict();
  const now = Date.now();
  let session = store.get(phone);
  if (!session) {
    session = { turns: [], lastActive: now };
    store.set(phone, session);
  }
  session.turns.push({ role, content, ts: now });
  if (session.turns.length > MAX_TURNS) session.turns = session.turns.slice(-MAX_TURNS);
  session.lastActive = now;
}

export function clearHistory(phone: string): void {
  store.delete(phone);
}
