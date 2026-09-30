import { verifyExtensionRequest } from "@/lib/ext-token";
import { sourcesNeedingDetails } from "@/lib/service";
import { sourcesForExtension } from "@/lib/tracker";

// Links the server couldn't read (blocked stores) that are due for a check through the user's browser,
// plus recent links whose details are still missing — the extension fills those in the background.
export async function GET(req: Request) {
  if (!(await verifyExtensionRequest(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [stale, incomplete] = await Promise.all([sourcesForExtension(), sourcesNeedingDetails(8, 3 * 3600_000)]);
  const seen = new Set(stale.map((s) => s.id));
  const extra = incomplete.filter((s) => !seen.has(s.id)).map((s) => ({ id: s.id, url: s.url, storeKey: s.storeKey, details: true }));
  return Response.json({ sources: [...stale, ...extra] });
}
