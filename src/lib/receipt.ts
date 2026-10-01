import "server-only";
import { generateJson, type AiFile } from "./ai";
import { mockAi } from "./assistant";
import { linesToRecheck, pickBetter, checkReceipt, type ReceiptCheck } from "./receipt-check";
import type { ReceiptLine } from "./receipt-match";

/** What was read from a receipt / order confirmation (normalized). */
export type ReceiptData = {
  kind: "receipt" | "order";
  store: string | null;
  /** Order date (ms, local midnight UTC) or null. */
  orderDate: number | null;
  orderNumber: string | null;
  currency: string | null;
  lines: ReceiptLine[];
  shipping: number | null;
  /** Discounts / coupons on the whole document (a positive amount). */
  discount?: number | null;
  total: number | null;
  /** Post-read checks (receipt-check.ts): lines that don't add up carry `check: true`. */
  check?: ReceiptCheck;
};

const PROMPT = `Read this purchase document (a store receipt, invoice, or an online order confirmation email) and extract it.
Return JSON with:
- "kind": "order_confirmation" if it confirms an order that has not been delivered/paid in a store yet (order placed, will ship), otherwise "receipt".
- "store": the store/seller name as printed (e.g. "Amazon", "AliExpress", "KSP"), or null.
- "orderDate": the order/purchase date as YYYY-MM-DD, or null.
- "orderNumber": the order/invoice number, or null.
- "currency": ISO 4217 code of the amounts (ILS for ₪/NIS/ש"ח, USD for $, EUR for €), or null.
- "lines": one entry per purchased product: "name" (the product name as printed, in its original language), "qty" (units, default 1), "unitPrice" (price per unit after discounts, or null), "lineTotal" (qty × unit price as printed, or null). Leave out shipping, taxes, discounts, deposits and fees — they are not products.
- "shipping": the shipping/delivery charge, or null. "discount": the sum of discounts/coupons on the whole order as a positive number, or null. "total": the grand total paid, or null.
Never guess numbers you cannot see; use null.`;

const SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["receipt", "order_confirmation"] },
    store: { type: ["string", "null"] },
    orderDate: { type: ["string", "null"] },
    orderNumber: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, qty: { type: "number" }, unitPrice: { type: ["number", "null"] }, lineTotal: { type: ["number", "null"] } },
        required: ["name", "qty", "unitPrice", "lineTotal"],
      },
    },
    shipping: { type: ["number", "null"] },
    discount: { type: ["number", "null"] },
    total: { type: ["number", "null"] },
  },
  required: ["kind", "store", "orderDate", "orderNumber", "currency", "lines", "shipping", "discount", "total"],
};

type Raw = Partial<{ kind: string; store: unknown; orderDate: unknown; orderNumber: unknown; currency: unknown; lines: unknown; shipping: unknown; discount: unknown; total: unknown }>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Validate whatever the model returned into ReceiptData (drops junk lines, fills unit price from the line total). */
export function normalizeReceipt(raw: Raw | null): ReceiptData | null {
  if (!raw || typeof raw !== "object") return null;
  const lines: ReceiptLine[] = [];
  for (const l of Array.isArray(raw.lines) ? raw.lines.slice(0, 100) : []) {
    const r = l as Record<string, unknown>;
    const name = str(r?.name, 300);
    if (!name) continue;
    const qty = typeof r.qty === "number" && r.qty >= 1 && r.qty <= 10000 ? Math.round(r.qty) : 1;
    const lineTotal = num(r.lineTotal);
    const unitPrice = num(r.unitPrice) ?? (lineTotal != null ? Math.round((lineTotal / qty) * 100) / 100 : null);
    lines.push({ name, qty, unitPrice, lineTotal });
  }
  const cur = str(raw.currency, 3)?.toUpperCase() ?? null;
  const date = str(raw.orderDate, 10);
  const ts = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
  return {
    kind: raw.kind === "order_confirmation" || raw.kind === "order" ? "order" : "receipt",
    store: str(raw.store, 80),
    orderDate: Number.isFinite(ts) && ts <= Date.now() + 86_400_000 ? ts : null,
    orderNumber: str(raw.orderNumber, 60),
    currency: cur && /^[A-Z]{3}$/.test(cur) ? cur : null,
    lines,
    shipping: num(raw.shipping),
    discount: num(raw.discount),
    total: num(raw.total),
  };
}

