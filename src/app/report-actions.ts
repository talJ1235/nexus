"use server";

import { nanoid } from "nanoid";
import { after } from "next/server";
import { z } from "zod";
import { schema } from "@/db";
import { isAdmin, requireCtx } from "@/lib/ctx";
import { insertReport, listReportsFor, setReportIssue, setReportStatusAdmin } from "@/lib/db-scoped/reports";
import { clientDiagSchema } from "@/lib/diag-schema";
import { serverDiag } from "@/lib/help/server";
import { REPORT_STATUSES, REPORT_TYPES, reportBody, reportMarkdown, reportTitle, type ReportDiag, type ReportRow } from "@/lib/reports";

// Problem reports (Round 8 D3): any signed-in user; stored in `reports` with the sender (R15), and a GitHub issue
// when GITHUB_ISSUES_TOKEN is set. No Telegram (D2). Users list their own reports; the admin lists all.

const input = z.strictObject({
  type: z.enum(REPORT_TYPES),
  // Round 9 D1: the form has one text box; the title comes from it unless the assistant drafted one.
  title: z.string().trim().max(120).optional(),
  happened: z.string().trim().min(1).max(4000),
  steps: z.string().max(2000).default(""),
  expected: z.string().max(2000).default(""),
  actual: z.string().max(2000).default(""),
  diag: clientDiagSchema.nullable().optional(),
  assistant: z.object({ question: z.string().max(4000), answer: z.string().max(4000) }).nullable().optional(),
  // R16 C1: from a failure toast. The link is stored as domain + path only (no query string), whatever the client sends.
  failure: z.strictObject({ code: z.string().max(60), what: z.string().max(120), link: z.string().max(400).nullable() }).nullable().optional(),
  // A picked screenshot, shrunk in the browser to a JPEG data URL.
  screenshot: z.string().max(1_500_000).regex(/^data:image\/(jpeg|png|webp);base64,/).nullable().optional(),
});

export type ReportView = ReportRow & { screenshot: string | null };

/** "https://shop.example/p/drill?ref=x#y" → "shop.example/p/drill" (null when not an http link). */
function linkDomainPath(link: string | null) {
  if (!link) return null;
  try {
    const u = new URL(link);
    return /^https?:$/.test(u.protocol) ? `${u.hostname.replace(/^www\./, "")}${u.pathname}`.slice(0, 300) : null;
  } catch {
    return null;
  }
}
const view = (r: typeof schema.reports.$inferSelect): ReportView => ({ ...r, githubIssue: r.githubIssue ?? null });

export async function createReport(raw: z.input<typeof input>): Promise<ReportView> {
  const ctx = await requireCtx("view");
  const parsed = input.parse(raw);
  const f = { ...parsed, title: parsed.title || reportTitle(parsed.happened) };
  const server = await serverDiag();
  const diagnostics: ReportDiag = {
    client: f.diag ?? null,
    server: { commit: server.commit, aiProviders: server.aiProviders, blob: server.blob, telegram: server.telegram },
    assistant: f.assistant ?? null,
    screenshot: !!f.screenshot,
    failure: f.failure ? { ...f.failure, link: linkDomainPath(f.failure.link) } : null,
  };
  const now = Date.now();
  const row = await insertReport(ctx.user.id, { id: `r_${nanoid(10)}`, type: f.type, title: f.title, body: reportBody(f), diagnostics, screenshot: f.screenshot ?? null, status: "open", createdAt: now, updatedAt: now });
  const report = view(row);
  // Notifications don't hold up the answer (and never fail the report).
  after(async () => {
    const md = reportMarkdown(report);
    const issue = await openGithubIssue(report, md).catch(() => null);
    if (issue) await setReportIssue(report.id, issue);
  });
  return report;
}

export async function listReports(): Promise<ReportView[]> {
  const ctx = await requireCtx("view");
  return (await listReportsFor(ctx.user.id, isAdmin(ctx))).map(view);
}

export async function setReportStatus(id: string, status: (typeof REPORT_STATUSES)[number]): Promise<ReportView | null> {
  const ctx = await requireCtx("view");
  if (!isAdmin(ctx)) throw new Error("forbidden");
  const s = z.enum(REPORT_STATUSES).parse(status);
  const row = await setReportStatusAdmin(z.string().min(1).max(40).parse(id), s);
  return row ? view(row) : null;
}

/** Optional: a GitHub issue labelled from-app (fine-grained token, Issues read/write on the repo). */
async function openGithubIssue(r: ReportView, md: string): Promise<number | null> {
  const token = process.env.GITHUB_ISSUES_TOKEN;
  if (!token) return null;
  const repo = process.env.GITHUB_ISSUES_REPO || "talJ1235/nexus";
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
    body: JSON.stringify({ title: `[${r.type}] ${r.title}`, body: md, labels: ["from-app"] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { number?: number };
  return typeof j.number === "number" ? j.number : null;
}
