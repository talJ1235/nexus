# Security plan — multi-user (Rounds 15 + 16)

Source: Tal, 2026-10-04: "the most serious security standards, impossible to bypass — planned for maximum security,
with good usability and a beautiful look." Companion to `docs/MULTIUSER.md`. The round briefs turn each control below
into an item with an acceptance check.

**Honest framing (told to Tal):** no system can promise "impossible to bypass". What we can promise: a recognised
standard (**OWASP ASVS 5.0 Level 2**, with the Level 3 controls for authentication, sessions and access control),
**defence in depth** (one bug must not be enough to leak another user's data), and **guards that run on every commit**
so a fixed hole can't come back. The design must also hold if the code is public — keeping the repo private is not a
security control.

## 0. Threat model (what we defend against)
1. Another user (or a viewer in a shared space) reading/changing data that isn't theirs (IDOR, missing scope).
2. Account takeover: phishing, stolen session cookie, brute-forced email code, QR-login phishing, account linking.
3. Server-side request forgery through "add by link" (the server fetches any URL a user pastes).
4. XSS / injected script through product titles, store pages, AI output, receipts.
5. Abuse: sign-up spam, AI-quota burning, email bombing via codes, scraping public share links.
6. Prompt injection: a store page or receipt text telling the assistant to do something.
7. Leaks from us: secrets in git, PII in logs/error reports/push payloads, public blob URLs, admin over-reach.

## 1. Findings in today's code (fix in R15)
- **No SSRF guard.** `src/lib/extract.ts:66` fetches the pasted URL with `redirect: "follow"` — fine for one owner,
  dangerous with strangers (internal addresses, cloud metadata, redirect tricks).
- **No security headers / CSP** in `next.config.ts`. Two inline scripts (`src/app/page.tsx` `CARRY_SCRIPT`,
  `src/components/boot-screen.tsx` `MODE_SCRIPT`) must get a nonce.
- **Nothing is scoped by owner** (see MULTIUSER §2) and server actions don't validate input shapes consistently
  (`zod` is installed — use it everywhere).
- Shared HMAC secret also derives the extension token (`src/lib/ext-token.ts`) — retired with the extension.
- Blobs are public, unguessable URLs under `receipts/<itemId>/`.

## 2. Authentication (ASVS V6 / L3 where marked)
- Methods: **passkeys** (WebAuthn, `userVerification: "required"`, resident keys, RP ID = final domain) — phishing-
  resistant; **Google** (OIDC with PKCE + state + nonce, only `email_verified` accounts); **email code for recovery**.
- Email code: 6 digits from a CSPRNG, stored **hashed**, single use, 10-minute life, max 5 attempts then a new code is
  needed, max 3 codes per email per hour and per IP; **same response whether or not the email exists** (no account
  enumeration); only for existing accounts; after a recovery sign-in the user must add a passkey before anything else,
  and every other session gets an email + push "Your account was recovered — wasn't you? Lock it."
- **Step-up (re-authenticate within the last 10 minutes)** before: adding/removing a passkey, unlinking Google,
  changing email, deleting the account or a space, transferring ownership, approving a desktop QR login, every admin
  write. Re-auth = passkey or Google prompt.
- **Admin accounts (L3): passkey required**, no recovery by email code alone (recovery for admin = a second passkey /
  printed recovery codes generated once, stored hashed).
- Account linking: a Google identity links to an existing user only when the Google email is verified and equals the
  user's email; otherwise a new account flow (invite required).
- New-device sign-in → notification (inbox + push + email) with "Sign out that device".
- Waitlist and email-code request protected by **Cloudflare Turnstile** (free, privacy-friendly CAPTCHA) — invisible
  for normal users.

## 3. Sessions (ASVS V7)
- Random 256-bit session tokens, stored **hashed** in the DB; cookie `__Host-nexus_session`: `Secure; HttpOnly;
  SameSite=Lax; Path=/`, no `Domain`.
- Idle timeout 30 days, absolute 90 days, rotated on sign-in, on step-up and on role change.
- Every request checks the DB session (cached ≤ 60 s): sign-out, "sign out everywhere", ban, password-less recovery and
  account deletion take effect immediately.
- Settings → Devices: device, approximate place, last seen, sign-in method; sign out one / all others.
- Security activity log visible to the user (last 90 days): sign-ins, new devices, passkey changes, recoveries,
  role changes, invites used.

## 4. Access control (ASVS V8 — the core)
- **Deny by default.** Every server action and route starts with `requireCtx(need)`; a lint/test fails the build when
  an exported server action or route handler lacks it (`test:authz-coverage` — enumerates the exports automatically, so a
  new action can't be forgotten).
- **One scoped data layer** (MULTIUSER §4.2): queries always filter by `space_id` from the session, never from input;
  foreign ids → 404. `test:scope` fails on raw table access outside the layer.
- **Role matrix test**: for every action × role (owner / member / viewer / outsider / signed-out / banned) the expected
  allow/deny is asserted; viewers can't write anything, members can't manage members or delete the space.
- **Tenancy smoke** with two real users (MULTIUSER §4.2) runs in CI on every push.
- Ids: `nanoid(21)` (≈126 bits); share/invite tokens 32 bytes, stored hashed, revocable, expiring.
- Public read-only links `/s/<token>`: no names/emails/prices history beyond the list, `noindex`, rate-limited,
  revocable, optional expiry.

## 5. Input, output, injection (ASVS V1/V2/V3)
- **Validate every input with zod** at the action/route boundary (types, lengths, enums, URL shape); reject unknown keys.
- Drizzle parameterised queries only; no string-built SQL.
- React escaping everywhere; any rendered markdown (assistant, help) goes through a sanitiser (DOMPurify) with a tight
  allow-list; links get `rel="noopener noreferrer"`, only `http/https/mailto` schemes.
- **CSP** (enforced, not report-only): `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic';
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com;
  img-src 'self' data: blob: https:; connect-src 'self' <blob/turso hosts>`; report violations to an endpoint that logs
  counts (admin "System").
- Other headers: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera only self, everything
  else off), `Cross-Origin-Opener-Policy: same-origin`.
- CSRF: SameSite cookies + Next.js server-action Origin check + Better Auth `trustedOrigins`; every non-GET route
  checks `Origin`.

## 6. Server-side fetching (SSRF)
- One `safeFetch()` used by extract, pictures, barcode lookups: only `https:`/`http:` on ports 80/443; resolve DNS and
  **block private, loopback, link-local, CGNAT, multicast and metadata ranges (IPv4 + IPv6)**; redirects followed
  manually (max 5), each hop re-checked; 10 s timeout; 5 MB body cap; no cookies/credentials; user agent honest.
- Test `test:ssrf`: localhost, 127.1, 0x7f000001, `[::1]`, 169.254.169.254, 10/8, 192.168/16, a DNS name that resolves
  to a private IP, and a public URL that redirects to a private one → all refused.

## 7. Rate limits and abuse
- Stored in the DB (serverless-safe), per user and per IP: sign-in/code 5/min, code requests 3/h per email, invites
  20/day, link extraction 60/h, uploads 30/h, AI by the daily quota, push subscriptions 10/user.
- Vercel WAF (Hobby: 3 custom rules) — one rule for `/api/auth/*` bursts.
- Invite-only sign-up; space invites expire in 7 days and have max uses.

## 8. Files
- Upload route: session + edit role; content-type allow-list (JPEG, PNG, WebP, HEIC, PDF), magic-byte check when
  processed, 20 MB cap, no SVG/HTML; path `spaces/<spaceId>/…` with a random suffix.
- If the pinned `@vercel/blob` supports private blobs on Hobby → private + an auth-checked proxy route; otherwise
  unguessable URLs + never expose them outside the owning space.

## 9. AI safety
- The assistant only proposes actions; **every write needs the user's tap** (already the design — keep it a rule and
  test it); actions run with the caller's `ctx`, so injection can't cross spaces.
