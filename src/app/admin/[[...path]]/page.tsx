import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminApp } from "@/components/admin/admin-app";
import { parseRoute } from "@/components/admin/route";
import { APP_NAME } from "@/lib/brand";
import { currentCtx, isAdmin } from "@/lib/ctx";

export const metadata: Metadata = { title: `Admin · ${APP_NAME}`, robots: { index: false, follow: false } };

// R17 G0: the admin panel — /admin and /admin/<tab>[/<id>] (live, people, people/<id>, invites, ai, reports,
// reports/<id>, errors, system; R16's /admin/errors is the Errors tab). The admin only; everyone else gets a 404.
export default async function AdminPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const ctx = await currentCtx();
  if (!ctx) redirect("/login?next=/admin");
  if (!isAdmin(ctx)) notFound();
  const { path } = await params;
  const route = parseRoute(`/admin/${(path ?? []).map(encodeURIComponent).join("/")}`);
  if ((path?.length ?? 0) > 2 || (path?.[0] && route.tab === "live" && path[0] !== "live")) notFound();
  return <AdminApp initial={route} me={ctx.user.id} />;
}
