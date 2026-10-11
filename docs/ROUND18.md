# Round 18 — supermarket mode v2

Source: Tal (2026-10-10/11) via the planning chat. Source of truth for what the screens do: `docs/R18-SCREENS.md`
(approved) + boards `docs/design/r18/` (approved 2026-10-11; interactive — use their Tweaks). Context and answers:
`docs/R18-PLANNING.md`; decisions: `docs/PLANNER.md` "Decisions that stand" (R18 entries). R18b (recipes + AI shop
planning) is a later round.

Sessions: **S1 = data + engines, no new screens** (this file, now) · **S2 = the screens** (brief after boards part 2:
P4–P8, P12–P13, P16–P17, D1, D3) · **S3 = fixes after Tal's first real shop with Noa**.

## How to run (Session 1)
- Run **after R17 Session 6 is merged** (S1 touches the notification senders).
- Branch **`round18-s1`** from `main`; commit per item `R18.<part><k>: …`; push after each part; unattended; never stop
  to ask → decisions and anything left for Tal go to "## Open" → "### Session 1"; tick items here.
- **The DB changes** (additive only: new tables, new nullable / defaulted columns; no renames, no drops). Merge
  `--ff-only` only when CI is green **and** the migration rehearsal on a copy of the prod snapshot passes. If the
  snapshot can't be taken in the session (the permission classifier refused it in S4), stop before merging and write
  the exact command for Tal in Open.
- Read open reports and the error log first; don't touch power settings.
- Every user-visible string goes through the i18n dictionaries (he + en). No new screens in S1 — where a feature needs
  UI to be testable, use a test, a script or an admin row.

## Part 0
### 0.1 [ ] Commit the boards
Tal saves `docs/design/r18/` (6 boards + `nx-sm.css` + copies of the R17 css) into the checkout before the run.
Commit them as `R18.0: boards part 1` (no other change). If the folder is missing, note it in Open and continue.

## Part A — data foundation
### A1. [ ] Supermarket items in the existing `items` table
Today one list mixes everything; R18 needs a supermarket list per space (`R18-SCREENS.md` §0 Q15) next to Products.
Add to `items` (nullable / defaulted): `list` (`products` | `supermarket`, default `products`), `section` (one of the 16
keys in A3), `unit` (`u` | `kg` | `g` | `l`, null = units), `amount` (real, for kg / g / L; `quantity` stays the unit
count), `product_key` (A4; links the same product across trips), `staple` (`off` | `suggest` | `auto`, default `off`),
`pinned_store` (store key, e.g. Super-Pharm), `prefer_brand`, `substitutes` (json string[]), `art_key` (A4).
Migration: existing items stay `products`; items in a collection whose name looks like groceries (`groceries`,
`מצרכים`, `סופר`, `supermarket`, case-insensitive) move to `supermarket` with section + product_key filled by A4.
Record what moved (counts per space) in Open. Every query that lists Products excludes `supermarket` items, and the
reverse — guard in `test:scope`.
Acceptance: rehearsal on the prod copy shows counts before / after equal in total; `test:tenancy` green.

### A2. [ ] Trips and the check log
Today a trip is a pref (`pref:shop-trip`) and the order of checks is lost. New tables:
- `trip`: id, space_id, user_id, chain, branch, started_at, finished_at, est_total, total, currency, planned, bought,
  not_found, receipt_id, rev.
- `trip_check`: trip_id, item_id, product_key, section, action (`check` | `uncheck` | `not_found` | `substitute` |
  `qty` | `price`), qty, amount, unit, price, gtin, by_user, at (ms), seq (per trip).
The R17 trip notifications (`lib/notify/senders.ts`) read and write the `trip` row instead of the pref (same pushes,
same texts; the pref is kept read-only one release for open trips). Price points written from a trip carry chain +
branch (R19 matches transparency files by gtin + chain + branch).
Acceptance: unit test replays a trip (start → 10 checks incl. uncheck / not found → finish) and gets the same counts
and order; `test:notify` still green.

