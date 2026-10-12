import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schema } from "@/db";
import { classifyLocal } from "@/lib/grocery/classify";
import { learnOrder } from "@/lib/grocery/order";
import { cleanOrder, DEFAULT_ORDER, tripOrder, type SectionKey } from "@/lib/grocery/sections";
import { dueStaples, learnHistory, mergeQty, suggest, type History, type Purchase, type Suggestion } from "@/lib/grocery/staples";
import { replayTrip } from "@/lib/grocery/trip";
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
  gtin?: string | null;
  productKey?: string | null;
  section?: string | null;
  art?: string | null;
  notes?: string | null;
  /** Who added it (null = Nexus: an auto staple). */
  by: string | null;
  byName?: string | null;
};
export type Before = { quantity: number; amount: number | null; unit: string | null; notes: string | null };
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
  const [cur] = await s.select(schema.items, and(onListCond, eq(schema.items.productKey, productKey))).orderBy(asc(schema.items.createdAt)).limit(1);
  if (cur) {
    const before: Before = { quantity: cur.quantity, amount: cur.amount, unit: cur.unit, notes: cur.notes };
    const patch: Partial<ItemRow> = { updatedAt: now };
    if (!unit && !cur.unit) patch.quantity = cur.quantity + qty;
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
    quantity: qty,
    amount,
    unit,
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
  await s.update(schema.items, { quantity: before.quantity, amount: before.amount, unit: before.unit as Unit | null, notes: before.notes, updatedAt: Date.now() }, eq(schema.items.id, itemId));
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
        title: it?.title ?? productKey,
        at: last.at,
        qty: qtyc?.qty ?? it?.quantity ?? 1,
        amount: qtyc?.amount ?? it?.amount ?? null,
        unit: qtyc?.unit ?? it?.unit ?? null,
        price: priced?.price ?? null,
        chain: t.chain,
        branch: t.branch,
        section: last.section ?? it?.section ?? null,
        art: it?.artKey ?? null,
        tripId: t.id,
      });
    }
    tripsOut.push({ id: t.id, startedAt: t.startedAt, keys });
  }
  for (const it of items.values()) {
    if (it.status !== "purchased" || seenItems.has(it.id) || !it.productKey) continue;
    purchases.push({ productKey: it.productKey, title: it.title, at: it.purchasedAt ?? it.updatedAt, qty: it.quantity, amount: it.amount, unit: it.unit, price: it.purchasedPrice, section: it.section, art: it.artKey, tripId: null });
  }
  return { purchases, trips: tripsOut };
}

export async function staplesOf(s: Scoped) {
  const rows = await s.pick({ k: schema.items.productKey, st: schema.items.staple }, schema.items, and(SM, isNotNull(schema.items.productKey)));
  const m = new Map<string, string>();
  for (const r of rows) if (r.k && r.st !== "off") m.set(r.k, r.st);
  return m;
}

export async function historyOf(s: Scoped, tz: string): Promise<{ history: History; baskets: Set<string>[] }> {
  const { purchases, trips } = await purchasesOf(s);
  return { history: learnHistory(purchases, trips, { tz, staples: await staplesOf(s) }), baskets: trips.map((t) => t.keys) };
}

// ---------- B2: suggestions ----------

export async function dismissedOf(s: Scoped, now = Date.now()) {
  const rows = await s.select(schema.suggestDismiss);
  return new Map(rows.filter((r) => r.until > now).map((r) => [r.productKey, r.until]));
}

export async function suggestFor(s: Scoped, o: { now?: number; tz: string; locale?: string }): Promise<Suggestion[]> {
  const now = o.now ?? Date.now();
  const [{ history, baskets }, list, dismissed, staples] = await Promise.all([historyOf(s, o.tz), supermarketList(s), dismissedOf(s, now), staplesOf(s)]);
  const onList = new Set(list.map((i) => i.productKey).filter((k): k is string => !!k));
  const listTitles = new Map(list.filter((i) => i.productKey).map((i) => [i.productKey!, i.title]));
  return suggest({ history, onList, listTitles, dismissed, staples, baskets, now, tz: o.tz, locale: o.locale });
}