/**
 * Mock mode (offline smoke): reads a tiny text format instead of calling Gemini —
 * "Store: X", "Order: N", "Date: YYYY-MM-DD", "Currency: ILS", "Order confirmation", and lines "2 x Name @ 12.50".
 */
export function parseMockReceipt(text: string): Raw {
  const field = (k: string) => text.match(new RegExp(`^\\s*${k}:\\s*(.+)$`, "im"))?.[1].trim() ?? null;
  const lines = [...text.matchAll(/^\s*(\d+)\s*[x×]\s*(.+?)\s*@\s*([\d.]+)\s*$/gim)].map((m) => ({ name: m[2], qty: Number(m[1]), unitPrice: Number(m[3]), lineTotal: null }));
  return {
    kind: /order confirmation|אישור הזמנה/i.test(text) ? "order_confirmation" : "receipt",
    store: field("Store"),
    orderDate: field("Date"),
    orderNumber: field("Order"),
    currency: field("Currency") ?? "ILS",
    lines,
    shipping: Number(field("Shipping")) || null,
    total: Number(field("Total")) || null,
  };
}

type ReadInput = { files?: AiFile[]; text?: string };
const TILES = "\nThe images are consecutive parts of ONE long receipt, top to bottom, cut with some overlap: a line that appears at the bottom of one part and the top of the next is ONE line — count it once.";

/** One read: images (Gemini only — other providers can't read images/PDFs) or text (any provider). */
async function readOnce(input: ReadInput, extra = "", budgetMs = 45_000): Promise<ReceiptData | null> {
  if (mockAi()) return normalizeReceipt(parseMockReceipt(input.text ?? "Store: Mock store\n1 x Mock receipt line @ 10"));
  if (input.files?.length) {
    const prompt = `${PROMPT}${input.files.length > 1 ? TILES : ""}${extra}`;
    return normalizeReceipt(await generateJson<Raw>(prompt, SCHEMA, { files: input.files, mediaResolution: "medium", budgetMs }));
  }
  if (input.text) return normalizeReceipt(await generateJson<Raw>(`${PROMPT}${extra}\n\nDocument text:\n${input.text.slice(0, 20_000)}`, SCHEMA, { budgetMs }));
  return null;
}

/**
 * Read, then check the numbers (qty × unit ≈ line total, Σ ≈ total). When they don't add up: one targeted retry naming
 * the suspicious lines; the better read is kept and lines still off are marked `check` for the review screen.
 */
export async function extractReceipt(input: ReadInput & { file?: AiFile }): Promise<ReceiptData | null> {
  const req: ReadInput = { files: input.files ?? (input.file ? [input.file] : undefined), text: input.text };
  const t0 = Date.now();
  const first = await readOnce(req);
  if (!first || !first.lines.length) return first;
  const c = checkReceipt(first);
  if (c.ok || mockAi() || Date.now() - t0 > 30_000) return pickBetter(first, null);
  const names = linesToRecheck(first, c).map((i) => `"${first.lines[i].name}"`).join(", ");
  const hint = `\nA first read did not add up${c.diff != null ? ` (lines + shipping − discount = ${c.computed}, printed total ${first.total})` : ""}. Re-read carefully, especially: ${names}. Check each quantity, unit price and line total against the document.`;
  const retry = await readOnce(req, hint, Math.max(8_000, 50_000 - (Date.now() - t0))).catch(() => null);
  return pickBetter(first, retry);
}
