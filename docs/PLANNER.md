# Planner playbook — how the planning chat works on Nexus

Read this first if you are the **planning** Claude (claude.ai chat / Project "Nexus"), whichever account you run on.
Claude Code (the builder) reads `CLAUDE.md`; this file is for the chat that talks with Tal, designs, researches and
writes the round briefs. Everything durable lives in this repo, not in chat history.
Setup of this chat (network, GitHub connector, rebuilding it on a new account): `docs/ENVIRONMENT.md` — any change
to setup, tooling or workflow is recorded there in the same session.

## Current state & handoff (updated 2026-10-10 → read this first on any account)
- **2026-10-16 — R18 S5 ready to run (account B done).** Boards approved (canvas "Nexus R18 — S5", 14 boards) and
  **`docs/ROUND18-S5.md`** written (Parts A list v2, B start-trip look, C floating Ask, D Home widgets v2, E monthly
  spending, F onboarding v2, G guards + docs). The planning chat couldn't `git push` (no push tool in that chat) →
  Tal gets `nexus-r18-s5.zip` (boards for `docs/design/r18-s5/` + `r18-s5-planning.patch` with these PLANNER /
  ENVIRONMENT lines); Claude Code's Step 0 applies and commits them on `main`. Prompt for Claude Code (account A):
  ```
  Round 18, session 5 (docs/ROUND18-S5.md) — Step 0, then Parts A, B, C, D, E, F, G, unattended, on branch round18-s5
  from main. I unzipped nexus-r18-s5.zip at the repo root. Now while I'm here: make sure .claude/settings.local.json
  allows "Bash(git push origin main)", "Bash(git push origin round18-s5)", "Bash(git push -u origin round18-s5)",
  "Bash(git merge --ff-only round18-s5)", and take a fresh read-only prod snapshot (if refused, tell me the exact
  command). Then go through everything without stopping. Merge to main only if all items are ticked, a full CI run on
  the final commit is green, and (if the DB changed) the rehearsal passes.
  ```
- **2026-10-15 (night) — SPLIT BY ACCOUNT (Tal, to save usage):**
  - **This account (tal.jacoby1235, "A")** runs **Claude Code only** (R18 S4 tonight on `round18-s4`; S5 tomorrow).
  - **The other account ("B") is the planning + design chat** from now on: boards for S5 and the **S5 brief**.
  - B's job, in order: (1) read this file, `docs/R18-S3-NOTES.md` (groups B + C + "After S3"), `docs/ROUND18-S4.md`
    (so S5 doesn't redo S4), boards `docs/design/r18/` + `nx17.css` / `nx-sm*.css`; (2) new Design canvas
    **"Nexus R18 — S5"** on account B with boards: `List-phone` (supermarket list redesign: one list, compact, real-looking
    rows, swipe affordances, inline rename, picture tile → sheet), `List-desktop`, `StartTrip-phone` (start-shopping
    screen, fixed, colour / light), `Home-widgets-phone` + `Home-widgets-desktop` (Samsung-Health-inspired cards +
    long-press edit: drag, swap places like Android icons, remove), new shopping widgets, `Ask-fab-phone` (floating Ask:
    **right side default, drag to the left and it stays, just above the dock, rises smoothly above toasts / bars, closing
    the chat returns to the same screen**; a full circle per CLAUDE.md), `Spending-month-phone` + desktop (monthly
    breakdown: supermarket vs products, stores, categories, vs budget), `Trips-history-phone` if S4's cards need a look;
    design bar = `.claude/skills/` (emil-design-eng, apple-design, mobile-native, animate) + frontend-design;
    (3) Tal approves → B commits the boards to **`docs/design/r18-s5/`** and pushes to `main` (attach the repo with push
    access, clone `/home/claude/nexus`, commit as Tal — ENVIRONMENT "Planning chat setup"); (4) B writes
    **`docs/ROUND18-S5.md`** in the S4 format (How to run, one commit per item, Step 0 = finish S4's merge if open) +
    the Claude Code prompt into this section; (5) a line in the Planning log.
  - Rules while split: B touches only `docs/` on `main` (never code, never `round18-s*` branches); always
    `git pull --rebase` before pushing; Claude Code merges `origin/main` into its branch before its ff-merge. A doesn't
    write planning docs while B is active, except Claude Code's own brief "Open" sections.
- **2026-10-15 (night):** **`docs/ROUND18-S4.md`** written from Tal's notes after S3 (A adds merge into qty/weight —
  cause in `addToList` notes —, feedback, empty list; B "+" = camera, scanner rebuilt (main lens, 1080p, focus, zoom,
  freeze on detect), photo freeze/retake; C voice = record + AI (Tal approved, counts in quota) with level meter;
  D rename on letters, swipe-delete motion, floating Start shopping; E store mode: fixed start screen, sections stay
  open, no pop-ups, full-screen finish, one scroller, rail navigates; F desktop pill, history cards, brands). Step 0
  finishes S3's merge first. Tal makes boards for S5 in a new chat in parallel (prompt: boards per
  `R18-S3-NOTES.md` groups B + C and "After S3"; floating Ask on the right, draggable left). Prompt:
  ```
  Round 18, session 4 (docs/ROUND18-S4.md) — Step 0, then Parts A, B, C, D, E, F, G, unattended, on branch round18-s4
  from main. Now while I'm here: make sure .claude/settings.local.json allows "Bash(git push origin round18-s4)",
  "Bash(git push -u origin round18-s4)", "Bash(git merge --ff-only round18-s4)" (and the round18-s3 ones), and take a
  fresh read-only prod snapshot (if refused, tell me the exact command). Then go through everything without stopping.
  Merge to main only if all items are ticked, a full CI run on the final commit is green, and (if the DB changed) the
  rehearsal passes.
  ```
