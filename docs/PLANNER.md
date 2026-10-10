# Planner playbook — how the planning chat works on Nexus

Read this first if you are the **planning** Claude (claude.ai chat / Project "Nexus"), whichever account you run on.
Claude Code (the builder) reads `CLAUDE.md`; this file is for the chat that talks with Tal, designs, researches and
writes the round briefs. Everything durable lives in this repo, not in chat history.
Setup of this chat (network, GitHub connector, rebuilding it on a new account): `docs/ENVIRONMENT.md` — any change
to setup, tooling or workflow is recorded there in the same session.

## Current state & handoff (updated 2026-10-10 → read this first on any account)
- **2026-10-10:** **R17 Session 3 merged and live** (notifications: inbox, web push, reminder card, senders, settings,
  admin counts; results in `docs/ROUND17.md` Open "### Session 3"). Planner reviewed the builder's decisions — all
  accepted (4 reminder cards 3/7/14/30 with onboarding's "Not now" as the first; never-asked users get one card; one
  weekly summary per person, skipped when empty; hourly 20 s price slice). Tal chose (2026-10-10): price pushes to
  owner + members only (not viewers); bring back "Check now" as an action on the item page (drop % stays 5, no picker)
  — both go into the S2 + S3 fix round. `hourly.yml` ran green once by hand (Tal); secret not yet confirmed in the log.
  **Tal to do:** VAPID keys → Vercel (Production) + redeploy; GitHub secret `CRON_SECRET` (= Vercel's; if Vercel hides
  it, set a new value in both). **Next:** Tal tests (push needs another member's action — e.g. Noa starts a shopping
  trip) → notes → one fix round for S2 + S3, incl. the prod smoke step "category filter narrows the grid" and the S2
  Open items (top Skip → Home, desktop install QR, unchecked "if paid" prices).
- **2026-10-09 (late):** **R17 Session 3 boards v2 approved** (canvas "Nexus R17 — Notifications v2", private Design
  artifact on the account that made it) and copied to `docs/design/r17/` (`Main` → `Inbox-desktop`, `Inbox-phone`,
  `Permission-*`, `Push-previews`, `Settings-notify-phone`, `nx18.css`). Brief written: `docs/ROUND17-S3.md` (own file;
  results still go to ROUND17 "## Open") (Parts J plumbing, K inbox, L permission, M senders, N settings/admin, O guards). **Next:** Tal runs Session 3 with
  the prompt below; after the run Tal copies the VAPID keys to Vercel + adds GitHub secret `CRON_SECRET`; then the
  S2+S3 fix round from Tal's phone/PC notes.
  ```
  Round 17, session 3 (docs/ROUND17-S3.md) — Parts J, K, L, M, N, O, unattended, on branch round17-s3. Boards
  are in docs/design/r17/ (interactive — use their Tweaks). Step 0, now while I'm here: make sure
  .claude/settings.local.json allows "Bash(git push origin round17-s3)", "Bash(git push -u origin round17-s3)",
  "Bash(git merge --ff-only round17-s3)", and generate the VAPID keys into .env.local (never the repo). Then go
  through all parts without stopping. Merge to main only if everything is green and the migration rehearsal passes.
  ```
- **2026-10-09 (evening):** **R17 Session 2 merged and live** (`f9482a1`): `/admin` with Live, onboarding A at `/welcome`,
  5 new guards, parity PNGs in `docs/design/parity-r17/` (planner spot-checked Live + onboarding 1–2: match the boards).
  Open for Tal (ROUND17 Open): top Skip leaves to Home (kept); desktop install QR only where the computer can install
  (planner recommends: always show the QR card on desktop); unchecked "if paid" prices + 2 store search links.
  **Next:** Tal tests on phone + PC → notes → small fix round if needed; Session 3 boards (inbox + permission moment) in
  a new chat.
- **2026-10-09:** R17 Session 1 merged and live. **R17 Session 2 boards approved** by Tal and committed to
  `docs/design/r17/` (`Admin-desktop`, `Admin-phone`, `Onboarding-phone`, `Onboarding-desktop`, `nx17.css`; canvas
  "Nexus R17 — Admin & Onboarding" is a private Design artifact on this account). Brief written: `docs/ROUND17.md`
  "Session 2" (Parts G admin incl. Live presence/activity, H onboarding, I guards/docs). **Next:** Tal runs Session 2
  with the prompt below; then the planner makes Session 3 boards (inbox + permission moment), same skills bar.
  ```
  Round 17, session 2 (docs/ROUND17.md "Session 2") — Parts G, H, I, unattended, on branch round17-s2. Boards are in
  docs/design/r17/ (interactive — use their Tweaks). Step 0, now while I'm here: make sure .claude/settings.local.json
  allows "Bash(git push origin round17-s2)", "Bash(git push -u origin round17-s2)", "Bash(git merge --ff-only round17-s2)".
  Then go through all parts without stopping. Merge to main only if everything is green and the migration rehearsal passes.
  ```
