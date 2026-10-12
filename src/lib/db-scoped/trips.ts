import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { replayTrip, type CheckAction } from "@/lib/grocery/trip";
import { Scoped } from "./index";

// R18 A2 — trips and their ordered check log. A trip belongs to a space and its shopper; every action in it is one
// `trip_check` row with the next `seq` of that trip; the counts on the `trip` row are rebuilt from the log (replayTrip).

export type TripRow = typeof schema.trip.$inferSelect;
export type CheckInput = {
  action: CheckAction;
  itemId?: string | null;
  productKey?: string | null;
  section?: string | null;
  qty?: number | null;
  amount?: number | null;
  unit?: string | null;
  price?: number | null;
  gtin?: string | null;
  by?: string | null;
  at?: number;
};

/** A reload within this long of the start is the same trip. */
export const SAME_TRIP_MS = 6 * 3_600_000;
const tid = () => `tr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

/** The person's open trip (any space), newest first. */
export async function openTripOf(userId: string): Promise<TripRow | null> {
  const [t] = await db.select().from(schema.trip).where(and(eq(schema.trip.userId, userId), isNull(schema.trip.finishedAt))).orderBy(desc(schema.trip.startedAt)).limit(1);
  return t ?? null;
}

/** Every open trip (the hourly idle sweep). */
export async function openTrips(): Promise<TripRow[]> {
  return db.select().from(schema.trip).where(isNull(schema.trip.finishedAt));
}

export async function tripById(s: Scoped, id: string) {
  return s.byId(schema.trip, id);
}

export async function startTrip(
  s: Scoped,
  userId: string,
  o: { chain?: string | null; branch?: string | null; planned?: number; estTotal?: number | null; currency?: string; notifyKey?: string | null; now?: number } = {},
): Promise<TripRow> {
  const now = o.now ?? Date.now();
  const row = {
    id: tid(),
    userId,
    chain: o.chain ?? null,
    branch: o.branch ?? null,
    startedAt: now,
    planned: Math.max(0, o.planned ?? 0),
    estTotal: o.estTotal ?? null,
    currency: o.currency ?? "ILS",
    notifyKey: o.notifyKey ?? null,
    left: o.planned ?? null,
  };
  await s.insert(schema.trip, row);
  return (await s.byId(schema.trip, row.id))!;
}

/** Append one action to the trip's log (next `seq`), then rebuild the trip's counts. Returns the seq. */
export async function addCheck(s: Scoped, tripId: string, c: CheckInput): Promise<number> {
  const trip = await s.byId(schema.trip, tripId);
  if (!trip) throw new Error("not_found");
  const next = sql<number>`(SELECT coalesce(max(${schema.tripCheck.seq}), 0) + 1 FROM ${schema.tripCheck} WHERE ${schema.tripCheck.tripId} = ${tripId})`;
  const values = {
    tripId,
    itemId: c.itemId ?? null,
    productKey: c.productKey ?? null,
    section: c.section ?? null,
    action: c.action,
    qty: c.qty ?? null,
    amount: c.amount ?? null,
    unit: c.unit ?? null,
    price: c.price ?? null,
    gtin: c.gtin ?? null,
    byUser: c.by ?? s.scope.userId,
    at: c.at ?? Date.now(),
    seq: next as unknown as number,
  };
  // Two writers at the same moment can race for a seq (unique index): the second simply retries.
  for (let i = 0; ; i++) {
    try {
      await s.insert(schema.tripCheck, values);
      break;
    } catch (e) {
      if (i >= 3) throw e;
    }
  }
  // A price from a trip is a price point of that branch (R19 matches transparency files by gtin + chain + branch).
  if (c.action === "price" && c.itemId && c.price != null && c.price > 0) {
    await s.insert(schema.pricePoints, {
      id: `pp_${crypto.randomUUID().slice(0, 12)}`,
      sourceId: `trip:${tripId}`,
      itemId: c.itemId,
      price: c.price,
      currency: trip.currency,
      recordedAt: values.at,
      tripId,
      chain: trip.chain,
      branch: trip.branch,
      gtin: c.gtin ?? null,
    });
  }
  await refreshCounts(s, tripId);
  const [last] = await s.pick({ seq: schema.tripCheck.seq }, schema.tripCheck, eq(schema.tripCheck.tripId, tripId)).orderBy(desc(schema.tripCheck.seq)).limit(1);
  return Number(last?.seq ?? 0);
}

export async function tripChecks(s: Scoped, tripId: string) {
  return s.select(schema.tripCheck, eq(schema.tripCheck.tripId, tripId)).orderBy(asc(schema.tripCheck.seq));
}

/** Rebuild bought / not found / planned from the log. */
export async function refreshCounts(s: Scoped, tripId: string) {
  const trip = await s.byId(schema.trip, tripId);
  if (!trip) return null;
  const r = replayTrip(await tripChecks(s, tripId));
  const planned = Math.max(trip.planned, r.bought + r.notFound);
  await s.update(schema.trip, { bought: r.bought, notFound: r.notFound, planned: planned + 0, rev: trip.rev + 1 }, eq(schema.trip.id, tripId));
  return r;
}

export async function finishTrip(s: Scoped, tripId: string, o: { total?: number | null; receiptId?: string | null; now?: number } = {}) {
  const trip = await s.byId(schema.trip, tripId);
  if (!trip || trip.finishedAt) return trip;
  await refreshCounts(s, tripId);
  await s.update(schema.trip, { finishedAt: o.now ?? Date.now(), ...(o.total !== undefined ? { total: o.total } : {}), ...(o.receiptId !== undefined ? { receiptId: o.receiptId } : {}) }, eq(schema.trip.id, tripId));
  return s.byId(schema.trip, tripId);
}

/** The live "6 of 15 left" from the presence beat. */
export async function setTripLeft(s: Scoped, tripId: string, left: number | null) {
  await s.update(schema.trip, { left }, eq(schema.trip.id, tripId));
}

/** Finished trips of a space (optionally one store), oldest first, with their logs. */
export async function finishedTrips(s: Scoped, store?: { chain: string; branch: string }) {
  const trips = await s
    .select(schema.trip, and(isNotNull(schema.trip.finishedAt), ...(store ? [eq(schema.trip.chain, store.chain), eq(schema.trip.branch, store.branch)] : [])))
    .orderBy(asc(schema.trip.startedAt));
  const out: (TripRow & { checks: (typeof schema.tripCheck.$inferSelect)[] })[] = [];
  for (const t of trips) out.push({ ...t, checks: await tripChecks(s, t.id) });
  return out;
}

/** Scope for a trip found by id without a ctx (senders, sweeps). */
export const tripScope = (t: TripRow) => new Scoped({ spaceId: t.spaceId, userId: t.userId, by: t.userId });

/**
 * The shopping mode of R17 marks items bought with setStatus: while the shopper has an open trip in this space, each
 * mark is also a `check` in the trip's log (so the counts, the order and the history stay right before S2's screens).
 */
export async function noteTripCheck(s: Scoped, userId: string | null, item: { id: string; productKey: string | null; section: string | null; gtin: string | null }, price: number | null) {
  if (!userId) return;
  const t = await openTripOf(userId);
  if (!t || t.spaceId !== s.spaceId) return;
  await addCheck(s, t.id, { action: "check", itemId: item.id, productKey: item.productKey, section: item.section, gtin: item.gtin, by: userId });
  if (price != null && price > 0) await addCheck(s, t.id, { action: "price", itemId: item.id, productKey: item.productKey, price, gtin: item.gtin, by: userId });
}
