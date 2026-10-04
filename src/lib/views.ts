import type { ItemWithSources } from "./types";

/** To buy's filter chips (R14 B4: one To buy instead of To buy / Urgent / Unsorted). Absent = All. */
export type BuyFilter = "urgent" | "none";
export const BUY_FILTERS: readonly BuyFilter[] = ["urgent", "none"];

export type View =
  | { type: "home" }
  | { type: "to_buy"; f?: BuyFilter }
  | { type: "history" }
  | { type: "ordered" }
  | { type: "orders" }
  | { type: "spending" }
  | { type: "projects" }
  | { type: "collection"; id: string }
  | { type: "store"; key: string };

export function itemsForView(items: ItemWithSources[], view: View) {
  switch (view.type) {
    case "home":
      return [];
    case "to_buy":
      return items.filter((i) => i.status === "to_buy" && buyFilter(i, view.f));
    case "history":
      return items.filter((i) => i.status === "purchased");
    case "ordered":
      return items.filter((i) => i.status === "ordered");
    case "orders":
      return items.filter((i) => i.status === "to_buy");
    case "spending":
      return items.filter((i) => i.status !== "to_buy");
    case "projects":
      return items.filter((i) => i.status === "to_buy" && !!i.collectionId);
    case "collection":
      return items.filter((i) => i.collectionId === view.id);
    case "store":
      return items.filter((i) => i.status === "to_buy" && i.sources.some((s) => s.storeKey === view.key));
  }
}

/** Urgent = priority urgent; No project = not in a project or list. */
export function buyFilter(i: ItemWithSources, f: BuyFilter | undefined) {
  return f === "urgent" ? i.priority === "urgent" : f === "none" ? !i.collectionId : true;
}

/**
 * `?v=` (+ `&f=`) → view. The old Urgent / Unsorted pages (`?v=urgent`, `?v=unsorted`) open the filtered To buy.
 * Anything unknown = Home, the default screen (Tal, 2026-10-03).
 */
export function paramToView(p: string | null, f?: string | null): View {
  if (!p) return { type: "home" };
  if (p.startsWith("c:")) return { type: "collection", id: p.slice(2) };
  if (p.startsWith("s:")) return { type: "store", key: p.slice(2) };
  if (p === "urgent") return { type: "to_buy", f: "urgent" };
  if (p === "unsorted") return { type: "to_buy", f: "none" };
  if (p === "to_buy") return BUY_FILTERS.includes(f as BuyFilter) ? { type: "to_buy", f: f as BuyFilter } : { type: "to_buy" };
  if (["history", "ordered", "orders", "spending", "projects"].includes(p)) return { type: p } as View;
  return { type: "home" };
}
