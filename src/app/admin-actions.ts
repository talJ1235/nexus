"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { aiAllowance, resetAiToday as resetAiUsage, writeAiQuota, type Allowance } from "@/lib/ai-gate";
import { forgetSessions } from "@/lib/auth/session";
import { logSecurityEvent } from "@/lib/auth/events";
import { AccessError, isAdmin, requireCtx, type Ctx } from "@/lib/ctx";
import { markAccountDeletion, soleOwnerBlocks } from "@/lib/db-scoped/account";
import { adminAiStats, adminLive, adminPeople, adminPerson, adminSystemDb, revokeUserSession, revokeUserSessions, setUserBanned, userExists } from "@/lib/db-scoped/admin";
import { logActivity, recordBeat } from "@/lib/db-scoped/presence";
import { parseBeat, platformOf } from "@/lib/presence-keys";
import { adminNavCounts, adminReport, adminReports, cronSummary } from "@/lib/db-scoped/admin-health";
import { setReportStatusAdmin } from "@/lib/db-scoped/reports";

// R17 G — the admin panel (/admin). Admin only (ADMIN_EMAIL's user); everyone else gets "not found", same as the
// pages (test:admin-access). Counts only, never content (test:admin-privacy greps every action's JSON).

async function admin() {
  const ctx = await requireCtx("view");
  if (!isAdmin(ctx)) throw new AccessError("not_found");
  return ctx;
}

const UserId = z.string().min(4).max(64);

