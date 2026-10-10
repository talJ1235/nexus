// R17 S3 — notification kinds and the data each row carries (pure; shared by server, client and service worker texts).
// A row's text is never stored: it is built from `data` + the reader's dictionary at read time (lib/notify/text.ts).

export const NOTIFY_KINDS = ["shop", "activity", "week", "price", "delivery", "budget"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

/** Sent at once (unless quiet hours); the rest wait for the person's active hour. */
export const URGENT: ReadonlySet<NotifyKind> = new Set(["shop", "delivery"]);

/** How long a push service keeps trying (seconds): "shopping now" is stale after an hour. */
export const ttlOf = (k: NotifyKind) => (k === "shop" ? 3600 : 12 * 3600);

export type ShopData = { who: string; whoId: string; space: string; list?: string; left: number | null; total: number | null; done?: boolean; bought?: number };
export type ActivityData = { names: string[]; byIds: string[]; added: number; checked: number; space: string; list?: string };
export type PriceRow = { itemId: string; title: string; store?: string; now: number; was: number | null; currency: string; target?: boolean; pic?: string | null };
export type PriceData = PriceRow & { run: string };
export type DeliveryData = { itemId: string; title: string; store?: string; pic?: string | null; received?: boolean };
export type BudgetData = { space: string; pct: 80 | 100; spent: number; budget: number; currency: string; month: number };
export type WeekData = { bought: number; spent: number; currency: string; drops: number };

export type NotifyData = ShopData | ActivityData | PriceData | DeliveryData | BudgetData | WeekData;

/** N2: the space pref listing the members (besides the owner) who get budget alerts. */
export const BUDGET_TO_KEY = "pref:budget-alerts";
