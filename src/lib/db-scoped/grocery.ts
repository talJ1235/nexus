import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schema } from "@/db";
import { classifyLocal } from "@/lib/grocery/classify";
import { learnOrder, tripSections } from "@/lib/grocery/order";
import { cleanOrder, DEFAULT_ORDER, tripOrder, type SectionKey } from "@/lib/grocery/sections";
import { activeSkips, contextsOf, knowledgeOf, learnHistory, mergeQty, suggest, type History, type ProductPref, type Purchase, type Suggestion } from "@/lib/grocery/staples";
import { basketFor } from "@/lib/grocery/basket";
import { TYPE_BY_KEY } from "@/lib/grocery/dictionary";
import { replayTrip } from "@/lib/grocery/trip";
import { applyPlan, detectRoutines, matchRoutine } from "@/lib/grocery/routines";
import { learnUnitWeights, unitKgFor } from "@/lib/grocery/weights";
import { cleanMergeNotes, mergeAdd } from "@/lib/grocery/merge";
import type { Unit } from "@/lib/grocery/dictionary";
import type { TemplateItem } from "@/db/schema";
import { finishedTrips } from "./trips";
import { spacePrefGet, spacePrefSet } from "./prefs";
import type { Scoped } from "./index";

// R18 — the supermarket list's data: stores + section order (A3), the learned order (A5), add with merge (C2), history
// and suggestions (B1 / B2), auto staples, templates (B4). Every read and write is scoped to the space (Scoped).

type ItemRow = typeof schema.items.$inferSelect;
const SM = eq(schema.items.list, "supermarket");
const onListCond = and(SM, eq(schema.items.status, "to_buy"));
const DAY = 86_400_000;

// ---------- A3: stores and the section order ----------

export async function storesOf(s: Scoped) {
  return s.select(schema.spaceStore).orderBy(desc(schema.spaceStore.isDefault), asc(schema.spaceStore.chain));
}

export async function defaultStore(s: Scoped) {
  const [d] = await s.select(schema.spaceStore, eq(schema.spaceStore.isDefault, true)).limit(1);
  return d ?? null;
}

export async function storeOf(s: Scoped, chain: string, branch: string) {
  const [r] = await s.select(schema.spaceStore, and(eq(schema.spaceStore.chain, chain), eq(schema.spaceStore.branch, branch))).limit(1);
  return r ?? null;
}

/** Add / update a store; `isDefault` makes it the only default. */
export async function saveStore(s: Scoped, chain: string, branch: string, o: { isDefault?: boolean } = {}) {
  if (o.isDefault) await s.update(schema.spaceStore, { isDefault: false }, eq(schema.spaceStore.isDefault, true));
  await s
    .insert(schema.spaceStore, { chain, branch, isDefault: !!o.isDefault })
    .onConflictDoUpdate({ target: [schema.spaceStore.spaceId, schema.spaceStore.chain, schema.spaceStore.branch], set: o.isDefault !== undefined ? { isDefault: !!o.isDefault } : { chain } });
  return storeOf(s, chain, branch);
}

/** The order a trip's list follows: the branch's confirmed order, else the default. */
export async function listOrder(s: Scoped, chain?: string | null, branch?: string | null): Promise<SectionKey[]> {
  if (!chain) return [...DEFAULT_ORDER];
  return tripOrder(await storeOf(s, chain, branch ?? ""));
}

/** Confirm an order for a branch (S2's drag / "Use this order"); null = back to the default. Clears the suggestion. */
export async function confirmOrder(s: Scoped, chain: string, branch: string, order: string[] | null) {
  await saveStore(s, chain, branch);
  await s.update(
    schema.spaceStore,
    { sectionOrder: order ? JSON.stringify(cleanOrder(order)) : null, suggestedOrder: null, suggestedAt: null },
    and(eq(schema.spaceStore.chain, chain), eq(schema.spaceStore.branch, branch)),
  );
}

// ---------- A5: learn the branch's order (suggest, never apply) ----------

/** After a trip in this branch finishes: store a suggested order when ≥ 2 trips agree and differ from the current one. */
export async function refreshSuggestedOrder(s: Scoped, chain: string, branch: string, now = Date.now()) {
  const store = (await storeOf(s, chain, branch)) ?? (await saveStore(s, chain, branch));
  if (!store) return null;
  const trips = await finishedTrips(s, { chain, branch });
  // R18 S3: a trip that walked fewer than 2 sections teaches nothing — a pending suggestion stays as it was.
  const last = trips[trips.length - 1];
  if (store.suggestedOrder && last && tripSections(last).length < 2) return null;
  const next = learnOrder(trips, tripOrder(store), { dismissedAt: store.dismissedAt });
  const value = next ? JSON.stringify(next) : null;
  if (value !== store.suggestedOrder) await s.update(schema.spaceStore, { suggestedOrder: value, suggestedAt: value ? now : null }, and(eq(schema.spaceStore.chain, chain), eq(schema.spaceStore.branch, branch)));
  return next;
}

/** "Not now" on the banner: quiet until 3 more trips in this branch. */
export async function dismissOrder(s: Scoped, chain: string, branch: string, now = Date.now()) {
  await s.update(schema.spaceStore, { suggestedOrder: null, suggestedAt: null, dismissedAt: now }, and(eq(schema.spaceStore.chain, chain), eq(schema.spaceStore.branch, branch)));
}

// ---------- the list, C2: add with merge ----------

export async function supermarketList(s: Scoped) {
  return s.select(schema.items, onListCond).orderBy(asc(schema.items.createdAt));
}

export type AddInput = {
  title: string;
  qty?: number;
  amount?: number | null;
  unit?: Unit | null;
  /** B1: pieces (with or without a weight). */
  count?: number | null;
  gtin?: string | null;
  productKey?: string | null;
  section?: string | null;
  art?: string | null;
  notes?: string | null;
  /** Who added it (null = Nexus: an auto staple). */
  by: string | null;
  byName?: string | null;
};
export type Before = { quantity: number; amount: number | null; unit: string | null; notes: string | null; count?: number | null };
export type AddResult = { item: ItemRow; merged: boolean; before: Before | null };

