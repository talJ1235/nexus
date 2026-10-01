import { createHash, timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { asc, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { REPORT_STATUSES, reportMarkdown } from "@/lib/reports";

// Open problem reports as markdown, for the next fix round (`node scripts/reports.mjs`). Not behind the owner
// cookie (proxy) — authorized by REPORTS_TOKEN instead (?token= or Authorization: Bearer); without it, disabled.
const digest = (s: string) => createHash("sha256").update(s).digest();

export async function GET(req: NextRequest) {
  const secret = process.env.REPORTS_TOKEN;
  if (!secret) return new Response("Not found", { status: 404 });
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || req.nextUrl.searchParams.get("token") || "";
  if (!timingSafeEqual(digest(given), digest(secret))) return new Response("Unauthorized", { status: 401 });
  const all = req.nextUrl.searchParams.get("all") === "1";
  const rows = await db
    .select()
    .from(schema.reports)
    .where(inArray(schema.reports.status, all ? [...REPORT_STATUSES] : ["open", "in_progress"]))
    .orderBy(asc(schema.reports.createdAt));
  const md = rows.length
    ? `# Nexus reports — ${rows.length} ${all ? "in total" : "open"}\n\n${rows.map((r) => reportMarkdown({ ...r, githubIssue: r.githubIssue ?? null })).join("\n\n---\n\n")}\n`
    : `# Nexus reports\n\nNo ${all ? "" : "open "}reports.\n`;
  return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" } });
}
