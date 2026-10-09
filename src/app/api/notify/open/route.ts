import { cookies } from "next/headers";
import { routeCtx, SPACE_COOKIE } from "@/lib/ctx";
import { markNotificationsRead, notificationOf } from "@/lib/db-scoped/notify";

// R17 S3 J2 — a tap on a notification (push or inbox): mark it read, switch to the row's space when the person is a
// member there, then open the thing it is about (the item, or the inbox). Never redirects off-site.
export async function GET(req: Request) {
  const ctx = await routeCtx("view");
  const url = new URL(req.url);
  if (ctx instanceof Response) return Response.redirect(new URL("/login", url.origin), 303);
  const id = (url.searchParams.get("id") ?? "").slice(0, 40);
  const row = id ? await notificationOf(ctx.user.id, id) : null;
  if (!row) return Response.redirect(new URL("/inbox", url.origin), 303);
  await markNotificationsRead(ctx.user.id, [row.id]);
  if (row.spaceId && row.spaceId !== ctx.space.id && ctx.memberships.some((m) => m.spaceId === row.spaceId)) {
    (await cookies()).set(SPACE_COOKIE, row.spaceId, { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/", maxAge: 400 * 86_400 });
  }
  const data = (() => {
    try {
      return JSON.parse(row.data) as { itemId?: string };
    } catch {
      return {};
    }
  })();
  const to = new URL("/", url.origin);
  if (data.itemId && (row.kind === "price" || row.kind === "delivery")) to.searchParams.set("item", data.itemId);
  else if (row.kind === "shop" || row.kind === "activity") to.searchParams.set("v", "to_buy");
  else if (row.kind === "budget" || row.kind === "week") to.searchParams.set("v", "spending");
  return Response.redirect(to, 303);
}
