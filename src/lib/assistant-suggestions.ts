// Assistant question suggestions built from the user's own data — instant, free, client-side (no AI call).
// Pure: same input → same output, so it is unit-tested in scripts/test-suggestions.ts.
import { budgetStats, lineTotal, spendDate, unitPrice } from "./calc";
import type { Dict } from "./i18n/en";
import type { Rates } from "./money";
import type { AltGroup, Collection, ItemWithSources } from "./types";
import type { View } from "./views";

export type SugTemplates = Dict["ai"]["sug"];
type SugKey = keyof SugTemplates;

/** A rendered suggestion. `parts` keeps inserted names separate so the UI can bidi-isolate them. */
export type Suggestion = {
  family: string;
  text: string;
  parts: { text: string; name?: boolean }[];
  score: number;
};

export type SuggestionInput = {
  items: ItemWithSources[];
  collections: Collection[];
  altGroups: AltGroup[];
  view: View;
  recent: string[];
  now: number;
  rates: Rates;
  currency: string;
  t: SugTemplates;
  /** Fallback questions for new/empty accounts and to fill up to `limit`. */
  fallback: string[];
  limit?: number;
};

const DAY = 86_400_000;
const MAX_NAME = 32;

const short = (s: string) => {
  const v = s.trim().replace(/\s+/g, " ");
  return v.length > MAX_NAME ? `${v.slice(0, MAX_NAME - 1).trimEnd()}…` : v;
};

function render(family: string, key: SugKey, t: SugTemplates, score: number, vars: Record<string, string> = {}): Suggestion {
  const parts: Suggestion["parts"] = [];
  for (const [i, chunk] of t[key].split(/\{(\w+)\}/g).entries()) {
    if (i % 2) parts.push({ text: vars[chunk] ?? `{${chunk}}`, name: true });
    else if (chunk) parts.push({ text: chunk });
  }
  return { family, text: parts.map((p) => p.text).join(""), parts, score };
}

const norm = (s: string) => s.trim().toLowerCase();

