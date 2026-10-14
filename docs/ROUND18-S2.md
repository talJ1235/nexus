# Round 18 — Session 2: the supermarket screens

Source: Tal (2026-10-10 → 10-13) via the planning chat. Source of truth: this file + boards `docs/design/r18/`
(part 1: `Supermarket-phone`/`Main`, `StoreMode-phone`, `Add-phone`, `Finish-phone`, `HomeCard-phone`, `Nav-phone`;
part 2: `ItemSheet-phone`, `Capture-phone`, `Store-phone`, `Lists-phone`, `TripBar-phone`, `Push-phone`,
`Settings-phone`, `Supermarket-desktop`, `Settings-desktop`, css `nx-sm.css` + `nx-sm2.css`) — interactive, use their
Tweaks. Screens script `docs/R18-SCREENS.md`; **where it differs, the decisions of 2026-10-13 in `docs/PLANNER.md`
("Supermarket simplified", "Templates made by Nexus", "Count + weight", "No knobs", "My answers dropped", "Galaxy Watch
app") win.** S1 (data + engines) is merged; its results are in `docs/ROUND18.md` "## Open" → "### Session 1".
Results of this session go to **"## Open" at the end of this file**.

## How to run (Session 2) — progress must never be lost
Tal's usage is short. Work so that a session can stop at any moment and the next one continues with nothing lost:
- Branch **`round18-s2`** from `main`. **Commit and push after every single item** (not per part): `R18.<part><k>: …`,
  then `git push origin round18-s2`. Never keep more than one item of work uncommitted.
- After each item: tick it here (`[x]`) **and** append one line to "## Open" → "### Progress" (`A3 done — <one line>`),
  in the same commit. Decisions go to "- E1 done — routines `lib/grocery/routines.ts` (≥ 3 look-alike trips on one weekday, Jaccard ≥ 0.4; items bought in ≥ half of them, ≥ 4; hidden never), `refreshRoutines` after every finished trip (new → an offer; known → items + trip count follow until `edited_at`; turned down never again), `hideProduct` strips un-edited Nexus templates; apply = merge (`templatePlan` / `applyTemplate`: new / already on it — stays / hidden skipped, `used_at`). Additive `template` columns made_by, routine_day, routine_trips, kept_at, dismissed_at, edited_at, updated_at, used_at (rehearsal list extended). Screen `supermarket/lists.tsx` (⋯ → Templates & past trips): offer card (also on the tab), cards with Made by Nexus / Yours · used in May, the template page + Nexus note, apply sheet. `test:templates` (new, in CI with `test:trip-api`), seed (kept routine, offer, Barbecue), smoke step, parity e1-templates.png. Also fixed CI: `test:help` failed since D1 (SPEC's trip-API bullets read as features: Ops / Client / Server → italics); `test:roles` lists D4's two view actions.
- E2 done — Templates screen gets the Templates · Past trips segment: edit (rename, remove, add by name — classified on the server; saving makes it the user's, a Nexus one stops following trips), delete; past trips by month (total · n trips; date, store, items · who · minutes, receipt mark, total) → a trip (total / items / not found, receipt, every product picked except not found + already listed → Add N again = merge) → Save as template sheet (name, what was bought, also what wasn't found, keep the quantities); Save the current list (row + empty state). Data `pastTrips` / `editTemplate` / `templateFromTrip` options / `templateFromList` / `addMissing`; actions `editSupermarketTemplate`, `saveListAsTemplate`, `supermarketPastTrips`, `readdToSupermarket`. `test:templates` +E2, smoke step, parity e2-past-edit.png.
- F1 done — Settings → Space → Supermarket (`settings/supermarket.tsx`; deep links /settings/supermarket, /settings/smHidden, /settings/smLearned): main store (+ also shop at; Change = the store picker), section order (rail + Edit = the order screen), products you hid (Suggest again), What Nexus learned — phone rows, desktop label + control columns; nothing else. What Nexus learned: Your home (household, budget — "you told us", ✎ → People / Budget), When and where (usual day, main store told ✎ → picker, "sometimes" chains), Regular products (+ N more), Habits (before Shabbat; with X for non-steady ones), ✕ forgets one fact, Forget everything (learning only: also the learned orders waiting and unanswered Nexus offers; lists / trips / receipts stay). Engine: `pref:sm:forget` cut-offs read by `learningOf` (history, suggestions, item sheet, routines); `learnedFacts`, `forgetFact`, `contextsOf`. Admin System → Supermarket: counts only (Nexus templates kept, products hidden, homes that used Forget). Tab ⋯ → What Nexus learned. `test:staples` +F1, smoke step, parity f1-settings-phone / -desktop.
- F2 done — onboarding step 2 goes on to "Where do you usually shop?" (supermarket chains, multi; the first = Main badge; chains picked among the stores start the list) → "Which Shufersal?" (city / street typed, no location; "I shop at several branches" = no branch, picked when a trip starts) → budget. Answers `chains` / `branch` / `several` in `pref:onboarding`; saved once with the step (`applyStores`: main chain + branch = the space's default store, the others "also shop at"; viewers change nothing). `test:onboarding` walks it (+ checks `space_store`), parity f2-onboarding-store.png.
- F3 done — on a computer the Supermarket tab is the board's page: list by sections on one side, a sticky side panel (store chip + estimate + aisle rail, the routine offer, Nexus suggests, Templates with Add = merge + Save this list, Past trips → Templates & past trips), the item drawer (C2's side sheet), "Send to phone" popover in the header (`supermarket/desk.tsx`: recipients = members, me + push-on members ticked by default; a viewer only themselves → D4's `sent` push that opens the list); `/` opens Add, Esc closes. Smoke step (desktop), parity f3-desktop.png. Also fixed CI's `test:polish` S3 / P7: since A3 the Home "Next shop" card pushes the suggestions carousel down — the checks now scroll it into view before touching it.
### Decisions" right away, not at the end.
- **Resuming:** at session start, `git fetch` and check out `round18-s2` if it exists; read "### Progress" + `git log`;
  continue from the first unticked item. Never redo a ticked item.
- Order = the order of the parts below (most valuable first). If a session ends mid-part, the next continues there.
- Unattended; never stop to ask. Read open reports and the error log first; don't touch power settings.
- **DB changes are additive only** (new nullable columns / tables). Merge `--ff-only` to `main` only when **all** parts
  are ticked, CI is green **and** the migration rehearsal on a copy of the prod snapshot passes (as in S1:
  `node --env-file=.env.local scripts/db-snapshot.mjs`, then the rehearsal script extended for S2). If the snapshot is
  refused, stop before merging and write the exact command for Tal in Open.
- Rules from S1 "How to run" still apply: i18n for every string (he + en), `useDevice()` / `phone:` / `desk:` (never a
  width check), phone test contexts with a mobile UA, no class/id matching ad-block lists (`test:adblock`; rename `ad-*`
  from board css), `SEARCH_OFF=1` for test servers.
- Visual items: phone 360/390 + desktop 1366, light + dark, Graphite + Plum, he + en, worst-case data. Parity PNGs
  (board vs app) into `docs/design/parity-r18/` with a `scripts/parity-r18.mjs` like `parity-r17.mjs`.
- Design bar: the project skills in `.claude/skills/` (emil-design-eng, apple-design, mobile-native, animate + RECIPES)
  — easing tokens, press feedback, gated hover, reduced motion, safe areas.

## Part 0
### 0.1 [x] Boards + pointers
Commit the new boards Tal put in `docs/design/r18/` (`R18.0`). If part-2 boards are missing, note it in Open and build
from this brief + part-1 boards. Add one line under `docs/ROUND18.md` header: "Session 2 → `docs/ROUND18-S2.md`", and
one line at the top of `docs/PLANNER.md` "Current state & handoff": "2026-10-13: S2 brief `docs/ROUND18-S2.md` written;
Tal runs it." (docs only, same commit).

## Part A — the Supermarket tab and the shell
### A1. [x] Navigation (P15, P18, `Nav-phone`)
Phone dock = Home · Products · + · **Supermarket** · Insights. Products (renamed Shopping) has segments To buy · On the
way · Projects. Long-press + → Add to list · Scan · Photo · Start shopping; app-icon shortcuts (manifest `shortcuts`).
Tab 4 is chosen **by itself**: Projects if onboarding said "projects" and the person uses Projects more than the
Supermarket in the last 30 days, else Supermarket — no setting. Desktop sidebar: "Supermarket" near the top with a count.
**Acceptance:** smoke: dock order, long-press menu, shortcuts in the manifest, tab-4 rule unit-tested.
### A2. [x] Supermarket tab (P2, `Main`)
As the board: store chip + estimate vs budget, add field with Scan/Photo/Voice/Recipe icons, "Nexus suggests" block,
sections in the branch's order with colours, rows / tiles (switch in the ⋯ menu, remembered per person — **not** in
Settings), first-time state, viewer, offline badge. Section colours always on (no switch). `/supermarket` stops
redirecting (S1 bridge `sm-bridge.tsx` is replaced). **Acceptance:** smoke on the seeded list; parity PNGs.
### A3. [x] Home "Next shop" card + trip bar (P1, P10, `HomeCard-phone`, `TripBar-phone`)
Card states as the board. Trip bar above the dock on every screen while a trip runs: mine (count, total, Back), someone
else's (watch, what you add shows for them), offline (changes waiting), everything checked (Finish).
**Acceptance:** smoke: bar visible on Products/Insights/Supermarket during a trip, gone after Finish.

## Part B — adding
### B1. [x] Count + weight (data + parser)
New nullable `count` on supermarket items (additive). An item holds a count, a weight (`amount` + `unit` kg/g) or both.
Parser (S1 `lib/grocery` parse): "6 עגבניות" → count 6; "קילו עגבניות" → 1 kg; "קילו עגבניות, בערך 6" → both. Unit
weight learned per product per home from receipts/trips (fallback table for common produce); shown as "≈ 0.9 ק״ג" when
only a count is set (and the reverse). Store mode and the list show both ("6 · ≈ 1 ק״ג").
**Acceptance:** `test:grocery` gains count/weight lines (he + en); rehearsal shows the new column, nothing else changed.
### B2. [x] Add screen (P3, `Add-phone`)
As the board + count/weight from B1 (the qty sheet has the two steppers side by side as `ItemSheet-phone`). Duplicate →
"Milk is already on the list — now ×3" with Undo. Paste/voice split preview.
### B3. [x] Scan + photo (P4, P5, `Capture-phone`)
Existing scanner. States: found (known to this home), already on the list (shows the merged count), unknown barcode
(name it once, section guess, barcode kept for the home), photo reading → matched to the home's product → not sure (3
choices) → daily AI limit reached (type / scan still work). Photo counts in the AI quota (feature `grocery`).
**Acceptance:** tests with a fixture barcode + AI mock for each state.

