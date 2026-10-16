# PLANNER history

Moved from `docs/PLANNER.md` on 2026-10-16 — history, not instructions.

## Current state & handoff (older bullets)
- **2026-10-15 (evening):** **R18 S3 merged and live** (`main` = `3e8dbdc`, all 28 items ticked; new table `brand_buy`,
  rehearsal on `prod-2026-10-15.db` copy passed). Builder still on two red checks: `guards` on main (`polish` "Settings
  from the first frame" — frame 3, re-run) and prod smoke (Home suggests checks counted positions; fix `ae4d3e4` in
  branch CI → ff main). **Next:** Tal tests S3 on the phone → notes; planner makes boards for groups B + C of
  `R18-S3-NOTES.md` (list redesign, Home widgets v2 Samsung-Health style, floating Ask, monthly spending) in a new chat.
- **2026-10-15 (morning):** R18 S3 stopped on usage after C1 (0, A1–A6, B1–B12, C1 ticked on `round18-s3`; C2 reverted).
  Last branch run (`f96dbf5`) **completed and failed** at the guards step "mixed Hebrew + English" (`test:bidi`) — the
  builder thought CI never got past build. Resume prompt:
  ```
  Round 18, session 3 (docs/ROUND18-S3.md) — resume on branch round18-s3 per "Resuming". First: the last CI run on
  round18-s3 (f96dbf5) failed at the guards step "mixed Hebrew + English" (test:bidi) — reproduce locally and fix before
  C2. Then C2–C7, G1, G2 without stopping. Before merging, let one full CI run on the final commit finish green (don't
  push docs-only commits on top while it runs). Merge to main only if everything is ticked, CI is green, and (if C6
  changed the DB) the rehearsal on a fresh prod snapshot copy passes.
  ```
- **2026-10-15:** Tal's notes after using S2 sorted into **`docs/R18-S3-NOTES.md`** (causes found: dock tab-4 flip,
  settings discoverability, History without trips, no branch list). Groups A fixes (no boards) / B list v2 + capture
  (boards) / C Home widgets v2 + floating Ask (boards) / D R19 data / E R20 offline. **Next:** Tal picks → briefs.
  **Same night:** Tal: "put in what you think is best", runs overnight (~8 h) → **`docs/ROUND18-S3.md`** written (Part 0
  red runs; A dock for everyone + still chrome on segment switches + transitions audit + overscroll + admin back + "×";
  B supermarket fixes incl. History trips, list first, voice, count→weight, reopen sections; C camera on "+", photo
  classify product / receipt / handwritten list, template preview, Next-shop widget, row swipes with Undo, usual brand,
  Home suggests timing; G). Not in S3: list redesign, Home widgets v2, floating Ask (boards next), R19 data, offline.
  Prompt:
  ```
  Round 18, session 3 (docs/ROUND18-S3.md) — Parts 0, A, B, C, G, unattended, on branch round18-s3 from main. Step 0,
  now while I'm here: make sure .claude/settings.local.json allows "Bash(git push origin round18-s3)", "Bash(git push
  -u origin round18-s3)", "Bash(git merge --ff-only round18-s3)", "Bash(git push origin main)", and take a fresh
  read-only prod snapshot for the rehearsal (if refused, tell me the exact command). Then go through all parts without
  stopping. Merge to main only if everything is ticked, CI is green, and (if the DB changed) the rehearsal passes.
  ```
- **2026-10-14:** **R18 S2 merged and live** (`main` ff → `6616b25`; all items ticked; branch CI green; S2 rehearsal on
  `snapshots/prod-2026-10-14.db` copy: 13 additive columns, numbers unchanged, idempotent). Results + "For Tal" in
  `docs/ROUND18-S2.md` "## Open". **Post-merge runs on `6616b25` failed** (not in the builder's report): `guards` on
  `main` (step "Google in-app sign-in (FedCM…)", the known flaky one, attempt 1, not re-run) and `prod smoke` on the
  production deploy (step `smoke.mjs`; logs/artifacts unreachable from the chat sandbox). → Tal re-runs both / the
  builder reads the logs before anything else. Planner's view on S2 "For Tal": supermarket settings under Space (shared
  by the household) — accept; household ✎ → Space → People — accept; dock "+" → "×" while the menu is open — fix in S3.
  **Next:** (1) fix/confirm the two red runs; (2) Tal does a real shop on prod with the phone (store mode end to end,
  templates, pushes from a second account) and writes notes; (3) planner writes **R18 S3** (fixes from that shop + S1/S2
  leftovers, e.g. the dock "+"/"×"); then R18b (recipes, D2, AI shop planning) →
  R19 price comparison → R20 real apps (Play closed test) → family.