/**
 * Add to the supermarket list. Same product already to buy → its quantity / amount grows instead of a new row
 * (`merged`, `before` for Undo). Different units of one product → one row; S4 A1: `mergeAdd` converts between pieces and
 * weight with the unit weight (both measures kept when there is none) — never a note.
 */
export async function addToList(s: Scoped, i: AddInput, now = Date.now()): Promise<AddResult> {
  const cls = classifyLocal(i.title, i.gtin);
  const productKey = i.productKey || cls.productKey;
  const qty = Math.max(1, Math.round(i.qty ?? 1));
  const unit = i.unit && i.unit !== "u" ? i.unit : null;
  const amount = unit && i.amount != null && i.amount > 0 ? i.amount : null;
  const count = i.count != null && i.count >= 1 ? Math.min(999, Math.round(i.count)) : null;
  const [cur] = await s.select(schema.items, and(onListCond, eq(schema.items.productKey, productKey))).orderBy(asc(schema.items.createdAt)).limit(1);
  if (cur) {
    const before: Before = { quantity: cur.quantity, amount: cur.amount, unit: cur.unit, notes: cur.notes, count: cur.count };
    // S4 A1: into the row's measures (count / weight / packs), never the notes; the unit weight converts between them.
    const mixed = (cur.unit ?? null) !== unit || (cur.count != null) !== (count != null);
    const unitKg = mixed ? await unitWeightOf(s, productKey) : null;
    const next = mergeAdd({ quantity: cur.quantity, count: cur.count, amount: cur.amount, unit: cur.unit }, { qty, count, amount, unit }, unitKg);
    const patch: Partial<ItemRow> = { updatedAt: now, quantity: next.quantity, count: next.count, amount: next.amount, unit: next.unit as Unit | null };
    await s.update(schema.items, patch, eq(schema.items.id, cur.id));
    return { item: (await s.byId(schema.items, cur.id))!, merged: true, before };
  }
  const id = nanoid();
  await s.insert(schema.items, {
    id,
    title: i.title.trim().slice(0, 300),
    list: "supermarket",
    status: "to_buy",
    // A count of pieces is the row's measure (packs stay 1).
    quantity: count != null ? 1 : qty,
    amount,
    unit,
    count,
    gtin: i.gtin ?? null,
    productKey,
    section: i.section ?? cls.section,
    artKey: i.art ?? cls.art,
    notes: i.notes ?? null,
    watch: false,
    addedByUserId: i.by,
    addedByName: i.by ? null : (i.byName ?? "Nexus"),
    createdAt: now,
    updatedAt: now,
  });
  return { item: (await s.byId(schema.items, id))!, merged: false, before: null };
}

/** kg per piece for one product: the home's own (purchases with both measures), else the type's fallback. */
async function unitWeightOf(s: Scoped, productKey: string) {
  return unitKgFor(productKey, learnUnitWeights((await purchasesOf(s)).purchases.filter((p) => p.productKey === productKey)));
}

/**
 * S4 A1 one-off (daily cron, idempotent): "+ ×N" / "+ 2 kg" fragments the old merge wrote into a row's notes go into
 * its measures — rows to buy and bought ones alike (history and Add again read them); other text in the notes stays.
 */
export async function cleanMergeNoteRows(s: Scoped) {
  const rows = await s.select(schema.items, and(SM, sql`${schema.items.notes} like '%+ %'`));
  let fixed = 0;
  for (const r of rows) {
    const unitKg = r.productKey ? await unitWeightOf(s, r.productKey) : null;
    const next = cleanMergeNotes({ quantity: r.quantity, count: r.count, amount: r.amount, unit: r.unit, notes: r.notes }, unitKg);
    if (!next) continue;
    await s.update(schema.items, { quantity: next.quantity, count: next.count, amount: next.amount, unit: next.unit as Unit | null, notes: next.notes }, eq(schema.items.id, r.id));
    fixed++;
  }
  return fixed;
}

/** Undo of a merge: the old quantity / amount / note come back. */
export async function undoMerge(s: Scoped, itemId: string, before: Before) {
  const cur = await s.byId(schema.items, itemId);
  if (!cur || cur.list !== "supermarket") return null;
  await s.update(schema.items, { quantity: before.quantity, amount: before.amount, unit: before.unit as Unit | null, notes: before.notes, ...(before.count !== undefined ? { count: before.count } : {}), updatedAt: Date.now() }, eq(schema.items.id, itemId));
  return s.byId(schema.items, itemId);
}

/** Section for an item whose classification arrived later (AI / Open Food Facts). Only fills `other`. */
export async function setSectionIfOther(s: Scoped, itemId: string, section: string, art?: string | null) {
  await s.update(schema.items, { section, ...(art ? { artKey: art } : {}) }, and(eq(schema.items.id, itemId), eq(schema.items.section, "other")));
}

// ---------- B1: history ----------

