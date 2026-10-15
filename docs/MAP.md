# Nexus — code map (by area)

For the builder (Claude Code) and the planning chat. Read **only the section you need**:
`rg -n '^## ' docs/MAP.md` lists the areas, then read one section (view with a line range). Don't read the whole file.
Paths are under `src/` unless they start with `scripts/`, `docs/`, `public/` or `.github/`.
Each area ends with **Tests** — run those for a change there, not the whole suite (CI runs everything).

**Keeping it true:** a change that adds, moves or renames a file, route, table or test updates its line **in the area
it belongs to** (never a new "Round N" paragraph). One line per thing; say what it is, not how it was built. History
belongs in `SPEC.md` and the round briefs, not here.

## Rules that span every area
- Next.js 16: `proxy.ts` (not middleware), async `cookies()` / `params`; docs in `node_modules/next/dist/docs/`.
- Phone vs computer = `<html data-device>` (`lib/device.ts`: server guess + `DEVICE_SCRIPT` in the boot screen,
  cookie `nexus_device`, override Settings → Display → Layout), never the window's width. Components: Tailwind
  `phone:` / `desk:` (globals.css), `useDevice()` / `isPhone()` / `usePhoneNarrow()` (`components/ui/use-device.ts`),
  CSS `:where([data-device=phone])`. `lg:` / width media only size things (allow-list `scripts/device-width-allow.txt`).
- RTL: logical utilities only. User text that can be cut gets `.bidi` (globals.css); Radix direction via
  `Direction.Provider` in `components/providers.tsx`. Truncated text reads in full via `lib/trunc-title.ts`.
- Strings: `lib/i18n/` (en + he; supermarket in `sm-en.ts` / `sm-he.ts`). Help topics: `lib/help/topics/*.md`.
- Style kits: tokens `app/globals.css`; `components/auth/nx.css`, `settings/nx16.css`, `components/admin/nx17.css` (motion
  tokens, boards from `docs/design/r17/` on), `components/notify/nx18.css`, `supermarket/sm.css`. Motion helpers `lib/motion.ts`.
- Ask button: always a full pill / circle — reuse `AskButton` (`components/app/top-bar.tsx`, `.ask-hairline`).
- **Tests:** `test:device`, `test:device-width`, `test:bidi`, `test:clip` (needs a build), `test:contrast`, `test:viewport`.

## App shell, navigation, client state
- Shell `components/app/nexus-app.tsx`; client state `components/app/store.tsx`; phone shell + dock quick menu
  `phone-shell.tsx`; dock `lib/dock.ts` (one dock for everyone; Projects is a Products segment); dock tap vs hold
  `lib/press.ts`. Swipe `components/ui/swipe.ts` (`useSwipe`); gestures `lib/gestures.ts`.
- Panels (in `components/app/`): `assistant-panel`, `share-dialog`, `import-dialog`, `settings/shell`, `command-palette`.
- Boot / offline: `components/boot-screen.tsx` (also `EARLY_ERRORS` buffer), `lib/offline.ts`, `offline-app.tsx`,
  service worker `public/sw.js` + `components/sw-register.tsx`. Manifest `app/manifest.ts`.
- **Tests:** `test:dock`, `test:gestures`, `test:polish`; smoke (`SMOKE_MOBILE=1` for the phone).

## Server actions, request context, scoped data
- Actions `app/*-actions.ts`; every action / route starts with `requireCtx(need)` / `routeCtx` (`lib/ctx.ts`: user +
  current space from the `nexus_space` cookie, checked against memberships).
- Data only through `lib/db-scoped/` (`scoped(ctx)` adds `space_id`). Raw `db` only there, in `lib/spaces.ts`,
  `lib/auth/`, migrations. Schema `db/schema.ts`; migrations `db/migrate.ts` (idempotent, runs on build) + `drizzle/`;
  DB read retry `db/transient.ts` (wired in `db/index.ts`). KV + leases `lib/kv.ts`.
- SSRF guard `lib/safe-fetch.ts`; backup `lib/db-scoped/backup.ts` + `/api/backup`; importer `lib/importer.ts`.
- **Tests:** `test:authz-coverage`, `test:scope`, `test:roles`, `test:tenancy`, `test:ssrf`, `test:query-plans`.

## Auth & account
- Better Auth: `lib/auth/` (`server.ts` config + hooks, `session.ts`, `invites.ts`, `security.ts`, `limits.ts`,
  `config.ts` — admin role `isListedAdmin` from ADMIN_EMAILS + ADMIN_EMAIL). Screens `components/auth/`; pages
  `/login`, `/welcome`, `/passkey`. No password: emergency `POST /api/emergency` (`ADMIN_EMERGENCY_TOKEN`).
- Android wrapper sign-in plan (Custom Tab + App Link): `docs/MULTIUSER.md` §4.10.
- Delete account / export: `lib/db-scoped/account.ts`, `app/account-actions.ts`, `/restore-account`, `/delete-account`,
  `/api/my-data`; purge in the daily cron.
