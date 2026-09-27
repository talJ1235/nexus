import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";

// Issues short-lived tokens so the browser uploads receipts straight to Vercel Blob
// (bypasses the ~4.5 MB serverless request limit). Only for the signed-in owner.
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const jar = await cookies();
        if (!(await verifySessionValue(jar.get(SESSION_COOKIE)?.value))) throw new Error("unauthorized");
        if (!pathname.startsWith("receipts/")) throw new Error("bad_path");
        return {
          allowedContentTypes: ["image/*", "application/pdf"],
          maximumSizeInBytes: 20 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 400 });
  }
}
