"use server";

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { del, put } from "@vercel/blob";
import { z } from "zod";
import { db, schema } from "@/db";
import { splitItem } from "@/app/actions";
import { aiEnabled } from "@/lib/ai";
import { mockAi } from "@/lib/assistant";
import { assertOwner } from "@/lib/auth";
import { activeSource } from "@/lib/calc";
import { getItem, loadItems } from "@/lib/data";
import { convert } from "@/lib/money";
import { getRates } from "@/lib/rates";
import { extractReceipt, type ReceiptData } from "@/lib/receipt";
import { hasRealText } from "@/lib/receipt-check";
import { storeThumbnail } from "@/lib/images";
import { normalizeCategory } from "@/lib/categories";
import { kvGet, kvSet } from "@/lib/kv";
import { matchReceipt, storeMatches, type LineMatch, type MatchCandidate } from "@/lib/receipt-match";
import type { ItemWithSources, Receipt } from "@/lib/types";

/** Only files in our Vercel Blob store are read (the URL is fetched server-side). */
const isBlobUrl = (u: string | null | undefined) => {
  try {
    const url = new URL(u ?? "");
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
};
const MAX_FILE = 20 * 1024 * 1024;

export type ReceiptView = Pick<Receipt, "id" | "name" | "url" | "contentType" | "status" | "createdAt"> & { hasText: boolean };
const view = (r: Receipt): ReceiptView => ({ id: r.id, name: r.name, url: r.url, contentType: r.contentType, status: r.status, createdAt: r.createdAt, hasText: !!r.text });

/** Save an uploaded file (already in Blob) or pasted email text as a receipt, before reading it. */
export async function createReceipt(raw: { file?: { url: string; name: string; contentType?: string | null; size?: number | null }; parts?: string[]; text?: string; name?: string }): Promise<ReceiptView> {
  await assertOwner();
  const input = z
    .object({
      file: z
        .object({ url: z.string().url().refine(isBlobUrl), name: z.string().min(1).max(200), contentType: z.string().max(100).nullish(), size: z.number().int().nonnegative().max(MAX_FILE).nullish() })
        .optional(),
      parts: z.array(z.string().url().refine(isBlobUrl)).max(7).optional(),
      text: z.string().min(10).max(50_000).optional(),
      name: z.string().min(1).max(200).optional(),
    })
    .refine((v) => !!v.file !== !!v.text)
    .parse(raw);
  const id = nanoid(12);
  let file = input.file ?? null;
  if (input.text && process.env.BLOB_READ_WRITE_TOKEN) {
    // Keep pasted text as a file too, so it can be attached to the items like any receipt.
    try {
      const blob = await put(`receipts/${id}/email.txt`, input.text, { access: "public", contentType: "text/plain; charset=utf-8", addRandomSuffix: true });
      file = { url: blob.url, name: input.name ?? "email.txt", contentType: "text/plain", size: Buffer.byteLength(input.text) };
    } catch {
      /* the text itself is still stored */
    }
  }
  const [row] = await db
    .insert(schema.receipts)
    .values({ id, url: file?.url ?? null, parts: input.file && input.parts?.length ? input.parts : null, name: file?.name ?? input.name ?? "email.txt", contentType: file?.contentType ?? (input.text ? "text/plain" : null), size: file?.size ?? null, text: input.text ?? null, createdAt: Date.now() })
    .returning();
  return view(row);
}

export type ReceiptRead = { receipt: ReceiptView; data: ReceiptData; matches: LineMatch[] };

/** Read (or re-read) a receipt with AI and propose a match for every line. The receipt is kept when this fails. */
export async function readReceipt(id: string): Promise<ReceiptRead | { error: "no_ai" | "failed" | "not_found"; receipt?: ReceiptView }> {
  await assertOwner();
  const r = await db.query.receipts.findFirst({ where: eq(schema.receipts.id, z.string().min(1).max(40).parse(id)) });
  if (!r) return { error: "not_found" };
  if (!aiEnabled() && !mockAi()) return { error: "no_ai", receipt: view(r) };

  let data: ReceiptData | null = null;
  try {
    data = await readDocument(r);
  } catch (e) {
    console.warn("[receipt] read failed:", String((e as Error)?.message ?? e).slice(0, 200));
  }
  if (!data || !data.lines.length) {
    await db.update(schema.receipts).set({ status: "failed" }).where(eq(schema.receipts.id, r.id));
    return { error: "failed", receipt: view({ ...r, status: "failed" }) };
  }
  const [row] = await db.update(schema.receipts).set({ status: r.status === "applied" ? "applied" : "extracted", data }).where(eq(schema.receipts.id, r.id)).returning();
  const items = await loadItems();
  const rates = await getRates();
  const candidates: MatchCandidate[] = items
    .filter((i) => i.status !== "purchased")
    .map((i) => {
      const src = activeSource(i, rates);
      return {
        id: i.id,
        title: i.title,
        brand: i.brand,
        quantity: i.quantity,
        stores: i.sources.map((x) => ({ key: x.storeKey, name: x.store })),
        unitPrice: src?.price != null && data.currency ? convert(src.price, src.currency, data.currency, rates) : null,
      };
    });
  return { receipt: view(row), data, matches: matchReceipt(data.lines, candidates, data.store) };
}

async function fetchBlob(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE) throw new Error("too_big");
  return { buf, type: res.headers.get("content-type") };
}

