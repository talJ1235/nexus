import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/db";
import { activeSource, sumTotals, unitPrice } from "@/lib/calc";
import { loadItems } from "@/lib/data";
import { dictionaries, fmt, type Locale } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { getRates } from "@/lib/rates";
import { addSourceCore, createItemCore, previewUrlCore } from "@/lib/service";
import { escapeHtml, linkedChat, publicOrigin, replyTelegram, verifyWebhookSecret } from "@/lib/telegram";
import { extractUrls } from "@/lib/utils";

// Telegram bot webhook: the owner sends product links to their bot to add them to Nexus.
// Auth: Telegram echoes our secret header, AND the message must come from the chat linked in settings.
// Always answer 200 so Telegram doesn't retry (retries are harmless anyway: duplicates are detected).

export const maxDuration = 60;

type Entity = { type: string; url?: string };
type Update = {
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { language_code?: string };
    text?: string;
    caption?: string;
    entities?: Entity[];
    caption_entities?: Entity[];
  };
};

const MAX_LINKS = 5;
const done = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  if (!verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) return new Response("Unauthorized", { status: 401 });
  const update = (await req.json().catch(() => null)) as Update | null;
  const msg = update?.message;
  const chat = await linkedChat();
  if (!msg || !chat || String(msg.chat.id) !== chat) return done();

  const text = [msg.text, msg.caption].filter(Boolean).join("\n");
  const locale: Locale = /[֐-׿]/.test(text) || msg.from?.language_code === "he" ? "he" : "en";
  const t = dictionaries[locale].bot;
  const origin = publicOrigin(req.nextUrl.origin);
  const reply = (html: string) => replyTelegram(chat, html, msg.message_id);
  const command = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/@\w+$/, "") ?? "";

  if (command === "/list" || command === "/tobuy") {
    await reply(await toBuySummary(locale, origin));
    return done();
  }

  // Links in the text plus hidden links (text_link entities, e.g. from "share" buttons).
  const hidden = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])].flatMap((e) => (e.type === "text_link" && e.url ? [e.url] : []));
  const urls = [...new Set([...extractUrls(text), ...hidden])].slice(0, MAX_LINKS);
  if (!urls.length) {
    await reply(command === "/start" || command === "/help" ? t.help : t.noLink);
    return done();
  }

  const collection = await collectionFromHashtag(text);
  const lines: string[] = [];
  for (const url of urls) {
    try {
      const { draft, duplicate } = await previewUrlCore(url, collection?.id ?? null);
      if (duplicate?.reason === "title") {
        // Same product from another store: keep one item with both offers (as in the app).
        const item = await addSourceCore(duplicate.itemId, draft.source, draft.imageUrl);
        lines.push(fmt(t.addedSource, { title: link(`${origin}/?item=${item.id}`, item.title), store: escapeHtml(draft.source.store) }));
        continue;
      }
      if (duplicate) {
        lines.push(fmt(t.exists, { title: link(`${origin}/?item=${duplicate.itemId}`, duplicate.title) }));
        continue;
      }
      if (collection) draft.collectionId = collection.id;
      const item = await createItemCore(draft);
      const price = draft.source.price != null ? ` · ${formatMoney(draft.source.price, draft.source.currency, locale)}` : "";
      const where = collection ? ` ${fmt(t.into, { name: escapeHtml(collection.name) })}` : "";
      const title = link(`${origin}/?item=${item.id}`, item.title);
      lines.push(fmt(draft.quality === "full" ? t.added : t.addedPartial, { title }) + price + where);
    } catch {
      lines.push(fmt(t.failed, { url: escapeHtml(url.slice(0, 80)) }));
    }
  }
  await reply(lines.join("\n\n"));
  return done();
}

function link(href: string, label: string) {
  return `<a href="${escapeHtml(href).replace(/"/g, "&quot;")}">${escapeHtml(label.slice(0, 120))}</a>`;
}

/** "#railcam" or "#Home-Office" → the list/project whose name matches (ignoring case, spaces, - and _). */
async function collectionFromHashtag(text: string) {
  const tags = [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{2,40})/gu)].map((m) => norm(m[1]));
  if (!tags.length) return null;
  const all = await db.select({ id: schema.collections.id, name: schema.collections.name }).from(schema.collections);
  return all.find((c) => tags.includes(norm(c.name))) ?? all.find((c) => tags.some((tag) => norm(c.name).startsWith(tag))) ?? null;
}
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

async function toBuySummary(locale: Locale, origin: string) {
  const t = dictionaries[locale].bot;
  const [items, rates] = await Promise.all([loadItems(), getRates()]);
  const toBuy = items.filter((i) => i.status === "to_buy");
  if (!toBuy.length) return t.listEmpty;
  const currency = "ILS";
  const total = sumTotals(toBuy, rates, currency).total;
  const rank = { urgent: 0, normal: 1, someday: 2 } as const;
  const top = [...toBuy].sort((a, b) => rank[a.priority] - rank[b.priority] || b.createdAt - a.createdAt).slice(0, 12);
  const rows = top.map((i) => {
    const p = unitPrice(i, rates, currency);
    const store = activeSource(i, rates)?.store;
    const qty = i.quantity > 1 ? ` ×${i.quantity}` : "";
    return `• ${link(`${origin}/?item=${i.id}`, i.title)}${qty}${p != null ? ` — ${formatMoney(p, currency, locale)}` : ""}${store ? ` <i>(${escapeHtml(store)})</i>` : ""}`;
  });
  const more = toBuy.length > top.length ? `\n${fmt(t.more, { n: toBuy.length - top.length })}` : "";
  return `<b>${fmt(t.listTitle, { n: toBuy.length, total: formatMoney(total, currency, locale) })}</b>\n\n${rows.join("\n")}${more}\n\n<a href="${origin}/">${t.open}</a>`;
}
