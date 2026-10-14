"use server";
import { after } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import { requireCtx, AccessError } from "@/lib/ctx";
import { scoped, type Scoped } from "@/lib/db-scoped";
import * as G from "@/lib/db-scoped/grocery";
import * as T from "@/lib/db-scoped/trips";
import { userPrefGet, userPrefSet } from "@/lib/db-scoped/prefs";
import { ONBOARDING_KEY, parseOnboarding } from "@/lib/onboarding";
import { kvGet, kvSet } from "@/lib/kv";
import { noteActivity } from "@/lib/activity";
import { aiAllowance, aiGate, aiUse, aiUseOf, recordAiUsage } from "@/lib/ai-gate";
import { generateJson } from "@/lib/ai";
import { mockAi } from "@/lib/assistant";
import { classifyBarcode } from "@/lib/barcode";
import { classifyLocal } from "@/lib/grocery/classify";
import { typeAhead } from "@/lib/grocery/search";
import { classifyUnknown, fromAi } from "@/lib/grocery/classify-server";
import { splitList } from "@/lib/grocery/parse";
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
    let moved = 0;
    for (const r of unknown) {
      const a = answers.get(r.title.trim());
      if (!a || a.section === "other") continue;
      const c = fromAi(r.title, a, r.gtin);
      await G.setSectionIfOther(s, r.id, c.section, c.art);
      moved++;
    }
    // R18 S2 G1: this runs after the response — the action's one live-sync message has gone already, so tell the open
    // lists again (the row settles into its section for everyone, the adder included).
    if (moved) {
      const { publishNow } = await import("@/lib/realtime/publish");
      await publishNow(s.spaceId, s.actor);
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

const Count = z.number().int().min(1).max(999).nullish();
const AddZ = z.object({ title: Title, qty: Qty, amount: Amount, unit: Unit, count: Count, section: z.string().max(20).nullish(), gtin: z.string().regex(/^\d{8,14}$/).nullish(), productKey: Key.nullish(), notes: z.string().max(500).nullish() }).strict();

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
  return { item: r.item, merged: r.merged, before: r.before, now: { quantity: r.item.quantity, amount: r.item.amount, unit: r.item.unit, notes: r.item.notes, count: r.item.count } };
}

const BeforeZ = z.object({ quantity: z.number().int().min(0).max(9999), amount: z.number().nullable(), unit: z.string().nullable(), notes: z.string().max(500).nullable(), count: z.number().int().min(0).max(9999).nullish() }).strict();

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

const PartsZ = z.array(z.object({ title: Title, qty: Qty, amount: Amount, unit: Unit, count: Count, note: z.boolean().optional() }).strict()).max(60);

/** Add the checked parts of a split preview (merging like a single add); notes go on the list as text-only rows. */
export async function addParts(parts: z.input<typeof PartsZ>) {
  const ctx = await requireCtx("edit");
  const s = scoped(ctx);
  const out: G.AddResult[] = [];
  for (const p of PartsZ.parse(parts)) out.push(await G.addToList(s, { title: p.title, qty: p.qty, amount: p.amount, unit: p.unit ?? null, count: p.count ?? null, by: ctx.user.id, ...(p.note ? { productKey: `note:${p.title.toLowerCase().slice(0, 100)}`, section: "other" } : {}) }));
  const fresh = out.filter((r) => !r.merged).map((r) => r.item);
  classifyAfter(s, fresh);
  announceAdd(s, ctx.user.id, fresh);
  return out.map((r) => ({ item: r.item, merged: r.merged, before: r.before }));
}

// ---------- S2 A2: the Supermarket tab ----------

const SM_LAYOUT_KEY = "pref:sm-layout";

/** The onboarding "who" answer (me / partner / family) — sizes the cold-start basket. */
async function whoOf(userId: string) {
  return parseOnboarding(await userPrefGet(userId, ONBOARDING_KEY))?.who ?? null;
}

