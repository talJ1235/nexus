import "server-only";
import { claimDue, setPushState, type NotificationRow } from "../db-scoped/notify";
import { userPrefGet } from "../db-scoped/prefs";
import { dictionaries, isLocale, type Locale } from "../i18n";
import { ttlOf, type NotifyKind } from "./kinds";
import { sendToUser, type PushPayload, type SendResult } from "./push";
import { groupedPushText, pushText } from "./text";

// R17 S3 J3 — send everything that is due. Each row is claimed (sent_at set) in the same UPDATE that selects it, so the
// hourly run and an in-request urgent send never push a row twice. One push per person per run: one row → its own
// text + actions; several → "3 updates" (all price rows → "3 price drops"), opening the inbox.

async function localeOf(userId: string): Promise<Locale> {
  try {
    const v = JSON.parse((await userPrefGet(userId, "pref:owner")) || "{}") as { locale?: string };
    return isLocale(v.locale) ? v.locale : "en";
  } catch {
    return "en";
  }
}

export const openUrl = (id: string) => `/api/notify/open?id=${encodeURIComponent(id)}`;

export function payloadFor(rows: NotificationRow[], locale: Locale): PushPayload {
  const nt = dictionaries[locale].nt;
  const base = { lang: locale, dir: locale === "he" ? "rtl" : "ltr" } as const;
  if (rows.length === 1) {
    const r = rows[0];
    const data = safe(r.data);
    const t = pushText(r.kind as NotifyKind, data, nt, locale);
    const actions: PushPayload["actions"] = r.kind === "price" ? [{ action: "open", title: nt.open }] : r.kind === "delivery" && !(data as { received?: boolean }).received ? [{ action: "received", title: nt.received }] : undefined;
    // A row updated in place (the trip finished) replaces the earlier notification quietly.
    return { ...base, id: r.id, title: t.title, body: t.body, url: openUrl(r.id), tag: r.groupKey, actions, renotify: false };
  }
  const t = groupedPushText(rows.map((r) => r.kind as NotifyKind), nt);
  return { ...base, id: "group", title: t.title, body: t.body, url: "/inbox", tag: "nexus-updates", renotify: true };
}

export async function dispatch(now = Date.now(), opts: { userId?: string } = {}) {
  const rows = await claimDue(now, opts);
  const byUser = new Map<string, NotificationRow[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  const total: SendResult & { people: number; rows: number } = { sent: 0, failed: 0, gone: 0, devices: 0, people: byUser.size, rows: rows.length };
  for (const [userId, list] of byUser) {
    const payload = payloadFor(list, await localeOf(userId));
    const ttl = Math.min(...list.map((r) => ttlOf(r.kind as NotifyKind)));
    const res = await sendToUser(userId, payload, ttl);
    total.sent += res.sent;
    total.failed += res.failed;
    total.gone += res.gone;
    total.devices += res.devices;
    if (!res.sent) await setPushState(list.map((r) => r.id), res.devices && res.failed ? "failed" : "skipped");
  }
  return total;
}

const safe = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};
