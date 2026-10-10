@AGENTS.md

# Nexus — working notes for agents

- Product spec: `SPEC.md` (source of truth). Design tokens: `src/app/globals.css`. Visual references for UI v2:
  `docs/design/*.html` (static mockups from the design canvas; open with Playwright at the right viewport).
- Next.js 16: `proxy.ts` (not middleware), async `cookies()`/`params`. Read
  `node_modules/next/dist/docs/` before using unfamiliar APIs.
- RTL: use logical Tailwind utilities only (`ms-/me-/ps-/pe-/start-/end-/text-start`).
  Never `ml-/mr-/pl-/pr-/left-/right-` for layout.
- All UI strings go through `src/lib/i18n` dictionaries (en + he). No hardcoded copy.
- The "Ask Nexus" button is **always a fully rounded pill** (circle when icon-only), even if other surfaces move to
  smaller radii: reuse `AskButton` (`top-bar.tsx`, `.ask-hairline` owns the radius) for every placement.
- DB: Drizzle schema in `src/db/schema.ts`; tables are created idempotently by
  `src/db/migrate.ts` (runs on build via `npm run db:migrate`).
- Checks before commit: `npm run typecheck && npm run lint && npm run build`.

## Map (read this instead of exploring)
- Prod: https://nexus-ashen-beta.vercel.app (auto-deploys from `main`). Local: `bash scripts/serve-smoke.sh` (signed-in test session, no password).
- Server actions: `src/app/*-actions.ts` — every action and route starts with `requireCtx(need)` / `routeCtx` (`src/lib/ctx.ts`:
  user + current space from the `nexus_space` cookie, checked against memberships; `test:authz-coverage` enforces it).
  Data goes through the scoped layer `src/lib/db-scoped/` (`scoped(ctx)` adds `space_id`; raw `db` only there, in
  `src/lib/spaces.ts`, `src/lib/auth/`, migrations — `test:scope`). Spaces UI: `src/components/app/spaces/`, actions
  `space-actions.ts`, `/join/[token]`.
- Live sync (R16 B): every scoped write bumps the space revision (`src/lib/db-scoped/feed.ts`, `changes.ts` →
  `changesSince`); `src/lib/realtime/` publishes `{ rev, by }` to Ably (fake transport for tests, polling without
  `ABLY_API_KEY`); client: `live-sync.tsx` + `store.applyChanges`; conflicts via `base` revisions (`lib/conflict.ts`).
- Error log (R16 C2): `src/lib/errors/` (intake limits, redaction), `src/instrumentation.ts` (`onRequestError`),
  `/api/errors`, `/admin/errors`, `node scripts/errors.mjs`.
- Settings (R16 D): `src/components/app/settings/` (shell = desktop dialog / phone pages, `you.tsx`, `account.tsx`,
  `space.tsx`; kit = `components/auth/nx.css` + `settings/nx16.css`), deep links `/settings/[[...section]]`. Space look:
  `spaces/look.ts` (icons, gradients), `spaces/tile.tsx`, `spaces/identity.tsx`, `/api/space-photo`; switch moment
  `spaces/moment.tsx`. Home (R16 E): `src/lib/home-layout.ts` (widgets, presets), `lib/home-widgets.ts` (E2 numbers),
  `home-grid.tsx` (grid + Customise), `home-extra.tsx`; layout per user per space in `user_pref`.
- Auth (Better Auth): `src/lib/auth/` (`server.ts` config + hooks, `session.ts`, `invites.ts`, `security.ts`, `limits.ts`),
  screens `src/components/auth/`, pages `/login`, `/welcome`, `/passkey`; account/security/invite codes are Settings sections.
