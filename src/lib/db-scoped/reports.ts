import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

// Problem reports (Round 8 D3). R15: each report carries its sender (user_id); a user sees their own, the admin
// sees every report (content of spaces is never attached — only what the sender typed and the diagnostics).

type NewReport = Omit<typeof schema.reports.$inferInsert, "userId">;

export async function insertReport(userId: string, row: NewReport) {
  await db.insert(schema.reports).values({ ...row, userId });
  const [r] = await db.select().from(schema.reports).where(eq(schema.reports.id, row.id)).limit(1);
  return r;
}

export async function listReportsFor(userId: string, admin: boolean) {
  const q = db.select().from(schema.reports);
  return (admin ? q : q.where(eq(schema.reports.userId, userId))).orderBy(desc(schema.reports.createdAt)).limit(200);
}

/** Admin only (the caller checks). */
export async function setReportStatusAdmin(id: string, status: (typeof schema.reports.$inferSelect)["status"]) {
  await db.update(schema.reports).set({ status, updatedAt: Date.now() }).where(eq(schema.reports.id, id));
  const [r] = await db.select().from(schema.reports).where(eq(schema.reports.id, id)).limit(1);
  return r ?? null;
}

export async function setReportIssue(id: string, issue: number) {
  await db.update(schema.reports).set({ githubIssue: issue }).where(eq(schema.reports.id, id));
}

/** For scripts/reports.mjs (REPORTS_TOKEN): reports by status, oldest first. */
export async function reportsByStatus(statuses: (typeof schema.reports.$inferSelect)["status"][]) {
  return db.select().from(schema.reports).where(inArray(schema.reports.status, statuses)).orderBy(asc(schema.reports.createdAt));
}
