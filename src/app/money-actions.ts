"use server";

import { IMPORT_LIMIT_KEY } from "@/lib/import-vat";
import { z } from "zod";
import { db, schema } from "@/db";
import { assertOwner } from "@/lib/auth";
import { BUDGET_KV_PREFIX, monthKeyIn, type BudgetHistory } from "@/lib/budget";
import { loadBudgetHistory } from "@/lib/data";
import { kvSet } from "@/lib/kv";
import type { StoreSetting } from "@/lib/types";

const storeSettingInput = z.object({
  storeKey: z.string().min(1).max(80),
  freeShippingMin: z.number().nonnegative().max(1_000_000).nullable(),
  shippingFee: z.number().nonnegative().max(100_000).nullable(),
  currency: z.string().min(3).max(3),
});

/** Free-shipping threshold / flat fee for one store (edited from the orders view). */
export async function saveStoreSetting(input: z.input<typeof storeSettingInput>): Promise<StoreSetting> {
  await assertOwner();
  const p = storeSettingInput.parse(input);
  const row = { ...p, currency: p.currency.toUpperCase(), updatedAt: Date.now() };
  await db.insert(schema.storeSettings).values(row).onConflictDoUpdate({ target: schema.storeSettings.storeKey, set: row });
  return row;
}

/** Monthly spending cap (null = none). Stored for the current month so past months keep the cap they had. */
/** VAT-free import limit (USD) for the import-VAT warning (G2). */
export async function saveImportLimit(usd: number): Promise<number> {
  await assertOwner();
  const v = z.number().positive().max(100_000).parse(usd);
  await kvSet(IMPORT_LIMIT_KEY, String(v));
  return v;
}

export async function saveMonthlyBudget(cap: number | null, currency: string): Promise<BudgetHistory> {
  await assertOwner();
  const c = z.number().positive().max(10_000_000).nullable().parse(cap);
  const cur = z.string().min(3).max(3).parse(currency).toUpperCase();
  await kvSet(`${BUDGET_KV_PREFIX}${monthKeyIn(Date.now(), "Asia/Jerusalem")}`, JSON.stringify({ cap: c, currency: cur }));
  return loadBudgetHistory();
}