- Client state: `src/components/app/store.tsx`; shell: `nexus-app.tsx`; panels: `assistant-panel`, `alerts-panel`, `share-dialog`, `import-dialog`, `settings/shell`, `command-palette`.
- Domain libs in `src/lib/`: `extract` (link → product), `tracker` (prices/alerts), `ai` + `assistant` (Gemini, model fallback; through `ai-gate`), `spaces` (spaces, people, invite links), `safe-fetch` (SSRF guard), `backup`, `importer`. Retired: `telegram` (code kept), the guest app and the extension (removed in R17).
- R17: help = `src/lib/help/topics/*.md` (one file per topic, `test:help` limits). AI gate = `src/lib/ai-gate.ts` — every
  model call passes `use` (feature, user, space): switch, 40/day quota, redaction, `ai_usage`. Fetch ladder for blocked
  stores = `extractFromUrl` in `lib/extract.ts` (direct → `lib/store-apis.ts` Woo/Shopify → Cloudflare Worker
  `scripts/cf-worker/`), probe `/api/debug/blocked`. Short names = `lib/short-name.ts` + backfill
  `lib/db-scoped/short-names.ts` (cron). Delete account / export = `lib/db-scoped/account.ts`, `app/account-actions.ts`,
  `/restore-account`, `/delete-account`, `/api/my-data`; the purge runs in the daily cron. Sign-in has no password: admin
  emergency `POST /api/emergency` (`ADMIN_EMERGENCY_TOKEN`). Truncated text reads in full via `lib/trunc-title.ts`.
- R17 S2: admin panel = `/admin/[[...path]]` + `components/admin/` (shell `admin-app.tsx`, a file per tab, kit `nx17.css` +
  `admin.css`), actions `app/admin-actions.ts` (all behind `admin()`), reads `lib/db-scoped/admin.ts` + `admin-health.ts`.
  Presence/activity = `lib/presence-keys.ts` (screen keys, kinds), `lib/db-scoped/presence.ts`, `/api/presence`, client
  beat `components/app/presence-beat.tsx`, `lib/activity.ts` (`noteActivity`). Onboarding = `/welcome`,
  `components/onboarding/`, `app/onboarding-actions.ts`, `lib/onboarding.ts` (`pref:onboarding`, stores, presets).
  Tests that call actions over HTTP: `scripts/lib/actions.mjs`; admin demo data: `scripts/lib/seed-admin.mjs`.
- R17 S3 notifications: every sender calls `notify()` (`lib/notify/enqueue.ts`: actor excluded, one row per group key,
  `send_after` from `lib/notify/schedule.ts` — quiet hours, active hour); senders `lib/notify/senders.ts` (trips from the
  presence beat, activity from `noteActivity`, prices from the cron, deliveries / budget / week in the hourly sweep);
  dispatcher `lib/notify/dispatch.ts` + `/api/cron/notify` (GitHub `hourly.yml`); push `lib/notify/push.ts` (endpoint
  allow-list) + `public/sw.js`; texts from data at read time `lib/notify/text.ts` (i18n `nt`); data
  `lib/db-scoped/notify.ts`. UI `components/notify/` (inbox popover / `/inbox` page, rows, reminder card, kit `nx18.css`),
  actions `app/notify-actions.ts`, Settings → Notifications `settings/notifications.tsx`, budget recipients in
  `settings/space.tsx` (`pref:budget-alerts`). Routes `/api/notify/{subscribe,received,open}`. Inbox demo rows:
  `scripts/lib/seed-notify.mjs`.
- The cloud sandbox cannot reach vercel.app, Gemini or Telegram — prod checks run in GitHub Actions (`.github/workflows/smoke.yml`).

## Working efficiently (token budget matters)
- Local server: `bash scripts/serve.sh [--build]` (restarts cleanly, waits until ready). Demo data: `node --env-file=.env.local scripts/seed-local.mjs`.
- Smoke: `bash scripts/serve-smoke.sh [--build]` (fresh seeded `smoke.db`, signs the smoke in — no password), then
  `SMOKE_WRITE=1 npm run smoke` (add `SMOKE_MOBILE=1` for the phone). Browser tests with data: `scripts/lib/test-app.mjs`.
