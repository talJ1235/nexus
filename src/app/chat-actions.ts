"use server";

import { and, asc, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, schema } from "@/db";
import { generateText } from "@/lib/ai";
import { mockAi } from "@/lib/assistant";
import { assertOwner } from "@/lib/auth";
import { matchConversations, searchTerms } from "@/lib/conversations";

// Assistant conversations (Round 9 C2), owner only.

export type ConversationView = { id: string; title: string; modes: string[]; createdAt: number; updatedAt: number; snippet?: string | null };
export type MessageView = { id: string; role: "user" | "assistant"; text: string; data: Record<string, unknown> | null; createdAt: number };

const view = (c: typeof schema.conversations.$inferSelect, snippet?: string | null): ConversationView => ({ id: c.id, title: c.title, modes: c.modes ?? [], createdAt: c.createdAt, updatedAt: c.updatedAt, ...(snippet !== undefined ? { snippet } : {}) });
const id = z.string().min(1).max(40);

/** Newest first; with a query, conversations whose title or messages match (best match first). */
export async function listConversations(raw: { query?: string; limit?: number } = {}): Promise<ConversationView[]> {
  await assertOwner();
  const { query, limit } = z.object({ query: z.string().max(200).optional(), limit: z.number().int().min(1).max(300).optional() }).parse(raw);
  // Purge the bin (soft-deleted over a day ago).
  const old = await db.select({ id: schema.conversations.id }).from(schema.conversations).where(and(isNotNull(schema.conversations.deletedAt), lt(schema.conversations.deletedAt, Date.now() - 86_400_000)));
  if (old.length) {
    const ids = old.map((o) => o.id);
    await db.delete(schema.conversationMessages).where(inArray(schema.conversationMessages.conversationId, ids));
    await db.delete(schema.conversations).where(inArray(schema.conversations.id, ids));
  }
  if (query?.trim()) {
    const found = await matchConversations(searchTerms(query.trim()).length ? searchTerms(query.trim()) : [query.trim().toLowerCase()], limit ?? 50);
    if (!found.length) return [];
    const rows = await db.select().from(schema.conversations).where(and(inArray(schema.conversations.id, found.map((f) => f.id)), isNull(schema.conversations.deletedAt)));
    return found.flatMap((f) => {
      const r = rows.find((x) => x.id === f.id);
      return r ? [view(r, f.snippet)] : [];
    });
  }
  const rows = await db.select().from(schema.conversations).where(isNull(schema.conversations.deletedAt)).orderBy(desc(schema.conversations.updatedAt)).limit(limit ?? 200);
  return rows.map((r) => view(r));
}

export async function getConversation(raw: string): Promise<{ conversation: ConversationView; messages: MessageView[] } | null> {
  await assertOwner();
  const cid = id.parse(raw);
  const [c] = await db.select().from(schema.conversations).where(and(eq(schema.conversations.id, cid), isNull(schema.conversations.deletedAt)));
  if (!c) return null;
  const msgs = await db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, cid)).orderBy(asc(schema.conversationMessages.createdAt)).limit(400);
  return { conversation: view(c), messages: msgs.map((m) => ({ id: m.id, role: m.role, text: m.text, data: (m.data as Record<string, unknown> | null) ?? null, createdAt: m.createdAt })) };
}

/** The most recent conversation, when it was active in the last `withinMs` (the panel reopens it). */
export async function latestConversation(withinMs = 2 * 3600_000): Promise<{ conversation: ConversationView; messages: MessageView[] } | null> {
  await assertOwner();
  const [c] = await db.select().from(schema.conversations).where(isNull(schema.conversations.deletedAt)).orderBy(desc(schema.conversations.updatedAt)).limit(1);
  if (!c || Date.now() - c.updatedAt > withinMs) return null;
  return getConversation(c.id);
}

const msg = z.object({ text: z.string().max(20_000), data: z.record(z.string(), z.unknown()).nullable().optional() });

/** Save one question + answer (creates the conversation on the first one). */
export async function saveExchange(raw: { conversationId: string | null; mode: "chat" | "plan"; user: z.input<typeof msg>; assistant: z.input<typeof msg> }): Promise<{ conversation: ConversationView; created: boolean }> {
  await assertOwner();
  const input = z.object({ conversationId: id.nullable(), mode: z.enum(["chat", "plan"]), user: msg, assistant: msg }).parse(raw);
  const now = Date.now();
  let c = input.conversationId ? (await db.select().from(schema.conversations).where(eq(schema.conversations.id, input.conversationId)))[0] : undefined;
  const created = !c;
  if (!c) [c] = await db.insert(schema.conversations).values({ id: `c_${nanoid(10)}`, title: "", modes: [], links: {}, createdAt: now, updatedAt: now }).returning();
  // Items mentioned as [[id]] and reports sent from the chat become links.
  const itemIds = [...`${input.user.text} ${input.assistant.text}`.matchAll(/\[\[([\w-]{6,24})\]\]/g)].map((m) => m[1]);
  const links = c.links ?? {};
  const reportId = typeof input.assistant.data?.reportId === "string" ? [input.assistant.data.reportId] : [];
  const modes = [...new Set([...(c.modes ?? []), input.mode])];
  await db.insert(schema.conversationMessages).values([
    { id: `m_${nanoid(12)}`, conversationId: c.id, role: "user", text: input.user.text, data: input.user.data ?? null, createdAt: now },
    { id: `m_${nanoid(12)}`, conversationId: c.id, role: "assistant", text: input.assistant.text, data: input.assistant.data ?? null, createdAt: now + 1 },
  ]);
  const [u] = await db
    .update(schema.conversations)
    .set({ updatedAt: now, modes, links: { items: [...new Set([...(links.items ?? []), ...itemIds])].slice(0, 200), reports: [...new Set([...(links.reports ?? []), ...reportId])] } })
    .where(eq(schema.conversations.id, c.id))
    .returning();
  return { conversation: view(u), created };
}

/** A short title made by the model after the first answer (mock / no AI: the first question, trimmed). */
export async function titleConversation(raw: string, locale: "en" | "he" = "en"): Promise<string> {
  await assertOwner();
  const cid = id.parse(raw);
  const msgs = await db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, cid)).orderBy(asc(schema.conversationMessages.createdAt)).limit(2);
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
  await db.update(schema.conversations).set({ title }).where(eq(schema.conversations.id, cid));
  return title;
}

export async function renameConversation(raw: string, title: string): Promise<void> {
  await assertOwner();
  await db.update(schema.conversations).set({ title: z.string().trim().min(1).max(80).parse(title) }).where(eq(schema.conversations.id, id.parse(raw)));
}

/** Soft delete (Undo restores it; the bin is purged after a day). */
export async function deleteConversation(raw: string): Promise<void> {
  await assertOwner();
  await db.update(schema.conversations).set({ deletedAt: Date.now() }).where(eq(schema.conversations.id, id.parse(raw)));
}

export async function restoreConversation(raw: string): Promise<void> {
  await assertOwner();
  await db.update(schema.conversations).set({ deletedAt: null }).where(eq(schema.conversations.id, id.parse(raw)));
}
