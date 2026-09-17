import {
  cleanMinaText,
  createMinaRateLimiter,
  isValidMinaSessionId,
  MAX_REQUESTS_PER_WINDOW,
  MAX_MESSAGE_LENGTH,
  normalizeMinaPagePath,
  readCookieHeader,
  RATE_WINDOW_MS,
} from "./minaWebSecurity";
import { appendTurn, getHistory, clearHistory } from "./aiConversationMemory";
import { generateAiReply } from "../services/aiSportCenterService";

describe("Web Mina security and session helpers", () => {
  afterEach(() => {
    clearHistory("web:test-session");
  });

  it("accepts only UUID-shaped session identifiers", () => {
    expect(isValidMinaSessionId("369cc436-712f-42a2-b88e-8b7fb54eca4d")).toBe(true);
    expect(isValidMinaSessionId("web-session")).toBe(false);
    expect(isValidMinaSessionId(undefined)).toBe(false);
  });

  it("reads the Mina cookie without trusting unrelated cookies", () => {
    expect(readCookieHeader("theme=dark; mina_web_session=abc; other=value", "mina_web_session")).toBe("abc");
    expect(readCookieHeader(undefined, "mina_web_session")).toBeUndefined();
  });

  it("bounds message input and strips page query/hash from the AI context", () => {
    expect(cleanMinaText(`  ${"x".repeat(MAX_MESSAGE_LENGTH + 20)}  `, MAX_MESSAGE_LENGTH)).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(normalizeMinaPagePath("https://example.invalid/facilities/5?prompt=ignore#hash")).toBe("/facilities/5");
    expect(normalizeMinaPagePath("/facilities/5")).toBe("/facilities/5");
  });

  it("limits a session/IP key to the documented request window", () => {
    let now = 1_000;
    const isLimited = createMinaRateLimiter(() => now);

    for (let index = 0; index < MAX_REQUESTS_PER_WINDOW; index += 1) {
      expect(isLimited("ip:session")).toBe(false);
    }
    expect(isLimited("ip:session")).toBe(true);
    now += RATE_WINDOW_MS;
    expect(isLimited("ip:session")).toBe(false);
  });

  it("keeps web history isolated and bounded to the active session", () => {
    appendTurn("web:test-session", "user", "Saya mau badminton");
    appendTurn("web:test-session", "assistant", "Badminton Court A tersedia.");
    expect(getHistory("web:test-session")).toEqual([
      { role: "user", content: "Saya mau badminton" },
      { role: "assistant", content: "Badminton Court A tersedia." },
    ]);
    expect(getHistory("web:other-session")).toEqual([]);
  });

  it("fails closed when the AI provider configuration is unavailable", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(
        generateAiReply("", "Halo", [], { channel: "web" }),
      ).resolves.toMatchObject({
        reply: "",
        fallbackToAdmin: true,
        fallbackReason: "configuration_missing",
      });
    } finally {
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
    }
  });
});