/** "Not now": quiet until the end of this cycle. */
export async function dismissSuggestion(s: Scoped, productKey: string, until: number) {
  await s.insert(schema.suggestDismiss, { productKey, until }).onConflictDoUpdate({ target: [schema.suggestDismiss.spaceId, schema.suggestDismiss.productKey], set: { until } });
}

/** Accept one or all: merged into the list (an existing quantity stays the user's unless it was empty). */
export async function acceptSuggestions(s: Scoped, picks: Pick<Suggestion, "productKey" | "title" | "qty" | "amount" | "unit" | "section" | "art">[], by: string) {
  const out: ItemRow[] = [];
  for (const p of picks) {
    const [cur] = await s.select(schema.items, and(onListCond, eq(schema.items.productKey, p.productKey))).limit(1);
    if (cur) {
      const m = mergeQty({ quantity: cur.quantity, amount: cur.amount }, { qty: p.qty, amount: p.amount });
      if (m.quantity !== cur.quantity || m.amount !== cur.amount) await s.update(schema.items, { quantity: m.quantity, amount: m.amount, updatedAt: Date.now() }, eq(schema.items.id, cur.id));
      out.push((await s.byId(schema.items, cur.id))!);
      continue;
    }
    const r = await addToList(s, { title: p.title, qty: p.qty, amount: p.amount, unit: (p.unit as Unit | null) ?? null, productKey: p.productKey, section: p.section, art: p.art, by });
    out.push(r.item);
  }
  return out;
}

/** `auto` staples due today → added by Nexus, once per product per due day (undoable). Returns the added items. */
export async function addDueStaples(s: Scoped, o: { now?: number; tz: string }) {
  const now = o.now ?? Date.now();
  const [{ history }, staples, list] = await Promise.all([historyOf(s, o.tz), staplesOf(s), supermarketList(s)]);
  const onList = new Set(list.map((i) => i.productKey).filter((k): k is string => !!k));
  const added: { item: ItemRow; dueDay: string; reasonArgs: { days: number } }[] = [];
  for (const d of dueStaples(history, staples, onList, now, o.tz)) {
    const [done] = await s.select(schema.stapleAdd, and(eq(schema.stapleAdd.productKey, d.product.productKey), eq(schema.stapleAdd.dueDay, d.dueDay))).limit(1);
    if (done) continue;
    const r = await addToList(s, { title: d.product.title, qty: d.product.usualQty, amount: d.product.usualAmount, unit: (d.product.unit as Unit | null) ?? null, productKey: d.product.productKey, section: d.product.section, art: d.product.art, by: null }, now);
    await s.insert(schema.stapleAdd, { productKey: d.product.productKey, dueDay: d.dueDay, itemId: r.item.id, at: now }).onConflictDoNothing();
    added.push({ item: r.item, dueDay: d.dueDay, reasonArgs: { days: d.product.intervalDays ?? 0 } });
  }
  return added;
}

/** Undo an auto staple: the row goes (if still untouched on the list); the day stays marked so it isn't re-added. */
export async function undoStapleAdd(s: Scoped, productKey: string, dueDay: string, now = Date.now()) {
  const [r] = await s.select(schema.stapleAdd, and(eq(schema.stapleAdd.productKey, productKey), eq(schema.stapleAdd.dueDay, dueDay))).limit(1);
  if (!r || r.undoneAt) return false;
  if (r.itemId) await s.delete(schema.items, and(eq(schema.items.id, r.itemId), onListCond));
  await s.update(schema.stapleAdd, { undoneAt: now }, and(eq(schema.stapleAdd.productKey, productKey), eq(schema.stapleAdd.dueDay, dueDay)));
  return true;
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
