# Round 17 brief (from Tal, 2026-10-08) — Session 1: bugs from Tal's use, cut-off text, blocked stores, short names, the technical base of the product layer — source of truth

Source: Tal's voice notes after R16 + the polish pass (2026-10-08), his answers in the planning chat (2026-10-07/08),
`docs/POLISH-AUDIT.md` "## Fixes" (open items), `docs/ROUND16.md` "## Open". Where this brief is more specific than
`docs/MULTIUSER.md` / `docs/STRATEGY.md`, this brief wins.

Why: the family comes in after price comparison (R19) and gets a real app (R20). Before building the product layer
(admin panel, onboarding, push), the app Tal uses every day must stop feeling broken in small ways (flashes, cut-off
text, widgets that don't fill), and the plumbing that has no screens (password removal, AI quota, privacy, delete
account, blocked stores) is done once, properly.

## Roadmap (Tal 2026-10-07/08, replaces R16's)
- **R17 Session 1 (this brief)** — no mockups needed: Parts 0, A, B, C, D, E, F below.
- **R17 Session 2** — admin panel (users, usage without content, AI usage + per-user quota editing, all reports, the C2
  error log, system health) + onboarding (4 questions + "install the app" + notification permission at the end).
  Needs mockups first (planner, separate chat; onboarding in 2–3 directions for Tal to choose).
- **R17 Session 3** — web push + in-app inbox with automatic timing (see "Notifications — decisions" below). Mockups
  for the inbox and the permission moment.