- **2026-10-08:** R16 done and live (Sessions 1, 2, G + Android PWA hotfixes 1–4: viewport guard, FedCM Google sheet,
  dismiss stays on /login). Polish audit + all 30 fixes live (`docs/POLISH-AUDIT.md`). **Next: R17 Session 1** —
  brief `docs/ROUND17.md` (no mockups). Then the planner makes mockups for R17 Session 2 (admin + onboarding, 2–3
  onboarding directions) and Session 3 (inbox + permission moment). Roadmap + notification decisions are in ROUND17.
- Tal's decisions 2026-10-07/08 (full list in ROUND17): family after price comparison (R19); R20 = Google Play closed
  testing for Android + Home-Screen install for the one iPhone; notifications automatic, one on/off switch; AI quota
  40/day (admin can change per user); dedicated privacy email; delete account with 7-day undo; admin emergency sign-in
  only; QR login → R20; blocked stores: server-side ladder + Cloudflare Worker (Tal opens a free account); short names
  for long titles incl. existing items; Google Calendar stays ICS for now, faster sync researched later.

- **Blocked stores — parked by Tal (2026-10-09), come back later.** Prod probe (ROUND17 Open "C1 — prod probe"):
  cwc/ksp/rami-levy/payngo etc. run Cloudflare bot management that challenges every datacenter IP, the CF Worker too.
  Free server-side fetching can't pass it. Options offered (not decided): (1) product name from the URL slug,
  (2) price + image from Google results via the existing Serper search, (3) screenshot → share to the app → AI reads it;
  or a paid scraping service. Probe list still has home pages / fake ids — ask Tal for real product links first.

### Earlier (2026-10-07)
- **Prod:** R16 Session 1 (Parts 0, A, B, C — fixes, live sync, error reporting) released 2026-10-07 (`f203591`); results
  in `docs/ROUND16.md` "## Open". `ABLY_API_KEY` is set in Vercel (Production) and Tal checked live sync on prod.
- **In progress:** R16 Session 2 (Parts D, E, F) — **waits for mockups**. Tal chose (2026-10-07) the split:
  - **With boards:** D1 + D3 `Settings-desktop` / `Settings-phone`, D2 `SpaceSettings-desktop` / `SpaceSettings-phone`,
    D5 `SpaceIdentity` (create + edit, icon × gradient, photo crop/zoom/rotate), E1 `HomeCustomize` (presets, S/M/L sizes,
    drag, Reset).
  - **From the brief's text only (no board):** D4 space-switch moment, E2 new Home widgets. The builder builds them from
    `docs/ROUND16.md`; Tal corrects after seeing them. `Presence` board dropped (Session 1 built it from the R15 board).
  - Order: Settings + Space settings + Identity first, then HomeCustomize.
- **Boards approved by Tal (2026-10-07) and committed to `docs/design/r16/`** (board list ticked in `docs/ROUND16.md`
  Part D). Next: Tal runs Session 2 with the prompt below.
- Boards made (2026-10-07, account A). Canvas "Nexus R16 — Settings, Spaces & Home"
  (private Design artifact on account A): 8 boards — `Main` (= `Settings-desktop`), `Settings-phone`,
  `SpaceSettings-desktop`, `SpaceSettings-phone`, `SpaceIdentity-desktop`, `SpaceIdentity-phone`,
  `HomeCustomize-desktop`, `HomeCustomize-phone`; shared `nx.css` (R15, unchanged) + `nx16.css` (R16 additions).
  Tal's answers (2026-10-07, boards updated): settings = **large dialog** (not a full page); Home widgets get width
  S/M/L (phone Half/Full) **and height 1×/2×**; **Notifications** is its own settings section. Planner choices left
  as drawn: space tiles get 6 gradients + 24 icons; new widgets marked NEW in the widget tray. Brief D1/E1 updated. On approval, copy `project/*` to `docs/design/r16/` (rename
  `Main.dc.html` → `Settings-desktop.dc.html` and fix the links to it in `SpaceSettings-desktop`).
- **(Done) planner task — make those boards** in a **new chat** (Tal's rule: one session per task). Canvas
  **"Nexus R16 — Settings, Spaces & Home"** on the current account (canvases are per account). Reuse the R15 look: copy
  `docs/design/r15/nx.css` and the boards' structure (`SpaceSettings-desktop`, `Security-*`, `CreateSpace-*`,
  `Switcher-*`); design language in `docs/ROUND15.md` "Design language" (minimal text, visuals first, light warm brand
  panel, no black hero). Desktop 1366 (no scroll at 1366×768; 1280×720 only People may scroll) and phone 390, light +
  dark, Graphite + Plum, states as tweaks. Settings sections: You — Account & security · Display · Assistant & AI ·
  Calendar · Memory · Data; Space — General · People & invites · Budget · Danger zone. Phone = section list → section
  page (push, back). Space settings: cover band in space colour/photo.
  - After Tal approves: copy boards to `docs/design/r16/` (GitHub connector / sandbox push, or Tal's PC — write files
    only, never run git there; the builder commits them as `R16.0`), tick the board list in `docs/ROUND16.md` Part D, then
    give Tal the Session 2 prompt:
    ```
    Round 16, session 2 (docs/ROUND16.md) — Parts D, E, F, unattended, on branch round16. Boards are in
    docs/design/r16/; D4 and E2 have no board by design — build them from the brief's text. Same "How to run" rules as
    session 1. Merge to main only if everything is green and the migration rehearsal on the prod snapshot copy passes.
    ```
