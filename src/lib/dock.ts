// R18 S3 A1 — one phone dock for everyone (Tal's decision): Home · Products · + · Supermarket · Insights, in every space,
// on first paint and after hydration alike. Projects is a segment of Products, never a tab of its own. Pure (test:dock).

export type DockTarget = "home" | "shopping" | "supermarket" | "spending";

/** Left to right in every language (not mirrored in Hebrew); "+" sits between the second and the third. */
export const DOCK_ORDER: readonly DockTarget[] = ["home", "shopping", "supermarket", "spending"];

/** Which dock tab a view lights (null = none, e.g. a store page). */
export function dockOf(type: string): DockTarget | null {
  switch (type) {
    case "home":
      return "home";
    case "supermarket":
      return "supermarket";
    case "to_buy":
    case "ordered":
    case "projects":
    case "collection":
      return "shopping";
    case "orders":
    case "history":
    case "spending":
      return "spending";
    default:
      return null;
  }
}
