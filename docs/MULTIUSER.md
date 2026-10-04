# Multi-user — the full plan (Rounds 15 + 16)

Source: Tal, planning chat 2026-10-04 (account B). Source of truth for every multi-user decision; the round briefs
`docs/ROUND15.md` / `docs/ROUND16.md` are cut from this file after Round 14's "## Open" is read.
Security controls: `docs/SECURITY.md` (OWASP ASVS 5.0 L2 + L3 for auth/sessions/access control).
Not legal advice — the privacy items are a sensible baseline, Tal checks the policy text with someone qualified before
opening to strangers.

## 1. Decisions (Tal, 2026-10-04)
| Topic | Decision |
|---|---|
| First users | **Closed circle** (family + friends, 10–30). Sign-up only with an invite code or a space invite; everyone else sees a waitlist line. |
| Data model | **Spaces.** Every user gets a personal space; a user can create a shared space (household) and invite people. All shopping data belongs to a space. |
| Space roles | **Owner** (everything incl. delete space, manage members) · **Member** (add/edit/delete all data) · **Viewer** (read only). |
| Sign-in | **Google** + **passkey**. **Email code only for recovery** (no Google / lost devices → code by email → add a new passkey). No passwords. |
| Desktop login | **QR from the phone** (already decided): desktop shows a QR, a signed-in phone scans and approves. |
| Existing sharing | **Editing needs an account.** Invite link → sign up → join the space. Public read-only list links (`/s/<token>`) stay. Old guest system (members/grants/invites + `/g`) is retired. |
| Tal's data | **Moves to Tal's Google account** — becomes his personal space; Tal is admin. Full backup before. |
| Telegram + extension | **Off for everyone, Tal included**, from Round 15. Hidden in the UI, endpoints answer 410, cron stops calling them. Code stays (deleted later if not revived). Consequence: blocked stores are no longer price-checked. |
| Notifications | **Web push from the PWA + an in-app inbox** (bell). Replaces Telegram alerts, budget nudges and the weekly summary. |
| AI cost | **Daily quota per user** (default 40 AI calls/day, Tal edits per user in admin; admin unlimited). Over quota → rules-only + a quiet note. |
| AI privacy | **Disclose + minimise.** Free Gemini tier may use prompts to improve Google's models (incl. human review). Privacy policy says so; per-user "AI off" switch; names, emails and space/member names never go to a model. |
| Onboarding questions | Why are you here (home shopping / supermarket / projects & hobbies / price tracking) · stores you buy from · monthly budget + currency · who you shop with (alone / partner / family → offer a shared space + invite). |
| Admin panel | Users + invites · AI usage & cost per user/provider + quota · reports from all users · metrics & system health. |
| Split | **Two rounds**: R15 foundation, R16 product layer. Tal tests between them. |
| Where you sign up | **Phone and website, same flow** (Tal 2026-10-04). Today the phone app is the PWA = the same site, so one flow covers both; the R18 Android wrapper must keep it working (§4.10). |
| Hosting | **Stay on Vercel** for the closed circle (Tal asked for alternatives, 2026-10-04 — comparison in §8). Revisit before any commercial use: Vercel Pro, or Netlify (free tier allows commercial use, credit-capped). |

Planner decisions (Tal can overrule):
- **Sharing is per space**, not per list. To share one list with someone, put it in a shared space (lists can be moved between spaces). Public read-only links per list remain.
- **Auth library: Better Auth** (Drizzle adapter, libSQL/Turso). Plugins: Google social, passkey, email OTP, organization (= spaces, roles, invitations), admin (ban, roles), rate limiting, session list. Builder pins versions and checks each plugin exists in the pinned version; QR login uses its device-authorization plugin if suitable, otherwise a small custom flow (§4.4).
- **One database**, a `space_id` column on every data row (denormalised also on child rows for cheap scoping and simple guards). No DB-per-user (free-tier Turso limits, migrations ×N).
- **Admin never reads users' content** — counts, sizes, usage and reports only. No "view as user".
- Languages: Hebrew + English as today; currency per space (budget), display currency per user.
- Vercel Hobby is non-commercial — fine for a free closed circle; any paid plan or ads needs Vercel Pro first.