- **Tests:** `test:auth`, `test:auth-flow`, `test:otp`, `test:google-signin`, `test:google-fedcm`, `test:delete-account`.

## Spaces, sharing, live sync
- Spaces `lib/spaces.ts`; UI `components/app/spaces/` (`look.ts` icons / gradients / `personPhoto`, `tile.tsx`,
  `identity.tsx`, switch moment `moment.tsx`); actions `app/space-actions.ts`; `/join/[token]`; `/api/space-photo`.
- Live sync: every scoped write bumps the space revision (`lib/db-scoped/feed.ts`, `changes.ts` → `changesSince`);
  `lib/realtime/` publishes `{ rev, by }` to Ably (fake transport in tests, polling without `ABLY_API_KEY`); client
  `components/app/live-sync.tsx` + `store.applyChanges`; conflicts via `base` revisions (`lib/conflict.ts`).
- **Tests:** `test:feed`, `test:live`.

## Home
- Layout + widgets + presets `lib/home-layout.ts`; numbers `lib/home-widgets.ts`; grid + Customise `home-grid.tsx`;
  `home-extra.tsx`; view `home-view.tsx` (carousel `StackHeight`, loop pager `pagerRelease({ loop })`, suggestions
  auto-turn `useAutoAdvance`). Layout per user per space in `user_pref`. Widget `nextshop` (supermarket).
- AI wording: `lib/home-ai.ts` (`normalizeMoney`), cache keys `home:ai:v2:…` / `home:look:v2:…` (`HOME_AI_CACHE_V`).
- **Tests:** `test:home`, `test:sug`.

## Products (links, prices, tracking)
- Link → product `lib/extract.ts` (`extractFromUrl` ladder: direct → `lib/store-apis.ts` Woo/Shopify → Cloudflare
  Worker `scripts/cf-worker/`); probe `/api/debug/blocked`. Prices / alerts `lib/tracker.ts`; Check now
  `app/check-actions.ts` → `checkItemOnServer`. Short names `lib/short-name.ts` + backfill
  `lib/db-scoped/short-names.ts` (cron). Pictures `lib/product-pictures.ts`, `picture-*.ts`.
- **Tests:** `npm run test` (extract), `test:blocked`, `test:check-now`, `test:short-name`, `test:pictures`,
  `test:picture-style`, `test:ship`, `test:budget`, `test:receipt*`, `test:import-vat`.

## Supermarket
- List = `items.list` (`products` | `supermarket`; `loadItems` defaults to Products, `listIs()`; `test:scope` guards it).
- Client-safe `lib/grocery/`: `sections.ts` (16 keys, default order), `dictionary.ts` + `normalize.ts` + `classify.ts`
  (`brandOf`), `parse.ts` (parseLine, splitList), `search.ts`, `staples.ts`, `holidays.ts`, `order.ts` (learned walking
  order), `trip.ts` (replay, TripOp), `merge.ts` (`mergeAdd`; note cleanup in the daily cron), `brands.ts`,
  `routines.ts`, `trip-api.ts`. Server `grocery/classify-server.ts` (Open Food Facts, batched AI).
- Data `lib/db-scoped/`: `grocery.ts` (stores, order, add + merge, history, suggestions, staples, templates,
  `learningOf`, `learnedFacts`), `trips.ts` (trip + trip_check), `trip-sync.ts` (outbox merge), `brands.ts` (`brand_buy`).
- Actions `app/supermarket-actions.ts`; routes `/api/grocery/search`, `/api/grocery/voice`. Client outbox
  `lib/shop-outbox.ts`, `lib/trip-client.ts` (SPEC "Trip API").
- Screens `components/app/supermarket/`: `view.tsx` (the tab; computer `desk.tsx`), `row.tsx` (swipe delete +
  `restoreSmItem`, quick quantity, inline rename), `add-screen.tsx` (+ `Voice`), `added.tsx` (add feedback),
  `item-sheet.tsx`, `store-picker.tsx`, `store-mode.tsx`, `trip.tsx` (Home card + trip bar), `lists.tsx` (templates +
  past trips), `data.ts` (`useSmHome`). Settings `settings/supermarket.tsx`. History: Insights → History → Supermarket
  (`HistorySource`, `SmHistory`).
- Senders `eveningDrafts` / `autoStaples` / `liveAdd` (kinds `draft`, `trip_add`) — see Notifications.
- **Tests:** `test:grocery`, `test:staples`, `test:add`, `test:trips`, `test:trip-api`, `test:templates`,
  `test:shop-offline`, `test:brands`, `test:voice`. Demo data `scripts/lib/seed-sm.mjs`; parity `scripts/parity-r18.mjs`;
  rehearsals `scripts/r18*-rehearsal.*` (newest = the one for the last DB change).

## Camera, barcode, voice
- Capture `supermarket/capture.tsx` (`smPhoto`: product / receipt / list / unsure in one AI call); hook
  `components/app/use-camera.ts`; lens + scan tuning `lib/camera.ts` (`pickMainCamera`, `tuneForScan`, `focusAt`);
  scanner core `lib/barcode-scan.ts`; decoder `lib/barcode-reader.ts` (zxing wasm in `public/vendor/`); admin
  `/debug/camera` (`supermarket/debug-camera.tsx`).
