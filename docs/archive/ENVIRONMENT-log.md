# ENVIRONMENT log (older entries)

Moved from `docs/ENVIRONMENT.md` on 2026-10-16 — history, not instructions.

- 2026-10-04 (chat): confirmed chat sandbox network works; created GitHub OAuth App + custom connector; secret audit clean;
  wrote this file and linked it from `CLAUDE.md` and `docs/PLANNER.md`.
- 2026-10-04 (chat): full `npm run -s check` runs in the chat sandbox with a file DB (~3 min); Playwright installs there.
- 2026-10-04 (chat): Vercel Function Storage hit 10 GB; `vercel.json` now builds `main` only (branch `chore/vercel-main-only`).
- 2026-10-04 (chat, account B): design canvas recreated in this account as a claude.ai Design artifact from Tal's HTML export of
  account A's canvas (the export is a self-unpacking bundle; the page sources inside match `docs/design/home-v3/`). Canvas
  boards are `.dc.html` files; copies of each approved round go to `docs/design/<name>/` so the builder can read them.
  Chat has no git push credentials (`GH_TOKEN` invalid) — docs are pushed with the GitHub connector.
- 2026-10-04 (Claude Code, Round 13): smoke tooling — `SMOKE_ONLY=a|b`, failure screenshots with `SMOKE_OUT`, `SMOKE_FRESH` + `scripts/serve-fresh.sh` (a second local server on an empty DB, :3101, files `fresh-smoke.db/.log` gitignored); `npm run test:home`.
- 2026-10-04 (chat, account B): documented what making the repo private changes (Vercel, chat clone, Actions minutes, CodeQL/secret scanning → gitleaks + Semgrep). Security plan `docs/SECURITY.md` adds CI tools (Semgrep CE, OWASP ZAP baseline) and Cloudflare Turnstile keys for R15.
- 2026-10-04 (Claude Code, Round 14): `SEED_PROFILE=sparse bash scripts/serve-fresh.sh` (:3102, sparse seed) + `SMOKE_SPARSE`; `SMOKE_DEBUG=1` keeps the full Playwright error; `node scripts/parity.mjs [only]` renders mockup-vs-app parity PNGs into `docs/design/parity-r14/`; `npm run test:ics` (dev dependency `ical.js`); `*-smoke.db/.log` gitignored. Settings `.claude/settings.local.json` allows the round14 push/merge commands and `git merge --no-edit origin/main`.
- 2026-10-05 (chat, account B · tal.jacoby10): R15 design canvas "Nexus R15 — Accounts & Spaces" created as a claude.ai Design artifact on this account; its boards are copied to `docs/design/r15/` once Tal approves (`Main` → `SignIn-desktop.dc.html`). R15 adds env vars `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAIL`, optional `TURNSTILE_*`, local-only `AUTH_FULL_LOCAL` (setup steps: `docs/ROUND15.md` "Before you run"); the builder records the final list here when it ships.
- 2026-10-05 (chat, account B): the planning chat can reach Tal's PC through the Claude desktop app (linked computer,
  folder `OneDrive\שולחן העבודה\Project Nexus\nexus` granted per session). Used it to edit `.env.local` in place (secrets
  generated there, never shown in chat; backup `.env.local.bak-r15`) and `.claude/settings.local.json` (round15 pushes).
  Driving the in-app browser on Tal's PC for Google Cloud / Vercel was **refused by the permission guard** — account
  consoles stay manual for Tal. Local `.env.local` uses a **file** DB; prod access for the R15 snapshot comes from two
  extra names `PROD_TURSO_DATABASE_URL` + `PROD_TURSO_READ_TOKEN` (read-only token). R15 mockups written into Tal's checkout
  `docs/design/r15/` (+ `nx.css`) — the builder commits them; the sandbox can't `git push` (proxy 403) and the connector
  would need every file pasted, so big file sets go to the PC instead.
  **Never run `git` from the chat's device shell on Tal's checkout:** it sees every file as modified (CRLF) and left a
  `.git/index.lock` it couldn't delete (removed with Tal's delete permission). Read/write files only; git stays with Claude Code.
