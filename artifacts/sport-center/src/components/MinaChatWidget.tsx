import { FormEvent, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowUpRight, LoaderCircle, MessageCircle, Minus, Send, Sparkles, X } from "lucide-react";
import { useGetSettings } from "@workspace/api-client-react";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

const QUICK_ACTIONS = [
  "Booking Fasilitas",
  "Cek Jadwal",
  "Cek Harga",
  "Gym & Membership",
];

function renderReply(content: string) {
  return content.split(/(https?:\/\/[^\s]+)/g).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="break-all font-semibold text-primary underline underline-offset-2"
      >
        {part}
      </a>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  );
}

export default function MinaChatWidget() {
  const [location] = useLocation();
  const { data: settings } = useGetSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content: "Halo! Saya Mina, asisten Sport Center. Ada yang bisa saya bantu?",
    },
  ]);
  const nextMessageId = useRef(2);

  const pageContext = useMemo(() => {
    const match = location.match(/^\/facilities\/(\d+)/);
    return {
      currentUrl: window.location.href,
      ...(match ? { facilityId: Number(match[1]) } : {}),
    };
  }, [location]);

  const waHref = useMemo(() => {
    let phone = settings?.whatsapp || "";
    if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
    phone = phone.replace(/[^0-9]/g, "");
    return phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent("Halo, saya ingin melanjutkan percakapan dengan Mina.")}`
      : "";
  }, [settings?.whatsapp]);

  async function sendMessage(rawMessage?: string) {
    const message = (rawMessage ?? input).trim();
    if (!message || isSending) return;

    setInput("");
    setError("");
    setIsOpen(true);
    setIsMinimized(false);
    setMessages((current) => [
      ...current,
      { id: nextMessageId.current++, role: "user", content: message },
    ]);
    setIsSending(true);

    try {
      const response = await fetch("/api/mina/web/message", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, pageContext }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
        fallbackToWhatsapp?: boolean;
      };

      if (!response.ok || !payload.reply) {
        throw new Error(payload.error || "Mina sedang tidak tersedia.");
      }

      setMessages((current) => [
        ...current,
        { id: nextMessageId.current++, role: "assistant", content: payload.reply! },
      ]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Mina sedang tidak tersedia.");
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  return (
    <>
      {isOpen && !isMinimized && (
        <section
          aria-label="Chat Mina"
          className="fixed inset-x-0 bottom-0 z-[60] flex h-[min(100dvh,680px)] flex-col overflow-hidden rounded-t-3xl border border-border/70 bg-background shadow-2xl sm:inset-x-auto sm:bottom-24 sm:right-6 sm:h-[min(680px,calc(100vh-7rem))] sm:w-[390px] sm:rounded-3xl"
        >
          <header className="flex items-center justify-between bg-primary px-5 py-4 text-primary-foreground">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15">
                <Sparkles size={19} />
              </div>
              <div className="min-w-0">
                <h2 className="truncate font-bold">Mina — Asisten Sport Center</h2>
                <p className="text-xs text-primary-foreground/75">Bantu cek jadwal, harga, dan booking</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                aria-label="Minimalkan chat Mina"
                className="rounded-full p-2 transition-colors hover:bg-white/15"
              >
                <Minus size={17} />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Tutup chat Mina"
                className="rounded-full p-2 transition-colors hover:bg-white/15"
              >
                <X size={17} />
              </button>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-muted/20 p-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "rounded-br-md bg-primary text-primary-foreground"
                      : "rounded-bl-md border border-border/60 bg-background text-foreground shadow-sm"
                  }`}
                >
                  {message.role === "assistant" ? renderReply(message.content) : message.content}
                </div>
              </div>
            ))}

            {messages.length === 1 && !isSending && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    type="button"
                    key={action}
                    onClick={() => void sendMessage(action)}
                    className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-left text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
                  >
                    {action}
                  </button>
                ))}
              </div>
            )}

            {isSending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle size={15} className="animate-spin text-primary" />
                Mina sedang mengetik…
              </div>
            )}

            {error && (
              <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
                <p>{error}</p>
                {waHref && (
                  <a
                    href={waHref}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 font-bold underline underline-offset-2"
                  >
                    Lanjutkan di WhatsApp <ArrowUpRight size={13} />
                  </a>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/60 bg-background p-3">
            {waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noreferrer"
                className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"
              >
                Lanjutkan di WhatsApp <ArrowUpRight size={13} />
              </a>
            )}
            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Tulis pesan untuk Mina…"
                maxLength={2000}
                disabled={isSending}
                className="h-11 min-w-0 flex-1 rounded-2xl border border-border/70 bg-muted/30 px-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
              />
              <button
                type="submit"
                aria-label="Kirim pesan"
                disabled={!input.trim() || isSending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={17} />
              </button>
            </form>
          </div>
        </section>
      )}

      {!isOpen || isMinimized ? (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
          }}
          aria-label="Buka Chat Mina"
          className="fixed bottom-6 right-24 z-50 flex h-14 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-xl shadow-primary/30 transition-all hover:scale-105 hover:brightness-105"
        >
          <MessageCircle size={21} />
          <span className="hidden sm:inline">Chat Mina</span>
        </button>
      ) : null}
    </>
  );
}