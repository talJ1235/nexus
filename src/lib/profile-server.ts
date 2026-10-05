import "server-only";
import { asc } from "drizzle-orm";
import { schema } from "@/db";
import { getAppData } from "./data";
import { scoped, userScoped } from "./db-scoped";
import { userPrefGet, userPrefSet } from "./db-scoped/prefs";
import { formatMoney } from "./money";
import { computeProfile, profileLines, type Profile } from "./profile";

// The shopping profile + learned notes on the server (Round 9 C3). R15: per user — the profile is computed from the
// current space's items and cached in user_pref (recomputed for another space, currency, or after a day); notes are
// the user's own (memories.user_id); memory can be turned off per user.
const PROFILE_KEY = "profile:v1";
const MEMORY_PREF = "pref:memory";
const DAY = 86_400_000;

type Who = { user: { id: string }; space: { id: string } };

export async function memoryEnabled(ctx: Who): Promise<boolean> {
  return (await userPrefGet(ctx.user.id, MEMORY_PREF).catch(() => null)) !== "off";
}

export async function setMemoryEnabledServer(ctx: Who, on: boolean) {
  await userPrefSet(ctx.user.id, MEMORY_PREF, on ? "on" : "off");
}

export async function getProfile(ctx: Who, currency: string, force = false): Promise<Profile> {
  if (!force) {
    const raw = await userPrefGet(ctx.user.id, PROFILE_KEY).catch(() => null);
    if (raw) {
      const p = JSON.parse(raw) as Profile & { spaceId?: string };
      if (p.currency === currency && p.spaceId === ctx.space.id && Date.now() - p.computedAt < DAY) return p;
    }
  }
  const data = await getAppData(scoped(ctx), ctx.user.id);
  const p = computeProfile(data.items, data.collections, data.rates, currency);
  await userPrefSet(ctx.user.id, PROFILE_KEY, JSON.stringify({ ...p, spaceId: ctx.space.id })).catch(() => {});
  return p;
}

export async function listNotes(ctx: { user: { id: string } }) {
  return userScoped(ctx).select(schema.memories).orderBy(asc(schema.memories.createdAt));
}

/** What the model may know: profile lines + notes, or null when memory is off / there's nothing yet. */
export async function memoryContext(ctx: Who, currency: string, locale: "en" | "he"): Promise<string | null> {
  if (!(await memoryEnabled(ctx))) return null;
  const [p, notes] = await Promise.all([getProfile(ctx, currency).catch(() => null), listNotes(ctx).catch(() => [])]);
  const fmt = (v: number) => formatMoney(Math.round(v), currency, locale);
  const lines = [...(p ? profileLines(p, fmt) : []), ...notes.map((n) => `Noted: ${n.text}`)];
  return lines.length ? lines.map((l) => `- ${l}`).join("\n") : null;
}