/** Everything the space bought: trip checks still standing at the end, plus purchased supermarket items outside trips. */
export async function purchasesOf(s: Scoped): Promise<{ purchases: Purchase[]; trips: { id: string; startedAt: number; keys: Set<string> }[] }> {
  const trips = await finishedTrips(s);
  const purchases: Purchase[] = [];
  const seenItems = new Set<string>();
  const items = new Map((await s.select(schema.items, SM)).map((i) => [i.id, i]));
  // A check without a row (an add in the store, a product bought before) is named by the latest row of that product.
  const nameOf = new Map<string, { title: string; art: string | null; at: number }>();
  for (const i of items.values()) if (i.productKey && (nameOf.get(i.productKey)?.at ?? -1) < i.updatedAt) nameOf.set(i.productKey, { title: i.title, art: i.artKey, at: i.updatedAt });
  const tripsOut: { id: string; startedAt: number; keys: Set<string> }[] = [];
  for (const t of trips) {
    const r = replayTrip(t.checks);
    const keys = new Set<string>();
    for (const k of r.order) {
      const checks = t.checks.filter((c) => (c.itemId ?? c.productKey) === k);
      const last = checks.filter((c) => c.action === "check" || c.action === "substitute").pop();
      if (!last) continue;
      const it = last.itemId ? items.get(last.itemId) : undefined;
      const productKey = last.productKey ?? it?.productKey;
      if (!productKey) continue;
      if (last.itemId) seenItems.add(last.itemId);
      const priced = [...checks].reverse().find((c) => c.price != null);
      const qtyc = [...checks].reverse().find((c) => c.action === "qty" || c.qty != null);
      keys.add(productKey);
      purchases.push({
        productKey,
        title: it?.title ?? nameOf.get(productKey)?.title ?? productKey,
        at: last.at,
        qty: qtyc?.qty ?? it?.quantity ?? 1,
        amount: qtyc?.amount ?? it?.amount ?? null,
        unit: qtyc?.unit ?? it?.unit ?? null,
        // B1: a check with both a quantity and a weight counted pieces; else the row's own count.
        count: qtyc?.qty != null && qtyc?.amount != null ? qtyc.qty : (it?.count ?? null),
        price: priced?.price ?? null,
        chain: t.chain,
        branch: t.branch,
        section: last.section ?? it?.section ?? null,
        art: it?.artKey ?? nameOf.get(productKey)?.art ?? null,
        tripId: t.id,
      });
    }
    tripsOut.push({ id: t.id, startedAt: t.startedAt, keys });
  }
  for (const it of items.values()) {
    if (it.status !== "purchased" || seenItems.has(it.id) || !it.productKey) continue;
    purchases.push({ productKey: it.productKey, title: it.title, at: it.purchasedAt ?? it.updatedAt, qty: it.quantity, amount: it.amount, unit: it.unit, count: it.count, price: it.purchasedPrice, section: it.section, art: it.artKey, tripId: null });
  }
  return { purchases, trips: tripsOut };
}

// ---------- F1: what Nexus learned can be forgotten ----------

/** Cut-off times per learned fact (space pref): `all` = forget everything, `day` = the usual day, `store:<chain>`, `p:<key>`. */
export const FORGET_KEY = "pref:sm:forget";
export type Forget = Record<string, number>;

export async function forgetOf(s: Scoped): Promise<Forget> {
  try {
    const v = JSON.parse((await spacePrefGet(s, FORGET_KEY)) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Forget) : {};
  } catch {
    return {};
  }
}

/** What the learning reads: purchases / trips after the cut-offs (lists, trips and receipts themselves never change). */
export function applyForget<P extends { at: number; productKey: string }, T extends { startedAt: number }>(f: Forget, purchases: P[], trips: T[]) {
  const all = f.all ?? 0;
  const day = Math.max(all, f.day ?? 0);
  const kept = trips.filter((t) => t.startedAt >= all);
  return { purchases: purchases.filter((p) => p.at >= all && p.at >= (f[`p:${p.productKey}`] ?? 0)), trips: kept, dayTrips: kept.filter((t) => t.startedAt >= day) };
}

export async function learningOf(s: Scoped) {
  const [raw, f] = await Promise.all([purchasesOf(s), forgetOf(s)]);
  return { ...applyForget(f, raw.purchases, raw.trips), raw, forget: f };
}

/** Forget one learned fact (or `all`): Nexus learns it again from what happens next. Returns the fact's cut-off before
 *  (null = none) so one fact can be undone (R18 S3 B10). */
export async function forgetFact(s: Scoped, key: string, now = Date.now()): Promise<number | null> {
  const f = await forgetOf(s);
  const prev = f[key] ?? null;
  const next: Forget = key === "all" ? { all: now } : { ...f, [key]: now };
  await spacePrefSet(s, FORGET_KEY, JSON.stringify(next));
  if (key === "all") {
    // Learning only: the learned walking orders and the Nexus offers nobody answered go; lists, trips, receipts stay.
    await s.update(schema.spaceStore, { suggestedOrder: null, suggestedAt: null }, isNotNull(schema.spaceStore.suggestedOrder));
    await s.delete(schema.template, and(eq(schema.template.madeBy, "nexus"), isNull(schema.template.keptAt), isNull(schema.template.dismissedAt)));
  }
  return prev;
}

/** R18 S3 B10: Undo forgetting one fact — its cut-off goes back to what it was (never for `all`). */
export async function restoreForget(s: Scoped, key: string, prev: number | null) {
  if (key === "all") return;
  const f = await forgetOf(s);
  const next: Forget = { ...f };
  if (prev == null) delete next[key];
  else next[key] = prev;
  await spacePrefSet(s, FORGET_KEY, JSON.stringify(next));
}

export async function historyOf(s: Scoped, tz: string): Promise<{ history: History; baskets: Set<string>[]; trips: number }> {
  const { purchases, trips, dayTrips } = await learningOf(s);
  return { history: learnHistory(purchases, dayTrips, { tz }), baskets: trips.map((t) => t.keys), trips: trips.length };
}

export type LearnedFact = { key: string; group: "where" | "regular" | "habits"; kind: "day" | "store" | "sometimes" | "regular" | "shabbat" | "with" | "brand"; told?: boolean; args: Record<string, string | number> };

/**
 * F1: "What Nexus learned" — the learned facts (When and where, Regular products, Habits), each with the key that forgets
 * it. The answers people gave (household, budget, main store) are told facts the screen shows from the store / Settings.
 */
