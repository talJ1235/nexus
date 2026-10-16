# Environment & tooling — how Nexus is wired to Claude

Read this when setting up a new Claude account, a new machine, or when a connection stops working.
It is shared by both workspaces: the **planning chat** (claude.ai, playbook `docs/PLANNER.md`) and
**Claude Code** (the builder, `CLAUDE.md`). The repo is the only shared memory between them — chat history
and account settings are not, so anything needed to rebuild the setup is written here.

**Rule for every session (chat or Claude Code):** if you change the setup, tooling, connectors, secrets
layout or the workflow itself, update this file in the same session and add a line to the log at the end.
Feature work is documented as before (round brief "## Open" + `SPEC.md`).

## Two workspaces, one repo
| | Planning chat (claude.ai) | Claude Code |
|---|---|---|
| Role | plan, research, design, deep checks, write `docs/ROUND<n>.md` | implement, test, merge, push |
| Gets the code | `git clone` of the public repo in its sandbox + GitHub connector | local checkout, SessionStart hook pulls |
| Writes to GitHub | GitHub connector (OAuth) — docs-only to `main`; anything else on a branch / PR | `git push` |
| Secrets (`.env.local`) | none — can't reach prod DB, Gemini, Telegram | local `.env.local` |

`main` auto-deploys to Vercel, so the chat never pushes code to `main` directly. Docs-only pushes don't deploy.

## Planning chat setup (claude.ai) — do once per account
1. **Network for code execution.** Settings → Capabilities → Code execution → network access: *All domains*
   (or at least `github.com`, `codeload.github.com`, `objects.githubusercontent.com`, `registry.npmjs.org`).
   Lets the chat `git clone`, `npm ci`, and run `npm run -s check`, `test:*`, smoke against a local server.
   Verified 2026-10-04: clone + `npm ci` + typecheck + lint all ran in the chat sandbox.
2. **GitHub OAuth App** (github.com → Settings → Developer settings → OAuth Apps → New OAuth App):
   - Application name `Claude`, Homepage `https://claude.ai`
   - Callback / Redirect URI `https://claude.ai/api/mcp/auth_callback`
   - Wildcard matching off, Device Flow off, "Expire user access tokens" on
   - Copy the **Client ID**; generate a **Client secret** (shown once — if lost, generate a new one).
   The same OAuth App can be reused by another Claude account; never commit or paste the secret in chat.
3. **GitHub connector in Claude.** Settings → Connectors → Add custom connector:
   - Name `Github`, URL `https://api.githubcopilot.com/mcp/`
   - Authentication: *Sign in now*; OAuth client: *Use your own OAuth client* → paste Client ID + secret
   - Add → Connect → sign in as `talJ1235` → Authorize. Start a new chat so the tools load.
   Verified 2026-10-04: listing commits of `talJ1235/nexus` works.
4. Optional: put the chat in a Claude Project "Nexus" with the instruction "Read `docs/PLANNER.md` and
   `docs/ENVIRONMENT.md` in talJ1235/nexus first".

## Running checks in the chat sandbox
The sandbox has no real secrets, so it uses a throwaway local `.env.local` (never committed; `.env*` is gitignored):
```
TURSO_DATABASE_URL=file:local.db
APP_PASSWORD=sandbox-pass
SESSION_SECRET=<40 random chars>
```
- `npm ci` then `npm run -s check` (typecheck + lint + build) → green on 2026-10-04, ~3 min (build is most of it).
  Use `SKIP_BUILD=1` for a ~30 s typecheck + lint when the build isn't needed.
- Playwright for smoke: `npx playwright install --with-deps chromium` (~1–2 min, once per sandbox).
  Full smoke in the sandbox not verified yet. No Gemini/Telegram/Blob here — AI paths only with the smoke's AI mock.

Don't use Claude in Chrome for repo work (slow, unreliable, expensive) — clone or connector instead.

## Claude Code setup
Standard: clone the repo, `npm install`, `cp .env.example .env.local` and fill values (from Vercel env /
password manager, never from the repo). `.claude/settings.json` holds the SessionStart pull hook and allowed
commands; per-machine extras (push/merge permissions for a round) go in `.claude/settings.local.json`.

