import { routeCtx } from "@/lib/ctx";
import { parseUpload } from "@/lib/importer";

export const maxDuration = 60;

// Signed-in editors of the current space. Parses an uploaded CSV/XLSX and returns columns + rows for mapping
// (nothing is stored here; importRows writes into the current space).
export async function POST(req: Request) {
  const ctx = await routeCtx("edit");
  if (ctx instanceof Response) return ctx;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return Response.json({ error: "no_file" }, { status: 400 });
  if (file.size > 4_000_000) return Response.json({ error: "too_large" }, { status: 413 });
  if (!/\.(csv|tsv|txt|xlsx)$/i.test(file.name)) return Response.json({ error: "unsupported" }, { status: 415 });
  try {
    return Response.json(await parseUpload(file.name, await file.arrayBuffer()));
  } catch {
    return Response.json({ error: "unreadable" }, { status: 422 });
  }
}
