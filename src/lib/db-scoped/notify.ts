import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db";
import type { NotifyKind } from "../notify/kinds";

// R17 S3 J1 — the inbox (`notification`) and the browsers' push addresses (`push_subscription`). Rows belong to a person
// (user_id), not to a space: every read and write here is keyed by the signed-in user's id or runs as the system
// dispatcher. Admin reads are counts only (N3).

export const INBOX_KEEP_MS = 30 * 86_400_000;
export const SUB_MAX_FAILS = 5;

export type NotificationRow = typeof schema.notification.$inferSelect;

export async function notificationByGroup(userId: string, groupKey: string) {
  const [r] = await db.select().from(schema.notification).where(and(eq(schema.notification.userId, userId), eq(schema.notification.groupKey, groupKey))).limit(1);
  return r ?? null;
}

/**
 * Write or update the row for (user, group_key). An update is news again: unread, back in the inbox if it was swiped
 * away, and due to send per `sendAfter` (null = inbox only). `pushState` "off" = the person's switch is off.
 */
export async function upsertNotification(r: { userId: string; spaceId: string | null; kind: NotifyKind; groupKey: string; data: unknown; sendAfter: number | null; pushState: "due" | "off" | "skipped" | null; now: number }) {
  const data = JSON.stringify(r.data ?? {});
  const send = { sendAfter: r.sendAfter, sentAt: null, pushState: r.pushState };
  await db
    .insert(schema.notification)
    .values({ id: nanoid(14), userId: r.userId, spaceId: r.spaceId, kind: r.kind, groupKey: r.groupKey, data, createdAt: r.now, updatedAt: r.now, ...send })
    .onConflictDoUpdate({ target: [schema.notification.userId, schema.notification.groupKey], set: { data, updatedAt: r.now, readAt: null, deletedAt: null, ...send } });
}

/**
 * Update only the data (live "6 of 15 left" while a trip runs, "Marked received") — no new push, read state, time and
 * place in the list kept.
 */
export async function patchNotificationData(userIds: string[], groupKey: string, data: unknown) {
  if (!userIds.length) return;
  await db
    .update(schema.notification)
    .set({ data: JSON.stringify(data ?? {}) })
    .where(and(inArray(schema.notification.userId, userIds), eq(schema.notification.groupKey, groupKey)));
}

export async function notificationsByGroup(groupKey: string) {
  return db.select().from(schema.notification).where(eq(schema.notification.groupKey, groupKey));
}

/** The inbox: 30 days, newest first, not swiped away. */
/** R17 Q1: price news is for owners and members — a viewer's price rows (from before this rule) stay hidden. */
const notViewerPrice = sql`NOT (${schema.notification.kind} = 'price' AND EXISTS (SELECT 1 FROM space_member m WHERE m.space_id = ${schema.notification.spaceId} AND m.user_id = ${schema.notification.userId} AND m.role = 'viewer'))`;

export async function inboxRows(userId: string, now = Date.now(), limit = 200) {
  return db
    .select()
    .from(schema.notification)
    .where(and(eq(schema.notification.userId, userId), isNull(schema.notification.deletedAt), gte(schema.notification.updatedAt, now - INBOX_KEEP_MS), notViewerPrice))
    .orderBy(desc(schema.notification.updatedAt))
    .limit(limit);
}

export async function unreadCount(userId: string, now = Date.now()) {
  const [r] = await db
    .select({ n: count() })
    .from(schema.notification)
    .where(and(eq(schema.notification.userId, userId), isNull(schema.notification.deletedAt), isNull(schema.notification.readAt), gte(schema.notification.updatedAt, now - INBOX_KEEP_MS), notViewerPrice));
  return r?.n ?? 0;
}

export async function markNotificationsRead(userId: string, ids: string[] | "all", now = Date.now()) {
  const mine = and(eq(schema.notification.userId, userId), isNull(schema.notification.readAt));
  if (ids !== "all" && !ids.length) return 0;
  const r = await db
    .update(schema.notification)
    .set({ readAt: now })
    .where(ids === "all" ? mine : and(mine, inArray(schema.notification.id, ids.slice(0, 200))));
  return r.rowsAffected;
}