## Part C — the item sheet and the simplified learning
### C1. [x] Learning model (engine change; replaces S1 staple states)
- The user never sees staple states. Nexus **only suggests**; nothing is ever added to the list by itself (remove the S1
  `auto` behaviour). + accepts, × skips for this cycle; 3 skips in a row → suggest it at half the rate; 5 → stop until
  bought again.
- One explicit control: **"Don't suggest this again"** → new nullable `hidden_at` + `hidden_by` per product per space
  (additive). **Do not reuse S1 `staple`** (S1 stored `off` as the default for every row) — leave the column, stop
  reading it.
- Cold start: a basic Israeli household basket (~40 products, adapted to onboarding: household size, baby, pets)
  suggested until the home has ~3–4 trips; then the home's history takes over and basket items never bought fade out.
- Regular vs occasional: steady interval (low variance, ≥ 3 purchases) → suggested when due; otherwise only in context
  (Shabbat, holiday, "usually with X").
- Evening draft: **no setting.** Sent only when a usual shopping weekday is known (≥ 3 trips on the same weekday), there
  is something to suggest, the list isn't empty-and-unused; after 3 drafts in a row with no open → stop until the next
  trip. Only the global notifications switch applies.
**Acceptance:** `test:staples` rewritten for these rules (cold start, fade, skip decay, hidden never suggested, no auto
add, draft gate).
### C2. [x] Item sheet (P6, `ItemSheet-phone`)
Count + weight, note, photo of the exact product, section, "What Nexus learned" card (new / learning 2 of 3 / regular
with the purchase timeline and next date / occasional with its context chips / hidden with "Suggest it again"), "Don't
suggest this again", preferred brand + substitutes, pinned store, history (date, store, price, cheapest). Suggestion
action sheet: Add · Not this time · Never suggest this (with Undo toast). Viewer: read-only. Fix the phone smoke
failure "item sheet morph — nothing behind the sheet moves on open" (also on `main`, S1 Open).