### A3. [ ] Sections and the default walking order
16 section keys and the default Israeli order from `R18-SCREENS.md` §2 (produce … dairy & eggs, frozen last) as one
client-safe module with he + en names and the icon names the boards use. Per space + store: `space_store` (space_id,
chain, branch, is_default, section_order json | null, suggested_order json | null, suggested_at, dismissed_at). The
list order for a trip = the branch's confirmed order, else the default.
Acceptance: unit test for the default order and for an override.

### A4. [ ] Product dictionary: section, product type, picture key
One dictionary of grocery **product types** (start with ~200: tomatoes, cucumbers, milk 3%, cottage, challah, pita,
eggs, tahini, hummus, toilet paper …) with he + en names, common spellings and synonyms, section, default unit, and an
`art_key` (the picture the S2 illustration set draws — Tal chose 2026-10-11: an illustration of the product type by
default, a real photo only when the exact product is known: barcode, own photo, Open Food Facts).
`classify(text, gtin?)` → { type, section, unit, art_key, product_key, confidence }: dictionary first, then Open Food
Facts categories for a barcode, then **one batched AI call** for unknowns (counts in the AI quota, cached per text;
never blocks adding — unknown goes to section `other` and is fixed when the answer arrives). Hebrew normalisation for
matching: final letters (ך ם ן ף ץ), niqqud and geresh / gershayim removed, `״`/`"` unified, extra spaces.
`product_key` = gtin when known, else the normalised type + the distinguishing words (`milk 3%` ≠ `milk 1%`).
Acceptance: `test:grocery` (new) — 100 real Hebrew / English lines from the boards' worst-case data and Tal's past
receipts (read from the local DB, no content committed) classify to the expected section ≥ 90 %.

