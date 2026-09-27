import type { ItemWithSources } from "./types";

export type View =
  | { type: "to_buy" }
  | { type: "urgent" }
  | { type: "history" }
  | { type: "unsorted" }
  | { type: "collection"; id: string }
  | { type: "store"; key: string };

export function itemsForView(items: ItemWithSources[], view: View) {
  switch (view.type) {
    case "to_buy":
      return items.filter((i) => i.status === "to_buy");
    case "urgent":
      return items.filter((i) => i.status === "to_buy" && i.priority === "urgent");
    case "history":
      return items.filter((i) => i.status === "purchased");
    case "unsorted":
      return items.filter((i) => !i.collectionId && i.status === "to_buy");
    case "collection":
      return items.filter((i) => i.collectionId === view.id);
    case "store":
      return items.filter((i) => i.status === "to_buy" && i.sources.some((s) => s.storeKey === view.key));
  }
}
