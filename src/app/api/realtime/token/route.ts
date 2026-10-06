// R16 B2: how this tab gets live updates for the CURRENT space — an Ably TokenRequest (one channel: subscribe +
// presence, 15 min, clientId = the user), the local fake (dev/test only), or "poll" (no key). Re-asked on a space switch;
// a removed member gets nothing (requireCtx checks the membership on every call). 30 per minute per user.
import { hitLimit, MINUTE } from "@/lib/auth/limits";
import { routeCtx } from "@/lib/ctx";
import { fakeTransport } from "@/lib/realtime/fake";
import { ablyKey, channelOf } from "@/lib/realtime/publish";
import { signTokenRequest } from "@/lib/realtime/token";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await routeCtx("view");
  if (ctx instanceof Response) return ctx;
  if (!(await hitLimit(`rt-token:${ctx.user.id}`, 30, MINUTE))) return Response.json({ error: "limit" }, { status: 429 });
  const channel = channelOf(ctx.space.id);
  const headers = { "cache-control": "no-store" };
  if (fakeTransport()) return Response.json({ mode: "fake", channel, me: ctx.user.id }, { headers });
  const key = ablyKey();
  if (!key) return Response.json({ mode: "poll", me: ctx.user.id }, { headers });
  return Response.json({ mode: "ably", channel, me: ctx.user.id, tokenRequest: signTokenRequest(key, channel, ctx.user.id) }, { headers });
}
