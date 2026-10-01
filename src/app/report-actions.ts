"use server";

import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { assertOwner } from "@/lib/auth";
import { clientDiagSchema } from "@/lib/diag-schema";
import { serverDiag } from "@/lib/help/server";
import { REPORT_STATUSES, REPORT_TYPES, reportBody, reportMarkdown, type ReportDiag, type ReportRow } from "@/lib/reports";
import { escapeHtml, publicOrigin, sendTelegram } from "@/lib/telegram";

// Problem reports (Round 8 D3): owner-only (guests can't use the assistant or report). Stored in `reports`, one
// Telegram message per new report when Telegram is linked, and a GitHub issue when GITHUB_ISSUES_TOKEN is set.

const input = z.object({
  type: z.enum(REPORT_TYPES),
  title: z.string().trim().min(1).max(120),
  happened: z.string().max(4000).default(""),
  steps: z.string().max(2000).default(""),
  expected: z.string().max(2000).default(""),
  actual: z.string().max(2000).default(""),
  diag: clientDiagSchema.nullable().optional(),
  assistant: z.object({ question: z.string().max(4000), answer: z.string().max(4000) }).nullable().optional(),
  // A picked screenshot, shrunk in the browser to a JPEG data URL.
  screenshot: z.string().max(1_500_000).regex(/^data:image\/(jpeg|png|webp);base64,/).nullable().optional(),
});

export type ReportView = ReportRow & { screenshot: string | null };
const view = (r: typeof schema.reports.$inferSelect): ReportView => ({ ...r, githubIssue: r.githubIssue ?? null });

export async function createReport(raw: z.input<typeof input>): Promise<ReportView> {
  await assertOwner();
  const f = input.parse(raw);
  const server = await serverDiag();
  const diagnostics: ReportDiag = {
    client: f.diag ?? null,
    server: { commit: server.commit, aiProviders: server.aiProviders, blob: server.blob, telegram: server.telegram },
    assistant: f.assistant ?? null,
    screenshot: !!f.screenshot,
  };
  const now = Date.now();
  const [row] = await db
    .insert(schema.reports)
    .values({ id: `r_${nanoid(10)}`, type: f.type, title: f.title, body: reportBody(f), diagnostics, screenshot: f.screenshot ?? null, status: "open", createdAt: now, updatedAt: now })
    .returning();
  const report = view(row);
  // Notifications don't hold up the answer (and never fail the report).
  after(async () => {
    const md = reportMarkdown(report);
    const issue = await openGithubIssue(report, md).catch(() => null);
    if (issue) await db.update(schema.reports).set({ githubIssue: issue }).where(eq(schema.reports.id, report.id));
    const origin = publicOrigin("");
    const label = { bug: "🐞 Bug", complaint: "😕 Complaint", idea: "💡 Idea" }[report.type];
    await sendTelegram(
      `<b>${label}: ${escapeHtml(report.title)}</b>\n${escapeHtml(report.body.replace(/\*\*/g, "").slice(0, 600))}${issue ? `\nGitHub #${issue}` : ""}${origin ? `\n${origin}/?panel=reports` : ""}`,
    ).catch(() => false);
  });
  return report;
}

export async function listReports(): Promise<ReportView[]> {
  await assertOwner();
  return (await db.select().from(schema.reports).orderBy(desc(schema.reports.createdAt)).limit(200)).map(view);
}

export async function setReportStatus(id: string, status: (typeof REPORT_STATUSES)[number]): Promise<ReportView | null> {
  await assertOwner();
  const s = z.enum(REPORT_STATUSES).parse(status);
  const [row] = await db.update(schema.reports).set({ status: s, updatedAt: Date.now() }).where(eq(schema.reports.id, z.string().min(1).max(40).parse(id))).returning();
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
