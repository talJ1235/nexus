"use server";

import { desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import { requireCtx } from "@/lib/ctx";
import { loadItems } from "@/lib/data";
import { scoped } from "@/lib/db-scoped";
import { kvGet } from "@/lib/kv";
import { getAlertPrefs, runServerChecks, setAlertPrefs, type AlertPrefs } from "@/lib/tracker";
import type { Alert, ItemWithSources } from "@/lib/types";

export type AlertsState = {
  alerts: Alert[];
  unread: number;
  prefs: AlertPrefs;
  telegram: { hasToken: boolean; bot: string | null; connected: boolean };
  lastCheck: { at: number; checked: number; blocked: number; alerts: number } | null;
  cronConfigured: boolean;
};

// R15 D2: Telegram is off for everyone (state reported as not connected; the tg* actions answer "gone").
const TELEGRAM_OFF = { hasToken: false, bot: null, connected: false };

export async function getAlertsState(): Promise<AlertsState> {
  const ctx = await requireCtx("view");
  const s = scoped(ctx);
  const [alerts, prefs, last] = await Promise.all([s.select(schema.alerts).orderBy(desc(schema.alerts.createdAt)).limit(60), getAlertPrefs(ctx.user.id), kvGet("pref:last_check")]);
  return {
    alerts,
    unread: alerts.filter((a) => !a.readAt).length,
    prefs,
    telegram: TELEGRAM_OFF,
    lastCheck: last ? JSON.parse(last) : null,
    cronConfigured: !!process.env.CRON_SECRET,
  };
}

export async function markAlertsRead() {
  const s = scoped(await requireCtx("edit"));
  await s.update(schema.alerts, { readAt: Date.now() }, isNull(schema.alerts.readAt));
}

export async function saveAlertPrefs(p: Partial<AlertPrefs>) {
  const ctx = await requireCtx("view");
  return setAlertPrefs(ctx.user.id, z.object({ minDropPct: z.number().min(1).max(90), telegram: z.boolean(), backInStock: z.boolean(), weekly: z.boolean() }).partial().strict().parse(p));
}

export async function checkPricesNow(origin: string): Promise<{ checked: number; blocked: number; alerts: number; items: ItemWithSources[] }> {
  const s = scoped(await requireCtx("edit"));
  z.string().max(300).parse(origin);
  const r = await runServerChecks(s, 40_000);
  return { checked: r.checked, blocked: r.blocked, alerts: r.alerts.length, items: await loadItems(s) };
}

async function gone(): Promise<never> {
  await requireCtx("view");
  throw new Error("gone");
}

export async function tgSaveToken(token: string): Promise<{ ok: true; bot: string } | { ok: false }> {
  void token;
  await requireCtx("view");
  return { ok: false };
}

export async function tgStartLink(): Promise<{ url: string; code: string }> {
  return gone();
}

export async function tgFinishLink(): Promise<boolean> {
  await requireCtx("view");
  return false;
}

export async function tgDisconnect(): Promise<void> {
  await requireCtx("view");
}

export async function tgTest(text: string): Promise<boolean> {
  void text;
  await requireCtx("view");
  return false;
}
