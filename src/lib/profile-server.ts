import "server-only";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { getAppData } from "./data";
import { kvGet, kvSet } from "./kv";
import { formatMoney } from "./money";
import { computeProfile, profileLines, type Profile } from "./profile";

// The shopping profile + learned notes on the server (Round 9 C3). The profile is cached in kv and recomputed when
// older than a day (the daily cron forces it) or asked for in another currency; memory can be turned off.
const PROFILE_KEY = "profile:v1";
const MEMORY_PREF = "pref:memory";
const DAY = 86_400_000;

export async function memoryEnabled(): Promise<boolean> {
  return (await kvGet(MEMORY_PREF).catch(() => null)) !== "off";
}

export async function setMemoryEnabledServer(on: boolean) {
  await kvSet(MEMORY_PREF, on ? "on" : "off");
}

export async function getProfile(currency: string, force = false): Promise<Profile> {
  if (!force) {
    const raw = await kvGet(PROFILE_KEY).catch(() => null);
    if (raw) {
      const p = JSON.parse(raw) as Profile;
      if (p.currency === currency && Date.now() - p.computedAt < DAY) return p;
    }
  }
  const data = await getAppData();
  const p = computeProfile(data.items, data.collections, data.rates, currency);
  await kvSet(PROFILE_KEY, JSON.stringify(p)).catch(() => {});
  return p;
}

export async function listNotes() {
  return db.select().from(schema.memories).orderBy(asc(schema.memories.createdAt));
}

/** What the model may know: profile lines + notes, or null when memory is off / there's nothing yet. */
export async function memoryContext(currency: string, locale: "en" | "he"): Promise<string | null> {
  if (!(await memoryEnabled())) return null;
  const [p, notes] = await Promise.all([getProfile(currency).catch(() => null), listNotes().catch(() => [])]);
  const fmt = (v: number) => formatMoney(Math.round(v), currency, locale);
  const lines = [...(p ? profileLines(p, fmt) : []), ...notes.map((n) => `Noted: ${n.text}`)];
  return lines.length ? lines.map((l) => `- ${l}`).join("\n") : null;
}
