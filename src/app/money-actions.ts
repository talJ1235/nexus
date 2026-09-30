"use server";

import { z } from "zod";
import { db, schema } from "@/db";
import { assertOwner } from "@/lib/auth";
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