### A5. [ ] Learn the branch's order (suggest, never apply)
From `trip_check` (checks only, in `seq` order) per space + branch: the median position of each section. After ≥ 2
finished trips that agree and differ from the current order, store `suggested_order` (the S2 banner asks "use this
order?"). Never reorders by itself; a dismiss waits for 3 more trips.
Acceptance: unit test with synthetic trips (dairy before bread twice → suggestion; once → none; dismissed → quiet).

## Part B — staples and "Build my list" (engine only)
### B1. [ ] Learn from history
Per space + product_key from purchases (`trip_check` + existing purchased items + receipts): usual quantity / amount,
interval (median gap, ≥ 3 purchases; show "every ~9 days"), last bought (when, where, price), usual store(s); per space:
usual shop weekday + hour from trips (≥ 3 trips, else none).
### B2. [ ] Suggestions — rules from `R18-SCREENS.md` §3
`suggest(space, now)` → [{ product_key, title, qty, section, art_key, reason_key, reason_args }] with reasons: due
(interval), weekday/holiday (Shabbat items before Friday; holidays from a small Israeli calendar table for the next 12
months), usual companion (bought together ≥ 60 % of trips). Never suggests what is already on the list (any quantity)
or what was dismissed this cycle (`suggest_dismiss`: space, product_key, until). Accept merges into the list (B4/C2
rule: an existing quantity stays the user's). Staple `auto` items are added by the engine on their due day (as an add
by "Nexus", undoable, shown with the reason). The AI only phrases reasons when the space allows AI (rules-only setting
respected); S1 ships fixed phrases.
### B3. [ ] Evening-before draft
In the hourly sender: for a space whose usual day is tomorrow, between 19:00 and 21:00 local and not in night quiet,
compute the draft once and send one push to the members who shop ("Your list for tomorrow: 18 items, Nexus suggests 4",
action Open list → `/supermarket?draft=1`). New notification kind `draft` (on by default; switch in Settings →
Supermarket arrives in S2 — store the pref now). Never changes the list.
### B4. [ ] Templates and past trips (data)
`template` (id, space_id, name, items json [{product_key, title, qty, amount, unit, section}], created_by, rev) and
"apply" = merge into the list (never duplicates; existing quantities stay). "Save trip as template" from a `trip`.
Acceptance (B): `test:staples` (new) — synthetic 8-week history: due items, no duplicates with the list, dismiss
honoured, Shabbat rule, companion rule, auto staple added once with undo, draft computed once per evening.

## Part C — fast add (server + libs, used by S2's Add screen)
### C1. [ ] Parse a typed line
`parseLine("2 חלב 3%")` → qty 2 + "חלב 3%"; units in he + en (`ק"ג`, `ק״ג`, `קילו`, `גרם`, `ליטר`, `kg`, `g`, `l`), decimals with
`.` or `,`, "חצי"/"half". Numbers that are part of the name stay (`3%`, `500 גרם` after the name = pack size).
### C2. [ ] Duplicate merge on add
Adding a product_key already on the supermarket list (to_buy) adds to its quantity / amount instead of a new row and
returns `{ merged: true, now }` for the toast "Milk is already on the list — now ×3" with Undo (undo restores the old
quantity). Different units of the same product → keep one row, note the second amount.
### C3. [ ] Type-ahead and "did you mean"
Endpoint ranked by this household first (count × recency), then the dictionary, then Open Food Facts IL. Matching on
normalised text; the response marks the matched character range so S2 bolds only the typed letters (Tal 2026-10-11).
When nothing matches: up to 3 "did you mean" candidates by edit distance on the normalised form (threshold ≈ length/3),
household products first; "add as new" always offered.
### C4. [ ] Split a pasted list / a voice line
`splitList(text)` for WhatsApp pastes (lines, commas, bullets, "X:" sender prefixes, emoji, "!!") and voice
transcripts ("milk, eggs and two breads" / "חלב, ביצים ושני לחמים" — `ו` as "and" only between items). Each part →
parse + classify + "already on the list" flag; lines that aren't products ("something nice for Shabbat") come back
unchecked as a note. Voice capture uses the Web Speech API (`he-IL` / `en-US`) behind a small client helper with a
"not supported" result (S2 hides the button).
Acceptance (C): `test:add` (new) — parse table (40 lines he + en), merge + undo, fuzzy table (`עגבנות` → עגבניות,
`tomatos` → Tomatoes, `חלאב` → חלב), split table (the boards' WhatsApp and voice examples).

## Part D — offline and live in the store
### D1. [ ] Outbox for everything in a trip
Today only "bought" marks are queued and the last write wins. Queue every trip action (check, uncheck, not found,
substitute, qty / amount, price, add) with the item's `rev` at the time; the server merges per field (a check never
undoes someone else's later edit of the note; two people checking the same row = one check). Adds made offline get a
client id and merge by product_key when they arrive (no duplicates).
### D2. [ ] Live adds during a trip
An item added by another member while a trip runs reaches the shopper live (Ably or the 10 s poll), flagged `live` for
the highlight, and one push to the shopper ("Noa added milk") — activity rule: first at once, then grouped ≤ 1 / 10 min
per trip.
Acceptance (D): `test:shop-offline` (new, browser) — go offline, check 5, uncheck 1, add 2 (one a duplicate), change a
price, come back → server state equals the expected one; a second session edits a note meanwhile → kept.

## Part E — admin numbers, guards, docs
### E1. [ ] Admin
Admin → Metrics (counts only, never content): trips per week, items per trip, share of trips with a receipt, share of
suggestions accepted, week-4 retention of shopping spaces.
### E2. [ ] Guards
New tests in `guards.yml`: `test:grocery`, `test:staples`, `test:add` (unit), `test:shop-offline` (browser); `test:scope`
covers the Products / Supermarket split; `test:authz-coverage` covers the new actions. Migration rehearsal script
extended for R18 (counts, no NULL `list`, re-run is a no-op).
### E3. [ ] Docs
`SPEC.md` R18 S1 section; `CLAUDE.md` map (grocery dictionary, trip tables, engines); `docs/ENVIRONMENT.md` new
scripts / env (none expected).

## Open
