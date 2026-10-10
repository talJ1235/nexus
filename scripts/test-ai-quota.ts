// R17 E2 — the AI gate: quota boundary (40/day), admin unlimited, per-person override, the AI switch, system calls not
// counted, redaction of names / emails / phones (and names put back into the answer), and a static guard: no code
// outside src/lib/ai.ts talks to a model provider (and lib/ai.ts's entry points require `use` — TypeScript checks that).
//   npm run test:ai-quota   (throwaway file DB)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DB = "ai-quota-test.db";
for (const f of [DB, `${DB}-journal`, `${DB}-wal`, `${DB}-shm`]) if (existsSync(f)) rmSync(f);
process.env.TURSO_DATABASE_URL = `file:${DB}`;
process.env.TURSO_AUTH_TOKEN = "";
process.env.ADMIN_EMAIL = "";
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/migrate.ts"], { env: process.env, stdio: "ignore" });

async function main() {
  // R17 S5 S5: every model the chain can call has a checked price row (not the fallback), and the date parses.
  const { AI_PRICES, AI_PRICES_CHECKED, priceOf } = await import("../src/lib/ai-prices");
  const used = [...readFileSync("src/lib/ai.ts", "utf8").matchAll(/"((?:gemini-[\w.-]+)|(?:openai\/gpt-oss-\d+b)|(?:openrouter\/free))"/g)].map((m) => m[1]);
  assert.ok(used.length >= 6, `models found in lib/ai.ts: ${used.length}`);
  for (const m of new Set(used)) assert.ok(AI_PRICES.some((p) => p.match.test(m)), `a price row for ${m}`);
  assert.deepEqual([priceOf("gemini-2.5-flash-lite", "gemini").input, priceOf("gemini-2.5-flash", "gemini").input, priceOf("gemini-3.6-flash", "gemini").output, priceOf("openai/gpt-oss-20b", "groq").input, priceOf("openrouter/free", "openrouter").output], [0.1, 0.3, 3.75, 0.075, 0]);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(AI_PRICES_CHECKED) && !Number.isNaN(Date.parse(AI_PRICES_CHECKED)), "AI_PRICES_CHECKED is a date");
  const { db, schema } = await import("../src/db");
  const { aiAllowance, aiGate, recordAiUsage, makeRedactor, writeAiQuota, DAILY_QUOTA, aiDay } = await import("../src/lib/ai-gate");
  const { HOME_AI_KEY } = await import("../src/lib/home-prefs");
  const now = Date.now();
  const mk = async (id: string, role: string | null, name: string, email: string) =>
    db.insert(schema.user).values({ id, name, email, emailVerified: true, role, createdAt: new Date(now), updatedAt: new Date(now) });
  await mk("u_noa", "user", "Noa Levi", "noa@example.com");
  await mk("u_tal", "admin", "Tal Jacoby", "tal@example.com");
  await mk("u_dan", "user", "Dan Cohen", "dan@example.com");
  await db.insert(schema.space).values({ id: "sp_home", name: "Jacoby Home", slug: "jacoby-home", kind: "shared", createdBy: "u_tal", createdAt: new Date(now) } as never);
  for (const [i, u] of ["u_tal", "u_noa"].entries()) await db.insert(schema.member).values({ id: `m${i}`, organizationId: "sp_home", userId: u, role: i ? "member" : "owner", createdAt: new Date(now) } as never);

  const forUser = (userId: string, feature = "assistant" as const) => ({ feature, userId, spaceId: "sp_home" });
  const call = async (userId: string) => {
    const g = await aiGate(forUser(userId), now);
    if (g.ok) await recordAiUsage(forUser(userId), { provider: "gemini", model: "m", ok: true, ms: 5 }, now);
    return g.ok ? "ok" : g.reason;
  };

  // Quota boundary: the 40th call runs, the 41st doesn't.
  for (let k = 0; k < DAILY_QUOTA; k++) assert.equal(await call("u_noa"), "ok", `call ${k + 1}`);
  assert.equal(await call("u_noa"), "quota", "call 41 is refused");
  const a = await aiAllowance("u_noa", now);
  assert.deepEqual([a.used, a.left, a.limit], [DAILY_QUOTA, 0, DAILY_QUOTA]);
  // Tomorrow it's back.
  assert.equal((await aiGate(forUser("u_noa"), now + 86_400_000)).ok, true, "a new day resets the quota");
  assert.notEqual(aiDay(now), aiDay(now + 86_400_000));
  // System calls (cron, backfill) never count against anyone.
  for (let k = 0; k < 5; k++) await recordAiUsage({ feature: "short_name", userId: "u_dan", system: true }, { provider: "gemini", model: "m", ok: true, ms: 1 }, now);
  assert.equal((await aiAllowance("u_dan", now)).used, 0, "system rows don't count");
  // Admin: unlimited.
  for (let k = 0; k < DAILY_QUOTA + 3; k++) assert.equal(await call("u_tal"), "ok");
  assert.equal((await aiAllowance("u_tal", now)).limit, null);
  // Override: 2 for Dan, then unlimited, then back to default.
  await writeAiQuota("u_dan", 2);
  assert.equal(await call("u_dan"), "ok");
  assert.equal(await call("u_dan"), "ok");
  assert.equal(await call("u_dan"), "quota", "override 2 → the 3rd is refused");
  await writeAiQuota("u_dan", "unlimited");
  assert.equal(await call("u_dan"), "ok");
  await writeAiQuota("u_dan", null);
  assert.equal((await aiAllowance("u_dan", now)).limit, DAILY_QUOTA);
  // The AI switch ("Rules only") → nothing runs.
  await db.insert(schema.userPref).values({ userId: "u_dan", key: HOME_AI_KEY, value: "off", updatedAt: now });
  assert.equal(await call("u_dan"), "off");

  // Redaction: the person's and the space's names, members, emails, phones; names come back in the answer.
  const g = await aiGate(forUser("u_tal"), now);
  assert.ok(g.ok);
  if (g.ok) {
    const prompt = "Noa Levi (noa@example.com, +972 54-123-4567) asked Tal about Jacoby Home: add 2 × USB-C cable ₪29.90, call 050-1234567. Noa says thanks.";
    const red = g.redact.apply(prompt);
    for (const s of ["Noa", "Levi", "noa@example.com", "Tal", "Jacoby Home", "54-123-4567", "050-1234567"]) assert.ok(!red.includes(s), `"${s}" left in: ${red}`);
    assert.ok(red.includes("USB-C cable ₪29.90"), `product text kept: ${red}`);
    assert.ok(red.includes("⟦phone⟧"));
    const answer = red.replace("asked", "wrote to");
    const back = g.redact.restore(answer);
    assert.ok(back.includes("Noa Levi") && back.includes("Jacoby Home") && back.includes("noa@example.com"), back);
    assert.ok(!back.includes("54-123-4567"), "phones never come back");
  }
  const r = makeRedactor(["Dana"]);
  assert.equal(r.apply("Danaher drill for Dana"), "Danaher drill for ⟦P1⟧", "whole words only");

  // Static guard: provider endpoints / SDKs only in src/lib/ai.ts.
  const ROOT = join(__dirname, "..");
  const PROVIDER = /generativelanguage\.googleapis|GoogleGenAI|api\.groq\.com|openrouter\.ai\/api|chat\/completions|api\.openai\.com/;
  const walk = (d: string, out: string[] = []): string[] => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mjs)$/.test(f)) out.push(p);
    }
    return out;
  };
  const leaks = walk(join(ROOT, "src"))
    .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
    .filter((f) => f !== "src/lib/ai.ts" && PROVIDER.test(readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(leaks, [], `model providers called outside lib/ai.ts: ${leaks.join(", ")}`);
  const ai = readFileSync(join(ROOT, "src/lib/ai.ts"), "utf8");
  assert.ok(/type GenOpts = \{ use: AiUse;/.test(ai), "GenOpts.use is required");
  for (const fn of ["generate(", "generateTextStream("]) assert.ok(ai.includes("await aiGate(rawOpts.use)") && ai.includes(fn), `${fn} goes through the gate`);

  console.log(`OK ai-quota (${DAILY_QUOTA}/day boundary, admin, override, switch, system rows, redaction, provider guard)`);
  rmSync(DB, { force: true });
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