- R18 supermarket mode v2 → R19 price comparison → **R20** real apps: Android via Google Play (closed testing with the
  family = Google's 12 testers / 14 days), iPhone via Add to Home Screen + guide; QR desktop login → family comes in.

### Notifications — decisions (for Session 3; Session 1 only removes the settings section, D3)
- No per-kind settings in the app (Tal: "the user doesn't even know which settings he needs"). One switch: on / off.
  Fine-grained control comes from Android's notification channels in R20 (system settings), as leading apps do.
- Kinds at launch: shared-space activity, someone shopping now / finished, weekly summary, price drop / target,
  delivery today / delivered, budget 80 % / 100 %.
- Timing is automatic: urgent kinds (someone shopping now, delivery today) go at once; the rest are batched and sent at
  the hour this person is usually active (learned from their own app opens); never at night local time. Shared-space
  activity is one grouped message ("Liraz added 5 items"), at most one per hour per space.
- Price checks hourly via GitHub Actions (free), not Vercel cron. No email channel.

## How to run (Session 1)
- Branch **`round17`** from `main`. Commit per item `R17.<part><k>: …`. Push the branch after each part.
- Unattended: never stop to ask, decisions go to "## Open". Don't touch power settings. Read open reports first
  (`node scripts/reports.mjs`) and the error log (`node scripts/errors.mjs`).
- Use plan mode for C (blocked stores), E1 (password removal) and E4 (delete account); ≤ 10-line plan before editing.
- **Merging:** DB changes additive only (new tables, new nullable/defaulted columns). End with `git merge --ff-only
  round17` into `main` + push **when everything is green**, after the migration was rehearsed on a copy of
  `snapshots/prod-2026-10-06-post.db` (idempotent: second run = no-op; row counts equal; Tal's To buy / On the way /
  History counts unchanged). If anything isn't additive, don't merge — say so in Open.
- Verify on phone (360/390) and desktop (1366, plus 1280×720), light + dark, Graphite + Plum, English + Hebrew, reduced
  motion. Touch, keyboard. Visual items that change motion: measure first, numbers before/after in Open.
- New dependencies: one-line reason in Open, exact pinned version (`docs/SECURITY.md` §11).
- Skills in `.claude/skills/` (emil-design-eng, mobile-native, break-ui, …) are the bar for anything visual.

## Before you run (Tal) — Cloudflare Worker for blocked stores (≈ 10 minutes, optional)
Without it everything works; blocked stores just fall back to the other methods in Part C.
1. dash.cloudflare.com → Sign up (free, no credit card).
2. Workers & Pages → Create → "Hello World" worker → name it `nexus-fetch` → Deploy. (The builder writes the real code;
   you paste it in step 4.)
3. Make a secret: any long random string (e.g. from a password manager, 40+ characters). Worker → Settings → Variables
   and Secrets → add `FETCH_SECRET` = that string (type Secret).
4. After Session 1 writes `scripts/cf-worker/fetch-worker.js`: Worker → Edit code → paste it → Deploy.
5. Vercel → Project → Settings → Environment Variables (Production): `CF_FETCH_URL` = the worker's address
   (`https://nexus-fetch.<you>.workers.dev`), `CF_FETCH_SECRET` = the same string. Same two lines in `.env.local`.
Free tier: 100 000 requests/day — far beyond our use.

---

## Part 0 — start
### 0.1 [x] Read and record
Read `docs/POLISH-AUDIT.md` "## Fixes" (open items: Graphite chip cut at 360, help-worthy notes), `docs/ROUND16.md`
"## Open" (hotfix sections), open reports, the error log (`viewport`, `google_fedcm`, `extract · blocked` entries).
Record anything relevant in Open.

### 0.2 [x] Help file: split it
`src/lib/help/nexus-help.md` is at 24,992 of 25,000 bytes; R16 hotfixes and the polish fixes couldn't be documented.
Split it into topic files (e.g. `help/topics/*.md`: getting started, items & links, lists & spaces, shopping, money &
budget, settings & account, privacy) loaded by the same help route/assistant, each with its own limit; `test:help`
checks every SPEC feature appears in one topic and every file is under its limit. Then add the missing lines (Google
sign-in sheet + "Use another Google account", daily opening, everything in POLISH-AUDIT "Fixes" marked help-worthy).

### 0.3 [x] Test debt
- A reseeded smoke DB (fresh each run, not the grown 362-item `local.db` copy) so "partial move splits the item" stops
  flaking; reuse `scripts/seed-worst.mjs` for the worst-case space.
- Prod smoke "real data" mode: skip the demo-id steps (Needs-you count, month view, calendar arrival, demo-id layouts,
  demo project summary) when not on the seed; prod smoke must be fully green after this round's deploy.
- The two machine-load timing checks ("camera opens fast", boot-screen frame trace): looser budget on CI as R14 noted,
  or run them only where they're stable — decide, say why.
- GitHub Actions: bump `actions/checkout`, `actions/setup-node`, `gitleaks/gitleaks-action` off Node 20 (deprecation
  warning on every run); pin `runs-on` so the 2026-10-19 `ubuntu-latest` → Ubuntu 26 move doesn't surprise us.

---

## Part A — Tal's bugs (Home, Settings, spaces)

### A1. [x] "Nexus suggests" border animation ends cut off
Tal: the animation around the card stops abruptly. Since polish #17 it plays one cycle and pauses at the end.
Expected: one cycle on mount that **fades out softly** (opacity to 0 over ≈ 600 ms, eased) instead of freezing on a
frame; again (same fade-out) while the AI works. The cycle itself must be seamless (no jump at the loop seam while it
runs during AI work). Same rule for the paste capsule's `flow-border`. Reduced motion: none.
Acceptance: frame trace of the end of the cycle shows a continuous opacity ramp, no single-frame change > 0.1 opacity.

### A2. [x] Widgets at 2× height don't fill (desktop + phone)
Tal: "Nexus suggests" at 2× only makes the frame taller — a big empty area, no more suggestions. Expected: every
widget at 2× uses the height: list widgets show more rows (suggestions: more cards / a second row; Needs you, Next
delivery, Most bought, Price drops, Budget by category: more rows), number widgets grow a chart or breakdown, never
an empty frame. Same for phone Half/Full × 2×.
Acceptance: `test:home` / `test:polish` check per widget × size (S/M/L × 1×/2×, phone Half/Full × 1×/2×) on the seeded
and the worst-case data: content fills ≥ 70 % of the widget's inner height when there's enough data, or the widget
shows its empty state centred; nothing overflows or clips. Parity PNGs of every widget at 2× (≤ 10 files).

### A3. [x] Settings show Home for a moment before opening
Cause (found while planning): `SettingsShell` (`components/app/settings/shell.tsx`) opens only after `loading` is false,
so `/settings…` renders Home first and the dialog after the data arrives; the in-app path has a similar gap.
Expected: tapping Settings (any entry: avatar menu, palette, deep link, `/settings/<section>`) shows the Settings
shell in the same frame — sections that need data show their own skeleton. Never a frame of Home behind a deep link
on phone (phone settings are full-screen pages).
Acceptance: Playwright frame capture from the tap: first painted frame after the tap already contains the settings
shell; on a cold `/settings/display` load no Home content is painted (phone + desktop).

### A4. [x] Space settings: same flash, and Back goes to the wrong place
Same as A3 when opening Space settings from the space switcher. Back/close: **opened from the switcher → back to
where you were (Home)**; opened from Settings → back to Settings. Works with ✕, Esc, Android Back, swipe-back.
Acceptance: smoke covers both entry points × all close methods.

### A5. [x] Account & security (phone): slow load, layout jump, cut-off tiles
Tal: entering Account & security on the phone shows something, it disappears, then a different layout loads; the
devices list takes long; the three tiles at the bottom (activity & recovery, my reports, invite codes) have their
text cut off. Expected: one layout from the first frame (skeleton rows in the final positions, no swap), devices
load fast (measure the query; one round trip; render the current device instantly from the session), tiles show
their full labels at 360 (wrap to 2 lines or stack — never cut).
Acceptance: no layout shift (CLS 0 for that page in Playwright), devices list < 500 ms warm on the local prod build.

### A6. [x] Cut-off text, buttons and frames — everywhere, and a guard so it stays fixed
Tal saw cut-off text in Settings → Display, the Account tiles, and elsewhere (POLISH-AUDIT: Graphite chip at 360).
Sweep **every screen, dialog, sheet, menu and toast** on phone 360/390 and desktop 1366/1280×720, en + he, light +
dark, seeded + worst-case data. Fix every element whose text is clipped without an intended ellipsis, any button
whose label doesn't fit, any frame cut by its container.
Guard (new, in `guards.yml`): `test:clip` walks all routes/sections/sheets and fails on any text element where
`scrollWidth > clientWidth + 1` or `scrollHeight > clientHeight + 1` unless it has an intended truncation
(`text-overflow: ellipsis` or `-webkit-line-clamp`) **and** a way to read the full text (title / expandable); numbers
never truncate (polish #23). Report = screen + selector + text.

### A7. [x] Space switch: a fixed, noticeable moment
Tal: the switch should take the same time every time, even when the personal space loads faster, so the user feels
"I moved space". Measure on prod the slowest switch (p95 over 20 switches each way, personal ↔ Jacoby Home, warm and
first-of-session) + a margin → fixed total between **1.5 s and 2.0 s** (write the measurement and the chosen value in
Open). The moment (R16 D4: tile flies, colour wash, name + faces) is choreographed to fill that time; data loads
underneath; if it isn't ready at the end, hold with the subtle progress (max 3 s, then skeletons). Interruptible by a
tap? **No** — Tal wants the moment noticed; Esc/Back still cancel. Reduced motion: fixed 600 ms cross-fade with the name.
Acceptance: 20 switches → total duration within ± 50 ms of the chosen value, ≥ 55 fps.

---

## Part B — names and calendar

### B1. [x] Short names for long product titles (AliExpress first)
Tal's example: "Two Pieces Car Perfume Clip Flower Air Outlet Decoration Bright Peach Blossom Cherry Blossom Car Air
Refresher with Fresh Color AliExpress 34" → what it is: a flower-shaped car air-vent perfume clip.
- New nullable column `full_title` on items (additive). On extract, when the title is long (> 50 chars) or noisy:
  keep the original in `full_title`, store a **short name** in `title` (≤ 40 chars, the product's language — Hebrew
  stays Hebrew, English stays English; keep brand/model if present, drop store names, counts like "Two Pieces" go to
  qty when clear, marketing words, colour lists, repeats).
- Rules first (strip store suffix incl. "AliExpress 34" without a dash — today's regex only strips "- AliExpress 34",
  `extract.ts:356`; dedupe repeated words; drop known filler), then the AI (one call, through the quota in E2) for the
  short name. No AI / over quota → rules-only result.
- Item sheet: the short name is the editable title; the full name shows under it (muted, 2 lines, expandable), with
  "Use full name". Search matches both.
- **Existing items (Tal: 4א):** one-time backfill for items whose title > 50 chars: original → `full_title`, short
  name → `title`. Batched within the AI quota (rules-only for the rest, retried next day by the existing cron). Never
  touch an item the user renamed (title edited after creation — check the item's history/updated fields; if unknown,
  skip items whose title differs from the extracted one). Log counts in Open.
Acceptance: unit tests with 20 real long titles (AliExpress, Amazon, Temu, Hebrew stores) → short names a human would
write; rehearsal shows the backfill only fills `full_title` and changes `title` for long ones.

### B2. [x] Google Calendar doesn't get the events
Tal connected it (Settings → Calendar → Google) and nothing appears. Today it's an ICS subscription
(`/api/cal/<token>.ics`, R14 C2) — Google fetches it from its own servers, every ~12–24 h (Google's schedule).
Find the actual cause first, write it in Open:
- Does the feed answer Google's fetcher? Check prod logs for `Google-Calendar-Importer` requests and their status;
  Vercel firewall / bot protection, `proxy.ts`, the per-IP rate limit (`calendar-server.ts rateLimited` — Google's
  fetchers share IPs), redirects, `content-type`.
- Is the feed empty for Tal? (only `ordered` items with an `eta`, ±window, kinds on.) If the useful events are
  elsewhere (reorder dates, "bought" days), say so.
- Validate the ICS (RFC 5545: `PRODID`, `DTSTAMP`, `UID`, all-day `VALUE=DATE`, CRLF, folding) with an external
  validator library in a test.
- The Google "subscribe" link (`googleSubscribeUrl`): `cid=` with `webcal://` vs `https://` — check what Google accepts today.
Fix what's broken. In Settings → Calendar, say plainly: "Google updates subscribed calendars a few times a day".
**Later (not now, Tal 2b):** research a faster, reliable sync (Google Calendar API with an extra permission, or
another way) — write a short comparison in Open for the planner.

---

## Part C — blocked stores (Tal: "any way, as long as the user installs nothing")

Today: `extract.ts` fetches from Vercel; stores behind Cloudflare/Akamai refuse Vercel's IPs (`cwc.co.il` ×3 in the
error log). The planner fetched Tal's cwc link from a non-Vercel server with no block: title, ₪999, image, and the
price is in `product:price:amount` (which `parseHtml` already reads). So the page is fine — the IP is the problem.

### C1. [x] Measure
`scripts/blocked-probe.mjs`: for every store host in the error log + a list of ~30 Israeli and global stores
(cwc.co.il, ksp.co.il, ivory.co.il, bug.co.il, zap.co.il, Shufersal, Rami Levy, IKEA IL, Amazon, AliExpress, Temu,
eBay, Shein, …) fetch one product page through each method below **from Vercel** (a debug route, admin-only, like
`/api/debug/extract`) and record: status, blocked y/n, fields found, ms. Table in Open, before and after.

### C2. [x] A ladder of methods (server-side only, free)
Try in order, stop at the first that yields title + price (or title + image):
1. Direct (today).
2. **Platform APIs** by detection or a per-host cache of what worked: WooCommerce Store API
   (`/wp-json/wc/store/v1/products?slug=<slug>`), Shopify (`<product-url>.json` / `.js`), Magento/others if cheap.
   These are public JSON endpoints the store serves to its own front end.
3. **Cloudflare Worker** fetch (`CF_FETCH_URL` + `CF_FETCH_SECRET`, see "Before you run"): a tiny worker that fetches
   the URL server-side and returns the HTML; requires the secret header, allows only http(s), blocks private
   ranges, caps size/time, no cookies forwarded. Code in `scripts/cf-worker/fetch-worker.js` + README for Tal.
   Without the env vars this step is skipped.
4. The existing name-based fallbacks (search by title / barcode) if a title was found but no price.
5. Still nothing → the item is saved with what we have, marked "Store blocks automatic reading — add the price by
   hand", no error toast.
All methods go through `safeFetch` rules (SSRF guard) on our side; per-host memory of the winning method (kv, 7 days)
so we don't repeat failed steps; the tracker (price checks) uses the same ladder.
Acceptance: `cwc.co.il` (Tal's link in the notes below) returns title + price + image on prod; the probe table shows
the success rate before/after; unit tests for the WooCommerce/Shopify parsers with saved fixtures.

Tal's test link: `https://www.cwc.co.il/product/%d7%9e%d7%9b%d7%a9%d7%99%d7%a8-%d7%9c%d7%a0%d7%99%d7%a7%d7%95%d7%99-%d7%9b%d7%aa%d7%9e%d7%99%d7%9d-%d7%9e%d7%a1%d7%a4%d7%95%d7%aa-%d7%a2%d7%9d-%d7%a7%d7%99%d7%98%d7%95%d7%a8-y100-steam-%d7%99%d7%95/`
(expected: UWANT Y100 steam sofa cleaner, ₪999, ILS).

---

## Part D — settings clean-up

### D1. [x] (merged into A3/A4/A5/A6)

### D2. [x] Display section: cut-off and tidy
Settings → Display: every chip and label fits at 360 en + he (Graphite chip included); covered by A6's guard.

### D3. [x] Remove the Notifications section
Tal: the user shouldn't manage notification types. Remove the R16 "Notifications" section (desktop + phone, deep link
`/settings/notifications` → Account). Keep the behaviour the toggles controlled at its default (on). Add one row in
Account: "Notifications — On/Off" (in-app bell + future push), off = nothing is sent, the bell still collects. Palette
entry updated. Note in Open which toggles were removed and what they defaulted to.

---

## Part E — technical base of the product layer (no new screens beyond small settings rows)

### E1. [x] Remove the password sign-in
Today a password path still exists (`/api/login`, `proxy.ts`, `lib/auth/config.ts`, `NEXUS_PASSWORD`). Remove it for
users. Keep an **admin-only emergency sign-in** (Tal 20ב): enabled only when env `ADMIN_EMERGENCY_TOKEN` is set,
a POST with that token + an email in `ADMIN_EMAILS` creates a normal session for that admin, rate-limited hard (3 / h
/ IP), logged to the security log, never linked from the UI. Remove the old guest tables + `/g` routes (R15 retired
them) **only** if the migration rule allows it — dropping tables isn't additive, so: stop reading/writing them, leave
the tables, list them in Open for a later cleanup round. Delete `public/nexus-extension.zip`. Smoke/tests that used the
password move to a test-only sign-in helper (only when `NODE_ENV=test` or a CI secret).
Acceptance: `test:auth`, `test:auth-flow` green; `/api/login` → 404/410; no password field anywhere; the emergency
path works in a test and is off without the env var. SECURITY.md updated.

### E2. [x] AI quota + privacy guard
One function every model call goes through (`lib/ai.ts` `generateJson` / `generateText` are the entry points):
- checks the user's AI switch (Settings → Assistant & AI, "AI on/off") and the **daily quota: 40 calls/user/day**
  (Tal 17א), admin unlimited, per-user override stored for the Session 2 admin panel (field + server action now, UI
  in Session 2);
- strips names, emails, space and member names from prompt context (and anything that looks like a phone number);
- records `ai_usage` (user, space, feature, provider/model, tokens if known, ok/fail, ms) — new table;
- over quota / provider down → the rules-only path with a quiet note ("AI is resting until tomorrow").
Counts: assistant message = 1, receipt read = 1, Home suggestions phrasing = 1/day, B1 short name = 1 per item
(backfill: system budget, not the user's quota).
Acceptance: unit tests (quota boundary, admin bypass, override, redaction of a prompt with names/emails), every model
call site goes through it (a static guard like `test:authz-coverage`).

### E3. [x] Privacy and terms pages
`/privacy` and `/terms` (en + he), from `MULTIUSER.md` §4.9 + Israeli Privacy Protection Law (incl. Amendment 13)
notice items: who runs it (Tal, contact = a dedicated address — **placeholder `privacy@…` until Tal creates it**, in
Open), what's collected and why, Google sign-in data (name, email, picture), the Google sign-in script on the login
page (FedCM), AI providers + the free-tier caveat (prompts may be used to improve models), processors (Vercel, Turso,
Vercel Blob, Resend, Ably, Cloudflare if C2 step 3 is on), the error log (what it keeps, 30-day retention), rights
(access, correction, deletion), retention, deletion process (E4), no ads/analytics cookies. Plain language, short.
Linked from the login footer, Settings → Account, and the app's About. Not legal advice — a line in Open for Tal to
get it reviewed before the public launch.

### E4. [x] Delete account + export
Settings → Account → "Delete account" (a small flow in the existing kit, no new board): what will be deleted, typed
confirmation, then: sign out everywhere, account hidden at once, **7 days to undo** (sign in again → "Restore your
account?"), then a purge job deletes the personal space + its blobs + the user row and sessions. In shared spaces the
user's items stay, attributed to "Former member"; a sole owner of a shared space with other members must transfer or
delete it first (the flow says so and links there). A public page `/delete-account` explains how (Google Play requires
a web link). Export: "Download my data" = JSON + Excel of the spaces the user owns + their own chats/memory (reuse the
existing export, scoped).
Acceptance: `test:delete-account` (request → hidden → restore within 7 days; request → purge after 7 days with a
fake clock → no rows left for that user except "Former member" attributions; sole-owner block), export contains only
the user's data (tenancy test).

### E5. [x] Error-log hygiene
Retention 30 days for the error log and `viewport` diagnostics (purge in the daily cron); `/admin/errors` groups the
new kinds (`viewport`, `google_fedcm`, `extract · blocked` by host). If C2 fixes a host, its blocked entries get
marked fixed automatically.

---

## Part F — guards and docs (end of Session 1)
### F1. [x] Guards
`test:clip` (A6), `test:polish` extended (A1, A2, A3 frame check), `test:delete-account`, `test:ai-quota`,
`test:blocked` (parsers + ladder with fixtures; no network in CI) in `guards.yml`. Prod smoke green in real-data mode.
### F2. [x] Docs
`SPEC.md` Round 17 section (edit, don't append twice), help topics (0.2), `CLAUDE.md` map (help topics, AI gate,
fetch ladder, delete-account job), `ENVIRONMENT.md` (`CF_FETCH_URL`, `CF_FETCH_SECRET`, `ADMIN_EMERGENCY_TOKEN`, new
scripts/tests), `SECURITY.md` (password removal, emergency path, worker, AI redaction).

## Open

### Session 1 (2026-10-08)
- **0.1 — at start.** Open reports: 1 — Tal's complaint "the Nexus suggests border animation is cut off" (Home, phone
  384×784, Graphite dark, he) → A1. Its "Last 3 client errors" are 3 × the generic failure toast on `/settings/people`
  (19:08) — the same toast is in the error log (`client · toast`, 1×); with the `server · Error` below (07:47, a members
  query `… inner join … where … is null`) it points at Space settings → People failing to load once; not reproduced at
  start, watched in A4. Error log (10 open): `viewport · layout` /login 8× + 8× at 390×844 with `iw=1100 dm=browser
  mobile=no` (desktop DevTools emulation without a device-width meta pass — `mobile=no`, `dpr=1`: a desktop browser, not
  a phone; no action) and 1× `/` in the installed app (`dm=standalone`, `iw=980`, `ref=accounts.google.com` — the
  hotfix.1 self-heal case); `extract · blocked` cwc.co.il 3× (`title+gemini-url`) → Part C;
  `csp · connect-src` 2× and `csp · manifest-src` 2× (no blocked URI kept in the sample; see E5); `auth · google_fedcm skipped:unknown_reason` 1× and `auth · google_status
  403` 1× (hotfix.2–4 territory; E5 groups them). POLISH-AUDIT "Fixes" open items: the Graphite chip cut at 360 (→ D2/A6),
  4 help-worthy notes (→ 0.2), the two machine-sensitive smoke timing steps (→ 0.3), Tal's real-phone checklist (left
  to Tal; the Notifications-switch line there is moot after D3). R16 Open leftovers: the reseeded smoke DB + looser
  camera budget (→ 0.3), the prod smoke "real data" mode (→ 0.3), the viewport-guard smoke step that saw 3 documents
  locally (→ 0.3).
- **0.3 — test debt.** `scripts/serve-smoke.sh [--build]` serves the build on a **fresh `smoke.db` every run** (migrate →
  `seed-local` → `seed-worst`, mock AI); the smoke's DB reads default to it (one step still read the old
  `r16-smoke.db` and compared against a stale report row). On it "partial move splits the item" passes (desktop + phone).
  The fresh data exposed a race in the phone quick-actions step (a swipe right after a reload landed before the row's
  touch handlers) — the step now waits for the row and retries the swipe once (3/3 green). Prod smoke "real data" mode:
  `SMOKE_REAL=1` (default whenever BASE isn't localhost; set explicitly in `smoke.yml`) skips the 5 demo-shaped steps
  (Needs-you count, month view, calendar arrival, demo-id layouts, demo project summary) with a `SKIP` line.
  **Timing checks — decision:** both are MOBILE-only, so they never run in CI (prod smoke is desktop); they fail on
  this PC on `main` too. Strict budgets (camera 400/800 ms, boot ≤ 2 dropped frames) only with `SMOKE_TIMING=1` on a
  quiet machine; by default a loose budget (camera < 2.5 s / decoder < 3 s, boot ≤ 10 dropped) that still catches a
  multi-second stall. Why: a check that fails on unchanged code teaches everyone to ignore FAIL lines. Actions:
  `checkout` v7.0.1, `setup-node` v7.0.0, `upload-artifact` v7.0.1, `gitleaks-action` v3.0.0 (all node24, SHA-pinned,
  each release ≥ 2 weeks old except gitleaks v3 = its only node24 release), `runs-on: ubuntu-24.04` in both workflows.
  Smoke at this point (fresh DB, local build): desktop 79/80 + the DB-path step green when rerun alone; phone 92/93 +
  quick actions green 3/3 alone after the fix (full reruns at the end of the round).
- **A1:** the moving layer (`::before` of `.r13-sug` / `.flow-border`) now sits over a still copy of the same gradient on
  the element; at a cycle boundary with no AI work it keeps sliding while it fades to 0 (600 ms, `ease-in-out`, via
  `data-loop-rest`), then pauses invisibly; AI work fades it back in (300 ms) and resumes. The twinkle keeps resting at
  its start pose. `test:polish` A1: sampled per frame through the boundary — continuous ramp 1 → 0, largest single-frame
  change ≤ 0.1, paused after (both loops PASS). Tal's report (the only open one) is this item — mark it fixed after the
  deploy.
- **A2:** 2× widgets: Suggests lists the next (up to 3) suggestions under the current one; Left to buy → rows by list;
  Budget → the month's pace chart; On the way → the next 4 packages; Saved → where it came from; Pace → a taller chart;
  This week → up to 4 events a day (desktop) / 7 (phone); Noticed (phone) → all, stacked; vs last month → the two months
  as bars; Next delivery → the ones after it. Empty states are centred. Fixed on the way: Projects' amount ran past the
  card in narrow cells (now compacts via `FitMoney`), Needs' row overflowed an S card by 6 px (short action label under
  400 px container width), the Suggests pager ran out of a half-width phone card with many suggestions (`3 / 9` text
  under 260 px). Rule in `test:polish` A2 (320 checks: 17 widgets × S/M/L × 1×/2× desktop + half/full × 1×/2× phone, demo
  + 500-item space): no visible leaf outside its card; under 70 % fill fails when the widget has items it isn't showing
  (`data-more` > 0); widgets that show everything they have (e.g. 1 price drop) are listed as INFO (40). Parity:
  `docs/design/parity-r17/widgets-2x-*.png` (6).
- **A3 causes (two):** a cold `/settings/…` load streamed and painted Home before the shell opened in an effect after
  `loading`; and the phone's in-app paths (Me sheet → Settings, search → Settings) closed their sheet first and opened
  Settings 120 / 30 ms later, so Home showed in between. Now `/settings/[[...section]]` passes the section into the app's
  boot (store starts with Settings open); before hydration the server paints `BootFrame` (the shell's boxes, phone or
  desktop by CSS, skeleton rows — Radix portals and `matchMedia` don't exist on the server); the real shell replaces it
  without its entrance animation. Me sheet / search open Settings in the same frame. `test:polish` A3: per-frame sampling
  from document start on a cold `/settings/display` (phone + desktop) → 0 frames of Home without the shell; tap → the
  shell is in the next frame (phone from the Me sheet, desktop sidebar). On desktop the shell is a dialog, so Home is
  behind its scrim once loaded — never on its own.
- **A4:** `openSettings(section, "switcher")` remembers the origin; from the switcher, back from Space settings' first
  page closes Settings (✕/back, Esc, Android Back, edge swipe → Home); from Settings, back returns to the list (phone; on
  desktop Space sections are part of the one dialog). Found while testing: a surface opening in the same moment another
  closes (Me sheet → Space settings) raced the closing one's `history.back()` — about 1 in 5 Android Backs then left the
  page. `useBackClose` now holds new history entries until pending skipped pops land (400 ms safety). Smoke step
  "space settings: from the switcher …" desktop + phone (6/6 phone after the fix). The `/settings/people` failure toast
  in Tal's report (and the one `server · Error` members query at 07:47) was not investigated further — a single
  prod query failure with no repeat in the log; left open.
- **A5 causes:** the page rendered without the checkup block and with one empty device row, then swapped in the ring and
  N device rows when `getSecurityState` answered; that action made 5 parallel DB requests and then a 6th (the "was this
  you" acknowledgement) — two round trips to Turso from Vercel; the three tiles were a 3-column grid at 360 (≈ 100 px
  each). Now: one `db.batch` (one round trip; only unexpired sessions count as devices); the page shows its last answer
  from this device at once (localStorage `nexus.sec:<user>`, no activity log in it, cleared with the offline copy on
  logout) and refreshes in place; the first time, the checkup box and this device (from the browser's UA) are there
  from the first frame with skeleton rows for the others; the tiles stack one per line under 1024 px. Smoke (phone,
  local prod build, file DB): CLS 0 cold and warm, devices answer 7 ms warm, no tile text cut at 360. Not measured
  against Turso (this session doesn't touch prod) — the batch is the part that matters there.
- **A7 — chosen 1.8 s.** Not measured on prod: this session has no signed-in prod session to drive and doesn't touch
  prod. Local production build, seeded data (`node scripts/switch-timing.mjs 20`, 40 switches personal ↔ shared):
  data ready p50 111 ms, p95 228 ms, max 394 ms (first of the session); R16's local D4 run saw ~1.2 s data loads, and
  Turso from Vercel adds round trips — so the moment is set near the top of the range, 1800 ms, leaving ~1.5 s of
  margin over the slowest local load. Result: all 40 totals 1813–1850 ms (±50 ms of 1800), 60 fps median; reduced
  motion: fixed 600 ms cross-fade, 10/10 within 608–642 ms. A tap no longer ends it; Esc / Back do. The tile breathes once
  in the hold so the longer moment reads as one gesture. **Tal:** on prod,
  if a switch on the phone ever shows the progress line, raise `SWITCH_MS` (max 2000) in `spaces/moment.tsx`.
- **D3 — removed toggles and their defaults:** price drop (on, threshold 5 % — a threshold someone already saved stays
  in their alert prefs and the tracker keeps using it), shared-space activity toasts (on; the per-device
  `nexus.liveActivity` switch is gone), budget 80 % (on), delivery due/late (on), "A sale ends" (was a disabled "Soon"),
  the Where block (In the app / On the phone "Soon"). Now: Account → **Notifications On/Off** (`setNotificationsOn`,
  user_pref `pref:notify` = `{ on }`); Off stops what is *sent* today — the 80 % budget toast and the live activity
  toasts — and push later; the bell still collects. `/settings/notif` and `/settings/notifications` → Account; the
  palette's section entry went with the section. Help updated.
- **E2:** `lib/ai-gate.ts` + a required `use` on `generate` / `generateJson` / `generateText` / `generateTextStream` and
  the extract/categorize helpers — TypeScript is the static guard (a call without `use` doesn't compile), plus
  `test:ai-quota`'s scan that no file but `lib/ai.ts` talks to a model provider. The AI switch is the existing Settings →
  Assistant & AI choice ("Rules only" now means no AI anywhere: suggestions, assistant, links, receipts; labels say
  so). Quota 40 calls/person/day (Israel day), admin unlimited, override `ai:quota` (number / "unlimited") with
  `setAiQuota` / `getAiAllowance` (admin) for the Session 2 panel. System work (cron, picture backfill, debug, B1's
  backfill) is recorded but never counted. Every call through the gate counts 1 (fallback attempts inside one call
  don't); so adding a link costs 1–3 (read + categorize), an assistant message 1, a receipt read 1 (+1 retry when the
  first read is poor). Over quota / switched off: callers already fall back to rules (null = no AI); the assistant
  answers with a quiet note ("AI is resting until tomorrow…"). Privacy: the person's name, email, the space's and
  members' names/emails become `⟦P1⟧`/`⟦E1⟧` and are put back into the answer (streams hold back a split placeholder);
  phone-looking numbers become `⟦phone⟧` and never come back. New table `ai_usage` (migrate-r17, additive).
- **A6 / D2:** `npm run test:clip` (new; `scripts/test-clip.mjs` on a production build via `scripts/lib/test-app.mjs`) walks
  9 views, every Settings section (+ the phone list), the item sheet, the palette (desktop) and the Me sheet (phone) at
  360×740 / 390×844 / 1366×768 / 1280×720 × en/he × light/dark × the demo data and the 500-item space = 752 screens. It
  measures each text container's own glyph boxes (a DOM Range, so the invisible `::after` tap areas don't count),
  clips them by `overflow: hidden/clip` ancestors (scroll containers aren't cuts; a whole line out of view is a cut,
  a glyph poking past a tight line-height isn't) and fails on: a cut without ellipsis/line-clamp, a truncation with no
  way to read the whole text, any truncated number, text off the screen. First run (quick subset): 558 → grouped 330
  places. Fixes: one global helper (`lib/trunc-title.ts`) gives any ellipsized/clamped text a `title` with its full
  text on hover/focus (the guard dispatches the hover and checks); on touch, truncation is allowed inside rows/cards
  that open the item (`[data-item-card]`, `[data-item-row]`, `[data-opens]`); Settings rows wrap their controls under
  the text when they don't fit (Danger zone's Transfer / Delete ran off a 390 screen); Needs-you rows and Suggests'
  reason line expand on tap; To-buy group names, Orders store names (phones) and the import-VAT "split off" line wrap;
  Orders headers wrap their totals under the name; Spending tiles go compact once an amount can't fit (and the label
  wraps); project cards are marked as opening. Final full run: **752 screens, 0 cut text**. The Graphite chip at 360
  (POLISH-AUDIT) didn't show as cut in any run (the label wraps rather than clips in today's layout).
- **E1:** password sign-in removed (`/api/login` → 410, the `/login?admin=1` form and `&admin=1` re-auth links gone);
  admin emergency sign-in `POST /api/emergency` (see SECURITY.md §2). **Old guest tables left in place for a later
  cleanup round (not read or written any more): `members`, `grants`, `invites`** (+ the `items.added_by_member_id`
  column); `/g` and the guest actions/app are deleted, `/i/<token>` still shows the "ask for a new invite" notice
  without reading `invites`. `public/nexus-extension.zip` deleted. Tests: `test:auth` (emergency guard), `test:auth-flow`
  (410, no password field, wrong token / non-admin 401, token+admin → session that opens the app, security log, 3/h/IP →
  429), `test:headers` and the prod smoke sign in through the emergency path; local smoke/parity/perf scripts through
  the seeded session (`scripts/lib/sign-in.mjs`). **Tal (before the deploy — otherwise the prod smoke can only run its
  signed-out checks):** Vercel → `ADMIN_EMERGENCY_TOKEN` (40+ random chars) and `ADMIN_EMAILS` = your address; GitHub →
  repo secrets `SMOKE_ADMIN_TOKEN` (same token) and `SMOKE_ADMIN_EMAIL`; remove `APP_PASSWORD` from Vercel and the
  `NEXUS_PASSWORD` repo secret (unused now).
- **B1:** `lib/short-name.ts` (rules: store suffix incl. "AliExpress 34" with no dash — `extract.ts` too — store prefix
  ("Amazon.com:"), a leading pack count → quantity, filler words, colour lists, repeats, a clause break, ≤ 40 on a word
  boundary, the title's own language) + the add flow's existing categorize call now asks for a ≤ 40-char name and `qty`
  (no extra AI call per link); the AI's name is used only within the limits, else the rules'. New nullable column
  `items.full_title` (migrate-r17). Item sheet: the full name muted under the title (2 lines, tap to expand) + **Use full
  name**; search matches both; undo snapshots keep it. Backfill: daily cron step `short-names`, items with
  `length(title) > 50`, `full_title IS NULL` and a title that still equals the store's `raw_title` (renamed items and
  items with no store read are skipped); 30 AI names per run from the system budget (never a person's quota), the rest
  wait for the next run. `test:short-name`: 20 real titles (AliExpress, Amazon, Temu, Hebrew stores, IKEA) → rules
  output, plus the AI-limit rule. Backfill counts on the prod snapshot: see the migration rehearsal below.
- **B2 — cause (as far as this session can see):** (1) the feed was close to empty: on the 2026-10-06 prod snapshot
  Tal's data has 1 ordered item with an expected date (arriving 2026-10-07) and no reorder cadence yet (10 purchases,
  none repeated) — so after the 7th the feed had nothing to show; (2) on a phone the "Subscribe in Google Calendar"
  button opens Google's app, which can't subscribe to a URL at all (only calendar.google.com on a computer can); (3)
  Google refreshes subscribed calendars on its own schedule (hours to a day). Not the cause, checked: the route answers
  Google's user agent from here (404 for a bad token, no firewall page — Google's own IPs can't be reproduced from this
  PC, and Vercel's runtime logs for `Google-Calendar-Importer` weren't reachable from this session); the ICS passes the
  RFC 5545 checks in `test:ics` read back by `ical.js` (PRODID/VERSION, UID, UTC DTSTAMP, all-day VALUE=DATE, CRLF,
  ≤ 75-octet folding). Fixed: Settings → Calendar says how many events the feed holds right now (or why it's empty),
  says plainly "Google updates subscribed calendars a few times a day", and on phones explains the computer route
  (calendar.google.com → Other calendars → From URL); the feed's rate limit is per IP + feed (Google's shared fetcher
  IPs no longer count every subscriber together). `ical.js` pinned to 2.2.1 (was `^2.2.1`, dev only). The subscribe
  link keeps `cid=webcal://…` (what Google's desktop web accepts). **Useful events elsewhere:** "bought on" days and
  price-drop days aren't in the feed; for a household, upcoming deliveries (with ETAs) and reorder dates are the useful
  ones — the empty-feed line nudges toward adding ETAs.
- **B2 later — faster sync (for the planner):** (a) **Google Calendar API** with the `calendar.events` (or
  `calendar.app.created`) scope: Nexus writes events into a calendar it creates — instant, reliable, edits/deletes
  propagate at once; costs: an extra Google consent screen + OAuth verification for a sensitive scope (Google review,
  weeks), refresh-token storage, a sync job. `calendar.app.created` (only calendars the app made) is the least
  sensitive. (b) **Keep ICS, nudge Google**: no API exists to force a refresh; changing the feed URL forces a re-fetch
  but breaks the subscription — not usable. (c) **Apple/Outlook** already refresh more often (Apple honours
  `REFRESH-INTERVAL` ~hourly). Recommendation: (a) with `calendar.app.created`, opt-in per user, in a later round.
- **C1/C2:** the ladder lives in `lib/extract.ts` (`extractFromUrl` = direct → WooCommerce Store API → Shopify
  `product.js` → Cloudflare Worker; first rung with a name + a price/picture wins; per-host memory `fetch:win:<host>`, 7
  days, tried first; everything through `safeFetch`; the tracker, compare, picture and repair paths all call
  `extractFromUrl`, so they climb it too). Still refused → the item is saved as read, the source is marked `blocked`, a
  plain note (not an error toast) and the sheet say "Store blocks automatic reading — add the price by hand". A host
  that reads again marks its open `extract · blocked/fetch` log entries fixed (E5). Worker: `scripts/cf-worker/
  fetch-worker.js` + README (secret header, http(s) only, private/loopback/link-local refused, ≤ 5 checked redirects,
  2.5 MB, 9 s, no cookies). Probe: `/api/debug/blocked?url=` (admin) + `scripts/blocked-probe.mjs` (prints the table).
  **Measured from here, not from Vercel:** from this PC (a home IP) cwc.co.il's product page loads (title, ₪999, picture
  from `product:price:amount` / og tags) but its `/wp-json/wc/store/v1/` Store API answers a Cloudflare challenge (403) —
  so for cwc the platform-API rung won't help from Vercel either; **the Worker is the fix for cwc**. The before/after
  table must be run on prod after the deploy (`BASE=https://nexus-ashen-beta.vercel.app SMOKE_ADMIN_TOKEN=…
  SMOKE_ADMIN_EMAIL=… node scripts/blocked-probe.mjs`, once the Worker env vars are set); several of the ~30 URLs in the
  script are store home pages or placeholder product ids — swap in real product links before reading the numbers.
  Acceptance "cwc returns title + price + image on prod" therefore depends on Tal's Worker setup (see "Before you run");
  `test:blocked` covers the parsers, the cwc page as the Worker returns it, and the Worker's private-address guard.
- **E3:** `/privacy` and `/terms` in English + Hebrew (`lib/i18n/legal.ts`, rendered by `components/auth/legal-stub.tsx`):
  who runs it, what's kept and why, Google sign-in data + the GIS script on the login page, AI providers with the
  free-tier caveat and how to turn AI off, processors (Vercel, Turso, Resend, Ably, Google, Groq, OpenRouter,
  Cloudflare when the Worker is on), the error log (30 days), retention, rights (access/correction/deletion, the
  Privacy Protection Authority), the deletion process, essential cookies only. Linked from the login footer (already),
  Settings → Account and the Me sheet (the app has no separate About page). **Tal:** the contact is a placeholder
  (`privacy@…`, `PRIVACY_CONTACT` in `lib/i18n/legal.ts`) until you create the address; the text is not legal advice —
  have it reviewed before the public launch.
- **E4:** Settings → Account → **Download my data** (`/api/my-data?format=json|xlsx`: every space you own — its full
  backup — plus your own chats and memory; nothing from spaces you don't own) and **Delete account** (what goes, typed
  email, step-up when the sign-in is older than 10 minutes; refused with the list of shared spaces you alone own while
  they have other members). Then: `user.deletion_requested_at` (additive column), every session revoked, hidden from
  people lists/facepiles, `/delete-account?done=1`. Signing in within 7 days → `/restore-account` ("Restore your
  account?" / "No, sign out"). The daily cron purges after 7 days (personal spaces + blobs, shared spaces with nobody
  else, chats, memory, prefs, AI usage, security log, sign-in rows, the user; their reports keep the text without the
  user id); items they added to others' shared spaces stay and show a "?" chip "Added by Former member". Public
  `/delete-account` explains it (for Google Play). `test:delete-account` (block, hide, restore, 7-day purge with a fake
  clock, export tenancy) passes.
- **E5:** the daily cron deletes error-log rows not seen for 30 days (`viewport` diagnostics included; samples were
  already dropped at 30 days). `/admin/errors` groups viewport diagnostics, Google sign-in (`google_*`) and blocked stores
  per host into one collapsible line each (total count, entries). A host that reads again through the fetch ladder marks
  its open `extract · blocked/fetch/no_price/parse` entries fixed (C2). The CSP entries still have no blocked host in
  the sample (the CSP report intake keeps only the directive) — left as is; when one repeats, the browser's own report
  is the next step.
- **D2 (again, found in the final visual pass):** at 360 the Graphite chip was still cut — not clipped, *covered* by the
  Plum chip (the colour chips overflowed their half of the Colour/Language row). Colour and Language now stack on
  phones; `test:clip` also checks that no line of text is under a painted, non-fixed neighbour (transparent full-card
  tap buttons don't count).
- **Verification (2026-10-08, this PC, production build):** `npm run -s check` OK. Unit tests: all 34 in the CI list +
  `test:help` OK. `test:clip` 752 screens, 0 cut text. `test:polish` OK (after fixing a hydration mismatch it caught on
  Spending: compact amounts now switch only after hydration — Node and Chromium write compact Hebrew differently).
  `test:tenancy` 46/46, `test:errors`, `test:live`, `test:settings`, `test:headers` (emergency sign-in, CI-style),
  `test:google-signin`, `test:viewport`, `test:google-fedcm` (one focus check failed once, passed on the rerun),
  `test:auth-flow` OK. Smoke on a fresh seeded DB: desktop 81/81; phone 92/93 — "item sheet morph" fails about 2 in 7
  runs alone (a ~1 300 px page-scroll jump on open, seen only when the tapped card is a smoke-created item), recorded as
  a flake, not fixed. Space switch 1 813–1 850 ms over 40 switches. Visual pass (screenshots): Display at 360 he/Graphite
  and en/Plum dark, Account phone he dark (Notifications on by default) + the delete flow, Calendar phone, Privacy he,
  Home 1280×720 dark and 390 he Plum, the item sheet with a full title.
- **Migration rehearsal** (`node --env-file=.env.local scripts/r17-rehearsal.mjs --base origin/main`, copy of
  `snapshots/prod-2026-10-06-post.db`): new table `ai_usage`; new columns `items.full_title`, `user.deletion_requested_at`
  (both nullable); nothing dropped; row counts equal in all 39 tables; integrity ok; second run a no-op (whole-DB hash);
  To buy 8 / On the way 1 / History 10 unchanged; 499 ms. B1 backfill (rules only) on the copy: 5 items with a title over
  50 characters, 1 changed (its title still matched the store's original), 4 skipped as possibly renamed (their title
  differs from the store's read); only `title` / `full_title` changed; counts unchanged.
