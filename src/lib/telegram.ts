import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { kvGetMany, kvSet } from "./kv";

// Secrets live in kv under "secret:" (never exported in backups).
export const TG = { token: "secret:telegram_token", bot: "telegram_bot", chat: "secret:telegram_chat", pending: "secret:telegram_pending" } as const;

type TgResult<T> = { ok: boolean; result?: T; description?: string };

async function call<T>(token: string, method: string, body?: object): Promise<TgResult<T>> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  }).catch(() => null);
  if (!res) return { ok: false, description: "network" };
  return (await res.json().catch(() => ({ ok: false, description: `http_${res.status}` }))) as TgResult<T>;
}

export async function telegramStatus() {
  const kv = await kvGetMany([TG.token, TG.bot, TG.chat]);
  return { hasToken: !!kv[TG.token], bot: kv[TG.bot] ?? null, connected: !!(kv[TG.token] && kv[TG.chat]) };
}

/** Validate and store a bot token (from @BotFather). Returns the bot's username. */
export async function saveBotToken(token: string) {
  const clean = token.trim();
  if (!/^\d{5,}:[\w-]{30,}$/.test(clean)) throw new Error("bad_token");
  const me = await call<{ username: string }>(clean, "getMe");
  if (!me.ok || !me.result) throw new Error("bad_token");
  await kvSet(TG.token, clean);
  await kvSet(TG.bot, me.result.username);
  await kvSet(TG.chat, null);
  return me.result.username;
}

/** Start linking: returns a t.me deep link carrying a one-time code. */
export async function startLink() {
  const kv = await kvGetMany([TG.token, TG.bot]);
  if (!kv[TG.token] || !kv[TG.bot]) throw new Error("no_token");
  // Linking reads getUpdates, which Telegram refuses while a webhook is set.
  await call(kv[TG.token], "deleteWebhook");
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await kvSet(TG.pending, code);
  return { url: `https://t.me/${kv[TG.bot]}?start=${code}`, code };
}

/** Finish linking: look for "/start <code>" in the bot's recent updates. */
export async function finishLink(): Promise<boolean> {
  const kv = await kvGetMany([TG.token, TG.pending]);
  if (!kv[TG.token] || !kv[TG.pending]) return false;
  const upd = await call<{ update_id: number; message?: { text?: string; chat: { id: number } } }[]>(kv[TG.token], "getUpdates?limit=50&timeout=0");
  const hit = upd.result?.findLast((u) => u.message?.text?.trim() === `/start ${kv[TG.pending]}`);
  if (!hit?.message) return false;
  await kvSet(TG.chat, String(hit.message.chat.id));
  await kvSet(TG.pending, null);
  // Acknowledge processed updates so they don't pile up.
  await call(kv[TG.token], `getUpdates?offset=${hit.update_id + 1}&limit=1&timeout=0`);
  return true;
}

export async function disconnect() {
  await kvSet(TG.chat, null);
  await kvSet(TG.pending, null);
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/** Send an HTML-formatted message. Returns false when Telegram isn't connected. */
export async function sendTelegram(html: string): Promise<boolean> {
  const kv = await kvGetMany([TG.token, TG.chat]);
  if (!kv[TG.token] || !kv[TG.chat]) return false;
  const r = await call(kv[TG.token], "sendMessage", { chat_id: kv[TG.chat], text: html.slice(0, 4000), parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  return r.ok;
}

// ---- Incoming messages (webhook) ----

/** Secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token, derived from SESSION_SECRET. */
export function webhookSecret() {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("SESSION_SECRET missing");
  return createHmac("sha256", key).update("nexus-telegram-webhook-v1").digest("hex");
}

export function verifyWebhookSecret(header: string | null) {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(webhookSecret());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The stable public origin (never a protected per-deployment URL). */
export function publicOrigin(fallback: string) {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return prod ? `https://${prod}` : fallback;
}

/** Point the bot at /api/telegram when it's linked. Idempotent; cheap when already set. */
export async function ensureWebhook(origin: string): Promise<boolean> {
  const kv = await kvGetMany([TG.token, TG.chat]);
  if (!kv[TG.token] || !kv[TG.chat]) return false;
  const url = `${publicOrigin(origin)}/api/telegram`;
  if (!url.startsWith("https://")) return false; // Telegram requires HTTPS (skip on localhost)
  const info = await call<{ url: string }>(kv[TG.token], "getWebhookInfo");
  if (info.ok && info.result?.url === url) return true;
  const r = await call(kv[TG.token], "setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message"] });
  return r.ok;
}

/** The linked chat id, or null. Messages from any other chat are ignored. */
export async function linkedChat() {
  const kv = await kvGetMany([TG.token, TG.chat]);
  return kv[TG.token] && kv[TG.chat] ? kv[TG.chat] : null;
}

export async function replyTelegram(chatId: string, html: string, replyTo?: number) {
  const kv = await kvGetMany([TG.token]);
  if (!kv[TG.token]) return false;
  const r = await call(kv[TG.token], "sendMessage", {
    chat_id: chatId,
    text: html.slice(0, 4000),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  });
  return r.ok;
}
