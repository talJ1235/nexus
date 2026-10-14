// R17 S3 — notification kinds and the data each row carries (pure; shared by server, client and service worker texts).
// A row's text is never stored: it is built from `data` + the reader's dictionary at read time (lib/notify/text.ts).

// R18 B3 / D2: `draft` = the evening-before list (Open list → /supermarket?draft=1); `trip_add` = "Noa added milk" to a
// shopper in the store (first at once, then ≤ 1 per 10 min per trip). R18 S2 D4: `sent` = "Tal sent the list to your
// phone" (the computer's Send to phone).
export const NOTIFY_KINDS = ["shop", "activity", "week", "price", "delivery", "budget", "draft", "trip_add", "sent"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

// R17 S6 U2: every kind is sent at once (quiet hours aside); only the weekly summary waits (Thursday, active hour) and
// activity is held to one push per space per hour (lib/notify/schedule.ts).

/** How long a push service keeps trying (seconds): "shopping now" is stale after an hour. */
export const ttlOf = (k: NotifyKind) => (k === "shop" || k === "trip_add" ? 3600 : 12 * 3600);

export type ShopData = { who: string; whoId: string; space: string; list?: string; left: number | null; total: number | null; done?: boolean; bought?: number };
export type ActivityData = { names: string[]; byIds: string[]; added: number; checked: number; space: string; list?: string };
export type PriceRow = { itemId: string; title: string; store?: string; now: number; was: number | null; currency: string; target?: boolean; pic?: string | null };
export type PriceData = PriceRow & { run: string };
export type DeliveryData = { itemId: string; title: string; store?: string; pic?: string | null; received?: boolean };
export type BudgetData = { space: string; pct: 80 | 100; spent: number; budget: number; currency: string; month: number };
export type WeekData = { bought: number; spent: number; currency: string; drops: number };
export type DraftData = { space: string; items: number; suggested: number; day: string };
export type TripAddData = { who: string; whoIds: string[]; titles: string[]; n: number; space: string; tripId: string };
/** `chain` = a chain id (lib/grocery/chains) or the name the home typed; the reader's language picks the name. */
export type SentData = { who: string; whoId: string; self: boolean; items: number; chain: string | null; branch: string | null; space: string };

export type NotifyData = ShopData | ActivityData | PriceData | DeliveryData | BudgetData | WeekData | DraftData | TripAddData | SentData;

/** N2: the space pref listing the members (besides the owner) who get budget alerts. */
export const BUDGET_TO_KEY = "pref:budget-alerts";
