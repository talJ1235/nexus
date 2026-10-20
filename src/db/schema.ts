import { sql } from "drizzle-orm";
import type { Candidate } from "@/lib/picture-rank";
import type { LineInfo } from "@/lib/product-lines";
import { integer, real, sqliteTable, text, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";


export const collections = sqliteTable(
  "collections",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    // R16 B1: change feed — the space revision of the last write, and who made it (user id; "system" = cron).
    rev: integer("rev").notNull().default(0),
    revBy: text("rev_by"),
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
  (t) => [index("collections_share_idx").on(t.shareToken), index("collections_space_idx").on(t.spaceId, t.createdAt)],
);

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    // R16 B1: change feed — the space revision of the last write, and who made it (user id; "system" = cron).
    rev: integer("rev").notNull().default(0),
    revBy: text("rev_by"),
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
    // R16 A1: the paid price kept when the item goes back to To buy (shown as "Last paid", pre-fills the next purchase).
    lastPaidPrice: real("last_paid_price"),
    lastPaidCurrency: text("last_paid_currency"),
    // R17 B1: the store's original title when `title` holds a short name (null = the title is the original).
    fullTitle: text("full_title"),
    trackingNumber: text("tracking_number"),
    carrier: text("carrier"),
    eta: integer("eta"),
    orderNumber: text("order_number"),
    // Barcode (GTIN, digits) when the item was added by scanning; store links keep theirs on sources.gtin.
    gtin: text("gtin"),
    altGroupId: text("alt_group_id"),
    // Where the picture came from when Nexus found it (store / search / extension / icon); null = the user's or the link's.
    imageSource: text("image_source"),
    // Round 10 D: what the product is (cleaned receipt line, queries — for re-searching), the ranked alternative
    // pictures for the picker (up to 6), and "check" = Nexus's best guess that the owner hasn't approved yet.
    productInfo: text("product_info", { mode: "json" }).$type<LineInfo | null>(),
    imageCandidates: text("image_candidates", { mode: "json" }).$type<Candidate[] | null>(),
    imageCheck: integer("image_check", { mode: "boolean" }).notNull().default(false),
    /** R19 C1: the catalog product a supermarket row is (gtin), how it got it (auto / picked / any / ask), when. */
    catalogGtin: text("catalog_gtin"),
    matchState: text("match_state", { enum: ["auto", "picked", "any", "ask", "none"] }),
    matchAt: integer("match_at"),
    // Price tracking: alert when the price reaches this (in targetCurrency). `watch` = include in daily checks.
    targetPrice: real("target_price"),
    targetCurrency: text("target_currency"),
    watch: integer("watch", { mode: "boolean" }).notNull().default(true),
    // For items planned without a link yet (AI planner): what to search for in stores.
    searchQuery: text("search_query"),
    // Who added it when it came from a shared guest (null = the owner).
    addedByMemberId: text("added_by_member_id"),
    addedByName: text("added_by_name"),
    // R15: who added it (shown as a small avatar in shared spaces).
    addedByUserId: text("added_by_user_id"),
    // R18 A1: which list — the stores' Products (default) or the space's one Supermarket list.
    list: text("list", { enum: ["products", "supermarket"] }).notNull().default("products"),
    // Supermarket fields (lib/grocery): section key, unit (null = units) + amount for kg / g / L (quantity stays the
    // unit count), the product across trips, staple behaviour, a store it must be bought in, brand + substitutes, picture key.
    section: text("section"),
    unit: text("unit", { enum: ["u", "kg", "g", "l"] }),
    amount: real("amount"),
    // R18 S2 B1: pieces ("6 tomatoes"), next to the weight (amount + unit) or alone; null = not given.
    count: integer("count"),
    productKey: text("product_key"),
    staple: text("staple", { enum: ["off", "suggest", "auto"] }).notNull().default("off"),
    pinnedStore: text("pinned_store"),
    preferBrand: text("prefer_brand"),
    substitutes: text("substitutes", { mode: "json" }).$type<string[] | null>(),
    artKey: text("art_key"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("items_space_list_idx").on(t.spaceId, t.list, t.status),
    index("items_collection_idx").on(t.collectionId),
    index("items_status_idx").on(t.status),
    index("items_alt_idx").on(t.altGroupId),
    index("items_space_status_idx").on(t.spaceId, t.status),
    index("items_space_created_idx").on(t.spaceId, t.createdAt),
  ],
);

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    // R16 B1: change feed — the space revision of the last write, and who made it (user id; "system" = cron).
    rev: integer("rev").notNull().default(0),
    revBy: text("rev_by"),
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
  (t) => [index("sources_item_idx").on(t.itemId), index("sources_norm_idx").on(t.normalizedUrl), index("sources_space_idx").on(t.spaceId)],
);