Older: `docs/archive/PLANNER-history.md`.
- **Blocked stores — parked by Tal (2026-10-09), come back later.** Prod probe (ROUND17 Open "C1 — prod probe"):
  cwc/ksp/rami-levy/payngo etc. run Cloudflare bot management that challenges every datacenter IP, the CF Worker too.
  Free server-side fetching can't pass it. Options offered (not decided): (1) product name from the URL slug,
  (2) price + image from Google results via the existing Serper search, (3) screenshot → share to the app → AI reads it;
  or a paid scraping service. Probe list still has home pages / fake ids — ask Tal for real product links first.

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
- Point each item at its area in `docs/MAP.md` ("Area: Supermarket") and name the files you already know, so the
  builder reads one section instead of exploring. The closing docs item says "`docs/MAP.md` (touched areas)", never
  "CLAUDE.md map" — `CLAUDE.md` stays short because it loads on every session and after every `/compact`.

## Decisions that stand (don't re-open without Tal)
Older: `docs/archive/PLANNER-history.md`.
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
- **Round 14 decisions (Tal 2026-10-04):** light theme "B · toned" (page `#eeede9`, cards `#f8f7f4`); active nav row = soft
  tint + 3 px spark accent bar (never solid black); logo left face follows the theme (light face in light mode, dark in
  dark, thin edge; Graphite only; app icon unchanged); To buy / Urgent / Unsorted merged into one To buy with filter
  chips; indicators only on Home, Spending, project and store pages; calendar = month view + ICS feed that also removes
  deleted/received events; Home always shows AI or rule suggestions when the account has items. Every visual round now
  ships side-by-side parity PNGs (mockup vs app).
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
- **Profile (Tal 2026-10-10):** clicking the whole profile block (sidebar) / the Me-sheet header opens Settings →
  Profile (photo, display name, email read-only, member since); the gear still opens Settings.
- **Mixed Hebrew/English in the UI (Tal 2026-10-10):** Latin words inside Hebrew text sit where Hebrew order puts them
  ("תכנון עם Nexus" → Nexus on the left); guarded by `test:bidi`. Carousels loop at both ends on drag/swipe too.
- **R17 S3 follow-ups (Tal 2026-10-10):** price notifications go to the space owner + members, never viewers; "Check now"
  comes back as an action on the item page (no drop-% picker; `minDropPct` stays 5 %). For the S2 + S3 fix round.
- **R18 + push (Tal 2026-10-10), details `docs/R18-PLANNING.md`:** family comes in only after the Android app is on
  Google Play (R20 gate); staples suggest by default, "add by itself" per item; several named templates, one tap from a
  past trip; store sections = default supermarket layout + per-branch learned order *suggested* for confirmation, user
  can move groups; receipt offered after every trip; push: every kind at once except night quiet, weekly summary and
  activity (first at once, then ≤ 1/h/space); photo add counts in the AI quota; checked items stay in their section
  (struck through, no sliding); Shopping tab split Supermarket | Stores; entry points: long-press +, app-icon shortcuts,
  Home "Next shop" card, desktop sidebar entry, trip bar; ideas in: live adds during a trip, "not found", basket
  estimate, one-hand mode, substitutes.
