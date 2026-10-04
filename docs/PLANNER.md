# Planner playbook — how the planning chat works on Nexus

Read this first if you are the **planning** Claude (claude.ai chat / Project "Nexus"), whichever account you run on.
Claude Code (the builder) reads `CLAUDE.md`; this file is for the chat that talks with Tal, designs, researches and
writes the round briefs. Everything durable lives in this repo, not in chat history.
Setup of this chat (network, GitHub connector, rebuilding it on a new account): `docs/ENVIRONMENT.md` — any change
to setup, tooling or workflow is recorded there in the same session.

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
- Roadmap (Tal 2026-10-04, superseded by the updates below): R13 home/shopping/search/intro → R14 bug fixes → R15 multi-user foundation (site sign-in on
  web + phone, Google + email, desktop QR login, short onboarding questionnaire that adapts the app, per-user data,
  privacy) → R16 Android wrapper + testers. Tal to prepare for R15: domain, Google Cloud OAuth client, Resend, name check.
- **Round 14 decisions (Tal 2026-10-04):** light theme "B · toned" (page `#eeede9`, cards `#f8f7f4`); active nav row = soft
  tint + 3 px spark accent bar (never solid black); logo left face follows the theme (light face in light mode, dark in
  dark, thin edge; Graphite only; app icon unchanged); To buy / Urgent / Unsorted merged into one To buy with filter
  chips; indicators only on Home, Spending, project and store pages; calendar = month view + ICS feed that also removes
  deleted/received events; Home always shows AI or rule suggestions when the account has items. Every visual round now
  ships side-by-side parity PNGs (mockup vs app).
- **Roadmap update (2026-10-04, later):** R14 fixes → R15 multi-user foundation → R16 multi-user product layer → R17
  supermarket mode (recurring household purchasing, inside shared spaces, sidebar entry) → R18 Android wrapper.
- **Multi-user (Tal 2026-10-04), full plan in `docs/MULTIUSER.md`:** closed circle first (invite codes); spaces (personal +
  shared household, roles owner/member/viewer, sharing per space); sign-in Google + passkey, email code only for recovery;
  Tal's data moves to his Google account (admin); editing needs an account, public read-only list links stay, guest system
  retired; Telegram + extension **off for everyone** from R15 (alerts → web push + in-app inbox); AI quota per user per day;
  AI privacy = disclose + minimise (free Gemini tier); onboarding = why / stores / budget+currency / who you shop with;
  admin panel = users+invites, AI usage, all reports, metrics. Split into R15 (foundation) + R16 (product layer).
- Free-tier stack (Vercel Hobby, Turso, Gemini free + Groq/OpenRouter fallback). Tal declined paid usage credits.

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
  `docs/UI-V2.md` (design history + motion plan), `docs/design/` (static mockups), `src/lib/help/nexus-help.md`.
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
- 2026-10-04 · B · Multi-user planned in full with Tal (4 question batches): wrote `docs/MULTIUSER.md` (decisions, data model, scoping guards, migration, R15/R16 split, Tal's setup checklist); roadmap shifted (supermarket → R17, Android → R18). ROUND15 brief to be cut after R14's Open.
- 2026-10-04 · B · Tal tested R13: no AI on Home (rules too strict), sidebar/phone shell/dark mode not matching mockups, Ask seed resent on every new chat, indicators on To buy. Canvas page "Round 14" (logo swap, light tone). Advised: keep the PWA, wrap as an app after multi-user. Wrote `docs/ROUND14.md`.
- 2026-10-04 · B · Rebuilt the design canvas "Nexus Style Directions" on account B from Tal's export (Home v3), then Home v4 per Tal's notes (status tiles, meters instead of sparklines, stronger borders, louder AI suggestion, compact phone, Shopping switch with list/grid, phone search incl. settings, collapsible sidebar, 3 s intro). Tal approved; wrote `docs/ROUND13.md` and saved mockups to `docs/design/home-v4/`.
- 2026-10-04 · B · Set up this account's chat: sandbox network confirmed (clone, npm ci, typecheck, lint run here), GitHub custom connector via own OAuth App, secret audit of full history clean, repo stays public until launch. Wrote `docs/ENVIRONMENT.md` (setup + rule: every setup/tooling change is logged there). Added Hebrew/English RTL writing rules under "How to talk with Tal".
- 2026-10-04 · A · Tal: drop the big "Today's best move" hero, fewer rounded boxes. Canvas page "Home v3 — open layout": one surface with hairline sections, status sentence header, flat stats with sparklines, slim "Nexus suggests" line (1/4), "This week" strip, Needs you + On the way, pace + projects, Nexus noticed; flatter To buy ⇄ On the way. Awaiting Tal.
- 2026-10-04 · A · Round 12 brief = small fixes (sheet swipe-down, slow-swipe lock, assistant header + suggestion rows, Ask pill). Dashboard redesign moved to Round 13: research done (Oura, Linear, Monzo, Ramp, Brex, Stripe, Shopify, Mercury); canvas page "Home v2 — value first" (best-move hero, Needs-you queue, KPIs vs your usual, budget pace, delivery tracker, project rings, Nexus noticed; phone To buy ⇄ On the way switch cards) — awaiting Tal before the Round 13 brief.
- 2026-10-03 · A · Round 12 mockups on the canvas (page "Round 12 — mature look + dashboard"): Q quiet-pro vs E editorial; dashboard, customize mode + presets, grouped To buy, history table, phone. Proposed phone dock: Home · To buy · + · Projects · Insights (On the way moves into To buy) — awaiting Tal.
- 2026-10-03 · A · Round 11 brief (intro on open only + bigger intro, nested overlays, phone History, swipe/long-press/hover quick actions, uniform pictures, solid tags). Round 12 planned: visual maturity (fewer rounded boxes, flat sidebar, order history), customizable dashboard, decluttered product page with AI groupings — mockups first.
- 2026-10-03 · A · Product direction discussed (multi-user, Capacitor first, supermarket); PLANNER.md created.
- 2026-10-02 · A · Round 10 brief (animations, camera, projects page, pictures via Serper).