- **Small facts from Tal (2026-10-07):** the A8 "desktop layout after sign-in" happened in the **installed PWA (Chrome)**;
  he isn't handling report `r_rWtP3XmuRl` for now (leave it open, don't nag).
- **Renumbering:** `MULTIUSER.md`/`STRATEGY.md` still say "R16 product layer" — read it as **R17**.
- **After R16:** R17 product layer (push + inbox, onboarding, admin/usage without content, AI quota, privacy/delete/export,
  QR desktop login, remove password fallback + guest tables) — needs its own mockups first (MULTIUSER §6 list).
- **Chat-tool facts (account B, 2026-10-06):** the sandbox clones the public repo fine; `git push` from the sandbox is
  refused by the proxy → push docs with the GitHub connector (`push_files`, full file content; verify by comparing
  `md5sum` with `raw.githubusercontent.com/<sha>/…`). The connector can drop mid-chat; it reconnects on its own.

## Roles
- **Tal** — owner. Decides what and why; tests on his phone/PC; runs Claude Code on his PC.
- **Planner (you)** — turns Tal's notes into a precise brief, does research, design exploration (design canvas) and
  advice. **Never writes app code in chat** (Tal's rule, 2026-09-30: code is written by Claude Code to save tokens and
  keep quality). You may edit docs in the repo (`docs/`, `CLAUDE.md`, `SPEC.md` sections only when fixing docs).
- **Claude Code (builder)** — implements a brief unattended, tests, merges, writes results under "## Open".

## How to talk with Tal
- Reply in **Hebrew**. Mixed Hebrew/English must read cleanly in RTL (Tal, 2026-10-04):
  - Every line, bullet and heading **starts with a Hebrew word** — a leading English word flips the line to LTR.
  - Prefer plain Hebrew words (בדיקה, ענף, מחבר); English only for names: files, commands, products, code terms.
  - Every English name goes in inline code (`` `CLAUDE.md` ``, `` `npm run -s check` ``); first use of a term:
    Hebrew word + code in parentheses, e.g. ענף (`branch`). Don't end a sentence with bare English + punctuation.
  - Multi-word commands, paths and code go in a code block (renders LTR on its own), never inside a Hebrew sentence.
  - Arrows for steps point right-to-left: Settings ← Connectors ← Add.
- Professional, direct, no flattery, no repeating his words back. A trusted advisor: give the honest trade-off and a
  recommendation, disagree when warranted.
- Software: he is a beginner–intermediate → explain step by step, plain words. Hardware/electronics: advanced.
- Keep answers as short as the content allows; tables for comparisons; questions numbered so he can answer "1a, 2b".
- Ask before building only when a wrong guess is expensive (one short batch of questions), otherwise decide and say so.

## The loop (one round)
1. Start: `git pull` the repo; read the latest `docs/ROUND<n>.md` "## Open" (what the last run did/left), `SPEC.md`
   round sections, and only the code files your brief will point at (use `rg`).
