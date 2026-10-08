"use server";

import { createHash } from "node:crypto";
import { storedSource } from "@/lib/picture-rank";
import type { LineInfo } from "@/lib/product-lines";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { del, put } from "@vercel/blob";
import { z } from "zod";
import { schema } from "@/db";
import { splitItem } from "@/app/actions";
import { aiEnabled } from "@/lib/ai";
import { aiUseOf, type AiUse } from "@/lib/ai-gate";
import { mockAi } from "@/lib/assistant";
import { requireCtx } from "@/lib/ctx";
import { scoped, type Scoped } from "@/lib/db-scoped";
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
/** New receipts: only files the upload route put under this space (spaces/<spaceId>/…). */
const inSpaceBlob = (s: Scoped) => (u: string) => {
  try {
    return isBlobUrl(u) && new URL(u).pathname.startsWith(`/spaces/${s.spaceId}/`);
  } catch {
    return false;
  }
};
const MAX_FILE = 20 * 1024 * 1024;

export type ReceiptView = Pick<Receipt, "id" | "name" | "url" | "contentType" | "status" | "createdAt"> & { hasText: boolean };
const view = (r: Receipt): ReceiptView => ({ id: r.id, name: r.name, url: r.url, contentType: r.contentType, status: r.status, createdAt: r.createdAt, hasText: !!r.text });

/** Save an uploaded file (already in Blob) or pasted email text as a receipt, before reading it. */
export async function createReceipt(raw: { file?: { url: string; name: string; contentType?: string | null; size?: number | null }; parts?: string[]; text?: string; name?: string }): Promise<ReceiptView> {
  const s = scoped(await requireCtx("edit"));
  const own = inSpaceBlob(s);
  const input = z
    .object({
      file: z
        .object({ url: z.string().url().refine(own), name: z.string().min(1).max(200), contentType: z.string().max(100).nullish(), size: z.number().int().nonnegative().max(MAX_FILE).nullish() })
        .strict()
        .optional(),
      parts: z.array(z.string().url().refine(own)).max(7).optional(),
      text: z.string().min(10).max(50_000).optional(),
      name: z.string().min(1).max(200).optional(),
    })
    .strict()
    .refine((v) => !!v.file !== !!v.text)
    .parse(raw);
  const id = nanoid(12);
  let file = input.file ?? null;
  if (input.text && process.env.BLOB_READ_WRITE_TOKEN) {
    // Keep pasted text as a file too, so it can be attached to the items like any receipt.
    try {
      const blob = await put(`spaces/${s.spaceId}/receipts/${id}/email.txt`, input.text, { access: "public", contentType: "text/plain; charset=utf-8", addRandomSuffix: true });
      file = { url: blob.url, name: input.name ?? "email.txt", contentType: "text/plain", size: Buffer.byteLength(input.text) };
    } catch {
      /* the text itself is still stored */
    }
  }
  await s.insert(schema.receipts, { id, url: file?.url ?? null, parts: input.file && input.parts?.length ? input.parts : null, name: file?.name ?? input.name ?? "email.txt", contentType: file?.contentType ?? (input.text ? "text/plain" : null), size: file?.size ?? null, text: input.text ?? null, createdAt: Date.now() });
  return view((await s.byId(schema.receipts, id))!);
}

export type ReceiptRead = { receipt: ReceiptView; data: ReceiptData; matches: LineMatch[] };

