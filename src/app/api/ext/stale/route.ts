import { verifyExtensionRequest } from "@/lib/ext-token";
import { sourcesForExtension } from "@/lib/tracker";

// Links the server couldn't read (blocked stores) that are due for a check through the user's browser.
export async function GET(req: Request) {
  if (!(await verifyExtensionRequest(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ sources: await sourcesForExtension() });
}
