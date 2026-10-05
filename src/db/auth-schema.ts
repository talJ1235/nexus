// R15: accounts, sessions and spaces. Better Auth's models (user / session / account / verification / passkey /
// organization = space / member / invitation / rateLimit) with snake_case SQL names; the Drizzle adapter maps them by
// the keys passed in src/lib/auth/server.ts. Tables are created idempotently in src/db/migrate-r15.ts.
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = sql`(unixepoch() * 1000)`;

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull().default(now),
  updatedAt: ts("updated_at").notNull().default(now),
  // admin plugin
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: ts("ban_expires"),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: ts("created_at").notNull().default(now),
    updatedAt: ts("updated_at").notNull().default(now),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
    activeOrganizationId: text("active_organization_id"),
    // Nexus: how this session was made (google / passkey / email-otp / fallback / test-idp) and the city (Vercel header).
    method: text("method"),
    city: text("city"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").notNull().default(now),
    updatedAt: ts("updated_at").notNull().default(now),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().default(now),
    updatedAt: ts("updated_at").notNull().default(now),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const passkey = sqliteTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    transports: text("transports"),
    createdAt: ts("created_at"),
    aaguid: text("aaguid"),
    // Nexus: shown on Settings → Security ("last used").
    lastUsedAt: ts("last_used_at"),
  },
  (t) => [index("passkey_user_idx").on(t.userId), index("passkey_credential_idx").on(t.credentialID)],
);

/** A space (Better Auth organization): personal (one per user, can't be shared) or shared (a household). */
export const space = sqliteTable("space", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: ts("created_at").notNull().default(now),
  kind: text("kind", { enum: ["personal", "shared"] }).notNull().default("shared"),
  currency: text("currency").notNull().default("ILS"),
  color: text("color").notNull().default("plum"),
  icon: text("icon").notNull().default("home"),
  createdBy: text("created_by"),
  // Soft delete (C3): purged 7 days later.
  deletedAt: integer("deleted_at"),
});

export const SPACE_ROLES = ["owner", "member", "viewer"] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

export const member = sqliteTable(
  "space_member",
  {
    id: text("id").primaryKey(),
    organizationId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: ts("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("space_member_unique").on(t.organizationId, t.userId), index("space_member_user_idx").on(t.userId)],
);

/** Better Auth's email invitations — unused (Nexus invites by link: space_invite), kept because the plugin needs it. */
export const invitation = sqliteTable("space_invitation", {
  id: text("id").primaryKey(),
  organizationId: text("space_id")
    .notNull()
    .references(() => space.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().default(now),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const authRateLimit = sqliteTable("auth_rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

// ---- Nexus tables around accounts (R15 A3/A5/B1) ----

/** Closed-circle sign-up codes (format XXX-XXXX). Only a SHA-256 of the code is stored. */
export const signupInvite = sqliteTable("signup_invite", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  // Last 4 characters, and the code encrypted (AES-GCM) so the admin can copy it again; lookups use the hash.
  hint: text("hint").notNull(),
  codeEnc: text("code_enc"),
  note: text("note"),
  maxUses: integer("max_uses").notNull().default(1),
  uses: integer("uses").notNull().default(0),
  usedBy: text("used_by", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
  createdBy: text("created_by"),
  createdAt: integer("created_at").notNull().default(now),
});

/** Space invite links /join/<token> (R15 C2). 32-byte token, stored hashed. */
export const spaceInvite = sqliteTable(
  "space_invite",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    spaceId: text("space_id").notNull(),
    role: text("role", { enum: ["member", "viewer"] }).notNull(),
    maxUses: integer("max_uses").notNull().default(5),
    uses: integer("uses").notNull().default(0),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("space_invite_space_idx").on(t.spaceId)],
);

export const waitlist = sqliteTable("waitlist", {
  email: text("email").primaryKey(),
  createdAt: integer("created_at").notNull().default(now),
  ipHash: text("ip_hash"),
  invitedAt: integer("invited_at"),
});

/** Security activity a user can see (Settings → Security), kept 90 days. No content, no full IPs. */
export const securityEvent = sqliteTable(
  "security_event",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    ipHash: text("ip_hash"),
    ua: text("ua"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("security_event_user_idx").on(t.userId, t.createdAt)],
);

/** Nexus's own counters (OTP per email, fallback per day, waitlist…); Better Auth keeps its own in auth_rate_limit. */
export const rateLimit = sqliteTable("rate_limit", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: integer("window_start").notNull(),
});

/** Admin recovery codes (A5): 10 one-time codes, stored hashed, shown once. */
export const recoveryCode = sqliteTable(
  "recovery_code",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    codeHash: text("code_hash").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("recovery_code_user_idx").on(t.userId)],
);

export const userPref = sqliteTable(
  "user_pref",
  {
    userId: text("user_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const spacePref = sqliteTable(
  "space_pref",
  {
    spaceId: text("space_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.key] })],
);

export type User = typeof user.$inferSelect;
export type Space = typeof space.$inferSelect;
export type SecurityEvent = typeof securityEvent.$inferSelect;
