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
    orderNumber: text("order_number"),
    // Barcode (GTIN, digits) when the item was added by scanning; store links keep theirs on sources.gtin.
    gtin: text("gtin"),
    altGroupId: text("alt_group_id"),
    // Where the picture came from when Nexus found it (store / search / extension / icon); null = the user's or the link's.
    imageSource: text("image_source"),
    // Price tracking: alert when the price reaches this (in targetCurrency). `watch` = include in daily checks.
    targetPrice: real("target_price"),
    targetCurrency: text("target_currency"),
    watch: integer("watch", { mode: "boolean" }).notNull().default(true),
    // For items planned without a link yet (AI planner): what to search for in stores.
    searchQuery: text("search_query"),
    // Who added it when it came from a shared guest (null = the owner).
    addedByMemberId: text("added_by_member_id"),
    addedByName: text("added_by_name"),
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
    // Barcode from the store page's JSON-LD (gtin13/12/8/gtin), digits only.
    gtin: text("gtin"),
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

/** A person the owner shared something with (one per device/browser that accepted an invite). */
export const members = sqliteTable("members", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  lastSeenAt: integer("last_seen_at"),
  revokedAt: integer("revoked_at"),
});

/** What a member can see/do. */
export const grants = sqliteTable(
  "grants",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull(),
    collectionId: text("collection_id").notNull(),
    role: text("role", { enum: ["viewer", "editor"] }).notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("grants_member_idx").on(t.memberId), index("grants_collection_idx").on(t.collectionId)],
);

/** Reusable invite link for a collection (revocable). Only a SHA-256 of the token is stored. */
export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    collectionId: text("collection_id").notNull(),
    role: text("role", { enum: ["viewer", "editor"] }).notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    revokedAt: integer("revoked_at"),
  },
  (t) => [index("invites_token_idx").on(t.tokenHash), index("invites_collection_idx").on(t.collectionId)],
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
export type Member = typeof members.$inferSelect;
export type Grant = typeof grants.$inferSelect;
export type Invite = typeof invites.$inferSelect;

/** Per-store order settings (free-shipping threshold, flat shipping fee), keyed by the sources' storeKey. */
export const storeSettings = sqliteTable("store_settings", {
  storeKey: text("store_key").primaryKey(),
  freeShippingMin: real("free_shipping_min"),
  currency: text("currency").notNull().default("ILS"),
  shippingFee: real("shipping_fee"),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});
export type StoreSetting = typeof storeSettings.$inferSelect;

/**
 * An uploaded receipt / order confirmation (file in Vercel Blob, or pasted email text) and what was read from it.
 * Kept when extraction fails so it can be retried; `appliedAt` once its lines were matched to items.
 */
export const receipts = sqliteTable("receipts", {
  id: text("id").primaryKey(),
  url: text("url"),
  name: text("name").notNull(),
  contentType: text("content_type"),
  size: integer("size"),
  text: text("text"),
  status: text("status", { enum: ["new", "extracted", "failed", "applied"] }).notNull().default("new"),
  data: text("data", { mode: "json" }).$type<unknown>(),
  // More photos of the same long receipt (tiles / extra parts, in order), after `url`.
  parts: text("parts", { mode: "json" }).$type<string[]>(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  appliedAt: integer("applied_at"),
});
export type Receipt = typeof receipts.$inferSelect;

/** Problems, complaints and ideas sent from the app (Round 8 D3), with what the app could tell about itself. */
export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["bug", "complaint", "idea"] }).notNull(),
  title: text("title").notNull(),
  // Markdown: what happened, steps, expected, actual (lib/reports.ts reportBody).
  body: text("body").notNull(),
  diagnostics: text("diagnostics", { mode: "json" }).$type<unknown>(),
  // Optional picked screenshot: a small JPEG data URL.
  screenshot: text("screenshot"),
  status: text("status", { enum: ["open", "in_progress", "fixed", "wont_fix"] }).notNull().default("open"),
  githubIssue: integer("github_issue"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});
export type Report = typeof reports.$inferSelect;

/** Saved assistant conversations (Round 9 C2). `deletedAt` = in the bin (undo), purged later. */
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default(""),
  // Modes used: "chat", "plan".
  modes: text("modes", { mode: "json" }).$type<string[]>(),
  // Items and reports the conversation touched.
  links: text("links", { mode: "json" }).$type<{ items?: string[]; reports?: string[] }>(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  deletedAt: integer("deleted_at"),
});
export type Conversation = typeof conversations.$inferSelect;

export const conversationMessages = sqliteTable("conversation_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  text: text("text").notNull(),
  // Cards that came with the message: plan, mode, target, route (proposals/report drafts are kept as text only).
  data: text("data", { mode: "json" }).$type<unknown>(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});
export type ConversationMessage = typeof conversationMessages.$inferSelect;

/** Things Nexus learned about the owner's shopping (Round 9 C3): confirmed in chat or typed in Settings. */
export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  text: text("text").notNull(),
  source: text("source", { enum: ["chat", "manual"] }).notNull().default("chat"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});
export type Memory = typeof memories.$inferSelect;
