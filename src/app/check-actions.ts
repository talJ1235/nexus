"use server";
import { z } from "zod";
import { schema } from "@/db";
import { HOUR, hitLimit } from "@/lib/auth/limits";
import { AccessError, requireCtx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { checkItemOnServer, type CheckNow } from "@/lib/tracker";

// R17 Q2: "Check now" on the item page / sheet — this one item's links, read now through the same fetch ladder and
// bookkeeping as the daily check (price history, alerts by the stored minDropPct). Editors only (viewers don't see it);
// 10 checks an hour per person.

export async function checkItemNow(itemId: string): Promise<CheckNow> {
  const ctx = await requireCtx("edit");
  const id = z.string().min(1).max(64).parse(itemId);
  const s = scoped(ctx);
  if (!(await s.byId(schema.items, id))) throw new AccessError("not_found");
  if (!(await hitLimit(`check-now:${ctx.user.id}`, 10, HOUR))) return { ok: false, reason: "limit" };
  return checkItemOnServer(s, id);
}
