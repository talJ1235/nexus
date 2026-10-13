// R18 S2 A1 — the phone dock's fourth tab is chosen by itself (no setting): Projects when onboarding said "projects" and
// the person used Projects more than the Supermarket in the last 30 days, else the Supermarket. Pure (the client keeps
// the per-day counts on the device, `nexus.tabUse`).

export type Tab4 = "supermarket" | "projects";
/** Per UTC day (YYYY-MM-DD): how often Projects (p) and the Supermarket (s) were opened. */
export type TabUse = Record<string, { p?: number; s?: number }>;

const DAY = 86_400_000;
export const TAB_USE_DAYS = 30;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Opens of each side in the last 30 days (today included). */
export function tabTotals(use: TabUse, now: number) {
  const since = dayKey(now - (TAB_USE_DAYS - 1) * DAY);
  let p = 0;
  let s = 0;
  for (const [d, v] of Object.entries(use)) {
    if (d < since) continue;
    p += v.p ?? 0;
    s += v.s ?? 0;
  }
  return { p, s };
}

export function dockTab4(why: readonly string[] | null | undefined, use: TabUse, now: number): Tab4 {
  if (!why?.includes("proj")) return "supermarket";
  const { p, s } = tabTotals(use, now);
  return p > s ? "projects" : "supermarket";
}

/** One more open of `side` today; days older than 30 are dropped. */
export function noteTabUse(use: TabUse, side: "p" | "s", now: number): TabUse {
  const since = dayKey(now - (TAB_USE_DAYS - 1) * DAY);
  const out: TabUse = {};
  for (const [d, v] of Object.entries(use)) if (d >= since) out[d] = v;
  const k = dayKey(now);
  out[k] = { ...out[k], [side]: (out[k]?.[side] ?? 0) + 1 };
  return out;
}

export function parseTabUse(raw: string | null | undefined): TabUse {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: TabUse = {};
    for (const [d, x] of Object.entries(v as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !x || typeof x !== "object") continue;
      const o = x as { p?: unknown; s?: unknown };
      out[d] = { p: Number(o.p) || 0, s: Number(o.s) || 0 };
    }
    return out;
  } catch {
    return {};
  }
}
