import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { verifyExtensionRequest } from "@/lib/ext-token";
import { getItem } from "@/lib/data";
import { parseHtml } from "@/lib/extract";
import { missingDetails, refreshSourceCore } from "@/lib/service";
import { checkSourceFromHtml, checkSourceFromPayload, sendAlertDigest } from "@/lib/tracker";

export const maxDuration = 60;

const body = z.union([
  z.object({ done: z.literal(true) }),
  z.object({
    sourceId: z.string().max(40),
    finalUrl: z.string().max(2000).optional(),
    html: z.string().max(3_000_000).optional(),
    payload: z.object({ price: z.union([z.string(), z.number()]).nullish(), currency: z.string().max(8).nullish(), availability: z.string().max(60).nullish() }).optional(),
  }),
]);

export async function POST(req: Request) {
  if (!(await verifyExtensionRequest(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  let b: z.infer<typeof body>;
  try {
    b = body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if ("done" in b) return Response.json(await sendAlertDigest(new URL(req.url).origin));
  const src = await db.query.sources.findFirst({ where: eq(schema.sources.id, b.sourceId) });
  if (!src) return Response.json({ error: "not_found" }, { status: 404 });
  // Incomplete link (name/price/picture missing) → repair the whole item from what the browser read.
  const item = await getItem(src.itemId);
  if (item && b.html && missingDetails(src, item)) {
    const p = parseHtml(b.html, b.finalUrl || src.url);
    if (p.title || p.price != null) {
      const fixed = await refreshSourceCore(src.id, { url: src.url, title: p.title, price: p.price, currency: p.currency, image: p.image, brand: p.brand, siteName: p.siteName, description: p.description });
      return Response.json({ ok: true, repaired: !missingDetails(fixed.sources.find((s) => s.id === src.id) ?? src, fixed), alerts: 0 });
    }
  }
  const alerts = b.payload ? await checkSourceFromPayload(src, b.payload) : b.html ? await checkSourceFromHtml(src, b.html, b.finalUrl) : null;
  return Response.json({ ok: alerts != null, alerts: alerts?.length ?? 0 });
}
