"use server";

import { meInfo, requireCtx, spaceInfo } from "@/lib/ctx";
import { getAppData } from "@/lib/data";
import { scoped } from "@/lib/db-scoped";
import { spaceShell } from "@/lib/spaces";
import type { AppData } from "@/lib/types";

/**
 * R16 A12 — the current space's data, exactly what the first render loads (`page.tsx` LoadedApp): the client swaps its
 * store with it after a space switch instead of reloading the page. Also the change feed's "reset" path (Part B).
 */
export async function loadAppData(): Promise<AppData> {
  const ctx = await requireCtx("view");
  const [data, shell] = await Promise.all([getAppData(scoped(ctx), ctx.user.id, spaceInfo(ctx), meInfo(ctx)), spaceShell(ctx.memberships, ctx.space)]);
  return { ...data, ...shell };
}
