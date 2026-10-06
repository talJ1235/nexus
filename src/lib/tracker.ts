import "server-only";
import { and, eq, gt, isNull, lt, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schema } from "@/db";
import { recordPrice } from "./data";
import { Scoped, joins } from "./db-scoped";
import { userPrefGet, userPrefSet } from "./db-scoped/prefs";
import { systemWatchedSources } from "./db-scoped/system";
import { extractFromUrl, parseHtml, type Extracted } from "./extract";
import { isLocale } from "./i18n";
import { convert, CURRENCIES, parsePrice } from "./money";
import { getRates } from "./rates";
import { storeFromUrl } from "./stores";
import type { Alert, Source } from "./types";

// Price tracking. R15: alerts belong to a space; alert preferences to a user. Telegram digests and the weekly summary
// are off for everyone (D2) — alerts show in the app (push + inbox arrive in R16).

export type AlertPrefs = { minDropPct: number; telegram: boolean; backInStock: boolean; weekly: boolean };
const PREFS_KEY = "pref:alerts";
export const DEFAULT_PREFS: AlertPrefs = { minDropPct: 5, telegram: false, backInStock: true, weekly: true };

export async function getAlertPrefs(userId: string | null): Promise<AlertPrefs> {
  if (!userId) return DEFAULT_PREFS;
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse((await userPrefGet(userId, PREFS_KEY)) ?? "{}"), telegram: false };
  } catch {
    return DEFAULT_PREFS;
  }
}
export async function setAlertPrefs(userId: string, p: Partial<AlertPrefs>) {
  const next = { ...(await getAlertPrefs(userId)), ...p, telegram: false };
  next.minDropPct = Math.min(90, Math.max(1, Math.round(next.minDropPct)));
  await userPrefSet(userId, PREFS_KEY, JSON.stringify(next));
  return next;
}

const OUT = /OutOfStock|SoldOut|Discontinued/i;
const IN = /InStock|LimitedAvailability|OnlineOnly|PreOrder|InStoreOnly/i;

/** Links to watch in this space: to-buy items with price tracking on, real URLs only. */
async function watchedSources(s: Scoped, where?: SQL) {
  return joins.watchedSources(s, where);
}

type Observation = { price: number | null; currency: string | null; availability: string | null };

/**
 * Apply a fresh observation to a source of this space: update it, log price history, and create alerts.
 * Pure bookkeeping — how the observation was obtained (server fetch / browser extension) is the caller's business.
 */
