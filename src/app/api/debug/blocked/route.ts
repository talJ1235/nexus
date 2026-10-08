import { type NextRequest } from "next/server";
import { isAdmin, routeCtx } from "@/lib/ctx";
import { extractFromUrl, workerConfigured, type FetchStep } from "@/lib/extract";
import { isPublicHttpUrl } from "@/lib/utils";

export const maxDuration = 60;

// R17 C1 — admin-only probe of the fetch ladder, run on Vercel (its addresses are the ones stores block):
//   GET /api/debug/blocked?url=<product URL>   → per rung: blocked?, fields found, ms (nothing is saved or remembered)
// scripts/blocked-probe.mjs calls it for a list of stores and prints the table for docs/ROUND17.md.
const STEPS: FetchStep[] = ["direct", "woo", "shopify", "worker"];

export async function GET(req: NextRequest) {
  const ctx = await routeCtx("view");
  if (ctx instanceof Response) return ctx;
  if (!isAdmin(ctx)) return Response.json({ error: "not_found" }, { status: 404 });
  const url = req.nextUrl.searchParams.get("url") ?? "";
  if (!isPublicHttpUrl(url)) return Response.json({ error: "bad_url" }, { status: 400 });
  const rows = [];
  for (const step of STEPS) {
    if (step === "worker" && !workerConfigured()) {
      rows.push({ step, skipped: "not configured" });
      continue;
    }
    const t0 = Date.now();
    const ex = await extractFromUrl(url, { only: step }).catch(() => null);
    rows.push({
      step,
      ms: Date.now() - t0,
      blocked: ex ? ex.blocked : true,
      title: !!ex?.title,
      price: ex?.price != null,
      image: !!ex?.image,
      method: ex?.method ?? null,
    });
  }
  const ladder = await extractFromUrl(url, { remember: false }).catch(() => null);
  return Response.json({ url, steps: rows, ladder: ladder ? { via: ladder.via, title: ladder.title, price: ladder.price, currency: ladder.currency, image: !!ladder.image, blocked: ladder.blocked } : null });
}