/** Store chip, section order, suggestions, prices for the estimate, this month's trips, the person's rows/tiles. */
export async function supermarketHome(locale?: "he" | "en") {
  const ctx = await requireCtx("view");
  const { tz } = await notifyPrefs(ctx.user.id);
  const who = await whoOf(ctx.user.id);
  const [state, layout, offer] = await Promise.all([G.homeState(scoped(ctx), { tz, locale: z.enum(["he", "en"]).optional().parse(locale), who }), userPrefGet(ctx.user.id, SM_LAYOUT_KEY), G.routineOffer(scoped(ctx))]);
  // E1: the routine Nexus spotted (kept / turned down ones don't come back).
  const routine = offer ? { id: offer.id, day: offer.routineDay ?? 0, trips: offer.routineTrips ?? 0, items: offer.items.length } : null;
  return { ...state, layout: layout === "tiles" ? ("tiles" as const) : ("rows" as const), routine };
}

/** Rows or tiles — remembered per person (the list's ⋯ menu, never in Settings). */
export async function setSupermarketLayout(layout: "rows" | "tiles") {
  const ctx = await requireCtx("view");
  await userPrefSet(ctx.user.id, SM_LAYOUT_KEY, z.enum(["rows", "tiles"]).parse(layout) === "tiles" ? "tiles" : null);
}

// ---------- B2: suggestions ----------

/** `locale` = the reader's language (holiday products are named in it). */
export async function supermarketSuggestions(locale?: "he" | "en") {
  const ctx = await requireCtx("view");
  const [{ tz }, who] = await Promise.all([notifyPrefs(ctx.user.id), whoOf(ctx.user.id)]);
  return G.suggestFor(scoped(ctx), { tz, locale: z.enum(["he", "en"]).optional().parse(locale), who });
}

const PickZ = z.object({ productKey: Key, title: Title, qty: z.number().int().min(1).max(999), amount: z.number().nullable(), unit: z.string().max(4).nullable(), section: z.string().max(20), art: z.string().max(20).nullable() }).strip();

export async function acceptSuggestions(picks: z.input<typeof PickZ>[]) {
  const ctx = await requireCtx("edit");
  const list = z.array(PickZ).max(60).parse(picks);
  noteActivity({ userId: ctx.user.id, spaceId: ctx.space.id }, "suggest_accepted", list.length);
  return G.acceptSuggestions(scoped(ctx), list, ctx.user.id);
}

/** × "Not this time": quiet for this cycle + one more skip in a row (3 → half the rate, 5 → until bought again). */
export async function dismissSuggestion(productKey: string, until: number) {
  const ctx = await requireCtx("edit");
  const u = z.number().int().min(Date.now()).max(Date.now() + 120 * 86_400_000).parse(until);
  const skips = await G.dismissSuggestion(scoped(ctx), Key.parse(productKey), u);
  noteActivity({ userId: ctx.user.id, spaceId: ctx.space.id }, "suggest_dismissed");
  return { skips };
}

// ---------- C1: "Don't suggest this again" and what Nexus learned ----------

/** "Don't suggest this again" (the suggestion's menu, the item sheet). Viewers can't (edit). */
export async function hideProduct(productKey: string) {
  const ctx = await requireCtx("edit");
  await G.hideProduct(scoped(ctx), Key.parse(productKey), ctx.user.id);
  await G.dropFromNexusTemplates(scoped(ctx), Key.parse(productKey));
}

/** "Suggest it again" (Settings → Supermarket → Products you hid, the item sheet). */
export async function unhideProduct(productKey: string) {
  const ctx = await requireCtx("edit");
  await G.unhideProduct(scoped(ctx), Key.parse(productKey));
}

export async function hiddenProducts(locale?: "he" | "en") {
  const ctx = await requireCtx("view");
  return G.hiddenOf(scoped(ctx), z.enum(["he", "en"]).optional().parse(locale));
}

