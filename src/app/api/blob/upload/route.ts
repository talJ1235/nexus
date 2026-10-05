import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireCtx } from "@/lib/ctx";

// Issues short-lived tokens so the browser uploads receipts straight to Vercel Blob (bypasses the ~4.5 MB serverless
// request limit). R15 B3: session + edit role in the current space; path must be spaces/<thatSpace>/receipts/…;
// content-type allow-list (JPEG, PNG, WebP, HEIC, PDF), 20 MB cap, random suffix. Blobs stay public but unguessable
// (a private Blob store needs a new store — see docs/ROUND15.md Open) and are only ever shown inside their space.
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

export async function POST(request: Request) {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const ctx = await requireCtx("edit");
        const prefix = `spaces/${ctx.space.id}/receipts/`;
        if (!pathname.startsWith(prefix) || pathname.includes("..") || pathname.length > 300) throw new Error("bad_path");
        return { allowedContentTypes: TYPES, maximumSizeInBytes: 20 * 1024 * 1024, addRandomSuffix: true };
      },
    });
    return Response.json(result);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    return Response.json({ error: msg === "unauthorized" || msg === "forbidden" || msg === "bad_path" ? msg : "upload_failed" }, { status: msg === "unauthorized" ? 401 : 400 });
  }
}
