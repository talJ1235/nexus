"use server";

import { headers } from "next/headers";
import { calendarToken, CAL_SUBSCRIBED_KEY, regenerateCalendarToken } from "@/lib/calendar-server";
import { requireCtx } from "@/lib/ctx";
import { userPrefGet, userPrefSet } from "@/lib/db-scoped/prefs";
import { publicOrigin } from "@/lib/telegram";

export type CalendarInfo = { https: string; webcal: string; subscribed: boolean };

async function info(userId: string, token: string): Promise<CalendarInfo> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const origin = publicOrigin(`${proto}://${host}`);
  const https = `${origin}/api/cal/${token}.ics`;
  return { https, webcal: https.replace(/^https?:/, "webcal:"), subscribed: (await userPrefGet(userId, CAL_SUBSCRIBED_KEY)) === "1" };
}

/** Settings → Calendar: the feed's addresses (the token is created on first open). */
export async function calendarInfo(): Promise<CalendarInfo> {
  const ctx = await requireCtx("view");
  return info(ctx.user.id, await calendarToken(ctx.user.id));
}

/** A new secret address; the old one stops working at once. */
export async function regenerateCalendar(): Promise<CalendarInfo> {
  const ctx = await requireCtx("view");
  return info(ctx.user.id, await regenerateCalendarToken(ctx.user.id));
}

/** The user tapped a subscribe button: from now on the month view hides its one-off "Add to Google Calendar". */
export async function markCalendarSubscribed(): Promise<void> {
  const ctx = await requireCtx("view");
  await userPrefSet(ctx.user.id, CAL_SUBSCRIBED_KEY, "1");
}

/** Whether the feed was subscribed (the month view's per-event buttons). */
export async function calendarSubscribed(): Promise<boolean> {
  const ctx = await requireCtx("view");
  return (await userPrefGet(ctx.user.id, CAL_SUBSCRIBED_KEY)) === "1";
}