/**
 * Accuracy first, less AI work: pasted text and PDFs with a real text layer are read as TEXT (cheap, exact); only
 * scans and photos go to vision (all parts of a long receipt in one request). The same document is never read twice
 * (cache by content hash).
 */
async function readDocument(r: Receipt): Promise<ReceiptData | null> {
  const hash = createHash("sha256");
  let text = r.text;
  let files: { mimeType: string; data: string }[] = [];
  if (!text && r.url && isBlobUrl(r.url)) {
    const urls = [r.url, ...((r.parts as string[] | null) ?? []).filter(isBlobUrl)];
    const got = await Promise.all(urls.map(fetchBlob));
    const mime = (i: number) => ((i === 0 ? r.contentType : null) || got[i].type || "application/pdf").split(";")[0];
    for (const [i, g] of got.entries()) {
      hash.update(g.buf);
      if (mime(i).startsWith("text/")) text = g.buf.toString("utf8");
      else if (mime(i) === "application/pdf" && got.length === 1) {
        const pdfText = await pdfTextLayer(g.buf);
        if (hasRealText(pdfText)) text = pdfText;
        else files.push({ mimeType: "application/pdf", data: g.buf.toString("base64") });
      } else files.push({ mimeType: mime(i), data: g.buf.toString("base64") });
    }
    if (text) files = [];
  } else if (text) hash.update(text);
  const key = `receipt-read:${hash.digest("hex").slice(0, 40)}`;
  if (!mockAi()) {
    const cached = await kvGet(key).catch(() => null);
    if (cached) return JSON.parse(cached) as ReceiptData;
  }
  const data = text ? await extractReceipt({ text }) : files.length ? await extractReceipt({ files }) : null;
  if (data?.lines.length && !mockAi()) await kvSet(key, JSON.stringify(data)).catch(() => {});
  return data;
}

async function pdfTextLayer(buf: Buffer): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  } catch {
    return null;
  }
}

/** Receipts that were uploaded but not applied yet (read failed, AI was down, or the review was closed). */
export async function listReceipts(): Promise<ReceiptView[]> {
  await assertOwner();
  const rows = await db.select().from(schema.receipts).where(ne(schema.receipts.status, "applied")).orderBy(desc(schema.receipts.createdAt)).limit(20);
  return rows.map(view);
}

/** Drop an unapplied receipt (its file too, unless an item still has it attached). */
export async function deleteReceipt(id: string): Promise<void> {
  await assertOwner();
  const [row] = await db.delete(schema.receipts).where(eq(schema.receipts.id, z.string().max(40).parse(id))).returning();
  if (row?.url) await deleteBlobIfUnused(row.url);
}

async function deleteBlobIfUnused(url: string) {
  const [att, rec] = await Promise.all([
    db.select({ id: schema.attachments.id }).from(schema.attachments).where(eq(schema.attachments.url, url)).limit(1),
    db.select({ id: schema.receipts.id }).from(schema.receipts).where(eq(schema.receipts.url, url)).limit(1),
  ]);
  if (att.length || rec.length) return;
  try {
    await del(url);
  } catch {
    /* already gone */
  }
}

// ---------- Apply / undo ----------

