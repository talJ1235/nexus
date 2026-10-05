"use server";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { schema } from "@/db";
import { generateText } from "@/lib/ai";
import { mockAi } from "@/lib/assistant";
import { matchConversations, searchTerms } from "@/lib/conversations";
import { requireCtx } from "@/lib/ctx";
import { scoped, type Scoped } from "@/lib/db-scoped";

// Assistant conversations (Round 9 C2). R15: personal — the caller's own chats in the current space (Scoped.mine).

export type ConversationView = { id: string; title: string; modes: string[]; createdAt: number; updatedAt: number; snippet?: string | null };
export type MessageView = { id: string; role: "user" | "assistant"; text: string; data: Record<string, unknown> | null; createdAt: number };

const view = (c: typeof schema.conversations.$inferSelect, snippet?: string | null): ConversationView => ({ id: c.id, title: c.title, modes: c.modes ?? [], createdAt: c.createdAt, updatedAt: c.updatedAt, ...(snippet !== undefined ? { snippet } : {}) });
const id = z.string().min(1).max(40);
const me = async () => scoped(await requireCtx("view"));
const C = schema.conversations;

async function mustOwn(s: Scoped, cid: string) {
  const [c] = await s.select(C, s.mine(C, eq(C.id, cid))).limit(1);
  if (!c) throw new Error("not_found");
  return c;
}

/** Newest first; with a query, conversations whose title or messages match (best match first). */
export async function listConversations(raw: { query?: string; limit?: number } = {}): Promise<ConversationView[]> {
  const s = await me();
  const { query, limit } = z.object({ query: z.string().max(200).optional(), limit: z.number().int().min(1).max(300).optional() }).strict().parse(raw);
  // Purge the bin (soft-deleted over a day ago).
  const old = await s.pick({ id: C.id }, C, s.mine(C, and(isNotNull(C.deletedAt), lt(C.deletedAt, Date.now() - 86_400_000))));
  if (old.length) {
    const ids = old.map((o) => o.id);
    await s.delete(schema.conversationMessages, inArray(schema.conversationMessages.conversationId, ids));
    await s.delete(C, s.mine(C, inArray(C.id, ids)));
  }
  if (query?.trim()) {
    const found = await matchConversations(s, searchTerms(query.trim()).length ? searchTerms(query.trim()) : [query.trim().toLowerCase()], limit ?? 50);
    if (!found.length) return [];
    const rows = await s.select(C, s.mine(C, and(inArray(C.id, found.map((f) => f.id)), isNull(C.deletedAt))));
    return found.flatMap((f) => {
      const r = rows.find((x) => x.id === f.id);
      return r ? [view(r, f.snippet)] : [];
    });
  }
  const rows = await s.select(C, s.mine(C, isNull(C.deletedAt))).orderBy(desc(C.updatedAt)).limit(limit ?? 200);
  return rows.map((r) => view(r));
}

async function loadConversation(s: Scoped, cid: string) {
  const [c] = await s.select(C, s.mine(C, and(eq(C.id, cid), isNull(C.deletedAt)))).limit(1);
  if (!c) return null;
  const msgs = await s.select(schema.conversationMessages, eq(schema.conversationMessages.conversationId, cid)).orderBy(asc(schema.conversationMessages.createdAt)).limit(400);
  return { conversation: view(c), messages: msgs.map((m) => ({ id: m.id, role: m.role, text: m.text, data: (m.data as Record<string, unknown> | null) ?? null, createdAt: m.createdAt })) };
}

export async function getConversation(raw: string): Promise<{ conversation: ConversationView; messages: MessageView[] } | null> {
  const s = await me();
  return loadConversation(s, id.parse(raw));
}

/** The most recent conversation, when it was active in the last `withinMs` (the panel reopens it). */
export async function latestConversation(withinMs = 2 * 3600_000): Promise<{ conversation: ConversationView; messages: MessageView[] } | null> {
  const s = await me();
  const [c] = await s.select(C, s.mine(C, isNull(C.deletedAt))).orderBy(desc(C.updatedAt)).limit(1);
  if (!c || Date.now() - c.updatedAt > z.number().max(30 * 86_400_000).parse(withinMs)) return null;
  return loadConversation(s, c.id);
}

const msg = z.object({ text: z.string().max(20_000), data: z.record(z.string(), z.unknown()).nullable().optional() }).strict();