/** A set of items that are options for the same need; one can be picked as the winner. */
export const altGroups = sqliteTable("alt_groups", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull(),
  // R16 B1: change feed — the space revision of the last write, and who made it (user id; "system" = cron).
  rev: integer("rev").notNull().default(0),
  revBy: text("rev_by"),
  name: text("name").notNull(),
  chosenItemId: text("chosen_item_id"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

/** Price observed for a store link at a point in time. */
export const pricePoints = sqliteTable(
  "price_points",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    // R16 B1: change feed — the space revision of the last write, and who made it (user id; "system" = cron).
    rev: integer("rev").notNull().default(0),
    revBy: text("rev_by"),
    sourceId: text("source_id").notNull(),
    itemId: text("item_id").notNull(),
    price: real("price").notNull(),
    currency: text("currency").notNull(),
    recordedAt: integer("recorded_at").notNull().default(sql`(unixepoch() * 1000)`),
    // R18 A2: a price seen in a store during a trip (source_id = "trip:<id>") carries the branch and the barcode.
    tripId: text("trip_id"),
    chain: text("chain"),
    branch: text("branch"),
    gtin: text("gtin"),
  },
  (t) => [index("price_points_source_idx").on(t.sourceId), index("price_points_item_idx").on(t.itemId), index("price_points_space_idx").on(t.spaceId)],
);

/** Receipts / invoices attached to an item (files live in Vercel Blob). */
export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    // R16 B1: change feed — the space revision of the last write, and who made it (user id; "system" = cron).
    rev: integer("rev").notNull().default(0),
    revBy: text("rev_by"),
    itemId: text("item_id").notNull(),
    url: text("url").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index("attachments_item_idx").on(t.itemId), index("attachments_space_idx").on(t.spaceId)],
);

/** Something worth telling the user about a watched item. */
export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    // R16 B1: change feed — the space revision of the last write, and who made it (user id; "system" = cron).
    rev: integer("rev").notNull().default(0),
    revBy: text("rev_by"),
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
  (t) => [index("alerts_item_idx").on(t.itemId), index("alerts_created_idx").on(t.createdAt), index("alerts_space_idx").on(t.spaceId, t.createdAt)],
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
export const storeSettings = sqliteTable(
  "store_settings",
  {
    spaceId: text("space_id").notNull(),
    // R16 B1: change feed — the space revision of the last write, and who made it (user id; "system" = cron).
    rev: integer("rev").notNull().default(0),
    revBy: text("rev_by"),
    storeKey: text("store_key").notNull(),
    freeShippingMin: real("free_shipping_min"),
    currency: text("currency").notNull().default("ILS"),
    shippingFee: real("shipping_fee"),
    updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.storeKey] })],
);
export type StoreSetting = typeof storeSettings.$inferSelect;

/**
 * An uploaded receipt / order confirmation (file in Vercel Blob, or pasted email text) and what was read from it.
 * Kept when extraction fails so it can be retried; `appliedAt` once its lines were matched to items.
 */
