import "server-only";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { HOME_AI_KEY } from "./home-prefs";

// R17 E2 — the one gate every model call goes through (lib/ai.ts generate / generateTextStream take a required `use`):
//   • the person's AI switch (Settings → Assistant & AI: "Rules only" = no AI anywhere for them),
//   • a daily quota — DAILY_QUOTA calls per person per day (Israel time), the admin unlimited, a per-person override in
//     user_pref `ai:quota` (the Session 2 admin panel edits it; `setAiQuota` is the action) — system work (cron,
//     backfills) doesn't count against anyone,
//   • privacy: names, emails, the space's and members' names and anything that looks like a phone number are taken
//     out of the prompt (stable placeholders; names/emails are put back into the answer, phones never travel),
//   • `ai_usage`: one row per call (user, space, feature, provider/model, ok, ms).
// Over quota / switched off → the caller gets null and takes its rules-only path ("AI is resting until tomorrow").

export const DAILY_QUOTA = 40;
export const QUOTA_KEY = "ai:quota";
/** R17 G2: "Reset today" (admin) — `<day>:<calls so far>`; today's count starts again from there (rows stay for stats). */
export const RESET_KEY = "ai:reset";
const TZ = "Asia/Jerusalem";

export type AiFeature =
  | "assistant"
  | "receipt"
  | "suggestions"
  | "short_name"
  | "extract"
  | "categorize"
  | "barcode"
  | "compare"
  | "pictures"
  | "chat"
  | "memory"
  | "debug";

/** Who a model call is for. `system` = cron / backfill / health checks: recorded, never counted against a person. */
export type AiUse = { feature: AiFeature; userId: string | null; spaceId?: string | null; system?: boolean };

export const aiDay = (now = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export type Allowance = { on: boolean; admin: boolean; limit: number | null; used: number; left: number | null };

/** The person's AI today: switched on?, their limit (null = unlimited) and what's used. */
export async function aiAllowance(userId: string, now = Date.now()): Promise<Allowance> {
  const [[u], prefs, [{ n }]] = await db.batch([
    db.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.id, userId)),
    db.select({ key: schema.userPref.key, value: schema.userPref.value }).from(schema.userPref).where(eq(schema.userPref.userId, userId)),
    db.select({ n: count() }).from(schema.aiUsage).where(and(eq(schema.aiUsage.userId, userId), eq(schema.aiUsage.day, aiDay(now)), eq(schema.aiUsage.system, false))),
  ]);
  const pref = (k: string) => prefs.find((p) => p.key === k)?.value ?? null;
  const admin = u?.role === "admin";
  const over = pref(QUOTA_KEY);
  const limit = admin || over === "unlimited" ? null : over != null && /^\d+$/.test(over) ? Number(over) : DAILY_QUOTA;
  const [rDay, rN] = (pref(RESET_KEY) ?? "").split(":");
  const used = Math.max(0, Number(n ?? 0) - (rDay === aiDay(now) ? Number(rN) || 0 : 0));
  return { on: pref(HOME_AI_KEY) !== "off", admin, limit, used, left: limit == null ? null : Math.max(0, limit - used) };
}

export type GateResult = { ok: true; redact: Redactor } | { ok: false; reason: "off" | "quota" };

/** May this call run? (and the redactor for its prompt) */
export async function aiGate(use: AiUse, now = Date.now()): Promise<GateResult> {
  if (use.system || !use.userId) return { ok: true, redact: await redactorFor(use) };
  const a = await aiAllowance(use.userId, now).catch(() => null);
  if (a && !a.on) return { ok: false, reason: "off" };
  if (a && a.left === 0) return { ok: false, reason: "quota" };
  return { ok: true, redact: await redactorFor(use) };
}

/** One row per call; never throws, never slows the answer by more than the insert. */
export async function recordAiUsage(use: AiUse, r: { provider: string | null; model: string | null; ok: boolean; ms: number; tokens?: number | null }, now = Date.now()) {
  try {
    await db.insert(schema.aiUsage).values({
      userId: use.userId,
      spaceId: use.spaceId ?? null,
      feature: use.feature,
      provider: r.provider,
      model: r.model,
      tokens: r.tokens ?? null,
      ok: r.ok,
      ms: Math.round(r.ms),
      system: !!use.system || !use.userId,
      day: aiDay(now),
      at: now,
    });
  } catch {
    /* usage is bookkeeping — the answer matters more */
  }
}

// ---------- privacy ----------