2. Tal sends notes (often a voice transcript in Hebrew). Extract every request; keep his wording for intent.
3. Find causes in the code before writing (e.g. "boot once per session" was `sessionStorage`), so the brief names them.
4. Write `docs/ROUND<n+1>.md` (template below), commit as Tal (`user.name "Tal Jacoby"`), push to `main`
   (docs-only pushes don't deploy).
5. Give Tal: a short Hebrew summary per part, anything he must do (keys, photos), and the Claude Code prompt:
   ```
   Round N (docs/ROUNDN.md) — the whole brief, unattended. Same "How to run" rules as Rounds 7–10, on branch roundN.
   Step 0, now while I'm here: make sure .claude/settings.local.json allows "Bash(git push origin roundN)",
   "Bash(git push -u origin roundN)", "Bash(git merge --ff-only roundN)" in addition to what earlier rounds used.
   Then go through all parts without stopping.
   ```
6. After the run, Tal returns with new notes → pull, read Open, repeat.

## Brief template (what made rounds 7–10 succeed)
- Header: source (Tal + date), "source of truth", the unattended rules: branch `round<n>`, commit per item
  `R<n>.<part><k>: …`, push branch per part, never stop to ask → decisions in "## Open", merge `--ff-only` only when all
  green, don't touch power settings, read open reports first.
- Parts A, B, C… by theme; items `### A1. [ ] Title`. Each item: Tal's complaint in one line → known/likely cause →
  exact expected behaviour → constraints → **acceptance** (a measurable check, smoke assertion, bench number, or
  frame trace). Visual items: phone 360/390 + desktop 1366, light + dark, Graphite + Plum.
- Prefer guards that keep bugs dead (e.g. dock-position-per-frame smoke, overflow-at-360 smoke).
- Keys are optional: every feature degrades gracefully without them; say what Tal can add.
- End with `## Open` (empty) — the builder fills it.

## Decisions that stand (don't re-open without Tal)
- Design: UI v2 = design **U**; palettes **Graphite & Amber** (default) and **Plum**, light + dark; one brand colour +
  neutrals, "spark" colour only for the AI; Ask button = **Hairline, always a fully rounded pill** (Tal, 2026-10-04:
  the 8 px square-ish Ask button in the Round 12 "Q" mockups is rejected); logo = **Box**; font Heebo. Details:
  `docs/UI-V2.md`, `docs/ROUND7.md` Part A, mockups `docs/design/*.html`.
- No workarounds that impersonate other clients / third-party fetchers for blocked stores (decided 2026-09-30).
- Pictures: Google Images via **Serper** (`SERPER_API_KEY`), Open Food Facts, own items, icons; extension optional.
- Not wanted: SolidWorks BOM import, item file attachments, event wishlists. Later: parts inventory, monthly "Wrapped".
- **Dashboard is the default home screen** (Tal, 2026-10-03); everything else via the desktop sidebar / phone dock.
- **Home design = "Home v4"** (Tal approved 2026-10-04, replaces v3): mockups `docs/design/home-v4/*.dc.html`, brief `docs/ROUND13.md`.
  Stats set A (left to buy · month budget · on the way · saved) with meters, no sparklines; medium-strength borders; status
  strip of 3 linked tiles; "Nexus suggests" = rules find + AI phrases, with a setting to switch to rules only (multi-user
  cost); Customize (hide/reorder) in R13; no "buy by" date; "This week" strip stays.
- **Phone dock = Home · Shopping (קניות) · + · Projects · Insights** (Tal 2026-10-04); Shopping holds To buy ⇄ On the way
  with list (default, remembered) and grid. One phone search that also finds settings/actions.
- **Opening animation:** 3.0 s, wordmark only, real visuals (cubes gather, faces assemble, dot lands, rings + particles,
  hold with moving background), no skip; phone on app open, desktop first open of the day.
- Desktop sidebar collapses by a button at the top or by dragging its edge.
- Roadmap (Tal 2026-10-04, superseded — see "Roadmap (2026-10-05)"): R13 home/shopping/search/intro → R14 bug fixes → R15 multi-user foundation (site sign-in on
  web + phone, Google + email, desktop QR login, short onboarding questionnaire that adapts the app, per-user data,
  privacy) → R16 Android wrapper + testers. Tal to prepare for R15: domain, Google Cloud OAuth client, Resend, name check.
- **Round 14 decisions (Tal 2026-10-04):** light theme "B · toned" (page `#eeede9`, cards `#f8f7f4`); active nav row = soft
  tint + 3 px spark accent bar (never solid black); logo left face follows the theme (light face in light mode, dark in
  dark, thin edge; Graphite only; app icon unchanged); To buy / Urgent / Unsorted merged into one To buy with filter
  chips; indicators only on Home, Spending, project and store pages; calendar = month view + ICS feed that also removes
  deleted/received events; Home always shows AI or rule suggestions when the account has items. Every visual round now
  ships side-by-side parity PNGs (mockup vs app).
- **Roadmap update (2026-10-04, later; superseded 2026-10-05):** R14 fixes → R15 multi-user foundation → R16 multi-user product layer → R17
  supermarket mode (recurring household purchasing, inside shared spaces, sidebar entry) → R18 Android wrapper.
- **Multi-user (Tal 2026-10-04), full plan in `docs/MULTIUSER.md`:** closed circle first (invite codes); spaces (personal +
  shared household, roles owner/member/viewer, sharing per space); sign-in Google + passkey, email code only for recovery;
  Tal's data moves to his Google account (admin); editing needs an account, public read-only list links stay, guest system
  retired; Telegram + extension **off for everyone** from R15 (alerts → web push + in-app inbox); AI quota per user per day;
  AI privacy = disclose + minimise (free Gemini tier); onboarding = why / stores / budget+currency / who you shop with;
  admin panel = users+invites, AI usage, all reports, metrics. Split into R15 (foundation) + R16 (product layer).
- **Security (Tal 2026-10-04):** "maximum security, can't be bypassed, with good UX and a beautiful look" → `docs/SECURITY.md`:
  OWASP ASVS 5.0 L2 + L3 for auth/sessions/access control, defence in depth, guards in CI, red-team pass before invites.
  Sign-up works on phone and website (same flow; Android wrapper via Custom Tabs later). Hosting stays on Vercel for the
  closed circle. Auth/space screens get mockups **before** the R15 brief.
- **Product focus (Tal 2026-10-04):** the main use is **household purchasing** — shared live lists, supermarket mode,
  recurring buys, supermarket price comparison, household budget — next to products/projects/price tracking.
  Pitch: "The smart way to run your household shopping — shared lists, supermarket mode, prices and budget, all in one place."
- **Name (2026-10-04, not final):** Tal's candidates `Karto`, `Carty`, `Shopix`; planner recommends `Karto` (`Shopix` = an
  Israeli shoppable-content startup; `Carty` = several Shopify cart apps; `Karto` = one small Shopify cart-recovery app).
  No domain yet — R15 ships in closed-circle mode on `*.vercel.app` (Google sign-in only; passkeys + email recovery
  switch on with the domain), brand name kept in one config.
- **Strategy (Tal 2026-10-05), `docs/STRATEGY.md`:** goal = family-and-friends project with business potential; audience =
  households first, some makers. No interviews before an MVP: keep building, the MVP carries the research (onboarding
  answers, in-app feedback, admin metrics, a short survey after 2–3 weeks). **MVP = full set incl. price comparison.**
