// R16 A1 — one rule set for status changes (server actions, the client's optimistic update and Undo).
// No status change loses a price the user had: leaving Received / On the way with a paid price keeps it as "last paid";
// coming back pre-fills the paid price from it when no new price is given.

export type Status = "to_buy" | "ordered" | "purchased";
export type Paid = { price: number; currency: string } | null;

export type StatusFields = {
  orderedAt: number | null;
  purchasedPrice: number | null;
  purchasedCurrency: string | null;
  lastPaidPrice?: number | null;
  lastPaidCurrency?: string | null;
};

export type StatusPatch = {
  status: Status;
  orderedAt: number | null;
  purchasedAt: number | null;
  purchasedPrice?: number | null;
  purchasedCurrency?: string | null;
  lastPaidPrice?: number | null;
  lastPaidCurrency?: string | null;
  updatedAt: number;
};

export function statusPatch(status: Status, paid: Paid, current: StatusFields | undefined, t = Date.now()): StatusPatch {
  if (status === "to_buy") {
    const keep = current?.purchasedPrice != null ? { lastPaidPrice: current.purchasedPrice, lastPaidCurrency: current.purchasedCurrency } : {};
    return { status, orderedAt: null, purchasedAt: null, purchasedPrice: null, purchasedCurrency: null, ...keep, updatedAt: t };
  }
  const price = paid
    ? { purchasedPrice: paid.price, purchasedCurrency: paid.currency }
    : current?.purchasedPrice != null
      ? {}
      : current?.lastPaidPrice != null
        ? { purchasedPrice: current.lastPaidPrice, purchasedCurrency: current.lastPaidCurrency ?? null }
        : { purchasedPrice: null, purchasedCurrency: null };
  if (status === "ordered") return { status, orderedAt: t, purchasedAt: null, ...price, updatedAt: t };
  return { status, orderedAt: current?.orderedAt ?? null, purchasedAt: t, ...price, updatedAt: t };
}
