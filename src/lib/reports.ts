// Problem reports (Round 8 D3), pure: the body a report is stored with, the markdown handed to Claude Code / GitHub,
// and the ```nexus-report block the assistant drafts. Unit-tested in scripts/test-reports.ts.
import type { ClientDiag } from "./client-diag";

export const REPORT_TYPES = ["bug", "complaint", "idea"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_STATUSES = ["open", "in_progress", "fixed", "wont_fix"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** What the user fills in (or the assistant drafts). */
export type ReportFields = { type: ReportType; title: string; happened: string; steps: string; expected: string; actual: string };

/** Attached automatically. */
export type ReportDiag = {
  client?: ClientDiag | null;
  server?: { commit: string | null; aiProviders: string[]; blob: boolean; telegram: boolean } | null;
  assistant?: { question: string; answer: string } | null;
  screenshot?: boolean;
};

export type ReportRow = {
  id: string;
  type: ReportType;
  title: string;
  body: string;
  diagnostics: unknown;
  status: ReportStatus;
  githubIssue: number | null;
  createdAt: number;
  updatedAt: number;
};

const SECTIONS: [keyof ReportFields, string][] = [
  ["happened", "What happened"],
  ["steps", "Steps"],
  ["expected", "Expected"],
  ["actual", "Actual"],
];

/** The stored body: the filled-in sections as markdown (empty ones left out). */
export function reportBody(f: ReportFields): string {
  return SECTIONS.filter(([k]) => f[k]?.trim())
    .map(([k, label]) => `**${label}**\n${f[k].trim()}`)
    .join("\n\n");
}

const TYPE_LABEL: Record<ReportType, string> = { bug: "Bug", complaint: "Complaint", idea: "Idea" };
const fence = (s: string) => s.replace(/```/g, "ʼʼʼ");

/** Markdown for Claude Code / a GitHub issue / the export endpoint: everything needed to start fixing it. */
export function reportMarkdown(r: ReportRow): string {
  const d = (r.diagnostics ?? {}) as ReportDiag;
  const c = d.client;
  const lines = [
    `## ${TYPE_LABEL[r.type]}: ${r.title}`,
    "",
    `- Report \`${r.id}\` · ${r.status.replace("_", " ")} · ${new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 16)} UTC${r.githubIssue ? ` · GitHub #${r.githubIssue}` : ""}`,
    "",
    r.body || "_(no description)_",
    "",
    "**Diagnostics**",
  ];
  if (c)
    lines.push(
      `- View: ${c.view} · ${c.device} · viewport ${c.viewport}`,
      `- Theme: ${c.palette} ${c.mode} · locale ${c.locale} · ${c.online ? "online" : "offline"}`,
      `- App version: ${d.server?.commit ?? c.version} · extension: ${c.extension ? `v${c.extension}` : "not detected"}`,
    );
  else if (d.server?.commit) lines.push(`- App version: ${d.server.commit}`);
  if (d.server) lines.push(`- Server: AI ${d.server.aiProviders.join("/") || "none"} · Blob ${d.server.blob ? "yes" : "no"} · Telegram ${d.server.telegram ? "linked" : "no"}`);
  if (d.screenshot) lines.push("- Screenshot: attached in the app (Reports)");
  if (c?.errors.length) {
    lines.push("", `**Last ${c.errors.length} client errors** (oldest first)`, "```");
    for (const e of c.errors) lines.push(fence(`${new Date(e.at).toISOString().slice(11, 19)} ${e.kind}: ${e.message}${e.where ? ` (${e.where})` : ""}`));
    lines.push("```");
  }
  if (d.assistant) lines.push("", "**Last assistant exchange**", `> ${fence(d.assistant.question).replace(/\n/g, "\n> ")}`, "", fence(d.assistant.answer.slice(0, 1500)));
  return lines.join("\n");
}

export const REPORT_FENCE = "nexus-report";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Pull the assistant's drafted report (```nexus-report {json}```) out of an answer; malformed → null. */
export function parseReportBlock(text: string): { text: string; report: ReportFields | null } {
  const re = new RegExp("```" + REPORT_FENCE + "\\s*([\\s\\S]*?)```", "m");
  const m = text.match(re);
  if (!m) return { text, report: null };
  const rest = text.replace(m[0], "").trim();
  try {
    const j = JSON.parse(m[1]) as Record<string, unknown>;
    const type = REPORT_TYPES.includes(j.type as ReportType) ? (j.type as ReportType) : "bug";
    const report: ReportFields = { type, title: clip(j.title, 120), happened: clip(j.happened, 4000), steps: clip(j.steps, 2000), expected: clip(j.expected, 2000), actual: clip(j.actual, 2000) };
    return { text: rest, report: report.title ? report : null };
  } catch {
    return { text: rest, report: null };
  }
}
