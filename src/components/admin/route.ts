// R17 G0 — the admin panel's routes (shared by the server page and the client shell).

export const TABS = ["live", "people", "invites", "ai", "reports", "errors", "system"] as const;
export type Tab = (typeof TABS)[number] | "more";
export type Route = { tab: Tab; sub: string | null };

/** "/admin", "/admin/people", "/admin/people/<id>", … → { tab, sub }. Unknown tabs → Live. */
export function parseRoute(path: string): Route {
  const parts = path.split("/").filter(Boolean);
  const tab = (parts[1] ?? "live") as Tab;
  if (!(TABS as readonly string[]).includes(tab) && tab !== "more") return { tab: "live", sub: null };
  return { tab, sub: parts[2] ? decodeURIComponent(parts[2]) : null };
}

export const pathOf = (r: Route) => (r.tab === "live" && !r.sub ? "/admin" : `/admin/${r.tab}${r.sub ? `/${encodeURIComponent(r.sub)}` : ""}`);