- **R18 architecture (Tal 2026-10-10), full list `docs/R18-SCREENS.md` §0:** phone dock = Home · **Products** (was
  Shopping; Projects open inside it) · + · **Supermarket** · Insights (a setting swaps tab 4 back to Projects; onboarding
  "projects" sets it); one supermarket list per space, store chosen per trip, items can be pinned to a store; + on
  Supermarket adds directly; computer = planning page only + "send to phone"; text rows by default (thumbnails toggle);
  recipes inside Supermarket (List | Recipes) — **recipes + AI shop planning = R18b**; "what's missing?" checklist, no
  pantry; evening-before "Build my list" draft never touches the user's own items; meal planning later; optional
  section owners; chain + branch in onboarding, changeable per trip; every onboarding answer editable in Settings.
- **Onboarding + admin leftovers (Tal 2026-10-10):** desktop onboarding step 5 always shows the phone QR (only the QR
  when the computer can't install); "if it were paid" uses prices checked on the official pages, with the date shown.
- **Phone vs computer UI (Tal 2026-10-11):** decided by the device, never by window width or zoom — a computer always
  gets the computer UI (narrow window → collapsed sidebar, not the phone UI); tablets get the computer UI (planner's
  choice); a Settings → Display → Layout override exists. Nexus opts out of browser machine translation (`translate="no"`).
- **Class names (2026-10-11):** no CSS class or id may match ad-blocker cosmetic lists (EasyList generic `##` rules, e.g. `ad-*`, `ads`, `sponsor`); guarded by `test:adblock`.
- **R18 boards look (Tal 2026-10-11):** every supermarket product shows a picture tile (replaces Q19 "text rows by
  default"): a flat illustration of the product type on its section's tint by default, a real photo only when the
  exact product is known (barcode / own photo / Open Food Facts) — approved with the boards; layout lever
  rows (default) | tiles. Each of the 16 sections has its own colour (icon tile, card tint, aisle rail), with an off
  switch. Store mode: big progress header (count, %, aisle rail in section colours), the picture tile is the check
  (fills green, spark burst), confetti + "everything's in the cart" when all is checked and on the finish screen.
  Product names lead (bigger, bolder; quantity as a chip); stronger borders, less white (screen `#ecebe6`). Hebrew is
  the default board language. Add: full product name, only the typed letters bold; spelling mistakes → "Did you mean"
  (edit distance against the household's products), with "add as new" still offered.
- **Supermarket simplified (Tal 2026-10-13), replaces the staple states:** the user never sees staple states. Nexus
  only *suggests* (never adds to the list by itself — "add by itself" is dropped); + accepts, × skips (soft signal, several
  skips in a row → suggested less). One explicit control: **"Don't suggest this again"** (suggestion menu + item sheet),
  undone from Settings → Supermarket → "Products you hid". Cold start: a basic Israeli household basket adapted to the
  onboarding answers; after ~3–4 trips the home's own history takes over and never-bought basket items fade. Nexus tells
  regular items (steady interval → suggested when due) from occasional ones (suggested only in context: Shabbat, holiday,
  "usually with"). Data: `staple` keeps only hidden vs normal (`off` = hidden; `suggest`/`auto` unused, no drop).
- **Templates made by Nexus (Tal 2026-10-13):** Nexus detects repeating trips (items bought together + weekday) and offers
  them as templates marked "Made by Nexus"; it keeps them updated until the user edits one — then it is the user's and
  Nexus stops changing it. Hidden products never enter a Nexus template (they may stay in a template the user edited).
  Applying a template merges, never duplicates.
- **Count + weight (Tal 2026-10-13):** a supermarket item can hold a count **and** a weight ("Tomatoes · 6 · ~1 kg"). The
  weight is estimated from the household's learned unit weight when not set; store mode shows both. Parser accepts
  "6 עגבניות", "קילו עגבניות", "קילו עגבניות, בערך 6". Data: new nullable `count` (additive).
- **No knobs (Tal 2026-10-13):** no evening-draft switch (Nexus sends it only after it learned a usual shopping day — ≥ 3
  trips on the same weekday — and has something to suggest; it stops after being ignored a few times; only the global
  notifications switch), section colours always on, rows/tiles moves to the list's ⋯ menu, dock tab 4 is chosen by itself
  from onboarding + use. Settings → **Supermarket** stays, minimal: main store, section order, products you hid, link to
  "What Nexus learned".
- **"My answers" dropped (Tal 2026-10-13):** each onboarding answer is changed where it acts (store chip, Space → Budget,
  People, Home layout). New **"What Nexus learned"** page (Settings, also reachable from Supermarket): chips of what Nexus
  knows — from onboarding ("you told us", editable) and learned ("learned", forgettable) — plus "Forget everything".
- **Galaxy Watch app (Tal 2026-10-13):** wanted. Galaxy Watch4+ run Wear OS → a small native Kotlin app shipped with the
  Android app on Google Play (older Tizen watches not supported); store-mode list by sections, tap to check + haptic,
  not found, live adds, tile, offline. **After R20** (needs the Android app). R18 S2 requirement now: every store-mode
  action goes through one trip API (the S1 trip outbox shape) so a watch client can reuse it.

- **R18 S5 boards (Tal 2026-10-15/16, account B), canvas "Nexus R18 — S5" — all approved 2026-10-16:** floating Ask
  on **phone and computer** (phone: physical right by default, just above the dock, rises above toasts; computer:
  bottom corner of the content; **no dragging** — Settings "AI button side: Right / Left" moves it; the top-bar Ask
  goes). Always a perfect, opaque circle in every state.
  **Ask look = option 5 "pearl + ring", stars size C** (boards `Ask-configs` → `Ask-pearl-sizes` → `Ask-final-phone`):
  light pearl orb + a thin muted violet→amber→orange→pink ring that turns only when Nexus has a message (slow), is
  thinking (fast) or listening; two stars 34 px on 58 px, optically centred (shifted 1.85 px left, .55 px down) —
  "feels AI, stays solid". Home widgets: **only what gives real value** — Next shop (+ live state when another member is
  shopping), Due soon, Budget with the supermarket share; dropped: month bars, last shop, rhythm, templates widget.
  Start-shopping screen colour is **the user's choice** (Auto = store colour, 8 colours, Vivid / Soft / Night, per
  store). Onboarding asks the basics: household (who + adults / kids / babies / pets), how you shop (how often, usual
  days, store / online / both), food at home (kosher, mehadrin, vegetarian, vegan, gluten-free, lactose-free, nut
  allergy, organic; Shabbat and holidays), budget (household total, supermarket share, month start day, "learn it from
  my first month", alerts 80 % / 100 %). Swipe on list rows: toward the start = delete, toward the end = quantity.
- **Research answers (Tal 2026-10-16), details `docs/RESEARCH-COMPETITORS.md`:** (1) **WhatsApp door — yes, after
  R20**, inbound first (send items → added to the space list, reply with a link; user-opened 24 h window = free;
  needs a number + Meta business verification). (2) Splitting money inside a space — **not now**. (3) Paid tier —
  **decide after 4 weeks of closed-circle data**; until then the free core is designed so nothing is ever taken away.
  (4) **"Use soon" for perishables — yes**, without a pantry: purchase date (trip / receipt) + a shelf-life table →
  suggestions and Home "Due soon"; no stock counts. (5) Price layer (Tal left it to the planner): **own pipeline in a
  separate public data repo** — nightly GitHub Action, fetch + parse with `israeli-prices` (MIT, 31/32 chains);
  never `OpenIsraeliSupermarkets` (non-commercial licence) or `ronilitman` code (no licence) — their *ideas* only:
  baseline price per (chain, GTIN-14) + differing branches, word→GTIN index, weighted flag. Load into Turso the
  baselines + exceptions for branches of active spaces; price history only for GTINs on lists; last good snapshot
  per chain + "prices as of"; geo-blocked chains (Victory, Mahsanei HaShuk, Het Cohen) wait for an Israeli runner.
  Promo math per list quantity; club / coupon deals only for clubs the home has (new "your clubs" question).
  Free text → product: the home's own product memory + word index + AI guess + user correction, remembered per space.
- **Code reuse rule (Tal 2026-10-16):** MIT / Apache / BSD code may be used with its notice; AGPL / GPL,
  non-commercial and unlicensed repos are read for ideas only — the planner writes the idea in its own words and the
  builder implements from that note, never pasting from those repos.

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
- `SPEC.md` (shipped features per round), `CLAUDE.md` (builder rules, kept short), `docs/MAP.md` (code map by area + tests per area), `docs/ROUND*.md` (briefs + results),
  `docs/UI-V2.md` (design history + motion plan), `docs/design/` (static mockups), `src/lib/help/topics/*.md`.
- Design canvas "Nexus Style Directions" is a private claude.ai artifact on each account (A: original; B: rebuilt 2026-10-04 with Home v4); the exported mockups in
  `docs/design/` are the shareable copy. New design exploration: make a new canvas in your own account.
- Optional env not yet set (as of Round 10): `REPORTS_TOKEN` (read in-app reports), `GITHUB_ISSUES_TOKEN`; check
  `SERPER_API_KEY` status in the latest Open.

## Working from two Claude accounts (coordination)
- The repo is the only shared memory. Chat history, claude.ai memory and design canvases are per account.
- At the start read this file, the latest brief's "## Open" and `docs/ENVIRONMENT.md` up to "## Log"; `rg` the
  log, `docs/MAP.md` and `docs/archive/` only for what the task needs.
- While a round branch is finishing (its final CI run or merge is pending), push planning docs to branch
  `docs/next`, not `main`; the builder merges `origin/docs/next` into `main` right after its own merge.
- Push from the chat with `git push` (sandbox with the repo attached with push access) when possible; the GitHub
  connector resends whole files, so keep planning docs small and never paste a large file to change a line.
- Start of every planning chat: pull, read this file + the latest round's "## Open". Never rely on "what the other
  chat said".
- Any decision made in chat that isn't in a brief yet → add one line to "Decisions that stand" (or "Product
  direction") here and push before ending the chat.
- One round at a time: only one `docs/ROUND<n>.md` is "in progress". The next number is always latest + 1 on `main`.
- Log each planning chat in one line below (date, account A/B, what was decided/written), newest first.

### Planning log
Older: `docs/archive/PLANNER-history.md`.
- 2026-10-16 · B · Competitor + open-source + money research → `docs/RESEARCH-COMPETITORS.md` (Tal's 6 apps + PriceZ, CHP, SnapList, IsraBis, Bring!, AnyList, KitchenOwl/Mealie). Tal answered 1a 2b 3c 4a, left 5 to the planner → two decision lines above (research answers, code reuse rule). Licences checked by cloning: `israeli-prices` MIT; OpenIsraeliSupermarkets non-commercial; Grocy MIT; KitchenOwl/Mealie AGPL. Read KitchenOwl's suggestion + ordering jobs → `staples.ts` "usually with" lacks a lift check (§5.2, for the next supermarket brief). `STRATEGY.md` revenue row updated. Pushed to `docs/next` (S5 running). Sandbox: no `rg` (use `grep -rn`); anonymous GitHub API hits 60/h fast → connector search or `git clone --depth 1`.
- 2026-10-16 · planning chat · Workflow: code map (`docs/MAP.md`), planning-docs diet (history → `docs/archive/`), `docs/next` rule, CI paths-ignore + parallel jobs and permanent permissions → R18 S5 Part 0.
- 2026-10-16 · B · R18 S4 result from Claude Code: on `main` as `d4bdeb0`, all items ticked, CI + guards + prod smoke green, no schema change. Voice never worked before because `Permissions-Policy` had `microphone=()` (now `self`); the vanished-row bug was a delete + Undo in one sync batch (fixed). Open: Tal's phone checklist in `ROUND18-S4.md` "For Tal"; status note `4030ed9` only on `round18-s4` → S5 Step 0 cherry-picks it; the smoke console filter → S5 G1.
- 2026-10-16 · B · R18 S5 planned: new canvas "Nexus R18 — S5" (14 boards: list phone + computer, start trip with a colour / style picker, floating Ask states + six looks + 8 shapes × 8 states + star sizes + the final (pearl + ring, stars C), Home widgets v2 with long-press drag / swap / remove / size / add, widget catalog, monthly spending phone + computer, onboarding v2 steps 2/4/5/6). Tal: Ask floats on phone and computer, look = pearl + ring with bigger centred stars, only valuable widgets, start-trip colour is the user's, onboarding asks household / habits / food / budget; all approved. Wrote `docs/ROUND18-S5.md`; boards + these doc lines go via a zip + patch (no push from this chat).
- 2026-10-15 · planning chat · Token saving for the builder: new `docs/MAP.md` (code map by area, tests per area, rules for keeping it true; S4's map lines included; 3 stale paths fixed, e.g. `alerts-panel` no longer exists); `CLAUDE.md` 16.4 KB → 6.8 KB (map → pointer + the always-rules; SPEC.md read by section; tests per area). Pushed as branch `docs/map` on top of `round18-s4` (S4 was finishing; a `CLAUDE.md` push to `main` would have conflicted with its map lines) → after S4 is on `main`, fast-forward `main` to `docs/map` (or merge `main` into it if S4 added commits; S4's map lines already live in MAP.md, keep our `CLAUDE.md` block). Brief template updated.
- 2026-10-15 (account A): R18 S3 notes + briefs S3, S4 written here; from tonight planning/design moves to account B (handoff block at top), A = Claude Code.
- 2026-10-13 · this chat · R18 S1 confirmed merged. Boards part 2 on the R18 canvas (9 boards, `nx-sm2.css`). Tal simplified the supermarket (no staple states, only "don't suggest again"; Nexus-made templates; count + weight; no knobs; "My answers" → "What Nexus learned"; Galaxy Watch app after R20) → boards reworked, decisions recorded. S2 brief waits for Tal's board approval.