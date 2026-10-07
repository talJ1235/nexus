// R16 E1/E2 — Home as a grid of widgets (board HomeCustomize): which widgets, in which order, how wide (desktop
// S/M/L = 3/6/12 of 12 columns; phones half/full) and how tall (1×/2×). Presets set all of it at once; editing
// turns the layout "custom". Saved per user per space (user_pref `pref:home:layout:<space>`, with the user's last
// layout as the fallback for a space they never customised). Pure — scripts/test-home.ts covers it.

export const WIDGETS = [
  // the four numbers (were the header's stats until R16)
  "left", "budget", "way", "saved",
  // the R13 sections
  "suggest", "week", "needs", "ontheway", "pace", "projects", "noticed",
  // E2: new indicators (hidden unless a preset has them)
  "drops", "vslast", "nextdel", "bycat", "most", "activity",
] as const;
export type WidgetId = (typeof WIDGETS)[number];
export type Width = "S" | "M" | "L";
export type PhoneWidth = "half" | "full";
export type LayoutItem = { id: WidgetId; w: Width; h: 1 | 2; p?: PhoneWidth };
export const PRESETS = ["household", "maker", "deals", "minimal"] as const;
export type PresetId = (typeof PRESETS)[number];
export type HomeLayout = { v: 2; preset: PresetId | null; items: LayoutItem[] };

/** Widgets new in R16 (the tray marks them NEW). */
export const NEW_WIDGETS: readonly WidgetId[] = ["drops", "vslast", "nextdel", "bycat", "most", "activity"];
/** Numbers are half width on phones by default; everything else full. */
export const STAT_WIDGETS: readonly WidgetId[] = ["left", "budget", "way", "saved", "vslast", "nextdel"];
/** List widgets show more rows at 2×. */
export const rowsFor = (h: 1 | 2, one = 3, two = 7) => (h === 2 ? two : one);

const it = (id: WidgetId, w: Width, h: 1 | 2 = 1): LayoutItem => ({ id, w, h });

/**
 * The presets, exactly as the board HomeCustomize (the other R13 sections — projects, pace, Nexus noticed — are in Maker /
 * Deal watcher and in the tray; a saved R13 layout keeps them). In a personal space "Space today" makes no sense →
 * "Deliveries" (the R13 On the way list) instead.
 */
export function presetItems(p: PresetId, shared = true): LayoutItem[] {
  const list: LayoutItem[] =
    p === "household"
      ? [it("left", "S"), it("budget", "S"), it("way", "S"), it("saved", "S"), it("suggest", "M"), it("week", "M"), it("needs", "M", 2), it("activity", "M"), it("nextdel", "M")]
      : p === "maker"
        ? [it("projects", "M", 2), it("suggest", "M"), it("left", "S"), it("way", "S"), it("drops", "S"), it("budget", "S"), it("pace", "M"), it("needs", "M")]
        : p === "deals"
          ? [it("drops", "M", 2), it("saved", "S"), it("budget", "S"), it("suggest", "M"), it("vslast", "S"), it("nextdel", "S"), it("pace", "M")]
          : [it("left", "M"), it("budget", "M"), it("suggest", "L")];
  return shared ? list : list.map((x) => (x.id === "activity" ? { ...x, id: "ontheway" } : x));
}
export const defaultLayout = (shared = true): HomeLayout => ({ v: 2, preset: "household", items: presetItems("household", shared) });

export const SPAN: Record<Width, number> = { S: 3, M: 6, L: 12 };
export const phoneWidth = (x: LayoutItem): PhoneWidth => x.p ?? (STAT_WIDGETS.includes(x.id) && x.w !== "L" ? "half" : "full");
const isWidget = (v: unknown): v is WidgetId => typeof v === "string" && (WIDGETS as readonly string[]).includes(v);

