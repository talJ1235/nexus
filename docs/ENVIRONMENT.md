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
- After it goes private: Vercel and Claude Code keep working; the chat's anonymous `git clone` stops — use the
  connector, or Tal uploads a zip for full test runs. GitHub Actions (smoke.yml) then uses the private-repo minutes quota.
- Secrets live only in `.env.local` and Vercel env vars. `.env.example` has names only, no values.
- **Secret audit 2026-10-04:** gitleaks 8.28.0 over all 150 commits → no leaks; manual pattern search for
  Gemini / Telegram / Turso / Vercel Blob / GitHub tokens → none. Re-run before going private or launching:
  `gitleaks git . --redact`.

## Log
- 2026-10-04 (chat): confirmed chat sandbox network works; created GitHub OAuth App + custom connector; secret audit clean;
  wrote this file and linked it from `CLAUDE.md` and `docs/PLANNER.md`.
- 2026-10-04 (chat): full `npm run -s check` runs in the chat sandbox with a file DB (~3 min); Playwright installs there.
- 2026-10-04 (chat): Vercel Function Storage hit 10 GB; `vercel.json` now builds `main` only (branch `chore/vercel-main-only`).