## 2. Today's code (what has to change)
- Auth = one shared password (`APP_PASSWORD`) → stateless HMAC cookie `nexus_session` (`src/lib/session.ts`, `src/lib/auth.ts` `assertOwner()` — 67 calls in 16 files; `src/proxy.ts`). Guests: `nexus_guest` cookie + `members/grants/invites` tables (`src/lib/guest*.ts`, `/g`, `/i/<token>`).
- **Nothing is scoped.** `ownerId` exists only on `collections` and `items` and is never read. `getAppData()` / `loadItems()` (`src/lib/data.ts`) select every row of items, sources, price points, attachments, alerts, alt groups, store settings.
- Tables with no owner at all: `sources, price_points, attachments, alerts, alt_groups, store_settings, receipts, reports, conversations, conversation_messages, memories`.
- `kv` mixes three kinds of state: system (`ai:health`, `pref:last_check`), owner prefs (`pref:alerts`, `pref:owner`, `pref:memory`, `pref:home:*`, `pref:import-limit`, `profile:v1`), space data (`pref:budget:YYYY-MM`), plus Telegram token/chat and `barcode:*` cache.
- Extension token is derived from `SESSION_SECRET` (one token for everything). Blob upload route checks the owner cookie; blobs are `access: "public"` under `receipts/<itemId>/…`.
- Daily cron (`/api/cron/prices`) runs everything for "the owner": checks, digest via Telegram, weekly summary, profile.

## 3. Data model (Round 15)
New tables (names indicative; Better Auth generates its own `user / session / account / verification / passkey / organization / member / invitation`):
- **Space** = Better Auth organization + extra columns: `kind` (personal | shared), `currency`, `created_by`. Exactly one personal space per user, created at sign-up, can't be deleted or shared (except by deleting the account).
- **Membership**: `member(user_id, space_id, role owner|member|viewer)`.
- **space_invite**: hashed token, role, expiry (7 days), max uses, created_by, revoked_at. Link `/join/<token>`.
- **signup_invite** (closed circle): hashed code, note ("for Dana"), max uses, used_by, expires; admin creates them. A space invite also counts as a sign-up invite.
- **user_pref**: `(user_id, key, value)` — replaces owner-level `kv` keys (`pref:alerts`, `pref:memory`, `pref:home:*`, display currency, language, AI on/off, onboarding answers).
- **space_pref**: `(space_id, key, value)` — `pref:budget:*`, `pref:import-limit`; store settings stay a table with `space_id`.
- **ai_usage**: `(user_id, day, calls, input_tokens, output_tokens, provider, model)`; quota on `user`.
- **push_subscription**: `(user_id, endpoint, keys, ua, created_at, last_ok_at)` (R16).
- **notification**: `(user_id, space_id, kind, title, body, url, read_at, created_at)` — the inbox (R16).
- **login_request** for QR (R16): id, short code, desktop UA/IP hint, status pending|approved|used|expired, approved_by, expires (2 min).

Columns added: `space_id` (not null after backfill, indexed) on `collections, items, sources, price_points, attachments, alerts, alt_groups, store_settings, receipts, conversations, conversation_messages`; `user_id` on `conversations, memories, reports` (assistant chats and memory are **personal** — per user *within* a space for chats, per user for memory); `added_by_user_id` on `items` (replaces `added_by_member_id/added_by_name`). Drop `owner_id` after backfill. Composite indexes `(space_id, status)`, `(space_id, created_at)`.

`kv` keeps only system keys (`ai:health`, `pref:last_check`, `barcode:*` cache — product data shared by everyone, no personal data).

## 4. How it works

