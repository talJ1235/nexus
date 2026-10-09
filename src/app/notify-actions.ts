"use server";

import { z } from "zod";
import { requireCtx } from "@/lib/ctx";
import { deleteNotification, inboxRows, markNotificationsRead, unreadCount } from "@/lib/db-scoped/notify";
import { userPrefGet, userPrefGetMany, userPrefSet } from "@/lib/db-scoped/prefs";
import { NOTIFY_KEY } from "@/lib/home-prefs";
import { ONBOARDING_KEY, parseOnboarding } from "@/lib/onboarding";
import { ASK_KEY, askDue, parseAsk, saidNo, saidYes, wasShown } from "@/lib/notify/ask";
import { TZ_KEY } from "@/lib/notify/enqueue";
import { pushConfigured, vapidPublicKey } from "@/lib/notify/push";
import { DEFAULT_TZ, local, validTz } from "@/lib/notify/schedule";
import type { NotifyKind } from "@/lib/notify/kinds";

// R17 S3 — the inbox (K), the bell's count (K4) and the permission card's memory (L1). Everything is the signed-in
// person's own rows: no space data is read here, viewers included (everyone has an inbox).

export type InboxRow = { id: string; kind: NotifyKind; data: unknown; at: number; read: boolean; spaceId: string | null };
export type NotifyBoot = { publicKey: string | null; configured: boolean; on: boolean; askDue: boolean; unread: number };

const Ids = z.array(z.string().min(1).max(40)).max(200);

async function today(userId: string, now: number) {
  const tz = await userPrefGet(userId, TZ_KEY);
  const l = local(now, validTz(tz) ? tz : DEFAULT_TZ);
  return `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
}

/** App start: the push key, the switch, whether a reminder card is due today, the unread count. */
export async function notifyBoot(): Promise<NotifyBoot> {
  const ctx = await requireCtx("view");
  const now = Date.now();
  const kv = await userPrefGetMany(ctx.user.id, [NOTIFY_KEY, ASK_KEY, ONBOARDING_KEY]);
  let on = true;
  try {
    on = (JSON.parse(kv[NOTIFY_KEY] ?? "{}") as { on?: unknown }).on !== false;
  } catch {}
  const ob = parseOnboarding(kv[ONBOARDING_KEY]);
  const due = askDue(parseAsk(kv[ASK_KEY]), { now, today: await today(ctx.user.id, now), switchOn: on, onboardingAt: ob && ob.status !== "active" ? ob.at : null });
  return { publicKey: vapidPublicKey(), configured: pushConfigured(), on, askDue: due, unread: await unreadCount(ctx.user.id, now) };
}

export async function inbox(): Promise<{ rows: InboxRow[]; unread: number; now: number }> {
  const ctx = await requireCtx("view");
  const now = Date.now();
  const rows = await inboxRows(ctx.user.id, now);
  return {
    now,
    unread: rows.filter((r) => !r.readAt).length,
    rows: rows.map((r) => ({ id: r.id, kind: r.kind as NotifyKind, data: safe(r.data), at: r.updatedAt, read: !!r.readAt, spaceId: r.spaceId })),
  };
}

export async function unread(): Promise<number> {
  const ctx = await requireCtx("view");
  return unreadCount(ctx.user.id);
}

export async function markRead(ids: string[]): Promise<number> {
  const ctx = await requireCtx("view");
  await markNotificationsRead(ctx.user.id, Ids.parse(ids));
  return unreadCount(ctx.user.id);
}

export async function markAllRead(): Promise<number> {
  const ctx = await requireCtx("view");
  await markNotificationsRead(ctx.user.id, "all");
  return 0;
}

export async function removeNotification(id: string): Promise<number> {
  const ctx = await requireCtx("view");
  await deleteNotification(ctx.user.id, z.string().min(1).max(40).parse(id));
  return unreadCount(ctx.user.id);
}

/** L1: the card was shown / "Not now" / the browser said yes. Onboarding step 6's "Not now" is the first "no". */
export async function notifyAsk(answer: "shown" | "no" | "yes"): Promise<void> {
  const ctx = await requireCtx("view");
  const a = z.enum(["shown", "no", "yes"]).parse(answer);
  const now = Date.now();
  const cur = parseAsk(await userPrefGet(ctx.user.id, ASK_KEY));
  const day = await today(ctx.user.id, now);
  const next = a === "no" ? saidNo(cur, now, day) : a === "yes" ? saidYes(cur) : wasShown(cur, day);
  await userPrefSet(ctx.user.id, ASK_KEY, JSON.stringify(next));
}

const safe = (s: string) => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return {};
  }
};