export async function deleteNotification(userId: string, id: string, now = Date.now()) {
  const r = await db
    .update(schema.notification)
    .set({ deletedAt: now, readAt: sql`coalesce(${schema.notification.readAt}, ${now})` })
    .where(and(eq(schema.notification.userId, userId), eq(schema.notification.id, id)));
  return r.rowsAffected > 0;
}

/** The person's own row (the Received action checks the row is theirs before touching the item). */
export async function notificationOf(userId: string, id: string) {
  const [r] = await db.select().from(schema.notification).where(and(eq(schema.notification.userId, userId), eq(schema.notification.id, id))).limit(1);
  return r ?? null;
}

/**
 * The dispatcher's claim: rows due by `now` move to "sent" in the same UPDATE that returns them, so two dispatchers
 * running at once never send a row twice (`sent_at IS NULL` is part of the claim). `userId` = the in-request send.
 */
export async function claimDue(now: number, opts: { userId?: string; limit?: number } = {}) {
  const due = and(
    lte(schema.notification.sendAfter, now),
    isNull(schema.notification.sentAt),
    isNull(schema.notification.deletedAt),
    eq(schema.notification.pushState, "due"),
    notViewerPrice,
    ...(opts.userId ? [eq(schema.notification.userId, opts.userId)] : []),
  );
  const ids = (
    await db
      .select({ id: schema.notification.id })
      .from(schema.notification)
      .where(due)
      .orderBy(asc(schema.notification.sendAfter))
      .limit(opts.limit ?? 500)
  ).map((r) => r.id);
  if (!ids.length) return [];
  return db
    .update(schema.notification)
    .set({ sentAt: now, pushState: "sent" })
    .where(and(inArray(schema.notification.id, ids), isNull(schema.notification.sentAt), eq(schema.notification.pushState, "due")))
    .returning();
}

/** After a send attempt: a person with no working address gets "failed" (the row stays in the inbox). */
export async function setPushState(ids: string[], state: "sent" | "failed" | "skipped") {
  if (!ids.length) return;
  await db.update(schema.notification).set({ pushState: state }).where(inArray(schema.notification.id, ids));
}

/** The last push time per space for activity rows of this person (≤ 1 per space per hour). */
export async function lastActivitySent(userId: string, spaceId: string) {
  const [r] = await db
    .select({ at: schema.notification.sentAt })
    .from(schema.notification)
    .where(and(eq(schema.notification.userId, userId), eq(schema.notification.spaceId, spaceId), eq(schema.notification.kind, "activity"), eq(schema.notification.pushState, "sent")))
    .orderBy(desc(schema.notification.sentAt))
    .limit(1);
  return r?.at ?? null;
}

// ---------- push subscriptions ----------

export async function saveSubscription(userId: string, s: { endpoint: string; p256dh: string; auth: string; device: "phone" | "computer"; label: string | null }, now = Date.now()) {
  // An endpoint belongs to one browser profile: if another account used it before, it moves to this one.
  await db
    .insert(schema.pushSubscription)
    .values({ id: nanoid(14), userId, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, device: s.device, label: s.label, createdAt: now, lastOkAt: null, failCount: 0 })
    .onConflictDoUpdate({ target: schema.pushSubscription.endpoint, set: { userId, p256dh: s.p256dh, auth: s.auth, device: s.device, label: s.label, failCount: 0 } });
}

export async function removeSubscription(userId: string, endpoint: string) {
  const r = await db.delete(schema.pushSubscription).where(and(eq(schema.pushSubscription.userId, userId), eq(schema.pushSubscription.endpoint, endpoint)));
  return r.rowsAffected > 0;
}

export async function subscriptionsOf(userId: string) {
  return db.select().from(schema.pushSubscription).where(and(eq(schema.pushSubscription.userId, userId), lt(schema.pushSubscription.failCount, SUB_MAX_FAILS)));
}

export async function subscriptionOk(id: string, now = Date.now()) {
  await db.update(schema.pushSubscription).set({ lastOkAt: now, failCount: 0 }).where(eq(schema.pushSubscription.id, id));
}

export async function subscriptionFailed(id: string) {
  await db
    .update(schema.pushSubscription)
    .set({ failCount: sql`${schema.pushSubscription.failCount} + 1` })
    .where(eq(schema.pushSubscription.id, id));
}