- 2026-10-13: S2 brief `docs/ROUND18-S2.md` written; Tal runs it.
- **2026-10-13:** **R18 boards part 2 made** on canvas "Nexus R18 — Supermarket" (second row "phone, part 2" + third row
  "computer"): `ItemSheet-phone` (P6), `Capture-phone` (P4 + P5), `Store-phone` (P7 + P8), `Lists-phone` (P12 + P13),
  `TripBar-phone` (P10), `Push-phone` (P16), `Settings-phone` (P17), `Supermarket-desktop` (D1), `Settings-desktop` (D3);
  shared `nx-sm2.css`. Tal then simplified the model (decisions "Supermarket simplified (Tal 2026-10-13)" below) and the
  boards were reworked the same day. **Next:** Tal reviews / approves the boards → zip into `docs/design/r18/` (builder
  commits) → planner writes `docs/ROUND18.md` Session 2 (new chat).
- **2026-10-12 (later):** **R18 S1 done on `round18-s1`** (all parts ticked; prod snapshot + rehearsal passed, no items
  moved — prod has no grocery-named collection; CI was running on `11e3df8`). Planner checked the holiday table
  (`src/lib/grocery/holidays.ts`, Oct 2026 → Oct 2027) against a computed Hebrew calendar: all dates correct (5787 is a
  leap year → Purim in Adar II, eve 2027-03-22; Independence Day 5 Iyar = Wed 2027-05-12, no shift). Tal decided the
  staple semantics (below) → goes into the S2 brief with the Settings / item-sheet UI. Phone smoke "item sheet morph"
  fails on `main` too → fix in S2. **Next:** boards part 2 (new chat) → S2 brief.
- **2026-10-12:** **R17 S6 + S7 merged and live** (S6 `0f913bd` after a green re-run; S7 `cba203b`, CI green).
  S7: admin `ad-*` → `ops-*` + `test:adblock`; device class (`html[data-device]`, `useDevice()`, `phone:`/`desk:`,
  Layout override, 222 tokens + ~25 JS checks moved) + `test:device` (111) + `test:device-width`. Not yet verified by
  Tal on prod: `/admin` with the ad blocker on, zoom stays computer, phone unchanged, S6 push panel + test push.
  `docs/ROUND18.md` "How to run" got the S7 rules + a deterministic compare-stores smoke. `docs/design/r18/` still
  untracked on Tal's PC → R18 S1 Part 0 commits it. **Next:** Tal checks → R18 S1 (prompt below in the 2026-10-11 entry).
- **2026-10-11 (later):** Tal: zooming the page on the PC switches to the phone UI (admin showed the phone tab bar);
  `/admin` content area empty on his PC (both layouts, no console error; planner couldn't reproduce locally, see brief
  X1). → **R17 Session 7 brief `docs/ROUND17-S7.md`** (W: one device class from real signals — client hints / UA, primary
  pointer + hover, screen size — fixed per page load, Settings → Display → Layout override, `phone:`/`desk:` variants +
  `useDevice()`, narrow computer window keeps the computer UI; X (first): admin shell hidden by ad blockers — EasyList hides `.ad-main/.ad-top/.ad-body/.ad-side` → rename + `test:adblock`, plus app-wide `translate="no"`; Y docs).
  Order: merge S6 (main moved with 3 docs commits → merge `origin/main` into `round17-s6` first, CI, then ff) → S7 → R18 S1.
  Prompt:
  ```
  Round 17, session 7 (docs/ROUND17-S7.md) — Parts X (first), W, Y, unattended, on branch round17-s7 from main (after Session 6
  is merged). Step 0, now while I'm here: make sure .claude/settings.local.json allows "Bash(git push origin
  round17-s7)", "Bash(git push -u origin round17-s7)", "Bash(git merge --ff-only round17-s7)". Then go through all parts
  without stopping. Merge to main only if everything is green.
  ```
