# Strategy — business model and target audience (before more features)

Source: Tal, planning chat 2026-10-05 (account B). Tal: "the system is cool, but I don't know enough about the target
audience, how they use it and what they need — no point building something cool that answers no real need."
Status: **hypotheses only; research happens through the MVP** (Tal 2026-10-05, see §0). Everything in §2 is a
*hypothesis* until real use validates or kills it.

## 0. Tal's answers (2026-10-05)
- Goal: a project for family and friends, **with potential to become a business** later.
- Primary audience: **households that shop together** (H1), a little of makers/projects (H2).
- No formal interviews before an MVP — Tal prefers to build the core (supermarket mode and what goes with it) and let
  real use teach. Development continues until the MVP is done → first version to family and friends (closed circle).
- Consequence (planner): the MVP itself is the research instrument. It must ship with: the onboarding questions
  (`MULTIUSER.md` §1), in-app feedback, and usage metrics in the admin panel (weekly active households, shared lists,
  supermarket-mode trips, week-4 retention). Short survey to the circle after 2–3 weeks of use.
- Planner keeps doing desk research (competitors, app-store review mining) — no cost to Tal; feeds supermarket mode.
- **MVP scope (Tal 2026-10-05): the full set, including supermarket price comparison**, multi-user first:
  R15 multi-user foundation → R16 product layer (live shared list, household budget, web push + inbox, in-app feedback,
  admin metrics) → R17 supermarket mode v2 → R18 price comparison (Israeli transparency files) → release to the
  closed circle as the PWA → Android wrapper after that.

## 1. Order of work (original proposal — steps 3–5 postponed until after the MVP)
| Step | What | Who | Output |
|---|---|---|---|
| 1 | Hypothesis canvas (Lean Canvas) — §2 | Tal + planner | the riskiest assumptions, ranked |
| 2 | Desk research: competitors, app-store review mining, Israeli market (price-transparency apps, list apps) | planner | competitor table + top complaints |
| 3 | Interviews, 10–15 people, "Mom Test" style (past behaviour, not opinions about the idea) | Tal | notes per interview |
| 4 | Survey (built from what interviews revealed), target 100–200 answers | Tal publishes, planner drafts | numbers per segment |
| 5 | Optional: shopping diary (3–5 households, 2 weeks) and/or fake-door landing page with pitch variants | Tal | revealed behaviour |
| 6 | Synthesis: segments, jobs-to-be-done, ranked needs, must/should/won't, revised roadmap | planner + Tal | §5 of this file |

Why interviews before the survey: a survey can only count answers to questions we already know to ask; interviews
find the questions. Surveys measure stated preferences — weight past behaviour ("last time you…") over intentions.

## 2. Lean Canvas — draft hypotheses (to be validated)
Lean Canvas, not the classic Business Model Canvas: it is built for an unvalidated product (problem, solution,
metrics, unfair advantage instead of partners/resources/activities). A classic BMC can be derived later.

| Block | Hypothesis (H) | Confidence |
|---|---|---|
| Customer segments | H1 Israeli households that shop together (couples / families, 25–45, smartphone-first). H2 makers/hobbyists buying parts for projects (Tal's original use). H3 price-conscious online shoppers tracking prices. | low — which one is primary is the main open question |
| Early adopters | Couples/families already running a shared list in WhatsApp / Keep / a list app and annoyed by it | low |
| Problem | P1 the shared list is scattered (WhatsApp, notes) → duplicates, forgotten items. P2 supermarket prices rise, comparing is hard. P3 household budget overruns, no overview. P4 recurring items forgotten. | low |
| Existing alternatives | WhatsApp group, Google Keep, Bring!, Listonic, AnyList, OurGroceries; supermarket chain apps; price-comparison sites/apps | medium |
| Unique value proposition | "The smart way to run your household shopping — shared lists, supermarket mode, prices and budget, all in one place." | untested |
| Solution | shared live lists + supermarket mode + price comparison (transparency files) + budget | built partly (single-user) |
| Channels | closed circle → built-in invites (every shared space invites ≥ 1 person) → Facebook parenting/household groups → word of mouth | low |
| Revenue streams | unknown. Options to test: free; freemium (AI / price comparison / more spaces); affiliate with stores. Not: selling user data. | very low |
| Cost structure | hosting (Vercel Pro needed for any commercial use), AI calls, store fees (Google $25, Apple $99/yr), Tal's time | medium |
| Key metrics | weekly active households, % of lists shared, items checked in supermarket mode / week, week-4 retention | — |
| Unfair advantage | none yet (honest). Candidates: Hebrew-first + Israeli price data; AI that understands the household | low |

Riskiest assumptions (test first): (a) households feel enough pain to leave WhatsApp/free apps; (b) which segment is
primary (H1 vs H2 vs H3) — the current app mixes all three; (c) someone would ever pay, or what else funds it.

## 3. Research instruments
(Interview guide and survey draft go here once written.)

## 4. Findings log
### 2026-10-05 · desk research · competitors (planner)
- **Global shared-list apps** (Bring!, AnyList, OurGroceries, Listonic, Google Keep): all free with real-time sync; they
  compete on sync reliability, speed of adding, aisle/category sorting, recipes. Reviewers rank *reliable instant sync*
  above smart features; recurring complaints: paywalls appearing after users invested time, aggressive upsells/ads,
  duplicates and cluttered lists, sync slower than ~2 s, weak offline in the store.
- **Israel — already crowded where groceries meet prices:** PriceZ (100K+ installs, 4.6★, ~40 chains, shared lists,
  cheapest basket nearby, price alerts, coupons; reviews: location bugs, Hebrew-only, city-boundary distances), CHP,
  Savy, IsraBis (claims 49 chains, family shopping, AI), SnaplistAI (list from receipts + basket comparison),
  "סופרמרקט – רשימת קניות" (Hebrew shared household lists, Israeli product DB, templates, Google sign-in).
  → Price comparison and a Hebrew shared list are **table stakes in Israel, not a differentiator**.
- **Gap none of them cover:** they are grocery-only. Nexus already handles online orders, delivery tracking, projects,
  price history and spending across all stores. Candidate positioning: *one place for all of the household's buying —
  supermarket and online orders, one budget* (to validate with the closed circle).
- **Price data feasibility:** open-source parsers for all chains on the gov.il list exist (`OpenIsraeliSupermarkets`,
  Python, beta, daily tests). Full daily dumps are large → fetch/parse outside Vercel (e.g. scheduled GitHub Action),
  keep only stores near users and products that appear on users' lists (Turso free-tier size).
- Lessons for R16–R17: sync must feel instant and never lose an item; no paywall surprises; adding must be fastest
  path in the app; offline in the store; "someone is shopping now / finished" notification; duplicates merged.

## 5. Output — what the product should be
(Filled after step 6. Feature rounds resume from here.)
