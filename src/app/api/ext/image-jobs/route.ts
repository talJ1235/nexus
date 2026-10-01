import { z } from "zod";
import { verifyExtensionRequest } from "@/lib/ext-token";
import { acceptExtensionImage, dropImageJob, listImageJobs } from "@/lib/product-image";
import { isPublicHttpUrl } from "@/lib/utils";

export const maxDuration = 30;

// Items Nexus couldn't find a picture for: the owner's extension searches the store's site / Google Images in the
// owner's browser and posts the best product image (and the product page it came from).
export async function GET(req: Request) {
  if (!(await verifyExtensionRequest(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ jobs: (await listImageJobs()).slice(0, 5) });
}

const body = z.object({ itemId: z.string().max(40), imageUrl: z.string().url().max(2000).nullable(), pageUrl: z.string().url().max(2000).nullish() });

export async function POST(req: Request) {
  if (!(await verifyExtensionRequest(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  let b: z.infer<typeof body>;
  try {
    b = body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!b.imageUrl || !isPublicHttpUrl(b.imageUrl)) {
    await dropImageJob(b.itemId);
    return Response.json({ ok: false });
  }
  return Response.json({ ok: await acceptExtensionImage(b.itemId, b.imageUrl) });
}
