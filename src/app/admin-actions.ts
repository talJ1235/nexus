"use server";

import { z } from "zod";
import { aiAllowance, writeAiQuota, type Allowance } from "@/lib/ai-gate";
import { AccessError, isAdmin, requireCtx } from "@/lib/ctx";

// R17 E2 — the per-person AI quota (the Session 2 admin panel puts a screen on these). Admin only.

async function admin() {
  const ctx = await requireCtx("view");
  if (!isAdmin(ctx)) throw new AccessError("not_found");
  return ctx;
}

const UserId = z.string().min(4).max(64);

/** A person's AI today (switch, limit, used). */
export async function getAiAllowance(userId: string): Promise<Allowance> {
  await admin();
  return aiAllowance(UserId.parse(userId));
}

/** A person's daily limit: a number (0–1000), "unlimited", or null = back to the default (40). */
export async function setAiQuota(userId: string, limit: number | "unlimited" | null): Promise<Allowance> {
  await admin();
  const id = UserId.parse(userId);
  await writeAiQuota(id, z.union([z.number().int().min(0).max(1000), z.literal("unlimited"), z.null()]).parse(limit));
  return aiAllowance(id);
}