## Part D — in the store
### D1. [x] One trip API (needed for the Galaxy Watch later)
Every store-mode action (start, check, uncheck, not found, substitute, quantity/price, add during trip, finish) goes
through one typed trip API on top of the S1 outbox (same per-field merge). No screen may write trip data another way.
Document it in `SPEC.md` (a later Wear OS app will call it). **Acceptance:** a unit test that walks a whole trip through
the API only; `test:shop-offline` still green.
### D2. [x] Store picker + section order (P7, P8, `Store-phone`)
"This trip only" vs "make it my default", search by chain/city/street (no location), recent branches. Section order per
branch: drag, learned suggestion banner (Use · Not now, moved sections marked), reset.
### D3. [x] Store mode + finish (P9, P11, `StoreMode-phone`, `Finish-phone`)
As the boards (S1 engines). Live adds during my trip appear in place with an in-app toast — no push while the app is in
front.
### D4. [x] Pushes (P16, `Push-phone`)
Evening draft push (text from data, opens the list), "Noa added …" during your trip (grouped), "sent from the computer"
(D1 desktop). Own inbox icons for `draft` and `trip_add` (S1 used the generic one).

## Part E — templates and past trips (P12, P13, `Lists-phone`)
### E1. [x] Templates made by Nexus
Detect repeating trips (items bought together + weekday, ≥ 3 occurrences) → offer "Nexus spotted a new routine — keep it
as a template?"; kept ones show "Made by Nexus" and are updated from new trips **until the user edits one** — then it is
theirs (flag) and Nexus never changes it. Hidden products never enter a Nexus template. Apply = merge, never duplicate,
the user's quantities win ("already on it — stays ×2").
### E2. [x] Template edit + past trips
Rename, remove/add items; past trips by month with totals, open → re-add selected / save as template.

