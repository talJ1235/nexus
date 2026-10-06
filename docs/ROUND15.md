# Round 15 brief (from Tal, 2026-10-05) — multi-user foundation: accounts, spaces, data isolation — source of truth

**Status: screens approved by Tal (2026-10-05).** The mockups (22 boards `*.dc.html` + shared stylesheet `nx.css`;
canvas `Main` = `SignIn-desktop.dc.html`; states are the `data-props` enums at the bottom of each board) were written
by the planner straight into Tal's local checkout under `docs/design/r15/` (untracked, not on GitHub yet).
**First commit of Session 1:** `git add docs/design/r15` on `round15` → `R15.0: mockups`. Ready to run once Tal's
preparation in "Before you run" is done.

## Design language for this round (from the v2 canvas — Tal: "less text, mostly visuals, light, premium")
- **Minimal copy.** One short title + at most one short line per screen; explain with icons, avatars, tiles and states,
  not paragraphs. Every string still goes through i18n (en + he).
- **Light brand panel**, never a black one: warm paper gradient (`#faf8f4 → #f5f3ee`, Plum: lavender) with a faint
  isometric line grid (the Box logo's geometry) and two very soft warm radial lights; dark mode uses `#161616 → #121212`.
  It sits next to the form on desktop sign-in and as the top band on phone screens.
- **Show the product, not words:** the sign-in panel shows a live shared list (check-offs, "added by" avatar, a "New"
  row highlight, budget meter, a price-drop card, a "Noa is shopping" presence chip, a toast).
- **People are visual:** gradient initial avatars, facepiles with a green presence dot, space identity = rounded tile
  with icon + gradient colour (6 colours, 10 icons). Space settings has a cover band in the space colour.
- **Patterns adopted from leading products:** "Last used" badge on the sign-in method (Clerk); returning-user chip with
  "Not you?" (Google); passkey offer → waiting → "You're all set" with equal-weight "Not now" (Google/FIDO guidance);
  passkeys listed by device/provider with added + last used; security checkup ring (Google); "Confirm it's you" step-up
  dialog (GitHub sudo mode); typed-name delete with stats and 7-day undo; invite = QR with the space tile in the
  centre + WhatsApp first on phone + pending invites with resend/revoke (Linear); join preview card with facepile and
  counts, joined (confetti) and expired states (Discord-style); roles matrix (Notion).
- **States are tweaks on one board** (open the board's Tweaks): sign-in returning/new/verifying/error + closed-circle
  mode; passkey offer/waiting/done; recovery email/code/wrong-code; invite-only no-invite/on-waitlist; join
  preview/joined/expired; create-space identity/invite; shared list member/viewer; dialogs step-up/delete/leave.
- **Live presence** ("Noa is shopping", green dots, "Yoav added 3 items" toasts) is drawn as the target. R15 ships the
  static parts (avatars, "added by", last active from sessions); the realtime layer is R16 (live list) — build the
  components so R16 only feeds them data.
- Brands: the mock "G" circle becomes Google's official sign-in button asset; WhatsApp is a share intent with a generic
  chat icon (no third-party logos drawn).

Why: Nexus goes from one owner with a shared password to real accounts, so family and friends can use it (closed
circle first). This round builds the foundation — sign-in, per-space data, spaces and invites — and must leave Tal's
data intact. Product layer (onboarding, QR desktop login, push + inbox, AI quota, admin panel, privacy pages) is
Round 16. The full plan and every decision behind this brief: `docs/MULTIUSER.md` (§1–§6) and `docs/SECURITY.md`.
Where this brief is more specific than those files, this brief wins.

## How to run (two sessions, then a short release with Tal)
- Branch **`round15`** from `main`. Commit each item as `R15.<part><k>: …`. Push the branch after each part.
- **Session 1 = Parts 0, A, B** (auth + isolation). **Session 2 = Parts C, D, E, F** (spaces UX, retire, performance,
  guards/docs). Each session is unattended: never stop to ask, put decisions in "## Open". Don't touch power settings.
  Read open reports first (`node scripts/reports.mjs`).
- **Do not merge to `main` at the end of either session.** Merging deploys and runs the migration on the real
  database. Part G ("Release") is run in a third, short session **with Tal present**, after he has tested the
  branch locally. Session 2 ends with "ready to release" in "## Open".
- Before each session: `git merge --no-edit origin/main` into `round15` (docs may have changed).
- Verify on phone (360/390) and desktop (1366), light + dark, Graphite + Plum, English + Hebrew.
- **Design parity proof** (as in R14, `node scripts/parity.mjs`): side-by-side PNGs for every new screen into
  `docs/design/parity-r15/` (≤ 20 files, each ≤ 400 KB). List differences kept on purpose in "## Open".
- New dependencies need a one-line reason in "## Open" (`docs/SECURITY.md` §11). Pin exact versions.
- Use plan mode for Part B (it touches most server files); show a ≤ 10-line plan before editing.
- **Never touch the prod DB from the PC this round.** `.env.local` has the prod URL only as `PROD_TURSO_DATABASE_URL`
  with a read-only token; the only script allowed to use it is `db-snapshot.mjs` (0.1). Everything else runs on file DBs (snapshot copies,
  `serve-fresh.sh`). `npm run build` runs `db:migrate` — so the R15 migration step refuses a non-`file:` URL unless
  `VERCEL=1` (prod build) and the dev server refuses to start on a remote URL while `R15_LOCAL_GUARD` is on (default on
  for this branch). Remove the dev-server guard in Part G.

## Before you run (Tal)
Closed-circle mode (`MULTIUSER.md` §4.1): no domain yet, Google sign-in only, app stays on
`nexus-ashen-beta.vercel.app`. Passkeys and email-code recovery are **built and tested on localhost** but stay hidden
in production until `NEXT_PUBLIC_APP_URL` (own domain) and `RESEND_API_KEY` exist.
1. Google Cloud OAuth client (Testing mode, testers as test users) → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
2. `BETTER_AUTH_SECRET` (32+ random bytes), `ADMIN_EMAIL=tal.jacoby10@gmail.com`, `BETTER_AUTH_URL` = the prod URL.
   In `.env.local` too (with `http://localhost:3100`), plus the Google client for localhost.
3. A long `APP_PASSWORD` (≥ 20 random characters) — it stays as the admin fallback in closed-circle mode and is what
   the GitHub prod smoke uses (update the `NEXUS_PASSWORD` Actions secret to match).
4. Optional now: Cloudflare Turnstile keys (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) for the waitlist form.
5. A manual backup download from the app (Settings → Backup) kept on the PC, before the release session.

### Setup step by step (closed-circle mode, no domain) — status 2026-10-05
Done by the planner on Tal's PC (2026-10-05): `.env.local` backed up to `.env.local.bak-r15`, then `BETTER_AUTH_SECRET`
(new, local only), `BETTER_AUTH_URL=http://localhost:3100`, `ADMIN_EMAIL`, `AUTH_FULL_LOCAL=1` added and the local
`APP_PASSWORD` replaced by a 24-character one (the old one was 10 → the fallback would have been off locally).
`.claude/settings.local.json` allows `git push origin round15` / `git push -u origin round15` (no merge permission on
purpose — Part G is with Tal). Note: the local `TURSO_DATABASE_URL` is a **file** DB, not prod.

Left for Tal:
1. **Google Cloud** (console.cloud.google.com, signed in as Tal): create project `Nexus` → Google Auth Platform → Get
   started: app name `Nexus`, support email = Tal's Gmail, audience **External**, contact email, agree.
   - Audience → Test users → add Tal's Gmail + the first testers (max 100). Publishing status stays **Testing**
     (no verification; unverified-app screen is expected).
   - Data access: only `openid`, `email`, `profile`.
   - Clients → Create client → Web application `Nexus web`. JavaScript origins: `https://nexus-ashen-beta.vercel.app`,
     `http://localhost:3100`. Redirect URIs: `https://nexus-ashen-beta.vercel.app/api/auth/callback/google`,
     `http://localhost:3100/api/auth/callback/google`. Copy the Client ID and the secret right away (Google shows new
     secrets once). If Google refuses the `vercel.app` address, the fallback is buying the domain first.
   - Put both into `.env.local` (`GOOGLE_CLIENT_ID=`, `GOOGLE_CLIENT_SECRET=`) and into Vercel (step 3).
2. **Prod DB read access for the snapshot (0.1)** — the local `.env.local` has no prod URL, so 0.1 reads two extra
   names used **only** by `scripts/db-snapshot.mjs`: `PROD_TURSO_DATABASE_URL` (the `libsql://…` URL from Vercel → env
   `TURSO_DATABASE_URL`) and `PROD_TURSO_READ_TOKEN` = a **read-only** token (Turso dashboard → the database →
   Create token → access **Read only**, expiry 30 days). `db-restore-prod.mjs` takes a full-access token only as a
   prompt at run time (Part G emergency), never from a file. Without these two names the builder skips 0.1's prod part,
   tests on a synthetic DB and says so in "## Open" — the rehearsal on real data then happens in Part G step 2.
3. **Vercel** → Project → Settings → Environment Variables (Production) — add now (unused until R15 ships):
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, a **new** `BETTER_AUTH_SECRET` (generate on the PC:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`),
   `BETTER_AUTH_URL=https://nexus-ashen-beta.vercel.app`, `ADMIN_EMAIL=tal.jacoby10@gmail.com`.
4. **On release day only (Part G, step 1):** new prod `APP_PASSWORD` (≥ 20 chars:
   `node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"`) in Vercel **and** the same value in
   GitHub → repo Settings → Secrets → Actions → `NEXUS_PASSWORD`. Not earlier: any deploy before the release would switch
   the prod password and break the prod smoke.
5. Optional: Cloudflare → Turnstile → Add widget (hostnames `nexus-ashen-beta.vercel.app`, `localhost`, mode Managed)
   → `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` in Vercel + `.env.local`.
6. Testers: 5–10 Gmail addresses (added as test users in step 1; invite codes are made in the app after release).
7. Release day (R15 Part G): download a backup from the app first; be there to sign in with Google on PC and phone.

---

## Part 0 — Safety net (do first)

### 0.1 [x] Prod snapshot and a migration rehearsal path
- `scripts/db-snapshot.mjs`: **read-only** copy of the prod Turso DB (from `PROD_TURSO_DATABASE_URL` + `PROD_TURSO_READ_TOKEN` in `.env.local`, see "Before you run" step 2) into `snapshots/prod-<date>.db`
  (gitignored, never committed): every table, every row, then `PRAGMA integrity_check` and a row count per table
  printed as a table. No writes to the source — open it with a read-only query path and assert no statement other
  than `SELECT` / `PRAGMA` is sent.
- `scripts/db-restore-test.mjs`: restore the existing `/api/backup` JSON into an empty file DB and compare counts
  (proves the backup path works before we need it).
- `scripts/db-restore-prod.mjs <snapshot>`: the emergency path for Part G — writes a snapshot back to the prod Turso DB
  (URL from `PROD_TURSO_DATABASE_URL`, full-access token typed at the prompt, never stored). Refuses to run without `--i-am-tal-and-prod-is-broken`, prints the counts it will write and waits
  for typed "restore". Test it end-to-end against a **second, throwaway** libSQL file/DB, never prod, in this round.
- **Acceptance:** all three run green locally; counts printed in "## Open" (counts only, no content).

---

## Part A — Sign-in (Better Auth)

### A1. [x] Better Auth in, the shared password out (with a guarded fallback)
- `better-auth@1.7.7` + `@better-auth/passkey@1.7.7` (pin exact). Drizzle adapter on the existing libSQL client.
  Tables created idempotently in `src/db/migrate.ts`, same style as today (`CREATE TABLE IF NOT EXISTS …`).
  `telemetry: { enabled: false }`.
- Plugins: Google (social), passkey, `emailOTP` (recovery only — `disableSignUp`, sign-in only for existing users),
  `organization` (= spaces, see B1), `admin` (role from `ADMIN_EMAIL`), `captcha` with Cloudflare Turnstile on the
  waitlist and email-code endpoints **only when the keys exist**. Rate limiting with `storage: "database"`.
- Google: OIDC with PKCE + state, only `email_verified` accounts, scopes `openid email profile`. **Full-page redirect,
  never a popup** (works in an installed PWA; `MULTIUSER.md` §4.10).
- Account linking (`SECURITY.md` §2): a Google identity links to an existing user only when the email is verified and
  equal. Otherwise it's a new user and needs an invite (A3).
- Sessions (`SECURITY.md` §3): DB sessions, token stored hashed, cookie `__Host-nexus_session` on https
  (`nexus_session_dev` on http localhost), `Secure; HttpOnly; SameSite=Lax; Path=/`. Idle 30 days (sliding), absolute
  90 days (reject sessions older than 90 days even if active). Rotate on sign-in and on role change. Every request
  checks the DB session (≤ 60 s cache), so sign-out/ban take effect at once.
- **Closed-circle switch** (one function, e.g. `authMode()`): passkey UI and "Lost access?" show only when
  `NEXT_PUBLIC_APP_URL` is set **and** the request host equals it **and** `RESEND_API_KEY` exists. Localhost counts as
  "full" when `AUTH_FULL_LOCAL=1` so every path is tested.
- **Admin fallback (closed-circle mode only):** `/login?admin=1` shows the old password field, which signs in as the
  `ADMIN_EMAIL` user (never anyone else), rate-limited 5/min/IP + 20/day, logged as a security event, requires
  `APP_PASSWORD` length ≥ 20 (shorter → fallback disabled). It disappears automatically in full mode. The prod smoke
  (`.github/workflows/smoke.yml`) uses it.
- `src/proxy.ts`: public paths updated (`/login`, `/join/*`, `/api/auth/*`, `/s/*`, `/api/cal/*`, cron, assets);
  everything else needs a valid session. The old HMAC `nexus_session` cookie stops working (one re-login for Tal).
- Brand name in one config (`APP_NAME`, default "Nexus") used by the new screens, manifest name and email text.
- **Acceptance:** unit tests for `authMode()`, the fallback guard (wrong user impossible, short password → off), the
  absolute-age rule. Smoke on localhost with a **mock Google provider** (a test-only OIDC stub enabled only when
  `NODE_ENV !== "production"` and `AUTH_TEST_IDP=1`; the build fails if both are on in production): sign in, sign out,
  session list shows the device.

### A2. [x] Sign-in screens = the mockups
Mockups: `SignIn-desktop` (`Main` on the canvas), `SignIn-phone`, `SignIn-he` (Hebrew RTL), `Recovery-phone`,
`Passkey-phone`, `InviteOnly-phone`, `Welcome-phone` (first run: personal space ready → create household / have a link /
just me), `Emails` (invite, code, new sign-in — the code and sign-in emails go live with the domain + Resend).
- `/login`: brand panel + form on desktop, single column on phone. "Continue with Google" (primary), "Sign in with a
  passkey" (full mode only; also offers the browser's "use a passkey from another device"), invite code field under
  "new here?", "Lost access?" (full mode only), Privacy · Terms links (pages come in R16 — link to `/privacy` and
  `/terms` stubs that say "coming soon" for now).
- Google button: follow Google's sign-in branding (official "G" mark asset, not the mockup's placeholder circle).
- Recovery: email → "Check your email" with 6 boxes (paste fills all, auto-advance, `autocomplete="one-time-code"`),
  same message whether or not the email exists, 10-min code, 5 tries, resend countdown, max 3 codes/hour per email
  and per IP. After a recovery sign-in → forced **Add a passkey** screen (no "Not now"); other sessions get a security
  event (inbox/push come in R16 — for now the activity log, A5).
- After the first Google sign-in in full mode → **Add a passkey** once, skippable.
- **Acceptance:** parity PNGs (desktop + phone, light + dark, Graphite + Plum for `/login`; Hebrew phone). Unit tests
  for OTP: hashed storage, single use, expiry, attempt limit, identical responses for unknown emails.

### A3. [x] Invite-only sign-up + waitlist
- Table `signup_invite` (`MULTIUSER.md` §3): hashed code (format `XXX-XXXX`, no look-alike characters), note, max
  uses, uses, expires, revoked. A space invite link (C2) also counts as a sign-up invite.
- The code or `/join/<token>` survives the Google redirect in a short-lived, signed, `HttpOnly` cookie (10 min).
- New Google user without a valid invite → no user row is created; show `InviteOnly-phone`: code field, "Add me to the
  waitlist" (table `waitlist(email, created_at, ip_hash)`; Turnstile when keys exist; rate-limited), "Use a different
  Google account".
- Admin (only `ADMIN_EMAIL`) gets **Settings → Invite codes** (mockup `InvitesAdmin-desktop`: KPI tiles, codes table with usage meters, waitlist with one-tap Invite): create a code (note, uses, expiry 14 days default), copy,
  revoke, see who used it, see the waitlist. (The full admin panel is R16.)
- **Acceptance:** tenancy-style smoke: unknown Google user without invite → no `user` row; with a valid code → user +
  personal space; a used-up / revoked / expired code → refused with a clear message.

### A4. [x] First sign-in creates the personal space
Every new user gets exactly one personal space ("<first name>", kind `personal`, currency ILS, can't be deleted,
shared or left). Tal's existing data becomes **his** personal space via the migration (B2), linked when he first signs
in with Google as `ADMIN_EMAIL`.

### A5. [x] Settings → Security (devices, passkeys, activity)
Mockups `Security-desktop`, `Security-phone` (checkup ring, passkey cards, device tiles, activity timeline,
new-sign-in banner).
- Sign-in methods (Google, passkeys with name + last used, add / remove — remove and add need **step-up**: a passkey or
  Google re-auth within the last 10 minutes).
- Devices: browser · OS · approximate place (from Vercel's `x-vercel-ip-city` header, city only, nothing stored beyond
  the city) · last seen · method; "Sign out" per device; "Sign out all others".
- Security activity (table `security_event(user_id, kind, meta, ip_hash, ua, created_at)`, kept 90 days): sign-ins,
  new device, passkey added/removed, recovery, invite used, role changed, fallback sign-in. New-device banner on the
  phone ("Was this you?" → "Sign it out").
- Admin: "Recovery codes" (10 one-time codes, stored hashed, shown once) — admins can't recover by email code alone.
- **Acceptance:** smoke signs in on two browser contexts, signs one out from the other, the signed-out one gets the
  login page on its next request (≤ 60 s cache bypassed in test).

---

## Part B — Data isolation (the core guarantee)

### B1. [x] Schema: spaces and `space_id` everywhere
- Space = Better Auth `organization` + columns `kind` (personal|shared), `currency`, `color`, `created_by`.
  Membership roles `owner | member | viewer`.
- Add `space_id` (indexed) to `collections, items, sources, price_points, attachments, alerts, alt_groups,
  store_settings, receipts, conversations, conversation_messages` — denormalised on child rows too (`MULTIUSER.md` §3).
  `user_id` on `conversations, memories, reports`; `added_by_user_id` on `items`.
  Composite indexes `(space_id, status)`, `(space_id, created_at)`.
- `store_settings` primary key becomes `(space_id, store_key)` (today it is `store_key` alone).
- New tables: `user_pref(user_id, key, value)`, `space_pref(space_id, key, value)`, `space_invite`, `signup_invite`,
  `waitlist`, `security_event`, `rate_limit` (if Better Auth's own table isn't enough for our custom limits).
- `kv` keeps only system keys (`ai:health`, `pref:last_check`, `barcode:*`). Owner keys move: `pref:alerts`,
  `pref:owner`, `pref:memory`, `pref:home:*`, `profile:v1`, display language/currency, calendar token → `user_pref`;
  `pref:budget:*`, `pref:import-limit` → `space_pref`. Telegram keys stay untouched (feature off, D2).

### B2. [x] Migration of today's data (idempotent, rehearsed)
- One migration step (`src/db/migrate-r15.ts`, called from `migrate.ts`): creates the admin user from `ADMIN_EMAIL`
  (no password, no Google link yet), Tal's personal space "Tal", backfills `space_id` / `user_id` /
  `added_by_user_id` on every row, moves the `kv` keys (B1), then sets `space_id` NOT NULL (table rebuild in SQLite if
  needed — inside a transaction, with the row count checked before commit). Re-running it changes nothing.
- Old guest tables (`members`, `grants`, `invites`) are kept read-only (D1).
- **Rehearsal (Session 1 end):** run the migration on the 0.1 snapshot copy. **Acceptance:** row counts per table equal
  before/after, no NULL `space_id`, `PRAGMA integrity_check` ok, a second run is a no-op, the app on that copy shows
  the same To buy / On the way / History counts and budget as prod (compare numbers only). Report the numbers in
  "## Open". Plus a synthetic 2 000-item second space for speed checks (E1).

### B3. [x] `requireCtx()` + one scoped data layer; every server entry moved
- `requireCtx(need: "view" | "edit" | "owner")` → `{ user, space, role }`. Current space = cookie `nexus_space`,
  validated against membership on **every** request; invalid → personal space. Replaces `assertOwner`/`assertAuth`/
  `requireGuest` in all `src/app/*-actions.ts` (today 110 call sites in 20 files, `rg -c`) and every route under `src/app/api/`.
- Data layer `src/lib/db-scoped.ts` (or a folder): every function takes `ctx` and always adds `where space_id =
  ctx.space.id`; writes take `space_id` from `ctx`, **never from input**. Load by id = `id = ? and space_id = ?` →
  not found = **404, never 403**. `getAppData()` / `loadItems()` (`src/lib/data.ts`) load only the current space.
- Validate every server action / route input with `zod` (reject unknown keys) as each file is touched.
- Chats and memory are personal (`user_id` + `space_id`); the assistant's context builder takes `ctx` and can't read
  another space. Assistant actions run with the caller's `ctx`; writes still need the user's tap.
- Cron (`/api/cron/prices`): iterate spaces; dedupe price checks by normalized URL (one fetch per URL per run), then
  write price points per space. No Telegram (D2).
- Blob upload (`/api/blob/upload`): session + edit role; path `spaces/<spaceId>/receipts/<random>`; content-type
  allow-list (JPEG, PNG, WebP, HEIC, PDF), 20 MB cap. Check whether the pinned `@vercel/blob` supports private blobs on
  Hobby; if yes use them through an auth-checked route, else keep unguessable URLs (say which in "## Open").
- Calendar feed (`/api/cal/<token>`): token per **user**, feed = that user's spaces' events (all spaces they're in).
- Export/backup (`/api/export`, `/api/backup`): current space only, owner role; restore only into a space you own.
- Public `/s/<token>` read-only links keep working (token → its collection's space), `noindex`, rate-limited.
- **Acceptance (guards that keep it dead):**
  1. `npm run test:authz-coverage` — enumerates every exported server action (`"use server"` files) and every route
     handler and fails when one doesn't call `requireCtx` (or isn't on a small, commented allow-list: auth, cron with
     `CRON_SECRET`, public share, calendar token, health).
  2. `npm run test:scope` — fails when `db.select|insert|update|delete` on a data table appears outside the data layer
     (allow-list: migration, auth, admin counts, cron fan-out).
  3. `npm run test:tenancy` — two-user smoke on a fresh server: users A and B, viewer V in A's shared space. B calls
     **every** server action and API route with A's ids → all fail (404 / no change; DB unchanged — compare a hash of
     A's rows before/after); V tries every write → all fail; A's page HTML / RSC payload never contains B's item
     titles; switching `nexus_space` to a space you're not in falls back to your personal space.
  4. A role-matrix unit test (owner/member/viewer/outsider/signed-out/banned × each action group) with expected
     allow/deny (`SECURITY.md` §4).

### B4. [x] Server-side fetching guard (SSRF) and security headers
- `safeFetch()` per `SECURITY.md` §6, used by `extract.ts` (today `isPublicHttpUrl()` checks only the typed host, then `fetch(…, { redirect: "follow" })`
  at line ~66 follows redirects to anywhere and doesn't check the resolved IP),
  picture search, barcode lookups. `npm run test:ssrf` with the list in §6 (incl. a public URL redirecting to a
  private IP, and a DNS name resolving to 127.0.0.1 — use a local resolver stub).
- Headers + **enforced CSP** with nonces (`SECURITY.md` §5) in `next.config.ts` / `proxy.ts`; the two inline scripts
  (`src/app/page.tsx` `CARRY_SCRIPT`, `src/components/boot-screen.tsx` `MODE_SCRIPT`) get the nonce. `form-action` must
  allow Google's OAuth host. A `/api/csp-report` endpoint counts violations (no bodies stored).
- `npm run test:headers`: every page response has the headers; no CSP violations during the full smoke (listen to
  `securitypolicyviolation` in Playwright).

---

## Part C — Spaces (Session 2)

### C1. [x] Space switcher — desktop and phone
Mockups `Switcher-desktop` (menu with search, `Ctrl+1…9` shortcuts, facepiles, unread dot), `Switcher-phone`
(2-column space cards + New space), `CreateSpace-desktop` / `CreateSpace-phone` (name, kind, icon, colour with live
preview → invite step), `LiveList-phone` (shared list with "added by", grouped, viewer state).
- Desktop: a switch button under the logo at the top of the sidebar (space colour square, name, "Shared · N people").
  Menu: your spaces (personal first; role under each name; check on the current one; avatar stack on shared), then
  "New shared space", "Invite to <space>" (owner/member), "Space settings".
- Phone: the top bar shows the current space name next to the logo (as the mockup); tapping the avatar opens the
  sheet: account row, spaces, Invite, New shared space, Space settings.
- Everything follows the current space: Home, Shopping, Projects, Insights, search, assistant, calendar month view.
  Remembered per device (cookie). Switching keeps the current view and shows a short toast ("Now in Cohen home").
- Viewer role: all write controls hidden or disabled with a tooltip "View only"; the + button hidden.
- **Acceptance:** parity PNGs; smoke switches spaces and asserts the item lists change; viewer sees no write
  controls (and the server refuses anyway — B3).

### C2. [x] Invite links and joining
Mockups `Invite-desktop`, `Invite-phone`, `Join-phone`.
- `space_invite`: 32-byte token stored hashed, role **member or viewer** (owners are made by transfer, not invite),
  expiry 7 days, max uses (default 5), revocable. Link `/join/<token>`, share sheet with Copy, native Share, and a QR
  (render the QR client-side; no third-party QR service).
- `/join/<token>`: space name, colour, who invited, member avatars + counts, the role you'd get and what it allows,
  expiry. Signed in → "Join"; signed out → "Continue with Google to join" (counts as the sign-up invite). Already a
  member → straight in. Expired/revoked → a calm message with "Ask <name> for a new link".
- **Acceptance:** smoke: A invites as viewer, B joins, B sees A's shared items read-only; revoke → link dead; over
  max uses → refused.

### C3. [x] Space settings
Mockups `SpaceSettings-desktop` (cover band, people with presence + role menu, pending invite row, roles
matrix; phone: the same sections as a full-screen sheet) and `Dialogs-desktop` (step-up, delete, leave).
- Name, currency, colour (5 swatches). People: role change (owner only), remove (owner only, step-up), "(you)".
- Invite links list with uses/expiry, Copy / QR / Revoke. Note that public read-only list links stay under each
  list's Share.
- Leave space (not for the last owner → "Transfer ownership first"); Transfer ownership (step-up); Delete space
  (owner, typed confirmation of the name, step-up, soft delete with 7-day undo, then purge incl. blobs).
- Settings dialog gets the grouping from the mockup: "<space>" → Space & people; "You" → Account, Security,
  Appearance, Calendar, Assistant (existing sections move under these, nothing removed).

### C4. [x] Move a list/project to another space; "added by"
- On a list/project: "Move to space…" (spaces where you are member/owner); moves the collection and its items,
  sources, price points, attachments, alerts and receipts in one transaction; undo toast.
- In shared spaces, item rows/cards show a small "added by" avatar (initial + colour); tooltip with the name. Not
  shown in personal spaces.

---

## Part D — Retire (Session 2)

### D1. [x] Old guest system → notice page
`/g`, `/g/*`, `/i/<token>` show the `GuestNotice-phone` screen ("Nexus now uses accounts — ask <owner> for a new
invite"), with buttons to `/join` help and `/login`. Guest server actions return an error. Tables stay read-only
until R16. The share dialog loses the guest-invite part and keeps public read-only links.

### D2. [x] Telegram and the extension off — for everyone
UI hidden (settings, alerts panel, commands, Me sheet, help), `/api/telegram` and `/api/ext/*` answer **410 Gone**,
cron no longer sends Telegram digests/weekly summaries, the extension zip link removed from help. Code stays in the
repo. Help text explains that price alerts show in the app (push + inbox arrive in R16). Home "Add items from any
store with the extension" fallback suggestion removed.

---

## Part E — Performance (Session 2)

### E1. [x] Space-scoped loading stays fast
Bench (existing bench style) on the snapshot copy + the synthetic 2 000-item space: Home and Shopping first load and
the cron run, before (`main`) and after (`round15`). **Acceptance:** after ≤ before + 10 % on Tal's space; the
2 000-item space's Home server time reported. Every new query uses an index (`EXPLAIN QUERY PLAN` check in a test for
the main list queries).

---

## Part F — Guards, CI, docs (Session 2)

### F1. [x] CI on every push
New `.github/workflows/guards.yml` (push to any branch + PRs): `npm ci`, typecheck, lint, the unit tests,
`test:authz-coverage`, `test:scope`, `test:ssrf`, `test:headers`, `test:tenancy` (on a file DB, mock IdP), `npm audit
--audit-level=high`, gitleaks. Actions pinned by commit SHA. Update `smoke.yml` to sign in via the admin fallback.

### F2. [x] Docs
`SPEC.md` Round 15 section; `nexus-help.md` (sign-in, spaces, roles, invites, devices, Telegram/extension retired;
`test:help` green); `CLAUDE.md` map (`requireCtx`, data layer, auth files; the "every action must call
`assertAuth`/`assertOwner`/`requireGuest`" line becomes `requireCtx`); `docs/ENVIRONMENT.md` (new env vars, scripts,
workflows, log line); security checklist per ASVS area in "## Open" (done / not yet / why).

---

## Part G — Release (third session, with Tal present)
1. Tal confirms: Google client + all env vars are in Vercel (Production), fresh manual backup on the PC.
2. `node scripts/db-snapshot.mjs` (fresh), then the rehearsal again on it (B2 acceptance).
3. `git merge --ff-only round15` into `main`, push → Vercel builds and runs the migration.
4. Tal signs in with Google on prod (PC + phone). Check: counts equal the snapshot; Home, Shopping, History, budget,
   calendar feed; a test invite code works on a second Google account; the GitHub prod smoke is green.
5. If anything is wrong: the old code can't run on the migrated schema, so roll back **both**: restore the DB from
   the fresh snapshot (`scripts/db-restore-prod.mjs`, tested in 0.1), then Vercel → Deployments → the previous
   production deployment → Promote. Write what happened in "## Open".

## Not in this round
Onboarding questions, QR desktop login, web push + inbox, AI quota/usage/PII stripping, admin panel, privacy/terms
text, delete account / full export, removing the password fallback and guest tables (all R16); supermarket mode (R17);
price comparison (R18); own domain + passkeys/email recovery live on prod (when the name is final).

## Open

### Session 1 (2026-10-05)
- **0.1 — prod snapshot not taken by the builder.** `.env.local` has `PROD_TURSO_DATABASE_URL` + `PROD_TURSO_READ_TOKEN`,
  but the agent's permission layer refused the read of the production DB from this PC ("Production Reads"). Per the
  brief's fallback everything ran on file DBs: `db-snapshot.mjs --source file:local.db` (same code path, read-only
  guard, 32 statements all SELECT/PRAGMA, integrity ok). **Tal runs once:** `node --env-file=.env.local scripts/db-snapshot.mjs`
  (then `node scripts/db-restore-test.mjs` and `node scripts/r15-rehearsal.mjs` pick the newest `snapshots/prod-*.db`
  automatically). The real-data rehearsal otherwise happens in Part G step 2.
- 0.1 counts (local DB copy, no content): collections 13 · items 450 · sources 214 · price_points 164 · alerts 1 ·
  store_settings 2 · receipts 132 · reports 71 · conversations 269 · conversation_messages 558 · kv 29 · others 0.
  `db-restore-test.mjs`: backup → empty DB, every table equal, integrity ok. `db-restore-prod.mjs` tested end-to-end
  against a throwaway file DB (`--target file:snapshots/throwaway.db`, pre-damaged + an extra table): refused without
  the flag, refused without typed "restore", then restored exactly (extra table gone, 450 items, integrity ok).
- **Session 1 done: Parts 0, A, B** — commits `R15.0` … `R15.A2` (parity). Not merged to `main` (Part G with Tal).
- **Before Session 2 / release, Tal:** run the real snapshot + rehearsal on the PC (this agent wasn't allowed to read prod):
  `node --env-file=.env.local scripts/db-snapshot.mjs` → `node scripts/db-restore-test.mjs` →
  `node --env-file=.env.local scripts/r15-rehearsal.mjs` (all print counts only). Rehearsal on the local copy (0.1): every
  table equal before/after (items 450, sources 214, price_points 164, receipts 132, conversations 269, messages 558, reports
  71, collections 13, store_settings 2, alerts 1), no NULL `space_id`, integrity ok, second run = no-op (whole-DB hash), To buy
  349 / On the way 11 / History 90 / urgent 2 and this month's budget unchanged; migration ≈ 0.8 s. Synthetic 2 000-item
  space added to that copy (`snapshots/rehearsal.db`) for E1.
- `local.db` on this PC is now migrated (backup before: `snapshots/local-before-r15.db`). Tal's first local sign-in:
  `AUTH_FULL_LOCAL=0 bash scripts/serve.sh` → `/login?admin=1` with the local `APP_PASSWORD`, or Google once the localhost
  client is in `.env.local`.
- **Decisions / deviations (please confirm):**
  - Session tokens: Better Auth stores the token itself in `session.token`; the cookie is `token.HMAC(BETTER_AUTH_SECRET)`, so
    a DB-only leak can't produce a valid cookie. Hashing the stored token would need wrapping Better Auth's adapter (all of
    findOne/update/delete/consumeOne/transactions) — left out as risky; revisit if Better Auth adds it.
  - The sign-in brand panel follows the approved mockups (animated isometric cube field), not the brief's "live shared list"
    prose (the boards are the approved source).
  - The admin fallback's daily limit counts **failed** attempts (20/day/IP); the 5/min limit counts all attempts. Counting
    successes locked the local smoke out after a day of test runs and doesn't stop guessing any better.
  - Invite codes are stored hashed for lookup **and** AES-GCM-encrypted (key derived from `BETTER_AUTH_SECRET`) so the admin
    can copy a code again (the mockup's Copy button). Space-invite tokens (C2) stay hash-only.
  - Settings → Security and → Invite codes are full pages (`/settings/security`, `/settings/invites`) linked from the current
    Settings dialog; C3's regrouped dialog can embed the same panels (`SecurityPanel`, `InvitesAdmin`).
  - Telegram and the extension: their **server side** is already off (tg* actions answer "gone"/not connected,
    `/api/telegram` and `/api/ext/*` = 410, cron sends nothing) because they used global, unscoped state. The UI hiding, help
    text and extension link removal are still D2 (Session 2). Same for the old guest system: actions error,
    `/api/invite/accept` = 410, `/g` and `/i/<token>` show a short "access ended / invite gone" message — the
    `GuestNotice-phone` screen is D1.
  - Photo guesses from "identify by photo" are no longer written to the shared `barcode:*` cache (another user would read them).
  - `markAlertsRead` needs edit (a viewer would otherwise change a shared space's alerts); `itemPictureChoices` stores the
    candidates only for editors (both found by `test:tenancy`).
  - Welcome → "With my household" goes to `/?welcome=household` (the create-space dialog is C1) and "I have an invite link"
    to `/join/<token>` (C2) — Session 2 wires both.
  - `APP_NAME` lives in `src/lib/brand.ts` (`NEXT_PUBLIC_APP_NAME` overrides) and is used by the new screens; the manifest and
    layout titles still say "Nexus" — switch them in F2 or on rename.
  - Emails: the recovery-code mail is plain text (Resend REST via `fetch`, no new dependency). The invite and "new sign-in"
    emails from the `Emails` board aren't sent yet (they need the domain + Resend) — R16 with the inbox/push.
  - Passkey sign-in: the plugin hard-codes `userVerification: "preferred"` for assertions, so `afterVerification` rejects an
    assertion without UV; registration requires resident key + UV.
  - Rotation on role change: role changes are C3 (none exist yet) — revoke the member's sessions there.
- **New dependencies** (pinned exact): `better-auth@1.7.7`, `@better-auth/passkey@1.7.7` — the auth library chosen in
  MULTIUSER §1 (Google, passkey, email OTP, organization, admin, rate limits). No others (Resend via `fetch`; the SSRF guard
  is built on `node:http`).
- **Blob storage:** `@vercel/blob@2.8.0` supports `access: "private"`, but that needs a private Blob **store** (the existing
  one is public; switching = a new store + moving files). Kept public, unguessable URLs under `spaces/<spaceId>/receipts/…`
  (random suffix), only shown inside their space; new attachments/receipts must be under the caller's space prefix.
- `npm audit --audit-level=high`: 5 high findings, all pre-existing dev/transitive (`braces`/`micromatch` via
  eslint-config-next; `exceljs`→`uuid` moderate) — none from the new packages. F1 handles the CI gate.
- Tests added and green: `test:auth`, `test:otp`, `test:authz-coverage` (152 exports), `test:scope`, `test:roles`,
  `test:tenancy` (B calls 99 actions + 10 routes ≈ 8 700 requests with A's ids → A unchanged, no leaks; viewer can't write;
  forged `nexus_space` falls back), `test:ssrf`, `test:headers` (no CSP violations), `test:auth-flow` (dev server + stub IdP
  + virtual authenticator: invite-only, waitlist, used-up/revoked/expired codes, device sign-out, passkey create + sign-in,
  email recovery → forced passkey). `npm run smoke`: all passed.
- Smoke note: Playwright's `setOffline(false)` no longer fires the page's `online` event in this browser build; the offline
  step dispatches it itself (the app logic is unchanged and works).
- Parity PNGs: `docs/design/parity-r15/` (16). Kept on purpose: "Not you?" under the returning chip and "Lost access?"
  (brief), the language switch on phone, the real Google "G" mark, Security / Invite codes as pages instead of the Settings
  modal (C3), activity rows from real data.

### Session 2 (2026-10-06)
- **Planner fixes first:** `checkUrl()` strips a trailing root dot before the name checks (`LOCALHOST.`, `localhost..`,
  `metadata.google.internal.`, `printer.local.` now refused by name, no DNS needed; 5 cases added to `test:ssrf`, which
  fails without the fix) — `e769767`. `db-restore-test.mjs` passes `ADMIN_EMAIL` (from the environment or `.env.local`,
  that one name only; `PROD_TURSO_*` never reach the child) — `77d475b`. Run on `snapshots/prod-2026-10-06.db` (local copy,
  not prod): backup → empty DB, every table equal, integrity ok — collections 2 · items 19 · sources 14 · price_points 17 ·
  attachments 6 · alt_groups 0 · alerts 1 · store_settings 1 · receipts 6 · conversations 9 · conversation_messages 22 ·
  memories 0 · space_pref 1.
- **Done: C1–C4, D1, D2, E1, F1, F2** (ticked above). Commits: `b02d670` (C1–C4), `a412185` (parity), `3a864c5` (D1+D2),
  `4f44d07` (E1), `aefd430` + `8683868` (F1), `486234c` (F2); fixes `9ddfcda` (seed/serve-fresh). Branch pushed; not merged.
- **Tests:** `test:tenancy` 42/42 (the every-action sweeps for B and viewer V, plus new space checks: switch only into
  your spaces, viewer invite → join → read-only, token stored hashed, `/join` preview shows no items, revoke kills a link,
  5 uses then refused, member can't change roles, step-up on remove with an old sign-in, last owner can't leave, move a
  list with all 6 child rows + undo, typed delete + restore, and Playwright: switch from the menu keeps the view + "Now
  in…", viewer has no add bar / "+" / New project, signed-in join, dead link screen). `test:authz-coverage` 168 exports,
  `test:scope`, `test:roles` (viewer read-list now names each space action), `test:ssrf`, `test:headers`,
  `test:query-plans`, `test:help`, all unit tests, `npm run -s check`. The invite QR (with the tile cut out) decodes with
  zxing (no inversion) — checked in Node.
- **E1 numbers** (`npm run bench:r15`, 15 runs after 3 warm-ups, full server response, same PC; before = `main` on a copy
  of `prod-2026-10-06.db`, after = this branch on a copy of `rehearsal.db`):

  | | before (main) | after, Tal's space | after, 2 000-item space |
  |---|---|---|---|
  | Home | 30 ms (p90 33) | 30 ms (p90 36) | 248 ms (p90 277) |
  | Shopping | 26 ms (p90 35) | 25 ms (p90 34) | 170 ms (p90 192) |

  → after ≤ before + 10 % on Tal's space (0 % / −4 %). Cron: the watched-links query (network fetches excluded) was 422 ms
  for 670 links next to the 2 000-item space — SQLite matched sources by the space index (a whole space per item); fixed
  (`+space_id` keeps it on `sources_item_idx`) → 9 ms; before (main, 8 links) 0.3 ms. `test:query-plans` checks 17
  space-scoped list queries + this join (no bare table scan).
- **Decisions / deviations (please confirm):**
  - Space identity follows the boards: a **letter tile** in 6 colours (the brief's "icon + 10 icons" isn't on any board);
    the `icon` column stays unused. Personal spaces from the migration say `plum` → shown violet.
  - Settings: the existing single-column dialog is **grouped** (current space: Space & people, budget cap, import limit,
    backup/restore for owners · then You: display, assistant, calendar, memory, account) instead of the board's two-pane
    modal; **Space settings is its own dialog** (cover band, general, people + role menu, invite links, leave / delete).
    The delete confirmation stacks on top of it (parity `spaces-settings.png`).
  - Invites are **links only**: the boards' email chips / "Pending · Resend" rows need Resend + the domain (R16 with the
    inbox). Old links can't be copied again (only the hash is stored) — the list offers Revoke; "Reset link" in the
    invite dialog revokes that dialog's link and makes a new one; switching Member/Viewer makes a new link.
  - Members may create links and revoke their own; owners revoke any. Owners are made by transfer only.
  - **Role change doesn't rotate sessions** (SECURITY §3 says it should): memberships are read from the DB on every
    request, so a role change or removal applies to the person's next request; a `role_changed` security event is logged
    for them. Rotating would sign them out everywhere (all spaces) — say if you want that anyway.
  - Deleting a space reloads into your personal space (no Undo toast); restore = Space settings → "Restore" (any space's
    settings, owners, 7 days). The cron purges after 7 days: rows, then only the blob files those rows point to, then the
    space (files of lists moved away earlier stay safe).
  - Move to space: lives in the list/project edit dialog. The `receipts` inbox isn't tied to a list, so receipts stay;
    item attachments move (their blob path keeps the old space prefix — harmless, URLs are unguessable).
  - Viewer: add bar and "+" hidden, New project/list hidden, other write controls disabled with "View only", a "You can
    view this space" line. Not built: "Request access" (LiveList board) and live presence (green dots, "added 3 items"
    toasts) — R16 live layer; `Avatar` already takes `online`.
  - D1 notice: as the board, one "Log in" button (there is no `/join` help page to link). The name is the old link's list
    owner (or the admin's first name).
  - D2: the app ignores the extension (`EXTENSION_RETIRED` in `use-extension.ts`); `public/nexus-extension.zip` is still
    served — delete it in R16 if the extension isn't coming back. Telegram kv keys untouched.
  - CI audit gate is `npm audit --omit=dev --audit-level=high`: the remaining highs are dev-only (`braces` via
    eslint-config-next). `source-map-js` 1.2.1 → 1.2.2 via `npm audit fix` (lockfile only). **No new dependencies.**
    Semgrep / ZAP from SECURITY.md §11 aren't in CI yet (R16).
  - Fixed on the way: `seed-local.mjs` / `serve-fresh.sh` (sparse profile was broken since R15: no `space_id`),
    `test:ship` (a stray `spaceId` in an expected value), `busy_timeout` on local file DBs (CI hit SQLITE_BUSY).
- **Parity:** 4 composites added to `docs/design/parity-r15/` (20 files): `spaces-switcher`, `spaces-create-invite`,
  `spaces-join`, `spaces-settings`. Kept on purpose besides the above: the switcher menu shows role + facepile per space
  and "Invite to <space>"; the phone switcher lives at the top of the Me sheet (account row, spaces, actions, then the rest).
- **Still open from reports:** 1 open app report — "price drop and the AI didn't recognize it" (assistant's context). Not
  in this round's scope; for R16 triage.
- **Local state:** `local.db` untouched this session (UI checks ran on `sparse-smoke.db` and throwaway DBs). Servers
  left running: :3100 (`local.db`, this branch) and :3102 (sparse). A `main` worktree for the bench sits at
  `../nexus-main-bench` (remove: `git worktree remove --force ../nexus-main-bench`).
- **Security checklist (ASVS 5.0 areas):**
  - V1 Encoding & sanitization — done: React escaping, no `dangerouslySetInnerHTML` except the two nonce'd scripts.
  - V2 Validation — done for every touched action/route (zod, strict objects); older actions validated in Session 1.
  - V3 Web frontend — done: enforced nonce CSP, HSTS, nosniff, COOP, frame-ancestors none (`test:headers`).
  - V4 API — done: every action/route gated (`test:authz-coverage`), 404 for foreign ids, rate limits on join/invite/
    create.
  - V5 Files — done: blob uploads need edit role + space prefix + type/size allow-list; not yet: private Blob store
    (public, unguessable URLs — Session 1 note).
  - V6 Authentication — done: Google (verified email), invite-only sign-up, admin fallback guarded, passkeys + recovery
    (localhost until the domain), step-up; not yet: passkeys/email live in prod (domain + Resend).
  - V7 Sessions — done: DB sessions, HMAC cookie, revocation, idle/absolute limits, rotation on sign-in; deviation:
    no rotation on role change (above); token stored unhashed (Session 1 decision).
  - V8 Authorization — done: `requireCtx` + scoped data layer, role matrix, tenancy sweep, viewer UI + server.
  - V9 Self-contained tokens — n/a (no JWTs); invite tokens/codes are random + hashed.
  - V10 OAuth/OIDC — done via Better Auth (PKCE, state); Google client in Testing mode.
  - V11 Cryptography — done: Node crypto only (SHA-256, HMAC, AES-GCM for re-copyable codes), CSPRNG tokens.
  - V12 Secure communication — done: HTTPS on Vercel + HSTS; SSRF guard on all server fetching.
  - V13 Configuration — done: secrets only in env, gitleaks in CI, actions pinned by SHA, test IdP refused in prod.
  - V14 Data protection — partly: per-space isolation, no PII in logs/URLs; not yet: delete account / full export (R16).
  - V15 Secure coding & dependencies — done: CI audit gate (prod, high), pinned versions for new deps; not yet: Semgrep.
  - V16 Logging — done: security events (90 days) incl. role changes and invites used; not yet: admin view (R16).
- **ready to release** — Part G with Tal: Vercel env vars + Google client confirmed, fresh backup, then the steps in
  Part G (fresh snapshot + rehearsal, `git merge --ff-only round15`, sign-in checks, rollback path tested in 0.1).