/** Save one question + answer (creates the conversation on the first one). */
export async function saveExchange(raw: { conversationId: string | null; mode: "chat" | "plan"; user: z.input<typeof msg>; assistant: z.input<typeof msg> }): Promise<{ conversation: ConversationView; created: boolean }> {
  const s = await me();
  const input = z.object({ conversationId: id.nullable(), mode: z.enum(["chat", "plan"]), user: msg, assistant: msg }).strict().parse(raw);
  const now = Date.now();
  let c = input.conversationId ? await mustOwn(s, input.conversationId) : undefined;
  const created = !c;
  if (!c) {
    const cid = `c_${nanoid(10)}`;
    await s.insert(C, { id: cid, userId: s.scope.userId!, title: "", modes: [], links: {}, createdAt: now, updatedAt: now });
    c = await mustOwn(s, cid);
  }
  // Items mentioned as [[id]] and reports sent from the chat become links.
  const itemIds = [...`${input.user.text} ${input.assistant.text}`.matchAll(/\[\[([\w-]{6,24})\]\]/g)].map((m) => m[1]);
  const links = c.links ?? {};
  const reportId = typeof input.assistant.data?.reportId === "string" ? [input.assistant.data.reportId] : [];
  const modes = [...new Set([...(c.modes ?? []), input.mode])];
  await s.insert(schema.conversationMessages, [
    { id: `m_${nanoid(12)}`, conversationId: c.id, role: "user", text: input.user.text, data: input.user.data ?? null, createdAt: now },
    { id: `m_${nanoid(12)}`, conversationId: c.id, role: "assistant", text: input.assistant.text, data: input.assistant.data ?? null, createdAt: now + 1 },
  ]);
  await s.update(C, { updatedAt: now, modes, links: { items: [...new Set([...(links.items ?? []), ...itemIds])].slice(0, 200), reports: [...new Set([...(links.reports ?? []), ...reportId])] } }, s.mine(C, eq(C.id, c.id)));
  return { conversation: view(await mustOwn(s, c.id)), created };
}

/** A short title made by the model after the first answer (mock / no AI: the first question, trimmed). */
export async function titleConversation(raw: string, locale: "en" | "he" = "en"): Promise<string> {
  const s = await me();
  const cid = id.parse(raw);
  await mustOwn(s, cid);
  const msgs = await s.select(schema.conversationMessages, eq(schema.conversationMessages.conversationId, cid)).orderBy(asc(schema.conversationMessages.createdAt)).limit(2);
  const q = msgs.find((m) => m.role === "user")?.text ?? "";
  const a = msgs.find((m) => m.role === "assistant")?.text ?? "";
  const fallback = q.replace(/\s+/g, " ").trim().split(" ").slice(0, 7).join(" ").slice(0, 60);
  let title = fallback;
  if (!mockAi()) {
    const out = await generateText(
      `Give this conversation a short title, 2–6 words, in ${locale === "he" ? "Hebrew" : "English"}, no quotes, no trailing period.\n\nUser: ${q.slice(0, 600)}\nAssistant: ${a.slice(0, 600)}\n\nTitle:`,
      { budgetMs: 8000 },
    ).catch(() => null);
    const clean = out?.replace(/^["'\s]+|["'.\s]+$/g, "").split("\n")[0].slice(0, 60);
    if (clean && clean.length >= 3) title = clean;
  }
  await s.update(C, { title }, s.mine(C, eq(C.id, cid)));
  return title;
}

export async function renameConversation(raw: string, title: string): Promise<void> {
  const s = await me();
  const cid = id.parse(raw);
  await mustOwn(s, cid);
  await s.update(C, { title: z.string().trim().min(1).max(80).parse(title) }, s.mine(C, eq(C.id, cid)));
}

/** Soft delete (Undo restores it; the bin is purged after a day). */
export async function deleteConversation(raw: string): Promise<void> {
  const s = await me();
  const cid = id.parse(raw);
  await mustOwn(s, cid);
  await s.update(C, { deletedAt: Date.now() }, s.mine(C, eq(C.id, cid)));
}

export async function restoreConversation(raw: string): Promise<void> {
  const s = await me();
  const cid = id.parse(raw);
  await s.update(C, { deletedAt: null }, s.mine(C, eq(C.id, cid)));
}