- **Roadmap (2026-10-05, replaces earlier):** R15 multi-user foundation → R16 product layer (live list, budget, push +
  inbox, feedback, metrics) → R17 supermarket mode v2 → R18 price comparison (transparency files) → closed circle on the
  PWA → Android wrapper. Competitor findings (price comparison is table stakes in Israel; gap = all household buying in
  one place) in `docs/STRATEGY.md` §4.
- Free-tier stack (Vercel Hobby, Turso, Gemini free + Groq/OpenRouter fallback). Tal declined paid usage credits.
- **Auth/space design v2 (Tal 2026-10-05):** minimal text, visuals first; light brand panels only (no black hero); look
  and patterns per `docs/ROUND15.md` "Design language". Applies to R16 screens too.
- **Round 15 plan (Tal 2026-10-05):** mockups first (canvas "Nexus R15 — Accounts & Spaces", copies in
  `docs/design/r15/`), then one brief `docs/ROUND15.md` run in **two unattended sessions** (S1 auth + isolation, S2 spaces,
  retire, performance, guards) and a short **release session with Tal present** — no merge to `main` without him, because
  merging runs the migration on the real DB. Planner choices in the brief (Tal can overrule): space invites give
  member/viewer only (owner by transfer); the admin password fallback stays in closed-circle mode, hardened (only
  `ADMIN_EMAIL`, ≥ 20-char password, rate-limited, logged) and is what the prod smoke uses; Better Auth pinned 1.7.7.
- **Round 16 plan (Tal 2026-10-06):** R16 = Tal's post-release notes (`docs/R16-NOTES.md` → `docs/ROUND16.md`): bugs, live
  shared spaces, error reporting, settings/space screens, Home presets + sizes. Product layer (push + inbox, onboarding,
  admin/usage, AI quota, privacy/delete, QR login, fallback/guest removal) → **R17**; supermarket R18; price comparison R19.
  Live sync = **Ably free tier** (`ABLY_API_KEY`, no content on the wire, per-space token) with a 10 s polling fallback;
  conflicts by row `rev` ("already changed by Noa"). Mockups in parallel: Session 1 (fixes, sync, errors) runs now,
  Session 2 (screens) after Tal approves `docs/design/r16/`. Additive migrations → each session may merge when green.
- **R16 Session 2 mockups (Tal 2026-10-07):** boards only for Settings, Space settings, Space identity and Home customise;
  D4 switch moment + E2 widgets built from text. **Android app wrapper:** not before R17 ships (push, onboarding, QR
  login) — the wrapper (Capacitor) loads the live Vercel site, so web updates reach the app with no store update; only
  native changes (icon, permissions, plugins) need a new Play release. Do it when moving from the family circle to the
  Play closed test (12 testers × 14 days).

- **R17 Session 2 design (Tal 2026-10-09):** onboarding = direction **A** (one question per screen, the picture above
  reacts to the answer; B "live build" and C "chat" rejected); admin panel gets a **Live** view (who is online, phone or
  computer, where in the app, who is shopping, activity counts — never content; privacy page says so); admin **can delete
  an account** (hold-to-delete, 7-day undo); boards carry an English/עברית tweak.
- **Mockup standard (Tal 2026-10-09, all future boards):** always design with the relevant skills from
  `emilkowalski/skills` (copies in `.claude/skills/`: emil-design-eng, apple-design, mobile-native, animate + RECIPES,
  break-ui, review-animations) plus the frontend-design guidance — easing tokens, press feedback, gated hover, reduced
  motion, safe areas, worst-case text. Goal in Tal's words: super professional, super intuitive, UX above everything.

- **R17 Session 3 — notifications (Tal 2026-10-09):** (1) ~~ask again only after a meaningful moment (first price watch, first delivery on the way, someone adds to a
  shared list), at most twice, 14 days apart~~ → replaced by "S3 boards v2" below; (2) "someone is shopping" = one push per trip to the other members, updated in place when they finish ("bought
  12, 3 left"); (3) no Shabbat/holiday quiet for now — night quiet 22:00–07:00 only; (4) weekly summary on Thursday at
  the person's active hour; (5) budget alerts go to the space owner + the members the owner picks (Space settings →
  Budget); (6) action buttons: price drop → Open, delivery today → Received; (7) inbox keeps 30 days, no filters, Today /
  Earlier groups, unread dot; (8) price alerts on **any** drop and/or reaching the target (batched, not one per check);
  (9) admin gets notification numbers (System row + a Live stat). Boards: new canvas "Nexus R17 — Notifications".
- **R17 Session 3 boards v2 (Tal 2026-10-09):** phone inbox is a **full page** (pushed like a Settings section, Back /
  edge swipe), not a bottom sheet; inbox icons must never be clipped (fixed 40×40 media column). The permission ask has
  **no item or price context**: first offer = onboarding step 6 (already built); after "Not now" a generic reminder card
  comes back from time to time — desktop: out of the bell (top-end), phone: above the dock (top of Home kept as a tweak).
  States: reminder · browser asks · on (card leaves by itself) · blocked (how to allow) · iPhone not installed (Home
  Screen guide). `Notification.requestPermission()` only on the card's tap (repeated native prompts get Chrome to
  auto-block the site). Tal chose (2026-10-09): reminders 3, 7, 14 and 30 days after the last "Not now", then stop (the inbox banner +
  Settings switch stay); at most once a day, only on Home, never during a shopping trip; phone card above the dock.
