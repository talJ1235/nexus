"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireCtx, type Ctx } from "@/lib/ctx";
import { noteActivity } from "@/lib/activity";
import { monthKeyIn, BUDGET_KV_PREFIX } from "@/lib/budget";
import { Scoped } from "@/lib/db-scoped";
import { spacePrefGet, spacePrefSet, userPrefGet, userPrefSet } from "@/lib/db-scoped/prefs";
import { presetItems, serialize } from "@/lib/home-layout";
import { HOME_LAYOUT_KEY, homeLayoutKey } from "@/lib/home-prefs";
import { DIETS, FREQ, freshOnboarding, MODES, ONBOARDING_KEY, parseOnboarding, presetFor, STEPS, WHO, WHY, type Onboarding } from "@/lib/onboarding";
import { BUDGET_SM_KEY, BUDGET_START_KEY, HOME_FOOD_KEY } from "@/lib/spending-month";
import { createSharedSpace, createSpaceInvite, personalSpaceId, updateSpace } from "@/lib/spaces";
import { hitLimit } from "@/lib/auth/limits";

// R17 H — onboarding (/welcome): the answers live in user_pref `pref:onboarding`; each step's effect is applied when
// its answer is saved (so a reload resumes where it was, and skipping later steps keeps the earlier ones):
//   1 why → Home's preset (personal space + any shared Home made in step 4) · 2 stores → store suggestions ·
//   3 budget → the personal space's monthly budget + currency · 4 who → partner/family makes the shared space "Home"
//   and offers its invite · 6 notifications → the permission the browser gave (stored for Session 3's push).
// Every answer is editable later in Settings (Home → Customise, Space → Budget, spaces, Account → notifications).

async function me() {
  return requireCtx("view");
}

async function load(ctx: Ctx): Promise<Onboarding> {
  return parseOnboarding(await userPrefGet(ctx.user.id, ONBOARDING_KEY)) ?? freshOnboarding();
}
async function store(ctx: Ctx, o: Onboarding) {
  await userPrefSet(ctx.user.id, ONBOARDING_KEY, JSON.stringify({ ...o, at: Date.now() }));
  return o;
}

export async function getOnboarding(): Promise<Onboarding> {
  const ctx = await me();
  return load(ctx);
}

const Patch = z
  .object({
    step: z.number().int().min(1).max(STEPS),
    why: z.array(z.enum(WHY)).max(4),
    stores: z.array(z.string().min(1).max(40)).max(40),
    custom: z.array(z.string().trim().min(1).max(40)).max(20),
    budget: z.number().int().min(0).max(1_000_000).nullable(),
    currency: z.enum(["ILS", "USD", "EUR"]),
    who: z.enum(WHO).nullable(),
    notif: z.enum(["granted", "denied", "default"]).nullable(),
    installed: z.boolean(),
    chains: z.array(z.string().min(1).max(40)).max(12),
    branch: z.string().trim().max(120).nullable(),
    several: z.boolean(),
    // R18 S5 F2–F5
    adults: z.number().int().min(1).max(12),
    kids: z.number().int().min(0).max(12),
    babies: z.number().int().min(0).max(12),
    pets: z.number().int().min(0).max(12),
    freq: z.enum(FREQ).nullable(),
    days: z.array(z.number().int().min(0).max(6)).max(7),
    mode: z.enum(MODES).nullable(),
    diet: z.array(z.enum(DIETS)).max(DIETS.length),
    shabbat: z.boolean(),
    smShare: z.number().int().min(0).max(1_000_000).nullable(),
    startDay: z.number().int().min(1).max(28),
    learnBudget: z.boolean(),
    quick: z.enum(["done", "dismissed"]),
  })
  .partial()
  .strict();