/** The item sheet's "What Nexus learned" card for one product. */
export async function productKnowledge(productKey: string) {
  const ctx = await requireCtx("view");
  const { tz } = await notifyPrefs(ctx.user.id);
  return G.knowledgeFor(scoped(ctx), Key.parse(productKey), tz);
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

const TItemZ = z.object({ productKey: Key, title: Title, qty: z.number().int().min(1).max(999), amount: z.number().nullable().optional(), unit: z.string().max(4).nullable().optional(), section: z.string().max(20).nullable().optional(), art: z.string().max(40).nullable().optional() }).strict();

export async function createSupermarketTemplate(name: string, items: z.input<typeof TItemZ>[]) {
  const ctx = await requireCtx("edit");
  return G.createTemplate(scoped(ctx), z.string().trim().min(1).max(80).parse(name), z.array(TItemZ).max(200).parse(items), ctx.user.id);
}

export async function saveTripAsTemplate(tripId: string, name: string, o?: { missed?: boolean; keepQty?: boolean }) {
  const ctx = await requireCtx("edit");
  const opts = z.object({ missed: z.boolean().optional(), keepQty: z.boolean().optional() }).strict().optional().parse(o);
  const t = await G.templateFromTrip(scoped(ctx), Id.parse(tripId), z.string().trim().min(1).max(80).parse(name), ctx.user.id, opts);
  if (!t) throw new AccessError("not_found");
  return t;
}

/** E1: what applying would do (new / already on it / skipped) — the apply sheet's numbers. */
export async function supermarketTemplatePlan(id: string) {
  const ctx = await requireCtx("view");
  const r = await G.templatePlan(scoped(ctx), Id.parse(id));
  if (!r) throw new AccessError("not_found");
  return r.lines;
}

export async function applySupermarketTemplate(id: string) {
  const ctx = await requireCtx("edit");
  const r = await G.applyTemplate(scoped(ctx), Id.parse(id), ctx.user.id);
  if (!r) throw new AccessError("not_found");
  return r;
}

// ---------- E2: template edit, past trips ----------

/** A template item by name only (added in the editor) gets its product key, section and picture here. */
const EditItemZ = TItemZ.extend({ productKey: Key.optional() });

/** Rename / change the items: the template becomes the user's (Nexus never changes it again). */
export async function editSupermarketTemplate(id: string, patch: { name?: string; items?: z.input<typeof EditItemZ>[] }) {
  const ctx = await requireCtx("edit");
  const p = z.object({ name: z.string().trim().min(1).max(80).optional(), items: z.array(EditItemZ).max(200).optional() }).strict().parse(patch);
  const items = p.items?.map((i) => {
    if (i.productKey) return { ...i, productKey: i.productKey };
    const c = classifyLocal(i.title);
    return { ...i, productKey: c.productKey, section: i.section ?? c.section, art: i.art ?? c.art };
  });
  const r = await G.editTemplate(scoped(ctx), Id.parse(id), { name: p.name, items });
  if (!r) throw new AccessError("not_found");
  return r;
}

export async function saveListAsTemplate(name: string) {
  const ctx = await requireCtx("edit");
  return G.templateFromList(scoped(ctx), z.string().trim().min(1).max(80).parse(name), ctx.user.id);
}

/** Past trips, newest first, with who shopped (first names) — Lists → Past trips. */
export async function supermarketPastTrips() {
  const ctx = await requireCtx("view");
  const trips = await G.pastTrips(scoped(ctx));
  const { firstNames } = await import("@/lib/db-scoped/notify");
  const names = await firstNames([...new Set(trips.map((t) => t.userId))]);
  return trips.map((t) => ({ ...t, who: names[t.userId] ?? "" }));
}

/** "Add again": the picked products of a past trip back on the list (merge: rows already there stay). */
export async function readdToSupermarket(items: z.input<typeof TItemZ>[]) {
  const ctx = await requireCtx("edit");
  return G.addMissing(scoped(ctx), z.array(TItemZ).min(1).max(200).parse(items), ctx.user.id);
}

/** E1: "Keep it" / "No thanks" on a routine Nexus spotted. */
export async function answerRoutine(id: string, keep: boolean) {
  const ctx = await requireCtx("edit");
  const r = await G.answerRoutine(scoped(ctx), Id.parse(id), z.boolean().parse(keep));
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

const OpZ = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(["start", "check", "uncheck", "not_found", "substitute", "qty", "price", "add", "note", "finish"]),
    itemId: Id.optional(),
    clientId: z.string().min(1).max(64).optional(),
    title: Title.optional(),
    productKey: Key.optional(),
    qty: z.number().int().min(1).max(999).optional(),
    amount: z.number().positive().max(100_000).nullable().optional(),
    unit: Unit,
    price: z.number().min(0).max(100_000).optional(),
    notes: z.string().max(500).nullable().optional(),
    count: z.number().int().min(1).max(999).nullable().optional(),
    chain: Store.nullish(),
    branch: Branch.nullish(),
    planned: z.number().int().min(0).max(999).optional(),
    total: z.number().min(0).max(1_000_000).nullable().optional(),
    rev: z.number().int().min(0).optional(),
    at: z.number().int().min(0),
  })
  .strict();

