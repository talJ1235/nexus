import { z } from "zod";
import { routeCtx } from "@/lib/ctx";
import { removeSubscription, saveSubscription } from "@/lib/db-scoped/notify";
import { allowedEndpoint } from "@/lib/notify/push";

// R17 S3 J2 — this browser's push address (after the person allowed notifications), and its removal on sign-out /
// when the browser drops it. Same origin only. The endpoint must be a known browser push service (no SSRF).

const B64 = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).max(200);
const Sub = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: B64, auth: B64 }), device: z.enum(["phone", "computer"]), label: z.string().max(60).nullable().optional() });

const sameOrigin = (req: Request) => {
  const o = req.headers.get("origin");
  return !o || o === new URL(req.url).origin;
};

async function body(req: Request) {
  const text = await req.text();
  if (text.length > 4000) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const ctx = await routeCtx("view");
  if (ctx instanceof Response) return ctx;
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const p = Sub.safeParse(await body(req));
  if (!p.success || !allowedEndpoint(p.data.endpoint)) return new Response(null, { status: 400 });
  // label: browser + OS words only ("Chrome · Android") — trimmed to letters, digits, spaces and dots.
  const label = (p.data.label ?? "").replace(/[^\p{L}\p{N} .·/-]/gu, "").slice(0, 40) || null;
  await saveSubscription(ctx.user.id, { endpoint: p.data.endpoint, p256dh: p.data.keys.p256dh, auth: p.data.keys.auth, device: p.data.device, label });
  return new Response(null, { status: 204 });
}

export async function DELETE(req: Request) {
  const ctx = await routeCtx("view");
  if (ctx instanceof Response) return ctx;
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const p = z.object({ endpoint: z.string().max(1000) }).safeParse(await body(req));
  if (!p.success) return new Response(null, { status: 400 });
  await removeSubscription(ctx.user.id, p.data.endpoint);
  return new Response(null, { status: 204 });
}
