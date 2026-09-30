import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { assertOwner } from "@/lib/auth";
import { getItem } from "@/lib/data";
import { parseHtml } from "@/lib/extract";
import { missingDetails, refreshSourceCore } from "@/lib/service";

export const maxDuration = 60;

// Owner-only (session proxy + assertOwner). The `heal` GitHub workflow posts the page it read for an
// incomplete link (scripts/heal-links.mjs); we parse it here with the normal extractor and repair the item.
const body = z.object({ sourceId: z.string().max(40), finalUrl: z.string().max(2000).optional(), html: z.string().max(400_000) });

export async function POST(req: Request) {
  try {
    await assertOwner();
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let b: z.infer<typeof body>;
  try {
    b = body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const src = await db.query.sources.findFirst({ where: eq(schema.sources.id, b.sourceId) });
  const item = src ? await getItem(src.itemId) : null;
  if (!src || !item) return Response.json({ error: "not_found" }, { status: 404 });
  if (!missingDetails(src, item)) return Response.json({ ok: true, repaired: false, reason: "complete" });
  const p = parseHtml(b.html, b.finalUrl || src.url);
  if (!p.title && !p.image) return Response.json({ ok: false, reason: "empty" });
  const fixed = await refreshSourceCore(src.id, { url: src.url, title: p.title, price: p.price, currency: p.currency, image: p.image, brand: p.brand, siteName: p.siteName, description: p.description });
  const s = fixed.sources.find((x) => x.id === src.id);
  return Response.json({ ok: true, repaired: Boolean(s && !missingDetails(s, fixed)), title: fixed.title, image: Boolean(fixed.imageUrl), price: s?.price ?? null });
}
