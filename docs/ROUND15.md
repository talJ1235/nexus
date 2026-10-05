# Round 15 brief (from Tal, 2026-10-05) — multi-user foundation: accounts, spaces, data isolation — source of truth

**Status: ready to run after Tal approves the screens** (mockups `docs/design/r15/*.dc.html` — pushed once Tal approves; canvas
"Nexus R15 — Accounts & Spaces"). Tal's preparation steps are in "Before you run" below.

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
- **Never touch the prod DB from the PC this round.** `.env.local` points at prod Turso; the only script allowed to
  use that URL is the read-only `db-snapshot.mjs` (0.1). Everything else runs on file DBs (snapshot copies,
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

### Setup step by step (closed-circle mode, no domain)
From `MULTIUSER.md` §7 only items 3 (as "Testing"), 5 and 10 are needed now; the rest wait for the name/domain.
1. **Google Cloud** (console.cloud.google.com, signed in as Tal): create project `Nexus` → Google Auth Platform → Get
   started: app name `Nexus`, support email = Tal's Gmail, audience **External**, contact email, agree.
   - Audience → Test users → add Tal's Gmail + the first testers (max 100). Publishing status stays **Testing**
     (no verification; unverified-app screen is expected).
   - Data access: only `openid`, `email`, `profile`.
   - Clients → Create client → Web application `Nexus web`. JavaScript origins: `https://nexus-ashen-beta.vercel.app`,
     `http://localhost:3100`. Redirect URIs: `https://nexus-ashen-beta.vercel.app/api/auth/callback/google`,
     `http://localhost:3100/api/auth/callback/google`. Copy the Client ID and the secret right away (Google shows new
     secrets once). If Google refuses the `vercel.app` address, the fallback is buying the domain first.
2. **Secrets** — generate on the PC (Node is installed):
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` → `BETTER_AUTH_SECRET`;
   `node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"` → new `APP_PASSWORD` (24 chars).
3. **Vercel** → Project → Settings → Environment Variables (Production): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://nexus-ashen-beta.vercel.app`, `ADMIN_EMAIL=tal.jacoby10@gmail.com`,
   new `APP_PASSWORD`. Env changes apply on the next deploy (= the R15 release), so the old password keeps working
   until then. Same moment: GitHub → repo Settings → Secrets → Actions → update `NEXUS_PASSWORD` to the new value.
4. **`.env.local` on the PC**: the same names, with `BETTER_AUTH_URL=http://localhost:3100`, plus `AUTH_FULL_LOCAL=1`
   (lets Claude Code test passkeys + recovery locally).
5. Optional: Cloudflare → Turnstile → Add widget (hostnames `nexus-ashen-beta.vercel.app`, `localhost`, mode Managed)
   → `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` in Vercel + `.env.local`.
6. Testers: 5–10 Gmail addresses (added as test users in step 1; invite codes are made in the app after release).
7. Release day (R15 Part G): download a backup from the app first; be there to sign in with Google on PC and phone.

---

## Part 0 — Safety net (do first)

### 0.1 [ ] Prod snapshot and a migration rehearsal path
- `scripts/db-snapshot.mjs`: **read-only** copy of the prod Turso DB (from `.env.local`) into `snapshots/prod-<date>.db`
  (gitignored, never committed): every table, every row, then `PRAGMA integrity_check` and a row count per table
  printed as a table. No writes to the source — open it with a read-only query path and assert no statement other
  than `SELECT` / `PRAGMA` is sent.
- `scripts/db-restore-test.mjs`: restore the existing `/api/backup` JSON into an empty file DB and compare counts
  (proves the backup path works before we need it).
- `scripts/db-restore-prod.mjs <snapshot>`: the emergency path for Part G — writes a snapshot back to the Turso DB
  from `.env.local`. Refuses to run without `--i-am-tal-and-prod-is-broken`, prints the counts it will write and waits
  for typed "restore". Test it end-to-end against a **second, throwaway** libSQL file/DB, never prod, in this round.
- **Acceptance:** all three run green locally; counts printed in "## Open" (counts only, no content).

---

## Part A — Sign-in (Better Auth)

### A1. [ ] Better Auth in, the shared password out (with a guarded fallback)
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

### A2. [ ] Sign-in screens = the mockups
Mockups: `SignIn-desktop` (`Main` on the canvas), `SignIn-phone`, `SignIn-he` (Hebrew RTL), `Recovery-phone`, `AddPasskey-phone`.
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

### A3. [ ] Invite-only sign-up + waitlist
- Table `signup_invite` (`MULTIUSER.md` §3): hashed code (format `XXX-XXXX`, no look-alike characters), note, max
  uses, uses, expires, revoked. A space invite link (C2) also counts as a sign-up invite.
- The code or `/join/<token>` survives the Google redirect in a short-lived, signed, `HttpOnly` cookie (10 min).
- New Google user without a valid invite → no user row is created; show `InviteOnly-phone`: code field, "Add me to the
  waitlist" (table `waitlist(email, created_at, ip_hash)`; Turnstile when keys exist; rate-limited), "Use a different
  Google account".
- Admin (only `ADMIN_EMAIL`) gets **Settings → Invites**: create a code (note, uses, expiry 14 days default), copy,
  revoke, see who used it, see the waitlist. (The full admin panel is R16.)
- **Acceptance:** tenancy-style smoke: unknown Google user without invite → no `user` row; with a valid code → user +
  personal space; a used-up / revoked / expired code → refused with a clear message.

### A4. [ ] First sign-in creates the personal space
Every new user gets exactly one personal space ("<first name>", kind `personal`, currency ILS, can't be deleted,
shared or left). Tal's existing data becomes **his** personal space via the migration (B2), linked when he first signs
in with Google as `ADMIN_EMAIL`.

### A5. [ ] Settings → Security (devices, passkeys, activity)
Mockups `Devices-desktop`, `Devices-phone`.
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

### B1. [ ] Schema: spaces and `space_id` everywhere
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

### B2. [ ] Migration of today's data (idempotent, rehearsed)
- One migration step (`src/db/migrate-r15.ts`, called from `migrate.ts`): creates the admin user from `ADMIN_EMAIL`
  (no password, no Google link yet), Tal's personal space "Tal", backfills `space_id` / `user_id` /
  `added_by_user_id` on every row, moves the `kv` keys (B1), then sets `space_id` NOT NULL (table rebuild in SQLite if
  needed — inside a transaction, with the row count checked before commit). Re-running it changes nothing.
- Old guest tables (`members`, `grants`, `invites`) are kept read-only (D1).
- **Rehearsal (Session 1 end):** run the migration on the 0.1 snapshot copy. **Acceptance:** row counts per table equal
  before/after, no NULL `space_id`, `PRAGMA integrity_check` ok, a second run is a no-op, the app on that copy shows
  the same To buy / On the way / History counts and budget as prod (compare numbers only). Report the numbers in
  "## Open". Plus a synthetic 2 000-item second space for speed checks (E1).

### B3. [ ] `requireCtx()` + one scoped data layer; every server entry moved
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

### B4. [ ] Server-side fetching guard (SSRF) and security headers
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

### C1. [ ] Space switcher — desktop and phone
Mockups `Switcher-desktop`, `Switcher-phone`.
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

### C2. [ ] Invite links and joining
Mockups `Invite-phone`, `Join-phone`.
- `space_invite`: 32-byte token stored hashed, role **member or viewer** (owners are made by transfer, not invite),
  expiry 7 days, max uses (default 5), revocable. Link `/join/<token>`, share sheet with Copy, native Share, and a QR
  (render the QR client-side; no third-party QR service).
- `/join/<token>`: space name, colour, who invited, member avatars + counts, the role you'd get and what it allows,
  expiry. Signed in → "Join"; signed out → "Continue with Google to join" (counts as the sign-up invite). Already a
  member → straight in. Expired/revoked → a calm message with "Ask <name> for a new link".
- **Acceptance:** smoke: A invites as viewer, B joins, B sees A's shared items read-only; revoke → link dead; over
  max uses → refused.

### C3. [ ] Space settings
Mockup `SpaceSettings-desktop` (phone: the same sections as a full-screen sheet).
- Name, currency, colour (5 swatches). People: role change (owner only), remove (owner only, step-up), "(you)".
- Invite links list with uses/expiry, Copy / QR / Revoke. Note that public read-only list links stay under each
  list's Share.
- Leave space (not for the last owner → "Transfer ownership first"); Transfer ownership (step-up); Delete space
  (owner, typed confirmation of the name, step-up, soft delete with 7-day undo, then purge incl. blobs).
- Settings dialog gets the grouping from the mockup: "<space>" → Space & people; "You" → Account, Security,
  Appearance, Calendar, Assistant (existing sections move under these, nothing removed).

### C4. [ ] Move a list/project to another space; "added by"
- On a list/project: "Move to space…" (spaces where you are member/owner); moves the collection and its items,
  sources, price points, attachments, alerts and receipts in one transaction; undo toast.
- In shared spaces, item rows/cards show a small "added by" avatar (initial + colour); tooltip with the name. Not
  shown in personal spaces.

---

## Part D — Retire (Session 2)

### D1. [ ] Old guest system → notice page
`/g`, `/g/*`, `/i/<token>` show the `GuestNotice-phone` screen ("Nexus now uses accounts — ask <owner> for a new
invite"), with buttons to `/join` help and `/login`. Guest server actions return an error. Tables stay read-only
until R16. The share dialog loses the guest-invite part and keeps public read-only links.

### D2. [ ] Telegram and the extension off — for everyone
UI hidden (settings, alerts panel, commands, Me sheet, help), `/api/telegram` and `/api/ext/*` answer **410 Gone**,
cron no longer sends Telegram digests/weekly summaries, the extension zip link removed from help. Code stays in the
repo. Help text explains that price alerts show in the app (push + inbox arrive in R16). Home "Add items from any
store with the extension" fallback suggestion removed.

---

## Part E — Performance (Session 2)

### E1. [ ] Space-scoped loading stays fast
Bench (existing bench style) on the snapshot copy + the synthetic 2 000-item space: Home and Shopping first load and
the cron run, before (`main`) and after (`round15`). **Acceptance:** after ≤ before + 10 % on Tal's space; the
2 000-item space's Home server time reported. Every new query uses an index (`EXPLAIN QUERY PLAN` check in a test for
the main list queries).

---

## Part F — Guards, CI, docs (Session 2)

### F1. [ ] CI on every push
New `.github/workflows/guards.yml` (push to any branch + PRs): `npm ci`, typecheck, lint, the unit tests,
`test:authz-coverage`, `test:scope`, `test:ssrf`, `test:headers`, `test:tenancy` (on a file DB, mock IdP), `npm audit
--audit-level=high`, gitleaks. Actions pinned by commit SHA. Update `smoke.yml` to sign in via the admin fallback.

### F2. [ ] Docs
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