- **2026-10-11:** **R18 boards, part 1 approved by Tal** — canvas **"Nexus R18 — Supermarket"** (private Design artifact,
  this account). Phone boards: `Supermarket-phone` (P2, canvas `Main`), `StoreMode-phone` (P9), `Add-phone` (P3),
  `Finish-phone` (P11), `HomeCard-phone` (P1 + P10 trip bar), `Nav-phone` (P15 + P18); shared `nx-sm.css` on top of the
  R17 css. Copies go to `docs/design/r18/` from the zip Tal saves into his checkout (the chat sandbox has no push
  credentials and the connector would need ~220 KB pasted) — the builder commits them as `R18.0`. **Next:** (1) new
  chat → `docs/ROUND18.md` Session 1 (plumbing, no boards) can run now; (2) boards part 2 (P4–P8, P10 standalone,
  P12–P13, P16–P17, D1, D3) on the same canvas, then R18b (P14, D2) — needed before Session 2.
  **Update (same day):** Tal approved everything and asked to start → **`docs/ROUND18.md` Session 1 written** (Parts 0
  boards commit, A data — supermarket list in `items`, `trip` + `trip_check`, sections + `space_store`, product
  dictionary with `art_key`, branch-order learning; B staples / suggestions / evening draft / templates; C parse, merge,
  type-ahead + "did you mean", list split + voice; D trip outbox merged per field + live adds; E admin metrics, guards).
  Order for Tal: unzip boards → R17 S6 (if not run) → R18 S1 with this prompt:
  ```
  Round 18, session 1 (docs/ROUND18.md "Session 1") — Parts 0, A, B, C, D, E, unattended, on branch round18-s1 from
  main (after R17 Session 6 is merged). Step 0, now while I'm here: make sure .claude/settings.local.json allows
  "Bash(git push origin round18-s1)", "Bash(git push -u origin round18-s1)", "Bash(git merge --ff-only round18-s1)",
  and take the read-only prod snapshot for the migration rehearsal (if the permission check refuses it, tell me the
  exact command and I'll run it). Then go through all parts without stopping. Merge to main only if everything is
  green and the migration rehearsal on the prod snapshot copy passes.
  ```
  Next planner task (new chat): boards part 2 on the same canvas → Session 2 brief.