export async function learnedFacts(s: Scoped, tz: string) {
  const [{ purchases, trips, dayTrips, forget }, stores, prefs, tripRows] = await Promise.all([
    learningOf(s),
    storesOf(s),
    prefsOf(s),
    s.pick({ chain: schema.trip.chain, at: schema.trip.startedAt }, schema.trip, isNotNull(schema.trip.finishedAt)),
  ]);
  const history = learnHistory(purchases, dayTrips, { tz });
  const baskets = trips.map((t) => t.keys);
  const out: LearnedFact[] = [];
  if (history.usualDay) out.push({ key: "day", group: "where", kind: "day", args: { weekday: history.usualDay.weekday, hour: history.usualDay.hour } });
  const def = stores.find((x) => x.isDefault);
  if (def) out.push({ key: "store", group: "where", kind: "store", told: true, args: { chain: def.chain, branch: def.branch } });
  const visits = new Map<string, number>();
  const all = forget.all ?? 0;
  for (const r of tripRows) if (r.chain && r.at >= all && r.at >= (forget[`store:${r.chain}`] ?? 0)) visits.set(r.chain, (visits.get(r.chain) ?? 0) + 1);
  for (const [chain, n] of [...visits].sort((a, b) => b[1] - a[1])) if (chain !== def?.chain && n >= 2) out.push({ key: `store:${chain}`, group: "where", kind: "sometimes", args: { chain, trips: n } });
  const titleOf = (k: string) => history.products.get(k)?.title ?? null;
  const products = [...history.products.values()].sort((a, b) => b.count - a.count);
  // Before Shabbat reads as a habit (steady or not); "with X" only for products that aren't steady; the rest regular.
  for (const p of products) {
    const k = knowledgeOf(p, prefs.get(p.productKey), { baskets, titleOf });
    if (k.state === "hidden" || k.state === "new" || k.state === "learning") continue;
    const c = contextsOf(p, { baskets, titleOf });
    if (c.contexts.includes("shabbat")) out.push({ key: `p:${p.productKey}`, group: "habits", kind: "shabbat", args: { title: p.title } });
    else if (k.state !== "regular" && c.contexts.includes("with") && c.withTitle) out.push({ key: `p:${p.productKey}`, group: "habits", kind: "with", args: { title: p.title, with: c.withTitle } });
    else if (k.state === "regular") out.push({ key: `p:${p.productKey}`, group: "regular", kind: "regular", args: { title: p.title, days: k.intervalDays } });
  }
  // R18 S3 C6: the usual brands ("Milk: usually Tnuva 3%") — each forgettable on its own (`b:<type>`).
  const { usualBrands } = await import("./brands");
  for (const [type, u] of [...(await usualBrands(s))].sort((a, b) => b[1].of - a[1].of)) out.push({ key: `b:${type}`, group: "habits", kind: "brand", args: { type, brand: u.brand, n: u.n, of: u.of } });
  return out;
}

// ---------- C1: what the space told Nexus per product (quiet until, skips in a row, hidden) ----------

type PrefRow = typeof schema.suggestDismiss.$inferSelect;
const prefOf = (r: PrefRow): ProductPref => ({ until: r.until, skips: r.skips, skippedAt: r.skippedAt, hiddenAt: r.hiddenAt });

export async function prefsOf(s: Scoped) {
  return new Map((await s.select(schema.suggestDismiss)).map((r) => [r.productKey, prefOf(r)]));
}

/** The cold-start basket for this home: sized by the onboarding answer; baby / pet items once the home bought some. */
export function basketForHome(history: History, who: string | null | undefined, locale?: string) {
  const sections = new Set([...history.products.values()].map((p) => p.section));
  return basketFor({ who, baby: sections.has("baby"), pets: sections.has("pets"), locale });
}

export async function suggestFor(s: Scoped, o: { now?: number; tz: string; locale?: string; who?: string | null }): Promise<Suggestion[]> {
  const now = o.now ?? Date.now();
  const [{ history, baskets, trips }, list, prefs] = await Promise.all([historyOf(s, o.tz), supermarketList(s), prefsOf(s)]);
  const onList = new Set(list.map((i) => i.productKey).filter((k): k is string => !!k));
  const listTitles = new Map(list.filter((i) => i.productKey).map((i) => [i.productKey!, i.title]));
  return suggest({ history, onList, listTitles, prefs, baskets, now, tz: o.tz, locale: o.locale, basket: basketForHome(history, o.who, o.locale), trips });
}

// ---------- S2 A2: everything the Supermarket tab shows besides the list rows ----------

export type HomeState = {
  stores: (typeof schema.spaceStore.$inferSelect)[];
  /** The main store (null = none chosen yet). */
  store: { chain: string; branch: string } | null;
  /** The list's section order (the main store's confirmed order, else the default). */
  order: SectionKey[];
  suggestions: Suggestion[];
  /** productKey → the last price paid (the estimate on the store chip). */
  prices: Record<string, number>;
  /** What finished trips cost this calendar month (local), for "left this month". */
  monthSpent: number;
  trips: number;
  /** The usual shopping weekday (0 = Sunday) + hour, from ≥ 3 trips on that weekday; null until then. */
  usualDay: { weekday: number; hour: number } | null;
  /** Trips running in this space now (anyone's): the trip bar + the Home card. */
  open: OpenTrip[];
  /** B1: kg per piece for the products on the list / suggested (the home's learned weight, else the fallback). */
  unitKg: Record<string, number>;
  /** D2: finished trips per store ("chain|branch" → count + last), for the picker's recent list. S5 B1: + the usual
   *  minutes there (median of the finished trips; null before 2). */
  visits: Record<string, { trips: number; last: number; minutes: number | null }>;
  /** S4 F3: the home's usual brand per product type (≥ 3 buys, one brand ≥ 60 %) — store mode shows it under a row. */
  brands: Record<string, string>;
};