const applyInput = z.object({
  receiptId: z.string().min(1).max(40),
  kind: z.enum(["receipt", "order"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  orderNumber: z.string().max(60).nullable(),
  orderDate: z.number().int().nullable(),
  lines: z
    .array(
      z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("match"), unitPrice: z.number().nonnegative().nullable(), allocations: z.array(z.object({ itemId: z.string().min(1).max(40), qty: z.number().int().min(1).max(100000) })).min(1).max(10) }),
        z.object({
          mode: z.literal("new"),
          name: z.string().min(1).max(300),
          qty: z.number().int().min(1).max(100000),
          unitPrice: z.number().nonnegative().nullable(),
          image: z.string().max(200_000).nullish(),
          category: z.string().max(40).nullish(),
          collectionId: z.string().max(40).nullish(),
        }),
        z.object({ mode: z.literal("ignore") }),
      ]),
    )
    .max(100),
});
export type ApplyReceiptInput = z.input<typeof applyInput>;

const before = z.object({
  id: z.string().min(1).max(40),
  status: z.enum(["to_buy", "ordered", "purchased"]),
  orderedAt: z.number().int().nullable(),
  purchasedAt: z.number().int().nullable(),
  purchasedPrice: z.number().nullable(),
  purchasedCurrency: z.string().max(3).nullable(),
  orderNumber: z.string().max(60).nullable(),
});
const undoInput = z.object({
  receiptId: z.string().min(1).max(40),
  items: z.array(before).max(200),
  /** Items split off for a partial purchase: { original, moved } — undo folds them back. */
  splits: z.array(z.object({ originalId: z.string().max(40), movedId: z.string().max(40) })).max(200),
  createdIds: z.array(z.string().max(40)).max(100),
  attachmentIds: z.array(z.string().max(40)).max(300),
  pointIds: z.array(z.string().max(60)).max(300),
});
export type ReceiptUndo = z.infer<typeof undoInput>;

/**
 * Apply a reviewed receipt: matched items become purchased (or ordered, for an order confirmation) with the price
 * paid per unit, order number and date; the receipt is attached to each and a price-history point is logged.
 * Fewer units bought than an item needs → the item is split and only the bought units move on.
 */
export async function applyReceipt(raw: ApplyReceiptInput): Promise<{ items: ItemWithSources[]; undo: ReceiptUndo } | { error: "invalid" }> {
  await assertOwner();
  const input = applyInput.parse(raw);
  const receipt = await db.query.receipts.findFirst({ where: eq(schema.receipts.id, input.receiptId) });
  if (!receipt) return { error: "invalid" };
  const data = receipt.data as ReceiptData | null;
  const itemIds = [...new Set(input.lines.flatMap((l) => (l.mode === "match" ? l.allocations.map((a) => a.itemId) : [])))];
  const all = itemIds.length ? await loadItems() : [];
  const byId = new Map(all.filter((i) => itemIds.includes(i.id)).map((i) => [i.id, i]));
  if (byId.size !== itemIds.length) return { error: "invalid" };
  const allocs = input.lines.flatMap((l) => (l.mode === "match" ? l.allocations : []));
  if (new Set(allocs.map((a) => a.itemId)).size !== allocs.length) return { error: "invalid" }; // one line per item

  const t = Date.now();
  const status = input.kind === "order" ? "ordered" : "purchased";
  const rates = await getRates();
  const undo: ReceiptUndo = { receiptId: receipt.id, items: [], splits: [], createdIds: [], attachmentIds: [], pointIds: [] };
  const touched: string[] = [];

  const attach = async (itemId: string) => {
    if (!receipt.url) return;
    const id = nanoid(12);
    await db.insert(schema.attachments).values({ id, itemId, url: receipt.url, name: receipt.name, contentType: receipt.contentType, size: receipt.size, createdAt: t });
    undo.attachmentIds.push(id);
  };

  for (const line of input.lines) {
    if (line.mode === "ignore") continue;
    const paid = line.unitPrice != null ? { purchasedPrice: line.unitPrice, purchasedCurrency: input.currency } : {};
    if (line.mode === "new") {
      const id = nanoid();
      const image = line.image ? (line.image.startsWith("data:image/svg") ? line.image : await storeThumbnail(line.image, id)) : null;
      await db.insert(schema.items).values({
        id,
        title: line.name,
        imageUrl: image,
        imageSource: image ? (image.startsWith("data:image/svg") ? "icon" : "store") : null,
        category: normalizeCategory(line.category),
        collectionId: line.collectionId && (await db.query.collections.findFirst({ where: eq(schema.collections.id, line.collectionId) })) ? line.collectionId : null,
        tags: [],
        status,
        quantity: line.qty,
        orderedAt: input.orderDate ?? t,
        purchasedAt: status === "purchased" ? (input.orderDate ?? t) : null,
        orderNumber: input.orderNumber,
        watch: false,
        createdAt: t,
        updatedAt: t,
        ...paid,
      });
      undo.createdIds.push(id);
      touched.push(id);
      await attach(id);
      continue;
    }
    for (const a of line.allocations) {
      const cur = byId.get(a.itemId)!;
      let target = cur;
      if (a.qty < cur.quantity) {
        target = (await splitItem(cur.id, a.qty, cur.collectionId)).moved;
        undo.splits.push({ originalId: cur.id, movedId: target.id });
        touched.push(cur.id);
      } else {
        undo.items.push({ id: cur.id, status: cur.status, orderedAt: cur.orderedAt, purchasedAt: cur.purchasedAt, purchasedPrice: cur.purchasedPrice, purchasedCurrency: cur.purchasedCurrency, orderNumber: cur.orderNumber });
      }
      await db
        .update(schema.items)
        .set({
          status,
          orderedAt: status === "ordered" ? (input.orderDate ?? t) : (cur.orderedAt ?? input.orderDate ?? null),
          purchasedAt: status === "purchased" ? (cur.orderedAt ? t : (input.orderDate ?? t)) : null,
          orderNumber: input.orderNumber ?? cur.orderNumber,
          updatedAt: t,
          ...paid,
        })
        .where(eq(schema.items.id, target.id));
      touched.push(target.id);
      await attach(target.id);
      // Price history: on the link at the receipt's store, else the item's active link.
      const src = target.sources.find((x) => storeMatches(data?.store, [{ key: x.storeKey, name: x.store }])) ?? activeSource(target, rates);
      if (src && line.unitPrice != null && line.unitPrice > 0 && src.currency === input.currency) {
        const id = `pp_${crypto.randomUUID().slice(0, 12)}`;
        await db.insert(schema.pricePoints).values({ id, sourceId: src.id, itemId: target.id, price: line.unitPrice, currency: input.currency, recordedAt: t });
        undo.pointIds.push(id);
      }
    }
  }
  await db.update(schema.receipts).set({ status: "applied", appliedAt: t }).where(eq(schema.receipts.id, receipt.id));
  const set = new Set(touched);
  return { items: (await loadItems()).filter((i) => set.has(i.id)), undo };
}

