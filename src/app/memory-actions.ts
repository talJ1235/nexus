"use server";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, schema } from "@/db";
import { assertOwner } from "@/lib/auth";
import { cleanNote } from "@/lib/memory";
import type { Profile } from "@/lib/profile";
import { getProfile, listNotes, memoryEnabled, setMemoryEnabledServer } from "@/lib/profile-server";

// "What Nexus knows about you" (Round 9 C3), owner only. Notes pass the sensitive-data guard (lib/memory.ts).

export type MemoryNote = { id: string; text: string; source: "chat" | "manual"; createdAt: number };
export type MemoryState = { enabled: boolean; profile: Profile | null; notes: MemoryNote[] };

const note = (r: typeof schema.memories.$inferSelect): MemoryNote => ({ id: r.id, text: r.text, source: r.source, createdAt: r.createdAt });

export async function getMemoryState(currency: string, refresh = false): Promise<MemoryState> {
  await assertOwner();
  const [enabled, profile, notes] = await Promise.all([memoryEnabled(), getProfile(z.string().max(5).parse(currency), refresh).catch(() => null), listNotes()]);
  return { enabled, profile, notes: notes.map(note) };
}

export async function setMemoryEnabled(on: boolean): Promise<void> {
  await assertOwner();
  await setMemoryEnabledServer(z.boolean().parse(on));
}

/** Save a note (from the chat's "Remember" chip or typed in Settings). Sensitive / empty → { error }. */
export async function saveMemoryNote(text: string, source: "chat" | "manual" = "chat"): Promise<MemoryNote | { error: "sensitive" }> {
  await assertOwner();
  const clean = cleanNote(text);
  if (!clean) return { error: "sensitive" };
  const now = Date.now();
  const [row] = await db.insert(schema.memories).values({ id: `n_${nanoid(10)}`, text: clean, source: z.enum(["chat", "manual"]).parse(source), createdAt: now, updatedAt: now }).returning();
  return note(row);
}

export async function updateMemoryNote(id: string, text: string): Promise<MemoryNote | { error: "sensitive" }> {
  await assertOwner();
  const clean = cleanNote(text);
  if (!clean) return { error: "sensitive" };
  const [row] = await db.update(schema.memories).set({ text: clean, updatedAt: Date.now() }).where(eq(schema.memories.id, z.string().min(1).max(40).parse(id))).returning();
  return note(row);
}

export async function deleteMemoryNote(id: string): Promise<void> {
  await assertOwner();
  await db.delete(schema.memories).where(eq(schema.memories.id, z.string().min(1).max(40).parse(id)));
}