export type OpenTrip = { id: string; userId: string; chain: string | null; branch: string | null; startedAt: number; planned: number; bought: number; notFound: number; added: number; spent: number };

/** Trips running in the space (≤ 6 h old), each with its counts and what the checked rows cost so far. */
export async function openTripsOf(s: Scoped, now = Date.now()): Promise<OpenTrip[]> {
  const rows = (await s.select(schema.trip, isNull(schema.trip.finishedAt))).filter((t) => now - t.startedAt < 6 * 3_600_000);
  const out: OpenTrip[] = [];
  for (const t of rows) {
    const checks = await s.select(schema.tripCheck, eq(schema.tripCheck.tripId, t.id)).orderBy(asc(schema.tripCheck.seq));
    const r = replayTrip(checks);
    const priceOf = new Map<string, number>();
    for (const c of checks) if (c.price != null) priceOf.set(c.itemId ?? c.productKey ?? "", c.price);
    const spent = r.order.reduce((a, k) => a + (priceOf.get(k) ?? 0), 0);
    out.push({ id: t.id, userId: t.userId, chain: t.chain, branch: t.branch, startedAt: t.startedAt, planned: t.planned, bought: r.bought, notFound: r.notFound, added: r.added, spent });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

export async function homeState(s: Scoped, o: { tz: string; locale?: string; now?: number; who?: string | null }): Promise<HomeState> {
  const now = o.now ?? Date.now();
  const [stores, { purchases, trips, dayTrips, raw }, list, prefs, tripRows] = await Promise.all([
    storesOf(s),
    learningOf(s),
    supermarketList(s),
    prefsOf(s),
    s.pick({ total: schema.trip.total, at: schema.trip.finishedAt, started: schema.trip.startedAt, chain: schema.trip.chain, branch: schema.trip.branch }, schema.trip, isNotNull(schema.trip.finishedAt)),
  ]);
  const open = await openTripsOf(s, now);
  const def = stores.find((x) => x.isDefault) ?? null;
  const history = learnHistory(purchases, dayTrips, { tz: o.tz });
  const visits: Record<string, { trips: number; last: number; minutes: number | null }> = {};
  const spans: Record<string, number[]> = {};
  for (const r of tripRows) {
    if (!r.chain || r.at == null) continue;
    const k = `${r.chain}|${r.branch ?? ""}`;
    visits[k] = { trips: (visits[k]?.trips ?? 0) + 1, last: Math.max(visits[k]?.last ?? 0, r.at), minutes: null };
    // A trip of 2 min – 4 h counts toward the usual time there (a forgotten open trip doesn't).
    const m = (r.at - r.started) / 60_000;
    if (m >= 2 && m <= 240) (spans[k] ??= []).push(m);
  }
  for (const [k, ms] of Object.entries(spans)) if (ms.length >= 2) visits[k].minutes = Math.max(5, Math.round([...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)] / 5) * 5);
  const onList = new Set(list.map((i) => i.productKey).filter((k): k is string => !!k));
  const listTitles = new Map(list.filter((i) => i.productKey).map((i) => [i.productKey!, i.title]));
  const suggestions = suggest({ history, onList, listTitles, prefs, baskets: trips.map((t) => t.keys), now, tz: o.tz, locale: o.locale, basket: basketForHome(history, o.who, o.locale), trips: trips.length });
  const prices: Record<string, number> = {};
  // Prices for the estimate come from every purchase (forgetting is about learning, not about what things cost).
  for (const p of [...raw.purchases].sort((a, b) => a.at - b.at)) if (p.price != null && p.price > 0) prices[p.productKey] = p.price;
  const ym = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: o.tz, year: "numeric", month: "2-digit" }).format(new Date(t));
  const month = ym(now);
  const monthSpent = tripRows.reduce((a, r) => a + (r.at != null && r.total != null && ym(r.at) === month ? r.total : 0), 0);
  const learned = learnUnitWeights(purchases);
  const unitKg: Record<string, number> = {};
  for (const k of [...onList, ...suggestions.map((x) => x.productKey)]) {
    const w = unitKgFor(k, learned);
    if (w != null) unitKg[k] = w;
  }
  const { usualBrands } = await import("./brands");
  const brands = Object.fromEntries([...(await usualBrands(s).catch(() => new Map()))].map(([type, u]) => [type, u.brand]));
  return { stores, store: def ? { chain: def.chain, branch: def.branch } : null, order: tripOrder(def), suggestions, prices, monthSpent, trips: trips.length, usualDay: history.usualDay, open, unitKg, visits, brands };
}

/** When the space last bought this product (trip checks, purchased rows), or null. */
async function lastBought(s: Scoped, productKey: string) {
  const [c] = await s.pick({ at: sql<number>`max(${schema.tripCheck.at})` }, schema.tripCheck, and(eq(schema.tripCheck.productKey, productKey), inArray(schema.tripCheck.action, ["check", "substitute"])));
  const [i] = await s.pick({ at: sql<number>`max(${schema.items.purchasedAt})` }, schema.items, and(SM, eq(schema.items.productKey, productKey), eq(schema.items.status, "purchased")));
  const at = Math.max(Number(c?.at ?? 0), Number(i?.at ?? 0));
  return at || null;
}

/**
 * × "Not this time": quiet until the end of this cycle, and one more skip in a row (a purchase since the last skip starts
 * the count over). 3 in a row → half the rate; 5 → not suggested until bought again (lib/grocery/staples.ts).
 */
export async function dismissSuggestion(s: Scoped, productKey: string, until: number, now = Date.now()) {
  const [cur] = await s.select(schema.suggestDismiss, eq(schema.suggestDismiss.productKey, productKey)).limit(1);
  const skips = activeSkips(cur ? prefOf(cur) : undefined, await lastBought(s, productKey)) + 1;
  await s
    .insert(schema.suggestDismiss, { productKey, until, skips, skippedAt: now })
    .onConflictDoUpdate({ target: [schema.suggestDismiss.spaceId, schema.suggestDismiss.productKey], set: { until, skips, skippedAt: now } });
  return skips;
}

