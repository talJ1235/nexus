"use server";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import { requireCtx, AccessError } from "@/lib/ctx";
import { scoped, type Scoped } from "@/lib/db-scoped";
import * as G from "@/lib/db-scoped/grocery";
import * as T from "@/lib/db-scoped/trips";
import { userPrefSet } from "@/lib/db-scoped/prefs";
import { kvGet, kvSet } from "@/lib/kv";
import { noteActivity } from "@/lib/activity";
import { aiUseOf } from "@/lib/ai-gate";
import { classifyUnknown, fromAi } from "@/lib/grocery/classify-server";
import { splitList } from "@/lib/grocery/parse";
import { DRAFT_PREF_KEY } from "@/lib/notify/kinds";
import { notifyPrefs } from "@/lib/notify/enqueue";
import { mergeOps } from "@/lib/db-scoped/trip-sync";
import type { TripOp } from "@/lib/grocery/trip";

// R18 S1 — the supermarket's server actions (engines only; S2 builds the screens on them). Every action starts with
// requireCtx (test:authz-coverage); data goes through the scoped layer. Viewers read; members and owners write.

const Title = z.string().trim().min(1).max(300);
const Key = z.string().trim().min(1).max(160);
const Unit = z.enum(["u", "kg", "g", "l"]).nullable().optional();
const Qty = z.number().int().min(1).max(999).optional();
const Amount = z.number().positive().max(100_000).nullable().optional();
const Id = z.string().min(1).max(64);
const Store = z.string().trim().min(1).max(80);
const Branch = z.string().trim().max(120);