export type Redactor = { apply: (text: string) => string; restore: (text: string) => string };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// A phone number: 9–15 digits with optional +, spaces, dashes, dots or brackets between them (not a price: no decimal
// comma/point groups of 3 with a currency sign nearby is hard to tell — so only runs that start with + or 0 and have ≥ 9
// digits, which is how Israeli and international numbers are written).
const PHONE = /(?<![\w.,])(?:\+|0)[\d\s().-]{8,18}\d(?![\d,])/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Pure: a redactor for these names (people, spaces) — exported for the unit test. */
export function makeRedactor(names: string[]): Redactor {
  const list = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
  const back = new Map<string, string>();
  const tokens = new Map<string, string>();
  const token = (kind: "P" | "E", v: string) => {
    const k = `${kind}:${v.toLowerCase()}`;
    let t = tokens.get(k);
    if (!t) {
      t = `⟦${kind}${tokens.size + 1}⟧`;
      tokens.set(k, t);
      back.set(t, v);
    }
    return t;
  };
  const nameRe = list.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu") : null;
  return {
    apply(text) {
      let out = text.replace(EMAIL, (m) => token("E", m));
      out = out.replace(PHONE, (m) => ((m.match(/\d/g)?.length ?? 0) >= 9 ? "⟦phone⟧" : m));
      if (nameRe) out = out.replace(nameRe, (m) => token("P", m));
      return out;
    },
    restore(text) {
      return back.size ? text.replace(/⟦[PE]\d+⟧/g, (t) => back.get(t) ?? t) : text;
    },
  };
}

const cache = new Map<string, { at: number; names: string[] }>();
/** The names to keep out: the person's own name + email, the space's name, its members' names + emails. */
async function redactorFor(use: AiUse): Promise<Redactor> {
  const key = `${use.userId ?? ""}|${use.spaceId ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return makeRedactor(hit.names);
  const names: string[] = [];
  try {
    if (use.userId) {
      const [u] = await db.select({ name: schema.user.name, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, use.userId));
      if (u) names.push(u.name, ...u.name.split(/\s+/), u.email);
    }
    if (use.spaceId) {
      const [sp] = await db.select({ name: schema.space.name }).from(schema.space).where(eq(schema.space.id, use.spaceId));
      if (sp) names.push(sp.name);
      const people = await db
        .select({ name: schema.user.name, email: schema.user.email })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, use.spaceId));
      for (const p of people) names.push(p.name, ...p.name.split(/\s+/), p.email);
    }
  } catch {
    /* no names → only emails and phones are taken out */
  }
  // Single short words that are also ordinary words would eat product text — keep first names ≥ 3 letters.
  const keep = names.filter((n) => n && (n.includes(" ") || n.includes("@") || n.length >= 3));
  cache.set(key, { at: Date.now(), names: keep });
  return makeRedactor(keep);
}

/** Admin only (the Session 2 panel): a person's daily limit — a number, "unlimited", or null for the default. */
export async function writeAiQuota(userId: string, limit: number | "unlimited" | null) {
  if (limit == null) await db.delete(schema.userPref).where(and(eq(schema.userPref.userId, userId), eq(schema.userPref.key, QUOTA_KEY)));
  else
    await db
      .insert(schema.userPref)
      .values({ userId, key: QUOTA_KEY, value: String(limit), updatedAt: Date.now() })
      .onConflictDoUpdate({ target: [schema.userPref.userId, schema.userPref.key], set: { value: String(limit), updatedAt: Date.now() } });
}

/** Admin only (the Session 2 panel): today's count starts again from zero for this person. */
export async function resetAiToday(userId: string, now = Date.now()) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.userId, userId), eq(schema.aiUsage.day, aiDay(now)), eq(schema.aiUsage.system, false)));
  const value = `${aiDay(now)}:${Number(n ?? 0)}`;
  await db
    .insert(schema.userPref)
    .values({ userId, key: RESET_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: [schema.userPref.userId, schema.userPref.key], set: { value, updatedAt: now } });
}

/** The `use` for a request's context (a signed-in person in their current space). */
export const aiUse = (who: { user: { id: string }; space: { id: string } }, feature: AiFeature): AiUse => ({ feature, userId: who.user.id, spaceId: who.space.id });
/** The `use` for a scoped data layer (scoped(ctx) — or a system scope, which counts against no one). */
export const aiUseOf = (s: { scope: { spaceId: string; userId: string | null } }, feature: AiFeature): AiUse => ({ feature, userId: s.scope.userId, spaceId: s.scope.spaceId, system: !s.scope.userId });
/** Cron, backfills, health checks: recorded, never counted against a person. */
export const aiSystem = (feature: AiFeature, spaceId: string | null = null): AiUse => ({ feature, userId: null, spaceId, system: true });
