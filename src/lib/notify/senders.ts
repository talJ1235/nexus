import "server-only";
import { schema } from "@/db";
import { Scoped } from "../db-scoped";
import { activePeople, countActivity, deliveriesBetween, firstNames, lastBeat, notificationByGroup, patchNotificationData, prefRows, spaceAudience, spaceBrief, spacesOf, spacesWithBudget } from "../db-scoped/notify";
import { spacePrefGet, userPrefGet, userPrefSet } from "../db-scoped/prefs";
import { capFor, monthForecast, monthKeyIn, monthStartIn, nextMonthKey } from "../budget";
import { getAppData } from "../data";
import { weekNumbers } from "../weekly";
import { ownerPrefs } from "../tracker";
import type { Alert } from "../types";
import type { BudgetData, DeliveryData, PriceData, ShopData, WeekData } from "./kinds";
import { notify, notifyPrefs } from "./enqueue";
import { local, nextLocal } from "./schedule";

// R17 S3 M — who gets what, when. Every sender goes through notify() (actor excluded, one row per group key, timing).
// Hooks: the presence beat (shopping trips), noteActivity (adds / check-offs in a shared space), the price checks, and
// the hourly sweep (idle trips, deliveries today, budget 80 / 100 %, the Thursday summary).

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const TRIP_KEY = "pref:shop-trip";
export { BUDGET_TO_KEY } from "./kinds";
import { BUDGET_TO_KEY } from "./kinds";
const TRIP_IDLE_MS = 30 * 60_000;

