import { createHash, timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { reportsByStatus } from "@/lib/db-scoped/reports";
import { REPORT_STATUSES, reportMarkdown } from "@/lib/reports";

// Open problem reports as markdown, for the next fix round (`node scripts/reports.mjs`). Not behind a session —
// authorized by REPORTS_TOKEN instead (?token= or Authorization: Bearer; authz allow-list); without it, disabled.
const digest = (s: string) => createHash("sha256").update(s).digest();

export async function GET(req: NextRequest) {
  const secret = process.env.REPORTS_TOKEN;
  if (!secret) return new Response("Not found", { status: 404 });
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || req.nextUrl.searchParams.get("token") || "";
  if (!timingSafeEqual(digest(given), digest(secret))) return new Response("Unauthorized", { status: 401 });
  const all = req.nextUrl.searchParams.get("all") === "1";
  const rows = await reportsByStatus(all ? [...REPORT_STATUSES] : ["open", "in_progress"]);
  const md = rows.length
    ? `# Nexus reports — ${rows.length} ${all ? "in total" : "open"}\n\n${rows.map((r) => reportMarkdown({ ...r, githubIssue: r.githubIssue ?? null })).join("\n\n---\n\n")}\n`
    : `# Nexus reports\n\nNo ${all ? "" : "open "}reports.\n`;
  return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
}