## Vercel (Hobby) — deployments and the Function Storage limit
- Hobby has a **10 GB Function Storage** cap = the server bundles of *every retained deployment*, all projects together.
  One Nexus deployment is roughly 100 MB (mostly `sharp`), so ~100 kept deployments fill it, and at the cap new
  deployments are blocked. Hit 100% on 2026-10-02 (75% on 10-01; a production deploy failed on 10-01).
- Only `main` builds: `vercel.json` `ignoreCommand` starts with `[ "$VERCEL_GIT_COMMIT_REF" = "main" ] || exit 0`, so
  round branches (`round<n>`) no longer create preview deployments (exit 0 = skip). On `main`, docs-only pushes still skip.
  To get previews back for a branch, remove that first clause.
- Housekeeping: in Vercel → Deployments, delete old deployments now and then; keep the current production one plus 1–2
  for rollback. The usage counter may lag a day after deleting.

## Repo visibility & secrets
- The repo is **public** for now; Tal plans to make it **private** at launch
  (GitHub → repo Settings → General → Danger Zone → Change visibility).
- What changes when it goes private (checked 2026-10-04):
  - **Vercel:** keeps deploying (Hobby supports private repos of a personal account). Commits must come from Tal's
    GitHub identity (Claude Code commits as Tal; the chat pushes via the connector signed in as `talJ1235`) — commits
    authored by another GitHub user are not deployed on Hobby.
  - **Claude Code on Tal's PC:** no change (already authenticated).
  - **Planning chat:** the anonymous `git clone` stops working. Reading and docs pushes still work through the GitHub
    connector; full test runs in the chat sandbox need either a read-only fine-grained token for this one repo (never
    pasted into a doc) or Tal uploading a zip. Heavy testing belongs to Claude Code anyway.
  - **GitHub Actions** (`smoke.yml`): runs from the private-repo free minutes quota of a GitHub Free account instead of
    unlimited public minutes — check usage under Settings ← Billing after the first week.
  - **Security tooling:** GitHub's free secret scanning/push protection and CodeQL code scanning are for public repos;
    after going private, CI runs **gitleaks** and **Semgrep CE** instead (`docs/SECURITY.md` §11). Dependabot alerts stay free.
  - **Nobody else can read the code** — good for the product, but not a security control: the app must be safe even
    if the code leaks.
  - Links to files in the repo (e.g. in-app help pointing at GitHub, the extension zip) stop working for others.
- Secrets live only in `.env.local` and Vercel env vars. `.env.example` has names only, no values.
- **Secret audit 2026-10-04:** gitleaks 8.28.0 over all 150 commits → no leaks; manual pattern search for
  Gemini / Telegram / Turso / Vercel Blob / GitHub tokens → none. Re-run before going private or launching:
  `gitleaks git . --redact`.

