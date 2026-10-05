// R15 B4: CSP violation reports (report-uri in src/proxy.ts). Only counts are kept — per day and violated directive
// (no URLs, no bodies), for the admin "System" view in R16. Authz allow-list: counter, reads nothing.
import { hitLimit } from "@/lib/auth/limits";

export async function POST(req: Request) {
  let directive = "unknown";
  try {
    const body = (await req.json()) as { "csp-report"?: { "violated-directive"?: string; "effective-directive"?: string } };
    const r = body?.["csp-report"];
    directive = String(r?.["effective-directive"] ?? r?.["violated-directive"] ?? "unknown").split(" ")[0].replace(/[^a-z-]/g, "").slice(0, 40) || "unknown";
  } catch {
    /* not JSON */
  }
  const day = new Date().toISOString().slice(0, 10);
  await hitLimit(`csp:${day}:${directive}`, Number.MAX_SAFE_INTEGER, 2 * 86_400_000).catch(() => {});
  return new Response(null, { status: 204 });
}