export async function applyObservation(s: Scoped, src: Source, obs: Observation, prefs?: AlertPrefs): Promise<Alert[]> {
  const t = Date.now();
  prefs ??= await getAlertPrefs(s.scope.userId);
  const created: Alert[] = [];
  const currency = (obs.currency ?? src.currency).toUpperCase();
  const newPrice = obs.price != null && obs.price > 0 ? obs.price : null;

  const patch: Partial<Source> = { fetchedAt: t, checkFails: 0 };
  if (newPrice != null) {
    patch.price = newPrice;
    patch.currency = currency;
  }
  if (obs.availability) patch.availability = obs.availability;
  await s.update(schema.sources, patch, eq(schema.sources.id, src.id));
  if (newPrice != null) await recordPrice(s, src.id, src.itemId, newPrice, currency);

  const item = await s.byId(schema.items, src.itemId);
  if (!item || item.status !== "to_buy" || !item.watch) return created;

  const push = async (a: Omit<Alert, "id" | "createdAt" | "sentAt" | "readAt" | "itemId" | "sourceId" | "spaceId" | "rev" | "revBy">) => {
    // One alert per source+kind per 20h — avoid repeats when checked twice in a day.
    const [recent] = await s.select(schema.alerts, and(eq(schema.alerts.sourceId, src.id), eq(schema.alerts.kind, a.kind), gt(schema.alerts.createdAt, t - 20 * 3600_000))).limit(1);
    if (recent) return;
    const row = { id: nanoid(12), itemId: item.id, sourceId: src.id, createdAt: t, sentAt: null, readAt: null, ...a };
    await s.insert(schema.alerts, row);
    created.push({ ...row, spaceId: s.spaceId, rev: 0, revBy: null });
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

export async function recordFailure(s: Scoped, src: Source) {
  await s.update(schema.sources, { checkFails: src.checkFails + 1, fetchedAt: Date.now() }, eq(schema.sources.id, src.id));
}

/** One server read of a link; null when the store blocked us (shared by every space that tracks the same URL). */
async function observe(url: string): Promise<Observation | null> {
  let ex: Extracted;
  try {
    ex = await extractFromUrl(url);
  } catch {
    return null;
  }
  if (ex.blocked || (ex.price == null && !ex.availability)) return null;
  return { price: ex.price, currency: ex.currency, availability: ex.availability };
}

/** Server-side check of one link in this space. Returns null when the store blocked us. */
export async function checkSourceOnServer(s: Scoped, src: Source): Promise<Alert[] | null> {
  const obs = await observe(src.url);
  if (!obs) {
    await recordFailure(s, src);
    return null;
  }
  return applyObservation(s, src, obs);
}

/** Check from HTML the browser extension fetched with the user's own connection (extension retired in R15 — kept). */
export async function checkSourceFromHtml(s: Scoped, src: Source, html: string, finalUrl?: string): Promise<Alert[] | null> {
  const parsed = parseHtml(html, finalUrl || src.url);
  if (parsed.price == null && !parsed.availability) {
    await recordFailure(s, src);
    return null;
  }
  return applyObservation(s, src, { price: parsed.price, currency: parsed.currency ?? storeFromUrl(src.url).currency ?? src.currency, availability: parsed.availability });
}

/** Check from data the extension read off a rendered page (extension retired in R15 — kept). */
export async function checkSourceFromPayload(s: Scoped, src: Source, p: { price?: string | number | null; currency?: string | null; availability?: string | null }) {
  const parsed = parsePrice(p.price ?? null, p.currency ?? src.currency);
  if (!parsed && !p.availability) {
    await recordFailure(s, src);
    return null;
  }
  return applyObservation(s, src, { price: parsed?.amount ?? null, currency: parsed?.currency ?? p.currency ?? null, availability: p.availability ?? null });
}

const notBlocked = () => or(lt(schema.sources.checkFails, 3), isNull(schema.sources.checkFails));

/** "Check now" in one space: oldest-first until the time budget runs out. */
export async function runServerChecks(s: Scoped, budgetMs = 45_000, concurrency = 4) {
  const started = Date.now();
  // Skip links that failed 3+ times in a row on the server.
  const queue = (await watchedSources(s, notBlocked())).map((r) => r.source);
  let checked = 0;
  let blocked = 0;
  const alerts: Alert[] = [];
  const worker = async () => {
    while (queue.length && Date.now() - started < budgetMs) {
      const src = queue.shift()!;
      const out = await checkSourceOnServer(s, src);
      checked++;
      if (out == null) blocked++;
      else alerts.push(...out);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { checked, blocked, remaining: queue.length, alerts };
}

/**
 * The daily cron (B3): every space's watched links, ONE fetch per normalized URL per run, then the observation is
 * written to each space's own source rows through that space's scope (prefs of the space's creator).
 */
export async function runCronChecks(budgetMs = 28_000, concurrency = 4) {
  const started = Date.now();
  const rows = await systemWatchedSources();
  const byUrl = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byUrl.get(r.source.normalizedUrl) ?? [];
    list.push(r);
    byUrl.set(r.source.normalizedUrl, list);
  }
  const queue = [...byUrl.values()].sort((a, b) => (a[0].source.fetchedAt ?? 0) - (b[0].source.fetchedAt ?? 0));
  const prefsCache = new Map<string, AlertPrefs>();
  let fetched = 0;
  let checked = 0;
  let blocked = 0;
  const alerts: Alert[] = [];
  const worker = async () => {
    while (queue.length && Date.now() - started < budgetMs) {
      const group = queue.shift()!;
      const obs = await observe(group[0].source.url);
      fetched++;
      for (const r of group) {
        const s = new Scoped({ spaceId: r.spaceId, userId: r.ownerId, by: "system" });
        checked++;
        if (!obs) {
          blocked++;
          await recordFailure(s, r.source);
          continue;
        }
        const key = r.ownerId ?? "";
        if (!prefsCache.has(key)) prefsCache.set(key, await getAlertPrefs(r.ownerId));
        alerts.push(...(await applyObservation(s, r.source, obs, prefsCache.get(key))));
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { fetched, checked, blocked, remaining: queue.reduce((n, g) => n + g.length, 0), alerts };
}

/** Links the extension should check: blocked on the server and not checked in the last `minAgeH` hours. */
export async function sourcesForExtension(s: Scoped, limit = 12, minAgeH = 18) {
  const rows = await watchedSources(s, and(gt(schema.sources.checkFails, 0), or(isNull(schema.sources.fetchedAt), lt(schema.sources.fetchedAt, Date.now() - minAgeH * 3600_000))));
  return rows.slice(0, limit).map((r) => ({ id: r.source.id, url: r.source.url, storeKey: r.source.storeKey }));
}

// ---------- The user's language + display currency (the cron has no cookies) ----------

const OWNER_KEY = "pref:owner";

export async function rememberOwner(userId: string, locale: string, currency: string) {
  const next = JSON.stringify({ locale, currency });
  if ((await userPrefGet(userId, OWNER_KEY)) !== next) await userPrefSet(userId, OWNER_KEY, next);
}
export async function ownerPrefs(userId: string | null) {
  try {
    const v = JSON.parse((userId && (await userPrefGet(userId, OWNER_KEY))) || "{}") as { locale?: string; currency?: string };
    return { locale: isLocale(v.locale) ? v.locale : "en", currency: (CURRENCIES as readonly string[]).includes(v.currency ?? "") ? v.currency! : "ILS" };
  } catch {
    return { locale: "en" as const, currency: "ILS" };
  }
}