- Store-page text, receipts and product titles are wrapped as untrusted data in prompts; the model never gets names,
  emails or member lists; output is rendered through the sanitiser.

## 10. Data protection & privacy
- Minimise: store only name, email, picture from Google; no analytics trackers; essential cookies only.
- Logs and client error reports: strip tokens, emails, cookies, URLs' query strings; keep 30 days.
- Push payloads carry no prices or item names on the lock screen when the user picks "private notifications" (default
  on for shared spaces).
- Delete account / export (MULTIUSER §4.9); backups encrypted, kept 30 days, deletion propagates within that window.
- Admin sees counts and reports, **never content**; every admin action is in the audit log.

## 11. Secrets & supply chain
- Secrets only in Vercel env / `.env.local`; rotate `BETTER_AUTH_SECRET` and Google secret if ever exposed.
- CI on every push: `npm audit --audit-level=high`, **gitleaks**, **Semgrep CE** (free static analysis — replaces
  GitHub CodeQL, which isn't free on private repos), dependency review; GitHub Actions pinned by commit SHA; Dependabot.
- Lockfile committed; new dependencies need a one-line reason in the brief's Open.

## 12. Verification before inviting anyone
1. `test:security` suite green: headers + CSP, cookie flags, CSRF, SSRF list, rate limits, OTP brute-force lockout,
   session revocation, step-up, authz coverage, role matrix, tenancy.
2. **OWASP ZAP baseline scan** against the local server in CI — no high/medium findings.
3. **Independent red-team pass:** a separate Claude Code session with only this file + the code, told to break tenancy,
   sessions, QR login and SSRF; every finding becomes a test before it's fixed.
4. Security checklist in the round's Open with each ASVS area ticked or explained.
5. Optional before opening beyond the closed circle: a paid external penetration test.

## UX rules that keep security friendly
- Default path is one tap: Google or passkey (Face ID / fingerprint). No passwords, no SMS.
- Step-up prompts are rare (only the sensitive actions above) and use the same passkey tap.
- Security messages are calm and specific ("New sign-in on Chrome · Windows · Tel Aviv — was this you?") with one
  clear action.
- Screens are designed first on the design canvas (sign-in, invite/join, add passkey, recovery, devices, security
  activity, QR approve with number matching) — phone + desktop, both palettes, light + dark.