- 2026-10-06 (Claude Code, R15 session 1): new env names — `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ADMIN_EMAIL` (+ optional
  `ADMIN_NAME`), `GOOGLE_CLIENT_ID/SECRET`, `AUTH_FULL_LOCAL` (localhost only), `NEXT_PUBLIC_APP_URL` + `RESEND_API_KEY` (+
  `EMAIL_FROM`) switch on full mode, `TURNSTILE_SITE_KEY/SECRET_KEY` (optional), test-only `AUTH_TEST_IDP=1` (dev server only;
  a production build/server refuses it), `AUTH_SESSION_CACHE=0` (tests), `R15_LOCAL_GUARD=0` (escape hatch; default refuses a
  non-file DB from a PC). Local servers: `AUTH_FULL_LOCAL=0 bash scripts/serve.sh` = prod-like closed mode (the admin password
  form is `/login?admin=1`, which `npm run smoke` uses); with `.env.local`'s `AUTH_FULL_LOCAL=1` the fallback is off and
  passkeys / email recovery show. Email in dev lands in `.auth-outbox.jsonl` (gitignored). New scripts: `db-snapshot.mjs`,
  `db-restore-test.mjs`, `db-restore-prod.mjs`, `r15-rehearsal.mjs`, `parity-r15.mjs`; tests `test:auth`, `test:otp`,
  `test:authz-coverage`, `test:scope`, `test:roles`, `test:tenancy`, `test:ssrf`, `test:headers`, `test:auth-flow`.
