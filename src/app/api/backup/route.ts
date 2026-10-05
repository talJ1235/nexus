import { routeCtx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { buildBackup, restoreBackup } from "@/lib/db-scoped/backup";

export const maxDuration = 60;

// R15 B3: the current space only, owner role; restore only into a space you own (the current one).
export async function GET() {
  const ctx = await routeCtx("owner");
  if (ctx instanceof Response) return ctx;
  const backup = await buildBackup(scoped(ctx));
  const name = `nexus-backup-${backup.exportedAt.slice(0, 10)}.json`;
  return new Response(JSON.stringify(backup), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  const ctx = await routeCtx("owner");
  if (ctx instanceof Response) return ctx;
  const mode = new URL(req.url).searchParams.get("mode") === "replace" ? "replace" : "merge";
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const counts = await restoreBackup(scoped(ctx), body, mode);
    return Response.json({ ok: true, counts });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    return Response.json({ error: msg === "not_a_backup" ? msg : "restore_failed" }, { status: 400 });
  }
}
