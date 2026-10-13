import "server-only";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import type { TripOp } from "@/lib/grocery/trip";
import { addToList } from "./grocery";
import { addCheck, type TripRow } from "./trips";
import type { Scoped } from "./index";

// R18 D1 — merge a trip's outbox (sent when the phone is back online) into the list, field by field. R18 S2 D1: this is
// the one trip API's server side — `start` and `finish` arrive in the same queue (hooks: the senders live above the data
// layer), so a trip can start and end offline and a watch client sends the very same ops.
//   start → a trip in this space (an open one of mine is reused); finish → the trip ends (total, counts, notifications).
//   check / uncheck / not found / substitute → the status only (a check never touches the note someone wrote);
//     two people checking the same row = one check; an uncheck loses to someone else's later check.
//   qty / amount / price / note → that field only, unless someone else changed the row after the action (rev + time):
//     the later edit wins.
//   add → merged by product key (no duplicates), applied once per client id.
// Every applied action is also the trip's next check (the log keeps the order the shopper acted in).

type ItemRow = typeof schema.items.$inferSelect;
export type SyncStore = { seen: (key: string) => Promise<string | null>; mark: (key: string, value: string) => Promise<unknown> };
/** Starting / finishing a trip (notifications, the order learning) — passed in by the action. */
export type TripHooks = { start: (op: TripOp) => Promise<TripRow | null>; finish: (op: TripOp, trip: TripRow) => Promise<unknown> };
export type SyncResult = { applied: number; skipped: string[]; idMap: Record<string, string>; items: ItemRow[]; added: ItemRow[] };

/** Did someone else change this row after the device's action (its rev is older and the change is later)? */
const changedSince = (it: ItemRow, op: TripOp, me: string) => op.rev != null && it.rev > op.rev && it.revBy !== me && it.updatedAt > op.at;

export async function mergeOps(s: Scoped, me: string, open: TripRow | null, ops: TripOp[], store: SyncStore, hooks?: TripHooks): Promise<SyncResult> {
  let trip = open;
  const out: SyncResult = { applied: 0, skipped: [], idMap: {}, items: [], added: [] };
  const touched = new Map<string, ItemRow>();
  const log = async (op: TripOp, it: ItemRow | null, extra: Partial<Parameters<typeof addCheck>[2]> = {}) => {
    if (!trip || op.kind === "note" || op.kind === "start" || op.kind === "finish") return;
    await addCheck(s, trip.id, { action: op.kind, itemId: it?.id ?? null, productKey: it?.productKey ?? op.productKey ?? null, section: it?.section ?? null, gtin: it?.gtin ?? null, by: me, at: op.at, ...extra });
  };
  for (const op of [...ops].sort((a, b) => a.at - b.at)) {
    if (op.kind === "start" || op.kind === "finish") {
      // Applied once per op id (a resend after a lost answer must not start / finish twice).
      const k = `op:${op.id}`;
      if (await store.seen(k)) {
        out.skipped.push(op.id);
        continue;
      }
      if (op.kind === "start") {
        if (!hooks) {
          out.skipped.push(op.id);
          continue;
        }
        trip = (await hooks.start(op)) ?? trip;
      } else {
        if (!trip || !hooks) {
          out.skipped.push(op.id);
          continue;
        }
        await hooks.finish(op, trip);
        trip = null;
      }
      await store.mark(k, "1");
      out.applied++;
      continue;
    }
    if (op.kind === "add") {
      const cid = op.clientId ? `cid:${op.clientId}` : null;
      const done = cid ? await store.seen(cid) : null;
      if (done) {
        out.idMap[op.clientId!] = done;
        out.skipped.push(op.id);
        continue;
      }
      if (!op.title) {
        out.skipped.push(op.id);
        continue;
      }
      const r = await addToList(s, { title: op.title, qty: op.qty, amount: op.amount ?? null, unit: op.unit ?? null, count: op.count ?? null, productKey: op.productKey ?? null, by: me }, op.at);
      if (cid) await store.mark(cid, r.item.id);
      if (op.clientId) out.idMap[op.clientId] = r.item.id;
      if (!r.merged) out.added.push(r.item);
      touched.set(r.item.id, r.item);
      await log(op, r.item);
      out.applied++;
      continue;
    }
    const itemId = op.itemId ?? (op.clientId ? (out.idMap[op.clientId] ?? (await store.seen(`cid:${op.clientId}`)) ?? undefined) : undefined);
    const it = itemId ? await s.byId(schema.items, itemId) : null;
    if (!it || it.list !== "supermarket") {
      out.skipped.push(op.id);
      continue;
    }
    const set = async (patch: Partial<ItemRow>) => {
      await s.update(schema.items, { ...patch, updatedAt: Math.max(Date.now(), op.at) }, eq(schema.items.id, it.id));
      touched.set(it.id, (await s.byId(schema.items, it.id))!);
    };
    switch (op.kind) {
      case "check":
      case "substitute":
        if (it.status === "purchased") {
          out.skipped.push(op.id); // someone already checked it: one check
          continue;
        }
        await set({ status: "purchased", purchasedAt: op.at });
        break;
      case "uncheck":
        if (it.status !== "purchased" || (it.purchasedAt ?? 0) > op.at) {
          out.skipped.push(op.id); // not checked, or checked again later by someone
          continue;
        }
        await set({ status: "to_buy", purchasedAt: null });
        break;
      case "not_found":
        break; // the row stays to buy; the log remembers it wasn't there
      case "qty":
        if (changedSince(it, op, me)) {
          out.skipped.push(op.id);
          continue;
        }
        await set({ ...(op.qty != null ? { quantity: op.qty } : {}), ...(op.count !== undefined ? { count: op.count } : {}), ...(op.amount !== undefined ? { amount: op.amount } : {}), ...(op.unit !== undefined ? { unit: op.unit === "u" ? null : op.unit } : {}) });
        break;
      case "price":
        if (op.price == null) {
          out.skipped.push(op.id);
          continue;
        }
        await set({ purchasedPrice: op.price });
        break;
      case "note":
        if (changedSince(it, op, me)) {
          out.skipped.push(op.id);
          continue;
        }
        await set({ notes: op.notes ?? null });
        break;
    }
    await log(op, touched.get(it.id) ?? it, { qty: op.qty ?? null, amount: op.amount ?? null, unit: op.unit ?? null, price: op.price ?? null });
    out.applied++;
  }
  out.items = [...touched.values()];
  return out;
}
