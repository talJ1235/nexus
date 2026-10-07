import { type NextRequest } from "next/server";
import { calendarUser, CAL_KINDS_KEY, CAL_SEQ_KEY, rateLimited } from "@/lib/calendar-server";
import { loadItems } from "@/lib/data";
import { Scoped } from "@/lib/db-scoped";
import { userPrefGet, userPrefSet } from "@/lib/db-scoped/prefs";
import { spaceIdsOfUser } from "@/lib/db-scoped/system";
import { dictionaries } from "@/lib/i18n";
import { buildIcs, calendarEvents, nextSeqs, parseCalKinds, type SeqMap } from "@/lib/ics";
import { publicOrigin } from "@/lib/telegram";
import { ownerPrefs } from "@/lib/tracker";

// Round 14 C2: `GET /api/cal/<token>.ics` — arrivals and reorder dates as an iCalendar feed. Public (calendar apps
// have no session; proxy.ts lets /api/cal/ through), authorized by the secret token in the path (authz allow-list:
// calendar token). R15: the token is per user and the feed covers all of that user's spaces. A wrong token is a 404.
// Titles only: no prices, no store names.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const raw = (await params).token;
  const token = raw.replace(/\.ics$/i, "");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return new Response("Too many requests", { status: 429, headers: { "retry-after": "600" } });
  const userId = /^[\w-]{16,64}$/.test(token) ? await calendarUser(token) : null;
  if (!userId) return new Response("Not found", { status: 404 });

  const now = Date.now();
  const { locale } = await ownerPrefs(userId);
  const t = dictionaries[locale].cal;
  const items = (await Promise.all((await spaceIdsOfUser(userId)).map((spaceId) => loadItems(new Scoped({ spaceId, userId }))))).flat();
  const events = calendarEvents(items, now, "Asia/Jerusalem", t, parseCalKinds(await userPrefGet(userId, CAL_KINDS_KEY)));
  let prev: SeqMap = {};
  try {
    prev = JSON.parse((await userPrefGet(userId, CAL_SEQ_KEY)) ?? "{}");
  } catch {}
  const { map, changed } = nextSeqs(prev, events, now);
  if (changed) await userPrefSet(userId, CAL_SEQ_KEY, JSON.stringify(map));
  const body = buildIcs(events, map, { now, base: publicOrigin(req.nextUrl.origin), name: t.name, open: t.open });
  return new Response(body, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'inline; filename="nexus.ics"', "cache-control": "private, max-age=300" },
  });
}
