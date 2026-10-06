// R15 B3 guard 1: every exported server action ("use server" files) and every route handler must call requireCtx /
// routeCtx — directly or through a helper in the same file — unless it is on the small, commented allow-list below.
// Enumerates the exports automatically, so a new action can't be forgotten.   npx tsx scripts/test-authz-coverage.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = join(__dirname, "..");
const APP = join(ROOT, "src", "app");

/** Route files that authenticate another way. Each needs a reason. */
const ROUTE_ALLOW: Record<string, string> = {
  "src/app/api/auth/[...all]/route.ts": "Better Auth itself (HTTP surface allow-listed in lib/auth/server.ts)",
  "src/app/api/login/route.ts": "admin password fallback = a sign-in endpoint",
  "src/app/api/logout/route.ts": "sign-out (works with or without a session)",
  "src/app/api/cron/prices/route.ts": "CRON_SECRET",
  "src/app/api/cal/[token]/route.ts": "calendar feed token (per user)",
  "src/app/api/reports/export/route.ts": "REPORTS_TOKEN",
  "src/app/api/csp-report/route.ts": "CSP violation counter (no data read, counts only)",
  "src/app/api/test-idp/authorize/route.ts": "test-only OIDC stub (off in production)",
  "src/app/api/test-idp/token/route.ts": "test-only OIDC stub (off in production)",
  "src/app/api/test-idp/userinfo/route.ts": "test-only OIDC stub (off in production)",
  "src/app/api/auth-flow/invite/route.ts": "pre-sign-in: stores the invite code in a signed cookie before the Google redirect",
  "src/app/api/auth-flow/join/route.ts": "pre-sign-in: stores a /join/<token> link in the signed invite cookie before the Google redirect",
  "src/app/api/auth-flow/waitlist/route.ts": "pre-sign-in: the waitlist form (rate-limited, Turnstile when configured)",
  "src/app/api/auth-flow/forget-device/route.ts": "clears the returning-account chip cookie (no data)",
  "src/app/share/route.ts": "redirect only (Android share target → /add, which is behind the session)",
  "src/app/api/ext/check/route.ts": "retired: 410",
  "src/app/api/ext/collections/route.ts": "retired: 410",
  "src/app/api/ext/image-jobs/route.ts": "retired: 410",
  "src/app/api/ext/save/route.ts": "retired: 410",
  "src/app/api/ext/stale/route.ts": "retired: 410",
  "src/app/api/telegram/route.ts": "retired: 410",
  "src/app/api/invite/accept/route.ts": "retired: 410",
  "src/app/api/errors/export/route.ts": "REPORTS_TOKEN",
  "src/app/api/errors/route.ts": "R16 C2: browser error reports, also from the sign-in pages (same origin, 8 KB, 10 events, 30/h per user, 10/h per IP)",
};
/** Server actions that run before sign-in. */
const ACTION_ALLOW: Record<string, string> = {};

const GATES = /\b(requireCtx|routeCtx)\s*\(/;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

/** Names of functions/consts in this file whose body reaches a gate (transitively, within the file). */
function gatedLocals(sf: ts.SourceFile) {
  const bodies = new Map<string, string>();
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) bodies.set(n.name.text, n.body.getText(sf));
    if (ts.isVariableStatement(n))
      for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) bodies.set(d.name.text, d.initializer.getText(sf));
  });
  const gated = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, body] of bodies) {
      if (gated.has(name)) continue;
      if (GATES.test(body) || [...gated].some((g) => new RegExp(`\\b${g}\\s*\\(`).test(body))) {
        gated.add(name);
        changed = true;
      }
    }
  }
  return { bodies, gated };
}

function reaches(body: string, gated: Set<string>) {
  return GATES.test(body) || [...gated].some((g) => new RegExp(`\\b${g}\\s*\\(`).test(body));
}

let checked = 0;
const failures: string[] = [];
for (const file of walk(APP)) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isAction = /^\s*["']use server["']/.test(text);
  const isRoute = /\/route\.ts$/.test(rel);
  if (!isAction && !isRoute) continue;
  const { bodies, gated } = gatedLocals(sf);
  const exported: { name: string; body: string }[] = [];
  sf.forEachChild((n) => {
    const isExp = (m?: ts.NodeArray<ts.ModifierLike>) => !!m?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword);
    // Overload signatures (no body) are types only — the implementation that follows is the export that runs.
    if (ts.isFunctionDeclaration(n) && n.name && isExp(n.modifiers) && n.body) exported.push({ name: n.name.text, body: n.body.getText(sf) });
    if (ts.isVariableStatement(n) && isExp(n.modifiers))
      for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) exported.push({ name: d.name.text, body: d.initializer?.getText(sf) ?? "" });
    // export const { GET, POST } = toNextJsHandler(auth)
  });
  for (const e of exported) {
    if (isRoute && !METHODS.has(e.name)) continue;
    if (isAction && !/^(async|\()/.test(e.body.trim()) && !bodies.has(e.name)) continue;
    if (isAction && e.body && !/^[{(]|^async/.test(e.body.trim())) continue; // exported constants (types, schemas)
    checked++;
    const allow = isRoute ? ROUTE_ALLOW[rel] : ACTION_ALLOW[`${rel}#${e.name}`];
    if (allow) continue;
    // Aliases: `export const GET = gone;`
    const target = bodies.get(e.body.trim()) ?? e.body;
    if (!reaches(target, gated)) failures.push(`${rel} → ${e.name}`);
  }
  if (isRoute && ROUTE_ALLOW[rel] === undefined && !exported.some((e) => METHODS.has(e.name)) && /export const \{/.test(text)) failures.push(`${rel} → destructured handlers (not allow-listed)`);
}

for (const f of failures) console.log(`FAIL missing requireCtx: ${f}`);
console.log(failures.length ? `FAIL authz coverage: ${failures.length} of ${checked} exports` : `OK authz coverage: ${checked} exports (actions + route handlers) all gated or allow-listed`);
process.exit(failures.length ? 1 : 0);