- Cut-off text guard: `npm run test:clip` (needs a build; `CLIP_QUICK=1` for 390 + 1366 only).
- Verify with `npm run -s check` (quiet: prints one OK line or only the errors). Never paste full build logs.
- UI verification: `npm run smoke` (Playwright, PASS/FAIL lines, screenshots to `$SMOKE_OUT`). Extend
  `scripts/smoke.mjs` for new features instead of writing throwaway scripts or clicking through a browser.
  Look at a screenshot only when a visual judgment is needed.
- Telegram webhook: `node --env-file=.env.local scripts/test-telegram.mjs` (local DB only, self-contained fake store).
- Use the live browser (Claude in Chrome) only for things no script can reach, and batch actions.
- Read only the files a change touches (use the map above, `rg -n` for symbols); prefer Edit over rewriting files.
- Model routing: stay on the main model for planning, design, security (auth/sharing/guest), and bugs with an
  unknown cause. Delegate well-specified, self-contained changes to the `implementer` subagent (Sonnet) with a precise
  brief (goal, files, acceptance checks), then review its diff (`git diff --stat` + the touched hunks) before committing.
  Small edits (a few lines) are cheaper to do directly than to delegate.
- One feature/round per session. At the end, update SPEC.md ("shipped") so the next session starts from it.

## Session workflow (how Tal works)
- Environment & tooling (connectors, chat sandbox, secrets layout, account setup): `docs/ENVIRONMENT.md`. Any change to
  setup, tooling or workflow is recorded there in the same session (add a log line) — the next account/machine relies on it.
- Planning happens in a separate chat (its playbook: `docs/PLANNER.md`); it writes the task as `docs/ROUND<n>.md` (the brief is the source of truth
  for the task — don't ask for chat history). A session prompt is usually just "Round N, session X".
- Sync first: a SessionStart hook runs `git pull --rebase --autostash` (`.claude/settings.json`). If its output shows
  an error or conflict, fix or ask before any work — never start a round on a stale checkout.
- At the start of a fix round, read open reports (GitHub issues `from-app` or `node scripts/reports.mjs`), then the
  automatic error log (`node scripts/errors.mjs`; admin view `/admin/errors`).
- Start: read CLAUDE.md (auto), the brief's section for this session, and only the files it names. For items touching
  3+ files or with open design choices, use plan mode and show a plan of ≤10 lines before editing.
- Per item: implement → `npm run -s check` → smoke for UI (add `SMOKE_MOBILE=1` for anything visible on phones) →
  one commit per item (`R5.3: …`) → tick `[x]` in the brief. Run `/compact` between items on long sessions.
- Every UI change must work on a phone (390 px wide, touch targets ≥40 px, safe-area insets), not only desktop.
- Visual and motion work: the skills in `.claude/skills/` (emil-design-eng, apple-design, mobile-native, animate +
  RECIPES, break-ui, review-animations) are the bar; boards from `docs/design/r17/` on carry their motion tokens in `nx17.css`.
- Brief says "confirm with the trace/frames first" → measure before changing. If the brief is wrong or a choice needs
  Tal, stop and ask in one short question instead of guessing.
- End: update SPEC.md by **editing** the round's section (never append a second copy — Round 4 was duplicated once),
  write anything left open (bugs, skipped parts, questions for Tal) under "## Open" at the end of the brief,
  `git pull --rebase`, push to `main` (auto-deploys), and reply with: items done, commits, anything left open.
- Docs-only pushes (`docs/`, `*.md`, `.claude/`) don't trigger a Vercel build (`vercel.json` ignoreCommand diffs against the last deployed commit, `VERCEL_GIT_PREVIOUS_SHA`, so a push that ends with a docs commit still deploys its code).
  A manual "Redeploy" in Vercel (same commit as the last deploy) always builds — use it after changing env vars.

# Compact instructions
Keep: files changed, decisions made, open bugs, test results. Drop: tool output, screenshots, logs.
