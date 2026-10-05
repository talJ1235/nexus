"use server";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { schema } from "@/db";
import { aiEnabled } from "@/lib/ai";
import { bulkSetStatus, createCollection, deleteCollection, updateItem } from "@/app/actions";
import { askNexus, planProject, type Plan } from "@/lib/assistant";
import { changedKeys, isNewRef, newCollections, newRef, parseAnswer, planChanges, validateProposal, type ItemFields, type Proposal } from "@/lib/assistant-actions";
import { requireCtx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { getProfile, memoryContext } from "@/lib/profile-server";
import { activeSource } from "@/lib/calc";
import { getAppData, loadItems } from "@/lib/data";
import { CURRENCIES } from "@/lib/money";
import type { AppData, Collection, ItemWithSources } from "@/lib/types";

const locale = z.enum(["en", "he"]);
const currency = z.enum(CURRENCIES);

export async function planWithAi(raw: { description: string; budget: number | null; currency: string; locale: string; collectionId: string | null }): Promise<Plan | { error: "no_ai" | "failed" }> {
  const ctx = await requireCtx("edit");
  const s = scoped(ctx);
  if (!aiEnabled()) return { error: "no_ai" };
  const input = z
    .object({ description: z.string().min(3).max(3000), budget: z.number().positive().max(1e8).nullable(), currency, locale, collectionId: z.string().max(64).nullable() })
    .strict()
    .parse(raw);
  const existing = input.collectionId ? (await s.pick({ title: schema.items.title }, schema.items, eq(schema.items.collectionId, input.collectionId))).map((r) => r.title) : [];
  // With memory on: their habits and usual stores steer the plan (R9 C3).
  const habits = await memoryContext(ctx, input.currency, input.locale === "he" ? "he" : "en").catch(() => null);
  const stores = habits ? (await getProfile(ctx, input.currency).catch(() => null))?.stores.map((x) => x.store) ?? [] : [];
  const plan = await planProject({ description: input.description, budget: input.budget, currency: input.currency, locale: input.locale, existing, habits, stores });
  return plan ?? { error: "failed" };
}

const part = z.object({
  name: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(1000),
  spec: z.string().max(300),
  estMin: z.number().nullable(),
  estMax: z.number().nullable(),
  category: z.string().max(40),
  essential: z.boolean(),
  searchQuery: z.string().max(120),
});

/** Add the chosen planned parts as link-less items (with search queries) to an existing or new project. */
export async function addPlannedParts(raw: {
  parts: z.input<typeof part>[];
  collectionId: string | null;
  newProject: { name: string; description: string; budget: number | null } | null;
  currency: string;
  estimateLabel: string;
}): Promise<{ items: ItemWithSources[]; collection: Collection | null }> {
  const s = scoped(await requireCtx("edit"));
  const input = z
    .object({
      parts: z.array(part).min(1).max(40),
      collectionId: z.string().max(64).nullable(),
      newProject: z.object({ name: z.string().min(1).max(80), description: z.string().max(500), budget: z.number().positive().nullable() }).nullable(),
      currency,
      estimateLabel: z.string().max(40),
    })
    .strict()
    .parse(raw);

  let collection: Collection | null = null;
  let collectionId = await s.ref(schema.collections, input.collectionId);
  if (input.newProject) {
    const cid = nanoid(10);
    await s.insert(schema.collections, {
      id: cid,
      kind: "project",
      name: input.newProject.name,
      description: input.newProject.description || null,
      budget: input.newProject.budget,
      budgetCurrency: input.currency,
      sortOrder: Date.now() % 1e9,
    });
    collection = await s.byId(schema.collections, cid);
    collectionId = cid;
  }

  const t0 = Date.now();
  const ids: string[] = [];
  for (const [i, p] of input.parts.entries()) {
    const id = nanoid(12);
    const est =
      p.estMin != null || p.estMax != null
        ? `${input.estimateLabel}: ${[p.estMin, p.estMax].filter((v) => v != null).map((v) => Math.round(v!)).join("–")} ${input.currency}`
        : null;
    await s.insert(schema.items, {
      id,
      addedByUserId: s.scope.userId,
      title: p.name,
      category: p.category,
      tags: [],
      collectionId,
      quantity: p.qty,
      priority: p.essential ? "normal" : "someday",
      notes: [p.spec, est].filter(Boolean).join("\n") || null,
      searchQuery: p.searchQuery || p.name,
      createdAt: t0 + (input.parts.length - i),
      updatedAt: t0,
    });
    ids.push(id);
  }
  const items = await loadItems(s, ids);
  return { items, collection };
}

export async function ask(raw: { question: string; history: { role: "user" | "assistant"; text: string }[]; currency: string; locale: string }): Promise<{ text: string; proposal: Proposal | null } | { error: "no_ai" | "failed" }> {
  const ctx = await requireCtx("view");
  if (!aiEnabled()) return { error: "no_ai" };
  const input = z
    .object({
      question: z.string().min(1).max(1500),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(20),
      currency,
      locale,
    })
    .strict()
    .parse(raw);
  const data = await getAppData(scoped(ctx), ctx.user.id);
  const answer = await askNexus({ ...input, data });
  if (!answer) return { error: "failed" };
  const { text, proposal } = parseAnswer(answer, ownerIds(data));
  // A proposal that wouldn't change anything isn't worth a confirmation card.
  const useful = proposal && (newCollections(proposal).length > 0 || planChanges(proposal, data.items).length > 0);
  return { text: text || proposal?.summary || "", proposal: useful ? proposal : null };
}

// ---------- Assistant actions (always confirmed by the owner in the UI) ----------

const ownerIds = (data: AppData) => ({ itemIds: new Set(data.items.map((i) => i.id)), collectionIds: new Set(data.collections.map((c) => c.id)) });

const status = z.enum(["to_buy", "ordered", "purchased"]);
const undoItem = z.object({
  id: z.string().min(1).max(40),
  collectionId: z.string().max(40).nullable(),
  status,
  priority: z.enum(["urgent", "normal", "someday"]),
  quantity: z.number().int().min(1).max(100000),
  tags: z.array(z.string().max(40)).max(12),
  orderedAt: z.number().int().nullable(),
  purchasedAt: z.number().int().nullable(),
  purchasedPrice: z.number().nonnegative().nullable(),
  purchasedCurrency: z.string().min(3).max(3).nullable(),
});
const undoInput = z.object({ items: z.array(undoItem).max(50), collectionIds: z.array(z.string().min(1).max(40)).max(20) });
export type AssistantUndo = z.infer<typeof undoInput>;

/**
 * Apply a proposal the owner confirmed. Everything is validated again against fresh data (the proposal came back
 * from the client), then run through the regular item mutations. Returns what Undo needs to restore.
 */
export async function applyAssistant(raw: { proposal: unknown; currency: string }): Promise<{ items: ItemWithSources[]; collections: Collection[]; undo: AssistantUndo } | { error: "invalid" }> {
  const ctx = await requireCtx("edit");
  const cur = currency.parse(raw.currency);
  const data = await getAppData(scoped(ctx), ctx.user.id);
  const p = validateProposal(raw.proposal, ownerIds(data));
  if (!p) return { error: "invalid" };
  const changes = planChanges(p, data.items);
  const byId = new Map(data.items.map((i) => [i.id, i]));

  const collections: Collection[] = [];
  const refIds = new Map<string, string>();
  for (const c of newCollections(p)) {
    const row = await createCollection({ kind: c.kind, name: c.name, budget: c.budget ?? null, budgetCurrency: cur });
    collections.push(row);
    refIds.set(c.ref, row.id);
  }

  const undo: AssistantUndo = {
    collectionIds: collections.map((c) => c.id),
    items: changes.map((ch) => {
      const i = byId.get(ch.id)!;
      return { id: ch.id, ...ch.before, orderedAt: i.orderedAt, purchasedAt: i.purchasedAt, purchasedPrice: i.purchasedPrice, purchasedCurrency: i.purchasedCurrency };
    }),
  };

  for (const ch of changes) {
    const keys = changedKeys(ch).filter((k) => k !== "status");
    if (!keys.length) continue;
    const patch: Partial<ItemFields> = {};
    for (const k of keys) Object.assign(patch, { [k]: ch.after[k] });
    if (isNewRef(patch.collectionId ?? null)) patch.collectionId = refIds.get(newRef(patch.collectionId!)) ?? null;
    await updateItem(ch.id, patch as Parameters<typeof updateItem>[1]);
  }
  for (const to of status.options) {
    const group = changes.filter((ch) => ch.after.status === to && ch.before.status !== to);
    if (!group.length) continue;
    // Same rule as the selection bar: leaving "to buy" records the active store's price as the price paid.
    const entries = group.map((ch) => {
      const i = byId.get(ch.id)!;
      const src = activeSource(i, data.rates);
      return { id: ch.id, paid: to !== "to_buy" && i.status === "to_buy" && src?.price != null ? { price: src.price + (src.shipping ?? 0), currency: src.currency } : null };
    });
    await bulkSetStatus(entries, to);
  }

  return { items: await loadItems(scoped(ctx), changes.map((c) => c.id)), collections, undo };
}

/** Undo an applied proposal: restore each item's previous fields, drop collections it created if still empty. */
export async function undoAssistant(raw: AssistantUndo): Promise<{ items: ItemWithSources[]; removedCollectionIds: string[] }> {
  const s = scoped(await requireCtx("edit"));
  const u = undoInput.parse(raw);
  const t = Date.now();
  for (const { id, ...fields } of u.items) {
    if (fields.collectionId && !(await s.byId(schema.collections, fields.collectionId))) fields.collectionId = null;
    await s.update(schema.items, { ...fields, updatedAt: t }, eq(schema.items.id, id));
  }
  const removedCollectionIds: string[] = [];
  for (const id of u.collectionIds) {
    if (!(await s.byId(schema.collections, id))) continue;
    const inUse = await s.pick({ id: schema.items.id }, schema.items, eq(schema.items.collectionId, id)).limit(1);
    if (inUse.length) continue;
    await deleteCollection(id);
    removedCollectionIds.push(id);
  }
  return { items: await loadItems(s, u.items.map((i) => i.id)), removedCollectionIds };
}