- **2026-10-10 (late night, 3):** R18 architecture settled with Tal → **`docs/R18-SCREENS.md`** (screens script for
  approval; supersedes `R18-PLANNING.md` §16–§17: answers Q14–26, R18 / R18b split, default Israeli section order, "Build my list" rules, phone P1–P18,
  computer D1–D3). **Next:** Tal approves / corrects the script → boards in a new chat (canvas "Nexus R18 —
  Supermarket") → `docs/ROUND18.md` (S1 plumbing can run before boards). R17 S5 running, then S6.
- **2026-10-10 (late night, 2):** Tal: push shows only inside the app → **R17 Session 6 brief `docs/ROUND17-S6.md`**
  (U1 see where a push is lost — System rows + "send a test push", U2 everything at once, U3 opportunistic dispatch so
  GitHub's schedule isn't the only sender, U4 guard). Run after S5 merges. R18 answers + structure in
  `docs/R18-PLANNING.md` §5, §10–§12 (open: Q12 dock tab 4, Q13 receipt steps). Prompt:
  ```
  Round 17, session 6 (docs/ROUND17-S6.md) — Parts U, V, unattended, on branch round17-s6 from main (after S5 is
  merged), U1 first. Step 0, now while I'm here: make sure .claude/settings.local.json allows "Bash(git push origin
  round17-s6)", "Bash(git push -u origin round17-s6)", "Bash(git merge --ff-only round17-s6)". Then go through all parts
  without stopping. Merge to main only if everything is green.
  ```
- **2026-10-10 (late night):** R18 planning started → **`docs/R18-PLANNING.md`** (gate to close R17, what exists,
  draft scope Parts A–G in 3 sessions, R19/R20 dependencies — native FCM push needed in the Android wrapper, gtin +
  store + price capture for R19 —, 6 questions for Tal, prep with calendar time). **Next:** Tal answers §5 → decisions
  here → research update → boards in a new chat (canvas "Nexus R18 — Supermarket") → `docs/ROUND18.md` (S1 without
  boards can run first). R17 S5 still running/pending.
- **2026-10-10 (night):** Tal's checks after S4 → **R17 Session 5 brief `docs/ROUND17-S5.md`** (hotfixes): S1 `/admin`
  black on desktop (React #418 hydration text mismatch + 500s on server actions and `/api/presence`; phone works), S2
  "שקל" still shown (AI wording cached per day before the S4 normaliser), S3 suggestions card bobs under mouse hover
  (desktop height not fixed + `StackHeight` observer/animation loop), S4 desktop step 5 always shows the phone QR, S5
  "if paid" prices checked from official pages + store search links, S6 manifest `enctype` warning. Tal still has to add
  the VAPID keys to Vercel (System tab shows "Keys not set — inbox only"). Prompt:
  ```
  Round 17, session 5 (docs/ROUND17-S5.md) — Parts S, T, unattended, on branch round17-s5, S1 first. Step 0, now while
  I'm here: make sure .claude/settings.local.json allows "Bash(git push origin round17-s5)", "Bash(git push -u origin
  round17-s5)", "Bash(git merge --ff-only round17-s5)". Then go through all parts without stopping. Merge to main only
  if everything is green.
  ```
- **2026-10-10 (evening):** **R17 Session 4 merged and live** (`dbcb872`, no DB change; results in `docs/ROUND17.md`
  Open "### Session 4"). Causes the builder found: no Radix direction provider (every menu was LTR in Hebrew); admin role
  was reset on each sign-in from `ADMIN_EMAIL` only (now `ADMIN_EMAILS` too, applied on the next request — not verified
  on prod: the builder's classifier refused the prod snapshot). Watch: phone smoke "item sheet morph" / "compare stores"
  flaked twice after a build. **Tal to do:** open `/admin` (if 404: his Google address in `ADMIN_EMAILS` on Vercel), then
  test the S4 items. Still open from S2: desktop install QR always, "if paid" prices.
- **2026-10-10 (later):** Tal's test notes → **R17 Session 4 brief `docs/ROUND17-S4.md`** (fixes): P1 switcher name cut
  from the wrong end in RTL + clipped highlight, P2 Hebrew/English order ("תכנון עם Nexus") + app-wide audit + `test:bidi`,
  P3 the whole sidebar profile block / Me-sheet header opens a new Settings → **Profile** section, P4 inbox opens without
  the skeleton jump (prefetch + count-shaped skeleton), P5 ₪ instead of "שקל" in AI text, P6 Suggests card fixed height
  on the phone, P7 carousel drag/swipe wraps around both ends, P8 admin access (Tal got no panel at /admin — check his
  role on prod), Q1 no price pushes to viewers, Q2 "Check now" on the item page, Q3 the prod smoke category step.
  Still open from S2 (not in S4, Tal hasn't decided): desktop install QR always, "if paid" prices. **Next:** Tal runs
  Session 4 with this prompt:
  ```
  Round 17, session 4 (docs/ROUND17-S4.md) — Parts P, Q, R, unattended, on branch round17-s4. Step 0, now while I'm
  here: make sure .claude/settings.local.json allows "Bash(git push origin round17-s4)", "Bash(git push -u origin
  round17-s4)", "Bash(git merge --ff-only round17-s4)". Then go through all parts without stopping. Merge to main only
  if everything is green (and the migration rehearsal passes if the DB changed).
  ```
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

## Decisions that stand (superseded items)
- Roadmap (Tal 2026-10-04, superseded — see "Roadmap (2026-10-05)"): R13 home/shopping/search/intro → R14 bug fixes → R15 multi-user foundation (site sign-in on
  web + phone, Google + email, desktop QR login, short onboarding questionnaire that adapts the app, per-user data,
  privacy) → R16 Android wrapper + testers. Tal to prepare for R15: domain, Google Cloud OAuth client, Resend, name check.
- **Roadmap update (2026-10-04, later; superseded 2026-10-05):** R14 fixes → R15 multi-user foundation → R16 multi-user product layer → R17
  supermarket mode (recurring household purchasing, inside shared spaces, sidebar entry) → R18 Android wrapper.
- **Staples (Tal 2026-10-12) — superseded 2026-10-13, see "Supermarket simplified":** three states per product. **Not set** (default): Nexus suggests it by itself once it has
  learned the rhythm (≥ 3 purchases). **Suggest / Add by itself**: chosen by the user. **Off**: only when the user picks it
  (e.g. "don't suggest this") → never suggested again. S1 stores `staple = off` as the default and still suggests → S2
  adds the "not set" state (e.g. null default; existing `off` rows migrate to not set, since no user could choose yet).

### Planning log (before 2026-10-13)
- 2026-10-12 · this chat · Reviewed R18 S1 (all parts done, rehearsal on the prod snapshot passed). Verified the holiday table with a computed Hebrew calendar (all correct). Tal chose the staple states (not set → suggests; off = only by choice, never).
- 2026-10-12 · this chat · Reviewed R17 S6 + S7 results (both merged, CI green; S7 X1/W/Y as briefed, 111 device checks). Added the S7 rules and a no-search-key smoke fix to `docs/ROUND18.md` "How to run". Gave Tal the prod checks; R18 S1 next.
- 2026-10-11 · this chat · Tal: admin menu won't open on PC. Found `round17-s6` can't fast-forward onto `main` (3 docs commits; the merge is clean) → gave the merge steps. Rebuilt the S5 code in the sandbox (2560 / 1366 / zoom-sized viewports, dark, he, installed-app mode): admin always renders. Tal's screenshot showed the zoomed PC in the phone layout → Tal: phone UI only on real phones → wrote `docs/ROUND17-S7.md`. Empty admin content then diagnosed from Tal's console: `#admin-main` / `.ad-top` / `.ad-body` computed `display:none`, no inline style, no external sheet → ad blocker; EasyList has `##.ad-main`, `##.ad-top`, `##.ad-body`, `##.ad-side` → S7 X1 rewritten (rename `ad-*`, new `test:adblock` with a vendored EasyList generic snapshot), X1 runs first. Tal confirmed: ad blocker off → panel shows.
- 2026-10-11 · this chat · Tal approved all R18 part-1 boards and asked to start the round → wrote `docs/ROUND18.md` Session 1 (data + engines, no screens; additive migration + prod-snapshot rehearsal). Treated "illustration by default, real photo when the exact product is known" as approved.
- 2026-10-11 · this chat · R18 boards part 1 on new canvas "Nexus R18 — Supermarket" (P1, P2, P3, P9, P11, P15, P18; skills bar). Three passes with Tal: v2 bolder names, borders, section colours, progress hero, confetti; v3 product illustrations + tiles layout; v4 stronger edges, typed-letters-only bold, "did you mean". Approved → zip for `docs/design/r18/` (sandbox can't push). Not done: rendering self-check (the Design type forbids it).
- 2026-10-10 · same chat · R18 architecture with Tal (Q12–26): Supermarket dock tab replaces Projects, Products tab, recipes → R18b. Researched the usual Israeli store layout (produce at the entrance, bread/dairy at the back) → default section order. Wrote `docs/R18-SCREENS.md`.
- 2026-10-10 · same chat · Push diagnosed from code (non-urgent kinds wait for the active hour and only `hourly.yml` sends them; actor never notified) → wrote `docs/ROUND17-S6.md`. Tal's R18 answers + supermarket structure (Shopping: Supermarket | Stores, store mode, entry points) in `docs/R18-PLANNING.md`.
- 2026-10-10 · same chat · Roadmap after R17 + R18 kickoff: wrote `docs/R18-PLANNING.md`. Found in code: trips are a pref (no trip table, no check-order log), no staples/templates, no duplicate merge, offline adds not in the outbox.
- 2026-10-10 · same chat · Tal's checks after S4 (admin black on desktop with React #418 + 500s, "שקל" still shown, card bobbing on hover) + answers (QR always, check prices) → wrote `docs/ROUND17-S5.md`. Cause of "שקל": AI wording cache read without the normaliser.
- 2026-10-10 · same chat · Reviewed R17 S4 results (all items done, CI green, merged). Gave Tal the admin check and the S4 test list.
- 2026-10-10 · same chat · Tal's phone/PC notes after S2+S3 → wrote `docs/ROUND17-S4.md` (Parts P, Q, R). Causes found in code: switcher `truncate` on a Latin name inside RTL (ellipsis at the start), inbox `Skeleton` = 3 fixed bars, carousel drag rubber-bands at the ends, admin gate = `role === "admin"` (Tal's role to verify on prod).
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
