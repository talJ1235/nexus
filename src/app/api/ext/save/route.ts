import { z } from "zod";
import { verifyExtensionRequest } from "@/lib/ext-token";
import { addSourceCore, clientPayload, createItemCore, previewFromClientCore } from "@/lib/service";

export const maxDuration = 60;

const body = z.object({
  payload: clientPayload,
  collectionId: z.string().nullable().optional(),
  quantity: z.number().int().min(1).max(100000).optional(),
  mode: z.enum(["auto", "source", "separate"]).default("auto"),
});

export async function POST(req: Request) {
  if (!(await verifyExtensionRequest(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  let input: z.infer<typeof body>;
  try {
    input = body.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const { draft, duplicate } = await previewFromClientCore(input.payload, input.collectionId ?? null);
  if (input.collectionId) draft.collectionId = input.collectionId;

  if (duplicate && input.mode === "auto") return Response.json({ status: "duplicate", duplicate });
  if (duplicate && input.mode === "source") {
    const item = await addSourceCore(duplicate.itemId, draft.source, draft.imageUrl);
    return Response.json({ status: "saved", item: { id: item.id, title: item.title } });
  }
  const item = await createItemCore({ ...draft, quantity: input.quantity ?? 1 });
  return Response.json({ status: "saved", item: { id: item.id, title: item.title } });
}