/** "Don't suggest this again" (suggestion menu, item sheet): never suggested until "Suggest it again" in Settings. */
export async function hideProduct(s: Scoped, productKey: string, by: string | null, now = Date.now()) {
  await s
    .insert(schema.suggestDismiss, { productKey, until: 0, hiddenAt: now, hiddenBy: by })
    .onConflictDoUpdate({ target: [schema.suggestDismiss.spaceId, schema.suggestDismiss.productKey], set: { hiddenAt: now, hiddenBy: by } });
}

/** "Suggest it again": back to normal (the skip count starts over too). */
export async function unhideProduct(s: Scoped, productKey: string) {
  await s.update(schema.suggestDismiss, { hiddenAt: null, hiddenBy: null, skips: null, skippedAt: null, until: 0 }, eq(schema.suggestDismiss.productKey, productKey));
}

/** Settings → Supermarket → Products you hid: newest first, named by the home's latest row (else the dictionary). */
export async function hiddenOf(s: Scoped, locale?: string) {
  const rows = (await s.select(schema.suggestDismiss, isNotNull(schema.suggestDismiss.hiddenAt))).sort((a, b) => (b.hiddenAt ?? 0) - (a.hiddenAt ?? 0));
  if (!rows.length) return [];
  const items = await s.select(schema.items, and(SM, inArray(schema.items.productKey, rows.map((r) => r.productKey))));
  return rows.map((r) => {
    const it = items.filter((i) => i.productKey === r.productKey).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const type = TYPE_BY_KEY.get(r.productKey.split(" ")[0]);
    return {
      productKey: r.productKey,
      title: it?.title ?? (type ? (locale === "he" ? type.he : type.en) : r.productKey),
      section: it?.section ?? type?.section ?? "other",
      art: it?.artKey ?? type?.art ?? null,
      hiddenAt: r.hiddenAt!,
      hiddenBy: r.hiddenBy,
    };
  });
}

/** Accept one or all: merged into the list (an existing quantity stays the user's unless it was empty). Breaks a skip run. */
export async function acceptSuggestions(s: Scoped, picks: Pick<Suggestion, "productKey" | "title" | "qty" | "amount" | "unit" | "section" | "art">[], by: string) {
  const out: ItemRow[] = [];
  for (const p of picks) {
    const [cur] = await s.select(schema.items, and(onListCond, eq(schema.items.productKey, p.productKey))).limit(1);
    if (cur) {
      const m = mergeQty({ quantity: cur.quantity, amount: cur.amount }, { qty: p.qty, amount: p.amount });
      if (m.quantity !== cur.quantity || m.amount !== cur.amount) await s.update(schema.items, { quantity: m.quantity, amount: m.amount, updatedAt: Date.now() }, eq(schema.items.id, cur.id));
      out.push((await s.byId(schema.items, cur.id))!);
    } else out.push((await addToList(s, { title: p.title, qty: p.qty, amount: p.amount, unit: (p.unit as Unit | null) ?? null, productKey: p.productKey, section: p.section, art: p.art, by })).item);
  }
  const keys = picks.map((p) => p.productKey);
  if (keys.length) await s.update(schema.suggestDismiss, { skips: null, skippedAt: null }, and(inArray(schema.suggestDismiss.productKey, keys), isNotNull(schema.suggestDismiss.skips)));
  return out;
}

/** C2: "What Nexus learned" about one product of this home. */
export async function knowledgeFor(s: Scoped, productKey: string, tz: string) {
  const [{ history, baskets }, prefs] = await Promise.all([historyOf(s, tz), prefsOf(s)]);
  const p = history.products.get(productKey);
  return knowledgeOf(p, prefs.get(productKey), { baskets, titleOf: (k) => history.products.get(k)?.title ?? null });
}

// ---------- B4: templates; E1: templates made by Nexus ----------

type TemplateRow = typeof schema.template.$inferSelect;
/** What a screen shows: people's templates and kept Nexus ones; a pending Nexus offer separately (never turned-down ones). */
export async function templatesOf(s: Scoped) {
  const all = await s.select(schema.template);
  const shown = all.filter((t) => t.madeBy !== "nexus" || (t.keptAt != null && t.dismissedAt == null));
  shown.sort((a, b) => Number(b.madeBy === "nexus" && !b.editedAt) - Number(a.madeBy === "nexus" && !a.editedAt) || (b.routineTrips ?? 0) - (a.routineTrips ?? 0) || b.createdAt - a.createdAt);
  return shown;
}

