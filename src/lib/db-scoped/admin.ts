import "server-only";
import { and, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiDay, aiAllowance, type Allowance } from "../ai-gate";
import { ONLINE_MS, type Device } from "../presence-keys";
import { describeUa } from "../auth/ua";
import { activityRows, dayStart, presenceRows } from "./presence";
import { notifyCounts } from "./notify";

// R17 G — the admin panel's reads. Counts only, never content (MULTIUSER §1): people's names / emails, space names,
// devices, screens (fixed keys), activity kinds + counts, AI call counts. No item title, note, link, chat text, memory
// or receipt ever leaves this file (test:admin-privacy calls every admin action and greps the JSON for the seed's).

const DAY = 86_400_000;

type Who = { id: string; name: string; email: string; role: string | null; createdAt: number; banned: boolean; deletionRequestedAt: number | null };

async function everyone(): Promise<Who[]> {
  const rows = await db
    .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.user.role, createdAt: schema.user.createdAt, banned: schema.user.banned, del: schema.user.deletionRequestedAt })
    .from(schema.user);
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, createdAt: +r.createdAt, banned: !!r.banned, deletionRequestedAt: r.del ?? null }));
}

async function spaceNames(ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; kind: string }>();
  const rows = await db.select({ id: schema.space.id, name: schema.space.name, kind: schema.space.kind }).from(schema.space).where(inArray(schema.space.id, ids));
  return new Map(rows.map((r) => [r.id, { name: r.name, kind: r.kind }]));
}

export type LiveRow = { userId: string; name: string; space: string | null; personal: boolean; device: Device; app: string; platform: string | null; screen: string; shoppingLeft: number | null; since: number; at: number };
export type LiveEvent = { id: number; userId: string; name: string; kind: string; n: number; space: string | null; personal: boolean; at: number };
export type LiveData = {
  now: number;
  online: LiveRow[];
  earlier: { userId: string; name: string; at: number }[];
  stats: { online: number; phone: number; computer: number; shopping: number; activeToday: number; people: number; aiToday: number; reports: number; /** R17 S3 N3 */ notifySent: number };
  hours: number[];
  /** The current hour's column (Israel day). */
  hourNow: number;
  events: LiveEvent[];
};

