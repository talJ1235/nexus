// R16 B2: the local fake transport (REALTIME_FAKE=1, never in production): a server-sent event stream of the current
// space's change messages and presence, for test:live and smokes without an Ably key. 404 when off.
import { routeCtx } from "@/lib/ctx";
import { fakeBus, fakeTransport } from "@/lib/realtime/fake";
import { channelOf } from "@/lib/realtime/publish";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!fakeTransport()) return new Response("Not found", { status: 404 });
  const ctx = await routeCtx("view");
  if (ctx instanceof Response) return ctx;
  const channel = channelOf(ctx.space.id);
  const mode = new URL(req.url).searchParams.get("mode") === "shopping" ? "shopping" : "app";
  const conn = `${ctx.user.id}:${Math.random().toString(36).slice(2)}`;
  const bus = fakeBus();
  const enc = new TextEncoder();
  let off = () => {};
  const stream = new ReadableStream({
    start(c) {
      const send = (m: unknown) => {
        try {
          c.enqueue(enc.encode(`data: ${JSON.stringify(m)}\n\n`));
        } catch {
          off();
        }
      };
      const unsub = bus.subscribe(channel, send);
      bus.enter(channel, { clientId: ctx.user.id, mode }, conn);
      const ping = setInterval(() => send({ type: "ping" }), 15_000);
      off = () => {
        clearInterval(ping);
        unsub();
        bus.leave(channel, conn);
      };
      req.signal.addEventListener("abort", () => off());
    },
    cancel() {
      off();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}
