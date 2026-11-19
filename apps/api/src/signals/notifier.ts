import type { Fetch } from "../kite/client.js";

export interface Notifier {
  readonly name: string;
  /** Resolves true when the message was accepted by the channel. */
  send(text: string): Promise<boolean>;
}

/** Telegram Bot API. A bot you create with @BotFather, messaging your own chat. */
export function telegramNotifier(token: string, chatId: string, fetchImpl: Fetch = fetch): Notifier {
  return {
    name: "telegram",
    async send(text) {
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
