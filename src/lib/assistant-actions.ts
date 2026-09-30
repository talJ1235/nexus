// Assistant actions: the model appends one ```nexus-actions block with { summary, actions }; this module strips it
// from the answer, validates it strictly against the owner's data and works out what each item would become.
// Pure (no server imports): the server validates with it, the confirmation card previews with it.
import { z } from "zod";
import type { ItemWithSources } from "./types";

export const ACTION_FENCE = "nexus-actions";
export const MAX_ACTION_ITEMS = 50;
const NEW_PREFIX = "new:";

const ids = z.array(z.string().min(1).max(40)).min(1).max(MAX_ACTION_ITEMS);
const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), itemIds: ids, collectionId: z.string().min(1).max(40).nullable() }),
  z.object({ type: z.literal("setStatus"), itemIds: ids, status: z.enum(["to_buy", "ordered", "purchased"]) }),
  z.object({ type: z.literal("setPriority"), itemIds: ids, priority: z.enum(["urgent", "normal", "someday"]) }),
  z.object({ type: z.literal("setQty"), itemIds: ids, qty: z.number().int().min(1).max(100000) }),
  z.object({ type: z.literal("addTag"), itemIds: ids, tag: z.string().trim().min(1).max(40) }),
  z.object({ type: z.literal("removeTag"), itemIds: ids, tag: z.string().trim().min(1).max(40) }),
  z.object({
    type: z.literal("createCollection"),
    ref: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["project", "list"]).default("project"),
    budget: z.number().positive().max(1e8).nullable().optional(),
  }),
]);
const proposal = z.object({ summary: z.string().trim().min(1).max(300), actions: z.array(action).min(1).max(20) });

export type AssistantAction = z.output<typeof action>;
export type Proposal = z.output<typeof proposal>;
export type NewCollection = Extract<AssistantAction, { type: "createCollection" }>;

/** Fields an assistant action can change (also what Undo restores). */
export type ItemFields = Pick<ItemWithSources, "collectionId" | "status" | "priority" | "quantity" | "tags">;
export type ItemChange = { id: string; title: string; before: ItemFields; after: ItemFields };

const BLOCK = new RegExp("```\\s*" + ACTION_FENCE + "\\s*\\n([\\s\\S]*?)(?:```|$)", "g");

/** Split the model's answer into the visible text and the raw JSON of its (first) actions block. */
export function splitAnswer(text: string): { text: string; raw: string | null } {
  let raw: string | null = null;
  const clean = text.replace(BLOCK, (_, body: string) => {
    raw ??= body.trim();
    return "";
  });
  return { text: clean.replace(/\n{3,}/g, "\n\n").trim(), raw };
}

/**
 * Validate a proposal against the owner's data. Anything off (malformed, unknown action, an id that isn't theirs,
 * a move to a missing project, more than 50 items, nothing touched) drops the whole proposal: a partial
 * one would no longer match its summary.
 */
export function validateProposal(input: unknown, ctx: { itemIds: Set<string>; collectionIds: Set<string> }): Proposal | null {
  const parsed = proposal.safeParse(input);
  if (!parsed.success) return null;
  const p = parsed.data;
  const refs = new Set<string>();
  const touched = new Set<string>();
  for (const a of p.actions) {
    if (a.type === "createCollection") {
      if (refs.has(a.ref)) return null;
      refs.add(a.ref);
      continue;
    }
    for (const id of a.itemIds) {
      if (!ctx.itemIds.has(id)) return null;
      touched.add(id);
    }
    if (a.type === "move" && a.collectionId != null) {
      const c = a.collectionId;
      if (c.startsWith(NEW_PREFIX) ? !refs.has(c.slice(NEW_PREFIX.length)) : !ctx.collectionIds.has(c)) return null;
    }
  }
  if (touched.size > MAX_ACTION_ITEMS) return null;
  if (!touched.size && !refs.size) return null;
  return { summary: p.summary, actions: p.actions.map((a) => ("itemIds" in a ? { ...a, itemIds: [...new Set(a.itemIds)] } : a)) as AssistantAction[] };
}

/** Parse the JSON body of an actions block (null when it isn't JSON). */
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The answer text without its block, plus the validated proposal (or null). */
export function parseAnswer(text: string, ctx: { itemIds: Set<string>; collectionIds: Set<string> }): { text: string; proposal: Proposal | null } {
  const { text: clean, raw } = splitAnswer(text);
  return { text: clean, proposal: raw ? validateProposal(parseJson(raw), ctx) : null };
}

export const isNewRef = (collectionId: string | null) => !!collectionId?.startsWith(NEW_PREFIX);
export const newRef = (collectionId: string) => collectionId.slice(NEW_PREFIX.length);
export const newCollections = (p: Proposal) => p.actions.filter((a): a is NewCollection => a.type === "createCollection");

const fields = (i: ItemFields): ItemFields => ({ collectionId: i.collectionId, status: i.status, priority: i.priority, quantity: i.quantity, tags: [...(i.tags ?? [])] });

/**
 * What each touched item becomes, in action order. A move to a new collection keeps the "new:<ref>" id; the server
 * swaps in the real id once it exists. Items whose fields end up unchanged are left out.
 */
export function planChanges(p: Proposal, items: ItemWithSources[]): ItemChange[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Map<string, ItemChange>();
  for (const a of p.actions) {
    if (a.type === "createCollection") continue;
    for (const id of a.itemIds) {
      const item = byId.get(id);
      if (!item) continue;
      const c = out.get(id) ?? { id, title: item.title, before: fields(item), after: fields(item) };
      const f = c.after;
      if (a.type === "move") f.collectionId = a.collectionId;
      else if (a.type === "setStatus") f.status = a.status;
      else if (a.type === "setPriority") f.priority = a.priority;
      else if (a.type === "setQty") f.quantity = a.qty;
      else if (a.type === "addTag") f.tags = f.tags.some((x) => x.toLowerCase() === a.tag.toLowerCase()) ? f.tags : [...f.tags, a.tag].slice(0, 12);
      else if (a.type === "removeTag") f.tags = f.tags.filter((x) => x.toLowerCase() !== a.tag.toLowerCase());
      out.set(id, c);
    }
  }
  return [...out.values()].filter((c) => changedKeys(c).length);
}

export function changedKeys(c: ItemChange): (keyof ItemFields)[] {
  return (["status", "priority", "quantity", "collectionId", "tags"] as const).filter((k) =>
    k === "tags" ? c.before.tags.join("\u0000") !== c.after.tags.join("\u0000") : c.before[k] !== c.after[k],
  );
}