export function suggestQuestions(input: SuggestionInput): Suggestion[] {
  const { items, collections, altGroups, view, now, rates, currency, t } = input;
  const limit = input.limit ?? 4;
  const seen = new Set(input.recent.map(norm));
  const out: Suggestion[] = [];

  if (items.length) {
    const c: Suggestion[] = [];
    const toBuy = items.filter((i) => i.status === "to_buy");
    const active = collections.filter((x) => !x.archived);

    // Current view / project context.
    if (view.type === "collection") {
      const col = collections.find((x) => x.id === view.id);
      const left = toBuy.filter((i) => i.collectionId === view.id);
      if (col && left.length) {
        const name = short(col.name);
        c.push(render("context", "projectLeft", t, 100, { project: name }));
        c.push(render("context", "projectMissing", t, 99, { project: name }));
      }
    }

    // Projects near or over budget.
    for (const col of active) {
      const b = budgetStats(col, items, altGroups, rates, currency);
      if (b.state === "over") c.push(render("budget", "budgetOver", t, 90 + Math.min(9, (b.pct ?? 0) / 20), { project: short(col.name) }));
      else if (b.state === "near") c.push(render("budget", "budgetNear", t, 85 + Math.min(4, (b.pct ?? 0) - 90), { project: short(col.name) }));
    }

    // Urgent and not ordered yet.
    const urgent = toBuy.filter((i) => i.priority === "urgent").length;
    if (urgent) c.push(render("urgent", "urgent", t, 70 + Math.min(10, urgent)));

    // Store with the most to-buy items (the one each item would be bought from).
    const stores = new Map<string, { name: string; n: number }>();
    for (const i of toBuy) {
      const s = i.sources.find((x) => x.id === i.chosenSourceId) ?? i.sources[0];
      if (!s) continue;
      const e = stores.get(s.storeKey) ?? { name: s.store, n: 0 };
      e.n++;
      stores.set(s.storeKey, e);
    }
    const viewStore = view.type === "store" ? stores.get(view.key) : null;
    const top = viewStore ?? [...stores.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))[0];
    if (top && (top.n >= 2 || viewStore)) {
      const boost = viewStore ? 45 : view.type === "orders" ? 30 : 0;
      c.push(render("store", "store", t, 50 + Math.min(15, top.n * 3) + boost, { store: short(top.name) }));
    }

    // Orders: late or arriving this week.
    const ordered = items.filter((i) => i.status === "ordered" && i.eta != null);
    const late = ordered.filter((i) => i.eta! < now - DAY / 2).length;
    const soon = ordered.filter((i) => i.eta! >= now - DAY / 2 && i.eta! <= now + 7 * DAY).length;
    if (late) c.push(render("eta", "etaLate", t, 78 + Math.min(10, late)));
    else if (soon) c.push(render("eta", "etaWeek", t, 60 + Math.min(10, soon)));

    // Watched items: at target, or a price drop in the last 7 days.
    let atTarget: ItemWithSources | null = null;
    let drops = 0;
    for (const i of toBuy) {
      if (!i.watch) continue;
      if (!atTarget && i.targetPrice != null) {
        const p = unitPrice(i, rates, i.targetCurrency ?? currency);
        if (p != null && p <= i.targetPrice) atTarget = i;
      }
      const bySource = new Map<string, { price: number; at: number }[]>();
      for (const pt of i.points) bySource.set(pt.sourceId, [...(bySource.get(pt.sourceId) ?? []), { price: pt.price, at: pt.recordedAt }]);
      for (const pts of bySource.values()) {
        pts.sort((a, b) => a.at - b.at);
        const [prev, last] = pts.slice(-2);
        if (last && prev && last.at >= now - 7 * DAY && last.price < prev.price) {
          drops++;
          break;
        }
      }
    }
    if (atTarget) c.push(render("price", "priceTarget", t, 76, { item: short(atTarget.title) }));
    else if (drops) c.push(render("price", "priceDrop", t, 64 + Math.min(8, drops)));

    // Alternatives without a winner.
    for (const g of altGroups) {
      if (g.chosenItemId) continue;
      const opts = toBuy.filter((i) => i.altGroupId === g.id).sort((a, b) => a.createdAt - b.createdAt);
      if (opts.length >= 2) {
        c.push(render("alt", "altChoose", t, 68, { a: short(opts[0].title), b: short(opts[1].title) }));
        break;
      }
    }

    // Many unsorted items.
    const unsorted = toBuy.filter((i) => !i.collectionId).length;
    if (unsorted >= 3 && active.some((x) => x.kind === "project")) c.push(render("unsorted", "unsorted", t, 40 + Math.min(20, unsorted * 2) + (view.type === "unsorted" ? 40 : 0)));

    // Recent additions.
    const fresh = items.filter((i) => i.createdAt >= now - 3 * DAY).length;
    if (fresh) c.push(render("recent", "recent", t, 36 + Math.min(8, fresh)));

    // Spending this month vs last month.
    const d = new Date(now);
    const thisStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const lastStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    let thisMonth = 0;
    let lastMonth = 0;
    for (const i of items) {
      const at = i.status === "to_buy" ? null : spendDate(i);
      if (at == null) continue;
      const v = lineTotal(i, rates, currency) ?? 0;
      if (at >= thisStart) thisMonth += v;
      else if (at >= lastStart) lastMonth += v;
    }
    if (thisMonth && lastMonth) c.push(render("spend", "spendCompare", t, 45 + (view.type === "spending" ? 40 : 0)));
    else if (thisMonth) c.push(render("spend", "spendMonth", t, 38 + (view.type === "spending" ? 40 : 0)));

    // Top per family, highest score first, skipping what was asked recently.
    const families = new Set<string>();
    for (const s of c.sort((a, b) => b.score - a.score)) {
      if (out.length >= limit) break;
      if (families.has(s.family) || seen.has(norm(s.text))) continue;
      families.add(s.family);
      out.push(s);
    }
  }

  for (const text of input.fallback) {
    if (out.length >= limit) break;
    if (seen.has(norm(text)) || out.some((s) => norm(s.text) === norm(text))) continue;
    out.push({ family: "general", text, parts: [{ text }], score: 0 });
  }
  return out;
}

// ---------- recently asked (localStorage, last 5) ----------

const RECENT_KEY = "nexus_ai_recent";

export function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function recordRecent(question: string): string[] {
  const next = [question, ...readRecent().filter((q) => norm(q) !== norm(question))].slice(0, 5);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
  return next;
}
