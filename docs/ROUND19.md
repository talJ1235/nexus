# Round 19 — Tal's fixes after S5 + real products, current prices, deals, store directory

Source: Tal's voice note + review after R18 S5 and the R19 boards (2026-10-19, all approved) — `docs/R19-NOTES.md`.
Boards: **`docs/design/r19/`** (+ `nx-r19.css` on top of `nx-s5.css`) — `Main` (= List-prices-phone), `Product-phone`,
`Match-phone`, `Compare-phone`, `Stores-phone`, `Fixes-phone`, `Product-desktop`. Tweaks: dark, Plum, states. The
boards are Hebrew only: build he + en from them. **Recipes (R18b) are postponed** (Tal 2026-10-19) — not in this round.
Where this brief and an older decision disagree, **this brief wins**. Results go to **"## Open"** at the end of this
file. Tal runs it **unattended overnight (~8 h)**; if time runs short, the order of the parts is the priority order
(A → B → C → D → E), and a part left open is fine — say where it stopped.

Tal's bar (his words): real pictures for every product, every barcode priced in every chain, a convenient catalog to add
from the search bar with pictures, everything seamless; **every design rule applies while building** (the skills
below), not only on the boards.

## How to run
- **Step 0 — boards.** Tal unzipped `nexus-r19-boards.zip` at the repo root → `docs/design/r19/` (7 boards +
  `nx-r19.css` + `nx-s5.css` + `canvas.json`). On `main`: commit `R19.0: R19 boards (from the planning chat)`, push.
  Then branch **`round19`** from `main`.
- **Commit and push after every single item** (`R19.<part><k>: …`, `git push origin round19`); tick `[x]` here + one
  line in "### Progress" in the same commit; decisions in "### Decisions" at once; anything for Tal in "### For Tal".
- **Resuming:** `git fetch`, check out `round19`, read Progress + `git log`, continue from the first unticked item.
- Unattended; never stop to ask — take the reading closest to the board + this brief, write it in Decisions.
- Read open reports and the error log first (Tal filed an AI-chat bug there — A8). Bugs with an unknown cause:
  reproduce first (failing test / smoke step), then fix.
- **DB additive only** (new tables / nullable columns). This round adds tables → rehearsal on a copy of a fresh
  read-only prod snapshot before merging. Merge `--ff-only` only when all items are ticked, one full CI run on the final
  code commit is green and the rehearsal passed; then watch `guards` on `main` + prod smoke (re-run once if flaky;
  twice → fix). Not all ticked by morning → don't merge; Open says where it stopped.
- Rules from R18: i18n he + en, `useDevice()` / `phone:` / `desk:`, phone test contexts with mobile UA, no `ad-*` /
  `sponsor` / `promo-*` class names (`test:adblock` — careful: "deal" / "promo" UI is new this round),
  `SEARCH_OFF=1` in tests, logical RTL utilities, `.bidi` on user / product text. Visible items: phone 360/390 + desktop
  1366, light + dark, Graphite + Plum, he + en, worst case (long product names, 8 tags, ₪1,234.90), reduced motion, a
  smoke step each. Motion + touch bar: `.claude/skills/` (emil-design-eng, apple-design, mobile-native, animate +
  RECIPES) + frontend-design; tokens at the top of `nx-s5.css`; press scale .94–.97; hover only under
  `(hover:hover) and (pointer:fine)`. The boards are reference, not code to paste.
