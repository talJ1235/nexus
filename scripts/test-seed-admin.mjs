// R18 S3 — guard for the admin demo seed (scripts/lib/seed-admin.mjs, used by test:bidi / test:admin-* / parity):
// its clean-up matched `LIKE 'ad_%'`, where `_` is a wildcard and LIKE ignores case, so an admin whose random id starts
// with "ad" / "Ad" / "AD" (~1 run in 1000) was deleted with the demo people (its session cascading away) and the next
// insert failed the foreign key (CI, round18-s3 f96dbf5). Here the admin and a bystander both start with "ad": the seed
// must run (twice) and leave them alone.
//   npm run test:seed-admin
import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { seedAdmin } from "./lib/seed-admin.mjs";

const file = "seed-admin-test.db";
const clean = () => { for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) rmSync(f); };
clean();
const env = { ...process.env, TURSO_DATABASE_URL: `file:${file}`, TURSO_AUTH_TOKEN: "", ADMIN_EMAIL: "" };
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env, stdio: "ignore" });
const db = createClient({ url: `file:${file}` });
const fails = [];
const now = Date.now();
const user = (id, role) => db.execute({ sql: `INSERT INTO "user" (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)`, args: [id, id, `${id.toLowerCase()}@example.com`, role, now, now] });
const admin = "AdK3vQ9xLmT2pW8zR4nYb";
await user(admin, "admin");
await user("aDsBystander", "user");
await db.execute({ sql: `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES ('adsX', ?, 'tok_adsX', ?, ?, ?)`, args: [now + 86_400_000, now, now, admin] });
for (let run = 1; run <= 2; run++) {
  try {
    await seedAdmin(db, { adminId: admin, now });
  } catch (e) {
    fails.push(`run ${run}: seedAdmin threw ${e.message}`);
    break;
  }
  const ids = (await db.execute(`SELECT id FROM "user"`)).rows.map((r) => String(r.id));
  for (const keep of [admin, "aDsBystander"]) if (!ids.includes(keep)) fails.push(`run ${run}: ${keep} was deleted`);
  if (!(await db.execute(`SELECT 1 FROM session WHERE id = 'adsX'`)).rows.length) fails.push(`run ${run}: the admin's session was deleted`);
  const demo = ids.filter((i) => i.startsWith("ad_")).length;
  if (demo !== 6) fails.push(`run ${run}: ${demo} demo people, expected 6`);
}
db.close();
// The file stays until the next run (deleting it after the native client has used it ends the process with 127 on Windows).
console.log(fails.length ? `FAIL seed-admin\n  ${fails.join("\n  ")}` : 'OK seed-admin (ids starting with "ad" survive, twice)');
process.exit(fails.length ? 1 : 0);