- 2026-10-06 (Claude Code, R15 session 2): **CI** — `.github/workflows/guards.yml` runs on every push and PR (types, lint,
  unit tests, `test:authz-coverage` / `test:scope` / `test:ssrf` / `test:query-plans`, `npm audit --omit=dev
  --audit-level=high`, gitleaks with `.gitleaks.toml` (test fixtures allow-listed), build, `test:tenancy`, `test:headers` on
  a throwaway server); no secrets needed. All workflow actions pinned by commit SHA (`smoke.yml` too). New scripts:
  `npm run bench:r15` (main vs round15; needs a built `main` worktree at `../nexus-main-bench` — `git worktree add`,
  `node_modules` junction, `turbopack.root` = parent in that worktree's `next.config.ts`, never committed), `npm run
  test:query-plans`, `parity-r15.mjs spaces` (run on the sparse DB: `BASE=http://localhost:3102
  TURSO_DATABASE_URL=file:sparse-smoke.db`). `test:tenancy` now covers spaces + browser checks (`TENANCY_QUICK=1` skips the
  every-action sweeps locally, `TENANCY_UI=0` skips the browser). `seed-local.mjs` / `serve-fresh.sh` fill the admin's
  personal space (ADMIN_EMAIL from `.env.local`). The invite QR uses zxing-wasm's writer (`public/vendor/zxing_writer.wasm`,
  self-hosted like the reader). No new env names this session.
- 2026-10-06 (chat, account B): R16 adds an optional realtime service — **Ably** free tier (app `Nexus`, key with Publish +
  Subscribe + Presence) as `ABLY_API_KEY` in Vercel (Production) and `.env.local`; without it live sync polls every 10 s.
  Free limits checked 2026-10-06: 6 M messages/month, 200 concurrent connections. Setup steps: `docs/ROUND16.md` "Before you run".
- 2026-10-07 (chat, account A): the chat sandbox can now `git push` to `main` directly — attach the repo with push access (the session's "add repo", access `push`), clone into `/home/claude/nexus`, commit as Tal. No GitHub connector needed for docs pushes on this account.
- 2026-10-07 (PC, R16 Session G): Vercel functions now run in **`dub1` (Dublin)** via `vercel.json` `regions` — next to
  the Turso DB (`aws-eu-west-1`, Ireland). Before: `fra1` (Frankfurt; `x-vercel-id` shows the region). Hobby allows one
  region; the DB stays where it is. Sign-in timings: `Server-Timing` on `/api/auth/*`, `scripts/bench-signin.mjs`.
- 2026-10-07 (PC, R16 Session 2): new checks `npm run test:settings` (needs a running server on a FILE DB with the
  ADMIN_EMAIL user + demo data — locally `bash scripts/serve-r16.sh`, then `TURSO_DATABASE_URL=file:r16-smoke.db node
  --env-file=.env.local scripts/test-settings.mjs`), `scripts/parity-r16.mjs` (boards vs app → `docs/design/parity-r16/`,
  boards rendered by `scripts/lib/board.mjs`), fixture `scripts/fixtures/space-photo-gps.jpg`. `guards.yml` now also
  runs `test:errors`, `test:live` and `test:settings` (CI seeds `ci-settings.db`; timeout 60 min). The local smoke reads
  `NEXUS_PASSWORD` — set it from `.env.local`'s `APP_PASSWORD`. Space photos need `BLOB_READ_WRITE_TOKEN` on Vercel
  (already set for item pictures); without it (local only) they're kept inline. No new env names.
- 2026-10-08 (PC, polish audit): project skills added under `.claude/skills/` — 9 design/motion skills copied (raw files, no installer, no scripts) from `emilkowalski/skills@e8a175d` (MIT, licence in `.claude/skills/LICENSE-emilkowalski-skills`): emil-design-eng, review-animations, improve-animations, find-animation-opportunities, mobile-native, break-ui, apple-design, animation-vocabulary, ask-sonner. Findings: `docs/POLISH-AUDIT.md`.
- 2026-10-08 (PC, polish fixes): added `scripts/seed-worst.mjs` (the audit's worst-case spaces as a repeatable seed, file DBs only) and `npm run test:polish`, which is also a `guards.yml` step. `test:polish` starts `next dev` on :3108 with `polish-test.db` and sets `REALTIME_FAKE=1`: Next fills *empty* env values from `.env.local`, so blanking `ABLY_API_KEY` alone isn't enough. A bench build of `main` in a worktree needs its own `npm ci`, because Turbopack refuses a `node_modules` junction that points outside the worktree.
- 2026-10-08 (PC, R17 session 1): **env** — new `ADMIN_EMERGENCY_TOKEN` (≥ 32 chars) + `ADMIN_EMAILS` (admin emergency
  sign-in; the password fallback and `APP_PASSWORD` are gone), optional `CF_FETCH_URL` + `CF_FETCH_SECRET` (Cloudflare
  fetch worker, setup in `scripts/cf-worker/README.md`). GitHub secrets for the prod smoke: `SMOKE_ADMIN_TOKEN` (=
  `ADMIN_EMERGENCY_TOKEN`) and `SMOKE_ADMIN_EMAIL`; `NEXUS_PASSWORD` is unused. **Scripts/tests** — `scripts/serve-smoke.sh
  [--build]` serves the build on a fresh seeded `smoke.db`; local smoke/parity/perf scripts sign in through
  `scripts/lib/sign-in.mjs`, which mints a session row in `smoke.db` per sign-in (signed with `.env.local`'s secret; no password); `scripts/lib/
  test-app.mjs` = fresh seeded DB + signed session + server for browser tests; new `test:clip` (cut-off text, ~13 min on
  this PC), `test:short-name`, `test:ai-quota`, `test:blocked`, `test:delete-account`; `scripts/switch-timing.mjs` (space
  switch timing), `scripts/blocked-probe.mjs` (fetch-ladder table via `/api/debug/blocked`); `POLISH_ONLY=A1,A2` runs
  parts of `test:polish`. Actions moved to node24 releases and `ubuntu-24.04`.
- 2026-10-09 (planning chat, account B): `.claude/skills/animate/` (SKILL.md + RECIPES.md) added from `emilkowalski/skills@e8a175d` (same MIT licence file); push from the chat sandbox worked after attaching the repo with push access (`add_repo` access "push", clone at `/home/claude/nexus`).
- 2026-10-09 (Claude Code, R17 Session 2): new tests `test:admin-access`, `test:admin-privacy`, `test:admin-live`,
  `test:admin-people`, `test:onboarding` (each starts the built app on its own throwaway DB, ports 3121–3125) — they call
  server actions over HTTP from `.next/server/server-reference-manifest.json` (`scripts/lib/actions.mjs`);
  `scripts/lib/test-app.mjs` adds `sessionFor(userId)` and sets `busy_timeout` on its DB handle; admin demo people in
  `scripts/lib/seed-admin.mjs`; `node scripts/parity-r17.mjs [prefix]` (boards vs app, own server on `parity-r17.db`).
  `.claude/settings.local.json` allows the round17-s2 push/merge commands.
- 2026-10-09 (planning chat): a Design canvas made on the other Claude account opens here only as a read-only copy ("belongs to another organization") — `read` works, `publish` with its `url` doesn't. To continue it: read it, publish a new canvas from the Design type on this account with the same `project/*` files, and treat the new one as current (record its name in `PLANNER.md`).
- 2026-10-10 (Claude Code, R17 Session 3): web push. `.env.local` has `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT` (generated in Step 0 with Node's crypto; subject = the prod URL until a privacy address exists) — copy
  the same three to Vercel (Production) and redeploy. New GitHub Actions workflow `hourly.yml` (`5 * * * *`: curls
  `/api/cron/notify` then `/api/cron/prices?scope=hourly`) needs the repo secret `CRON_SECRET` = Vercel's value (without
  it the job skips, green). New tests `test:notify` (unit + throwaway DB), `test:push` (fake push service on loopback,
  decrypts the payload; the browser part prefers the full Chromium — `chromium.launch({ channel: "chromium" })` — and
  falls back to the headless shell, which has no notifications), `test:inbox` (built app, port 3111; screenshots to
  `test-data/inbox`). Seeder `scripts/lib/seed-notify.mjs`. `.claude/settings.local.json` allows the round17-s3
  push/merge commands.
- 2026-10-10 (PC, R17 Session 4): new checks `test:bidi` (built app, port 3114: the switcher with Latin / Hebrew names
  + a Hebrew walk of the app — guards.yml) and `test:check-now` (tsx, throwaway DB, a fake store behind a resolver stub;
  in the guards unit loop). `test:inbox`, `test:polish` (`POLISH_ONLY=P6,P7`), `test:settings` (Profile),
  `test:admin-access`, `test:auth-flow` gained checks. Locally `test:settings` runs like CI (`ci-settings.db`, port 3107,
  `ADMIN_EMAIL=ci-admin@example.com`, a build first). `ADMIN_EMAILS` now also grants the admin role (not only the
  emergency sign-in). The read-only prod snapshot (`db-snapshot.mjs`) was refused by the session's permission classifier
  ("production reads") — run it by hand when a session needs prod data. `.claude/settings.local.json` allows the
  round17-s4 push/merge commands.
- 2026-10-10 (PC, R17 Session 5): new `scripts/lib/admin-walk.mjs` (every admin tab; fails on console errors, hydration
  warnings, 5xx, blank pages) used by `test:admin-access` (now also a browser walk: 1366 + 390, en + he, server `TZ=UTC`,
  browser Asia/Jerusalem) and the smoke (signed-in admin, en + he); `scripts/probe-admin.mjs` runs it against any BASE
  (prod: `node --env-file=.env.local scripts/probe-admin.mjs` with `BASE=https://…`, one emergency sign-in — the path
  answers 429 after a few quick ones). `test:polish` gained `S3` (desktop 1366 / 1280×720 / 2560×1305, real mouse, cached
  wording of different lengths written into the test DB). `test:headers` checks the manifest share target. Read-only
  prod DB queries are still refused by the permission classifier ("production reads") and there is no Vercel CLI login
  here — the 500s' real cause has to come from the error log (it now records the driver's reason). `.claude/settings.local.json`
  allows the round17-s5 push/merge commands.
- 2026-10-10 (PC, R17 Session 6): new env flag `NOTIFY_AUTO_DISPATCH` — `0` turns off the opportunistic notification
  dispatcher on app requests; `scripts/lib/test-app.mjs`, `scripts/serve-smoke.sh` and `guards.yml` set it so seeded
  test data stays as seeded (unset in prod = on). `test:push` gained the test push + `maybeDispatch` checks (it now
  starts its browser app with throwaway VAPID keys), `test:admin-access` starts its app with throwaway VAPID keys and
  checks System → Push, `test:inbox` the "Not arriving?" steps. The prod smoke (`scripts/smoke.mjs`, signed-in, real data
  only) fails when System → Push shows a waiting row older than 70 min or no dispatcher run for 3 h. A fresh prod
  snapshot was again refused by the permission classifier ("production reads"); the rehearsal ran on
  `snapshots/prod-2026-10-10.db`. `.claude/settings.local.json` allows the round17-s6 push/merge commands.

