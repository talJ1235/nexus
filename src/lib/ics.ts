// Round 14 C2: the calendar feed (`GET /api/cal/<token>.ics`) — an iCalendar of the owner's arrivals and reorder
// dates. Pure (no server imports) so scripts/test-ics.ts can check escaping, folding, dates and UID stability.
// Subscribing calendars follow it: a new event appears, a moved date moves (same UID, higher SEQUENCE), and an event
// that is no longer in the feed (received, deleted, lost its eta) disappears.
import { addDays, dayKeyIn, reorderDue } from "./home";
import type { ItemWithSources } from "./types";

/** Feed window: the past 14 days and the next 60. */
export const PAST_DAYS = 14;
export const NEXT_DAYS = 60;

export type CalEvent = { uid: string; day: string; title: string; itemId: string };
/** Per-UID memory (kv): the date it was last served with, its SEQUENCE and when that date changed. */
export type SeqMap = Record<string, { day: string; seq: number; modified: number }>;

/** The feed's events: arrivals of ordered items with an eta (late ones stay on their day, labelled) and reorder dates. */
export function calendarEvents(items: ItemWithSources[], now: number, tz: string, t: { arrives: string; late: string; reorder: string }): CalEvent[] {
  const today = dayKeyIn(now, tz);
  const from = addDays(today, -PAST_DAYS);
  const to = addDays(today, NEXT_DAYS);
  const out: CalEvent[] = [];
  for (const i of items) {
    if (i.status !== "ordered" || i.eta == null) continue;
    const day = dayKeyIn(i.eta, tz);
    if (day < from || day > to) continue;
    const late = day < today;
    out.push({ uid: `${i.id}-eta@nexus`, day, itemId: i.id, title: (late ? t.late : t.arrives).replace("{item}", i.title) });
  }
  for (const r of reorderDue(items, now)) {
    const day = dayKeyIn(Math.max(r.cadence.due, now), tz);
    if (day > to) continue;
    out.push({ uid: `${r.item.id}-reorder@nexus`, day, itemId: r.item.id, title: t.reorder.replace("{item}", r.item.title) });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.uid.localeCompare(b.uid));
}

/** SEQUENCE / LAST-MODIFIED: unchanged while an event keeps its date, +1 (and now) when the date moves. */
export function nextSeqs(prev: SeqMap, events: CalEvent[], now: number): { map: SeqMap; changed: boolean } {
  const map: SeqMap = {};
  let changed = false;
  for (const e of events) {
    const p = prev[e.uid];
    if (p && p.day === e.day) map[e.uid] = p;
    else {
      map[e.uid] = { day: e.day, seq: p ? p.seq + 1 : 0, modified: now };
      changed = true;
    }
  }
  // Events that left the feed are forgotten (if one comes back, its SEQUENCE starts over — a new event to clients).
  if (Object.keys(prev).some((k) => !map[k])) changed = true;
  return { map, changed };
}

/** TEXT value escaping (RFC 5545 §3.3.11): backslash, semicolon, comma, newline. */
export function escapeText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Content-line folding (RFC 5545 §3.1): at most 75 octets per line, continuation lines start with one space. Never
 *  splits a UTF-8 character. */
export function foldLine(line: string) {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length ? 74 : 75; // continuation lines carry the leading space
    if (bytes + n > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const date = (key: string) => key.replace(/-/g, "");

/** The whole calendar. `base` links each event back to its item. No prices or store names — titles only. */
export function buildIcs(events: CalEvent[], seqs: SeqMap, opts: { now: number; base: string; name: string; open: string }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nexus//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of events) {
    const s = seqs[e.uid] ?? { seq: 0, modified: opts.now };
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp(opts.now)}`,
      `LAST-MODIFIED:${stamp(s.modified)}`,
      `SEQUENCE:${s.seq}`,
      `DTSTART;VALUE=DATE:${date(e.day)}`,
      `DTEND;VALUE=DATE:${date(addDays(e.day, 1))}`,
      `SUMMARY:${escapeText(e.title)}`,
      `DESCRIPTION:${escapeText(`${opts.open}: ${opts.base}/?item=${encodeURIComponent(e.itemId)}`)}`,
      `URL:${opts.base}/?item=${encodeURIComponent(e.itemId)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** "Add to Google Calendar" for one event (a template link — a one-off copy that won't follow later changes). */
export function googleTemplateUrl(e: { title: string; day: string; details: string }) {
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${date(e.day)}/${date(addDays(e.day, 1))}`, details: e.details });
  return `https://calendar.google.com/calendar/render?${q}`;
}

/** Google's "subscribe" link for a feed: its webcal:// address in `cid`. */
export function googleSubscribeUrl(webcal: string) {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
}

