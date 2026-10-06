"use server";

import { z } from "zod";
import { AccessError, isAdmin, requireCtx } from "@/lib/ctx";
import { errorOverflow, listErrors, setErrorStatusRow } from "@/lib/db-scoped/errors";
import type { ErrorEvent } from "@/db/schema";

// R16 C2 — /admin/errors (the seed of R17's admin panel). Admin only (ADMIN_EMAIL's user); counts, never people.

const Status = z.enum(["new", "known", "fixed"]);

async function admin() {
  const ctx = await requireCtx("view");
  if (!isAdmin(ctx)) throw new AccessError("not_found");
  return ctx;
}

export async function listErrorEvents(opts: { status?: ("new" | "known" | "fixed")[]; sort?: "last" | "count" } = {}): Promise<{ rows: ErrorEvent[]; overflow: number; issues: boolean }> {
  await admin();
  const o = z.object({ status: z.array(Status).max(3).optional(), sort: z.enum(["last", "count"]).optional() }).strict().parse(opts);
  const [rows, overflow] = await Promise.all([listErrors({ status: o.status, sort: o.sort }), errorOverflow()]);
  return { rows, overflow, issues: !!process.env.GITHUB_ISSUES_TOKEN };
}

export async function setErrorStatus(fingerprint: string, status: "new" | "known" | "fixed"): Promise<ErrorEvent | null> {
  await admin();
  return setErrorStatusRow(z.string().min(8).max(40).parse(fingerprint), Status.parse(status));
}

/** A GitHub issue for one error (when GITHUB_ISSUES_TOKEN is set): the redacted fields only. */
export async function createErrorIssue(fingerprint: string): Promise<number | null> {
  await admin();
  const token = process.env.GITHUB_ISSUES_TOKEN;
  if (!token) return null;
  const fp = z.string().min(8).max(40).parse(fingerprint);
  const row = (await listErrors({ limit: 1000 })).find((r) => r.fingerprint === fp);
  if (!row) throw new AccessError("not_found");
  const repo = process.env.GITHUB_ISSUES_REPO || "talJ1235/nexus";
  const body = [`**${row.kind} · ${row.code}** at \`${row.where}\``, "", `- seen ${row.count}× by ${row.users} people · first ${new Date(row.firstSeen).toISOString()} · last ${new Date(row.lastSeen).toISOString()}`, `- release ${row.release ?? "?"} · fingerprint \`${row.fingerprint}\``, "", "```", row.sample ?? row.message, "```"].join("\n");
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" },
    body: JSON.stringify({ title: `[error] ${row.kind}/${row.code}: ${row.message.slice(0, 80)}`, body, labels: ["from-app", "error-log"] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { number?: number };
  if (typeof j.number === "number") await setErrorStatusRow(fp, "known");
  return typeof j.number === "number" ? j.number : null;
}