## Part F — settings, onboarding, computer
### F1. [x] Settings → Supermarket (minimal) + "What Nexus learned" (P17, D3, `Settings-phone`, `Settings-desktop`)
Supermarket section has only: main store (+ "also shop at"), section order, products you hid (restore), link to "What
Nexus learned". Desktop layout = label column + control column (board). **No** draft switch, no colours switch, no
tab-4 setting, no "My answers". "What Nexus learned" (Settings, also from Supermarket): chips grouped Your home / When
and where / Regular products / Habits; onboarding answers marked "you told us" (✎ opens the place it is changed: store
chip, Space → Budget, People…), learned facts marked "learned" (✕ forgets: the engine drops that fact and relearns),
"Forget everything" (learning only; lists, trips, receipts stay). Counts only in admin, never content.
### F2. [x] Onboarding store step
New step: chains (multi, first = main) → branch search; "I shop at several branches".
### F3. [x] Computer Supermarket page (D1, `Supermarket-desktop`)
List by sections + side panel (store + estimate, Nexus suggests, templates, past trips), item drawer (same content as
C2), "Send to phone" popover with recipients (default: me + members with push on) → push that opens the list.
Keyboard: `/` add, Esc closes.

## Part G — guards and docs
### G1. [ ] Cleanups from S1 Open
Daily cron purge for `grocery:ai:*`, `grocery:off:*`, `grocery:offq:*`, `sm:draft:*`, `sm:op:*:cid:*`; the AI classify
after an add shows `other` rows settling into their section.
### G2. [ ] Guards
Smoke: Supermarket tab, add with count + weight, item sheet hide/unhide, a full trip on the phone through store mode,
desktop page + send to phone. `test:tenancy` covers `hidden_at`, `count`, Nexus templates; `test:roles` viewer can't
hide/edit. Parity PNGs for every board.
### G3. [ ] Docs
`SPEC.md` R18 S2 section (incl. the trip API), `CLAUDE.md` map lines, help topic Supermarket updated (how suggestions
learn, how to hide, what Nexus learned), `docs/ENVIRONMENT.md` log for any new script/env.