export const receipts = sqliteTable("receipts", {
  id: text("id").primaryKey(),
  spaceId: text("space_id").notNull(),
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
  // R15: who sent it (the admin sees every report; space content is never attached).
  userId: text("user_id"),
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
  // R15: chats are personal — per user within a space.
  spaceId: text("space_id").notNull(),
  userId: text("user_id").notNull(),
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
  spaceId: text("space_id").notNull(),
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
  // R15: memory is per user (across their spaces).
  userId: text("user_id").notNull(),
  text: text("text").notNull(),
  source: text("source", { enum: ["chat", "manual"] }).notNull().default("chat"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});
export type Memory = typeof memories.$inferSelect;

// R15: accounts, sessions, spaces.
export * from "./auth-schema";

// ---------- R16 B1: change feed ----------

/**
 * One monotonic revision per space, bumped in the same transaction as every write through the scoped layer.
 * floor = the oldest revision the tombstones still cover (older clients reload); resetRev = a bulk change (a list moved
 * to another space) that a client older than it can't replay (it reloads).
 */
export const spaceRev = sqliteTable("space_rev", {
  spaceId: text("space_id").primaryKey(),
  rev: integer("rev").notNull().default(0),
  floor: integer("floor").notNull().default(0),
  resetRev: integer("reset_rev").notNull().default(0),
});

// ---------- R16 C2: automatic error log ----------

/**
 * One row per error fingerprint (kind + code + where + normalised message). No user ids: `users` is a distinct count
 * kept through error_user (HMAC of user + fingerprint, unlinkable across fingerprints). `sample` is redacted.
 */
export const errorEvent = sqliteTable(
  "error_event",
  {
    fingerprint: text("fingerprint").primaryKey(),
    kind: text("kind").notNull(), // server | client | extract | ai | cron | csp | auth | viewport
    code: text("code").notNull(),
    where: text("where_at").notNull(),
    message: text("message").notNull(),
    sample: text("sample"),
    release: text("release"),
    count: integer("count").notNull().default(1),
    users: integer("users").notNull().default(0),
    status: text("status", { enum: ["new", "known", "fixed"] }).notNull().default("new"),
    firstSeen: integer("first_seen").notNull(),
    lastSeen: integer("last_seen").notNull(),
  },
  (t) => [index("error_event_last_idx").on(t.lastSeen), index("error_event_count_idx").on(t.count)],
);
export const errorUser = sqliteTable("error_user", { fingerprint: text("fingerprint").notNull(), userHash: text("user_hash").notNull() }, (t) => [primaryKey({ columns: [t.fingerprint, t.userHash] })]);
export type ErrorEvent = typeof errorEvent.$inferSelect;

/** A deleted row of a synced table (kept 30 days): clients remove it when they see a rev newer than theirs. */
export const tombstone = sqliteTable(
  "tombstone",
  {
    spaceId: text("space_id").notNull(),
    tbl: text("tbl").notNull(),
    rowId: text("row_id").notNull(),
    rev: integer("rev").notNull(),
    by: text("by"),
    at: integer("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.tbl, t.rowId] }), index("tombstone_space_rev_idx").on(t.spaceId, t.rev), index("tombstone_at_idx").on(t.at)],
);

/** R17 E2: one row per model call through lib/ai-gate (the daily quota counts a user's non-system rows of the day). */
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id"),
    spaceId: text("space_id"),
    feature: text("feature").notNull(),
    provider: text("provider"),
    model: text("model"),
    tokens: integer("tokens"),
    ok: integer("ok", { mode: "boolean" }).notNull().default(true),
    ms: integer("ms"),
    system: integer("system", { mode: "boolean" }).notNull().default(false),
    day: text("day").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("ai_usage_user_day_idx").on(t.userId, t.day), index("ai_usage_at_idx").on(t.at)],
);

/** R17 G1: one row per signed-in browser session (admin Live view). `screen` is a fixed key, never free text. */
export const presence = sqliteTable(
  "presence",
  {
    sessionId: text("session_id").primaryKey(),
    userId: text("user_id").notNull(),
    device: text("device", { enum: ["phone", "computer"] }).notNull(),
    app: text("app", { enum: ["installed", "browser"] }).notNull(),
    platform: text("platform"),
    screen: text("screen").notNull(),
    shoppingLeft: integer("shopping_left"),
    spaceId: text("space_id"),
    since: integer("since").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("presence_updated_idx").on(t.updatedAt), index("presence_user_idx").on(t.userId)],
);

/** R17 G1: what happened — kinds + counts only (never item names). 30 days. */
export const activity = sqliteTable(
  "activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    spaceId: text("space_id"),
    kind: text("kind").notNull(),
    n: integer("n").notNull().default(1),
    at: integer("at").notNull(),
  },
  (t) => [index("activity_at_idx").on(t.at), index("activity_user_at_idx").on(t.userId, t.at)],
);