/** Live: who is online now (one row per person, their latest session), earlier today, by hour, the activity stream. */
export async function adminLive(now = Date.now()): Promise<LiveData> {
  const start = dayStart(now);
  const [people, rows, events, hourRows, [{ ai }], [{ open }], nc] = await Promise.all([
    everyone(),
    presenceRows(Math.min(start, now - ONLINE_MS)),
    activityRows({ since: now - 2 * DAY, limit: 40 }),
    activityRows({ since: start, hours: true, limit: 5000 }),
    db.select({ ai: count() }).from(schema.aiUsage).where(and(eq(schema.aiUsage.day, aiDay(now)), eq(schema.aiUsage.system, false))),
    db.select({ open: count() }).from(schema.reports).where(eq(schema.reports.status, "open")),
    notifyCounts(start, now),
  ]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const visible = new Set(people.filter((p) => p.deletionRequestedAt == null).map((p) => p.id));
  const spaces = await spaceNames([...new Set([...rows.map((r) => r.spaceId), ...events.map((e) => e.spaceId)].filter((x): x is string => !!x))]);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (visible.has(r.userId) && !latest.has(r.userId)) latest.set(r.userId, r);
  const online: LiveRow[] = [];
  const earlier: LiveData["earlier"] = [];
  for (const r of latest.values()) {
    if (now - r.updatedAt <= ONLINE_MS) {
      const sp = r.spaceId ? spaces.get(r.spaceId) : undefined;
      online.push({ userId: r.userId, name: name.get(r.userId) ?? "", space: sp?.name ?? null, personal: sp?.kind === "personal", device: r.device, app: r.app, platform: r.platform, screen: r.screen, shoppingLeft: r.shoppingLeft, since: r.since, at: r.updatedAt });
    } else if (r.updatedAt >= start) earlier.push({ userId: r.userId, name: name.get(r.userId) ?? "", at: r.updatedAt });
  }
  online.sort((a, b) => a.since - b.since);
  const hours = Array.from({ length: 24 }, () => new Set<string>());
  for (const h of hourRows) hours[Math.min(23, Math.floor((h.at - start) / 3_600_000))]?.add(h.userId);
  const activeToday = new Set([...hourRows.map((h) => h.userId), ...online.map((o) => o.userId)]);
  return {
    now,
    online,
    earlier,
    stats: {
      online: online.length,
      phone: online.filter((o) => o.device === "phone").length,
      computer: online.filter((o) => o.device === "computer").length,
      shopping: online.filter((o) => o.screen === "shopping-mode").length,
      activeToday: [...activeToday].filter((u) => visible.has(u)).length,
      people: visible.size,
      aiToday: Number(ai ?? 0),
      reports: Number(open ?? 0),
      notifySent: nc.sentToday,
    },
    hours: hours.map((s) => s.size),
    hourNow: Math.min(23, Math.floor((now - start) / 3_600_000)),
    events: events
      .filter((e) => visible.has(e.userId) || e.kind === "deletion_requested")
      .slice(0, 30)
      .map((e) => {
        const sp = e.spaceId ? spaces.get(e.spaceId) : undefined;
        return { id: e.id, userId: e.userId, name: name.get(e.userId) ?? "", kind: e.kind, n: e.n, space: sp?.name ?? null, personal: sp?.kind === "personal", at: e.at };
      }),
  };
}

export type PersonRow = {
  id: string;
  name: string;
  email: string;
  admin: boolean;
  createdAt: number;
  banned: boolean;
  deletionRequestedAt: number | null;
  spaces: number;
  items: number;
  chats: number;
  ai: Allowance;
  online: { device: Device; screen: string; shoppingLeft: number | null; since: number } | null;
  lastSeen: number | null;
};

/** Every person with counts (spaces, items they added, chats, AI today) and where they are now. */
export async function adminPeople(now = Date.now()): Promise<PersonRow[]> {
  const [people, mem, items, chats, pres, sess] = await Promise.all([
    everyone(),
    db
      .select({ u: schema.member.userId, n: count() })
      .from(schema.member)
      .innerJoin(schema.space, eq(schema.space.id, schema.member.organizationId))
      .where(isNull(schema.space.deletedAt))
      .groupBy(schema.member.userId),
    db.select({ u: schema.items.addedByUserId, n: count() }).from(schema.items).groupBy(schema.items.addedByUserId),
    db.select({ u: schema.conversations.userId, n: count() }).from(schema.conversations).where(isNull(schema.conversations.deletedAt)).groupBy(schema.conversations.userId),
    presenceRows(0),
    db.select({ u: schema.session.userId, at: sql<number>`max(${schema.session.updatedAt})` }).from(schema.session).groupBy(schema.session.userId),
  ]);
  const by = <T extends { u: string | null; n: number }>(rows: T[]) => new Map(rows.map((r) => [r.u ?? "", Number(r.n)]));
  const m = by(mem), it = by(items), ch = by(chats);
  const lastSession = new Map(sess.map((s) => [s.u, Number(s.at) < 1e12 ? Number(s.at) * 1000 : Number(s.at)]));
  const latest = new Map<string, (typeof pres)[number]>();
  for (const r of pres) if (!latest.has(r.userId)) latest.set(r.userId, r);
  const allow = await Promise.all(people.map((p) => aiAllowance(p.id, now)));
  return people
    .map((p, k) => {
      const r = latest.get(p.id);
      const on = r && now - r.updatedAt <= ONLINE_MS ? { device: r.device, screen: r.screen, shoppingLeft: r.shoppingLeft, since: r.since } : null;
      const seen = Math.max(r?.updatedAt ?? 0, lastSession.get(p.id) ?? 0) || null;
      return { id: p.id, name: p.name, email: p.email, admin: p.role === "admin", createdAt: p.createdAt, banned: p.banned, deletionRequestedAt: p.deletionRequestedAt, spaces: m.get(p.id) ?? 0, items: it.get(p.id) ?? 0, chats: ch.get(p.id) ?? 0, ai: allow[k], online: on, lastSeen: seen };
    })
    .sort((a, b) => Number(!!b.online) - Number(!!a.online) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

export type PersonDevice = { id: string; kind: "phone" | "tablet" | "desktop"; browser: string | null; os: string | null; installed: boolean; lastActive: number; online: boolean };

/** One person: the row + their signed-in devices (sessions; the browser/OS family only). */
export async function adminPerson(userId: string, now = Date.now()) {
  const row = (await adminPeople(now)).find((p) => p.id === userId) ?? null;
  if (!row) return null;
  const [sessions, pres] = await Promise.all([
    db.select({ id: schema.session.id, ua: schema.session.userAgent, at: schema.session.updatedAt }).from(schema.session).where(eq(schema.session.userId, userId)).orderBy(desc(schema.session.updatedAt)),
    db.select().from(schema.presence).where(eq(schema.presence.userId, userId)),
  ]);
  const p = new Map(pres.map((r) => [r.sessionId, r]));
  const devices: PersonDevice[] = sessions.map((s) => {
    const d = describeUa(s.ua);
    const pr = p.get(s.id);
    const last = Math.max(+s.at, pr?.updatedAt ?? 0);
    return { id: s.id, kind: pr ? (pr.device === "phone" ? "phone" : "desktop") : d.kind, browser: d.browser, os: d.os, installed: pr?.app === "installed", lastActive: last, online: !!pr && now - pr.updatedAt <= ONLINE_MS };
  });
  return { ...row, devices: devices.sort((a, b) => b.lastActive - a.lastActive) };
}
export type PersonDetail = NonNullable<Awaited<ReturnType<typeof adminPerson>>>;

/** Sign out one of a person's sessions (only theirs — the id is matched with the user). */
export async function revokeUserSession(userId: string, sessionId: string) {
  const r = await db.delete(schema.session).where(and(eq(schema.session.userId, userId), eq(schema.session.id, sessionId)));
  await db.delete(schema.presence).where(eq(schema.presence.sessionId, sessionId));
  return r.rowsAffected > 0;
}

export async function revokeUserSessions(userId: string) {
  await db.batch([db.delete(schema.session).where(eq(schema.session.userId, userId)), db.delete(schema.presence).where(eq(schema.presence.userId, userId))]);
}

/** Ban = the Better Auth admin plugin's `banned` column (sign-in refused by the plugin, sessions refused by
 *  getSessionUser) + every session ends. Unban clears it. */
export async function setUserBanned(userId: string, on: boolean) {
  await db.update(schema.user).set({ banned: on, banReason: on ? "admin" : null, banExpires: null }).where(eq(schema.user.id, userId));
  if (on) await revokeUserSessions(userId);
}

export async function userExists(userId: string) {
  const [u] = await db.select({ id: schema.user.id, role: schema.user.role }).from(schema.user).where(eq(schema.user.id, userId));
  return u ?? null;
}

// ---------- AI usage ----------

export type AiStats = {
  today: number;
  period: number;
  previous: number;
  failed: number;
  days: { day: string; byProvider: Record<string, number>; failed: number }[];
  features: { feature: string; n: number }[];
  models: { provider: string; model: string; n: number; tokens: number }[];
  closest: { userId: string; name: string; used: number; limit: number | null }[];
};

export async function adminAiStats(days: 7 | 30, now = Date.now()): Promise<AiStats> {
  const from = aiDay(now - (days - 1) * DAY);
  const prevFrom = aiDay(now - (2 * days - 1) * DAY);
  const [perDay, [{ prev }], feats, models, todayUsers, people] = await Promise.all([
    db
      .select({ day: schema.aiUsage.day, provider: schema.aiUsage.provider, ok: schema.aiUsage.ok, n: count() })
      .from(schema.aiUsage)
      .where(gte(schema.aiUsage.day, from))
      .groupBy(schema.aiUsage.day, schema.aiUsage.provider, schema.aiUsage.ok),
    db.select({ prev: count() }).from(schema.aiUsage).where(and(gte(schema.aiUsage.day, prevFrom), sql`${schema.aiUsage.day} < ${from}`)),
    db.select({ f: schema.aiUsage.feature, n: count() }).from(schema.aiUsage).where(gte(schema.aiUsage.day, from)).groupBy(schema.aiUsage.feature),
    db
      .select({ p: schema.aiUsage.provider, m: schema.aiUsage.model, n: count(), t: sql<number>`coalesce(sum(${schema.aiUsage.tokens}), 0)` })
      .from(schema.aiUsage)
      .where(and(gte(schema.aiUsage.day, from), eq(schema.aiUsage.ok, true)))
      .groupBy(schema.aiUsage.provider, schema.aiUsage.model),
    db
      .select({ u: schema.aiUsage.userId, n: count() })
      .from(schema.aiUsage)
      .where(and(eq(schema.aiUsage.day, aiDay(now)), eq(schema.aiUsage.system, false)))
      .groupBy(schema.aiUsage.userId),
    everyone(),
  ]);
  const map = new Map<string, { byProvider: Record<string, number>; failed: number }>();
  for (let k = days - 1; k >= 0; k--) map.set(aiDay(now - k * DAY), { byProvider: {}, failed: 0 });
  let period = 0, failed = 0;
  for (const r of perDay) {
    const d = map.get(r.day);
    if (!d) continue;
    const n = Number(r.n);
    period += n;
    if (!r.ok) {
      d.failed += n;
      failed += n;
    } else d.byProvider[r.provider ?? "other"] = (d.byProvider[r.provider ?? "other"] ?? 0) + n;
  }
  const name = new Map(people.map((p) => [p.id, p.name]));
  const closest = await Promise.all(
    todayUsers
      .filter((r) => r.u && name.has(r.u))
      .map(async (r) => {
        const a = await aiAllowance(r.u!, now);
        return { userId: r.u!, name: name.get(r.u!) ?? "", used: a.used, limit: a.limit };
      }),
  );
  const ratio = (x: { used: number; limit: number | null }) => (x.limit == null ? x.used / 1000 : x.limit === 0 ? 1 : x.used / x.limit);
  return {
    today: [...(map.get(aiDay(now))?.byProvider ? Object.values(map.get(aiDay(now))!.byProvider) : [])].reduce((a, b) => a + b, 0) + (map.get(aiDay(now))?.failed ?? 0),
    period,
    previous: Number(prev ?? 0),
    failed,
    days: [...map.entries()].map(([day, v]) => ({ day, ...v })),
    features: feats.map((f) => ({ feature: f.f, n: Number(f.n) })).sort((a, b) => b.n - a.n),
    models: models.map((m) => ({ provider: m.p ?? "other", model: m.m ?? "", n: Number(m.n), tokens: Number(m.t ?? 0) })),
    closest: closest.sort((a, b) => ratio(b) - ratio(a)).slice(0, 5),
  };
}

// ---------- System ----------

const TABLES = [
  ["items", schema.items],
  ["sources", schema.sources],
  ["price_points", schema.pricePoints],
  ["ai_usage", schema.aiUsage],
  ["error_event", schema.errorEvent],
  ["session", schema.session],
  ["activity", schema.activity],
  ["notification", schema.notification],
  ["push_subscription", schema.pushSubscription],
  ["user", schema.user],
] as const;

export async function adminSystemDb() {
  const t0 = performance.now();
  await db.run(sql`select 1`);
  const ping = Math.round(performance.now() - t0);
  const rows = await Promise.all(TABLES.map(async ([n, t]) => ({ table: n, rows: Number((await db.select({ n: count() }).from(t))[0]?.n ?? 0) })));
  let bytes: number | null = null;
  try {
    const r = (await db.all(sql`select page_count * page_size as b from pragma_page_count(), pragma_page_size()`)) as { b: number }[];
    bytes = Number(r[0]?.b ?? 0) || null;
  } catch {
    bytes = null;
  }
  const hour = Date.now() - 3_600_000;
  const [[{ checks }], lastOk] = await Promise.all([
    db.select({ checks: count() }).from(schema.sources).where(gte(schema.sources.fetchedAt, hour)),
    db
      .select({ p: schema.aiUsage.provider, at: sql<number>`max(${schema.aiUsage.at})`, ms: sql<number>`avg(${schema.aiUsage.ms})` })
      .from(schema.aiUsage)
      .where(and(eq(schema.aiUsage.ok, true), ne(schema.aiUsage.provider, "")))
      .groupBy(schema.aiUsage.provider),
  ]);
  return { ping, rows, bytes, checksHour: Number(checks ?? 0), ai: lastOk.map((r) => ({ provider: r.p ?? "other", at: Number(r.at), ms: Math.round(Number(r.ms ?? 0)) })) };
}
