import { hitLimit, MINUTE } from "@/lib/auth/limits";
import { routeCtx } from "@/lib/ctx";
import { updateSpace } from "@/lib/spaces";
import { deleteSpacePhoto, encodeSpacePhoto, PHOTO_MAX_IN, PHOTO_TYPES, storeSpacePhoto } from "@/lib/space-photo";

export const maxDuration = 30;

// R16 D5: the current space's photo — owners only. POST = the cropped square (raw image body, ≤ 4 MB, JPEG/PNG/WebP/
// HEIC); it is re-encoded to a 512 px WebP without metadata and replaces the old one (deleted). DELETE = back to the
// icon. Same-origin only; 20 changes an hour per person.

function sameOrigin(req: Request) {
  const o = req.headers.get("origin");
  return !o || o === new URL(req.url).origin;
}

export async function POST(req: Request) {
  const ctx = await routeCtx("owner");
  if (ctx instanceof Response) return ctx;
  if (!sameOrigin(req)) return Response.json({ error: "origin" }, { status: 403 });
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!PHOTO_TYPES.includes(type)) return Response.json({ error: "type" }, { status: 415 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > PHOTO_MAX_IN) return Response.json({ error: "too_large" }, { status: 413 });
  if (!(await hitLimit(`space-photo:${ctx.user.id}`, 20, 60 * MINUTE))) return Response.json({ error: "limit" }, { status: 429 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length || buf.length > PHOTO_MAX_IN) return Response.json({ error: "too_large" }, { status: 413 });
  let webp: Buffer;
  try {
    webp = await encodeSpacePhoto(buf);
  } catch {
    return Response.json({ error: "unreadable" }, { status: 422 });
  }
  const url = await storeSpacePhoto(ctx.space.id, webp);
  await updateSpace(ctx.space.id, { logo: url });
  await deleteSpacePhoto(ctx.space.photo);
  return Response.json({ ok: true, url });
}

export async function DELETE(req: Request) {
  const ctx = await routeCtx("owner");
  if (ctx instanceof Response) return ctx;
  if (!sameOrigin(req)) return Response.json({ error: "origin" }, { status: 403 });
  await updateSpace(ctx.space.id, { logo: null });
  await deleteSpacePhoto(ctx.space.photo);
  return Response.json({ ok: true });
}