- **Money everywhere:** the ₪ sign smaller than the digits (`.cur` in `nx-r19.css`, .66 em), digits tabular, the amount
  isolated (`direction:ltr; unicode-bidi:isolate`). Tags / chips never overlap or cut each other: one line each,
  wrap to the next row (Tal's review of `Compare-phone`).
- Supply chain: any new package pinned to an exact version at least 14 days old; GitHub Actions SHA-pinned.
- Keys are optional: without `SERPER_API_KEY` pictures fall back to barcode / Open Food Facts / illustrations; without
  the ingestion secrets (B0) the price jobs run dry and say so in Open.

## Part A — Tal's fixes after S5 (`docs/R19-NOTES.md` §2, board `Fixes-phone`)
### A1 [x] Smaller floating Ask
Too big next to everything else. Phone 48 px (stars 28 px, the same optical shift scaled: ≈ -1.5 px, +.45 px), computer
52 px; the ring 2 px as now. Area: AI & assistant (`components/app/ask-fab.tsx`, `.ask-fab` in globals.css). Keep
every S5 rule (perfect opaque circle in every state, rises over toasts, hidden in store mode / sheets). Update the S5
pixel test's sizes. **Acceptance:** pixel test green at the new sizes, light / dark × Graphite / Plum.
### A2 [x] The active dock tab is obvious
Today only grey → black. Board: a 56×30 pill behind the active icon (ink 11 %, Plum: brand 16 %), stroke 2.2, label
750; the pill moves between tabs with `--ease-drawer` (≈ 260 ms; reduced motion: no slide). Area: App shell (`lib/dock.ts`,
`phone-shell.tsx`). The computer sidebar's active row already has its tint — check it reads as clearly. **Acceptance:**
smoke asserts the pill under the current tab on every tab; contrast of the active label ≥ 4.5:1.
### A3 [x] Home "+" = one scan entry
Board `Fixes-phone` state "+ menu on Home": three tiles **Barcode · Product photo · Receipt** (the same camera as the
Supermarket "+", opened in that mode), then rows "Paste a product link" and "Search a product" (opens the catalog search,
D5). Remove the separate "scan receipt" entry. Areas: App shell (dock quick menu), Camera. **Acceptance:** smoke opens
each tile → the camera in that mode; no duplicate entries.
### A4 [x] Swipe-to-delete v2 — calm, deliberate, soft
Tal: the quick menu looks bad, deleting is a "boom", accidental swipes delete. Board `Fixes-phone` (try the drag): the
row opens to a **grey** Delete button at ~96 px; the delete point moves to **~210 px (≈ 55 % of the row)** — only past
it the underlay turns red, the icon grows (spring), the label says "Release to delete", one haptic tick
(`navigator.vibrate(8)` where allowed); release past the point → the row slides out and **folds its height softly**
(≈ 360 ms ease-out, opacity first) — no red flash on the whole row; a fling only deletes when it also crosses the
point. Undo as now. The quantity side (stepper) gets the same calm look. Area: Supermarket (`row.tsx`, `useSwipe`
thresholds from S5 A2). **Acceptance:** gesture test: 150 px release → open, not deleted; 230 px → deleted + Undo
restores; frame trace of the fold has no layout jump in rows below.
### A5 [x] The whole row opens the product
Tal asked before and it still only opens from the picture. Every part of the row that is not the name (rename), the
quantity chip or the price opens the product page (D2) — the empty space, the brand line, the deal line. Board `Main`:
a full-row hit layer under the content. **Acceptance:** smoke taps 5 x-positions across a row (picture, brand line,
empty middle, between chip and price, end edge) on phone 360 and 390 → the product page each time; tapping the name
still renames. This step must exist and pass before A5 is ticked.
### A6 [x] "Start shopping" always floats on the Supermarket tab
It sometimes doesn't show after switching segments or coming back from another tab. It must be there every time the
Supermarket tab is shown, float above the dock while scrolling up or down, and settle into its place when reached
(as S4 D3 meant). Find why it misses (mount / observer / scroll container) — Decisions names the cause. **Acceptance:**
smoke: open the tab from each other tab and from each segment, scroll top / middle / bottom → the pill is visible
above the dock each time.
### A7 [x] "Nexus suggests" opens smoothly
Its opening is a jump. Height + opacity with `--ease-drawer` ≈ 320 ms, rows stagger in 30 ms, no layout shift of the
list below (it pushes smoothly). **Acceptance:** frame trace: no single frame moves the list by > 24 px.
### A8 [x] The AI chat: no jumps, answers flow, the reported bug
Opening the chat sometimes jumps; answers should arrive smoothly one after another, not as a separate section that
pops. Read Tal's report about how an AI question renders (reports / error log) and fix that bug. Messages enter with a
short rise + fade; the composer and the list never move under the finger; streaming text grows in place.
**Acceptance:** frame trace of open + one answer; the reported case as a test.
### A9 [x] New chat = a nice transition; reopening opens the newest chat
"New chat" today just swaps: the old thread slides / fades out, the empty state rises in (≈ 300 ms). Reopening Ask
opens the **newest** chat — if the newest is empty (New chat was pressed), it opens empty, not the last chat with
messages. **Acceptance:** test: chat with messages → New chat → close → open → empty chat.
### A10 [x] Real store directory instead of free text
Store choice lists every food chain in Israel with its **real logo** (no first-letter tiles) and real branches with
exact addresses, from the chains' Stores files (B2); no free-text stores. Board `Stores-phone`: search by chain /
city / street, "near me" (geolocation, asked only on tap), chain grid (8 + "more"), branches with distance + the list's
estimate there (D4). Existing `space_store` rows map to a branch (best match; unmatched stay and ask once). Logos: the
chain's official logo image, stored in `public/chains/` (source + date in Decisions). Areas: Supermarket
(`store-picker.tsx`, `lib/grocery/chains.ts`), onboarding stores step. **Acceptance:** every chain in the transparency
list has a logo file; picker search finds a branch by street; old spaces keep their store.

## Part B — price data (Map area: Supermarket + new "Prices" area)
### B0 [x] Where the jobs run (probe first)
Some chain portals block non-Israeli IPs. Use the maintained open-source scrapers (OpenIsraeliSupermarkets
`israeli-supermarket-scarpers`, daily-tested per chain; pinned) as the reference / library for every chain's portal
and file format — don't hand-roll what it already does. First, probe every chain from **this PC** (Israel) and from a
**GitHub Actions** run: reachable? which files (PriceFull, Price, PromoFull, Promo, Stores)? how often published?
Table in Decisions. Plan: scheduled GitHub Actions workflow `prices.yml` (writes to Turso with repo secrets
`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`; if they're missing it runs dry and logs that). Chains blocked from Actions →
a local runner script for Tal's PC (`scripts/prices-local.*`, Windows Task Scheduler line in For Tal) — **list the
blocked chains for Tal; he decides later** between his PC and a small Israeli server. Note: when the repo goes private,
Actions minutes are capped (ENVIRONMENT.md) — size the schedule so a private repo stays inside the free minutes, and
write the numbers in Decisions.
### B1 [x] Chains + branches directory
Tables (additive): `chain` (id, names he/en, gov chain id, logo), `branch` (chain, store id, name, address, city,
lat/lng when known — geocode once and cache if the file has none, never on the client). From the Stores files, refreshed
daily. **Acceptance:** `test:prices` parses a fixture Stores file of 3 formats; counts per chain in Decisions.
### B2 [x] Current prices and deals (intraday, not "morning prices")
Tal: prices must be current. Ingest the nightly full files **and** the partial price / promo files the chains publish
during the day, as often as each chain publishes (B0 numbers). Store the price per product per branch, writing only
changes; keep a daily history point per product per chain (for the 90-day chart). Deals from Promo files: X for Y,
% off, club-only, minimum basket, valid-to date; mark club deals. The app shows "updated · HH:MM" = the time of the
newest file read for that branch — never "morning prices"; "verify at the till" stays. Size: measure rows / reads /
writes per day against the Turso free plan and Vercel limits; if all branches of all chains don't fit, keep every
branch of the chains + cities the users chose and one representative branch per other chain — numbers in Decisions.
**Acceptance:** unit tests on fixture files (full + partial + promo, weighted items, 3 portal formats); a dry run
on today's real files from this PC with counts and timing in Decisions.
### B3 [x] The product catalog
Every barcode in the price files becomes a catalog product: gtin, name, brand (manufacturer), size + unit, weighted
or not, section (classify with the existing dictionary / `classify-server.ts`, batched), short display name
(`lib/short-name.ts` rules). Names cleaned (chains differ: pick the most common clean form). **Acceptance:**
`test:catalog` (name cleanup, merge across chains by gtin, weighted produce codes that aren't real barcodes).
### B4 [x] Real pictures for every product
Tal's must-have. For each catalog product: barcode → Open Food Facts → own photos (household scans) → Serper image
search by barcode + name, checked by a small AI yes/no ("is this the product?", batched, counts in the system's AI
budget, not a user's) → resized thumbnail (≤ 20 KB webp) in Blob; illustration only when nothing passes. Fetch lazily
(the first time a product is shown / searched) + a nightly batch for the most-bought products; daily caps on Serper
and AI calls; storage numbers in Decisions (Blob free limits). Area: Products (`lib/product-pictures.ts`,
`picture-*.ts`). **Acceptance:** coverage report in Decisions (% of products seen in the demo + Tal's prod list with
a real photo); `test:pictures` extended.
### B5 [x] Freshness, health, admin
Admin → System: last file per chain, rows changed today, failures (a chain whose files stopped, a format change),
coverage of pictures. A chain silent for > 26 h shows "prices may be old" in the app for that chain. **Acceptance:**
`test:admin-access` covers the new admin view; a stale-chain fixture shows the warning.

## Part C — every item is a real product (board `Match-phone`)
### C1 [x] Matching + learning
A supermarket item maps to a catalog product: barcode adds map exactly; typed names map by the household's learned
brand (`brand_buy`, S3 C6) + size + the catalog ranking; if confident → mapped silently (toast "as always · ₪6.80 ·
Change"); if not → C2 asks once. "Doesn't matter which" = a product-type item priced as the cheapest match in the
chosen store. The choice is remembered per household per typed name (forgettable in "What Nexus learned").
**Acceptance:** `test:match` (exact gtin, learned brand, ambiguous → ask, "any" → cheapest, forget).
### C2 [x] "Which one?" sheet
Board `Match-phone`: candidates with photo, size, price at the store, deal, why ("you bought it 5 times"), search in
the catalog, "doesn't matter which", "remember" (on). Opens when adding an ambiguous item and from a row without a
price ("choose a product"). **Acceptance:** smoke: add "חלב" → sheet → pick → row shows the product + price.
### C3 [x] Existing lists get mapped
Nightly + on first open after the update: map existing supermarket items with the C1 rules (batched AI only where
rules can't decide; system budget); unmapped rows show "choose a product". Never changes what the user typed.
**Acceptance:** on the seeded demo + a copy of prod, the share mapped in Decisions.

## Part D — the screens
### D1 [x] Prices and deals in the list (board `Main`)
Each row: price for the count at the chosen branch + unit price (₪/kg, ₪/unit), an old price struck through when a
deal applies, and a deal line under the name that fits the list: "3 for ₪15 · you have 3 ✓", "4 for ₪12 · worth
taking 4" (tap → set the count), club deals in their own colour. Section band shows its subtotal. Basket card on top:
estimate, "updated · HH:MM", and "at <branch> the list is ₪N cheaper" → D3. Rows without a product: "choose a
product" → C2. **Acceptance:** `test:deals` (deal maths: X for Y with counts below / at / above X, % off, club,
weighted); smoke on the row and the basket card.
### D2 [x] Product page (boards `Product-phone`, `Product-desktop`)
Real photo, name, brand, size, barcode, tags, ₪ per 100 g; price at my store + deal tip with "verify at the till";
the same product at nearby branches of every chain (bar per price, cheapest marked, mine highlighted) + "all chains";
90-day history with deal points; "same type, cheaper" (by unit price); "what Nexus learned" switch; count stepper +
"in the list". Opened from the row (A5), search (D5), compare (D3). Computer: two columns per the board.
**Acceptance:** smoke phone + desktop; layout guards at 360 px with the worst-case name.
### D3 [x] Where is my list cheapest (board `Compare-phone`)
Ranks branches by the list's total incl. deals: near me (radius chip) | all chains (+ online with delivery when the
chain publishes it), club on / off; per branch: total, saving vs mine, items found "8 of 9" + missing items as a
line with a substitute, deals count; "shop there this time" sets the trip's store; split hint when two stores save
more than ₪N (say if it's probably not worth the trip). Missing items count at the average price. **Acceptance:**
`test:compare` (totals with deals, missing items, ordering); smoke.
### D4 [x] Store picker shows the estimate (board `Stores-phone`) — with A10.
### D5 [x] Catalog search with pictures
Typing in the add bar searches the catalog: photo, name, brand + size, price at my store; household products and
learned brands first, then popularity; the typed letters bold, "did you mean" kept; an Enter on free text still adds
as today (then C1). Also "Search a product" from A3. Fast: results ≤ 150 ms p95 on the server for 3 letters (index;
number in Decisions). Area: Supermarket (`lib/grocery/search.ts`, `/api/grocery/search`). **Acceptance:** bench +
smoke (type "פסט" → Barilla penne with photo → add).
### D6 [x] Real prices everywhere they're estimated
Start-trip estimate, store mode total, trip finish vs budget, Home "Next shop" / Budget pace, Spending's supermarket
forecast use the catalog prices when mapped (fallback as today). **Acceptance:** unit on the estimate function.

## Part E — deals that matter (optional if time is short)
### E1 [x] "Your usual product is on a deal"
When a product the home buys regularly gets a deal at its store: one batched notification per day at most ("Barilla
penne 2 for ₪10 at Shufersal Deal"), following the existing push rules (night quiet, owner + members, never viewers),
and a line in "Nexus suggests". **Acceptance:** `test:notify` case.

## Part F — guards and docs
### F1 [x] Guards
Smoke steps per item (phone + desktop). Unit: `test:prices`, `test:catalog`, `test:match`, `test:deals`,
`test:compare`, extended `test:pictures` — all in CI. `test:adblock` covers the new deal / price class names.
`scripts/parity-r18.mjs` (or a new `parity-r19`) gets the R19 boards. Full phone + desktop smoke pass.
### F2 [x] Docs
`SPEC.md` R19 section, `docs/MAP.md` — a new **Prices** area (jobs, tables, catalog, pictures, admin) + touched areas
in place, help topics (prices + deals, choosing a product, comparing stores, the store directory),
`docs/ENVIRONMENT.md` (the prices workflow, secrets, the local runner, schedule + minutes) + log line. "### For Tal" =
a phone checklist (A1–A10 + list prices, a product page, "which one?", compare, store picker, search with photos)
and the secrets / runner steps he must do.

## Open
### Progress
- A1 — Ask 48 px phone / 52 px computer, stars 28 / 30 px with the optical shift scaled; S5 pixel test green at the new sizes (light/dark × Graphite/Plum, phone + desktop).
- A2 — dock: one 56×30 pill behind the active icon (ink 11 % / Plum brand 16 %) sliding between tabs on the drawer ease (260 ms, no slide with reduced motion), stroke 2.2, label 750; smoke checks the pill on every tab × light/dark × Graphite/Plum, label ≥ 4.5:1, and the slide.
- A3 — Home "+" = Scan (Barcode · Product photo · Receipt → the Supermarket camera in scan / photo / photo + tall frame; new intent `receipt`) + "Paste a product link" + "Search a product" (the Supermarket add screen); other tabs keep the add list; smoke opens each tile in its mode, 5 entries, no duplicates.
- A4 — swipe-delete v2: grey Delete at 96 px, delete point = 55 % of the row (clamped 170–260; 201 px at 390, 185 at 360), red + spring icon + "Release to delete" + one vibrate(8) only past it, flings never commit short of it; the exit slides while the row fades first and folds its height (360 ms ease-out, WAAPI); quantity side calm grey too. Smoke at 360 + 390: 150 px → open, 230 px → deleted, Undo back; fold trace 55 frames, 60 px moved, worst frame 7.1 px.
- A5 — the whole row opens the product: a hit layer under the content (z −1 in the row's stacking context), the name area lets taps through except the name's own letters; smoke taps picture / brand line / empty middle / chip gap / end edge at 360 + 390 → the product every time, the name still renames.
- A6 — Start shopping always floats: the floating bar is portaled to document.body and "docked" is read from the slot's box on every scroll / resize / layout change; new smoke opens the tab from every tab + Products segment (each scrolled to its end) and checks top / middle / bottom / back up — red on the old build (bar at top 2375 px), green now.
- A7 — "Nexus suggests" opens as one soft push: grid-rows on ease-in-out (.42,0,.58,1) for max(320 ms, 1.3 ms per px, ≤ 520), rows rise in 30 ms apart (fade with reduced motion); frame trace: 249 px opened over 19 moving frames, worst frame 21.9 px, the list above moved 0 px. (Also A6 follow-up: when open suggestions carry the slot above the screen the bar floats again — the A6 smoke caught the docked bar cut at the top.)
- A8 — chat: answers' markup through `lib/chat-inline.ts` (refs + amounts inside bold, a bold run is a chip only when it's a short figure, half-written refs held back while streaming; `test:chat-inline` has Tal's report verbatim); the answer's block exists from the question on (thinking → text in place), the list is placed at its end before paint and then glides ≤ 28 px a frame only while the person is at the end, messages rise + fade in; the phone reveal no longer re-slides ~700 ms in. Frame trace (phone + desktop): opened at the end, composer still from the first rest frame, one answer block, worst glide 10 px.
- A9 — New chat: the thread fades + lifts away (140 ms, its composer disabled), the empty chat rises in (220 ms; fades with reduced motion); New chat marks the empty chat as the newest (`nexus.askNewestEmpty`, this device) so reopening — also after a reload — opens it empty until its first exchange is saved. Smoke (phone + desktop): messages → New chat (out → in) → close → open: empty; reload: empty; one exchange → reopens with it.
- B1 — chains + branches directory: tables `chain` / `branch` (+ the rest of the price tables, additive: `catalog`, `chain_price`, `branch_price`, `price_day`, `promo`, `promo_item`, `price_file`, `product_choice`; nullable `items.catalog_gtin / match_state / match_at`, `space_store.branch_id`) in `db/migrate-r19.ts`; parser `lib/prices/parse.ts` (UTF-16 / UTF-8 BOM / windows-1255, any tag case, CBS city codes → names via `lib/prices/cities.json` from data.gov.il, city guessed from the name when the code is missing); `test:prices` green on 4 Stores layouts + ingest.
- B0 — probe done from this PC and from GitHub Actions (`scripts/prices/probe.py`, run 39370088716); pinned `il-supermarket-scraper==1.0.15` (2026-10-04); `.github/workflows/prices.yml` (nightly / intraday / probe, dry without secrets) + `scripts/prices/prices-local.cmd` for the chains GitHub can't reach.
- B2 — current prices + deals: `lib/prices/ingest.ts` writes only changes (chain price = the most common across the branches read; a branch's own prices for chosen branches + the chain's representative; partial files move the branch and, for the representative, the chain; a `price_day` point when a chain's price changes); deals from Promo files (`lib/prices/deals.ts`: N for ₪X, price, % off, 2nd at, club, min basket, ends); `branch.prices_at` = the newest file read (the app's "updated · HH:MM"). `test:prices` covers full + partial + promo, weighted, 3 portal formats.
- A10 — store directory: the picker lists every chain of the transparency list (`CHAINS` now 33, each with its scraper) — 8 + "more" with real logos, no letter tiles anywhere (picker, Supermarket chip, start screen, Settings, Spending, onboarding — onboarding keeps the 12 big chains); search by chain / city / street over the `branch` table (`findBranches`, every word narrows), near me (location asked on tap), no free-text stores; old `space_store` rows keep their store and map to a branch when one fits (`mapStores`), the rest ask once ("Choose the exact branch"). Smoke (phone + desktop) green; `test:prices` checks the big chains' logo files.
- B3 — the catalog: every barcode in the price files → one `catalog` row (`lib/prices/catalog.ts`): the best name across chains (a cut spelling loses to its continuation), brand = the cleaned manufacturer, size as number + unit (g / kg / ml / l / u), weighted, store codes kept per chain (`<chain>#<code>`), section from the dictionary, a short display name for long names; `test:catalog` green (names, merge by gtin, weighted produce / in-store codes).
- B5 — freshness + health: Admin → System → Prices (`priceHealth`): per chain the newest file, today's files / rows / changes, failures (red), stale (> 26 h, `lib/prices/health.ts` `isStale`) flagged "Prices may be old"; the catalog's picture coverage in the header. `test:admin-access` seeds a fresh and a 30 h-old chain → flagged / not; `test:prices` covers the 26 h rule. The app shows the same "prices may be old" line for a stale chain on the list's basket card (D1, from `staleChains()`).
- C1 — matching + learning: `lib/prices/match.ts` (`decideMatch`: barcode exact → the remembered choice → the usual brand + typed size → one clear candidate → else ask; "doesn't matter which" = the cheapest of the type per kg / litre at the store) on top of a trigram FTS5 catalog search (`catalog_fts`, ranking: word starts, the same dictionary type, the home's own products, popularity); English row names search by their type's Hebrew name. `addToSupermarket` matches new rows and returns it — "As always · ₪6.80 · Change" toast when the choice / usual brand decided; choices kept per typed name in `product_choice`, `forgetSmProductChoice` forgets one or all. `test:match` green.
- C2 — "Which one?" sheet (`choose-product.tsx`, board Match-phone): candidates with photo, size, price at the store, deal, why ("Your usual brand" / "On your list before"), catalog search, "Doesn't matter which" (with the price range), "Remember" (on); opens after an ambiguous add and from a row's "Choose a product". Smoke (phone + desktop): add "חלב" → asks → 3 milks → Tnuva → the row shows ₪6.90; the same name again maps silently (why: choice).
- C3 — existing lists get mapped: the first Supermarket open after the update runs C1's rules on the unmatched rows in the background (`mapRows`, 40 a time; the rows update through live sync); never changes what was typed; unmatched rows show "Choose a product".
- D1 — prices and deals in the list (board Main): each row the price for its count at the store + the unit price (₪/kg, ₪/L, ₪/100 g) or the struck regular price under a deal; the deal line under the name in the list's terms ("4 for ₪12 · you have 4 ✓", "3 for ₪15 · worth taking 3" — tap sets the count; club deals in their own colour); the section band's subtotal; the basket card (estimate, "n of m priced", "updated · HH:MM", "verify at the till", "prices may be old" when the chain is stale); "Choose a product" → C2. Money: ₪ at .66 em, tabular, LTR-isolated (`Money`). `test:deals` green; smoke on the rows + basket (phone + desktop).
- B4 — real pictures for every product: `fillCatalogPictures` (barcode → Open Food Facts → the homes' own photos → Serper by name + the AI yes / no on the candidates, from the system's AI budget → a ≤ 20 KB, 160 px webp in Blob `catalog/<gtin>.webp`; an illustration never counts as a picture). Lazy: the first time products show (the list's rows, the catalog search, "Which one?") + nightly for the 40 most-bought (`mostBought`, daily cron); caps 60 products / day, 3 tries each. `test:pictures` extended (catalog lines, ≤ 20 KB thumbnail, caps).
- D2 — the product page (`product-page.tsx`, boards Product-phone / Product-desktop): photo, name, brand · size, barcode, tags (section, ₪ per 100 g / ml); the price at my store + "updated · HH:MM" + each deal as a tip with its end date and "verify at the till"; the same product at every chain + the chosen branches (a bar per price, the cheapest green, mine highlighted); my chain's 90 days as a step line with deal dots + the lowest; same type, cheaper (by unit price at my store, opens that product); "what Nexus learned" switch (this product for the row's name); a stepper + "In the list · n" (or "Add to the list" from the search). A row with its product opens it (the row's own sheet is its pencil). Phone full screen, computer a two-column dialog. Smoke phone + desktop; worst case (a 90-letter name, ₪1,234.90) fits at 360 / 390 / 1366 with no sideways scroll.
- D3 — where is my list cheapest (`compare.tsx`, board Compare-phone; `lib/prices/compare.ts`): every chain with prices + the branches the home chose, ranked by the open list's total with deals, club on / off; per store the saving vs mine, "n of m found" + the missing rows on their own line (counted at the average price elsewhere), the deals count, "Shop there this time" (the trip's store); the split hint says when two stores save enough and when it's not worth the trip. The basket card's line "At Rami Levy the list is ₪39.50 cheaper · Compare". Store codes (weighed produce) match across chains by name. `test:compare` green; smoke: ranking, club switch, shop there, and my store's total = the basket estimate.
- D4 — the store picker shows the estimate (board Stores-phone): every branch row (search results and the home's stores) carries the open list's total there — the branch's own prices when it has them, else its chain's (from D3's `compareSmList`). Smoke: Rami Levy · Talpiot shows its estimate.
- D5 — catalog search with pictures: the add bar's type-ahead (`/api/grocery/search`) puts catalog products after the home's own (photo, brand · size, the price at the home's store; the typed letters bold; the home's products / usual brands lead the ranking; "did you mean" kept; Open Food Facts only when the catalog has nothing); + adds with the barcode so C1 maps it exactly; Enter on free text adds as before (then C1). "Search a product" (A3) lands here. Smoke: "פסט" → Barilla penne with its photo + ₪7.50 → added, priced.
- D6 — real prices everywhere they're estimated: one `estimateList` (`shelf.ts`) for the Supermarket header, Home's "Next shop" / budget pace (`useEstimate`), the trip bar, the start screen and store mode's total + spent — rows with their product at the store's price with the deal that fits, the rest at the last price paid as before; the same units rule as the rows (`lib/prices/units.ts`). `test:estimate` green (deals, fallback, weighed kg, no store, the row's price).
- E1 — "Your usual product is on a deal": `usualDeals` (in the hourly notify sweeps) finds deals running now at the home's store on the products it chose for a typed name or has on its list, sends one batched notification a day per space at most ("פסטה פנה ברילה · 2 for ₪10" · "at Shufersal · and 2 more of your usual"), owner + members, never viewers, the usual push rules (quiet at night), each promotion told once (60 days); a tap opens the Supermarket; the same deals show as a line in "Nexus suggests". New kind `deal` (TypeScript enum only — no DB change). `test:notify` case green.
- F2 — docs: `SPEC.md` "Round 19" section; `docs/MAP.md` new **Prices** area (tables, jobs, libs, reads / actions, screens, tests) + the chat's `lib/chat-inline.ts`; help topic `10-prices.md` (prices + deals, choosing a product, comparing stores, the store directory) + the swipe / product page lines in `09-supermarket.md` (`test:help` green); `docs/ENVIRONMENT.md` section "Prices" (workflow, secrets, minutes, scraper pin, blocked chains + the local runner) + log line; For Tal: the phone checklist + the secrets / runner / logo steps.
- F1 — guards: unit `test:prices / catalog / match / deals / compare / estimate / chat-inline` in CI (`guards.yml`), `test:pictures / notify / admin-access / adblock` extended, a smoke step per item; full smoke on the final code green on both — phone 163 PASS, desktop 126 PASS, ALL PASSED; `scripts/parity-r18.mjs r19` wrote the 7 R19 boards' parity shots (`docs/design/parity-r18/r19-*.png`); rehearsal on a fresh prod snapshot OK; CI (`guards`) green on the final code commit c526b00.
- Merged: round19 fast-forwarded to main (737cb01) after every item ticked, guards green on the final code commit and the rehearsal OK; guards on main green, prod smoke ALL PASSED (run 39424229777).
### Decisions
- A2: the computer sidebar's active row already has a tint + a 3 px accent bar + 600 ink (R14 B1) — it reads clearly, left as is. The dock pill measures the icon from the pill's own parent (a parent's ref isn't attached yet in a child's layout effect).
- A3: the Home menu only replaces the "+" on Home — Products / Insights keep the R16 add list (its barcode / receipt / plan / import flows and their tests stay). "Search a product" opens the Supermarket add screen; D5 turns its search into the catalog.
- A4: the fold runs on the row wrapper with the Web Animations API (height + opacity, fill forwards) instead of the old 200 ms height class — opacity reaches 0 at 40 % so the red underlay never shows across the whole row.
- A5: "the product page" is the row's item sheet until D2 turns it into the product page (`openSmItem` stays the one entry point, so A5's smoke keeps holding).
- A6 cause: after any tab switch the view wrapper keeps its entrance animation (`view-in view-fwd`, fill `both`) in effect, which makes it the containing block of `position: fixed` children — the "floating" bar sat at the list's foot (≈ 2 400 px down) instead of above the dock; a cold load has no entrance animation, hence "sometimes". Second, smaller cause: the IntersectionObserver only reports crossings, so a tab opened at the previous tab's scroll could stay "docked" out of sight. Fix: portal while floating + geometry reads.
- A7: the ≈ 320 ms in the brief and "no frame > 24 px" can't both hold for a tall section (380 px in 320 ms peaks at 34 px a frame even on ease-in-out), so the duration follows the height: 320 ms up to ~250 px, then 1.3 ms per px, capped at 520 ms.
- A8 — Tal's report r_mvWUA_ddri: the bold regex took the whole bold sentence, so its two [[id]] refs stayed raw, and because it had a digit (43") it was drawn as one grey number chip — the "[Electra [[h5pPbrt7puRe" Tal saw. The opening jump: `ask-fab` removed `data-ask-from` after 700 ms, which swapped the open sheet's animation from the circle reveal to the default slide-up mid-way — the sheet jumped down and slid up again; the marker now stays until the chat closes. Found by the A8 frame trace (red before the fix).
- B1 — branches per chain from today's Stores files (this PC, 2026-10-20): Shufersal 417 · Yellow 242 · AM:PM / Dor Alon 158 · Carrefour 147 · Rami Levy 99 · Good Pharm 82 · City Market 72 · Super Sapir 70 · Tiv Taam 54 · Yochananof 51 · King Store 48 · Freshmarket 46 · Maayan 2000 38 · Zol VeBegadol 35 · Wolt Market 34 · City Market Kiryat Gat 28 · Keshet Teamim 28 · Shuk HaIr 26 · Super Yuda 26 · Osher Ad 24 · Shefa Birkat HaShem 22 · Bareket 15 · Hatzi Hinam 13 · Salach Dabach 12 · Stop Market 11 · Polizer 8 · Mishnat Yosef 4 (+1 online) — 1,850 branches, 2,272 rows on the first load (21 s). Victory, Mahsanei HaShuk, H. Cohen: the pinned scraper (1.0.15) returns no scraper for them (disabled upstream) — no branches yet (For Tal).
- B1 — the city: most chains give a CBS locality code (3000 = Jerusalem); the code table is data.gov.il resource 5c78e9fa (1,316 localities, he + en), stored as `src/lib/prices/cities.json`. Chains without codes (Yohananof, Polizer, Salach Dabach, Keshet …) get the longest locality name found in the store's name / address; ~180 of 1,850 branches still have no city (they show their address).
- B0 — probe 2026-10-20 (files listed · branches · works from): Shufersal 1,120+ · 428 · PC + Actions (its listing is slow: 47–300 s) · Rami Levy 1,702 · 100 · both · Yellow 523 · 244 · both · AM:PM 317 · 158 · both · Carrefour 366 · 147 · both · Super Sapir 999 · 97 · both · Good Pharm 1,000 · 83 · both · Tiv Taam 110 · 55 · both · Yochananof 120 · 49 · both · King Store 1,000 · 49 · both · Freshmarket 156 · 47 · both · Maayan 2000 1,000 · 39 · both · Zol VeBegadol 1,000 · 36 · both · Wolt 690 · 35 · both · City Market 82 · 29 · both · City Market KG 985 · 32 · both · Keshet 98 · 30 · both · Super Yuda 377 · 28 · both · Shuk HaIr 1,000 · 27 · both · Shefa BH 1,000 · 23 · both · Bareket 1,000 · 16 · both · Stop Market 37 · 11 · both · Polizer 30 · 9 · both · Salach Dabach 13 · 7 · both · Mishnat Yosef 1,000 + 277 · 5 · both · Osher Ad 6 (Stores only listed; its price files come through the download) · both. **PC only (Actions sees no files — blocked outside Israel): Hatzi Hinam, Netiv HaHesed, Super-Pharm.** **Neither (the pinned scraper disables them): Victory, Mahsanei HaShuk, H. Cohen.**
- B0 — what each chain publishes: Stores daily (~02:00–06:00), PriceFull + PromoFull nightly per store (00:00–05:00), Price + Promo partial files during the day (Shufersal hourly; Rami Levy, King Store, Yochananof, Shuk HaIr, Zol VeBegadol, Super Sapir, Maayan 2000 several times a day; Carrefour, AM:PM, Freshmarket, Yellow, Polizer, Salach Dabach only the nightly full files).
- B0 — schedule + minutes: nightly 05:40 Israel (fetch ~12 min for 777 files / 4.9 GB measured on this PC, ingest 5.6 min locally → ~25 min on Actions with a remote DB), intraday every 3 h 08:10–23:10 (6 runs × ~5 min). ≈ 55 min/day ≈ 1,650 min/month — inside GitHub Free's 2,000 private-repo minutes (public now: unlimited). If it gets close after going private: intraday every 4 h (−300 min).
- B2 — real run from this PC, 2026-10-20 ~03:00: 29 chains, 777 files (4.9 GB) downloaded in 696 s; ingest 326 s into a scratch SQLite: 427,319 chain prices (+ as many price_day points), 290,834 branch prices (28 representative branches), 52,041 live deals with 237,791 deal items, 196,035 catalog products — a 223 MB SQLite file (products per chain: Rami Levy 26,200 · Tiv Taam 23,648 · Polizer 23,068 · Keshet 22,359 · Stop Market 22,277 · Freshmarket 19,680 · Salach Dabach 17,747 · Hatzi Hinam 16,754 · Yochananof 13,098 · Carrefour 11,030 · Shufersal 10,826 (4 stores) …) — 1,636,705 row writes for the first load; a second read of the same files writes 1 row.
- B2 — sizes vs the free plans: Turso free = 5 GB / 500 M rows read / 10 M rows written a month. First load 1.64 M writes (once); after it only changes: price changes run ~1–3 % a day → ~20–50 k writes per nightly run + intraday partial updates for the representatives / chosen branches (~5 k a run) → ~1.5–2.5 M writes a month. Storage ≈ 1.6 M rows ≈ 225 MB (measured). So **every branch of every chain does not fit** (Shufersal alone: 428 stores × ~10 k = 4 M rows): per the brief, a branch's own prices are kept for the branches the homes chose + one representative per chain (most items read), and every other branch uses its chain's price. The fetch still downloads all stores of chains whose scraper ignores the store filter (Cerberus: Rami Levy, Freshmarket …) — bandwidth only, nothing extra written.
- B2 — 'current': `branch.prices_at` is the newest file read for that branch; the app shows "updated · HH:MM" from it, never "morning prices", and keeps "verify at the till".
- A10 — logos: from each chain's own site (`scripts/prices/logos.mjs`, sources + dates in `public/chains/sources.json`, 2026-10-20): 13 by script (Shufersal, Yochananof, Osher Ad, Tiv Taam, AM:PM, Freshmarket, Stop Market, Mishnat Yosef ×2, Yellow, Wolt, Super-Pharm), 9 behind Cloudflare read once in the in-app browser and taken from the sites' own CDN (Rami Levy, Victory, Carrefour, Keshet Teamim, Mahsanei HaShuk, Super Sapir, Hatzi Hinam, Super Yuda, Shuk HaIr) — 21 of 33. Rami Levy's app icon is a generic "online" hand, so its header wordmark is used. Chains without a logo show a plain store tile in the chain's colour (never a first letter).
- A10 — near me: the Stores files carry no coordinates and geocoding isn't built yet, so "near me" asks for the location but can't sort by distance yet (the km column shows when a branch has lat / lng). Next step: a nightly Nominatim pass for branches without coordinates (≤ 1 request / s, cached in `branch.lat/lng`).
- B3 — today's real catalog (29 chains read): 196,035 products — 184,552 real barcodes, 11,483 store codes (weighed produce / deli, per chain), 15,449 weighted; 45,103 sold in ≥ 2 chains, 16,872 in ≥ 5. The dictionary places 108,245 in a section; 87,790 stay unsectioned at ingest (no AI there: the batched AI classification of 88 k names would cost ~900 calls) — a product gets its section the first time a list row matches it (C1, `classify-server.ts`) or a search shows it.
- C1 — the toast and the sheet only follow the Add screen's adds; barcode / camera adds map exactly (the gtin) and stay quiet. AI is never used to match (the brief allows it only where rules can't decide — C2 asks the person instead).
- C3 — shares (rules only, no AI): the seeded demo list 21 of 24 rows mapped silently (88 %), 3 ask (Penne — Barilla or Osem; Hummus; Yogurt), 0 with nothing in the catalog. A copy of prod (snapshot 2026-10-19 + today's real catalog, 196 k products): 1 of 12 open rows silently (מלח הימלאיה 1 ק"ג — one exact product), 11 ask once (חלב, לחם, ביצים, קוטג׳, גבינה צהובה … — the real catalog has 5–40 of each and the home has no brand history yet), 0 with nothing. After Tal picks once per name they stay mapped. Stores: 2 of 4 matched a real branch (Rami Levy באר שבע → store 27; Shufersal המחקר → BE Cinema City Netanya, store 621); Rami Levy סינמה סיטי and Rami Levy נתניה ask once in the picker.
- D1 — "worth taking N" only when filling the bundle costs at most one more unit than what's on the list now (2 at ₪6 + "3 for ₪15" → take 3; 1 at ₪6 → just the deal line). Club deals are counted in the estimate (most homes have the card); E1 / a setting can turn that off later. Deal rows are 76 px tall (the board's `.lrow.tall`).
- B4 — coverage on Tal's prod list (copy of the 2026-10-19 snapshot + today's catalog, real Open Food Facts / Serper / Gemini, no upload): 32 of 32 products shown for the 12 open rows have a real photo (100 %) — 14 from Open Food Facts by barcode, 18 by search + AI check, 47 s. The demo list runs with mock AI (illustration-like mock pictures), so it isn't a coverage number.
- B4 — sizes: thumbnails measure 5–12 KB (cap 20 KB). Vercel Blob Hobby = 1 GB stored / 10 GB transfer a month: at the cap (60 / day) that's ~1,800 pictures ≈ 15 MB a month; the whole 196 k catalog would be ~2 GB, so pictures stay lazy (only what people see) and the nightly batch takes the most-bought. Serper: ~55 % of products need a search after Open Food Facts → ≈ 35–45 searches a day at the cap (~1,300 a month); the free credit is 2,500 — if it runs out the search step just returns nothing (Open Food Facts + own photos still work).
- D3 — "near me" with a radius isn't offered yet: the branches have no coordinates (A10 Decisions); the screen ranks all chains and says so. The units a row buys are one shared rule (`lib/prices/units.ts`) for the rows, the basket, compare and the estimates — the first compare counted "6 bananas" as 6 kg (₪505 vs the basket's ₪429); now they agree to the agora (smoke checks it). Split is "worth it" from ₪25.
- D4 — the A10 / D4 smoke taps the store chip until the picker opens: on a cold page a tap before hydration does nothing (the Supermarket bundle grew this round). Worth a look in a later round: a server-rendered `<button>` that hydrates late swallows the first tap.
- D5 — speed: catalog search for 3 letters over the real 196 k-product catalog (local SQLite copy): p50 12 ms, p95 38.8 ms, max 40 ms (`scripts/prices/search-bench.ts`). The first version took p95 517 ms — the deals count joined promo_item → promo and SQLite walked the chain's thousands of deals; now two key lookups (barcodes → promo ids → those promos), the same fix in the list prices and compare. On Turso each search is ~5 queries, so expect + 5 × the round trip (~20–30 ms from Vercel dub1) ≈ 140–190 ms p95 — measure on prod after the first nightly load; if it's over 150 ms, fold the price + deals reads into one query.
- A5 regression found by D5: A5's full-row hit layer used the class name `.gro-hit`, which already named the add screen's result rows, the camera's choices and the paste review rows — those collapsed into a corner (absolute, z −1). Renamed to `.gro-tap`; the add-screen / capture / paste steps are green again.
- D6 — Spending's month view counts finished trips (what was paid), not the open list, so nothing there changes; templates' "about ₪N" stays on the last prices (a template isn't at a store yet).
- Rehearsal (`scripts/r19-rehearsal.mjs`, on a copy of `snapshots/prod-2026-10-20-r19.db`, base = origin/main): additive only, the 4 new columns + 11 new tables exactly (the FTS5 shadow tables `catalog_fts_*` aside), row counts equal in every existing table, integrity ok, second run a no-op, the app's numbers unchanged; migration 579 ms on 109 items. Data step (demo price files + C3 mapping of the home's rows): no rows added to existing tables, integrity ok, 12 open rows → 6 mapped silently / 3 ask / 3 not in the catalog (demo catalog), 3.4 s.
- F1 — smoke order: the full phone run failed steps that pass alone. Causes, each fixed: (1) Start shopping docked under the top bar when a short list had tall suggestions below (a real bug — now docked only below the top bar); (2) after A10 picks a priced branch, typed "Swipe test rice" is matched silently to a real rice (as C1 says), so the swipe test uses titles of no grocery type; (3) the brands step left "Tnuva milk 3% 1L" when a click failed and "Milk 3%" matched it case-insensitively — cleanup in `finally`, exact-title locator; (4) the smoke's own DB writes hit SQLITE_BUSY while the server mapped rows in `after()` — `busy_timeout`; (5) a full swipe from the row's centre ended off-screen at 390 px — now from the far edge past the A4 point; (6) A7's stagger needs 2+ suggestion rows (one is left late in the run).
- F1 — prod smoke after the merge (8ffd296): guards on main green; prod smoke failed twice on "floating Ask … open/close keeps scroll" (scrollY moved, nothing else). On real data the Supermarket list still changes after the first open (R19 maps rows in `after()`), and scroll anchoring moves scrollY while the content stays — the step now checks that what is on screen stays put (the element under the screen's middle, ±2 px), scrollY only as a fallback. The second run also had one "viewport guard" miss (passed in the first run, untouched by R19).
### For Tal
- **Prices — secrets (one time):** GitHub → repo Settings → Secrets and variables → Actions → add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (the prod DB, a read-write token: `turso db tokens create <db>`). Until then the `prices` workflow runs dry (it says so) and the app shows no prices.
- **Prices — the 3 chains GitHub can't reach** (Hatzi Hinam, Netiv HaHesed, Super-Pharm): on the PC add `PRICES_TURSO_DATABASE_URL` + `PRICES_TURSO_AUTH_TOKEN` (same values) to `nexus/.env.local`, then once in a terminal: `schtasks /Create /TN "Nexus prices" /SC HOURLY /MO 3 /ST 05:50 /TR "\"C:\Users\talja\OneDrive\שולחן העבודה\Project Nexus\nexus\scripts\prices\prices-local.cmd\"" /F` (needs Python 3.12, already installed). Decide later: keep the PC, or a small Israeli server running the same script.
- **Prices — Victory, Mahsanei HaShuk, H. Cohen** are disabled in the pinned scraper (1.0.15). Newer releases (1.0.16+, Oct 2026) may bring them back; bump `scripts/prices/requirements.txt` once a release is 14 days old and the probe (`gh workflow run prices -f mode=probe`) shows them.
- **Logos still missing (12 chains — no website a script or the browser could find, or Facebook-only):** King Store, Netiv HaHesed, Zol VeBegadol, City Market, City Market Kiryat Gat, Maayan 2000, Shefa Birkat HaShem, Bareket, Polizer, Salach Dabach, H. Cohen, Good Pharm. Save each official logo as `nexus/public/chains/<id>.png` (ids in `src/lib/grocery/chains.ts`) and run `node scripts/prices/logos.mjs` — or send the site addresses and the script picks them up (`SITES` in that file).
- **Phone checklist (after the merge, on the phone):** A1 the Ask button is smaller (48 px) · A2 the active tab has a
  grey pill behind its icon that slides when you switch · A3 Home "+" = Barcode · Product photo · Receipt + Paste a link
  + Search a product · A4 swipe a row: grey Delete first, red only past half the row, release → it folds softly; a quick
  flick doesn't delete · A5 tap the empty part / the brand line of a row → the product · A6 Start shopping is there
  after switching tabs and while scrolling · A7 "Nexus suggests" opens smoothly · A8 the chat opens without a jump and
  an answer with item links in bold renders right · A9 New chat slides; close + reopen → the empty new chat · A10 the
  store picker: every chain with logos, search a street / city, your old stores marked "Choose the exact branch".
  Prices (once the secrets are in and the first nightly run happened): rows show prices + deal lines, the basket card
  says "updated · HH:MM"; a product page; "Which one?" when you add "חלב"; Compare stores; search "פסט" in the add bar
  shows products with photos.