export async function dropSubscription(id: string) {
  await db.delete(schema.pushSubscription).where(eq(schema.pushSubscription.id, id));
}

/** Daily cron: inbox rows older than 30 days; addresses that failed 5 times in a row. */
export async function purgeNotifications(now = Date.now()) {
  const [a, b] = await db.batch([
    db.delete(schema.notification).where(lt(schema.notification.updatedAt, now - INBOX_KEEP_MS)),
    db.delete(schema.pushSubscription).where(gte(schema.pushSubscription.failCount, SUB_MAX_FAILS)),
  ]);
  return { notifications: a.rowsAffected, subscriptions: b.rowsAffected };
}

/** Delete account (E4): both tables. */
export function purgeNotifyRows(userId: string) {
  return [db.delete(schema.notification).where(eq(schema.notification.userId, userId)), db.delete(schema.pushSubscription).where(eq(schema.pushSubscription.userId, userId))];
}

/** Export (E4): the person's inbox rows (push addresses are device secrets — counted, not exported). */
export async function exportInbox(userId: string) {
  const rows = await db
    .select({ kind: schema.notification.kind, data: schema.notification.data, createdAt: schema.notification.createdAt, updatedAt: schema.notification.updatedAt, readAt: schema.notification.readAt })
    .from(schema.notification)
    .where(and(eq(schema.notification.userId, userId), isNull(schema.notification.deletedAt)))
    .orderBy(desc(schema.notification.updatedAt));
  const [subs] = await db.select({ n: count() }).from(schema.pushSubscription).where(eq(schema.pushSubscription.userId, userId));
  return { notifications: rows.map((r) => ({ ...r, data: safeJson(r.data) })), pushDevices: subs?.n ?? 0 };
}

const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

// ---------- admin (N3): counts only ----------

export async function notifyCounts(dayStartMs: number, now = Date.now()) {
  const subs = await db.select({ device: schema.pushSubscription.device, n: count() }).from(schema.pushSubscription).where(lt(schema.pushSubscription.failCount, SUB_MAX_FAILS)).groupBy(schema.pushSubscription.device);
  const today = gte(schema.notification.sentAt, dayStartMs);
  const [sent] = await db.select({ n: count() }).from(schema.notification).where(and(today, eq(schema.notification.pushState, "sent")));
  const [failed] = await db.select({ n: count() }).from(schema.notification).where(and(today, eq(schema.notification.pushState, "failed")));
  const [due] = await db
    .select({ n: count() })
    .from(schema.notification)
    .where(and(lte(schema.notification.sendAfter, now), isNull(schema.notification.sentAt), isNull(schema.notification.deletedAt), eq(schema.notification.pushState, "due")));
  const by = Object.fromEntries(subs.map((s) => [s.device, s.n]));
  return { phone: by.phone ?? 0, computer: by.computer ?? 0, sentToday: sent?.n ?? 0, failedToday: failed?.n ?? 0, dueNow: due?.n ?? 0 };
}

/** Rows due in the next window (for tests / the dispatcher's summary). */
export async function pendingCount(userId?: string) {
  const [r] = await db
    .select({ n: count() })
    .from(schema.notification)
    .where(and(eq(schema.notification.pushState, "due"), isNull(schema.notification.sentAt), ...(userId ? [eq(schema.notification.userId, userId)] : [])));
  return r?.n ?? 0;
}

// The members of a space other than `exceptUserId` (senders' audience). Viewers are members too: they can read.
export async function spaceAudience(spaceId: string, exceptUserId: string | null) {
  const rows = await db
    .select({ userId: schema.member.userId, role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(eq(schema.member.organizationId, spaceId), isNull(schema.user.deletionRequestedAt), ...(exceptUserId ? [ne(schema.member.userId, exceptUserId)] : [])));
  return rows;
}

/** First names for the rows ("Noa"), never emails. */
export async function firstNames(userIds: string[]) {
  if (!userIds.length) return {} as Record<string, string>;
  const rows = await db.select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds));
  return Object.fromEntries(rows.map((r) => [r.id, (r.name || "").trim().split(/\s+/)[0] || ""]));
}