/** Save answers (and the step reached). Applies what the saved answers set. */
export async function saveOnboarding(raw: z.input<typeof Patch>): Promise<Onboarding> {
  const ctx = await me();
  const p = Patch.parse(raw);
  // Someone who never went through onboarding (an account from before it) and edits an answer in Settings stays out of
  // /welcome: answers without a step start from a finished set.
  const stored = parseOnboarding(await userPrefGet(ctx.user.id, ONBOARDING_KEY));
  const cur = stored ?? (p.step == null ? { ...freshOnboarding(), status: "done" as const } : freshOnboarding());
  // Saving a step reopens a finished onboarding (Settings → Getting started); answers alone (R18 S5's quick questions,
  // Settings → Household) leave it finished.
  const next: Onboarding = { ...cur, ...p, status: p.step != null && (cur.status === "done" || cur.status === "skipped") ? "active" : cur.status };
  const personal = await personalSpaceId(ctx.user.id);
  if (p.why && personal) await applyPreset(ctx.user.id, personal, p.why, next.sharedSpaceId);
  if ((p.budget !== undefined || p.currency || p.learnBudget !== undefined) && personal) await applyBudget(ctx.user.id, personal, next.learnBudget ? null : next.budget, next.currency);
  // R18 S5 F5: the month's start day and the supermarket's part of the budget live on the space (Spending, Settings).
  if ((p.startDay !== undefined || p.smShare !== undefined) && personal) await applyBudgetShape(ctx.user.id, personal, next);
  // F4: the food choices are noted on the space (kosher / mehadrin / organic: nothing to filter on yet).
  if ((p.diet !== undefined || p.shabbat !== undefined) && personal) await spacePrefSet(new Scoped({ spaceId: personal, userId: ctx.user.id }), HOME_FOOD_KEY, JSON.stringify({ diet: next.diet ?? [], shabbat: next.shabbat ?? false }));
  if (p.branch !== undefined || p.several !== undefined) await applyStores(ctx, next);
  if (p.step != null && p.step > cur.step) noteActivity({ userId: ctx.user.id, spaceId: ctx.space.id }, "onboarding_step", p.step - cur.step);
  return store(ctx, next);
}

async function applyPreset(userId: string, personal: string, why: Onboarding["why"], shared: string | null) {
  const preset = presetFor(why);
  const mine = serialize({ v: 2, preset, items: presetItems(preset, false) });
  await Promise.all([userPrefSet(userId, homeLayoutKey(personal), mine), userPrefSet(userId, HOME_LAYOUT_KEY, mine), shared ? userPrefSet(userId, homeLayoutKey(shared), serialize({ v: 2, preset, items: presetItems(preset, true) })) : null]);
}

/**
 * R18 S2 F2: the supermarket chains → the current space's stores — the first chain is the main store (with its branch,
 * or none when the person shops at several branches: they pick one when a trip starts); the others are "also shop at".
 * A viewer's answers are kept but change nothing in the space.
 */
async function applyStores(ctx: Ctx, o: Onboarding) {
  if (ctx.role === "viewer" || !o.chains?.length) return;
  const { CHAINS } = await import("@/lib/grocery/chains");
  const ids = o.chains.filter((c) => CHAINS.some((x) => x.id === c));
  if (!ids.length) return;
  const G = await import("@/lib/db-scoped/grocery");
  const s = new Scoped({ spaceId: ctx.space.id, userId: ctx.user.id });
  const branch = o.several ? "" : (o.branch ?? "").trim();
  const existing = await G.storesOf(s);
  // A main store picked before (a chain change) loses its default; the branch typed for it moves with the choice.
  await G.saveStore(s, ids[0], branch, { isDefault: true });
  for (const c of ids.slice(1)) if (!existing.some((x) => x.chain === c)) await G.saveStore(s, c, "", { isDefault: false });
}

