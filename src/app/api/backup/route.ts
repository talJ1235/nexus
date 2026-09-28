import { buildBackup, restoreBackup } from "@/lib/backup";

export const maxDuration = 60;

// Owner-only: /api/* is behind the session check in proxy.ts.
export async function GET() {
  const backup = await buildBackup();
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
  const mode = new URL(req.url).searchParams.get("mode") === "replace" ? "replace" : "merge";
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const counts = await restoreBackup(body, mode);
    return Response.json({ ok: true, counts });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    return Response.json({ error: msg === "not_a_backup" ? msg : "restore_failed" }, { status: 400 });
  }
}
