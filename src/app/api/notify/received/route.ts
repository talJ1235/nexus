import { schema } from "@/db";
import { allows, routeCtx } from "@/lib/ctx";
import { Scoped } from "@/lib/db-scoped";
import { notificationOf, patchNotificationData } from "@/lib/db-scoped/notify";
import { guardedUpdate } from "@/lib/conflict";
import { noteActivity } from "@/lib/activity";
import { statusPatch } from "@/lib/status";

// R17 S3 J2 — the "Received" action of a delivery notification (service worker, or the inbox row). Needs the session
// cookie (401 without one); the row must be this person's delivery row, and they must be able to edit its space.
// Moves the item On the way → bought, exactly like the app's own "Received".
export async function POST(req: Request) {
  const ctx = await routeCtx("view");
  if (ctx instanceof Response) return ctx;
  const o = req.headers.get("origin");
  if (o && o !== new URL(req.url).origin) return new Response(null, { status: 403 });
  let id = "";
  try {
    id = String(((await req.json()) as { id?: unknown })?.id ?? "").slice(0, 40);
  } catch {}
  const row = id ? await notificationOf(ctx.user.id, id) : null;
  if (!row || row.kind !== "delivery" || !row.spaceId) return new Response(null, { status: 404 });
  const m = ctx.memberships.find((x) => x.spaceId === row.spaceId);
  if (!m || !allows(m.role, "edit")) return new Response(null, { status: 403 });
  const data = JSON.parse(row.data) as { itemId?: string; received?: boolean };
  if (!data.itemId) return new Response(null, { status: 404 });
  const s = new Scoped({ spaceId: row.spaceId, userId: ctx.user.id });
  let moved = false;
  const c = await guardedUpdate(s, schema.items, data.itemId, (cur) => {
    if (cur.status !== "ordered") return {};
    moved = true;
    return statusPatch("purchased", null, cur);
  }, undefined).catch(() => ({ by: null }));
  if (c) return new Response(null, { status: 409 });
  if (moved) noteActivity({ userId: ctx.user.id, spaceId: row.spaceId }, "delivery_received");
  await patchNotificationData([ctx.user.id], row.groupKey, { ...data, received: true }, Date.now());
  return Response.json({ ok: true, moved });
}