/** Undo an applied receipt: restore the items' previous state, fold split units back, remove what it created. */
export async function undoReceipt(raw: ReceiptUndo): Promise<{ items: ItemWithSources[]; removedIds: string[] }> {
  await assertOwner();
  const u = undoInput.parse(raw);
  const t = Date.now();
  if (u.attachmentIds.length) await db.delete(schema.attachments).where(inArray(schema.attachments.id, u.attachmentIds));
  if (u.pointIds.length) await db.delete(schema.pricePoints).where(inArray(schema.pricePoints.id, u.pointIds));
  for (const { id, ...fields } of u.items) await db.update(schema.items).set({ ...fields, updatedAt: t }).where(eq(schema.items.id, id));
  const removedIds: string[] = [...u.createdIds];
  for (const s of u.splits) {
    const moved = await getItem(s.movedId);
    if (!moved) continue;
    await db.delete(schema.pricePoints).where(eq(schema.pricePoints.itemId, s.movedId));
    await db.delete(schema.sources).where(eq(schema.sources.itemId, s.movedId));
    await db.delete(schema.items).where(eq(schema.items.id, s.movedId));
    const orig = await db.query.items.findFirst({ where: eq(schema.items.id, s.originalId) });
    if (orig) await db.update(schema.items).set({ quantity: orig.quantity + moved.quantity, updatedAt: t }).where(eq(schema.items.id, s.originalId));
    removedIds.push(s.movedId);
  }
  if (u.createdIds.length) {
    await db.delete(schema.attachments).where(inArray(schema.attachments.itemId, u.createdIds));
    await db.delete(schema.items).where(inArray(schema.items.id, u.createdIds));
  }
  await db.update(schema.receipts).set({ status: "extracted", appliedAt: null }).where(and(eq(schema.receipts.id, u.receiptId), eq(schema.receipts.status, "applied")));
  const ids = new Set([...u.items.map((i) => i.id), ...u.splits.map((s) => s.originalId)]);
  return { items: (await loadItems()).filter((i) => ids.has(i.id)), removedIds };
}