- Voice: recorder `lib/grocery/recorder.ts` → `/api/grocery/voice` (mock body `mockvoice:<words>`); microphone allowed
  in Permissions-Policy (headers).
- **Tests:** `test:capture`, `test:barcode`, `test:voice`, `test:headers`.

## AI & assistant
- Every model call goes through `lib/ai-gate.ts` with `use` (feature, user, space): switch, 40/day quota, redaction,
  `ai_usage`. Models / fallback `lib/ai.ts`; assistant `lib/assistant*.ts`; list prices `lib/ai-prices.ts`.
- **Tests:** `test:ai-quota`, `test:actions`, `test:assistant-context`, `test:memory`.

## Notifications & push
- Every sender calls `notify()` (`lib/notify/enqueue.ts`: actor excluded, one row per group key); timing
  `lib/notify/schedule.ts` (`pushTime()`: quiet hours, Thursday week, activity ≤ 1/h/space); senders
  `lib/notify/senders.ts`; dispatcher `lib/notify/dispatch.ts` (`runDispatcher`, `sendTestPush`) +
  `/api/cron/notify` (GitHub `.github/workflows/hourly.yml`); opportunistic `lib/notify/maybe.ts` (`maybeDispatch`,
  5-min lease; `NOTIFY_AUTO_DISPATCH=0` on seeded test servers); push `lib/notify/push.ts` + `public/sw.js`; texts
  `lib/notify/text.ts` (i18n `nt`); data `lib/db-scoped/notify.ts`; client `lib/notify/client.ts`.
- UI `components/notify/` (inbox popover / `/inbox`), actions `app/notify-actions.ts`, Settings
  `settings/notifications.tsx`; routes `/api/notify/{subscribe,received,open}`. Demo rows `scripts/lib/seed-notify.mjs`.
- **Tests:** `test:notify`, `test:inbox`, `test:push`, `test:weekly`.

## Settings & profile
- `components/app/settings/` (shell = desktop dialog / phone pages; `you.tsx`, `account.tsx`, `space.tsx`,
  `profile.tsx`), deep links `/settings/[[...section]]`. Photo `/api/me-photo` + `lib/space-photo.ts`; name
  `saveMyName`; `me` via `myProfile` (`lib/db-scoped/account.ts`); avatars `components/app/person-photo.tsx`.
- **Tests:** `test:settings`.

## Admin, presence, activity
- `/admin/[[...path]]` + `components/admin/` (shell `admin-app.tsx`, a file per tab, `admin.css`; classes `ops-*`,
  never `ad-*`), actions `app/admin-actions.ts` (behind `admin()`), reads `lib/db-scoped/admin.ts` +
  `admin-health.ts`; Push tab `components/admin/push.tsx`.
- Presence `lib/presence-keys.ts`, `lib/db-scoped/presence.ts`, `/api/presence`, beat
  `components/app/presence-beat.tsx`; activity `lib/activity.ts` (`noteActivity`). Onboarding `/welcome`,
  `components/onboarding/`, `app/onboarding-actions.ts`, `lib/onboarding.ts`.
- **Tests:** `test:admin-access`, `test:admin-privacy`, `test:admin-live`, `test:admin-people`, `test:seed-admin`,
  `test:onboarding`, `test:adblock`.

## Errors & reports
- Error log `lib/errors/`, `instrumentation.ts` (`onRequestError`), `/api/errors`, `/admin/errors`,
  `node scripts/errors.mjs`. Crash screen `components/crash.tsx` (`app/error.tsx`, `app/global-error.tsx`); client
  capture `installClientErrorCapture` (`providers.tsx`). User reports `node scripts/reports.mjs` / GitHub issues `from-app`.
- **Tests:** `test:errors`, `test:reports`, `test:status`.

## Tests, servers, data — tooling
- Gate: `npm run -s check` (one OK line or the errors). Local server `bash scripts/serve.sh [--build]`; seeded smoke
  server `bash scripts/serve-smoke.sh [--build]` then `SMOKE_WRITE=1 npm run smoke` (`SMOKE_MOBILE=1` phone).
- Helpers: `scripts/lib/test-app.mjs` (browser with data), `scripts/lib/actions.mjs` (actions over HTTP),
  `scripts/lib/phone.mjs` (`PHONE`, `PHONE_UA`), `scripts/lib/admin-walk.mjs`. Seeds `scripts/seed-local.mjs`,
  `scripts/lib/seed-*.mjs`. Prod snapshot `scripts/db-snapshot.mjs`; restore `scripts/db-restore-*.mjs`.
- The cloud sandbox can't reach vercel.app, Gemini or Telegram — prod checks run in `.github/workflows/smoke.yml`;
  prod admin probe `scripts/probe-admin.mjs`.
- Retired (code kept or removed): Telegram (`lib/telegram.ts`), guest app, browser extension (removed R17).