/**
 * R17 S3 J1: a person's inbox. One row per (user, group_key): a later event with the same key updates the row in place
 * ("Noa is shopping" → "Noa finished shopping", "Noa added 5" → "Noa and Yoav added 7"). `data` holds what the row needs
 * to render (names, counts, item ids, prices) — the text is built from data + i18n at read time, in the reader's language.
 * `send_after` null = inbox only; `sent_at` is set in the same write that claims the row for sending. 30 days.
 */
export const notification = sqliteTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    spaceId: text("space_id"),
    kind: text("kind", { enum: ["shop", "activity", "week", "price", "delivery", "budget", "draft", "trip_add", "sent"] }).notNull(),
    groupKey: text("group_key").notNull(),
    data: text("data").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    readAt: integer("read_at"),
    deletedAt: integer("deleted_at"),
    sendAfter: integer("send_after"),
    sentAt: integer("sent_at"),
    pushState: text("push_state", { enum: ["due", "sent", "failed", "skipped", "off"] }),
  },
  (t) => [index("notification_user_created_idx").on(t.userId, t.createdAt), uniqueIndex("notification_user_group_idx").on(t.userId, t.groupKey), index("notification_due_idx").on(t.sendAfter)],
);

/** R17 S3 J1: one browser push address per device. `label` = browser + OS words only (no fingerprinting). */
export const pushSubscription = sqliteTable(
  "push_subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    device: text("device", { enum: ["phone", "computer"] }).notNull(),
    label: text("label"),
    createdAt: integer("created_at").notNull(),
    lastOkAt: integer("last_ok_at"),
    failCount: integer("fail_count").notNull().default(0),
    /** R17 S6: the last failed send — when, and the push service's status code (0 = no answer). */
    lastFailAt: integer("last_fail_at"),
    lastCode: integer("last_code"),
  },
  (t) => [index("push_subscription_user_idx").on(t.userId)],
);

export type Notification = typeof notification.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscription.$inferSelect;

// ---------- R18 S1: supermarket mode v2 (data + engines) ----------

/** A shopping trip (replaces the `pref:shop-trip` user pref). Counts are kept up to date by the trip's checks. */
export const trip = sqliteTable(
  "trip",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    userId: text("user_id").notNull(),
    chain: text("chain"),
    branch: text("branch"),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    estTotal: real("est_total"),
    total: real("total"),
    currency: text("currency").notNull().default("ILS"),
    planned: integer("planned").notNull().default(0),
    bought: integer("bought").notNull().default(0),
    notFound: integer("not_found").notNull().default(0),
    receiptId: text("receipt_id"),
    /** The inbox group key of the "Noa is shopping" rows (one row per trip, updated in place). */
    notifyKey: text("notify_key"),
    /** Items left at the last beat (the members' live "6 of 15 left"). */
    left: integer("left_count"),
    rev: integer("rev").notNull().default(0),
  },
  (t) => [index("trip_space_started_idx").on(t.spaceId, t.startedAt), index("trip_user_open_idx").on(t.userId, t.finishedAt)],
);