/**
 * D1 / S2 D1 — THE trip API: every store-mode action (start, check, uncheck, not found, substitute, quantity, price, add
 * during the trip, note, finish) arrives here as a typed op from the outbox (lib/grocery/trip-api.ts). The server merges
 * per field: a check never touches the note, two people checking the same row = one check, an edit made later by someone
 * else wins, adds merge by product key (an add made offline is applied once, by its client id), start / finish once per
 * op id. Returns the rows it changed (+ the ids the offline adds got) and my open trip after it.
 */
export async function syncTripOps(ops: z.input<typeof OpZ>[]) {
  const ctx = await requireCtx("edit");
  const list = z.array(OpZ).max(300).parse(ops);
  const s = scoped(ctx);
  const open = await T.openTripOf(ctx.user.id);
  const { tripStarted, tripFinished } = await import("@/lib/notify/senders");
  const hooks = {
    start: async (op: TripOp) => {
      await tripStarted(ctx.user.id, ctx.space.id, op.planned ?? null, op.at, op.chain ? { chain: op.chain, branch: op.branch ?? "" } : undefined);
      const t = await T.openTripOf(ctx.user.id);
      return t && t.spaceId === ctx.space.id ? t : null;
    },
    finish: async (op: TripOp, trip: T.TripRow) => {
      if (op.total != null) await s.update(schema.trip, { total: op.total }, eq(schema.trip.id, trip.id));
      await tripFinished(ctx.user.id, null, op.at);
      // E1: a finished trip may show (or update) a routine.
      await G.refreshRoutines(s, (await notifyPrefs(ctx.user.id)).tz).catch(() => 0);
    },
  };
  const r = await mergeOps(s, ctx.user.id, open && open.spaceId === ctx.space.id ? open : null, list as TripOp[], { seen: (k) => kvGet(`sm:op:${ctx.space.id}:${k}`), mark: (k, v) => kvSet(`sm:op:${ctx.space.id}:${k}`, v) }, hooks);
  classifyAfter(s, r.added);
  announceAdd(s, ctx.user.id, r.added);
  const after = await T.openTripOf(ctx.user.id);
  return { applied: r.applied, skipped: r.skipped, idMap: r.idMap, items: r.items, trip: after && after.spaceId === ctx.space.id ? after : null };
}

// ---------- S2 B3: scan + photo ----------

export type CaptureProduct = { title: string; productKey: string; section: string; art: string | null; gtin: string | null; mine: boolean; count: number };
export type ScanResult =
  | { state: "found"; code: string; product: CaptureProduct; listed: ItemRow | null; known: "home" | "public" }
  | { state: "unknown"; code: string; guess: CaptureProduct | null; sections: string[] };
type ItemRow = typeof schema.items.$inferSelect;

