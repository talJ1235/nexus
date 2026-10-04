// Unit test for the calendar feed builder (Round 14 C2): escaping, folding at 75 octets, all-day dates, UID stability,
// SEQUENCE on a moved date, omission of received / deleted / eta-less items, and a real ICS parser reading it back.
//   npm run test:ics
import assert from "node:assert/strict";
import ICAL from "ical.js";
import { buildIcs, calendarEvents, escapeText, foldLine, googleSubscribeUrl, googleTemplateUrl, nextSeqs } from "../src/lib/ics";
import type { ItemWithSources } from "../src/lib/types";

const tz = "Asia/Jerusalem";
const NOW = Date.UTC(2026, 9, 4, 15, 0); // Sun 4 Oct 2026, 18:00 Israel
const DAY = 86_400_000;
const T = { arrives: "📦 {item} arrives", late: "📦 {item} arrives (late)", reorder: "🔁 Reorder {item}" };
let n = 0;
const item = (p: Partial<ItemWithSources>) =>
  ({ id: `i${++n}`, title: `Item ${n}`, status: "ordered", priority: "normal", quantity: 1, collectionId: null, eta: null, orderedAt: NOW - 3 * DAY, purchasedAt: null, createdAt: NOW - 9 * DAY, updatedAt: NOW, sources: [], points: [], attachments: [], ...p }) as ItemWithSources;

// ---- Escaping and folding.
assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
const long = `SUMMARY:${"x".repeat(200)}`;
const folded = foldLine(long).split("\r\n");
assert.ok(folded.every((l) => new TextEncoder().encode(l).length <= 75), "≤ 75 octets per line");
assert.ok(folded.slice(1).every((l) => l.startsWith(" ")), "continuations start with a space");
assert.equal(folded.map((l, k) => (k ? l.slice(1) : l)).join(""), long);
// Multi-byte (Hebrew, emoji) never split mid-character.
const heb = `SUMMARY:${"📦 מטען מצברים ".repeat(12)}`;
const hf = foldLine(heb).split("\r\n");
assert.ok(hf.every((l) => new TextEncoder().encode(l).length <= 75));
assert.equal(hf.map((l, k) => (k ? l.slice(1) : l)).join(""), heb);

// ---- Events: arrivals (late ones stay on their day), omitted when received / deleted / no eta / outside the window.
const arriving = item({ title: "Hub, 7-in-1; USB-C", eta: NOW + 5 * DAY });
const late = item({ title: "Chair", eta: NOW - 2 * DAY });
const noEta = item({ title: "No date" });
const received = item({ title: "Got it", status: "purchased", eta: NOW + 1 * DAY, purchasedAt: NOW });
const far = item({ title: "Far", eta: NOW + 90 * DAY });
const old = item({ title: "Old", eta: NOW - 30 * DAY });
const ev = calendarEvents([arriving, late, noEta, received, far, old], NOW, tz, T);
assert.deepEqual(ev.map((e) => e.uid), [`${late.id}-eta@nexus`, `${arriving.id}-eta@nexus`]);
assert.equal(ev[0].title, "📦 Chair arrives (late)");
assert.equal(ev[0].day, "2026-10-02");
assert.equal(ev[1].day, "2026-10-09");
// Deleted (gone from the list) / received later → omitted, so subscribed calendars drop it.
assert.equal(calendarEvents([late], NOW, tz, T).length, 1);
assert.equal(calendarEvents([{ ...late, status: "purchased" }], NOW, tz, T).length, 0);
assert.equal(calendarEvents([{ ...late, eta: null }], NOW, tz, T).length, 0);

// ---- Reorder due ("🔁 Reorder X"): three buys about a month apart, due again now.
const buys = [90, 60, 30].map((d) => item({ title: "Coffee beans", status: "purchased", purchasedAt: NOW - d * DAY, eta: null }));
const re = calendarEvents(buys, NOW, tz, T).filter((e) => e.uid.endsWith("-reorder@nexus"));
assert.equal(re.length, 1);
assert.equal(re[0].title, "🔁 Reorder Coffee beans");

// ---- SEQUENCE: stable while the date stays, +1 and a new LAST-MODIFIED when it moves; a dropped event is forgotten.
const s1 = nextSeqs({}, ev, NOW);
assert.equal(s1.changed, true);
assert.equal(s1.map[ev[1].uid].seq, 0);
const s2 = nextSeqs(s1.map, ev, NOW + DAY);
assert.equal(s2.changed, false);
assert.deepEqual(s2.map, s1.map);
const moved = calendarEvents([late, { ...arriving, eta: NOW + 7 * DAY }], NOW, tz, T);
const s3 = nextSeqs(s2.map, moved, NOW + 2 * DAY);
assert.equal(s3.map[ev[1].uid].seq, 1);
assert.equal(s3.map[ev[1].uid].modified, NOW + 2 * DAY);
assert.equal(s3.map[ev[0].uid].seq, 0);
const s4 = nextSeqs(s3.map, moved.slice(0, 1), NOW + 3 * DAY);
assert.equal(s4.changed, true);
assert.equal(Object.keys(s4.map).length, 1);

// ---- The calendar: CRLF, all-day DATE values, stable UIDs; a parser reads it back.
const ics = buildIcs(moved, s3.map, { now: NOW, base: "https://nexus.example", name: "Nexus", open: "Open in Nexus" });
assert.ok(ics.includes("\r\n") && !/[^\r]\n/.test(ics), "CRLF line ends");
assert.ok(ics.includes(`UID:${arriving.id}-eta@nexus`));
assert.ok(ics.includes("DTSTART;VALUE=DATE:20261011") && ics.includes("DTEND;VALUE=DATE:20261012"));
assert.ok(ics.includes("SUMMARY:📦 Hub\\, 7-in-1\\; USB-C arrives"));
assert.ok(!/₪|\$|price|amazon/i.test(ics), "no prices or store names");
const parsed = new ICAL.Component(ICAL.parse(ics));
const vevents = parsed.getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));
assert.equal(vevents.length, 2);
const hub = vevents.find((e) => e.uid === `${arriving.id}-eta@nexus`)!;
assert.equal(hub.summary, "📦 Hub, 7-in-1; USB-C arrives");
assert.equal(hub.startDate.isDate, true);
assert.equal(hub.startDate.toString(), "2026-10-11");
assert.equal(hub.sequence, 1);
assert.ok(String(hub.description).includes(`https://nexus.example/?item=${arriving.id}`));
// Same input → same output (stable feed, no churn for subscribers).
assert.equal(buildIcs(moved, s3.map, { now: NOW, base: "https://nexus.example", name: "Nexus", open: "Open in Nexus" }), ics);

// ---- Links.
assert.equal(googleSubscribeUrl("webcal://x.test/api/cal/abc.ics"), "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fx.test%2Fapi%2Fcal%2Fabc.ics");
const tpl = new URL(googleTemplateUrl({ title: "📦 Hub arrives", day: "2026-10-11", details: "Open" }));
assert.equal(tpl.searchParams.get("dates"), "20261011/20261012");
assert.equal(tpl.searchParams.get("action"), "TEMPLATE");

console.log("OK test-ics");