### 4.1 Sign-in
- `/login`: "Continue with Google" · "Sign in with a passkey" · small link "Lost access?" → email → 6-digit code (10 min, 5 tries, rate-limited) → signed in → forced "Add a passkey on this device" screen.
- First Google sign-in without an account → needs an invite code or a `/join/<token>` link in the same flow (kept in a short-lived cookie through the OAuth redirect); otherwise "Nexus is invite-only for now — leave your email" (waitlist row, admin sees it).
- After the first sign-in on a phone/desktop: offer "Add a passkey" once (skippable).
- Sessions: database sessions (Better Auth), 60 days sliding; Settings → Devices lists them (device, last seen, "sign out" per device / "sign out everywhere").
- Old `nexus_session` cookies stop working when R15 deploys (one re-login for Tal).
- **Lock-out guard:** until `GOOGLE_CLIENT_ID` + `BETTER_AUTH_SECRET` are set in Vercel, `/login` still shows the old password form and it signs in as the admin user (`ADMIN_EMAIL`). Removed in R16 once Tal confirms Google sign-in works on prod.
- **Passkeys are bound to the domain.** Enable passkey registration only on the final domain (`NEXT_PUBLIC_APP_URL`); on `*.vercel.app` hide it.
- **Before the domain exists (Tal 2026-10-04: name not final, no domain yet)** R15 still ships, in "closed-circle mode": the app runs on its `*.vercel.app` address; sign-in = **Google only** (OAuth client left in *Testing* with the testers' emails as test users, max 100 — no domain verification needed); passkeys and email-code recovery stay hidden behind `NEXT_PUBLIC_APP_URL` + `RESEND_API_KEY` and switch on automatically once the domain exists (Resend can't send to other people without a verified domain). Admin keeps the password fallback until then. Every passkey/recovery code path is built and tested in R15 on localhost.
- **Brand name in one place:** `APP_NAME` (+ i18n strings, manifest, emails, icons alt text) read from one config, so renaming from Nexus to the final name is a one-line change.

