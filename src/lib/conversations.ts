import "server-only";
import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { schema } from "@/db";
import type { Scoped } from "./db-scoped";

// Saved assistant conversations (Round 9 C2), server side: search over titles + messages (the history drawer, and
// "how did I fix X last time?" for the model). R15: only the caller's own chats in the current space (Scoped.mine).

const STOP = new Set(["the", "and", "how", "did", "what", "when", "last", "time", "with", "for", "from", "that", "this", "my", "was", "were", "you", "fix", "fixed", "again", "before", "של", "איך", "מה", "את", "עם", "על", "פעם", "שעברה", "הקודמת", "כבר", "זה", "לי"]);

/** Words worth searching for (≥ 3 letters, no stop words), at most 6. */
export function searchTerms(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 6);
}

const escapeLike = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);

/** Conversation ids whose title or messages contain any of the terms, best (most terms) first. */
export async function matchConversations(s: Scoped, terms: string[], limit = 30): Promise<{ id: string; hits: number; snippet: string | null }[]> {
  if (!terms.length) return [];
  const mine = (await s.pick({ id: schema.conversations.id }, schema.conversations, s.mine(schema.conversations, isNull(schema.conversations.deletedAt)))).map((r) => r.id);
  if (!mine.length) return [];
  const conds = terms.map((w) => like(schema.conversationMessages.text, `%${escapeLike(w)}%`));
  const msgs = await s
    .pick({ id: schema.conversationMessages.conversationId, text: schema.conversationMessages.text }, schema.conversationMessages, and(inArray(schema.conversationMessages.conversationId, mine), or(...conds)))
    .limit(400);
  const titles = await s.pick(
    { id: schema.conversations.id, title: schema.conversations.title },
    schema.conversations,
    s.mine(schema.conversations, and(isNull(schema.conversations.deletedAt), or(...terms.map((w) => like(schema.conversations.title, `%${escapeLike(w)}%`))))),
  );
  const score = new Map<string, { hits: number; snippet: string | null }>();
  const count = (text: string) => terms.filter((w) => text.toLowerCase().includes(w)).length;
  for (const m of msgs) {
    const e = score.get(m.id) ?? { hits: 0, snippet: null };
    const h = count(m.text);
    if (h > 0 && !e.snippet) {
      const at = Math.max(0, m.text.toLowerCase().indexOf(terms.find((w) => m.text.toLowerCase().includes(w))!) - 60);
      e.snippet = `${at > 0 ? "…" : ""}${m.text.slice(at, at + 220).replace(/\s+/g, " ").trim()}`;
    }
    e.hits += h;
    score.set(m.id, e);
  }
  for (const t of titles) {
    const e = score.get(t.id) ?? { hits: 0, snippet: null };
    e.hits += 2 * count(t.title);
    score.set(t.id, e);
  }
  return [...score.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);
}

/** "Last time" questions: a few snippets from earlier conversations for the model (excluding the current one). */
export async function pastSnippets(s: Scoped, question: string, excludeId: string | null): Promise<string | null> {
  if (!/\b(last time|before|previously|earlier|again|did i|have i)\b|בפעם (הקודמת|שעברה)|כבר |פעם שעברה|בעבר/i.test(question)) return null;
  const found = (await matchConversations(s, searchTerms(question), 10)).filter((m) => m.id !== excludeId && m.hits > 0);
  if (!found.length) return null;
  const convs = await s.select(schema.conversations, s.mine(schema.conversations, and(inArray(schema.conversations.id, found.slice(0, 3).map((f) => f.id)), isNull(schema.conversations.deletedAt))));
  const out: string[] = [];
  for (const f of found.slice(0, 3)) {
    const c = convs.find((x) => x.id === f.id);
    if (!c) continue;
    const msgs = await s
      .pick({ role: schema.conversationMessages.role, text: schema.conversationMessages.text }, schema.conversationMessages, eq(schema.conversationMessages.conversationId, c.id))
      .orderBy(desc(schema.conversationMessages.createdAt))
      .limit(6);
    const body = msgs
      .reverse()
      .map((m) => `${m.role === "user" ? "User" : "Nexus"}: ${m.text.slice(0, 300).replace(/\s+/g, " ")}`)
      .join("\n");
    out.push(`- "${c.title || "Untitled"}" (${new Date(c.updatedAt).toISOString().slice(0, 10)}):\n${body}`);
  }
  return out.length ? out.join("\n\n") : null;
}
