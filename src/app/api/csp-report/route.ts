// R15 B4: CSP violation reports (report-uri in src/proxy.ts). Only counts are kept — per day and violated directive
// (no URLs, no bodies), for the admin "System" view. Authz allow-list: counter, reads nothing.
// R16 C2: the same limits as /api/errors (≤ 8 KB, 30/hour per user, 10/hour per IP signed out → 429; browsers don't
// reliably send Origin on CSP reports, so no same-origin check) and each report also lands in the error log (kind csp).
import { hitLimit } from "@/lib/auth/limits";
import { recordError } from "@/lib/errors/record";
import { boundedBody, reporter } from "@/lib/errors/intake";

export async function POST(req: Request) {
  const text = await boundedBody(req);
  if (text == null) return new Response(null, { status: 413 });
  const who = await reporter(req, "csp");
  if (!(await who.take())) return new Response(null, { status: 429 });
  let directive = "unknown";
  try {
    const body = JSON.parse(text) as { "csp-report"?: { "violated-directive"?: string; "effective-directive"?: string } };
    const r = body?.["csp-report"];
    directive = String(r?.["effective-directive"] ?? r?.["violated-directive"] ?? "unknown").split(" ")[0].replace(/[^a-z-]/g, "").slice(0, 40) || "unknown";
  } catch {
    /* not JSON */
  }
  const day = new Date().toISOString().slice(0, 10);
  await hitLimit(`csp:${day}:${directive}`, Number.MAX_SAFE_INTEGER, 2 * 86_400_000).catch(() => {});
  await recordError({ kind: "csp", code: directive, where: "csp", message: `violated ${directive}` }, who.userId);
  return new Response(null, { status: 204 });
}