## Open
### Progress
- 0.1 done — part-2 boards (9 boards + `nx-sm2.css`) committed to `docs/design/r18/`; pointers in ROUND18 + PLANNER.
- A1 done — dock Home · Products · + · Supermarket/Projects · Insights, long-press + menu, manifest shortcuts, Products segments (To buy · On the way · Projects), sidebar Supermarket + count, tab-4 rule `lib/dock-tab.ts` + `test:dock`; phone smoke steps updated + new.
- A2 done — Supermarket tab (`supermarket/view.tsx`, kit `sm.css`, board pictures ported to `art-data.ts`): store chip + estimate vs this month's budget, aisle rail, add field, Nexus suggests (+ / × / Add all, draft header with `?draft=1`), sections in the main store's order, rows/tiles in the ⋯ menu (`pref:sm-layout` per person), first-time state (basic basket `lib/grocery/basket.ts`), viewer + offline badges; `/supermarket` renders the tab; action `supermarketHome`; demo data `scripts/lib/seed-sm.mjs` (seed-local); smoke step + `scripts/parity-r18.mjs` (a2-*.png). Fixed on the way: the closed + menu showed its disabled Plan card at 50 %.
- A3 done — Home "Next shop" card (`supermarket/trip.tsx` NextShopCard: next shop day / today is your shop, items + estimate, left this month, section chips, suggestions count; my trip: progress ring, Finish/Resume; someone else's: Add for them; first list: basic basket / build my list) and the trip bar above the dock on every phone screen (mine / other / offline / everything checked). Server: `openTripsOf` + usual day in `homeState`; client `SmHomeSync` refreshes on list changes, feed updates and every 20 s during a trip. Smoke step + parity a3-*.png.
- B1 done — nullable `items.count` (`db/migrate-r18s2.ts`); parser: "6 עגבניות" → count 6, "קילו עגבניות" → 1 kg, "קילו עגבניות, בערך 6" / "about 6" / "כ־6" → both; `lib/grocery/weights.ts` (unit weight learned per product per home from rows with both, fallback table); rows read "6 · 1 kg", "6 · ≈ 0.9 kg", "1 kg · ≈ 7"; add/merge/undo carry count; `test:grocery` +B1 lines (he + en); rehearsal `scripts/r18s2-rehearsal.mjs` (dry run on a local copy: only items.count added, nothing else changed).
- B2 done — Add screen `supermarket/add-screen.tsx` (full screen on phones, dialog on computers): type-ahead with the typed letters bold + On list badges, Did you mean + Add as new, quantity read from the line with the count + weight steppers (`qty-steppers.tsx`, shared with C2) and "×2 now → ×4 after adding", merge toast "Already on the list — now ×4" with Undo, voice (Web Speech) and paste → checked split preview (notes unchecked) → Add N; You usually buy chips. Smoke step + parity b2-add.png.
- B3 done — supermarket capture `supermarket/capture.tsx` (Barcode | Photo, the existing camera + decoder): scan → the home's own product (found / already on the list with the merged count "Add — now ×4"), a public one (Open Food Facts, shared cache) or an unknown barcode named once (section guess, the barcode kept on the home's row); photo → `smPhoto` (AI feature `grocery`, counts in the quota) matched to the home's product, else 3 choices (home first), or the daily limit (type / scan still work); `smAiAllowance` counter. `test:capture` (fixture barcodes + AI mock, every state + the UI). Parity b3-capture.png.
- C1 done — engine rewrite (`lib/grocery/staples.ts`): only suggests (S1 `auto` + its sweep, `addDueStaples`, `setStaple`, `setDraftPush` removed; `staple` column left, not read), regular (≥ 3 days, steady gaps) suggested when due / occasional only in context, × skips (3 in a row → twice the gap, 5 → until bought again, a purchase or + starts over), "Don't suggest this again" (`hideProduct` / `unhideProduct` / `hiddenProducts`), cold start = basic basket sized by onboarding `who` (+ baby / pets once the home bought some) until 4 trips, then it fades; `knowledgeOf` for the item sheet; evening draft gate `draftAllowed` (usual day = ≥ 3 trips on that weekday, something to suggest, list not empty-and-unused, < 3 unopened drafts since the last trip; no switch). Additive columns on `suggest_dismiss`: skips, skipped_at, hidden_at, hidden_by. `test:staples` rewritten.
- C2 done — supermarket item sheet `supermarket/item-sheet.tsx` (bottom sheet on phones, side sheet on computers; rows + tiles open it): name, section picker, count + weight steppers (packs: one stepper), note, photo of the exact product (`setItemPicture`, shown on the tile), What Nexus learned (new / learning n of 3 / regular with timeline + next date or due now / occasional with Shabbat · usually with X / hidden + Suggest it again), Don't suggest this again (+ Undo), preferred brand + substitutes, only at one store, history + cheapest; edits save as they happen; viewers read only. Suggestion action sheet (Add · Not this time · Never suggest this + Undo). Actions `smItemDetail` / `updateSmItem` / `removeSmItem`. Smoke step + parity c2-item-sheet.png. The Products "item sheet morph" smoke step passes alone now; rechecked in the full phone run at G2.
- D1 done — one typed trip API: ops `lib/grocery/trip-api.ts` (start · check · uncheck · notFound · substitute · quantity (count + weight) · price · add · note · finish), client `lib/trip-client.ts` (`tripApi.*` queue in IndexedDB + serialized flush, `onTripAnswer`), server `syncTripOps` → `mergeOps` with start / finish hooks (once per op id); `startSupermarketTrip` / `finishSupermarketTrip` removed (no other way to write a trip); S1 `sm-bridge` replaced by `supermarket/trip-sync.tsx`; documented in SPEC.md (R18 S2 → Trip API). `test:trip-api` (a whole trip through the API only, resend = no change, offline start → finish); `test:shop-offline` green (starts from an empty list now that the demo seed has one).
- D2 done — store picker `supermarket/store-picker.tsx` (sheet): This trip only (session pick per space, `trip-store.ts`; the list + store mode follow that branch's order, the default stays) vs Make it my default, search by chain / city / street (`lib/grocery/chains.ts` `parseStoreQuery`: "rami levy modiin" → a new branch), recent branches with visits (`homeState.visits`); section order per branch (full screen from the ⋯ menu / Settings): drag by the handle (arrow keys too), learned suggestion banner ("In this branch, dairy comes before bread" · Use this order · Not now, moved sections marked), Reset. Demo seed has a learned order + a second branch. Smoke step + parity d2-store-order.png.
- D3 done — store mode `supermarket/store-mode.tsx` (full screen; the screen stays on via Wake Lock): start (store, list size + estimate, Let's go, another store this trip only) → in the store (count / %, aisle rail in section colours with the current section, "Now: Dairy · 1 left", sections in the branch's order, the picture tile is the check, done sections fold, long press = not in the store / took something else / price / quantity, rows added by someone else during the trip marked "added now" + in-app toast, offline badge, total of ≈ estimate, Finish) → confirm → summary (bought / left / minutes, total vs estimate, left this month, receipt photo via the existing receipt camera or skip, confetti) → All saved. Everything through `tripApi`; the trip's screen memory on the device (`local-trip.ts`) so a reload loses nothing; the trip bar + Home card use it (offline starts too); "Start shopping" bar on the tab. Smoke step (a full trip on the phone) + parity d3-store-mode.png.
- D4 done — texts from data as Push-phone: draft "Your list for tomorrow is ready" · "18 items · Nexus suggests 4 · your list didn't change" (Open the list), adds during my trip grouped "Noa added 3 items while you shopped" + the names, new kind `sent` ("Tal sent the list to your phone" · 23 items · Shufersal Deal; `sendTargets` / `sentToPhone` in senders, actions `smSendTargets` / `sendSmToPhone` for F3); own inbox badges (draft sparkle, add plus, sent screen); draft / trip_add / sent open the Supermarket tab; the service worker shows no `trip_add` while the app is in front (payload carries `kind`). `test:notify` +D4 (he + en); demo inbox rows `seedInbox({ supermarket: true })`; parity d4-push-inbox.png. Also: d3-store-mode.png was never written (the summary cell hung on the trip left open by the previous cell) — parity now starts every shot with no open trip; d3 committed.
### Decisions
- A1: The board's flat bottom bar is not taken: the app keeps its floating dock (R14) with the new tabs/icons.
- A1: Tab-4 use counts live on the device (localStorage `nexus.tabUse`, 30 days); the tab is chosen once per page load so it never swaps under a finger; a tie keeps the Supermarket.
- A1: Products segments are plain labels + counts (board); the To buy total moved to the toolbar line.
- A1: The board's List · Recipes switch is not built: recipes are R18b.
- A2: The client store keeps only to-buy supermarket rows (`s.sm`); bought rows stay server-side (trips / history).
- A2: The S1 `sm-bridge` stays until D1 (it flushes the trip outbox); D1 replaces it with the trip API.
- A2: Chain monograms use the onboarding store colours (Shufersal = green m2), not the board's red.
- A2: Rows open nothing yet — the item sheet is C2; the Start shopping bar arrives with store mode (D3).
- A3: Home's card sits right under the header (before the widgets), not as a Customise widget — it's the supermarket's entry on Home.
- A3: Trip progress comes from the server's trip log (refreshed on feed updates + a 20 s poll while a trip runs); store mode (D3) will feed my own trip instantly.
- A3: The bar hides on Home for someone else's trip (the card shows it there).
- B1: A number is a count only for products sold by weight (dictionary unit kg / g); for packs (milk, eggs, bananas) it stays the quantity (×2). A count-only row keeps quantity 1.
- B1: Unit weights are learned from purchases that carry both a count and a weight (trip checks with qty + amount, rows with count + amount); receipts give weights only, so they teach nothing alone.
- B2: The Add field on the tab opens the Add screen (no inline typing); Enter adds the household's match when the typed name is it, else the line as typed.
- B2: The mic is shown only where the browser has speech recognition (decided after hydration).
- B3: The mock photo reader takes its answer from the image bytes ("mock:<title>|<confidence>|…") so tests can drive matched / unsure.
- B3: A public product found by barcode for the first time is shown as "New for this home"; it becomes known (Known · At home) once added (its barcode stays on the row).
- C1: hidden_at / hidden_by live on `suggest_dismiss` (already one row per product per space) next to the new skip count — no new table.
- C1: "Half the rate" = suggested at twice the usual gap; context reasons (Shabbat, holiday, with) still apply until 5 skips.
- C1: "Opened" for the draft streak = the inbox row was read (`notification.read_at`); opening one breaks the streak.
- C1: Cold-start sizing uses the reading person's onboarding `who`; baby / pet basket items appear only once the home bought something from those sections (onboarding doesn't ask).
- C2: "Taken by Noa · 2 Oct" isn't shown: who took a product photo isn't stored (the photo is the item's picture); the sheet says "Your photo".
- C2: "Only at one store" pins the main store (the store picker, D2, can pin another).
- D1: start / finish are ops in the same outbox (a trip can start and end offline), applied once per op id; the finish hook sets the total and runs the S1 trip-finished senders (inbox row, learned order).
- D2: No national branch directory: a branch is what the home types after the chain (kept in `space_store`); the chains' own branch files can fill it with the price-transparency work (R19).
- D2: "This trip only" lives on the device for the session (sessionStorage per space); a new trip-only branch is saved to the space (not as default) so its section order has a home.
- D3: The receipt step reuses the existing receipt camera (R7) — the review screen there; branch prices from the receipt arrive with R19's matching.
- D3: Spent so far = prices typed in the store, else the last price paid × quantity (an estimate until the receipt).
- D4: "Send to phone" reaches me too (the sender isn't excluded — my own phone is the point); a viewer may send only to themselves. One `sent` row per sender per space (a second send replaces it).
- D4: The trip-add and sent rows have no button (board); a tap on the row opens the list. The push's own action stays "Open the list" for draft / sent.
- D4: A draft opened from the in-app inbox goes to the Supermarket tab without the `?draft=1` header (the push / route keeps it).
- E1: A Nexus template has no stored name: it reads "Thursday shop" / "קנייה של חמישי" in the reader's language until someone renames it (E2), which makes it theirs.
- E1: A "routine" is weekday-based (the brief: items bought together + weekday). Context routines without a weekday (the board's barbecue) aren't detected; a weekday with two different baskets gives two routines.
- E1: "skipped" in the apply sheet = products the home hid ("Don't suggest this again"); a user's template may hold them, applying never adds them.
- E2: "Add again" pre-picks what was bought and isn't on the list now (not found ones and listed ones start unticked); adding merges like a template (a listed row keeps its quantity).
- E2: Editing any template (also a person's) stamps `edited_at`; for a Nexus one this is the "it's yours now" moment (also kept). Delete lives at the bottom of the editor (the board's ⋯ is decorative).
- F1: Supermarket lives with the space's sections (it's the home's: stores, hidden products, learning are shared), not under You as on the desktop board.
- F1: Forgetting is a cut-off time per fact (space pref), not a delete: Nexus relearns from what happens after it; prices for the estimate still use every purchase. Learned unit weights aren't reset by Forget everything (they're facts about products, not the home's habits).
- F1: "Household" is the reading person's onboarding answer (me / partner / family); there is no screen that changes it after onboarding, so ✎ opens Space → People.
- F2: Implemented as two phases of step 2 (not a new numbered step: the progress bar stays 6), shown when the person said supermarket or home shopping (or nothing). No branch directory (D2): the typed branch is the one row.
- F3: The desktop page is the same Supermarket tab laid out by `useDevice()` (one component, two layouts), not a separate route.
### For Tal
- ~~Prod snapshot was refused to the agent at session start (2026-10-13).~~ Taken 2026-10-14 (`snapshots/prod-2026-10-14.db`, read-only, integrity ok); the S2 rehearsal passes on a copy of it (state after D3).