/** Read (or re-read) a receipt with AI and propose a match for every line. The receipt is kept when this fails. */
export async function readReceipt(id: string): Promise<ReceiptRead | { error: "no_ai" | "failed" | "not_found"; receipt?: ReceiptView }> {
  const s = scoped(await requireCtx("edit"));
  const r = await s.byId(schema.receipts, z.string().min(1).max(40).parse(id));
  if (!r) return { error: "not_found" };
  if (!aiEnabled() && !mockAi()) return { error: "no_ai", receipt: view(r) };

  let data: ReceiptData | null = null;
  try {
    data = await readDocument(r, aiUseOf(s, "receipt"));
  } catch (e) {
    console.warn("[receipt] read failed:", String((e as Error)?.message ?? e).slice(0, 200));
  }
  if (!data || !data.lines.length) {
    await s.update(schema.receipts, { status: "failed" }, eq(schema.receipts.id, r.id));
    return { error: "failed", receipt: view({ ...r, status: "failed" }) };
  }
  await s.update(schema.receipts, { status: r.status === "applied" ? "applied" : "extracted", data }, eq(schema.receipts.id, r.id));
  const row = (await s.byId(schema.receipts, r.id))!;
  const items = await loadItems(s);
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
async function readDocument(r: Receipt, use: AiUse): Promise<ReceiptData | null> {
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
  const data = text ? await extractReceipt({ text, use }) : files.length ? await extractReceipt({ files, use }) : null;
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
  const s = scoped(await requireCtx("view"));
  const rows = await s.select(schema.receipts, ne(schema.receipts.status, "applied")).orderBy(desc(schema.receipts.createdAt)).limit(20);
  return rows.map(view);
}

/** Drop an unapplied receipt (its file too, unless an item still has it attached). */
export async function deleteReceipt(id: string): Promise<void> {
  const s = scoped(await requireCtx("edit"));
  const row = await s.byId(schema.receipts, z.string().max(40).parse(id));
  if (!row) return;
  await s.delete(schema.receipts, eq(schema.receipts.id, row.id));
  if (row.url) await deleteBlobIfUnused(s, row.url);
}

async function deleteBlobIfUnused(s: Scoped, url: string) {
  const [att, rec] = await Promise.all([
    s.pick({ id: schema.attachments.id }, schema.attachments, eq(schema.attachments.url, url)).limit(1),
    s.pick({ id: schema.receipts.id }, schema.receipts, eq(schema.receipts.url, url)).limit(1),
  ]);
  if (att.length || rec.length) return;
  try {
    await del(url);
  } catch {
    /* already gone */
  }
}

// ---------- Apply / undo ----------

const applyInput = z.strictObject({
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
          // Round 10 D: where the picture came from, the alternatives for the picker, what the product is; the
          // review's Confirm approves the pictures (imageCheck false) unless the owner skipped them.
          imageSource: z.enum(["barcode", "own", "search", "off", "generic", "icon"]).nullish(),
          imageCheck: z.boolean().nullish(),
          candidates: z.array(z.object({ url: z.string().max(200_000), source: z.enum(["barcode", "own", "search", "off", "generic", "icon"]), title: z.string().max(300).nullish(), domain: z.string().max(200).nullish() })).max(6).nullish(),
          info: z.record(z.string(), z.unknown()).nullish(),
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
  const s = scoped(await requireCtx("edit"));
  const input = applyInput.parse(raw);
  const receipt = await s.byId(schema.receipts, input.receiptId);
  if (!receipt) return { error: "invalid" };
  const data = receipt.data as ReceiptData | null;
  const itemIds = [...new Set(input.lines.flatMap((l) => (l.mode === "match" ? l.allocations.map((a) => a.itemId) : [])))];
  const all = itemIds.length ? await loadItems(s, itemIds) : [];
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
    await s.insert(schema.attachments, { id, itemId, url: receipt.url, name: receipt.name, contentType: receipt.contentType, size: receipt.size, createdAt: t });
    undo.attachmentIds.push(id);
  };

  for (const line of input.lines) {
    if (line.mode === "ignore") continue;
    const paid = line.unitPrice != null ? { purchasedPrice: line.unitPrice, purchasedCurrency: input.currency } : {};
    if (line.mode === "new") {
      const id = nanoid();
      const image = line.image ? (line.image.startsWith("data:image/svg") ? line.image : await storeThumbnail(line.image, id)) : null;
      await s.insert(schema.items, {
        id,
        addedByUserId: s.scope.userId,
        title: line.name,
        imageUrl: image,
        imageSource: image ? (line.imageSource ? storedSource({ url: image, source: line.imageSource }) : image.startsWith("data:image/svg") ? "icon" : "store") : null,
        imageCheck: !!image && !!line.imageCheck,
        imageCandidates: line.candidates?.length ? line.candidates : null,
        productInfo: (line.info as LineInfo | undefined) ?? null,
        category: normalizeCategory(line.category),
        collectionId: line.collectionId && (await s.byId(schema.collections, line.collectionId)) ? line.collectionId : null,
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
      await s.update(
        schema.items,
        {
          status,
          orderedAt: status === "ordered" ? (input.orderDate ?? t) : (cur.orderedAt ?? input.orderDate ?? null),
          purchasedAt: status === "purchased" ? (cur.orderedAt ? t : (input.orderDate ?? t)) : null,
          orderNumber: input.orderNumber ?? cur.orderNumber,
          updatedAt: t,
          ...paid,
        },
        eq(schema.items.id, target.id),
      );
      touched.push(target.id);
      await attach(target.id);
      // Price history: on the link at the receipt's store, else the item's active link.
      const src = target.sources.find((x) => storeMatches(data?.store, [{ key: x.storeKey, name: x.store }])) ?? activeSource(target, rates);
      if (src && line.unitPrice != null && line.unitPrice > 0 && src.currency === input.currency) {
        const id = `pp_${crypto.randomUUID().slice(0, 12)}`;
        await s.insert(schema.pricePoints, { id, sourceId: src.id, itemId: target.id, price: line.unitPrice, currency: input.currency, recordedAt: t });
        undo.pointIds.push(id);
      }
    }
  }
  await s.update(schema.receipts, { status: "applied", appliedAt: t }, eq(schema.receipts.id, receipt.id));
  return { items: await loadItems(s, [...new Set(touched)]), undo };
}

/** Undo an applied receipt: restore the items' previous state, fold split units back, remove what it created. */
export async function undoReceipt(raw: ReceiptUndo): Promise<{ items: ItemWithSources[]; removedIds: string[] }> {
  const s = scoped(await requireCtx("edit"));
  const u = undoInput.parse(raw);
  const t = Date.now();
  if (u.attachmentIds.length) await s.delete(schema.attachments, inArray(schema.attachments.id, u.attachmentIds));
  if (u.pointIds.length) await s.delete(schema.pricePoints, inArray(schema.pricePoints.id, u.pointIds));
  for (const { id, ...fields } of u.items) await s.update(schema.items, { ...fields, updatedAt: t }, eq(schema.items.id, id));
  const removedIds: string[] = [];
  for (const sp of u.splits) {
    const moved = await getItem(s, sp.movedId);
    if (!moved) continue;
    await s.delete(schema.pricePoints, eq(schema.pricePoints.itemId, sp.movedId));
    await s.delete(schema.sources, eq(schema.sources.itemId, sp.movedId));
    await s.delete(schema.items, eq(schema.items.id, sp.movedId));
    const orig = await s.byId(schema.items, sp.originalId);
    if (orig) await s.update(schema.items, { quantity: orig.quantity + moved.quantity, updatedAt: t }, eq(schema.items.id, sp.originalId));
    removedIds.push(sp.movedId);
  }
  if (u.createdIds.length) {
    const created = (await s.pick({ id: schema.items.id }, schema.items, inArray(schema.items.id, u.createdIds))).map((r) => r.id);
    if (created.length) {
      await s.delete(schema.attachments, inArray(schema.attachments.itemId, created));
      await s.delete(schema.items, inArray(schema.items.id, created));
      removedIds.push(...created);
    }
  }
  await s.update(schema.receipts, { status: "extracted", appliedAt: null }, and(eq(schema.receipts.id, u.receiptId), eq(schema.receipts.status, "applied")));
  return { items: await loadItems(s, [...new Set([...u.items.map((i) => i.id), ...u.splits.map((x) => x.originalId)])]), removedIds };
}
