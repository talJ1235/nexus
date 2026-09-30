@AGENTS.md

# Nexus — working notes for agents

- Product spec: `SPEC.md` (source of truth). Design tokens: `src/app/globals.css`.
- Next.js 16: `proxy.ts` (not middleware), async `cookies()`/`params`. Read
  `node_modules/next/dist/docs/` before using unfamiliar APIs.
- RTL: use logical Tailwind utilities only (`ms-/me-/ps-/pe-/start-/end-/text-start`).
  Never `ml-/mr-/pl-/pr-/left-/right-` for layout.
- All UI strings go through `src/lib/i18n` dictionaries (en + he). No hardcoded copy.
- DB: Drizzle schema in `src/db/schema.ts`; tables are created idempotently by
  `src/db/migrate.ts` (runs on build via `npm run db:migrate`).
- Checks before commit: `npm run typecheck && npm run lint && npm run build`.

## Map (read this instead of exploring)
- Prod: https://nexus-ashen-beta.vercel.app (auto-deploys from `main`). Local: `npx next start -p 3100`, password in `.env.local`.
- Server actions: `src/app/*-actions.ts` (every one must call `assertAuth`/`assertOwner`/`requireGuest`).
- Client state: `src/components/app/store.tsx`; shell: `nexus-app.tsx`; panels: `assistant-panel`, `alerts-panel`, `share-dialog`, `import-dialog`, `settings-dialog`, `command-palette`.
- Domain libs in `src/lib/`: `extract` (link → product), `tracker` (prices/alerts), `telegram`, `ai` + `assistant` (Gemini, model fallback), `guest` + `invites` (sharing), `backup`, `importer`.
- The cloud sandbox cannot reach vercel.app, Gemini or Telegram — prod checks run in GitHub Actions (`.github/workflows/smoke.yml`).

## Working efficiently (token budget matters)
- Local server: `bash scripts/serve.sh [--build]` (restarts cleanly, waits until ready). Demo data: `node --env-file=.env.local scripts/seed-local.mjs`.
- Write-path UI checks (localhost only): `SMOKE_WRITE=1 NEXUS_PASSWORD=... npm run smoke`.
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
- Planning happens in a separate chat; it writes the task as `docs/ROUND<n>.md` (the brief is the source of truth
  for the task — don't ask for chat history). A session prompt is usually just "Round N, session X".
- Sync first: a SessionStart hook runs `git pull --rebase --autostash` (`.claude/settings.json`). If its output shows
  an error or conflict, fix or ask before any work — never start a round on a stale checkout.
- Start: read CLAUDE.md (auto), the brief's section for this session, and only the files it names. For items touching
  3+ files or with open design choices, use plan mode and show a plan of ≤10 lines before editing.
- Per item: implement → `npm run -s check` → smoke for UI (add `SMOKE_MOBILE=1` for anything visible on phones) →
  one commit per item (`R5.3: …`) → tick `[x]` in the brief. Run `/compact` between items on long sessions.
- Every UI change must work on a phone (390 px wide, touch targets ≥40 px, safe-area insets), not only desktop.
- Brief says "confirm with the trace/frames first" → measure before changing. If the brief is wrong or a choice needs
  Tal, stop and ask in one short question instead of guessing.
- End: update SPEC.md by **editing** the round's section (never append a second copy — Round 4 was duplicated once),
  write anything left open (bugs, skipped parts, questions for Tal) under "## Open" at the end of the brief,
  `git pull --rebase`, push to `main` (auto-deploys), and reply with: items done, commits, anything left open.
- Docs-only pushes (`docs/`, `*.md`, `.claude/`) don't trigger a Vercel build (`vercel.json` ignoreCommand diffs against the last deployed commit, `VERCEL_GIT_PREVIOUS_SHA`, so a push that ends with a docs commit still deploys its code).

# Compact instructions
Keep: files changed, decisions made, open bugs, test results. Drop: tool output, screenshots, logs.