/** The admin page's own presence rides on its polls (one request per poll, not a poll + a beat). */
async function beat(ctx: Ctx, raw: unknown) {
  const b = parseBeat(raw);
  if (!b) return;
  const h = await headers();
  await recordBeat({ userId: ctx.user.id, sessionId: ctx.session.id, spaceId: ctx.space.id }, { ...b, platform: platformOf(h.get("user-agent") ?? "", h.get("sec-ch-ua-platform")?.replace(/"/g, "")) });
}

/** The sidebar / tab bar counts: online now, open reports, open errors, waitlist. */
export async function getAdminNav(b?: unknown) {
  const ctx = await admin();
  await beat(ctx, b);
  return adminNavCounts();
}

/** Live (polled every 5 s while visible) + the nav counts in the same answer. */
export async function getLive(b?: unknown) {
  const ctx = await admin();
  await beat(ctx, b);
  const [live, nav] = await Promise.all([adminLive(), adminNavCounts()]);
  return { ...live, nav };
}

export async function listPeople() {
  await admin();
  return adminPeople();
}

export async function getPerson(userId: string) {
  await admin();
  return adminPerson(UserId.parse(userId));
}

/** A person's AI today (switch, limit, used). */
export async function getAiAllowance(userId: string): Promise<Allowance> {
  await admin();
  return aiAllowance(UserId.parse(userId));
}

/** A person's daily limit: a number (0–1000), "unlimited", or null = back to the default (40). */
export async function setAiQuota(userId: string, limit: number | "unlimited" | null): Promise<Allowance> {
  const ctx = await admin();
  const id = UserId.parse(userId);
  const v = z.union([z.number().int().min(0).max(1000), z.literal("unlimited"), z.null()]).parse(limit);
  await writeAiQuota(id, v);
  await logSecurityEvent(id, "admin_ai_limit", { by: ctx.user.id, limit: v ?? "default" }, await headers());
  return aiAllowance(id);
}

/** Today's AI count starts again from zero for this person. */
export async function resetAiToday(userId: string): Promise<Allowance> {
  const ctx = await admin();
  const id = UserId.parse(userId);
  await resetAiUsage(id);
  await logSecurityEvent(id, "admin_ai_reset", { by: ctx.user.id }, await headers());
  return aiAllowance(id);
}

/** Sign out one of a person's devices. */
export async function signOutDevice(userId: string, sessionId: string) {
  const ctx = await admin();
  const id = UserId.parse(userId);
  const ok = await revokeUserSession(id, z.string().min(4).max(128).parse(sessionId));
  forgetSessions();
  if (ok) await logSecurityEvent(id, "admin_sign_out", { by: ctx.user.id, scope: "device" }, await headers());
  return adminPerson(id);
}

export async function signOutEverywhere(userId: string) {
  const ctx = await admin();
  const id = UserId.parse(userId);
  if (id === ctx.user.id) return { ok: false as const, reason: "self" as const };
  await revokeUserSessions(id);
  forgetSessions();
  await logSecurityEvent(id, "admin_sign_out", { by: ctx.user.id, scope: "all" }, await headers());
  return { ok: true as const, person: await adminPerson(id) };
}

/** Ban (all sessions end, sign-in refused) or lift it. Never yourself. */
export async function setBan(userId: string, on: boolean) {
  const ctx = await admin();
  const id = UserId.parse(userId);
  if (id === ctx.user.id) return { ok: false as const, reason: "self" as const };
  if (!(await userExists(id))) throw new AccessError("not_found");
  await setUserBanned(id, z.boolean().parse(on));
  forgetSessions();
  await logSecurityEvent(id, on ? "admin_ban" : "admin_unban", { by: ctx.user.id }, await headers());
  return { ok: true as const, person: await adminPerson(id) };
}

/** Hold to delete (≥ 2 s on the client): the same deletion as Settings → Delete account (E4) — hidden at once,
 *  7 days to undo by signing in, purged by the daily job. A sole owner of a shared space with members → refused with
 *  the list. Never yourself. */
export async function deleteUserAccount(userId: string): Promise<{ ok: true } | { ok: false; reason: "self" } | { ok: false; reason: "owner"; spaces: string[] }> {
  const ctx = await admin();
  const id = UserId.parse(userId);
  if (id === ctx.user.id) return { ok: false, reason: "self" };
  if (!(await userExists(id))) throw new AccessError("not_found");
  const blocks = await soleOwnerBlocks(id);
  if (blocks.length) return { ok: false, reason: "owner", spaces: blocks.map((b) => b.name) };
  await markAccountDeletion(id);
  forgetSessions();
  await logSecurityEvent(id, "account_deletion_requested", { by: ctx.user.id }, await headers());
  await logActivity(id, null, "deletion_requested");
  return { ok: true };
}

export async function getAiStats(days: 7 | 30) {
  await admin();
  return adminAiStats(z.union([z.literal(7), z.literal(30)]).parse(days));
}

/** Services, the daily job's last run, DB size + rows per table, keys set / missing (names only, never values). */
export async function getSystem() {
  await admin();
  const [dbInfo, cron] = await Promise.all([adminSystemDb(), cronSummary()]);
  const keys = KEYS.map(([name, group]) => ({ name, group, set: !!process.env[name] }));
  return { db: dbInfo, cron, keys, storeReader: !!process.env.CF_FETCH_URL, realtime: !!process.env.ABLY_API_KEY, issues: !!process.env.GITHUB_ISSUES_TOKEN };
}

const KEYS: [string, string][] = [
  ["TURSO_DATABASE_URL", "db"],
  ["TURSO_AUTH_TOKEN", "db"],
  ["BETTER_AUTH_SECRET", "auth"],
  ["GOOGLE_CLIENT_ID", "auth"],
  ["GOOGLE_CLIENT_SECRET", "auth"],
  ["ADMIN_EMAIL", "auth"],
  ["ADMIN_EMERGENCY_TOKEN", "auth"],
  ["GEMINI_API_KEY", "ai"],
  ["GROQ_API_KEY", "ai"],
  ["OPENROUTER_API_KEY", "ai"],
  ["ABLY_API_KEY", "live"],
  ["BLOB_READ_WRITE_TOKEN", "files"],
  ["CF_FETCH_URL", "stores"],
  ["CRON_SECRET", "jobs"],
  ["GITHUB_ISSUES_TOKEN", "reports"],
  ["REPORTS_TOKEN", "reports"],
  ["RESEND_API_KEY", "mail"],
];

export async function listAdminReports() {
  await admin();
  return { rows: await adminReports(), issues: !!process.env.GITHUB_ISSUES_TOKEN };
}

export async function getAdminReport(id: string) {
  await admin();
  return adminReport(z.string().min(1).max(64).parse(id));
}

/** Open / In progress / Fixed — returns the admin view of the report (never the assistant exchange). */
export async function setAdminReportStatus(id: string, status: "open" | "in_progress" | "fixed" | "wont_fix") {
  await admin();
  const rid = z.string().min(1).max(64).parse(id);
  await setReportStatusAdmin(rid, z.enum(["open", "in_progress", "fixed", "wont_fix"]).parse(status));
  return adminReport(rid);
}