/** A stored layout (JSON) → a valid one, or null (unknown widgets dropped, duplicates removed, sizes clamped). */
export function parseLayout(raw: string | null | undefined): HomeLayout | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { v?: number; preset?: unknown; items?: unknown };
    if (v?.v !== 2 || !Array.isArray(v.items)) return null;
    const seen = new Set<string>();
    const items: LayoutItem[] = [];
    for (const x of v.items.slice(0, 40) as Record<string, unknown>[]) {
      if (!x || !isWidget(x.id) || seen.has(x.id)) continue;
      seen.add(x.id);
      const w: Width = x.w === "S" || x.w === "L" ? x.w : "M";
      const h = x.h === 2 ? 2 : 1;
      items.push({ id: x.id, w, h, ...(x.p === "half" || x.p === "full" ? { p: x.p } : {}) });
    }
    const preset = (PRESETS as readonly string[]).includes(v.preset as string) ? (v.preset as PresetId) : null;
    return { v: 2, preset, items };
  } catch {
    return null;
  }
}

/**
 * The R13 cookie ("suggest.week.-needs…", hidden ones prefixed "-") → a v2 layout: the four numbers first (they were
 * always in the header), then the sections in the person's order, without the hidden ones.
 */
export function fromLegacy(cookie: string | null | undefined): HomeLayout | null {
  if (!cookie) return null;
  const legacy = ["suggest", "week", "needs", "ontheway", "pace", "projects", "noticed"];
  const order: string[] = [];
  const hidden = new Set<string>();
  for (const raw of cookie.split(".")) {
    const id = raw.replace(/^-/, "");
    if (!legacy.includes(id) || order.includes(id)) continue;
    order.push(id);
    if (raw.startsWith("-")) hidden.add(id);
  }
  if (!order.length) return null;
  for (const id of legacy) if (!order.includes(id)) order.push(id);
  const half: Record<string, Width> = { needs: "M", ontheway: "M", pace: "M", projects: "M" };
  const items = [it("left", "S"), it("budget", "S"), it("way", "S"), it("saved", "S"), ...order.filter((id) => !hidden.has(id)).map((id) => it(id as WidgetId, half[id] ?? "L"))];
  return { v: 2, preset: null, items };
}

export const serialize = (l: HomeLayout) => JSON.stringify({ v: 2, preset: l.preset, items: l.items.map(({ id, w, h, p }) => ({ id, w, h, ...(p ? { p } : {}) })) });

// ---- edits (each turns the layout custom) ----
export function moveTo(l: HomeLayout, id: WidgetId, to: number): HomeLayout {
  const from = l.items.findIndex((x) => x.id === id);
  if (from < 0) return l;
  const items = l.items.slice();
  const [x] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(items.length, to)), 0, x);
  return items.every((y, k) => y === l.items[k]) ? l : { ...l, preset: null, items };
}
export const patch = (l: HomeLayout, id: WidgetId, p: Partial<Omit<LayoutItem, "id">>): HomeLayout => ({ ...l, preset: null, items: l.items.map((x) => (x.id === id ? { ...x, ...p } : x)) });
export const remove = (l: HomeLayout, id: WidgetId): HomeLayout => ({ ...l, preset: null, items: l.items.filter((x) => x.id !== id) });
export function add(l: HomeLayout, id: WidgetId, at = l.items.length): HomeLayout {
  if (l.items.some((x) => x.id === id)) return l;
  const items = l.items.slice();
  items.splice(at, 0, it(id, STAT_WIDGETS.includes(id) ? "S" : "M"));
  return { ...l, preset: null, items };
}
/** Widgets not on Home (the tray), new ones first. */
export const unused = (l: HomeLayout): WidgetId[] => WIDGETS.filter((id) => !l.items.some((x) => x.id === id)).sort((a, b) => Number(NEW_WIDGETS.includes(b)) - Number(NEW_WIDGETS.includes(a)));

/** Resize by dragging the corner: a horizontal delta in columns → the nearest of S/M/L; vertical → 1× / 2×. */
export function sizeFromDrag(start: LayoutItem, dCols: number, dRows: number): Pick<LayoutItem, "w" | "h"> {
  const target = SPAN[start.w] + dCols;
  const w = (["S", "M", "L"] as const).reduce((best, x) => (Math.abs(SPAN[x] - target) < Math.abs(SPAN[best] - target) ? x : best), start.w);
  const h = (start.h + (dRows >= 0.5 ? 1 : dRows <= -0.5 ? -1 : 0)) >= 2 ? 2 : 1;
  return { w, h };
}