type Trip = { key: string; spaceId: string; at: number; total: number | null };
const parse = <T,>(s: string | null | undefined): T | null => {
  try {
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
};

// ---------- M1: shopping trips ----------

/** Shopping mode started in a shared space → the other members, at once (one row per trip, updated in place). */
export async function tripStarted(userId: string, spaceId: string | null, left: number | null, now = Date.now()) {
  if (!spaceId) return;
  const sp = await spaceBrief(spaceId);
  if (!sp || sp.kind !== "shared") return;
  const open = parse<Trip>(await userPrefGet(userId, TRIP_KEY));
  if (open && open.spaceId === spaceId && now - open.at < 6 * HOUR) return; // a reload mid-trip is the same trip
  const trip: Trip = { key: `shop:${userId}:${now}`, spaceId, at: now, total: left };
  await userPrefSet(userId, TRIP_KEY, JSON.stringify(trip));
  const who = (await firstNames([userId]))[userId] ?? "";
  const audience = (await spaceAudience(spaceId, userId)).map((m) => m.userId);
  const data: ShopData = { who, whoId: userId, space: sp.name, left, total: left };
  await notify(audience, "shop", trip.key, data, { actor: userId, spaceId, now });
}

/** While the trip runs: the live "6 of 15 left" in the members' rows (no new push). */
export async function tripProgress(userId: string, left: number | null) {
  const trip = parse<Trip>(await userPrefGet(userId, TRIP_KEY));
  if (!trip || left == null) return;
  const audience = (await spaceAudience(trip.spaceId, userId)).map((m) => m.userId);
  const prev = await notificationByGroup(audience[0] ?? "", trip.key);
  const cur = parse<ShopData>(prev?.data);
  if (!cur || cur.done || cur.left === left) return;
  await patchNotificationData(audience, trip.key, { ...cur, left, total: Math.max(cur.total ?? 0, left) });
}

/** Finished (left shopping mode, or 30 min idle) → the same row + push, in place: "bought 12, 3 left". */
export async function tripFinished(userId: string, left: number | null, now = Date.now()) {
  const trip = parse<Trip>(await userPrefGet(userId, TRIP_KEY));
  if (!trip) return;
  await userPrefSet(userId, TRIP_KEY, null);
  const bought = await countActivity(userId, trip.spaceId, "checked_off", trip.at);
  const audience = (await spaceAudience(trip.spaceId, userId)).map((m) => m.userId);
  await notify(
    audience,
    "shop",
    trip.key,
    (prev) => ({ ...((prev as ShopData | null) ?? { who: "", whoId: userId, space: "" }), done: true, bought, left: left ?? (prev as ShopData | null)?.left ?? 0 }),
    { actor: userId, spaceId: trip.spaceId, now, finishedTrip: true },
  );
}

// ---------- M2: shared activity ----------

/** Adds / check-offs by someone in a shared space → one grouped row per space per hour for the other members. */
export async function sharedActivity(userId: string, spaceId: string | null, kind: "items_added" | "checked_off", n: number, now = Date.now()) {
  if (!spaceId || n <= 0) return;
  const sp = await spaceBrief(spaceId);
  if (!sp || sp.kind !== "shared") return;
  // Check-offs during a trip are the trip's news ("bought 12"), not activity.
  if (kind === "checked_off") {
    const trip = parse<Trip>(await userPrefGet(userId, TRIP_KEY));
    if (trip && trip.spaceId === spaceId) return;
  }
  const who = (await firstNames([userId]))[userId] ?? "";
  const audience = (await spaceAudience(spaceId, userId)).map((m) => m.userId);
  const key = `activity:${spaceId}:${Math.floor(now / HOUR)}`;
  await notify(
    audience,
    "activity",
    key,
    (prev) => {
      const p = (prev as { names: string[]; byIds: string[]; added: number; checked: number } | null) ?? { names: [], byIds: [], added: 0, checked: 0 };
      const known = p.byIds.includes(userId);
      return {
        names: known ? p.names : [...p.names, who],
        byIds: known ? p.byIds : [...p.byIds, userId],
        added: p.added + (kind === "items_added" ? n : 0),
        checked: p.checked + (kind === "checked_off" ? n : 0),
        space: sp.name,
      };
    },
    { actor: userId, spaceId, now },
  );
}

// ---------- M3: prices ----------

/**
 * The alerts of one check run → one `price` row per item for every member of its space. They share the run id and the
 * person's active hour, so the dispatcher sends them as one push ("3 price drops"). minDropPct already applied.
 */
export async function priceAlerts(alerts: Alert[], runId: string, now = Date.now()) {
  const bySpace = new Map<string, Alert[]>();
  for (const a of alerts) if (a.kind === "drop" || a.kind === "target") bySpace.set(a.spaceId, [...(bySpace.get(a.spaceId) ?? []), a]);
  let n = 0;
  for (const [spaceId, list] of bySpace) {
    const audience = (await spaceAudience(spaceId, null)).map((m) => m.userId);
    if (!audience.length) continue;
    const s = new Scoped({ spaceId, userId: null, by: "system" });
    for (const a of list) {
      const item = await s.byId(schema.items, a.itemId);
      if (!item) continue;
      const src = a.sourceId ? await s.byId(schema.sources, a.sourceId) : null;
      const data: PriceData = { itemId: item.id, title: item.title, store: src?.store ?? undefined, now: a.newPrice ?? 0, was: a.oldPrice, currency: a.currency ?? src?.currency ?? "ILS", target: a.kind === "target", pic: item.imageUrl, run: runId };
      await notify(audience, "price", `price:${runId}:${item.id}`, data, { actor: null, spaceId, now });
      n++;
    }
  }
  return n;
}

// ---------- M4: deliveries, budget, the week ----------

const ymd = (ts: number, tz: string) => {
  const l = local(ts, tz);
  return `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
};

/** Deliveries due today (each member's own day) → a `delivery` row at 08:00 local with Received. Once per item per day. */
export async function deliveriesToday(now = Date.now()) {
  let n = 0;
  for (const it of await deliveriesBetween(now - DAY, now + 2 * DAY)) {
    for (const m of await spaceAudience(it.spaceId, null)) {
      const p = await notifyPrefs(m.userId, now);
      const day = ymd(now, p.tz);
      if (ymd(it.eta!, p.tz) !== day) continue;
      const key = `delivery:${it.id}:${day}`;
      if (await notificationByGroup(m.userId, key)) continue;
      const data: DeliveryData = { itemId: it.id, title: it.title, store: it.store ?? undefined, pic: it.imageUrl };
      // 08:00 local while it is still ahead today; later in the day → now (notify() keeps it out of quiet hours).
      const eight = nextLocal(now, p.tz, 8);
      await notify([m.userId], "delivery", key, data, { actor: null, spaceId: it.spaceId, now, at: () => (ymd(eight, p.tz) === day ? eight : now) });
      n++;
    }
  }
  return n;
}

/** Budget 80 % / 100 % — once per space per month per level → the owner + the members the owner picked (N2). */
export async function budgetAlerts(now = Date.now()) {
  let n = 0;
  for (const spaceId of await spacesWithBudget()) {
    const sp = await spaceBrief(spaceId);
    if (!sp) continue;
    const s = new Scoped({ spaceId, userId: sp.ownerId, by: "system" });
    const data = await getAppData(s, sp.ownerId ?? "");
    const tz = (await notifyPrefs(sp.ownerId ?? "", now)).tz;
    const key = monthKeyIn(now, tz);
    const cap = capFor(key, data.budget);
    if (!cap?.cap) continue;
    const fc = monthForecast({ items: data.items, altGroups: data.altGroups, rates: data.rates, currency: sp.currency, from: monthStartIn(key, tz), to: monthStartIn(nextMonthKey(key), tz), cap, includeNormal: false });
    if (!fc.cap) continue;
    const used = fc.spent + fc.committed;
    const pct = used >= fc.cap ? 100 : used >= fc.cap * 0.8 ? 80 : 0;
    if (!pct) continue;
    const to = await budgetRecipients(spaceId, sp.ownerId);
    const group = `budget:${spaceId}:${key}:${pct}`;
    const fresh: string[] = [];
    for (const u of to) if (!(await notificationByGroup(u, group))) fresh.push(u);
    if (!fresh.length) continue;
    const d: BudgetData = { space: sp.name, pct: pct as 80 | 100, spent: Math.round(used), budget: Math.round(fc.cap), currency: sp.currency, month: Number(key.slice(5, 7)) };
    await notify(fresh, "budget", group, d, { actor: null, spaceId, now });
    n += fresh.length;
  }
  return n;
}

/** N2: who gets the space's budget alerts — always the owner, plus the members the owner picked (never viewers). */
export async function budgetRecipients(spaceId: string, ownerId: string | null) {
  const picked = parse<string[]>(await spacePrefGet(new Scoped({ spaceId, userId: ownerId, by: "system" }), BUDGET_TO_KEY)) ?? [];
  const members = await spaceAudience(spaceId, null);
  const ok = new Set(members.filter((m) => m.role !== "viewer").map((m) => m.userId));
  const owners = members.filter((m) => m.role === "owner").map((m) => m.userId);
  return [...new Set([...(ownerId && ok.has(ownerId) ? [ownerId] : []), ...owners, ...picked.filter((u) => ok.has(u))])];
}

/** Thursday's summary: bought, spent, drops over the week, across the person's spaces, in their currency. */
export async function weeklySummaries(now = Date.now()) {
  let n = 0;
  for (const userId of await activePeople(now - 30 * DAY)) {
    const p = await notifyPrefs(userId, now);
    const l = local(now, p.tz);
    if (l.weekday !== 4) continue;
    const key = `week:${ymd(now, p.tz)}`;
    if (await notificationByGroup(userId, key)) continue;
    const { currency } = await ownerPrefs(userId);
    const total: WeekData = { bought: 0, spent: 0, currency, drops: 0 };
    for (const sp of await spacesOf(userId)) {
      const data = await getAppData(new Scoped({ spaceId: sp.id, userId, by: "system" }), userId);
      const w = weekNumbers({ items: data.items, alerts: data.alerts ?? [], rates: data.rates, currency, now });
      total.bought += w.bought;
      total.spent += w.spent;
      total.drops += w.drops;
    }
    if (!total.bought && !total.drops) continue; // nothing worth a message
    total.spent = Math.round(total.spent);
    // Today at the active hour while it's ahead; later on Thursday → now (outside quiet hours).
    const at = l.hour < p.hour ? nextLocal(now, p.tz, p.hour) : now;
    await notify([userId], "week", key, total, { actor: null, spaceId: null, now, at: () => at });
    n++;
  }
  return n;
}

/** Trips whose owner went quiet for 30 min (closed the app mid-trip) end by themselves. */
export async function idleTrips(now = Date.now()) {
  let n = 0;
  for (const r of await prefRows(TRIP_KEY)) {
    const trip = parse<Trip>(r.value);
    if (!trip) continue;
    const beat = await lastBeat(r.userId);
    if (beat && beat.screen === "shopping-mode" && now - beat.at < TRIP_IDLE_MS) continue;
    if (!beat || now - beat.at >= TRIP_IDLE_MS || beat.screen !== "shopping-mode") {
      await tripFinished(r.userId, null, now);
      n++;
    }
  }
  return n;
}

/** The hourly dispatcher's sweeps (each step on its own: one failing never stops the others). */
export async function runNotifySweeps(now = Date.now()) {
  const step = async (f: () => Promise<number>) => {
    try {
      return await f();
    } catch {
      return -1;
    }
  };
  return {
    idleTrips: await step(() => idleTrips(now)),
    deliveries: await step(() => deliveriesToday(now)),
    budget: await step(() => budgetAlerts(now)),
    week: await step(() => weeklySummaries(now)),
  };
}

