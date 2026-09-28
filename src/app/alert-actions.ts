"use server";

import { desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { assertOwner } from "@/lib/auth";
import { loadItems } from "@/lib/data";
import { kvGet } from "@/lib/kv";
import { headers } from "next/headers";
import { after } from "next/server";
import { disconnect, ensureWebhook, finishLink, saveBotToken, sendTelegram, startLink, telegramStatus } from "@/lib/telegram";
import { getAlertPrefs, runServerChecks, sendAlertDigest, setAlertPrefs, type AlertPrefs } from "@/lib/tracker";
import type { Alert, ItemWithSources } from "@/lib/types";

export type AlertsState = {
  alerts: Alert[];
  unread: number;
  prefs: AlertPrefs;
  telegram: { hasToken: boolean; bot: string | null; connected: boolean };
  lastCheck: { at: number; checked: number; blocked: number; alerts: number } | null;
  cronConfigured: boolean;
};

export async function getAlertsState(): Promise<AlertsState> {
  await assertOwner();
  // Make sure an already-linked bot receives messages (webhook), without delaying the response.
  const origin = await requestOrigin();
  after(() => ensureWebhook(origin).catch(() => false));
  const [alerts, prefs, telegram, last] = await Promise.all([
    db.select().from(schema.alerts).orderBy(desc(schema.alerts.createdAt)).limit(60),
    getAlertPrefs(),
    telegramStatus(),
    kvGet("pref:last_check"),
  ]);
  return {
    alerts,
    unread: alerts.filter((a) => !a.readAt).length,
    prefs,
    telegram,
    lastCheck: last ? JSON.parse(last) : null,
    cronConfigured: !!process.env.CRON_SECRET,
  };
}

export async function markAlertsRead() {
  await assertOwner();
  await db.update(schema.alerts).set({ readAt: Date.now() }).where(isNull(schema.alerts.readAt));
}

export async function saveAlertPrefs(p: Partial<AlertPrefs>) {
  await assertOwner();
  return setAlertPrefs(z.object({ minDropPct: z.number().min(1).max(90), telegram: z.boolean(), backInStock: z.boolean() }).partial().parse(p));
}

export async function checkPricesNow(origin: string): Promise<{ checked: number; blocked: number; alerts: number; items: ItemWithSources[] }> {
  await assertOwner();
  const r = await runServerChecks(40_000);
  await sendAlertDigest(z.string().url().parse(origin));
  return { checked: r.checked, blocked: r.blocked, alerts: r.alerts.length, items: await loadItems() };
}

export async function tgSaveToken(token: string) {
  await assertOwner();
  try {
    return { ok: true as const, bot: await saveBotToken(z.string().max(200).parse(token)) };
  } catch {
    return { ok: false as const };
  }
}

export async function tgStartLink() {
  await assertOwner();
  return startLink();
}

async function requestOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

export async function tgFinishLink() {
  await assertOwner();
  const ok = await finishLink();
  if (ok) await ensureWebhook(await requestOrigin());
  return ok;
}

export async function tgDisconnect() {
  await assertOwner();
  await disconnect();
}

export async function tgTest(text: string) {
  await assertOwner();
  return sendTelegram(z.string().max(500).parse(text));
}