/** R18 S5 F6: Space → Budget — the current space's month start day and supermarket share (space prefs). */
export async function budgetShape(): Promise<{ startDay: number; smShare: number | null }> {
  const ctx = await requireCtx("view");
  const s = new Scoped({ spaceId: ctx.space.id, userId: ctx.user.id });
  const [start, sm] = await Promise.all([spacePrefGet(s, BUDGET_START_KEY), spacePrefGet(s, BUDGET_SM_KEY)]);
  const d = Number(start);
  const v = sm == null ? NaN : Number(sm);
  return { startDay: Number.isInteger(d) && d >= 1 && d <= 28 ? d : 1, smShare: Number.isFinite(v) && v >= 0 ? Math.round(v) : null };
}

const Shape = z.object({ startDay: z.number().int().min(1).max(28), smShare: z.number().int().min(0).max(1_000_000).nullable() }).partial().strict();

export async function saveBudgetShape(raw: z.input<typeof Shape>) {
  const ctx = await requireCtx("edit");
  const p = Shape.parse(raw);
  const s = new Scoped({ spaceId: ctx.space.id, userId: ctx.user.id });
  if (p.startDay !== undefined) await spacePrefSet(s, BUDGET_START_KEY, p.startDay > 1 ? String(p.startDay) : null);
  if (p.smShare !== undefined) await spacePrefSet(s, BUDGET_SM_KEY, p.smShare != null ? String(p.smShare) : null);
}

async function applyBudgetShape(userId: string, personal: string, o: Onboarding) {
  const s = new Scoped({ spaceId: personal, userId });
  await spacePrefSet(s, BUDGET_START_KEY, o.startDay && o.startDay > 1 ? String(o.startDay) : null);
  await spacePrefSet(s, BUDGET_SM_KEY, o.smShare != null ? String(o.smShare) : null);
}

async function applyBudget(userId: string, personal: string, cap: number | null, currency: Onboarding["currency"]) {
  const s = new Scoped({ spaceId: personal, userId });
  await updateSpace(personal, { currency });
  await spacePrefSet(s, `${BUDGET_KV_PREFIX}${monthKeyIn(Date.now(), "Asia/Jerusalem")}`, JSON.stringify({ cap: cap && cap > 0 ? cap : null, currency }));
}

/** Step 4, partner or family: the shared space "Home" / "הבית" (green house), made once; with `link`, a fresh invite
 *  link to it (the invite sheet / WhatsApp / copy). */
export async function onboardingInvite(locale: "en" | "he", link = true): Promise<{ spaceId: string; url: string | null }> {
  const ctx = await me();
  z.enum(["en", "he"]).parse(locale);
  const cur = await load(ctx);
  let spaceId = cur.sharedSpaceId && ctx.memberships.some((m) => m.spaceId === cur.sharedSpaceId) ? cur.sharedSpaceId : null;
  if (!spaceId) {
    if (!(await hitLimit(`space-create:${ctx.user.id}`, 10, 60 * 60_000))) throw new Error("limit");
    spaceId = await createSharedSpace(ctx.user.id, { name: locale === "he" ? "הבית" : "Home", color: "green", currency: cur.currency, icon: "home" });
    await store(ctx, { ...cur, sharedSpaceId: spaceId });
    if (cur.why.length) {
      const preset = presetFor(cur.why);
      await userPrefSet(ctx.user.id, homeLayoutKey(spaceId), serialize({ v: 2, preset, items: presetItems(preset, true) }));
    }
  }
  if (!z.boolean().parse(link)) return { spaceId, url: null };
  if (!(await hitLimit(`space-invite:${ctx.user.id}`, 20, 60 * 60_000))) throw new Error("limit");
  const { token } = await createSpaceInvite(spaceId, ctx.user.id, "member");
  const h = await headers();
  const origin = process.env.BETTER_AUTH_URL?.replace(/\/$/, "") || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  return { spaceId, url: `${origin}/join/${token}` };
}

/** Done (or skipped out): Home from here on. */
export async function finishOnboarding(skipped: boolean): Promise<Onboarding> {
  const ctx = await me();
  const cur = await load(ctx);
  return store(ctx, { ...cur, status: skipped ? "skipped" : "done", step: skipped ? cur.step : STEPS });
}