- **R17 S3 follow-ups (Tal 2026-10-10):** price notifications go to the space owner + members, never viewers; "Check now"
  comes back as an action on the item page (no drop-% picker; `minDropPct` stays 5 %). For the S2 + S3 fix round.

## Product direction (discussed 2026-10-03, not started)
- Toward a multi-user product: sign-up on web or app, short onboarding questionnaire (habits, stores), Google sign-in,
  desktop login by QR from the phone, per-user data (schema already owner-aware), privacy policy.
- Phone app: start with a **Capacitor** wrapper (Android first: $25, 12 testers × 14 days closed test), build a proper
  API layer during the multi-user work so a React Native (Expo) app stays possible later. iOS later ($99/yr, 4.2 risk).
- Supermarket focus: Israeli price-transparency files (31 chains; open-source parsers exist), store-section ordering
  learned from shopping-mode check order, templates from history, live shared lists with editing.
- Commercial use needs Vercel Pro and a plan for AI costs. Open question for Tal: who is the first target user?
- Suggested order: stabilise → multi-user foundation → supermarket v2 → Android wrapper → test with 12–20 users.

## Where things are
- Repo `talJ1235/nexus`; prod https://nexus-ashen-beta.vercel.app (auto-deploys from `main`).
- `SPEC.md` (shipped features per round), `CLAUDE.md` (builder rules + map), `docs/ROUND*.md` (briefs + results),
  `docs/UI-V2.md` (design history + motion plan), `docs/design/` (static mockups), `src/lib/help/topics/*.md`.
- Design canvas "Nexus Style Directions" is a private claude.ai artifact on each account (A: original; B: rebuilt 2026-10-04 with Home v4); the exported mockups in
  `docs/design/` are the shareable copy. New design exploration: make a new canvas in your own account.
- Optional env not yet set (as of Round 10): `REPORTS_TOKEN` (read in-app reports), `GITHUB_ISSUES_TOKEN`; check
  `SERPER_API_KEY` status in the latest Open.

## Working from two Claude accounts (coordination)
- The repo is the only shared memory. Chat history, claude.ai memory and design canvases are per account.
- Start of every planning chat: pull, read this file + the latest round's "## Open". Never rely on "what the other
  chat said".
- Any decision made in chat that isn't in a brief yet → add one line to "Decisions that stand" (or "Product
  direction") here and push before ending the chat.
- One round at a time: only one `docs/ROUND<n>.md` is "in progress". The next number is always latest + 1 on `main`.
- Log each planning chat in one line below (date, account A/B, what was decided/written), newest first.

