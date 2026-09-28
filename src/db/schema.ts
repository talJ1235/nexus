import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const OWNER = "owner";

export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default(OWNER),
    kind: text("kind", { enum: ["project", "list"] }).notNull().default("list"),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").notNull().default("amber"),
    budget: real("budget"),
    budgetCurrency: text("budget_currency").notNull().default("ILS"),
    shareToken: text("share_token"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("collections_share_idx").on(t.shareToken)],
);

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default(OWNER),
    collectionId: text("collection_id"),
    title: text("title").notNull(),
    brand: text("brand"),
    imageUrl: text("image_url"),
    category: text("category"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    // to_buy → ordered (on the way) → purchased (received / done)
    status: text("status", { enum: ["to_buy", "ordered", "purchased"] }).notNull().default("to_buy"),
    priority: text("priority", { enum: ["urgent", "normal", "someday"] })
      .notNull()
      .default("normal"),
    quantity: integer("quantity").notNull().default(1),
    notes: text("notes"),
    chosenSourceId: text("chosen_source_id"),
    orderedAt: integer("ordered_at"),
    purchasedAt: integer("purchased_at"),
    // Unit price actually paid (captured when ordered/purchased).
    purchasedPrice: real("purchased_price"),
    purchasedCurrency: text("purchased_currency"),
    trackingNumber: text("tracking_number"),
    carrier: text("carrier"),
    eta: integer("eta"),
    altGroupId: text("alt_group_id"),
    // Price tracking: alert when the price reaches this (in targetCurrency). `watch` = include in daily checks.
    targetPrice: real("target_price"),
    targetCurrency: text("target_currency"),
    watch: integer("watch", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("items_collection_idx").on(t.collectionId), index("items_status_idx").on(t.status), index("items_alt_idx").on(t.altGroupId)],
);

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull(),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    store: text("store").notNull(),
    storeKey: text("store_key").notNull(),
    price: real("price"),
    currency: text("currency").notNull().default("ILS"),
    shipping: real("shipping"),
    availability: text("availability"),
    rawTitle: text("raw_title"),
    extractMethod: text("extract_method"),
    fetchedAt: integer("fetched_at"),
    // Consecutive failed server-side checks (blocked store) — those get checked through the browser extension.
    checkFails: integer("check_fails").notNull().default(0),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("sources_item_idx").on(t.itemId), index("sources_norm_idx").on(t.normalizedUrl)],
);

/** A set of items that are options for the same need; one can be picked as the winner. */
export const altGroups = sqliteTable("alt_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  chosenItemId: text("chosen_item_id"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

/** Price observed for a store link at a point in time. */
export const pricePoints = sqliteTable(
  "price_points",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    itemId: text("item_id").notNull(),
    price: real("price").notNull(),
    currency: text("currency").notNull(),
    recordedAt: integer("recorded_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("price_points_source_idx").on(t.sourceId), index("price_points_item_idx").on(t.itemId)],
);

/** Receipts / invoices attached to an item (files live in Vercel Blob). */
export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull(),
    url: text("url").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("attachments_item_idx").on(t.itemId)],
);

/** Something worth telling the user about a watched item. */
export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull(),
    sourceId: text("source_id"),
    kind: text("kind", { enum: ["drop", "target", "back_in_stock", "out_of_stock"] }).notNull(),
    oldPrice: real("old_price"),
    newPrice: real("new_price"),
    currency: text("currency"),
    sentAt: integer("sent_at"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("alerts_item_idx").on(t.itemId), index("alerts_created_idx").on(t.createdAt)],
);

export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export type Collection = typeof collections.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type AltGroup = typeof altGroups.$inferSelect;
export type PricePoint = typeof pricePoints.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