/** One action in a trip, in order (`seq` per trip): the check order teaches the branch's walking order (A5). */
export const tripCheck = sqliteTable(
  "trip_check",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    spaceId: text("space_id").notNull(),
    tripId: text("trip_id").notNull(),
    itemId: text("item_id"),
    productKey: text("product_key"),
    section: text("section"),
    action: text("action", { enum: ["check", "uncheck", "not_found", "substitute", "qty", "price", "add"] }).notNull(),
    qty: real("qty"),
    amount: real("amount"),
    unit: text("unit"),
    price: real("price"),
    gtin: text("gtin"),
    byUser: text("by_user"),
    at: integer("at").notNull(),
    seq: integer("seq").notNull(),
  },
  (t) => [uniqueIndex("trip_check_seq_idx").on(t.tripId, t.seq), index("trip_check_space_idx").on(t.spaceId, t.productKey)],
);

/** A store (chain + branch) a space shops at: default flag, the confirmed section order, the learned suggestion. */
export const spaceStore = sqliteTable(
  "space_store",
  {
    spaceId: text("space_id").notNull(),
    chain: text("chain").notNull(),
    branch: text("branch").notNull().default(""),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    sectionOrder: text("section_order"),
    suggestedOrder: text("suggested_order"),
    suggestedAt: integer("suggested_at"),
    dismissedAt: integer("dismissed_at"),
    /** R19 A10: the real branch (`branch.id`) this store is, from the chains' Stores files (null = not matched yet). */
    branchId: text("branch_id"),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.chain, t.branch] })],
);

/** A product's suggestion state per space: "Not this time" (quiet until `until`, skips in a row), hidden (R18 S2 C1). */
export const suggestDismiss = sqliteTable(
  "suggest_dismiss",
  {
    spaceId: text("space_id").notNull(),
    productKey: text("product_key").notNull(),
    until: integer("until").notNull(),
    // R18 S2 C1: skips in a row (since the last purchase) and "Don't suggest this again".
    skips: integer("skips"),
    skippedAt: integer("skipped_at"),
    hiddenAt: integer("hidden_at"),
    hiddenBy: text("hidden_by"),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.productKey] })],
);

export type TemplateItem = { productKey: string; title: string; qty: number; amount?: number | null; unit?: string | null; section?: string | null; art?: string | null };
/** A named supermarket list ("Basic weekly basket", a saved trip); apply = merge into the list. */
export const template = sqliteTable(
  "template",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    name: text("name").notNull(),
    items: text("items", { mode: "json" }).$type<TemplateItem[]>().notNull(),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull(),
    rev: integer("rev").notNull().default(0),
    /** R18 S2 E1: "nexus" = found from repeating trips (null = made by a person). */
    madeBy: text("made_by", { enum: ["nexus"] }),
    /** The routine's weekday (0 = Sunday) and how many trips it was seen in. */
    routineDay: integer("routine_day"),
    routineTrips: integer("routine_trips"),
    /** A Nexus template is an offer until kept; "No thanks" turns it down for good. */
    keptAt: integer("kept_at"),
    dismissedAt: integer("dismissed_at"),
    /** Someone edited it → it's theirs: Nexus never changes it again. */
    editedAt: integer("edited_at"),
    updatedAt: integer("updated_at"),
    /** Last applied to the list ("used in May"). */
    usedAt: integer("used_at"),
  },
  (t) => [index("template_space_idx").on(t.spaceId)],
);

/** B2: an `auto` staple added by the engine on its due day — once per product per due day, undoable. */
export const stapleAdd = sqliteTable(
  "staple_add",
  {
    spaceId: text("space_id").notNull(),
    productKey: text("product_key").notNull(),
    dueDay: text("due_day").notNull(),
    itemId: text("item_id"),
    at: integer("at").notNull(),
    undoneAt: integer("undone_at"),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.productKey, t.dueDay] })],
);

/**
 * R18 S3 C6: which brand the home bought, per product type ("milk" → "Tnuva 3%") — from barcode adds, store-mode checks
 * of a barcoded row (`ref` = trip) and receipt lines (`ref` = receipt). Read with the forget cut-offs (`all`, `b:<type>`).
 */
