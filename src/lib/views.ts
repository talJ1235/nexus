import type { ItemWithSources } from "./types";

export type View =
  | { type: "home" }
  | { type: "to_buy" }
  | { type: "urgent" }
  | { type: "history" }
  | { type: "ordered" }
  | { type: "orders" }
  | { type: "spending" }
  | { type: "projects" }
  | { type: "unsorted" }
  | { type: "collection"; id: string }
  | { type: "store"; key: string };

export function itemsForView(items: ItemWithSources[], view: View) {
  switch (view.type) {
    case "home":
      return [];
    case "to_buy":
      return items.filter((i) => i.status === "to_buy");
    case "urgent":
      return items.filter((i) => i.status === "to_buy" && i.priority === "urgent");
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
    case "unsorted":
      return items.filter((i) => !i.collectionId && i.status === "to_buy");
    case "collection":
      return items.filter((i) => i.collectionId === view.id);
    case "store":
      return items.filter((i) => i.status === "to_buy" && i.sources.some((s) => s.storeKey === view.key));
  }
}