/** The supermarket rows that carry this barcode (any status: a product bought once is known to the home). */
async function homeByGtin(s: Scoped, code: string) {
  const cls = classifyBarcode(code);
  const key = cls.kind === "gtin" ? cls.key : cls.code;
  const rows = await s.select(schema.items, and(eq(schema.items.list, "supermarket"), isNotNull(schema.items.gtin)));
  return rows.filter((r) => r.gtin === code || (cls.kind === "gtin" && r.gtin && classifyBarcode(r.gtin).kind === "gtin" && (classifyBarcode(r.gtin) as { key: string }).key === key)).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Public product databases (Open Food Facts), the shared cache the Products scanner uses too. Mock: nothing. */
async function publicTitle(code: string): Promise<string | null> {
  const cls = classifyBarcode(code);
  if (cls.kind !== "gtin") return null;
  const cacheKey = `barcode:${cls.key}`;
  const cached = await kvGet(cacheKey).catch(() => null);
  if (cached) return (JSON.parse(cached) as { hit: { title?: string } | null }).hit?.title ?? null;
  if (mockAi()) return null;
  try {
    const { safeFetch } = await import("@/lib/safe-fetch");
    const res = await safeFetch(`https://world.openfoodfacts.org/api/v2/product/${cls.code}.json?fields=product_name,product_name_he,product_name_en,brands`, { headers: { "user-agent": "Nexus/1.0 (personal shopping list)" }, timeoutMs: 5000, maxBytes: 1_000_000 });
    const p = res.ok ? (JSON.parse(res.text) as { status?: number; product?: { product_name?: string; product_name_he?: string; product_name_en?: string; brands?: string } }) : null;
    const title = p?.status === 1 ? (p.product?.product_name_he || p.product?.product_name || p.product?.product_name_en || "").trim() : "";
    await kvSet(cacheKey, JSON.stringify({ hit: title ? { source: "off", title } : null, at: Date.now() })).catch(() => {});
    return title || null;
  } catch {
    return null;
  }
}

const asProduct = (title: string, gtin: string | null, mine: boolean, count = 0, row?: ItemRow): CaptureProduct => {
  const c = classifyLocal(title, gtin);
  return { title, productKey: row?.productKey ?? c.productKey, section: row?.section ?? c.section, art: row?.artKey ?? c.art, gtin, mine, count };
};

/** Scan in the supermarket: the home's own product (found / already on the list), a public one, or unknown (name it once). */
export async function smScan(raw: string): Promise<ScanResult> {
  const ctx = await requireCtx("view");
  const code = z.string().trim().regex(/^[\d\s-]{6,20}$/).parse(raw).replace(/[\s-]/g, "");
  const s = scoped(ctx);
  const own = await homeByGtin(s, code);
  if (own.length) {
    const r = own[0];
    const listed = own.find((x) => x.status === "to_buy") ?? (r.productKey ? ((await s.select(schema.items, and(eq(schema.items.list, "supermarket"), eq(schema.items.status, "to_buy"), eq(schema.items.productKey, r.productKey))).limit(1))[0] ?? null) : null);
    return { state: "found", code, product: asProduct(r.title, code, true, own.length, r), listed, known: "home" };
  }
  const title = await publicTitle(code);
  if (title) {
    const p = asProduct(title, code, false);
    const [listed] = await s.select(schema.items, and(eq(schema.items.list, "supermarket"), eq(schema.items.status, "to_buy"), eq(schema.items.productKey, p.productKey))).limit(1);
    return { state: "found", code, product: p, listed: listed ?? null, known: "public" };
  }
  return { state: "unknown", code, guess: null, sections: ["snack", "bfast", "dry"] };
}

export type PhotoResult =
  | { state: "matched"; product: CaptureProduct; listed: ItemRow | null }
  | { state: "unsure"; choices: CaptureProduct[] }
  | { state: "limit" }
  | { state: "failed" };

type PhotoGuess = { title: string; confidence: number; others: string[] };

/** Mock (tests): the image's base64 decodes to "mock:<title>|<confidence>|<other>|<other>". */
function mockGuess(data: string): PhotoGuess | null {
  try {
    const text = Buffer.from(data, "base64").toString("utf8");
    if (!text.startsWith("mock:")) return { title: "Mock product", confidence: 0.4, others: [] };
    const [title, conf, ...others] = text.slice(5).split("|");
    return { title, confidence: Number(conf) || 0, others };
  } catch {
    return null;
  }
}

/**
 * Photo of a package → the product, matched to this home's own products: one sure match ("matched"), else three choices
 * (the home's first, then the dictionary), or the daily AI limit (typing and scanning still work). Counts in the
 * person's AI quota (feature `grocery`).
 */
export async function smPhoto(input: { image: string }): Promise<PhotoResult> {
  const ctx = await requireCtx("edit");
  const { image } = z.object({ image: z.string().max(6_000_000) }).strict().parse(input);
  const m = image.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (!m) throw new Error("invalid_image");
  const use = aiUse(ctx, "grocery");
  const gate = await aiGate(use);
  if (!gate.ok) return gate.reason === "quota" ? { state: "limit" } : { state: "failed" };
  let guess: PhotoGuess | null;
  if (mockAi()) {
    guess = mockGuess(m[2]);
    await recordAiUsage(use, { provider: "mock", model: "mock", ok: true, ms: 0 });
  } else
    guess = await generateJson<PhotoGuess>(
      'This photo shows one grocery product (a package, a fruit, a bottle). Name it the way a shopping list would: product + variant/size, in the language printed on it (Hebrew stays Hebrew). "confidence": 0–1, how sure you are. "others": up to 2 other products it could be.',
      { type: "object", properties: { title: { type: "string" }, confidence: { type: "number" }, others: { type: "array", items: { type: "string" } } }, required: ["title", "confidence", "others"] },
      { use, file: { mimeType: m[1], data: m[2] }, budgetMs: 25_000 },
    );
  if (!guess?.title) return { state: "failed" };
  const s = scoped(ctx);
  const household = await G.householdProducts(s);
  const pick = (title: string) => {
    const hit = typeAhead(title, household, { limit: 3 }).hits.find((h) => h.source === "household");
    return hit ? asProduct(hit.title, null, true, household.find((x) => x.productKey === hit.productKey)?.count ?? 0) : null;
  };
  const best = pick(guess.title);
  const listedOf = async (p: CaptureProduct) => (await s.select(schema.items, and(eq(schema.items.list, "supermarket"), eq(schema.items.status, "to_buy"), eq(schema.items.productKey, p.productKey))).limit(1))[0] ?? null;
  if (best && guess.confidence >= 0.75) return { state: "matched", product: best, listed: await listedOf(best) };
  if (!best && guess.confidence >= 0.85) {
    const p = asProduct(guess.title, null, false);
    return { state: "matched", product: p, listed: await listedOf(p) };
  }
  const seen = new Set<string>();
  const choices: CaptureProduct[] = [];
  for (const t of [guess.title, ...guess.others]) {
    const p = pick(t) ?? asProduct(t, null, false);
    if (seen.has(p.productKey)) continue;
    seen.add(p.productKey);
    choices.push(p);
  }
  return { state: "unsure", choices: choices.slice(0, 3) };
}

/** The photo counter ("7 of 40 today"): this person's AI uses left today (null limit = unlimited). */
export async function smAiAllowance() {
  const ctx = await requireCtx("view");
  const a = await aiAllowance(ctx.user.id);
  return { used: a.used, limit: a.limit, left: a.left, on: a.on };
}

// ---------- S2 C2: the item sheet ----------

/** Everything the sheet shows besides the row: what Nexus learned, the history, the cheapest store. */
export async function smItemDetail(itemId: string) {
  const ctx = await requireCtx("view");
  const s = scoped(ctx);
  const it = await s.byId(schema.items, Id.parse(itemId));
  if (!it || it.list !== "supermarket") throw new AccessError("not_found");
  const { tz } = await notifyPrefs(ctx.user.id);
  const key = it.productKey ?? "";
  const [knowledge, history] = await Promise.all([key ? G.knowledgeFor(s, key, tz) : Promise.resolve({ state: "new" as const, count: 0 }), key ? G.productHistory(s, key) : Promise.resolve({ rows: [], cheapest: null })]);
  return { item: it, knowledge, history };
}

const PatchZ = z
  .object({
    title: Title.optional(),
    section: z.string().max(20).optional(),
    quantity: z.number().int().min(1).max(999).optional(),
    count: z.number().int().min(1).max(999).nullable().optional(),
    amount: z.number().positive().max(100_000).nullable().optional(),
    unit: z.enum(["kg", "g", "l"]).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    preferBrand: z.string().trim().max(80).nullable().optional(),
    substitutes: z.array(z.string().trim().min(1).max(80)).max(8).nullable().optional(),
    pinnedStore: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

/** The sheet's edits (one field or several). Members and owners; viewers are refused. */
export async function updateSmItem(itemId: string, patch: z.input<typeof PatchZ>) {
  const ctx = await requireCtx("edit");
  const s = scoped(ctx);
  const id = Id.parse(itemId);
  const it = await s.byId(schema.items, id);
  if (!it || it.list !== "supermarket") throw new AccessError("not_found");
  const p = PatchZ.parse(patch);
  const set: Partial<typeof schema.items.$inferInsert> = { ...p, updatedAt: Date.now() };
  if (p.section && p.section !== it.section) set.artKey = it.artKey; // a moved row keeps its picture
  if (p.amount === null) set.unit = null;
  await s.update(schema.items, set, eq(schema.items.id, id));
  return s.byId(schema.items, id);
}

/** Remove a row from the list (to buy only). */
export async function removeSmItem(itemId: string) {
  const ctx = await requireCtx("edit");
  const s = scoped(ctx);
  const id = Id.parse(itemId);
  await s.delete(schema.items, and(eq(schema.items.id, id), eq(schema.items.list, "supermarket"), eq(schema.items.status, "to_buy")));
}

// ---------- D4: Send to phone (the computer page, F3) ----------

/** The people "Send to phone" can reach (default picks: me + members with push on). */
export async function smSendTargets() {
  const ctx = await requireCtx("view");
  const { sendTargets } = await import("@/lib/notify/senders");
  return sendTargets(ctx.space.id, ctx.user.id);
}

/** Push "Tal sent the list to your phone" to the chosen members (the list's size + the trip's store). */
export async function sendSmToPhone(to: string[], store?: { chain: string; branch: string } | null) {
  const ctx = await requireCtx("view");
  const ids = z.array(Id).min(1).max(50).parse(to);
  // A viewer may send the list to their own phone, never push others.
  if (ctx.role === "viewer" && ids.some((u) => u !== ctx.user.id)) throw new AccessError("forbidden");
  const pick = z.object({ chain: Store, branch: Branch }).nullable().optional().parse(store);
  const s = scoped(ctx);
  const [list, def] = await Promise.all([G.supermarketList(s), pick ? null : G.defaultStore(s)]);
  const where = pick ?? (def ? { chain: def.chain, branch: def.branch } : null);
  const { sentToPhone } = await import("@/lib/notify/senders");
  return { sent: await sentToPhone(ctx.user.id, ctx.space.id, ids, { items: list.length, chain: where?.chain ?? null, branch: where?.branch ?? null }) };
}

// ---------- F1: Settings → Supermarket, What Nexus learned ----------

/** The learned facts (When and where, Regular products, Habits) — each with the key that forgets it. */
export async function smLearned() {
  const ctx = await requireCtx("view");
  const { tz } = await notifyPrefs(ctx.user.id);
  return G.learnedFacts(scoped(ctx), tz);
}

/** ✕ on a learned fact (Nexus learns it again from what happens next) or "Forget everything" (`all`: learning only). */
export async function forgetLearned(key: string) {
  const ctx = await requireCtx("edit");
  const k = z.union([z.literal("all"), z.literal("day"), z.string().regex(/^(store|p):.{1,160}$/)]).parse(key);
  await G.forgetFact(scoped(ctx), k);
}
