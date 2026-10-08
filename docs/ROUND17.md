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
### 0.1 [ ] Read and record
Read `docs/POLISH-AUDIT.md` "## Fixes" (open items: Graphite chip cut at 360, help-worthy notes), `docs/ROUND16.md`
"## Open" (hotfix sections), open reports, the error log (`viewport`, `google_fedcm`, `extract · blocked` entries).
Record anything relevant in Open.

### 0.2 [ ] Help file: split it
`src/lib/help/nexus-help.md` is at 24,992 of 25,000 bytes; R16 hotfixes and the polish fixes couldn't be documented.
Split it into topic files (e.g. `help/topics/*.md`: getting started, items & links, lists & spaces, shopping, money &
budget, settings & account, privacy) loaded by the same help route/assistant, each with its own limit; `test:help`
checks every SPEC feature appears in one topic and every file is under its limit. Then add the missing lines (Google
sign-in sheet + "Use another Google account", daily opening, everything in POLISH-AUDIT "Fixes" marked help-worthy).

### 0.3 [ ] Test debt
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

### A1. [ ] "Nexus suggests" border animation ends cut off
Tal: the animation around the card stops abruptly. Since polish #17 it plays one cycle and pauses at the end.
Expected: one cycle on mount that **fades out softly** (opacity to 0 over ≈ 600 ms, eased) instead of freezing on a
frame; again (same fade-out) while the AI works. The cycle itself must be seamless (no jump at the loop seam while it
runs during AI work). Same rule for the paste capsule's `flow-border`. Reduced motion: none.
Acceptance: frame trace of the end of the cycle shows a continuous opacity ramp, no single-frame change > 0.1 opacity.

### A2. [ ] Widgets at 2× height don't fill (desktop + phone)
Tal: "Nexus suggests" at 2× only makes the frame taller — a big empty area, no more suggestions. Expected: every
widget at 2× uses the height: list widgets show more rows (suggestions: more cards / a second row; Needs you, Next
delivery, Most bought, Price drops, Budget by category: more rows), number widgets grow a chart or breakdown, never
an empty frame. Same for phone Half/Full × 2×.
Acceptance: `test:home` / `test:polish` check per widget × size (S/M/L × 1×/2×, phone Half/Full × 1×/2×) on the seeded
and the worst-case data: content fills ≥ 70 % of the widget's inner height when there's enough data, or the widget
shows its empty state centred; nothing overflows or clips. Parity PNGs of every widget at 2× (≤ 10 files).

### A3. [ ] Settings show Home for a moment before opening
Cause (found while planning): `SettingsShell` (`components/app/settings/shell.tsx`) opens only after `loading` is false,
so `/settings…` renders Home first and the dialog after the data arrives; the in-app path has a similar gap.
Expected: tapping Settings (any entry: avatar menu, palette, deep link, `/settings/<section>`) shows the Settings
shell in the same frame — sections that need data show their own skeleton. Never a frame of Home behind a deep link
on phone (phone settings are full-screen pages).
Acceptance: Playwright frame capture from the tap: first painted frame after the tap already contains the settings
shell; on a cold `/settings/display` load no Home content is painted (phone + desktop).

### A4. [ ] Space settings: same flash, and Back goes to the wrong place
Same as A3 when opening Space settings from the space switcher. Back/close: **opened from the switcher → back to
where you were (Home)**; opened from Settings → back to Settings. Works with ✕, Esc, Android Back, swipe-back.
Acceptance: smoke covers both entry points × all close methods.

### A5. [ ] Account & security (phone): slow load, layout jump, cut-off tiles
Tal: entering Account & security on the phone shows something, it disappears, then a different layout loads; the
devices list takes long; the three tiles at the bottom (activity & recovery, my reports, invite codes) have their
text cut off. Expected: one layout from the first frame (skeleton rows in the final positions, no swap), devices
load fast (measure the query; one round trip; render the current device instantly from the session), tiles show
their full labels at 360 (wrap to 2 lines or stack — never cut).
Acceptance: no layout shift (CLS 0 for that page in Playwright), devices list < 500 ms warm on the local prod build.

