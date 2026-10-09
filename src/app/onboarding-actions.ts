"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireCtx, type Ctx } from "@/lib/ctx";
import { noteActivity } from "@/lib/activity";
import { monthKeyIn, BUDGET_KV_PREFIX } from "@/lib/budget";
import { Scoped } from "@/lib/db-scoped";
import { spacePrefSet, userPrefGet, userPrefSet } from "@/lib/db-scoped/prefs";
import { presetItems, serialize } from "@/lib/home-layout";
import { HOME_LAYOUT_KEY, homeLayoutKey } from "@/lib/home-prefs";
import { freshOnboarding, ONBOARDING_KEY, parseOnboarding, presetFor, STEPS, WHO, WHY, type Onboarding } from "@/lib/onboarding";
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
  })
  .partial()
  .strict();

/** Save answers (and the step reached). Applies what the saved answers set. */
export async function saveOnboarding(raw: z.input<typeof Patch>): Promise<Onboarding> {
  const ctx = await me();
  const p = Patch.parse(raw);
  const cur = await load(ctx);
  const next: Onboarding = { ...cur, ...p, status: cur.status === "done" || cur.status === "skipped" ? "active" : cur.status };
  const personal = await personalSpaceId(ctx.user.id);
  if (p.why && personal) await applyPreset(ctx.user.id, personal, p.why, next.sharedSpaceId);
  if ((p.budget !== undefined || p.currency) && personal) await applyBudget(ctx.user.id, personal, next.budget, next.currency);
  if (p.step != null && p.step > cur.step) noteActivity({ userId: ctx.user.id, spaceId: ctx.space.id }, "onboarding_step", p.step - cur.step);
  return store(ctx, next);
}

async function applyPreset(userId: string, personal: string, why: Onboarding["why"], shared: string | null) {
  const preset = presetFor(why);
  const mine = serialize({ v: 2, preset, items: presetItems(preset, false) });
  await Promise.all([userPrefSet(userId, homeLayoutKey(personal), mine), userPrefSet(userId, HOME_LAYOUT_KEY, mine), shared ? userPrefSet(userId, homeLayoutKey(shared), serialize({ v: 2, preset, items: presetItems(preset, true) })) : null]);
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