### 4.2 Scoping — the core guarantee
- Every request resolves a context once: `ctx = { user, space, role }` (`requireCtx(need: "view" | "edit" | "owner")`), replacing `assertOwner()` everywhere. Current space = cookie `nexus_space`, validated against membership on every request; fallback = personal space.
- All reads/writes go through one data layer (`src/lib/db-scoped.ts` or similar) whose functions take `ctx` and always add `where space_id = ctx.space.id`; writes set `space_id` from `ctx`, never from the client. Loading by id = `where id = ? and space_id = ?` (→ 404, never 403, so ids don't leak existence).
- **Guards that keep it dead:**
  1. Lint/test `test:scope`: fails when `db.select|update|delete|insert` on a data table appears outside the data layer (allow-list for auth, admin counts, cron).
  2. Two-user smoke `test:tenancy`: users A and B (and a viewer V in A's shared space). B calls **every** server action and API route with A's ids → all fail; V tries every write → all fail; A's page HTML/RSC payload never contains B's item titles.
  3. Cron and AI paths get `ctx` explicitly; the AI context builder takes `ctx` and can't load other spaces.
- Blob: upload route requires a session + membership with edit; path `spaces/<spaceId>/receipts/…`; still unguessable public URLs (check whether the pinned `@vercel/blob` supports private blobs on Hobby — if yes, use them and serve through an auth-checked route).

### 4.3 Spaces UX
- Switcher: desktop sidebar top (space name + avatar stack, menu: spaces, "New shared space", "Space settings"); phone: tap the avatar in the header → sheet with spaces. Home, Shopping, Projects, Insights, search and the assistant all follow the current space. Remembered per device.
- Space settings: name, colour, currency, members (role change, remove), invite link (role picker, copy/share/QR, revoke), leave space, delete space (owner; typed confirmation; data deleted after 7 days).
- Move a list/project (with its items) to another space where you are member/owner — the way to share one list.
- "Added by" avatar on items in shared spaces; activity feed is not in scope.
- Supermarket mode (R17) lives inside shared spaces — the household is a space.

### 4.4 QR desktop login (R16)
Desktop `/login` shows a QR (+ 6-character code) for `/approve/<id>`, refreshed every 2 minutes. Signed-in phone opens it → screen "Sign in on Windows · Chrome · near Tel Aviv?" → Approve. **Number matching:** the desktop shows 2 digits, the phone shows 3 choices and the user taps the matching one (stops QR phishing — someone sending you their QR). Desktop polls (or SSE) → gets a new session for that user. One-time, 2-minute expiry, approval requires a recent phone session, rate-limited, the new session appears in Devices.

### 4.5 Onboarding (R16)
After the first sign-in, 4 short screens, each skippable, progress dots, ≤ 60 s total: (1) why are you here — multi-select, sets Home sections order and default dock; (2) stores — logo grid + search, seeds store list and suggestions; (3) monthly budget + currency — sets the space budget; (4) who you shop with → offers "Create a shared space" + invite link. Then a small "Try: paste a link or scan a barcode" empty state (R13 A7). Answers are user prefs, editable in Settings; the assistant may use them (not names).

### 4.6 Notifications (R16)
- Web push (VAPID, `web-push` package): ask permission only after a meaningful moment (first watched item / first "on the way"), never on first load. iPhone: push only works when the PWA is added to the Home Screen (iOS 16.4+) — onboarding shows a one-line hint on iOS Safari.
- Kinds: price drop / target reached / back in stock, ETA today / delivered, budget pace, weekly summary (Sunday). Per-kind toggles in Settings. Same items always land in the inbox (bell) even without push.
- Cron: one pass per day (Hobby limit) — checks every watched link once even if many spaces track the same URL (dedupe by `normalized_url`), then fans alerts out per space → per member.

### 4.7 AI quota & privacy (R16)
- Every model call goes through one function that: checks the user's AI switch and quota, strips names/emails/space & member names from the prompt context, records `ai_usage`, and on quota/provider failure returns the rules-only answer with a reason.
- Home "Nexus suggests" AI phrasing counts as 1 call/day; the assistant 1 per message; receipt reading 1 per receipt.
- Settings → Privacy: AI on/off, memory on/off (exists), download my data (existing export, scoped), delete my account.

### 4.8 Admin panel `/admin` (R16; role from `ADMIN_EMAILS` env)
- **Users**: name, email, joined, last seen, spaces, items count, AI calls today/30 d, status; actions: ban/unban, reset quota, set quota, delete. **Invites**: create sign-up codes (note, uses, expiry), revoke, see who used them. **Waitlist**.
- **AI**: calls and tokens per day per provider/model, per-user top list, failure rate, estimated cost if it were paid.
- **Reports**: every user's reports (existing reports UI, now with reporter + space), status changes.
- **System**: DAU/WAU, sign-ups per week, DB size and row counts per table, cron last run summary, client error count, AI provider health.

### 4.9 Privacy & account lifecycle (R16)
- Pages `/privacy` and `/terms` (Hebrew + English): what is stored, Google sign-in data used (name, email, picture), AI providers and the free-tier caveat, Vercel/Turso/Blob/Resend as processors, retention, deletion, contact email. No analytics/ads cookies → no cookie banner needed (only essential cookies).
- Delete account: typed confirmation → sign out everywhere → personal space + its blobs deleted; in shared spaces the user's items stay (re-attributed to "former member"); sole owner of a shared space must transfer ownership or delete it first. Purge after 7 days (undo window).
- Export: JSON + Excel of everything in spaces the user owns, plus their own chats/memory.

### 4.10 Phone and web (sign-up anywhere)
- One auth flow for the website and the installed PWA; every screen is designed phone-first (360/390) and desktop (1366).
- Google sign-in uses a full-page redirect (not a popup) so it works in an installed PWA on Android and iPhone.
- Passkeys are created on whichever device the user is on; the sign-in screen offers "Use a passkey from another device" (the browser's QR/hybrid flow) automatically.
- R18 Android wrapper (Capacitor): Google blocks its sign-in inside embedded WebViews, so the wrapper opens sign-in in a Custom Tab (system browser) and returns by an App Link `https://<domain>/auth/app-callback` that hands a one-time code to the app; passkeys there go through Android Credential Manager. R15 keeps the auth endpoints ready for this (no reliance on popups or third-party cookies).

## 5. Migration of today's data (Round 15)
1. Before deploy: full backup (`/api/backup` + Turso dump), stored outside the repo; restore path tested locally on a copy.
2. Migration creates the admin user from `ADMIN_EMAIL` (no password), Tal's personal space "Tal", backfills `space_id` on every row and `user_id` on chats/memories/reports, moves owner `kv` keys → `user_pref` / `space_pref`.
3. First Google sign-in with `ADMIN_EMAIL` links the Google account to that user.
4. Old guests: `members/grants/invites` are kept read-only for one round; `/g` and `/i/<token>` show "Nexus now uses accounts — ask <owner> for a new invite". Dropped in R16.
5. Idempotent and tested on a copy of the prod DB shape (local file DB seeded by the existing test data + a synthetic 2 000-item space for speed).

## 6. Round split
**Round 15 — foundation (one user must not see another's data; Tal keeps working)**
- A. Better Auth: Google, passkey (final domain only), email-OTP recovery, invite-only sign-up + waitlist, Devices, lock-out guard.
- B. Data isolation: schema + migration (§3, §5), `requireCtx`, scoped data layer, all 67 `assertOwner` sites and every route moved, blob paths, cron per space; `test:scope` + `test:tenancy`.
- C. Spaces: personal + shared, roles, invite links `/join`, switcher (desktop + phone), space settings, move list between spaces, "added by" avatars.
- D. Retire: guest system (notice pages), Telegram + extension off (UI hidden, 410, cron skip, help text updated).
- E. Performance: home and shopping pages load only the current space (indexes); bench before/after on the 2 000-item space.
- Acceptance highlights: tenancy smoke green; Tal's data intact after migration (row counts per table equal); sign-in works with Google on prod; 360/390/1366, light/dark for the new screens.

**Round 16 — product layer**
- A. Onboarding questionnaire. B. QR desktop login. C. Web push + inbox + per-kind settings (replaces Telegram alerts/weekly). D. AI quota, usage log, PII stripping, AI switch. E. Admin panel. F. Privacy/terms pages, delete account, export. G. Remove the password fallback and the old guest tables.
- **Mockups first, before R15** (Tal 2026-10-04: security with good UX and a beautiful look): R15 screens — sign-in, invite/join, add passkey, recovery, waitlist, space switcher, space settings, devices, security activity; R16 screens — onboarding (4), QR approve, inbox, notification settings, admin, privacy. Phone + desktop, both palettes, light + dark, on the design canvas; Tal approves before the brief.

Then: R17 supermarket mode (inside shared spaces) → R18 Android wrapper + testers.

## 7. Tal's checklist before Round 15 ships (step by step in the chat)
1. **Name** — candidates (2026-10-04): `Karto` (planner's pick), `Carty`, `Shopix`. Not final; R15 can ship before it is (§4.1 closed-circle mode). Needed before the domain, the Google consent screen branding and the public launch.
2. **Domain** — after the name is final (not needed for R15 in closed-circle mode); buy it (e.g. Cloudflare Registrar), connect to Vercel (Project ← Settings ← Domains).
3. **Google Cloud** — new project → Google Auth Platform: branding (app name, support email, logo, privacy/terms URLs on the domain), audience **External**, scopes only `openid email profile` (non-sensitive → no security review; calendar scopes stay out), OAuth client "Web application" with redirect `https://<domain>/api/auth/callback/google` (+ `http://localhost:3000/...` for dev) → Client ID + secret into Vercel env. Publish to production (with basic scopes no 100-test-user cap).
4. **Resend** — account, add + verify the domain (DNS records in Cloudflare), API key into Vercel env. Free tier: 3 000 emails/month, 100/day — plenty for recovery codes and invites.
5. Vercel env: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL(S)`; R16 adds `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
6. **Cloudflare Turnstile** (free) — site key + secret for the waitlist and email-code forms (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`).
7. **Support email** on the domain (e.g. Cloudflare Email Routing → your Gmail) — needed for the Google consent screen, privacy page and Resend sender.
8. **Admin recovery** — after first sign-in, register two passkeys (phone + PC) and print the one-time recovery codes.
9. **Privacy policy + terms** — planner drafts them (Hebrew + English); Tal reads and approves; ideally a lawyer glance before opening beyond the closed circle.
10. **First testers list** — 5–10 names for the first invite codes.
11. Make the repo private before inviting anyone (ENVIRONMENT.md has the steps and consequences); re-run `gitleaks`.

## 8. Hosting — why Vercel for now (checked 2026-10-04)
| Option | Free tier | Fit for Nexus |
|---|---|---|
| **Vercel Hobby** (today) | 1M function calls, 4 CPU-h, 100 GB transfer, 5 min functions, 10 GB function storage; **non-commercial only** | Made by the Next.js team, zero migration, Blob + cron already used, `sharp` works. Limits: non-commercial, storage cap (housekeeping), daily cron |
| Vercel Pro | $20/month | Same, commercial allowed — the natural step when Nexus charges money |
| Netlify Free | 300 credits/month, hard cap (site pauses when used up); commercial use not restricted | Next.js supported via adapter; move Blob → Netlify Blobs, cron → scheduled functions. Real option later |
| Cloudflare Workers (OpenNext) | 100k requests/day, very small CPU time per request | Cheapest at scale, but `sharp` doesn't run there and Next.js usually needs the $5 paid plan; biggest rewrite |
| Own server (VPS + Coolify) | ~€5/month | Full control, but Tal maintains the server, security patches and backups himself — not recommended now |

Decision: stay on Vercel through the closed circle; before any paid/commercial use choose Vercel Pro (no work) or Netlify (some work). Keep the code portable: no new Vercel-only features without a note in the brief.
