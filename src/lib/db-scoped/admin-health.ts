import "server-only";
import { count, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { kvGet } from "../kv";
import { ONLINE_MS } from "../presence-keys";

// R17 G0/G5/G7 — the admin panel's health reads: nav counts, reports (the report's own text + diagnostics, never the
// assistant exchange or any space content), the daily job's last run.

export async function adminNavCounts(now = Date.now()) {
  // Online = distinct people (a person on phone + computer counts once).
  const [people, [{ reports }], [{ errors }], [{ waiting }], [{ all }]] = await Promise.all([
    db.selectDistinct({ u: schema.presence.userId }).from(schema.presence).where(gte(schema.presence.updatedAt, now - ONLINE_MS)),
    db.select({ reports: count() }).from(schema.reports).where(eq(schema.reports.status, "open")),
    db.select({ errors: count() }).from(schema.errorEvent).where(inArray(schema.errorEvent.status, ["new", "known"])),
    db.select({ waiting: count() }).from(schema.waitlist).where(isNull(schema.waitlist.invitedAt)),
    db.select({ all: count() }).from(schema.user).where(isNull(schema.user.deletionRequestedAt)),
  ]);
  return { online: people.length, people: Number(all ?? 0), reports: Number(reports ?? 0), errors: Number(errors ?? 0), waiting: Number(waiting ?? 0) };
}

type Diag = {
  client?: { view?: string; viewport?: string; palette?: string; mode?: string; locale?: string; version?: string; device?: string; standalone?: boolean; errors?: { at: number; kind: string; message: string; where?: string }[] } | null;
  server?: { commit?: string } | null;
  space?: { id: string; name: string } | null;
};

export type AdminReportRow = { id: string; type: string; title: string; status: string; createdAt: number; reporter: { id: string | null; name: string | null }; view: string | null };

export async function adminReports(): Promise<AdminReportRow[]> {
  const rows = await db
    .select({ id: schema.reports.id, type: schema.reports.type, title: schema.reports.title, status: schema.reports.status, createdAt: schema.reports.createdAt, userId: schema.reports.userId, diagnostics: schema.reports.diagnostics, name: schema.user.name })
    .from(schema.reports)
    .leftJoin(schema.user, eq(schema.user.id, schema.reports.userId))
    .orderBy(desc(schema.reports.createdAt))
    .limit(300);
  return rows.map((r) => ({ id: r.id, type: r.type, title: r.title, status: r.status, createdAt: r.createdAt, reporter: { id: r.userId, name: r.name ?? null }, view: (r.diagnostics as Diag | null)?.client?.view ?? null }));
}

/** One report: what the person wrote (they sent it to the admin), where and on what, the client errors from the
 *  10 minutes before, the screenshot. The assistant exchange stays out (it's chat). */
export async function adminReport(id: string) {
  const [r] = await db
    .select({ report: schema.reports, name: schema.user.name })
    .from(schema.reports)
    .leftJoin(schema.user, eq(schema.user.id, schema.reports.userId))
    .where(eq(schema.reports.id, id))
    .limit(1);
  if (!r) return null;
  const d = (r.report.diagnostics ?? {}) as Diag;
  const c = d.client ?? null;
  const t = r.report.createdAt;
  return {
    id: r.report.id,
    type: r.report.type,
    title: r.report.title,
    body: r.report.body,
    status: r.report.status,
    createdAt: t,
    githubIssue: r.report.githubIssue ?? null,
    screenshot: r.report.screenshot ?? null,
    reporter: { id: r.report.userId, name: r.name ?? null },
    space: d.space?.name ?? null,
    screen: c ? { view: c.view ?? null, viewport: c.viewport ?? null, mode: c.mode ?? null, palette: c.palette ?? null, locale: c.locale ?? null, device: c.device ?? null } : null,
    installed: c?.standalone ?? null,
    build: (c?.version || d.server?.commit || "").slice(0, 7) || null,
    errors: (c?.errors ?? []).filter((e) => e.at >= t - 10 * 60_000 && e.at <= t + 60_000).map((e) => ({ at: e.at, kind: e.kind, message: e.message.slice(0, 200), where: e.where ?? null })),
  };
}
export type AdminReport = NonNullable<Awaited<ReturnType<typeof adminReport>>>;

/** The daily job's last run (the cron stores its summary in kv `pref:last_check`). */
export async function cronSummary() {
  const raw = await kvGet("pref:last_check");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown> & { at: number; ms?: number };
  } catch {
    return null;
  }
}