/** Unknown lines (section `other`) get one batched AI answer after the response; the section is fixed when it arrives. */
function classifyAfter(s: Scoped, rows: { id: string; title: string; section: string | null; gtin: string | null }[]) {
  const unknown = rows.filter((r) => r.section === "other");
  if (!unknown.length) return;
  const run = async () => {
    const answers = await classifyUnknown(unknown.map((r) => r.title), aiUseOf(s, "grocery"));
    for (const r of unknown) {
      const a = answers.get(r.title.trim());
      if (!a || a.section === "other") continue;
      const c = fromAi(r.title, a, r.gtin);
      await G.setSectionIfOther(s, r.id, c.section, c.art);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

/** A row added while someone else shops here reaches them live (D2). */
function announceAdd(s: Scoped, userId: string, rows: { id: string; title: string; productKey: string | null; section: string | null }[]) {
  if (!rows.length) return;
  noteActivity({ userId, spaceId: s.spaceId }, "items_added", rows.length);
  const run = async () => {
    const { liveAdd } = await import("@/lib/notify/senders");
    await liveAdd(userId, s.spaceId, rows.map((r) => ({ itemId: r.id, title: r.title, productKey: r.productKey, section: r.section }))).catch(() => 0);
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

// ---------- C2: add with merge, undo ----------

const AddZ = z.object({ title: Title, qty: Qty, amount: Amount, unit: Unit, gtin: z.string().regex(/^\d{8,14}$/).nullish(), productKey: Key.nullish(), notes: z.string().max(500).nullish() }).strict();

/** Add to the supermarket list. Already there (to buy) → its quantity grows: `{ merged: true, now }` for the toast + Undo. */
export async function addToSupermarket(input: z.input<typeof AddZ>) {
  const ctx = await requireCtx("edit");
  const i = AddZ.parse(input);
  const s = scoped(ctx);
  const r = await G.addToList(s, { ...i, unit: i.unit ?? null, by: ctx.user.id });
  if (!r.merged) {
    classifyAfter(s, [r.item]);
    announceAdd(s, ctx.user.id, [r.item]);
  }
  return { item: r.item, merged: r.merged, before: r.before, now: { quantity: r.item.quantity, amount: r.item.amount, unit: r.item.unit, notes: r.item.notes } };
}

const BeforeZ = z.object({ quantity: z.number().int().min(0).max(9999), amount: z.number().nullable(), unit: z.string().nullable(), notes: z.string().max(500).nullable() }).strict();

/** Undo of a merge toast: the old quantity comes back. Undo of a new row: it goes. */
export async function undoSupermarketAdd(itemId: string, before: z.input<typeof BeforeZ> | null) {
  const ctx = await requireCtx("edit");
  const s = scoped(ctx);
  const id = Id.parse(itemId);
  const item = await s.byId(schema.items, id);
  if (!item || item.list !== "supermarket") throw new AccessError("not_found");
  if (before) return { item: await G.undoMerge(s, id, BeforeZ.parse(before)) };
  await s.delete(schema.items, and(eq(schema.items.id, id), eq(schema.items.list, "supermarket")));
  return { item: null };
}

// ---------- C4: split a paste / a voice line (preview), then add the picked parts ----------

export async function previewSplit(text: string) {
  const ctx = await requireCtx("view");
  const t = z.string().max(5000).parse(text);
  const list = await G.supermarketList(scoped(ctx));
  return splitList(t, list.map((i) => i.productKey).filter((k): k is string => !!k));
}

const PartsZ = z.array(z.object({ title: Title, qty: Qty, amount: Amount, unit: Unit, note: z.boolean().optional() }).strict()).max(60);

/** Add the checked parts of a split preview (merging like a single add); notes go on the list as text-only rows. */
export async function addParts(parts: z.input<typeof PartsZ>) {
  const ctx = await requireCtx("edit");
  const s = scoped(ctx);
  const out: G.AddResult[] = [];
  for (const p of PartsZ.parse(parts)) out.push(await G.addToList(s, { title: p.title, qty: p.qty, amount: p.amount, unit: p.unit ?? null, by: ctx.user.id, ...(p.note ? { productKey: `note:${p.title.toLowerCase().slice(0, 100)}`, section: "other" } : {}) }));
  const fresh = out.filter((r) => !r.merged).map((r) => r.item);
  classifyAfter(s, fresh);
  announceAdd(s, ctx.user.id, fresh);
  return out.map((r) => ({ item: r.item, merged: r.merged, before: r.before }));
}

// ---------- B2: suggestions ----------

/** `locale` = the reader's language (holiday products are named in it). */
export async function supermarketSuggestions(locale?: "he" | "en") {
  const ctx = await requireCtx("view");
  const { tz } = await notifyPrefs(ctx.user.id);
  return G.suggestFor(scoped(ctx), { tz, locale: z.enum(["he", "en"]).optional().parse(locale) });
}

const PickZ = z.object({ productKey: Key, title: Title, qty: z.number().int().min(1).max(999), amount: z.number().nullable(), unit: z.string().max(4).nullable(), section: z.string().max(20), art: z.string().max(20).nullable() }).strip();

export async function acceptSuggestions(picks: z.input<typeof PickZ>[]) {
  const ctx = await requireCtx("edit");
  const list = z.array(PickZ).max(60).parse(picks);
  noteActivity({ userId: ctx.user.id, spaceId: ctx.space.id }, "suggest_accepted", list.length);
  return G.acceptSuggestions(scoped(ctx), list, ctx.user.id);
}

export async function dismissSuggestion(productKey: string, until: number) {
  const ctx = await requireCtx("edit");
  const u = z.number().int().min(Date.now()).max(Date.now() + 120 * 86_400_000).parse(until);
  await G.dismissSuggestion(scoped(ctx), Key.parse(productKey), u);
  noteActivity({ userId: ctx.user.id, spaceId: ctx.space.id }, "suggest_dismissed");
}

export async function undoAutoStaple(productKey: string, dueDay: string) {
  const ctx = await requireCtx("edit");
  return G.undoStapleAdd(scoped(ctx), Key.parse(productKey), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(dueDay));
}

export async function setStaple(itemId: string, staple: "off" | "suggest" | "auto") {
  const ctx = await requireCtx("edit");
  const s = scoped(ctx);
  const id = Id.parse(itemId);
  const it = await s.byId(schema.items, id);
  if (!it || it.list !== "supermarket") throw new AccessError("not_found");
  await s.update(schema.items, { staple: z.enum(["off", "suggest", "auto"]).parse(staple), updatedAt: Date.now() }, eq(schema.items.id, id));
  return s.byId(schema.items, id);
}

/** B3: the evening-before draft push on / off (Settings → Supermarket in S2). */
export async function setDraftPush(on: boolean) {
  const ctx = await requireCtx("view");
  await userPrefSet(ctx.user.id, DRAFT_PREF_KEY, z.boolean().parse(on) ? null : "off");
}

/** The draft computed for tomorrow (opened by /supermarket?draft=1). */
export async function eveningDraft(day: string) {
  const ctx = await requireCtx("view");
  const { draftOf } = await import("@/lib/notify/senders");
  return draftOf(ctx.space.id, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(day));
}

// ---------- B4: templates ----------

export async function supermarketTemplates() {
  const ctx = await requireCtx("view");
  return G.templatesOf(scoped(ctx));
}

const TItemZ = z.object({ productKey: Key, title: Title, qty: z.number().int().min(1).max(999), amount: z.number().nullable().optional(), unit: z.string().max(4).nullable().optional(), section: z.string().max(20).nullable().optional() }).strict();

export async function createSupermarketTemplate(name: string, items: z.input<typeof TItemZ>[]) {
  const ctx = await requireCtx("edit");
  return G.createTemplate(scoped(ctx), z.string().trim().min(1).max(80).parse(name), z.array(TItemZ).max(200).parse(items), ctx.user.id);
}

export async function saveTripAsTemplate(tripId: string, name: string) {
  const ctx = await requireCtx("edit");
  const t = await G.templateFromTrip(scoped(ctx), Id.parse(tripId), z.string().trim().min(1).max(80).parse(name), ctx.user.id);
  if (!t) throw new AccessError("not_found");
  return t;
}

export async function applySupermarketTemplate(id: string) {
  const ctx = await requireCtx("edit");
  const r = await G.applyTemplate(scoped(ctx), Id.parse(id), ctx.user.id);
  if (!r) throw new AccessError("not_found");
  return r;
}

export async function deleteSupermarketTemplate(id: string) {
  const ctx = await requireCtx("edit");
  await G.deleteTemplate(scoped(ctx), Id.parse(id));
}

// ---------- A3 / A5: stores and the section order ----------

export async function supermarketStores() {
  const ctx = await requireCtx("view");
  return G.storesOf(scoped(ctx));
}

export async function saveSupermarketStore(chain: string, branch: string, isDefault: boolean) {
  const ctx = await requireCtx("edit");
  return G.saveStore(scoped(ctx), Store.parse(chain), Branch.parse(branch), { isDefault: z.boolean().parse(isDefault) });
}

export async function setSectionOrder(chain: string, branch: string, order: string[] | null) {
  const ctx = await requireCtx("edit");
  await G.confirmOrder(scoped(ctx), Store.parse(chain), Branch.parse(branch), z.array(z.string().max(20)).max(20).nullable().parse(order));
}

export async function dismissSectionOrder(chain: string, branch: string) {
  const ctx = await requireCtx("edit");
  await G.dismissOrder(scoped(ctx), Store.parse(chain), Branch.parse(branch));
}

// ---------- A2 / D1: trips ----------

/** Start shopping (S2's Start button; the presence beat does the same for R17's shopping mode). */
export async function startSupermarketTrip(o: { chain?: string | null; branch?: string | null; planned?: number }) {
  const ctx = await requireCtx("edit");
  const i = z.object({ chain: Store.nullish(), branch: Branch.nullish(), planned: z.number().int().min(0).max(999).optional() }).strict().parse(o);
  const { tripStarted } = await import("@/lib/notify/senders");
  await tripStarted(ctx.user.id, ctx.space.id, i.planned ?? null, Date.now(), i.chain ? { chain: i.chain, branch: i.branch ?? "" } : undefined);
  return T.openTripOf(ctx.user.id);
}

export async function finishSupermarketTrip(total: number | null) {
  const ctx = await requireCtx("edit");
  const t = await T.openTripOf(ctx.user.id);
  if (!t || t.spaceId !== ctx.space.id) throw new AccessError("not_found");
  const s = scoped(ctx);
  if (total != null) await s.update(schema.trip, { total: z.number().min(0).max(1_000_000).parse(total) }, eq(schema.trip.id, t.id));
  const { tripFinished } = await import("@/lib/notify/senders");
  await tripFinished(ctx.user.id, null);
  return T.tripById(s, t.id);
}

const OpZ = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(["check", "uncheck", "not_found", "substitute", "qty", "price", "add", "note"]),
    itemId: Id.optional(),
    clientId: z.string().min(1).max(64).optional(),
    title: Title.optional(),
    productKey: Key.optional(),
    qty: z.number().int().min(1).max(999).optional(),
    amount: z.number().positive().max(100_000).nullable().optional(),
    unit: Unit,
    price: z.number().min(0).max(100_000).optional(),
    notes: z.string().max(500).nullable().optional(),
    rev: z.number().int().min(0).optional(),
    at: z.number().int().min(0),
  })
  .strict();

/**
 * D1: the outbox of a trip, sent when back online. The server merges per field: a check never touches the note, two
 * people checking the same row = one check, an edit made later by someone else wins, adds merge by product key (an add
 * made offline is applied once, by its client id).
 */
export async function syncTripOps(ops: z.input<typeof OpZ>[]) {
  const ctx = await requireCtx("edit");
  const list = z.array(OpZ).max(300).parse(ops);
  const s = scoped(ctx);
  const trip = await T.openTripOf(ctx.user.id);
  const r = await mergeOps(s, ctx.user.id, trip && trip.spaceId === ctx.space.id ? trip : null, list as TripOp[], { seen: (k) => kvGet(`sm:op:${ctx.space.id}:${k}`), mark: (k, v) => kvSet(`sm:op:${ctx.space.id}:${k}`, v) });
  classifyAfter(s, r.added);
  announceAdd(s, ctx.user.id, r.added);
  return { applied: r.applied, skipped: r.skipped, idMap: r.idMap, items: r.items };
}