/** The newest Nexus routine not kept or turned down yet ("Nexus spotted a new routine"). */
export async function routineOffer(s: Scoped) {
  const rows = await s.select(schema.template, and(eq(schema.template.madeBy, "nexus"), isNull(schema.template.keptAt), isNull(schema.template.dismissedAt)));
  return rows.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export async function createTemplate(s: Scoped, name: string, items: TemplateItem[], by: string | null, now = Date.now()) {
  const id = `tp_${nanoid(12)}`;
  const seen = new Set<string>();
  const clean = items.filter((i) => i.productKey && !seen.has(i.productKey) && seen.add(i.productKey)).slice(0, 200);
  await s.insert(schema.template, { id, name: name.trim().slice(0, 80), items: clean, createdBy: by, createdAt: now, updatedAt: now });
  return s.byId(schema.template, id);
}

/** "Save this trip as a template": what was bought in it (E2: + what wasn't found; quantities kept or left at 1). */
export async function templateFromTrip(s: Scoped, tripId: string, name: string, by: string | null, o: { missed?: boolean; keepQty?: boolean } = {}) {
  const t = (await pastTrips(s)).find((x) => x.id === tripId);
  if (!t) return null;
  const keep = o.keepQty !== false;
  const items: TemplateItem[] = t.items
    .filter((i) => i.state === "bought" || (o.missed && i.state === "not_found"))
    .map((i) => ({ productKey: i.productKey, title: i.title, qty: keep ? i.qty : 1, amount: keep ? i.amount : null, unit: keep ? i.unit : null, section: i.section, art: i.art }));
  return createTemplate(s, name, items, by);
}

/** E2: "Save the current list as a template". */
export async function templateFromList(s: Scoped, name: string, by: string | null) {
  const list = (await supermarketList(s)).filter((i) => i.productKey);
  return createTemplate(s, name, list.map((i) => ({ productKey: i.productKey!, title: i.title, qty: i.quantity, amount: i.amount, unit: i.unit, section: i.section, art: i.artKey })), by);
}

/** E2: rename / change the items — an edited template is the user's (a Nexus one stops following trips for good). */
export async function editTemplate(s: Scoped, id: string, patch: { name?: string; items?: TemplateItem[] }, now = Date.now()) {
  const t = await s.byId(schema.template, id);
  if (!t) return null;
  const seen = new Set<string>();
  const items = patch.items?.filter((i) => i.productKey && !seen.has(i.productKey) && seen.add(i.productKey)).slice(0, 200);
  await s.update(
    schema.template,
    { ...(patch.name != null ? { name: patch.name.trim().slice(0, 80) } : {}), ...(items ? { items } : {}), editedAt: now, updatedAt: now, keptAt: t.keptAt ?? (t.madeBy === "nexus" ? now : null), rev: t.rev + 1 },
    eq(schema.template.id, id),
  );
  return s.byId(schema.template, id);
}

export type PastItem = { productKey: string; title: string; qty: number; amount: number | null; unit: string | null; section: string | null; art: string | null; price: number | null; state: "bought" | "not_found" };
/** E2: finished trips, newest first, with what was bought and what wasn't found. */
export async function pastTrips(s: Scoped, limit = 120) {
  const [{ purchases }, trips, rows] = await Promise.all([purchasesOf(s), finishedTrips(s), s.select(schema.items, SM)]);
  const byId = new Map(rows.map((i) => [i.id, i]));
  const latest = new Map<string, ItemRow>();
  for (const i of rows) if (i.productKey && (latest.get(i.productKey)?.updatedAt ?? -1) < i.updatedAt) latest.set(i.productKey, i);
  return trips
    .reverse()
    .slice(0, limit)
    .map((t) => {
      const items: PastItem[] = purchases.filter((p) => p.tripId === t.id).map((p) => ({ productKey: p.productKey, title: p.title, qty: p.qty ?? 1, amount: p.amount ?? null, unit: p.unit ?? null, section: (p.section as string) ?? null, art: p.art ?? null, price: p.price ?? null, state: "bought" }));
      const bought = new Set(items.map((i) => i.productKey));
      const last = new Map<string, (typeof t.checks)[number]>();
      for (const c of [...t.checks].sort((a, b) => a.seq - b.seq)) if (c.action === "check" || c.action === "uncheck" || c.action === "not_found" || c.action === "substitute") last.set(c.itemId ?? c.productKey ?? "", c);
      for (const c of last.values()) {
        if (c.action !== "not_found") continue;
        const it = (c.itemId ? byId.get(c.itemId) : undefined) ?? (c.productKey ? latest.get(c.productKey) : undefined);
        const key = c.productKey ?? it?.productKey;
        if (!key || bought.has(key)) continue;
        items.push({ productKey: key, title: it?.title ?? key, qty: it?.quantity ?? 1, amount: it?.amount ?? null, unit: it?.unit ?? null, section: c.section ?? it?.section ?? null, art: it?.artKey ?? null, price: null, state: "not_found" });
      }
      return { id: t.id, userId: t.userId, chain: t.chain, branch: t.branch, startedAt: t.startedAt, finishedAt: t.finishedAt ?? t.startedAt, total: t.total, currency: t.currency, receipt: !!t.receiptId, items };
    });
}

/** E2: products back on the list — merge like a template (rows already there keep their quantity). */
export async function addMissing(s: Scoped, items: TemplateItem[], by: string) {
  const list = await supermarketList(s);
  const on = new Set(list.map((i) => i.productKey).filter(Boolean));
  const rows: ItemRow[] = [];
  for (const i of items) {
    if (on.has(i.productKey)) continue;
    on.add(i.productKey);
    rows.push((await addToList(s, { title: i.title, qty: i.qty, amount: i.amount ?? null, unit: (i.unit as Unit | null) ?? null, productKey: i.productKey, section: i.section ?? null, art: i.art ?? null, by })).item);
  }
  return rows;
}

const hiddenKeys = async (s: Scoped) => new Set((await s.select(schema.suggestDismiss, isNotNull(schema.suggestDismiss.hiddenAt))).map((r) => r.productKey));

/** E1: what applying a template would do — new / already on it (stays as it is) / hidden (skipped). */
export async function templatePlan(s: Scoped, id: string) {
  const t = await s.byId(schema.template, id);
  if (!t) return null;
  const [list, hidden] = await Promise.all([supermarketList(s), hiddenKeys(s)]);
  const onList = new Map(list.filter((i) => i.productKey).map((i) => [i.productKey!, i.quantity]));
  return { template: t, lines: applyPlan(t.items, onList, hidden) };
}

/** Apply = merge into the list: never duplicates, rows already there keep the user's quantity, hidden products skipped. */
export async function applyTemplate(s: Scoped, id: string, by: string, now = Date.now()) {
  const plan = await templatePlan(s, id);
  if (!plan) return null;
  const add = plan.lines.filter((l) => l.state === "new");
  const byKey = new Map(plan.template.items.map((i) => [i.productKey, i]));
  const rows: ItemRow[] = [];
  for (const l of add) {
    const i = byKey.get(l.productKey)!;
    rows.push((await addToList(s, { title: i.title, qty: i.qty, amount: i.amount ?? null, unit: (i.unit as Unit | null) ?? null, productKey: i.productKey, section: i.section ?? null, art: i.art ?? null, by })).item);
  }
  await s.update(schema.template, { usedAt: now }, eq(schema.template.id, id));
  return { rows, added: add.length, on: plan.lines.filter((l) => l.state === "on").length, skipped: plan.lines.filter((l) => l.state === "hidden").length };
}

export async function deleteTemplate(s: Scoped, id: string) {
  await s.delete(schema.template, eq(schema.template.id, id));
}

/** E1: keep a Nexus offer (it becomes a template Nexus keeps up to date) or turn it down for good. */
export async function answerRoutine(s: Scoped, id: string, keep: boolean, now = Date.now()) {
  const t = await s.byId(schema.template, id);
  if (!t || t.madeBy !== "nexus") return null;
  await s.update(schema.template, keep ? { keptAt: now, dismissedAt: null } : { dismissedAt: now }, eq(schema.template.id, id));
  return s.byId(schema.template, id);
}

/**
 * E1: find the home's routines and keep the Nexus templates in step — a new routine becomes an offer, a known one (same
 * weekday, items alike) gets the newest items and trip count unless someone edited it (then it's theirs). Hidden products
 * never enter. Runs after every finished trip. Returns the number of new offers.
 */
export async function refreshRoutines(s: Scoped, tz: string, now = Date.now()) {
  const [{ purchases, trips }, hidden, existing] = await Promise.all([learningOf(s), hiddenKeys(s), s.select(schema.template, eq(schema.template.madeBy, "nexus"))]);
  const routines = detectRoutines(trips, tz, hidden);
  const pool = existing.map((t) => ({ row: t, routineDay: t.routineDay, keys: t.items.map((i) => i.productKey) }));
  let offers = 0;
  for (const r of routines) {
    // The routine's items as last bought in its own trips (title, quantity, weight, section).
    const inTrips = new Set(r.tripIds);
    const last = new Map<string, Purchase>();
    for (const p of purchases) if (p.tripId && inTrips.has(p.tripId) && (last.get(p.productKey)?.at ?? -1) < p.at) last.set(p.productKey, p);
    const items: TemplateItem[] = r.keys.map((k) => last.get(k)).filter((p): p is Purchase => !!p).map((p) => ({ productKey: p.productKey, title: p.title, qty: p.qty ?? 1, amount: p.amount ?? null, unit: p.unit ?? null, section: (p.section as string) ?? null, art: p.art ?? null }));
    const match = matchRoutine(r, pool);
    if (match) {
      pool.splice(pool.indexOf(match), 1);
      if (match.row.editedAt != null) continue;
      if (match.row.routineTrips === r.trips && JSON.stringify(match.row.items) === JSON.stringify(items)) continue;
      await s.update(schema.template, { items, routineTrips: r.trips, updatedAt: now, rev: match.row.rev + 1 }, eq(schema.template.id, match.row.id));
      continue;
    }
    await s.insert(schema.template, { id: `tp_${nanoid(12)}`, name: "", items, createdBy: null, createdAt: now, updatedAt: now, madeBy: "nexus", routineDay: r.weekday, routineTrips: r.trips });
    offers++;
  }
  return offers;
}

/** E1: a product hidden after a Nexus template took it — it leaves every Nexus template nobody edited. */
export async function dropFromNexusTemplates(s: Scoped, productKey: string) {
  const rows: TemplateRow[] = await s.select(schema.template, and(eq(schema.template.madeBy, "nexus"), isNull(schema.template.editedAt)));
  for (const t of rows) if (t.items.some((i) => i.productKey === productKey)) await s.update(schema.template, { items: t.items.filter((i) => i.productKey !== productKey) }, eq(schema.template.id, t.id));
}

// ---------- the household's products (C3 type-ahead) ----------

export async function householdProducts(s: Scoped) {
  const rows = await s
    .pick(
      { key: schema.items.productKey, title: sql<string>`max(${schema.items.title})`, n: sql<number>`count(*)`, last: sql<number>`max(coalesce(${schema.items.purchasedAt}, ${schema.items.createdAt}))`, section: sql<string>`max(${schema.items.section})`, art: sql<string | null>`max(${schema.items.artKey})` },
      schema.items,
      and(SM, isNotNull(schema.items.productKey)),
    )
    .groupBy(schema.items.productKey);
  return rows.map((r) => ({ productKey: String(r.key), title: r.title, count: Number(r.n), lastAt: Number(r.last), section: (r.section ?? "other") as never, art: r.art ?? null }));
}

/** Rows of the list by id (the outbox's merge). */
export async function listRows(s: Scoped, ids: string[]) {
  if (!ids.length) return [];
  return s.select(schema.items, and(SM, inArray(schema.items.id, ids)));
}

export const DAY_MS = DAY;

// ---------- S2 C2: the item sheet ----------

/** One product's purchases (newest first, ≤ 8) with the store and price, and the cheapest store seen. */
export async function productHistory(s: Scoped, productKey: string) {
  const { purchases } = await purchasesOf(s);
  const mine = purchases.filter((p) => p.productKey === productKey).sort((a, b) => b.at - a.at);
  const priced = mine.filter((p) => p.price != null && p.price > 0);
  const cheapest = priced.length ? priced.reduce((a, b) => (b.price! < a.price! ? b : a)) : null;
  return {
    rows: mine.slice(0, 8).map((p) => ({ at: p.at, chain: p.chain ?? null, branch: p.branch ?? null, price: p.price ?? null })),
    cheapest: cheapest ? { chain: cheapest.chain ?? null, branch: cheapest.branch ?? null, price: cheapest.price! } : null,
  };
}