## Log
Older entries: `docs/archive/ENVIRONMENT-log.md` (`rg` it when needed).
- 2026-10-12 (PC, R17 Session 7): new checks `test:adblock` (built app, port 3126: EasyList generic cosmetic rules from
  the vendored `scripts/fixtures/easylist-generic.txt` — refresh by hand with `node scripts/refresh-easylist.mjs`, it
  downloads easylist.to), `test:device` (built app, port 3127: computer / phone / tablet contexts, first paint with the
  app's JS blocked, the Layout override) and `test:device-width` (no build; in the guards unit loop). **Phone test
  contexts now need a mobile UA** besides `isMobile` + `hasTouch` (a bare 390 px window is a narrow computer):
  `import { PHONE, PHONE_UA } from "./lib/phone.mjs"`. Playwright's `isMobile` makes Chromium report UA-CH
  `mobile: true` even for an iPad descriptor — `test:device` overrides it over CDP for the tablet. Next 16 serves CSS
  from `/_next/static/chunks/` too: block only `.js` there to see a page before hydration. `.claude/settings.local.json`
  allows the round17-s7 push/merge commands.
- 2026-10-12 (PC, R18 Session 1): the read-only prod snapshot (`node --env-file=.env.local scripts/db-snapshot.mjs`)
  **ran in the session this time** (83 SELECT/PRAGMA, `snapshots/prod-2026-10-12.db`); the R18 rehearsal
  (`node scripts/r18-rehearsal.mjs --source snapshots/prod-2026-10-12.db --base origin/main`) ran on a copy. Reading
  receipt *contents* from `local.db` was refused by the classifier (PII) — `test:grocery` prints counts only for them.
  New env flag `SEARCH_OFF=1` (no live search even when `.env.local` has a key; `next start` loads it): set by
  `scripts/serve-smoke.sh`, `scripts/lib/test-app.mjs` and `guards.yml`. New tests `test:grocery`, `test:staples`,
  `test:add`, `test:trips` (unit loop), `test:shop-offline` (built app, port 3128). Playwright's `waitForFunction` with an
  async predicate passes on the Promise — poll from Node instead. No new secrets. `.claude/settings.local.json` allows
  the round18-s1 push/merge commands.
- 2026-10-14 (R18 S2, second half): new test `test:templates` (unit loop in `guards.yml`, with `test:trip-api`).
  `scripts/parity-r18.mjs` covers every R18 board (fresh un-onboarded person for /welcome via `sessionFor`).
  `SMOKE_ONLY` / `SMOKE_DEBUG` (14 call-log lines) for single smoke steps; `POLISH_ONLY=S3,P7` for polish sections.
  Mock AI (`NEXUS_AI_MOCK=1`): a grocery line ending in "[section]" (e.g. "Zorblax [bfast]") is classified into that
  section after 2.5 s — the smoke uses it for the live settle. The read-only prod snapshot ran from the agent this time
  (`node --env-file=.env.local scripts/db-snapshot.mjs`). No new env vars or secrets. `.claude/settings.local.json`
  allows the round18-s2 push/merge commands.
- 2026-10-15 (R18 S3): new tests `test:seed-admin` and `test:brands` in the unit loop (`guards.yml`); rehearsal
  `scripts/r18s3-rehearsal.mjs` (new table `brand_buy`). On Windows a script that deletes its libsql file after using
  it (or several older unit tests at exit) ends with code 127 after printing OK — Linux CI is unaffected; new scripts
  leave their DB file for the next run. Mock photo fixtures for `smPhoto`: `mockreceipt:`, `mocklist:<lines>`,
  `mockunsure:`, `mockother:<title>`. A leftover `next start -p 3100` from an earlier session locks `.next/serve.log`
  and fails `npm run build` (EBUSY) — stop it (`serve-smoke.sh` restarts cleanly). No new env vars or secrets.
- 2026-10-15 (R18 S4): new browser test `test:voice` (port 3133; fake MediaRecorder + oscillator mic; mock body
  `mockvoice:<words>`) and `test:capture` now run in CI; `test:dock` joined the unit loop. `test:barcode` decodes real
  fixtures with `zxing-wasm/full` in node (its wasm read from `node_modules/zxing-wasm/dist/full/`). Admin page
  `/debug/camera` for camera reports from phones. Mock photo `mocklow:<kind>` (kind confidence 0.4). Rehearsal
  `scripts/r18s4-rehearsal.ts` (no schema change; the A1 note cleanup on a snapshot copy). The read-only prod snapshot
  ran from the agent (`node --env-file=.env.local scripts/db-snapshot.mjs`). Windows bash: a large `python - <<'EOF'`
  heredoc sometimes fails to parse ("unexpected EOF") — write the script to the scratchpad and run it. No new env vars
  or secrets. `.claude/settings.local.json` allows the round18-s4 push/merge commands.
- 2026-10-15 (chat): workflow — the code map moved from `CLAUDE.md` to `docs/MAP.md` (by area, tests per area); `CLAUDE.md`
  keeps a pointer + the always-rules (16.4 KB → 6.8 KB per load). Builder reads one MAP section, updates it in place.
- 2026-10-16 (planning chat, account B): this chat had no `add_repo` push tool and the sandbox has no GitHub
  credentials, so `git push` fails. New docs go to `main` through the GitHub connector (`create_or_update_file`; it needs
  the whole file, fine for new / small files). Large docs (PLANNER, ENVIRONMENT) and boards travel as a zip: Tal unzips
  at the repo root, Claude Code's Step 0 runs `git apply -3 <patch>` + commits the boards on `main`. Boards are made in
  the Design canvas and composed with a small build script in the sandbox (shared CSS + widget partials).
