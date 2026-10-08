// R17 E4 — delete account on a throwaway file DB with a fake clock: the sole-owner block; request → hidden (sessions gone,
// out of people lists) → restore within 7 days; request → nothing purged before 7 days, everything of that person after
// (personal space + its rows, a shared space they were alone in, chats, memory, prefs, sign-in rows, the user) while
// their item in someone else's shared space stays (added by a former member); export = only the person's own data.
//   npm run test:delete-account
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const DB = "delete-account-test.db";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.ADMIN_EMAIL = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

async function main() {
  const { db, schema } = await import("../src/db");
  const { eq, and } = await import("drizzle-orm");
  const acc = await import("../src/lib/db-scoped/account");
  const { spaceMembers } = await import("../src/lib/spaces");
  const T0 = Date.UTC(2026, 9, 8, 12);
  const DAY = 86_400_000;
  const d = new Date(T0);

  const user = (id: string, name: string) => db.insert(schema.user).values({ id, name, email: `${id}@test.example`, emailVerified: true, createdAt: d, updatedAt: d });
  const space = (id: string, kind: "personal" | "shared", by: string) => db.insert(schema.space).values({ id, name: `Space ${id}`, slug: id, kind, createdBy: by, createdAt: d } as never);
  let mid = 0;
  const member = (sp: string, u: string, role: string) => db.insert(schema.member).values({ id: `m${mid++}`, organizationId: sp, userId: u, role, createdAt: d } as never);
  const item = (id: string, sp: string, by: string) => db.insert(schema.items).values({ id, spaceId: sp, title: `Item ${id}`, addedByUserId: by, createdAt: T0, updatedAt: T0 } as never);

  await user("uA", "Ada Person");
  await user("uB", "Ben Other");
  await space("pA", "personal", "uA");
  await space("pB", "personal", "uB");
  await space("s1", "shared", "uB"); // B's, A is a member
  await space("s2", "shared", "uA"); // A's, B is a member → blocks A
  await space("s3", "shared", "uA"); // A's alone → purged with A
  await member("pA", "uA", "owner");
  await member("pB", "uB", "owner");
  await member("s1", "uB", "owner");
  await member("s1", "uA", "member");
  await member("s2", "uA", "owner");
  await member("s2", "uB", "member");
  await member("s3", "uA", "owner");
  await item("iA1", "pA", "uA");
  await item("iA2", "s3", "uA");
  await item("iA-in-s1", "s1", "uA");
  await item("iB1", "pB", "uB");
  await item("iB2", "s2", "uB");
  await db.insert(schema.collections).values({ id: "cA", spaceId: "pA", name: "A list", createdAt: T0, updatedAt: T0 } as never);
  await db.insert(schema.memories).values({ id: "memA", userId: "uA", text: "A likes oat milk", createdAt: T0, updatedAt: T0 });
  await db.insert(schema.memories).values({ id: "memB", userId: "uB", text: "B likes tea", createdAt: T0, updatedAt: T0 });
  await db.insert(schema.conversations).values({ id: "convA", spaceId: "s1", userId: "uA", title: "A chat", createdAt: T0, updatedAt: T0 } as never);
  await db.insert(schema.conversationMessages).values({ id: "msgA", spaceId: "s1", conversationId: "convA", role: "user", text: "hi", createdAt: T0 } as never);
  await db.insert(schema.userPref).values({ userId: "uA", key: "pref:x", value: "1", updatedAt: T0 });
  await db.insert(schema.session).values({ id: "sessA", token: "tokA", userId: "uA", expiresAt: new Date(T0 + 30 * DAY), createdAt: d, updatedAt: d });
  await db.insert(schema.account).values({ id: "accA", accountId: "g-1", providerId: "google", userId: "uA", createdAt: d, updatedAt: d } as never);

  // Export before: A gets A's own spaces + A's chats and memory — never B's.
  const exA = await acc.exportMyData("uA");
  assert.deepEqual(exA.spaces.map((s) => s.id).sort(), ["pA", "s2", "s3"]);
  const exAText = JSON.stringify(exA);
  assert.ok(exAText.includes("A likes oat milk") && !exAText.includes("B likes tea") && !exAText.includes("Item iB1"), "A's export holds only A's data");
  assert.equal(exA.chats.length, 1);
  const exB = await acc.exportMyData("uB");
  assert.deepEqual(exB.spaces.map((s) => s.id).sort(), ["pB", "s1"]);
  assert.ok(!JSON.stringify(exB).includes("A likes oat milk") && !JSON.stringify(exB).includes("A chat"), "B's export has no A chats/memory");

  // Sole owner of a shared space with others → blocked until it's transferred.
  assert.deepEqual((await acc.soleOwnerBlocks("uA")).map((s) => s.id), ["s2"]);
  await db.update(schema.member).set({ role: "owner" }).where(and(eq(schema.member.organizationId, "s2"), eq(schema.member.userId, "uB")));
  await db.update(schema.member).set({ role: "member" }).where(and(eq(schema.member.organizationId, "s2"), eq(schema.member.userId, "uA")));
  assert.deepEqual(await acc.soleOwnerBlocks("uA"), []);

  // Request → hidden: sessions gone, out of the people list.
  await acc.markAccountDeletion("uA", T0);
  assert.equal((await db.select().from(schema.session).where(eq(schema.session.userId, "uA"))).length, 0, "every session ended");
  assert.ok(!(await spaceMembers("s1")).some((p) => p.id === "uA"), "hidden from people lists");
  // Restore within 7 days.
  assert.equal(await acc.restoreAccount("uA", T0 + 2 * DAY), true);
  assert.equal(await acc.deletionRequestedAt("uA"), null);
  assert.ok((await spaceMembers("s1")).some((p) => p.id === "uA"), "back in people lists");
  // Too late to restore after 7 days.
  await acc.markAccountDeletion("uA", T0);
  assert.equal(await acc.restoreAccount("uA", T0 + 7 * DAY + 1), false);
  // Nothing to purge before 7 days; A after.
  assert.deepEqual(await acc.accountsToPurge(T0 + 6 * DAY), []);
  assert.deepEqual((await acc.accountsToPurge(T0 + 7 * DAY + 1)).map((r) => r.id), ["uA"]);
  const beforeB = { items: (await db.select().from(schema.items).where(eq(schema.items.spaceId, "pB"))).length, mem: (await db.select().from(schema.memories).where(eq(schema.memories.userId, "uB"))).length };
  await acc.purgeAccount("uA");

  const left = async (t: never, col: never, v: string) => (await db.select().from(t).where(eq(col, v))).length;
  assert.equal(await left(schema.user as never, schema.user.id as never, "uA"), 0, "user row gone");
  for (const [t, c] of [[schema.member, schema.member.userId], [schema.session, schema.session.userId], [schema.account, schema.account.userId], [schema.memories, schema.memories.userId], [schema.userPref, schema.userPref.userId], [schema.conversations, schema.conversations.userId]] as const)
    assert.equal(await left(t as never, c as never, "uA"), 0, "no rows left for A");
  assert.equal((await db.select().from(schema.conversationMessages).where(eq(schema.conversationMessages.conversationId, "convA"))).length, 0);
  for (const sp of ["pA", "s3"]) {
    assert.equal(await left(schema.space as never, schema.space.id as never, sp), 0, `${sp} gone`);
    assert.equal(await left(schema.items as never, schema.items.spaceId as never, sp), 0, `${sp} items gone`);
  }
  assert.equal(await left(schema.collections as never, schema.collections.spaceId as never, "pA"), 0);
  // A's item in B's shared space stays — attributed to a person who no longer exists ("Former member" in the app).
  const [kept] = await db.select().from(schema.items).where(eq(schema.items.id, "iA-in-s1"));
  assert.ok(kept && kept.addedByUserId === "uA", "A's item in a shared space stays");
  // B untouched; s2 (now B's) intact.
  assert.equal((await db.select().from(schema.items).where(eq(schema.items.spaceId, "pB"))).length, beforeB.items);
  assert.equal((await db.select().from(schema.memories).where(eq(schema.memories.userId, "uB"))).length, beforeB.mem);
  assert.equal(await left(schema.space as never, schema.space.id as never, "s2"), 1);
  assert.equal(await left(schema.items as never, schema.items.id as never, "iB2"), 1);
  console.log("OK delete account (block, hide, restore, 7-day purge with former-member items, export tenancy)");
  rmSync(DB, { force: true });
}
main().then(() => process.exit(0), (e) => (console.error(e), process.exit(1)));
