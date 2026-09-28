"use server";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, schema } from "@/db";
import { aiEnabled } from "@/lib/ai";
import { askNexus, planProject, type Plan } from "@/lib/assistant";
import { assertOwner } from "@/lib/auth";
import { getAppData, getItem } from "@/lib/data";
import { CURRENCIES } from "@/lib/money";
import type { Collection, ItemWithSources } from "@/lib/types";

const locale = z.enum(["en", "he"]);
const currency = z.enum(CURRENCIES);

export async function planWithAi(raw: { description: string; budget: number | null; currency: string; locale: string; collectionId: string | null }): Promise<Plan | { error: "no_ai" | "failed" }> {
  await assertOwner();
  if (!aiEnabled()) return { error: "no_ai" };
  const input = z
    .object({ description: z.string().min(3).max(3000), budget: z.number().positive().max(1e8).nullable(), currency, locale, collectionId: z.string().nullable() })
    .parse(raw);
  const existing = input.collectionId
    ? (await db.select({ title: schema.items.title }).from(schema.items).where(eq(schema.items.collectionId, input.collectionId))).map((r) => r.title)
    : [];
  const plan = await planProject({ description: input.description, budget: input.budget, currency: input.currency, locale: input.locale, existing });
  return plan ?? { error: "failed" };
}

const part = z.object({
  name: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(1000),
  spec: z.string().max(300),
  estMin: z.number().nullable(),
  estMax: z.number().nullable(),
  category: z.string().max(40),
  essential: z.boolean(),
  searchQuery: z.string().max(120),
});

/** Add the chosen planned parts as link-less items (with search queries) to an existing or new project. */
export async function addPlannedParts(raw: {
  parts: z.input<typeof part>[];
  collectionId: string | null;
  newProject: { name: string; description: string; budget: number | null } | null;
  currency: string;
  estimateLabel: string;
}): Promise<{ items: ItemWithSources[]; collection: Collection | null }> {
  await assertOwner();
  const input = z
    .object({
      parts: z.array(part).min(1).max(40),
      collectionId: z.string().nullable(),
      newProject: z.object({ name: z.string().min(1).max(80), description: z.string().max(500), budget: z.number().positive().nullable() }).nullable(),
      currency,
      estimateLabel: z.string().max(40),
    })
    .parse(raw);

  let collection: Collection | null = null;
  let collectionId = input.collectionId;
  if (input.newProject) {
    [collection] = await db
      .insert(schema.collections)
      .values({
        id: nanoid(10),
        kind: "project",
        name: input.newProject.name,
        description: input.newProject.description || null,
        budget: input.newProject.budget,
        budgetCurrency: input.currency,
        sortOrder: Date.now() % 1e9,
      })
      .returning();
    collectionId = collection.id;
  }

  const t0 = Date.now();
  const ids: string[] = [];
  for (const [i, p] of input.parts.entries()) {
    const id = nanoid(12);
    const est =
      p.estMin != null || p.estMax != null
        ? `${input.estimateLabel}: ${[p.estMin, p.estMax].filter((v) => v != null).map((v) => Math.round(v!)).join("–")} ${input.currency}`
        : null;
    await db.insert(schema.items).values({
      id,
      title: p.name,
      category: p.category,
      tags: [],
      collectionId,
      quantity: p.qty,
      priority: p.essential ? "normal" : "someday",
      notes: [p.spec, est].filter(Boolean).join("\n") || null,
      searchQuery: p.searchQuery || p.name,
      createdAt: t0 + (input.parts.length - i),
      updatedAt: t0,
    });
    ids.push(id);
  }
  const items = (await Promise.all(ids.map(getItem))).filter(Boolean) as ItemWithSources[];
  return { items, collection };
}

export async function ask(raw: { question: string; history: { role: "user" | "assistant"; text: string }[]; currency: string; locale: string }): Promise<{ text: string } | { error: "no_ai" | "failed" }> {
  await assertOwner();
  if (!aiEnabled()) return { error: "no_ai" };
  const input = z
    .object({
      question: z.string().min(1).max(1500),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(20),
      currency,
      locale,
    })
    .parse(raw);
  const text = await askNexus({ ...input, data: await getAppData() });
  return text ? { text } : { error: "failed" };
}
