// R15 A2 unit tests for email-code recovery (Better Auth emailOTP as configured in src/lib/auth/server.ts), on a
// throwaway file DB: hashed storage, single use, 10-minute expiry, 5 attempts, max 3 codes per email per hour,
// identical responses for unknown emails, admins can't recover by code.   npx tsx --conditions=react-server scripts/test-otp.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const DB = "snapshots/otp-test.db";
mkdirSync("snapshots", { recursive: true });
for (const f of [DB, ".auth-outbox.jsonl"]) if (existsSync(f)) rmSync(f);
Object.assign(process.env, {
  TURSO_DATABASE_URL: `file:${DB}`,
  TURSO_AUTH_TOKEN: "",
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || "test-secret-test-secret-test-secret-0123",
  BETTER_AUTH_URL: "http://localhost:3100",
  ADMIN_EMAIL: "admin@test.dev",
  RESEND_API_KEY: "",
  VERCEL: "",
});
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

async function main() {
  const { db, schema } = await import("../src/db");
  const { auth } = await import("../src/lib/auth/server");
  const { eq, like } = await import("drizzle-orm");
  const email = "member@test.dev";
  await db.insert(schema.user).values({ id: "u1", name: "Member", email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  const headers = new Headers({ "x-real-ip": "10.9.9.9", "user-agent": "otp-test" });
  const api = auth.api as unknown as Record<string, (o: unknown) => Promise<unknown>>;
  const send = (e: string) => api.sendVerificationOTP({ body: { email: e, type: "sign-in" }, headers });
  const signIn = (e: string, otp: string) => api.signInEmailOTP({ body: { email: e, otp }, headers });
  const outbox = () => (existsSync(".auth-outbox.jsonl") ? readFileSync(".auth-outbox.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string }) : []);
  const lastCode = (e: string) => outbox().filter((m) => m.to === e).at(-1)?.text.match(/\b(\d{6})\b/)?.[1] ?? null;
  const fails = async (p: Promise<unknown>) => {
    try {
      await p;
      return false;
    } catch {
      return true;
    }
  };

  // Unknown email: the same answer, and nothing is sent.
  const known = await send(email);
  const unknown = await send("nobody@test.dev");
  assert.deepEqual(unknown, known, "identical response for unknown emails");
  assert.equal(outbox().filter((m) => m.to === "nobody@test.dev").length, 0);
  const code1 = lastCode(email);
  assert.ok(code1, "a 6-digit code was sent");

  // Stored hashed: the code itself is nowhere in the verification table.
  const rows = await db.select().from(schema.verification).where(like(schema.verification.identifier, "%member@test.dev%"));
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].value.includes(code1!), "code stored hashed");
  assert.ok(rows[0].expiresAt.getTime() - Date.now() > 9 * 60_000 && rows[0].expiresAt.getTime() - Date.now() <= 10 * 60_000 + 5000, "10-minute life");

  // 5 attempts, then even the right code is refused.
  for (let i = 0; i < 5; i++) assert.ok(await fails(signIn(email, code1 === "000000" ? "111111" : "000000")), `wrong code ${i + 1} refused`);
  assert.ok(await fails(signIn(email, code1!)), "locked after 5 wrong tries");

  // New code works once (single use).
  await send(email);
  const code2 = lastCode(email)!;
  const ok = (await signIn(email, code2)) as { token?: string; user?: { id: string } };
  assert.equal(ok.user?.id, "u1", "right code signs in");
  assert.ok(await fails(signIn(email, code2)), "single use");

  // Expiry.
  const sentBefore = outbox().length;
  await send(email);
  const code3 = lastCode(email)!;
  assert.equal(outbox().length, sentBefore + 1);
  await db.update(schema.verification).set({ expiresAt: new Date(Date.now() - 1000) }).where(like(schema.verification.identifier, "%member@test.dev%"));
  assert.ok(await fails(signIn(email, code3)), "expired code refused");

  // Max 3 codes per email per hour (send #4 in this hour answers the same but sends nothing).
  const before4 = outbox().filter((m) => m.to === email).length;
  const r4 = await send(email);
  assert.deepEqual(r4, known);
  assert.equal(outbox().filter((m) => m.to === email).length, before4, "4th code in an hour not sent");

  // Admins can't recover by email code alone.
  // (the migration created the ADMIN_EMAIL user)
  await send("admin@test.dev");
  assert.equal(outbox().filter((m) => m.to === "admin@test.dev").length, 0, "no code is sent to an admin");
  assert.ok(await fails(signIn("admin@test.dev", "123456")));
  void eq;
  console.log("OK OTP: hashed, single use, 10-min expiry, 5 tries, 3/h per email, unknown email identical, admin blocked");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