export const brandBuy = sqliteTable(
  "brand_buy",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    type: text("type").notNull(),
    brand: text("brand").notNull(),
    brandKey: text("brand_key").notNull(),
    source: text("source", { enum: ["scan", "check", "receipt"] }).notNull(),
    ref: text("ref"),
    byUser: text("by_user"),
    at: integer("at").notNull(),
  },
  (t) => [index("brand_buy_space_type_idx").on(t.spaceId, t.type)],
);

export type Trip = typeof trip.$inferSelect;
export type TripCheck = typeof tripCheck.$inferSelect;
export type SpaceStore = typeof spaceStore.$inferSelect;
export type Template = typeof template.$inferSelect;

// ---------- R19 — prices (B1–B5) and matching (C1). Price data is global (public files): no space_id. ----------

/** A food chain from the transparency list: our id (= `CHAINS` id), the government chain id, names, logo. */
export const chain = sqliteTable(
  "chain",
  {
    id: text("id").primaryKey(),
    govId: text("gov_id").notNull(),
    he: text("he").notNull(),
    en: text("en").notNull(),
    logo: text("logo"),
    color: text("color"),
    branches: integer("branches").notNull().default(0),
    /** The branch whose prices stand for the chain when nobody chose one of its branches (the most items read). */
    repStore: integer("rep_store"),
    lastFileAt: integer("last_file_at"),
    lastOkAt: integer("last_ok_at"),
    lastError: text("last_error"),
    updatedAt: integer("updated_at"),
  },
  (t) => [uniqueIndex("chain_gov_idx").on(t.govId)],
);

/** A branch from the chain's Stores file (`id` = `<chain>:<store id>`); lat / lng geocoded once on the server. */
export const branch = sqliteTable(
  "branch",
  {
    id: text("id").primaryKey(),
    chainId: text("chain_id").notNull(),
    storeId: integer("store_id").notNull(),
    subChain: text("sub_chain"),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    city: text("city").notNull().default(""),
    cityEn: text("city_en").notNull().default(""),
    cityCode: integer("city_code"),
    zip: text("zip"),
    /** The law's StoreType: 1 shop · 2 online · 3 both. */
    kind: integer("kind"),
    lat: real("lat"),
    lng: real("lng"),
    geoAt: integer("geo_at"),
    /** Normalized "chain name city address" for the picker's search. */
    search: text("search").notNull().default(""),
    /** The newest price file read for this branch (the app's "updated · HH:MM"). */
    pricesAt: integer("prices_at"),
    updatedAt: integer("updated_at"),
    goneAt: integer("gone_at"),
  },
  (t) => [index("branch_chain_idx").on(t.chainId), index("branch_city_idx").on(t.cityCode)],
);

/** Every barcode in the price files (B3): the cleanest name across chains, brand, size, section, picture (B4). */
export const catalog = sqliteTable(
  "catalog",
  {
    gtin: text("gtin").primaryKey(),
    name: text("name").notNull(),
    short: text("short"),
    brand: text("brand"),
    manufacturer: text("manufacturer"),
    qty: real("qty"),
    unit: text("unit", { enum: ["g", "kg", "ml", "l", "u"] }),
    weighted: integer("weighted", { mode: "boolean" }).notNull().default(false),
    /** A store's own code (weighed produce, deli), not a real barcode — matched per chain only. */
    internal: integer("internal", { mode: "boolean" }).notNull().default(false),
    section: text("section"),
    search: text("search").notNull().default(""),
    chains: integer("chains").notNull().default(0),
    branches: integer("branches").notNull().default(0),
    imageUrl: text("image_url"),
    imageSrc: text("image_src", { enum: ["off", "own", "search", "none"] }),
    imageAt: integer("image_at"),
    imageTries: integer("image_tries").notNull().default(0),
    seenAt: integer("seen_at"),
    updatedAt: integer("updated_at"),
  },
  (t) => [index("catalog_section_idx").on(t.section)],
);

