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
- Verify with `npm run -s check` (quiet: prints one OK line or only the errors). Never paste full build logs.
- UI verification: `npm run smoke` (Playwright, PASS/FAIL lines, screenshots to `$SMOKE_OUT`). Extend
  `scripts/smoke.mjs` for new features instead of writing throwaway scripts or clicking through a browser.
  Look at a screenshot only when a visual judgment is needed.
- Use the live browser (Claude in Chrome) only for things no script can reach, and batch actions.
- Read only the files a change touches (use the map above, `rg -n` for symbols); prefer Edit over rewriting files.
- One feature/round per session. At the end, update SPEC.md ("shipped") so the next session starts from it.

# Compact instructions
Keep: files changed, decisions made, open bugs, test results. Drop: tool output, screenshots, logs.
