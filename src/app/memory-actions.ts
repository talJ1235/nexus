"use server";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { schema } from "@/db";
import { requireCtx } from "@/lib/ctx";
import { userScoped } from "@/lib/db-scoped";
import { cleanNote } from "@/lib/memory";
import type { Profile } from "@/lib/profile";
import { getProfile, listNotes, memoryEnabled, setMemoryEnabledServer } from "@/lib/profile-server";

// "What Nexus knows about you" (Round 9 C3) — the signed-in user's own notes (R15: memories.user_id). Notes pass the sensitive-data guard (lib/memory.ts).

export type MemoryNote = { id: string; text: string; source: "chat" | "manual"; createdAt: number };
export type MemoryState = { enabled: boolean; profile: Profile | null; notes: MemoryNote[] };

const note = (r: typeof schema.memories.$inferSelect): MemoryNote => ({ id: r.id, text: r.text, source: r.source, createdAt: r.createdAt });

export async function getMemoryState(currency: string, refresh = false): Promise<MemoryState> {
  const ctx = await requireCtx("view");
  const [enabled, profile, notes] = await Promise.all([memoryEnabled(ctx), getProfile(ctx, z.string().max(5).parse(currency), z.boolean().parse(refresh)).catch(() => null), listNotes(ctx)]);
  return { enabled, profile, notes: notes.map(note) };
}

export async function setMemoryEnabled(on: boolean): Promise<void> {
  const ctx = await requireCtx("view");
  await setMemoryEnabledServer(ctx, z.boolean().parse(on));
}

/** Save a note (from the chat's "Remember" chip or typed in Settings). Sensitive / empty → { error }. */
export async function saveMemoryNote(text: string, source: "chat" | "manual" = "chat"): Promise<MemoryNote | { error: "sensitive" }> {
  const u = userScoped(await requireCtx("view"));
  const clean = cleanNote(text);
  if (!clean) return { error: "sensitive" };
  const now = Date.now();
  const id = `n_${nanoid(10)}`;
  await u.insert(schema.memories, { id, text: clean, source: z.enum(["chat", "manual"]).parse(source), createdAt: now, updatedAt: now });
  const [row] = await u.select(schema.memories, eq(schema.memories.id, id));
  return note(row);
}

export async function updateMemoryNote(id: string, text: string): Promise<MemoryNote | { error: "sensitive" }> {
  const u = userScoped(await requireCtx("view"));
  const nid = z.string().min(1).max(40).parse(id);
  const [own] = await u.select(schema.memories, eq(schema.memories.id, nid));
  if (!own) throw new Error("not_found");
  const clean = cleanNote(text);
  if (!clean) return { error: "sensitive" };
  await u.update(schema.memories, { text: clean, updatedAt: Date.now() }, eq(schema.memories.id, nid));
  const [row] = await u.select(schema.memories, eq(schema.memories.id, nid));
  return note(row);
}

export async function deleteMemoryNote(id: string): Promise<void> {
  const u = userScoped(await requireCtx("view"));
  await u.delete(schema.memories, eq(schema.memories.id, z.string().min(1).max(40).parse(id)));
}
