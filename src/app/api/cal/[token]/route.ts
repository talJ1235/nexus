import { type NextRequest } from "next/server";
import { calendarTokenMatches, CAL_SEQ_KEY, rateLimited } from "@/lib/calendar-server";
import { loadItems } from "@/lib/data";
import { dictionaries } from "@/lib/i18n";
import { buildIcs, calendarEvents, nextSeqs, type SeqMap } from "@/lib/ics";
import { kvGet, kvSet } from "@/lib/kv";
import { publicOrigin } from "@/lib/telegram";
import { ownerPrefs } from "@/lib/tracker";

// Round 14 C2: `GET /api/cal/<token>.ics` — the owner's arrivals and reorder dates as an iCalendar feed. Public
// (calendar apps have no session; proxy.ts lets /api/cal/ through), authorized by the secret token in the path.
// A wrong token is a plain 404. Titles only: no prices, no store names.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const raw = (await params).token;
  const token = raw.replace(/\.ics$/i, "");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return new Response("Too many requests", { status: 429, headers: { "retry-after": "600" } });
  if (!/^[\w-]{16,64}$/.test(token) || !(await calendarTokenMatches(token))) return new Response("Not found", { status: 404 });

  const now = Date.now();
  const { locale } = await ownerPrefs();
  const t = dictionaries[locale].cal;
  const events = calendarEvents(await loadItems(), now, "Asia/Jerusalem", t);
  let prev: SeqMap = {};
  try {
    prev = JSON.parse((await kvGet(CAL_SEQ_KEY)) ?? "{}");
  } catch {}
  const { map, changed } = nextSeqs(prev, events, now);
  if (changed) await kvSet(CAL_SEQ_KEY, JSON.stringify(map));
  const body = buildIcs(events, map, { now, base: publicOrigin(req.nextUrl.origin), name: t.name, open: t.open });
  return new Response(body, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="nexus.ics"', "cache-control": "private, max-age=300" },
  });
}
