import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import { capFor, monthForecast, monthKeyIn, monthStartIn, nextMonthKey, shouldNotifyBudget } from "./budget";
import { loadBudgetHistory, loadItems, recordPrice, loadImportLimit } from "./data";
import { extractFromUrl, parseHtml, type Extracted } from "./extract";
import { kvGet, kvSet } from "./kv";
import { convert, formatMoney, parsePrice } from "./money";
import { getRates } from "./rates";
import { storeFromUrl } from "./stores";
import { escapeHtml, sendTelegram } from "./telegram";
import { isLocale } from "./i18n";
import { CURRENCIES } from "./money";
import { weeklySummary } from "./weekly";
import type { Alert, Source } from "./types";

export type AlertPrefs = { minDropPct: number; telegram: boolean; backInStock: boolean; weekly: boolean };
const PREFS_KEY = "pref:alerts";
export const DEFAULT_PREFS: AlertPrefs = { minDropPct: 5, telegram: true, backInStock: true, weekly: true };

export async function getAlertPrefs(): Promise<AlertPrefs> {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse((await kvGet(PREFS_KEY)) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}
export async function setAlertPrefs(p: Partial<AlertPrefs>) {
  const next = { ...(await getAlertPrefs()), ...p };
  next.minDropPct = Math.min(90, Math.max(1, Math.round(next.minDropPct)));
  await kvSet(PREFS_KEY, JSON.stringify(next));
  return next;
}

const OUT = /OutOfStock|SoldOut|Discontinued/i;
const IN = /InStock|LimitedAvailability|OnlineOnly|PreOrder|InStoreOnly/i;

/** Links to watch: to-buy items with price tracking on, real URLs only. */
async function watchedSources(where?: ReturnType<typeof and>) {
  return db
    .select({ source: schema.sources })
    .from(schema.sources)
    .innerJoin(schema.items, eq(schema.items.id, schema.sources.itemId))
    .where(and(eq(schema.items.status, "to_buy"), eq(schema.items.watch, true), ne(schema.sources.url, ""), where))
    .orderBy(asc(schema.sources.fetchedAt));
}

type Observation = { price: number | null; currency: string | null; availability: string | null };

/**
 * Apply a fresh observation to a source: update it, log price history, and create alerts.
 * Pure bookkeeping — how the observation was obtained (server fetch / browser extension) is the caller's business.
 */
export async function applyObservation(src: Source, obs: Observation): Promise<Alert[]> {
  const t = Date.now();
  const prefs = await getAlertPrefs();
  const created: Alert[] = [];
  const currency = (obs.currency ?? src.currency).toUpperCase();
  const newPrice = obs.price != null && obs.price > 0 ? obs.price : null;

  const patch: Partial<Source> = { fetchedAt: t, checkFails: 0 };
  if (newPrice != null) {
    patch.price = newPrice;
    patch.currency = currency;
  }
  if (obs.availability) patch.availability = obs.availability;
  await db.update(schema.sources).set(patch).where(eq(schema.sources.id, src.id));
  if (newPrice != null) await recordPrice(src.id, src.itemId, newPrice, currency);

  const item = await db.query.items.findFirst({ where: eq(schema.items.id, src.itemId) });
  if (!item || item.status !== "to_buy" || !item.watch) return created;

  const push = async (a: Omit<Alert, "id" | "createdAt" | "sentAt" | "readAt" | "itemId" | "sourceId">) => {
    // One alert per source+kind per 20h — avoid repeats when checked twice in a day.
    const recent = await db.query.alerts.findFirst({
      where: and(eq(schema.alerts.sourceId, src.id), eq(schema.alerts.kind, a.kind), gt(schema.alerts.createdAt, t - 20 * 3600_000)),
    });
    if (recent) return;
    const row = { id: nanoid(12), itemId: item.id, sourceId: src.id, createdAt: t, sentAt: null, readAt: null, ...a };
    await db.insert(schema.alerts).values(row);
    created.push(row);
  };

  const rates = await getRates();
  if (newPrice != null && src.price != null) {
    const oldSame = convert(src.price, src.currency, currency, rates);
    const dropPct = oldSame > 0 ? ((oldSame - newPrice) / oldSame) * 100 : 0;
    const target = item.targetPrice != null ? convert(item.targetPrice, item.targetCurrency ?? currency, currency, rates) : null;
    if (target != null && newPrice <= target && oldSame > target) {
      await push({ kind: "target", oldPrice: oldSame, newPrice, currency });
    } else if (dropPct >= prefs.minDropPct) {
      await push({ kind: "drop", oldPrice: oldSame, newPrice, currency });
    }
  }
  if (prefs.backInStock && obs.availability && src.availability) {
    if (OUT.test(src.availability) && IN.test(obs.availability)) await push({ kind: "back_in_stock", oldPrice: null, newPrice, currency });
  }
  return created;
}

export async function recordFailure(src: Source) {
  await db
    .update(schema.sources)
    .set({ checkFails: src.checkFails + 1, fetchedAt: Date.now() })
    .where(eq(schema.sources.id, src.id));
}

/** Server-side check of one link. Returns null when the store blocked us. */
export async function checkSourceOnServer(src: Source): Promise<Alert[] | null> {
  let ex: Extracted;
  try {
    ex = await extractFromUrl(src.url);
  } catch {
    await recordFailure(src);
    return null;
  }
  if (ex.blocked || (ex.price == null && !ex.availability)) {
    await recordFailure(src);
    return null;
  }
  return applyObservation(src, { price: ex.price, currency: ex.currency, availability: ex.availability });
}

/** Check from HTML the browser extension fetched with the user's own connection. */
export async function checkSourceFromHtml(src: Source, html: string, finalUrl?: string): Promise<Alert[] | null> {
  const parsed = parseHtml(html, finalUrl || src.url);
  if (parsed.price == null && !parsed.availability) {
    await recordFailure(src);
    return null;
  }
  return applyObservation(src, { price: parsed.price, currency: parsed.currency ?? storeFromUrl(src.url).currency ?? src.currency, availability: parsed.availability });
}

/** Check from data the extension read off a rendered page. */
export async function checkSourceFromPayload(src: Source, p: { price?: string | number | null; currency?: string | null; availability?: string | null }) {
  const parsed = parsePrice(p.price ?? null, p.currency ?? src.currency);
  if (!parsed && !p.availability) {
    await recordFailure(src);
    return null;
  }
  return applyObservation(src, { price: parsed?.amount ?? null, currency: parsed?.currency ?? p.currency ?? null, availability: p.availability ?? null });
}

/** Run server checks oldest-first until the time budget runs out. */
export async function runServerChecks(budgetMs = 45_000, concurrency = 4) {
  const started = Date.now();
  // Skip links that failed 3+ times in a row on the server — the extension covers those.
  const rows = await watchedSources(or(lt(schema.sources.checkFails, 3), isNull(schema.sources.checkFails)));
  const queue = rows.map((r) => r.source);
  let checked = 0;
  let blocked = 0;
  const alerts: Alert[] = [];
  const worker = async () => {
    while (queue.length && Date.now() - started < budgetMs) {
      const src = queue.shift()!;
      const out = await checkSourceOnServer(src);
      checked++;
      if (out == null) blocked++;
      else alerts.push(...out);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { checked, blocked, remaining: queue.length, alerts };
}

/** Links the extension should check: blocked on the server and not checked in the last `minAgeH` hours. */
export async function sourcesForExtension(limit = 12, minAgeH = 18) {
  const rows = await watchedSources(and(gt(schema.sources.checkFails, 0), or(isNull(schema.sources.fetchedAt), lt(schema.sources.fetchedAt, Date.now() - minAgeH * 3600_000))));
  return rows.slice(0, limit).map((r) => ({ id: r.source.id, url: r.source.url, storeKey: r.source.storeKey }));
}

const KIND_LINE: Record<Alert["kind"], (a: Alert, fmt: (n: number | null) => string) => string> = {
  drop: (a, m) => `📉 ${m(a.oldPrice)} → <b>${m(a.newPrice)}</b> (−${Math.round((1 - (a.newPrice ?? 0) / (a.oldPrice || 1)) * 100)}%)`,
  target: (a, m) => `🎯 Target reached: <b>${m(a.newPrice)}</b>`,
  back_in_stock: (a, m) => `✅ Back in stock${a.newPrice != null ? ` · ${m(a.newPrice)}` : ""}`,
  out_of_stock: () => `⛔ Out of stock`,
};

const TZ = "Asia/Jerusalem";

/** One line when this month (received + ordered + urgent to buy) is near/over the cap, once per state per month. */
async function budgetNotice(): Promise<{ line: string; commit: () => Promise<void> } | null> {
  const month = monthKeyIn(Date.now(), TZ);
  const cap = capFor(month, await loadBudgetHistory());
  if (!cap) return null;
  const sentKey = `budget:notified:${month}`;
  const [items, altGroups, rates, sentRaw] = await Promise.all([loadItems(), db.select().from(schema.altGroups), getRates(), kvGet(sentKey)]);
  const fc = monthForecast({ items, altGroups, rates, currency: cap.currency, from: monthStartIn(month, TZ), to: monthStartIn(nextMonthKey(month), TZ), cap, includeNormal: false });
  const sent = (sentRaw ?? "").split(",").filter(Boolean);
  if (!shouldNotifyBudget(fc.state, sent)) return null;
  const m = (n: number) => formatMoney(Math.round(n), cap.currency, "en");
  const incl = fc.forecast > 0 ? " (incl. urgent to buy)" : "";
  const line =
    fc.state === "over"
      ? `💸 <b>Over budget:</b> ${m(fc.total)} of ${m(fc.cap!)} this month${incl} — ${m(fc.total - fc.cap!)} over`
      : `⚠️ <b>Budget:</b> ${Math.round(fc.pct ?? 0)}% of ${m(fc.cap!)} used this month${incl}`;
  return { line, commit: () => kvSet(sentKey, [...sent, fc.state].join(",")) };
}

/** Send all unsent alerts (and the budget line, when due) as ONE Telegram digest; mark them sent. */
export async function sendAlertDigest(origin: string) {
  const prefs = await getAlertPrefs();
  if (!prefs.telegram) return { sent: 0 };
  const pending = await db.select().from(schema.alerts).where(isNull(schema.alerts.sentAt)).orderBy(desc(schema.alerts.createdAt)).limit(30);
  const budget = await budgetNotice().catch(() => null);
  if (!pending.length && !budget) return { sent: 0 };
  const items = pending.length ? await db.select().from(schema.items).where(inArray(schema.items.id, [...new Set(pending.map((a) => a.itemId))])) : [];
  const sourceIds = pending.map((a) => a.sourceId).filter(Boolean) as string[];
  const sources = sourceIds.length ? await db.select().from(schema.sources).where(inArray(schema.sources.id, sourceIds)) : [];
  const lines = pending.map((a) => {
    const it = items.find((i) => i.id === a.itemId);
    const src = sources.find((s) => s.id === a.sourceId);
    const m = (n: number | null) => formatMoney(n, a.currency ?? "ILS", "en");
    const name = escapeHtml((it?.title ?? "Item").slice(0, 80));
    const link = src?.url ? ` · <a href="${escapeHtml(src.url)}">${escapeHtml(src.store)}</a>` : "";
    return `<b>${name}</b>\n${KIND_LINE[a.kind](a, m)}${link}`;
  });
  const title = pending.length ? `Nexus · ${pending.length} price update${pending.length > 1 ? "s" : ""}` : "Nexus · budget";
  const body = [budget?.line, ...lines].filter(Boolean).join("\n\n");
  const link = pending.length ? `${origin}/?panel=alerts` : `${origin}/?v=spending`;
  const html = `<b>${title}</b>\n\n${body}\n\n<a href="${link}">Open Nexus</a>`;
  const ok = await sendTelegram(html);
  if (ok && pending.length) await db.update(schema.alerts).set({ sentAt: Date.now() }).where(inArray(schema.alerts.id, pending.map((a) => a.id)));
  if (ok && budget) await budget.commit();
  return { sent: ok ? pending.length : 0, budget: ok && !!budget };
}

// ---------- Weekly summary (Sundays, Israel time) ----------

const OWNER_KEY = "pref:owner";

/** The owner's language and display currency, remembered from app loads (the cron has no cookies). */
export async function rememberOwner(locale: string, currency: string) {
  const next = JSON.stringify({ locale, currency });
  if ((await kvGet(OWNER_KEY)) !== next) await kvSet(OWNER_KEY, next);
}
async function ownerPrefs() {
  try {
    const v = JSON.parse((await kvGet(OWNER_KEY)) ?? "{}") as { locale?: string; currency?: string };
    return { locale: isLocale(v.locale) ? v.locale : "en", currency: (CURRENCIES as readonly string[]).includes(v.currency ?? "") ? v.currency! : "ILS" };
  } catch {
    return { locale: "en" as const, currency: "ILS" };
  }
}

/** YYYY-MM-DD and weekday (0 = Sunday) of `ms` in Israel. */
function israelDay(ms: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(ms).map((p) => [p.type, p.value]));
  return { key: `${parts.year}-${parts.month}-${parts.day}`, sunday: parts.weekday === "Sun" };
}

/**
 * Send the weekly summary once per Sunday (daily cron). Skipped when turned off, not a Sunday, already sent this
 * Sunday, or there's nothing worth saying. `force` (local tests via the cron secret) ignores the day and the once-rule.
 */
export async function sendWeeklySummary(origin: string, opts: { force?: boolean; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const prefs = await getAlertPrefs();
  if (!prefs.telegram || !prefs.weekly) return { weekly: "off" as const };
  const day = israelDay(now);
  const sentKey = "weekly:sent";
  if (!opts.force && (!day.sunday || (await kvGet(sentKey)) === day.key)) return { weekly: "not_due" as const };
  const { locale, currency } = await ownerPrefs();
  const month = monthKeyIn(now, TZ);
  const [items, altGroups, storeSettings, rates, history, alerts] = await Promise.all([
    loadItems(),
    db.select().from(schema.altGroups),
    db.select().from(schema.storeSettings),
    getRates(),
    loadBudgetHistory(),
    db.select().from(schema.alerts).where(gt(schema.alerts.createdAt, now - 7 * 86_400_000)),
  ]);
  const importLimitUsd = await loadImportLimit().catch(() => undefined);
  const cap = capFor(month, history);
  const fc = monthForecast({ items, altGroups, rates, currency, from: monthStartIn(month, TZ), to: monthStartIn(nextMonthKey(month), TZ), cap, includeNormal: false });
  const html = weeklySummary({ items, altGroups, storeSettings, alerts, rates, currency, locale, now, origin, timeZone: TZ, month: fc, importLimitUsd });
  if (!html) {
    await kvSet(sentKey, day.key);
    return { weekly: "empty" as const };
  }
  const ok = await sendTelegram(html);
  if (ok) await kvSet(sentKey, day.key);
  return { weekly: ok ? ("sent" as const) : ("failed" as const) };
}
