import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schema } from "@/db";
import { classifyLocal } from "@/lib/grocery/classify";
import { learnOrder } from "@/lib/grocery/order";
import { cleanOrder, DEFAULT_ORDER, tripOrder, type SectionKey } from "@/lib/grocery/sections";
import { activeSkips, knowledgeOf, learnHistory, mergeQty, suggest, type History, type ProductPref, type Purchase, type Suggestion } from "@/lib/grocery/staples";
import { basketFor } from "@/lib/grocery/basket";
import { TYPE_BY_KEY } from "@/lib/grocery/dictionary";
import { replayTrip } from "@/lib/grocery/trip";
import { learnUnitWeights, unitKgFor } from "@/lib/grocery/weights";
import type { Unit } from "@/lib/grocery/dictionary";
import type { TemplateItem } from "@/db/schema";
import { finishedTrips } from "./trips";
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

const unitLabel = (amount: number, unit: string) => `${Math.round(amount * 1000) / 1000} ${unit === "l" ? "L" : unit}`;

/**
 * Add to the supermarket list. Same product already to buy → its quantity / amount grows instead of a new row
 * (`merged`, `before` for Undo). Different units of one product → one row; the second amount is noted.
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
    const patch: Partial<ItemRow> = { updatedAt: now };
    // B1: pieces add up on their own; a count-only add never touches the weight or the packs.
    if (count != null) patch.count = (cur.count ?? 0) + count;
    if (count != null && !unit) {
      // the count was the whole add
    } else if (!unit && !cur.unit) patch.quantity = cur.quantity + qty;
    else if (unit && cur.unit === unit) patch.amount = Math.round(((cur.amount ?? 0) + (amount ?? 0)) * 1000) / 1000;
    else {
      // Different units: keep one row, note the second amount ("+ 2 kg" / "+ ×3").
      const extra = unit && amount ? `+ ${unitLabel(amount, unit)}` : `+ ×${qty}`;
      patch.notes = [cur.notes, extra].filter(Boolean).join(" · ").slice(0, 500);
    }
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

export async function historyOf(s: Scoped, tz: string): Promise<{ history: History; baskets: Set<string>[]; trips: number }> {
  const { purchases, trips } = await purchasesOf(s);
  return { history: learnHistory(purchases, trips, { tz }), baskets: trips.map((t) => t.keys), trips: trips.length };
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
  const [stores, { purchases, trips }, list, prefs, tripRows] = await Promise.all([
    storesOf(s),
    purchasesOf(s),
    supermarketList(s),
    prefsOf(s),
    s.pick({ total: schema.trip.total, at: schema.trip.finishedAt }, schema.trip, isNotNull(schema.trip.finishedAt)),
  ]);
  const open = await openTripsOf(s, now);
  const def = stores.find((x) => x.isDefault) ?? null;
  const history = learnHistory(purchases, trips, { tz: o.tz });
  const onList = new Set(list.map((i) => i.productKey).filter((k): k is string => !!k));
  const listTitles = new Map(list.filter((i) => i.productKey).map((i) => [i.productKey!, i.title]));
  const suggestions = suggest({ history, onList, listTitles, prefs, baskets: trips.map((t) => t.keys), now, tz: o.tz, locale: o.locale, basket: basketForHome(history, o.who, o.locale), trips: trips.length });
  const prices: Record<string, number> = {};
  for (const p of [...purchases].sort((a, b) => a.at - b.at)) if (p.price != null && p.price > 0) prices[p.productKey] = p.price;
  const ym = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: o.tz, year: "numeric", month: "2-digit" }).format(new Date(t));
  const month = ym(now);
  const monthSpent = tripRows.reduce((a, r) => a + (r.at != null && r.total != null && ym(r.at) === month ? r.total : 0), 0);
  const learned = learnUnitWeights(purchases);
  const unitKg: Record<string, number> = {};
  for (const k of [...onList, ...suggestions.map((x) => x.productKey)]) {
    const w = unitKgFor(k, learned);
    if (w != null) unitKg[k] = w;
  }
  return { stores, store: def ? { chain: def.chain, branch: def.branch } : null, order: tripOrder(def), suggestions, prices, monthSpent, trips: trips.length, usualDay: history.usualDay, open, unitKg };
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

// ---------- B4: templates ----------

export async function templatesOf(s: Scoped) {
  return s.select(schema.template).orderBy(desc(schema.template.createdAt));
}

export async function createTemplate(s: Scoped, name: string, items: TemplateItem[], by: string | null, now = Date.now()) {
  const id = `tp_${nanoid(12)}`;
  const seen = new Set<string>();
  const clean = items.filter((i) => i.productKey && !seen.has(i.productKey) && seen.add(i.productKey)).slice(0, 200);
  await s.insert(schema.template, { id, name: name.trim().slice(0, 80), items: clean, createdBy: by, createdAt: now });
  return s.byId(schema.template, id);
}

/** "Save this trip as a template": what was bought in it. */
export async function templateFromTrip(s: Scoped, tripId: string, name: string, by: string | null) {
  const trip = await s.byId(schema.trip, tripId);
  if (!trip) return null;
  const { purchases } = await purchasesOf(s);
  const items: TemplateItem[] = purchases.filter((p) => p.tripId === tripId).map((p) => ({ productKey: p.productKey, title: p.title, qty: p.qty ?? 1, amount: p.amount ?? null, unit: p.unit ?? null, section: (p.section as string) ?? null }));
  return createTemplate(s, name, items, by);
}

/** Apply = merge into the list: never duplicates; existing quantities stay the user's. */
export async function applyTemplate(s: Scoped, id: string, by: string) {
  const t = await s.byId(schema.template, id);
  if (!t) return null;
  return acceptSuggestions(s, t.items.map((i) => ({ productKey: i.productKey, title: i.title, qty: i.qty, amount: i.amount ?? null, unit: i.unit ?? null, section: i.section ?? "other", art: null })), by);
}

export async function deleteTemplate(s: Scoped, id: string) {
  await s.delete(schema.template, eq(schema.template.id, id));
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
