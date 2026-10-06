"use server";

import { IMPORT_LIMIT_KEY } from "@/lib/import-vat";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import { requireCtx } from "@/lib/ctx";
import { scoped } from "@/lib/db-scoped";
import { spacePrefSet } from "@/lib/db-scoped/prefs";
import { BUDGET_KV_PREFIX, capFor, monthKeyIn, type BudgetHistory } from "@/lib/budget";
import type { Conflict } from "@/lib/conflict";
import { spacePrefBy } from "@/lib/db-scoped/prefs";
import { loadBudgetHistory } from "@/lib/data";
import type { StoreSetting } from "@/lib/types";

const storeSettingInput = z.strictObject({
  storeKey: z.string().min(1).max(80),
  freeShippingMin: z.number().nonnegative().max(1_000_000).nullable(),
  shippingFee: z.number().nonnegative().max(100_000).nullable(),
  currency: z.string().min(3).max(3),
});

/** Free-shipping threshold / flat fee for one store (edited from the orders view). */
export async function saveStoreSetting(input: z.input<typeof storeSettingInput>): Promise<StoreSetting> {
  const s = scoped(await requireCtx("edit"));
  const p = storeSettingInput.parse(input);
  const row = { ...p, currency: p.currency.toUpperCase(), updatedAt: Date.now() };
  await s.insert(schema.storeSettings, row).onConflictDoUpdate({ target: [schema.storeSettings.spaceId, schema.storeSettings.storeKey], set: row });
  const [saved] = await s.select(schema.storeSettings, eq(schema.storeSettings.storeKey, row.storeKey));
  return saved;
}

/** Monthly spending cap (null = none). Stored for the current month so past months keep the cap they had. */
/** VAT-free import limit (USD) for the import-VAT warning (G2). */
export async function saveImportLimit(usd: number): Promise<number> {
  const s = scoped(await requireCtx("edit"));
  const v = z.number().positive().max(100_000).parse(usd);
  await spacePrefSet(s, IMPORT_LIMIT_KEY, String(v));
  return v;
}

export async function saveMonthlyBudget(cap: number | null, currency: string): Promise<BudgetHistory>;
export async function saveMonthlyBudget(cap: number | null, currency: string, baseCap: number | null): Promise<BudgetHistory | Conflict<BudgetHistory>>;
/** R16 B3: `baseCap` = this month's cap the client saw; someone else changed it since → { conflict } (nothing saved). */
export async function saveMonthlyBudget(cap: number | null, currency: string, baseCap?: number | null): Promise<BudgetHistory | Conflict<BudgetHistory>> {
  const s = scoped(await requireCtx("edit"));
  const c = z.number().positive().max(10_000_000).nullable().parse(cap);
  const cur = z.string().min(3).max(3).parse(currency).toUpperCase();
  const month = monthKeyIn(Date.now(), "Asia/Jerusalem");
  if (baseCap !== undefined) {
    const base = z.number().nonnegative().nullable().parse(baseCap);
    const now = await loadBudgetHistory(s);
    const seen = now[month]?.cap ?? capFor(month, now)?.cap ?? null;
    if (seen !== base) {
      return { conflict: true, row: now, by: await spacePrefBy(s, `${BUDGET_KV_PREFIX}${month}`) };
    }
  }
  await spacePrefSet(s, `${BUDGET_KV_PREFIX}${month}`, JSON.stringify({ cap: c, currency: cur }));
  return loadBudgetHistory(s);
}