### Planning log
- 2026-10-10 · same chat as the S3 boards · Reviewed R17 S3 results (merged, CI green, rehearsal ok, local smoke 81/81 + 95/95, one pre-existing prod smoke failure). Accepted the builder's decisions; Tal then chose: price pushes not to viewers; "Check now" back on the item page (both → fix round). Gave Tal the VAPID / `CRON_SECRET` steps; `hourly` ran green by hand.
- 2026-10-09 · other account (v1 canvas not editable here) · R17 S3 boards v2 on new canvas "Nexus R17 — Notifications v2": phone inbox → full page, icon clipping fixed (media column was an inline span → 0 px wide), permission boards redrawn without item context as a recurring reminder (desktop from the bell, phone above the dock). Skills used: emil-design-eng, apple-design, mobile-native, animate RECIPES + frontend-design. Tal approved (reminders 3/7/14/30 days then stop; phone card above the dock) → boards in `docs/design/r17/`, brief `docs/ROUND17-S3.md`.
- 2026-10-09 · B · R17 S2 boards: first pass with 3 onboarding directions; Tal chose A, asked for a Live admin view, admin delete, and the emilkowalski skills bar on every mockup → boards redesigned (Live tab + activity stream, hold-to-delete, reactive onboarding scenes, Hebrew tweak). Approved → `docs/design/r17/`, `.claude/skills/animate/` added, brief Session 2 written in `docs/ROUND17.md`.
- 2026-10-07 · A · Tal approved the R16 boards (after widening the settings dialog to 1220 and fixing the People table). Copied to `docs/design/r16/` (`Main` → `Settings-desktop`), ticked the list in `docs/ROUND16.md` Part D, gave Tal the Session 2 prompt.
- 2026-10-07 · A · R16 Session 2 boards made on a new canvas "Nexus R16 — Settings, Spaces & Home" (8 interactive boards, R15 look, 1366×768 desktop / 390 phone, dark + Plum as tweaks). Tal chose: settings as a large dialog, Home widget height 1×/2×, Notifications as its own section → boards + brief D1/E1 updated. Waiting for Tal's final approval → then copy to `docs/design/r16/` and give the Session 2 prompt (see "Current state & handoff").
- 2026-10-07 · A · Caught up after R16 Session 1 release. Tal: Ably key in Vercel, live sync checked on prod; A8 was the installed PWA; report `r_rWtP3XmuRl` left for later. Chose mockups for Settings / Space settings / Identity / HomeCustomize only (D4 + E2 from text); boards made in a new chat. Advised: Android wrapper after R17, web updates flow without store releases. Updated "Current state & handoff".
- 2026-10-06 · B · Tal's usage nearly out → wrote the "Current state & handoff" section above (next steps, Session 1 prompt, mockup board list), new `docs/R16-PLANNING.md` (questions + answers, causes found, notes → items table, realtime research, renumbering note for `MULTIUSER.md`/`STRATEGY.md`). Continue on the other account from "Current state & handoff".
- 2026-10-06 · B · R16 planned from `docs/R16-NOTES.md`. Causes found in code: receipt prices wiped by `statusPatch()` on → To buy (receipt items have no source); "Move to" lists only the space's lists (new space has none); space switch = full page reload (`useSwitchSpace` → `location.replace`) → sidebar jump. Tal chose: notes now, product layer → R17; mockups in parallel (two sessions); Ably for live sync. Wrote `docs/ROUND16.md` (Parts 0, A–F). Next: R16 mockups canvas (settings, space settings, identity + photo crop, switch moment, Home customise/widgets).
- 2026-10-06 · B · R15 released (merged `0091467`; Tal signs in with Google on PC + phone, made shared space "Jacoby Home"). First prod login "button does nothing" = Tal's stale tab/browser — the same page in the desktop app's browser on his PC redirected to Google fine; still frame = Tal's Windows has animations off (`prefers-reduced-motion`). Tal's long test notes (sync, receipt bugs, menus, settings redesign, space identity + photo, home presets, swipe suggestions, error auto-reporting, admin/usage) captured in `docs/R16-NOTES.md` for the next planning chat.
- 2026-10-06 · B · Reviewed R15 Session 2 (C–F ticked, 24 commits on `round15`, "ready to release"). Re-ran here: typecheck + lint, `test:auth`/`otp`/`authz-coverage` (168)/`scope`/`roles`/`ssrf` (trailing-dot fix in)/`query-plans`/`help`, build, `test:tenancy` 42/42 — all green; restore test on the prod snapshot equal. Recommended Tal accept the deviations (letter tiles, grouped settings + separate space dialog, link-only invites until Resend, no session rotation on role change since membership is read per request, receipts stay on move). Next: Part G release session with Tal present.
- 2026-10-06 · B · Reviewed R15 Session 1 (branch `round15`, 11 commits, Parts 0/A/B ticked). Re-ran in the chat sandbox: typecheck + lint, `test:auth`, `test:otp`, `test:authz-coverage` (152), `test:scope`, `test:roles`, build, `test:tenancy` (11/11), `test:headers` — all green. `test:ssrf` fails here only on `http://LOCALHOST./` (sandbox DNS can't resolve `localhost.`; on Tal's PC it resolves to 127.0.0.1 and is blocked) → real gap: `checkUrl()` doesn't strip a trailing dot, so the name-level block relies on the DNS/IP check; fix in Session 2. Accepted the builder's deviations (Better Auth stores the session token unhashed but the cookie is HMAC-signed; brand panel = approved cube-field board; fallback daily limit counts failures; invite codes hashed + encrypted for re-copy; Security/Invite codes as pages). Prod snapshot not taken (builder's guard refused prod reads) → Tal ran it via a one-click `snapshots/run-r15-check.cmd`: snapshot ok (35 statements, all read, integrity ok; items 19, collections 2, receipts 6, conversations 9), rehearsal on the prod copy all PASS (counts equal, no NULL `space_id`, no-op re-run, To buy 8 / On the way 1 / History 10 / budget unchanged, 766 ms). `db-restore-test.mjs` failed only because it runs the migration without `ADMIN_EMAIL` (needs `--env-file=.env.local`) → Session 2 fixes the script and reruns it on `snapshots/prod-2026-10-06.db`.
- 2026-10-05 · B · R15 prep with Tal: screens approved → written into Tal's local checkout `docs/design/r15/` (+ `nx.css`), builder commits them as `R15.0`. On his PC: `.env.local` got the local Better Auth values + 24-char `APP_PASSWORD`, round15 push permissions. Found the local DB is a file (no prod URL) → brief now uses `PROD_TURSO_DATABASE_URL` + read-only `PROD_TURSO_READ_TOKEN` for the snapshot; prod `APP_PASSWORD` + `NEXUS_PASSWORD` change moved to release day. Browser automation of Google Cloud/Vercel refused by the guard → Tal does those by hand.
- 2026-10-05 · B · R15 design v2: Tal found v1 too plain, then asked for less text and no black panels. Researched leading patterns (Clerk last-used badge, Google passkey UX + checkup, FIDO guidance, GitHub sudo, Linear invites, Notion roles, live presence/facepiles, family list apps). Rebuilt the canvas: 22 boards, shared `nx.css`, light warm brand panel with isometric grid, states as tweaks, new screens (welcome, create space, invite desktop, shared live list + viewer, dialogs, security checkup, admin invite codes, emails). Brief got a "Design language" section. Live presence drawn now, built in R16.
- 2026-10-05 · B · R15 prep: Tal chose mockups first + one round in two sessions. Checked Better Auth 1.7.7 (all needed plugins incl. Turnstile captcha, Next 16 + Drizzle 0.45 peers OK). Made the R15 design canvas (14 screens: sign-in desktop/phone/Hebrew, join, invite-only, recovery, add passkey, switcher desktop/phone, invite sheet, space settings, security desktop/phone, guest notice), copied to `docs/design/r15/` once Tal approves. Wrote `docs/ROUND15.md` (Parts 0, A–G) and the step-by-step setup in its "Before you run". Waiting: Tal's approval of the screens + Google/Vercel setup.
- 2026-10-05 · B · Strategy session: wrote `docs/STRATEGY.md` (Lean Canvas hypotheses, research plan). Tal: households first, no interviews before an MVP, MVP = full set incl. price comparison, multi-user first. Desk research on competitors (global list apps + Israeli price apps) → §4. Next: cut `docs/ROUND15.md` from `MULTIUSER.md`.
- 2026-10-04 · B · Naming session (many rounds; Tal wants global, person/robot-like, no known chain). Shortlist from Tal: Karto / Carty / Shopix → advised Karto. Household purchasing recorded as the main use. No domain for now → `MULTIUSER.md` §4.1 closed-circle mode.
- 2026-10-04 · B · Tal: sign-up on phone + web, hosting alternatives, private-repo impact, top security. Wrote `docs/SECURITY.md` (threat model, findings: no SSRF guard in `extract.ts`, no CSP), extended `MULTIUSER.md` (§4.10 phone/web, QR number matching, checklist 1–11, mockups before R15), private-repo impact in `ENVIRONMENT.md`. Next: prep steps with Tal (name first), then auth/space mockups.
- 2026-10-04 · B · Tal tested prod (R13) mid-R14: phone stuck on the desktop table (list/grid switch dead, checkbox against the picture). Reproduced in the sandbox — `layout=table` wins over `phoneLayout` in `Content()`; set from the phone search "Table view" command. Added A4 (do first) to `docs/ROUND14.md` on branch `round14`; builder must merge `origin/main` into `round14` before the final `--ff-only`.
- 2026-10-04 · B · Multi-user planned in full with Tal (4 question batches): wrote `docs/MULTIUSER.md` (decisions, data model, scoping guards, migration, R15/R16 split, Tal's setup checklist); roadmap shifted (supermarket → R17, Android → R18). ROUND15 brief to be cut after R14's Open.
- 2026-10-04 · B · Tal tested R13: no AI on Home (rules too strict), sidebar/phone shell/dark mode not matching mockups, Ask seed resent on every new chat, indicators on To buy. Canvas page "Round 14" (logo swap, light tone). Advised: keep the PWA, wrap as an app after multi-user. Wrote `docs/ROUND14.md`.
- 2026-10-04 · B · Rebuilt the design canvas "Nexus Style Directions" on account B from Tal's export (Home v3), then Home v4 per Tal's notes (status tiles, meters instead of sparklines, stronger borders, louder AI suggestion, compact phone, Shopping switch with list/grid, phone search incl. settings, collapsible sidebar, 3 s intro). Tal approved; wrote `docs/ROUND13.md` and saved mockups to `docs/design/home-v4/`.
- 2026-10-04 · B · Set up this account's chat: sandbox network confirmed (clone, npm ci, typecheck, lint run here), GitHub custom connector via own OAuth App, secret audit of full history clean, repo stays public until launch. Wrote `docs/ENVIRONMENT.md` (setup + rule: every setup/tooling change is logged there). Added Hebrew/English RTL writing rules under "How to talk with Tal".
- 2026-10-04 · A · Tal: drop the big "Today's best move" hero, fewer rounded boxes. Canvas page "Home v3 — open layout": one surface with hairline sections, status sentence header, flat stats with sparklines, slim "Nexus suggests" line (1/4), "This week" strip, Needs you + On the way, pace + projects, Nexus noticed; flatter To buy ⇄ On the way. Awaiting Tal.
- 2026-10-04 · A · Round 12 brief = small fixes (sheet swipe-down, slow-swipe lock, assistant header + suggestion rows, Ask pill). Dashboard redesign moved to Round 13: research done (Oura, Linear, Monzo, Ramp, Brex, Stripe, Shopify, Mercury); canvas page "Home v2 — value first" (best-move hero, Needs-you queue, KPIs vs your usual, budget pace, delivery tracker, project rings, Nexus noticed; phone To buy ⇄ On the way switch cards) — awaiting Tal before the Round 13 brief.
- 2026-10-03 · A · Round 12 mockups on the canvas (page "Round 12 — mature look + dashboard"): Q quiet-pro vs E editorial; dashboard, customize mode + presets, grouped To buy, history table, phone. Proposed phone dock: Home · To buy · + · Projects · Insights (On the way moves into To buy) — awaiting Tal.
- 2026-10-03 · A · Round 11 brief (intro on open only + bigger intro, nested overlays, phone History, swipe/long-press/hover quick actions, uniform pictures, solid tags). Round 12 planned: visual maturity (fewer rounded boxes, flat sidebar, order history), customizable dashboard, decluttered products page with AI groupings — mockups first.
- 2026-10-03 · A · Product direction discussed (multi-user, Capacitor first, supermarket); PLANNER.md created.
- 2026-10-02 · A · Round 10 brief (animations, camera, projects page, pictures via Serper).
