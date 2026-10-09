import { routeCtx } from "@/lib/ctx";
import { recordAway, recordBeat } from "@/lib/db-scoped/presence";
import { parseBeat, platformOf } from "@/lib/presence-keys";

// R17 G1 — the signed-in app's presence beat (every 30 s while visible, at once on a screen change) and the "away"
// beacon (pagehide / hidden, via sendBeacon → text/plain). Same origin only. Stored: device kind, installed or browser,
// OS family + browser, a fixed screen key, the shopping count — read only by the admin panel's Live view.
export async function POST(req: Request) {
  const ctx = await routeCtx("view");
  if (ctx instanceof Response) return ctx;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response(null, { status: 403 });
  let body: unknown = null;
  try {
    const text = await req.text();
    if (text.length > 1000) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const b = body as { away?: unknown; beat?: unknown };
  if (b?.away === true) {
    await recordAway(ctx.session.id);
    return new Response(null, { status: 204 });
  }
  const beat = parseBeat(b?.beat);
  if (!beat) return new Response(null, { status: 400 });
  await recordBeat(
    { userId: ctx.user.id, sessionId: ctx.session.id, spaceId: ctx.space.id },
    { ...beat, platform: platformOf(req.headers.get("user-agent") ?? "", req.headers.get("sec-ch-ua-platform")?.replace(/"/g, "")) },
  );
  return new Response(null, { status: 204 });
}