### A6. [ ] Cut-off text, buttons and frames — everywhere, and a guard so it stays fixed
Tal saw cut-off text in Settings → Display, the Account tiles, and elsewhere (POLISH-AUDIT: Graphite chip at 360).
Sweep **every screen, dialog, sheet, menu and toast** on phone 360/390 and desktop 1366/1280×720, en + he, light +
dark, seeded + worst-case data. Fix every element whose text is clipped without an intended ellipsis, any button
whose label doesn't fit, any frame cut by its container.
Guard (new, in `guards.yml`): `test:clip` walks all routes/sections/sheets and fails on any text element where
`scrollWidth > clientWidth + 1` or `scrollHeight > clientHeight + 1` unless it has an intended truncation
(`text-overflow: ellipsis` or `-webkit-line-clamp`) **and** a way to read the full text (title / expandable); numbers
never truncate (polish #23). Report = screen + selector + text.

### A7. [ ] Space switch: a fixed, noticeable moment
Tal: the switch should take the same time every time, even when the personal space loads faster, so the user feels
"I moved space". Measure on prod the slowest switch (p95 over 20 switches each way, personal ↔ Jacoby Home, warm and
first-of-session) + a margin → fixed total between **1.5 s and 2.0 s** (write the measurement and the chosen value in
Open). The moment (R16 D4: tile flies, colour wash, name + faces) is choreographed to fill that time; data loads
underneath; if it isn't ready at the end, hold with the subtle progress (max 3 s, then skeletons). Interruptible by a
tap? **No** — Tal wants the moment noticed; Esc/Back still cancel. Reduced motion: fixed 600 ms cross-fade with the name.
Acceptance: 20 switches → total duration within ± 50 ms of the chosen value, ≥ 55 fps.

---

## Part B — names and calendar

### B1. [ ] Short names for long product titles (AliExpress first)
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

### B2. [ ] Google Calendar doesn't get the events
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

### C1. [ ] Measure
`scripts/blocked-probe.mjs`: for every store host in the error log + a list of ~30 Israeli and global stores
(cwc.co.il, ksp.co.il, ivory.co.il, bug.co.il, zap.co.il, Shufersal, Rami Levy, IKEA IL, Amazon, AliExpress, Temu,
eBay, Shein, …) fetch one product page through each method below **from Vercel** (a debug route, admin-only, like
`/api/debug/extract`) and record: status, blocked y/n, fields found, ms. Table in Open, before and after.

### C2. [ ] A ladder of methods (server-side only, free)
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

### D1. [ ] (merged into A3/A4/A5/A6)

### D2. [ ] Display section: cut-off and tidy
Settings → Display: every chip and label fits at 360 en + he (Graphite chip included); covered by A6's guard.

### D3. [ ] Remove the Notifications section
Tal: the user shouldn't manage notification types. Remove the R16 "Notifications" section (desktop + phone, deep link
`/settings/notifications` → Account). Keep the behaviour the toggles controlled at its default (on). Add one row in
Account: "Notifications — On/Off" (in-app bell + future push), off = nothing is sent, the bell still collects. Palette
entry updated. Note in Open which toggles were removed and what they defaulted to.

---

## Part E — technical base of the product layer (no new screens beyond small settings rows)

### E1. [ ] Remove the password sign-in
Today a password path still exists (`/api/login`, `proxy.ts`, `lib/auth/config.ts`, `NEXUS_PASSWORD`). Remove it for
users. Keep an **admin-only emergency sign-in** (Tal 20ב): enabled only when env `ADMIN_EMERGENCY_TOKEN` is set,
a POST with that token + an email in `ADMIN_EMAILS` creates a normal session for that admin, rate-limited hard (3 / h
/ IP), logged to the security log, never linked from the UI. Remove the old guest tables + `/g` routes (R15 retired
them) **only** if the migration rule allows it — dropping tables isn't additive, so: stop reading/writing them, leave
the tables, list them in Open for a later cleanup round. Delete `public/nexus-extension.zip`. Smoke/tests that used the
password move to a test-only sign-in helper (only when `NODE_ENV=test` or a CI secret).
Acceptance: `test:auth`, `test:auth-flow` green; `/api/login` → 404/410; no password field anywhere; the emergency
path works in a test and is off without the env var. SECURITY.md updated.

### E2. [ ] AI quota + privacy guard
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

### E3. [ ] Privacy and terms pages
`/privacy` and `/terms` (en + he), from `MULTIUSER.md` §4.9 + Israeli Privacy Protection Law (incl. Amendment 13)
notice items: who runs it (Tal, contact = a dedicated address — **placeholder `privacy@…` until Tal creates it**, in
Open), what's collected and why, Google sign-in data (name, email, picture), the Google sign-in script on the login
page (FedCM), AI providers + the free-tier caveat (prompts may be used to improve models), processors (Vercel, Turso,
Vercel Blob, Resend, Ably, Cloudflare if C2 step 3 is on), the error log (what it keeps, 30-day retention), rights
(access, correction, deletion), retention, deletion process (E4), no ads/analytics cookies. Plain language, short.
Linked from the login footer, Settings → Account, and the app's About. Not legal advice — a line in Open for Tal to
get it reviewed before the public launch.

### E4. [ ] Delete account + export
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

### E5. [ ] Error-log hygiene
Retention 30 days for the error log and `viewport` diagnostics (purge in the daily cron); `/admin/errors` groups the
new kinds (`viewport`, `google_fedcm`, `extract · blocked` by host). If C2 fixes a host, its blocked entries get
marked fixed automatically.

---

## Part F — guards and docs (end of Session 1)
### F1. [ ] Guards
`test:clip` (A6), `test:polish` extended (A1, A2, A3 frame check), `test:delete-account`, `test:ai-quota`,
`test:blocked` (parsers + ladder with fixtures; no network in CI) in `guards.yml`. Prod smoke green in real-data mode.
### F2. [ ] Docs
`SPEC.md` Round 17 section (edit, don't append twice), help topics (0.2), `CLAUDE.md` map (help topics, AI gate,
fetch ladder, delete-account job), `ENVIRONMENT.md` (`CF_FETCH_URL`, `CF_FETCH_SECRET`, `ADMIN_EMERGENCY_TOKEN`, new
scripts/tests), `SECURITY.md` (password removal, emergency path, worker, AI redaction).

## Open