/** J3: when this person opened the app over the last days (the hidden one-per-hour `hour` activity marks). */
export async function openTimes(userId: string, since: number) {
  const rows = await db
    .select({ at: schema.activity.at })
    .from(schema.activity)
    .where(and(eq(schema.activity.userId, userId), eq(schema.activity.kind, "hour"), gte(schema.activity.at, since)))
    .limit(24 * 15);
  return rows.map((r) => r.at);
}

// ---------- senders (M): small system reads ----------

export async function spaceBrief(spaceId: string) {
  const [r] = await db
    .select({ id: schema.space.id, name: schema.space.name, kind: schema.space.kind, ownerId: schema.space.createdBy, currency: schema.space.currency, deletedAt: schema.space.deletedAt })
    .from(schema.space)
    .where(eq(schema.space.id, spaceId))
    .limit(1);
  return r && r.deletedAt == null ? r : null;
}

/** How many of `kind` this person logged in this space since `since` (activity rows: kinds + counts only). */
export async function countActivity(userId: string, spaceId: string, kind: string, since: number) {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${schema.activity.n}), 0)` })
    .from(schema.activity)
    .where(and(eq(schema.activity.userId, userId), eq(schema.activity.spaceId, spaceId), eq(schema.activity.kind, kind), gte(schema.activity.at, since)));
  return Number(r?.n ?? 0);
}

/** Every person's value of one pref key (open shopping trips). */
export async function prefRows(key: string) {
  return db.select({ userId: schema.userPref.userId, value: schema.userPref.value }).from(schema.userPref).where(eq(schema.userPref.key, key));
}

/** The latest presence beat of a person (idle trips end after 30 min without one on the shopping screen). */
export async function lastBeat(userId: string) {
  const [r] = await db.select({ at: schema.presence.updatedAt, screen: schema.presence.screen }).from(schema.presence).where(eq(schema.presence.userId, userId)).orderBy(desc(schema.presence.updatedAt)).limit(1);
  return r ?? null;
}

/** On-the-way items whose arrival date falls in [from, to) — the delivery sender. */
export async function deliveriesBetween(from: number, to: number) {
  const rows = await db
    .select({ id: schema.items.id, spaceId: schema.items.spaceId, title: schema.items.title, imageUrl: schema.items.imageUrl, eta: schema.items.eta, chosen: schema.items.chosenSourceId })
    .from(schema.items)
    .innerJoin(schema.space, eq(schema.space.id, schema.items.spaceId))
    .where(and(eq(schema.items.status, "ordered"), gte(schema.items.eta, from), lt(schema.items.eta, to), isNull(schema.space.deletedAt)));
  if (!rows.length) return [];
  const srcs = await db.select({ itemId: schema.sources.itemId, id: schema.sources.id, store: schema.sources.store }).from(schema.sources).where(inArray(schema.sources.itemId, rows.map((r) => r.id)));
  return rows.map((r) => ({ ...r, store: (srcs.find((s) => s.id === r.chosen) ?? srcs.find((s) => s.itemId === r.id))?.store ?? null }));
}

/** People who opened the app in the last `days` days and still have an account (the weekly summary's audience). */
export async function activePeople(since: number) {
  const rows = await db
    .selectDistinct({ userId: schema.activity.userId })
    .from(schema.activity)
    .innerJoin(schema.user, eq(schema.user.id, schema.activity.userId))
    .where(and(eq(schema.activity.kind, "opened"), gte(schema.activity.at, since), isNull(schema.user.deletionRequestedAt)));
  return rows.map((r) => r.userId);
}

/** The spaces a person belongs to (live ones). */
export async function spacesOf(userId: string) {
  return db
    .select({ id: schema.space.id, name: schema.space.name, kind: schema.space.kind, role: schema.member.role })
    .from(schema.member)
    .innerJoin(schema.space, eq(schema.space.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), isNull(schema.space.deletedAt)));
}

/** Spaces with a monthly budget set (any month) — the budget sender's work list. */
export async function spacesWithBudget() {
  const rows = await db
    .selectDistinct({ spaceId: schema.spacePref.spaceId })
    .from(schema.spacePref)
    .innerJoin(schema.space, eq(schema.space.id, schema.spacePref.spaceId))
    .where(and(sql`${schema.spacePref.key} like 'pref:budget:%'`, isNull(schema.space.deletedAt)));
  return rows.map((r) => r.spaceId);
}