/** A chain's current price for a product (the most common across the branches read), written only when it changes. */
export const chainPrice = sqliteTable(
  "chain_price",
  {
    chainId: text("chain_id").notNull(),
    gtin: text("gtin").notNull(),
    price: real("price").notNull(),
    low: real("low"),
    high: real("high"),
    branches: integer("branches").notNull().default(1),
    unitPrice: real("unit_price"),
    priceAt: integer("price_at"),
    seenAt: integer("seen_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.gtin] }), index("chain_price_gtin_idx").on(t.gtin)],
);

/** A branch's own price — for the branches people chose + one representative per chain (sizes: ROUND19 Decisions). */
export const branchPrice = sqliteTable(
  "branch_price",
  {
    branchId: text("branch_id").notNull(),
    gtin: text("gtin").notNull(),
    price: real("price").notNull(),
    unitPrice: real("unit_price"),
    priceAt: integer("price_at"),
    seenAt: integer("seen_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.gtin] }), index("branch_price_gtin_idx").on(t.gtin)],
);

/** The 90-day chart: a point per product per chain on the days its price (or best deal) changed. */
export const priceDay = sqliteTable(
  "price_day",
  {
    chainId: text("chain_id").notNull(),
    gtin: text("gtin").notNull(),
    day: text("day").notNull(),
    price: real("price").notNull(),
    deal: real("deal"),
  },
  (t) => [primaryKey({ columns: [t.gtin, t.chainId, t.day] })],
);

/** A deal from the Promo files (`id` = `<chain>:<promotion id>`); `stores` = the store ids it runs in, null = all. */
export const promo = sqliteTable(
  "promo",
  {
    id: text("id").primaryKey(),
    chainId: text("chain_id").notNull(),
    promoId: text("promo_id").notNull(),
    description: text("description").notNull(),
    /** `n_for` (N for ₪X) · `price` (₪X each) · `pct` (X % off) · `second` (the 2nd at …) · `other`. */
    kind: text("kind").notNull(),
    minQty: real("min_qty"),
    price: real("price"),
    rate: real("rate"),
    club: integer("club", { mode: "boolean" }).notNull().default(false),
    minBasket: real("min_basket"),
    starts: integer("starts"),
    ends: integer("ends"),
    stores: text("stores", { mode: "json" }).$type<number[] | null>(),
    items: integer("items").notNull().default(0),
    updatedAt: integer("updated_at"),
    seenAt: integer("seen_at").notNull(),
  },
  (t) => [index("promo_chain_idx").on(t.chainId, t.ends)],
);

export const promoItem = sqliteTable(
  "promo_item",
  { promoId: text("promo_id").notNull(), gtin: text("gtin").notNull() },
  (t) => [primaryKey({ columns: [t.gtin, t.promoId] }), index("promo_item_promo_idx").on(t.promoId)],
);

/** Every price file read (B5 health): chain / store / kind, its publish stamp, rows, changes, time, error. */
export const priceFile = sqliteTable(
  "price_file",
  {
    name: text("name").primaryKey(),
    chainId: text("chain_id").notNull(),
    storeId: integer("store_id"),
    kind: text("kind").notNull(),
    stamp: text("stamp").notNull(),
    readAt: integer("read_at").notNull(),
    rows: integer("rows").notNull().default(0),
    changed: integer("changed").notNull().default(0),
    ms: integer("ms"),
    error: text("error"),
  },
  (t) => [index("price_file_chain_idx").on(t.chainId, t.readAt)],
);

/** C1: what the home means by a typed name — a product (gtin) or "doesn't matter which" of a type (`anyType`). */
export const productChoice = sqliteTable(
  "product_choice",
  {
    spaceId: text("space_id").notNull(),
    nameKey: text("name_key").notNull(),
    gtin: text("gtin"),
    anyType: text("any_type"),
    byUser: text("by_user"),
    at: integer("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.nameKey] })],
);

export type Catalog = typeof catalog.$inferSelect;
export type Branch = typeof branch.$inferSelect;
export type ChainRow = typeof chain.$inferSelect;
export type Promo = typeof promo.$inferSelect;
