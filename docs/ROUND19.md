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
  line in "### Progress" in the same commit; decisions in "
- A2 — dock: one 56×30 pill behind the active icon (ink 11 % / Plum brand 16 %) sliding between tabs on the drawer ease (260 ms, no slide with reduced motion), stroke 2.2, label 750; smoke checks the pill on every tab × light/dark × Graphite/Plum, label ≥ 4.5:1, and the slide.
- A3 — Home "+" = Scan (Barcode · Product photo · Receipt → the Supermarket camera in scan / photo / photo + tall frame; new intent `receipt`) + "Paste a product link" + "Search a product" (the Supermarket add screen); other tabs keep the add list; smoke opens each tile in its mode, 5 entries, no duplicates.
- A4 — swipe-delete v2: grey Delete at 96 px, delete point = 55 % of the row (clamped 170–260; 201 px at 390, 185 at 360), red + spring icon + "Release to delete" + one vibrate(8) only past it, flings never commit short of it; the exit slides while the row fades first and folds its height (360 ms ease-out, WAAPI); quantity side calm grey too. Smoke at 360 + 390: 150 px → open, 230 px → deleted, Undo back; fold trace 55 frames, 60 px moved, worst frame 7.1 px.
- A5 — the whole row opens the product: a hit layer under the content (z −1 in the row's stacking context), the name area lets taps through except the name's own letters; smoke taps picture / brand line / empty middle / chip gap / end edge at 360 + 390 → the product every time, the name still renames.
- A6 — Start shopping always floats: the floating bar is portaled to document.body and "docked" is read from the slot's box on every scroll / resize / layout change; new smoke opens the tab from every tab + Products segment (each scrolled to its end) and checks top / middle / bottom / back up — red on the old build (bar at top 2375 px), green now.
- A7 — "Nexus suggests" opens as one soft push: grid-rows on ease-in-out (.42,0,.58,1) for max(320 ms, 1.3 ms per px, ≤ 520), rows rise in 30 ms apart (fade with reduced motion); frame trace: 249 px opened over 19 moving frames, worst frame 21.9 px, the list above moved 0 px. (Also A6 follow-up: when open suggestions carry the slot above the screen the bar floats again — the A6 smoke caught the docked bar cut at the top.)
- A8 — chat: answers' markup through `lib/chat-inline.ts` (refs + amounts inside bold, a bold run is a chip only when it's a short figure, half-written refs held back while streaming; `test:chat-inline` has Tal's report verbatim); the answer's block exists from the question on (thinking → text in place), the list is placed at its end before paint and then glides ≤ 28 px a frame only while the person is at the end, messages rise + fade in; the phone reveal no longer re-slides ~700 ms in. Frame trace (phone + desktop): opened at the end, composer still from the first rest frame, one answer block, worst glide 10 px.
- A9 — New chat: the thread fades + lifts away (140 ms, its composer disabled), the empty chat rises in (220 ms; fades with reduced motion); New chat marks the empty chat as the newest (`nexus.askNewestEmpty`, this device) so reopening — also after a reload — opens it empty until its first exchange is saved. Smoke (phone + desktop): messages → New chat (out → in) → close → open: empty; reload: empty; one exchange → reopens with it.
### Decisions" at once; anything for Tal in "
- A2: the computer sidebar's active row already has a tint + a 3 px accent bar + 600 ink (R14 B1) — it reads clearly, left as is. The dock pill measures the icon from the pill's own parent (a parent's ref isn't attached yet in a child's layout effect).
- A3: the Home menu only replaces the "+" on Home — Products / Insights keep the R16 add list (its barcode / receipt / plan / import flows and their tests stay). "Search a product" opens the Supermarket add screen; D5 turns its search into the catalog.
- A4: the fold runs on the row wrapper with the Web Animations API (height + opacity, fill forwards) instead of the old 200 ms height class — opacity reaches 0 at 40 % so the red underlay never shows across the whole row.
- A5: "the product page" is the row's item sheet until D2 turns it into the product page (`openSmItem` stays the one entry point, so A5's smoke keeps holding).
- A6 cause: after any tab switch the view wrapper keeps its entrance animation (`view-in view-fwd`, fill `both`) in effect, which makes it the containing block of `position: fixed` children — the "floating" bar sat at the list's foot (≈ 2 400 px down) instead of above the dock; a cold load has no entrance animation, hence "sometimes". Second, smaller cause: the IntersectionObserver only reports crossings, so a tab opened at the previous tab's scroll could stay "docked" out of sight. Fix: portal while floating + geometry reads.
- A7: the ≈ 320 ms in the brief and "no frame > 24 px" can't both hold for a tall section (380 px in 320 ms peaks at 34 px a frame even on ease-in-out), so the duration follows the height: 320 ms up to ~250 px, then 1.3 ms per px, capped at 520 ms.
- A8 — Tal's report r_mvWUA_ddri: the bold regex took the whole bold sentence, so its two [[id]] refs stayed raw, and because it had a digit (43") it was drawn as one grey number chip — the "[Electra [[h5pPbrt7puRe" Tal saw. The opening jump: `ask-fab` removed `data-ask-from` after 700 ms, which swapped the open sheet's animation from the circle reveal to the default slide-up mid-way — the sheet jumped down and slid up again; the marker now stays until the chat closes. Found by the A8 frame trace (red before the fix).
### For Tal".
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
### A10 [ ] Real store directory instead of free text
Store choice lists every food chain in Israel with its **real logo** (no first-letter tiles) and real branches with
exact addresses, from the chains' Stores files (B2); no free-text stores. Board `Stores-phone`: search by chain /
city / street, "near me" (geolocation, asked only on tap), chain grid (8 + "more"), branches with distance + the list's
estimate there (D4). Existing `space_store` rows map to a branch (best match; unmatched stay and ask once). Logos: the
chain's official logo image, stored in `public/chains/` (source + date in Decisions). Areas: Supermarket
(`store-picker.tsx`, `lib/grocery/chains.ts`), onboarding stores step. **Acceptance:** every chain in the transparency
list has a logo file; picker search finds a branch by street; old spaces keep their store.

## Part B — price data (Map area: Supermarket + new "Prices" area)
### B0 [ ] Where the jobs run (probe first)
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
### B1 [ ] Chains + branches directory
Tables (additive): `chain` (id, names he/en, gov chain id, logo), `branch` (chain, store id, name, address, city,
lat/lng when known — geocode once and cache if the file has none, never on the client). From the Stores files, refreshed
daily. **Acceptance:** `test:prices` parses a fixture Stores file of 3 formats; counts per chain in Decisions.
### B2 [ ] Current prices and deals (intraday, not "morning prices")
Tal: prices must be current. Ingest the nightly full files **and** the partial price / promo files the chains publish
during the day, as often as each chain publishes (B0 numbers). Store the price per product per branch, writing only
changes; keep a daily history point per product per chain (for the 90-day chart). Deals from Promo files: X for Y,
% off, club-only, minimum basket, valid-to date; mark club deals. The app shows "updated · HH:MM" = the time of the
newest file read for that branch — never "morning prices"; "verify at the till" stays. Size: measure rows / reads /
writes per day against the Turso free plan and Vercel limits; if all branches of all chains don't fit, keep every
branch of the chains + cities the users chose and one representative branch per other chain — numbers in Decisions.
**Acceptance:** unit tests on fixture files (full + partial + promo, weighted items, 3 portal formats); a dry run
on today's real files from this PC with counts and timing in Decisions.
### B3 [ ] The product catalog
Every barcode in the price files becomes a catalog product: gtin, name, brand (manufacturer), size + unit, weighted
or not, section (classify with the existing dictionary / `classify-server.ts`, batched), short display name
(`lib/short-name.ts` rules). Names cleaned (chains differ: pick the most common clean form). **Acceptance:**
`test:catalog` (name cleanup, merge across chains by gtin, weighted produce codes that aren't real barcodes).
### B4 [ ] Real pictures for every product
Tal's must-have. For each catalog product: barcode → Open Food Facts → own photos (household scans) → Serper image
search by barcode + name, checked by a small AI yes/no ("is this the product?", batched, counts in the system's AI
budget, not a user's) → resized thumbnail (≤ 20 KB webp) in Blob; illustration only when nothing passes. Fetch lazily
(the first time a product is shown / searched) + a nightly batch for the most-bought products; daily caps on Serper
and AI calls; storage numbers in Decisions (Blob free limits). Area: Products (`lib/product-pictures.ts`,
`picture-*.ts`). **Acceptance:** coverage report in Decisions (% of products seen in the demo + Tal's prod list with
a real photo); `test:pictures` extended.
### B5 [ ] Freshness, health, admin
Admin → System: last file per chain, rows changed today, failures (a chain whose files stopped, a format change),
coverage of pictures. A chain silent for > 26 h shows "prices may be old" in the app for that chain. **Acceptance:**
`test:admin-access` covers the new admin view; a stale-chain fixture shows the warning.

## Part C — every item is a real product (board `Match-phone`)
### C1 [ ] Matching + learning
A supermarket item maps to a catalog product: barcode adds map exactly; typed names map by the household's learned
brand (`brand_buy`, S3 C6) + size + the catalog ranking; if confident → mapped silently (toast "as always · ₪6.80 ·
Change"); if not → C2 asks once. "Doesn't matter which" = a product-type item priced as the cheapest match in the
chosen store. The choice is remembered per household per typed name (forgettable in "What Nexus learned").
**Acceptance:** `test:match` (exact gtin, learned brand, ambiguous → ask, "any" → cheapest, forget).
### C2 [ ] "Which one?" sheet
Board `Match-phone`: candidates with photo, size, price at the store, deal, why ("you bought it 5 times"), search in
the catalog, "doesn't matter which", "remember" (on). Opens when adding an ambiguous item and from a row without a
price ("choose a product"). **Acceptance:** smoke: add "חלב" → sheet → pick → row shows the product + price.
### C3 [ ] Existing lists get mapped
Nightly + on first open after the update: map existing supermarket items with the C1 rules (batched AI only where
rules can't decide; system budget); unmapped rows show "choose a product". Never changes what the user typed.
**Acceptance:** on the seeded demo + a copy of prod, the share mapped in Decisions.

## Part D — the screens
### D1 [ ] Prices and deals in the list (board `Main`)
Each row: price for the count at the chosen branch + unit price (₪/kg, ₪/unit), an old price struck through when a
deal applies, and a deal line under the name that fits the list: "3 for ₪15 · you have 3 ✓", "4 for ₪12 · worth
taking 4" (tap → set the count), club deals in their own colour. Section band shows its subtotal. Basket card on top:
estimate, "updated · HH:MM", and "at <branch> the list is ₪N cheaper" → D3. Rows without a product: "choose a
product" → C2. **Acceptance:** `test:deals` (deal maths: X for Y with counts below / at / above X, % off, club,
weighted); smoke on the row and the basket card.
### D2 [ ] Product page (boards `Product-phone`, `Product-desktop`)
Real photo, name, brand, size, barcode, tags, ₪ per 100 g; price at my store + deal tip with "verify at the till";
the same product at nearby branches of every chain (bar per price, cheapest marked, mine highlighted) + "all chains";
90-day history with deal points; "same type, cheaper" (by unit price); "what Nexus learned" switch; count stepper +
"in the list". Opened from the row (A5), search (D5), compare (D3). Computer: two columns per the board.
**Acceptance:** smoke phone + desktop; layout guards at 360 px with the worst-case name.
### D3 [ ] Where is my list cheapest (board `Compare-phone`)
Ranks branches by the list's total incl. deals: near me (radius chip) | all chains (+ online with delivery when the
chain publishes it), club on / off; per branch: total, saving vs mine, items found "8 of 9" + missing items as a
line with a substitute, deals count; "shop there this time" sets the trip's store; split hint when two stores save
more than ₪N (say if it's probably not worth the trip). Missing items count at the average price. **Acceptance:**
`test:compare` (totals with deals, missing items, ordering); smoke.
### D4 [ ] Store picker shows the estimate (board `Stores-phone`) — with A10.
### D5 [ ] Catalog search with pictures
Typing in the add bar searches the catalog: photo, name, brand + size, price at my store; household products and
learned brands first, then popularity; the typed letters bold, "did you mean" kept; an Enter on free text still adds
as today (then C1). Also "Search a product" from A3. Fast: results ≤ 150 ms p95 on the server for 3 letters (index;
number in Decisions). Area: Supermarket (`lib/grocery/search.ts`, `/api/grocery/search`). **Acceptance:** bench +
smoke (type "פסט" → Barilla penne with photo → add).
### D6 [ ] Real prices everywhere they're estimated
Start-trip estimate, store mode total, trip finish vs budget, Home "Next shop" / Budget pace, Spending's supermarket
forecast use the catalog prices when mapped (fallback as today). **Acceptance:** unit on the estimate function.

## Part E — deals that matter (optional if time is short)
### E1 [ ] "Your usual product is on a deal"
When a product the home buys regularly gets a deal at its store: one batched notification per day at most ("Barilla
penne 2 for ₪10 at Shufersal Deal"), following the existing push rules (night quiet, owner + members, never viewers),
and a line in "Nexus suggests". **Acceptance:** `test:notify` case.

## Part F — guards and docs
### F1 [ ] Guards
Smoke steps per item (phone + desktop). Unit: `test:prices`, `test:catalog`, `test:match`, `test:deals`,
`test:compare`, extended `test:pictures` — all in CI. `test:adblock` covers the new deal / price class names.
`scripts/parity-r18.mjs` (or a new `parity-r19`) gets the R19 boards. Full phone + desktop smoke pass.
### F2 [ ] Docs
`SPEC.md` R19 section, `docs/MAP.md` — a new **Prices** area (jobs, tables, catalog, pictures, admin) + touched areas
in place, help topics (prices + deals, choosing a product, comparing stores, the store directory),
`docs/ENVIRONMENT.md` (the prices workflow, secrets, the local runner, schedule + minutes) + log line. "### For Tal" =
a phone checklist (A1–A10 + list prices, a product page, "which one?", compare, store picker, search with photos)
and the secrets / runner steps he must do.

## Open
### Progress
- A1 — Ask 48 px phone / 52 px computer, stars 28 / 30 px with the optical shift scaled; S5 pixel test green at the new sizes (light/dark × Graphite/Plum, phone + desktop).
### Decisions
### For Tal
