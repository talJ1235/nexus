# Round 18 — Session 3: fixes from Tal's use + supermarket quick wins (no new boards)

Source: Tal's voice notes after using S2 on prod (2026-10-15), sorted in `docs/R18-S3-NOTES.md` (groups A + part of B).
Boards from S2 (`docs/design/r18/`) and R17 stay the visual reference; **no new boards** — where an item needs a look,
reuse an existing component named here. Groups B (list redesign), C (Home widgets v2, floating Ask), D (R19 data) and
E (offline) are **not** in this session. Results go to **"## Open" at the end of this file**.

Tal runs this overnight (~8 h, unattended). Quality over speed: every item is verified on a phone context and on the
desktop before it is ticked.

## How to run (Session 3) — progress must never be lost
- Branch **`round18-s3`** from `main`. **Commit and push after every single item**: `R18.S3.<part><k>: …`, then
  `git push origin round18-s3`. Never keep more than one item uncommitted.
- After each item: tick it here (`[x]`) **and** append one line to "## Open" → "### Progress" in the same commit.
  Decisions you take go to "### Decisions" right away. Anything for Tal → "### For Tal".
- **Resuming:** `git fetch`, check out `round18-s3` if it exists, read "### Progress" + `git log`, continue from the
  first unticked item. Never redo a ticked item.
- Order = the order below (Part 0 first; then most painful first). Unattended; never stop to ask — take the reading
  closest to Tal's words (quoted in `R18-S3-NOTES.md`), write it in Decisions, go on.
- Read open reports (`node scripts/reports.mjs`) and the error log (`node scripts/errors.mjs`) first; don't touch power
  settings.
- **Bugs with an unknown cause: reproduce first** (a failing test or smoke step), then fix, then the test passes.
- **DB changes additive only.** Merge `--ff-only` to `main` only when **all** items are ticked, CI on the branch is
  green, **and after the merge** the `guards` run on `main` is green (re-run once if a known flaky step fails; if it
  fails twice, fix it). If the DB changed: migration rehearsal on a copy of a fresh prod snapshot
  (`node --env-file=.env.local scripts/db-snapshot.mjs`) must pass before merging; if the snapshot is refused, stop
  before merging and write the exact command for Tal in Open.
- Rules from S1/S2 still apply: i18n he + en for every string, `useDevice()` / `phone:` / `desk:` (never a width
  check), phone test contexts with a mobile UA (`scripts/lib/phone.mjs`), no `ad-*` classes, `SEARCH_OFF=1` for test
  servers, logical RTL utilities only.
- Every visible item: phone 360/390 + desktop 1366, light + dark, he + en, worst-case data, reduced motion. Add a smoke
  step per item (`scripts/smoke.mjs`) — not throwaway scripts.
- Motion bar: `.claude/skills/` (emil-design-eng, apple-design, mobile-native, animate + RECIPES, improve-animations).
  Use the easing / duration tokens in `nx17.css`; no new ad-hoc curves.

## Part 0 — red runs after the S2 merge
### 0.1 [ ] Post-merge runs on `6616b25`
`guards` on `main` failed at "Google in-app sign-in (FedCM sheet…)" and `prod smoke` (deployment_status) failed in
`node scripts/smoke.mjs`. Read both logs (`gh run view <id> --log-failed`; the planner's sandbox couldn't). Flaky →
make the step deterministic (it has failed once before). Real → fix. If prod smoke failed on an S2 step against real
prod data, fix the app or the step and say which in Decisions.

## Part A — navigation and the dock
### A1 [ ] One dock for everyone (Tal's decision)
Dock is always **Home · Products · + · Supermarket · Insights**, every user, personal and shared spaces. Projects is a
segment inside Products (To buy · On the way · Projects) — never a dock tab. Remove `src/lib/dock-tab.ts`
(`dockTab4`, tab-use counting, `TAB_USE_KEY`), `tab4` in `store.tsx` and every `tab4` branch (`phone-shell.tsx`
`dockOf` / order, `nexus-app.tsx` header + `ProjectsView inProducts`), update `scripts/test-dock.ts`. Onboarding's
"projects" answer keeps choosing the Home preset only.
Cause of Tal's bugs (verify they're gone): tab 4 rendered "supermarket" first, then the effect switched it to
"projects" after load (flicker); with tab 4 = Projects, Products opened `lastShopTab()` = "projects" and Projects lit
its own tab, so Products could never be reached. **Acceptance:** dock identical on first paint and after hydration;
Products → Projects → Products → To buy works; Projects lights Products; desktop sidebar consistent.

### A2 [ ] Segment switches keep the chrome still
Inside a tab, switching segments (Products: To buy / On the way / Projects; Insights: Spending / History; Supermarket
⋯ screens' segments; Templates · Past trips) must not move, re-mount or re-animate the header, the segment control or
the toolbar — only the content area changes. Today To buy ↔ On the way is smooth but → Projects re-mounts the top part;
Insights segments "jump / shrink" and the top bar moves. Find why (different view type → different shell / key /
layout). Content change: a short crossfade + small shift (≤ 8 px), ≤ 200 ms, no staggered card cascade on a segment
switch (keep the cascade for first open of a tab only, and make it faster). The segment pill slides between options.
**Acceptance:** a smoke check that measures the header / segment bar bounding boxes before, during (sampled frames) and
after each switch — no movement; no layout shift (CLS) on switch.

### A3 [ ] App-wide transitions audit (phone + computer)
Run the `improve-animations` skill over the app's navigation: tab switches, segment switches, sheets, drawers, settings
pages, admin tabs, Supermarket screens, Insights. Same rule as A2 everywhere: what didn't change doesn't move. Fix
everything ranked high / medium in this session; list low ones in Open. Tal: "everything a user knows from phone apps"
— platform-expected back arrows, sheet drag-to-close, press feedback.

### A4 [ ] The dock never moves on overscroll
Pulling past the end of a page drags the dock / bottom bar with the page (Android Chrome). Like native apps (Tal:
Samsung Health), the dock stays put; only content overscrolls (glow / stretch inside the scroller is fine). Check
`overscroll-behavior`, the fixed dock's containing block, the visual viewport; installed PWA and browser tab. Pull-to-
refresh must not fire inside the app. Also the desktop top bar.

### A5 [ ] Admin: back to Nexus
A back arrow in the admin top bar (start side, every admin screen, phone + desktop) → back to the app (same as ⋯ →
Back to Nexus). Platform-correct direction in RTL.

### A6 [ ] Dock "+" → "×" while the long-press menu is open (S2 leftover, Nav board)

## Part B — Supermarket fixes
### B1 [ ] Supermarket settings in plain sight
Settings top level gets its own **Supermarket** row (phone list + desktop sidebar), opening the existing page
(`settings/supermarket.tsx`). It stays a space setting (shared by the household) — show the space name on the page.
Remove it from under Space → only if keeping both is confusing; a deep link `/settings/supermarket` still works.

### B2 [ ] History shows supermarket trips
Insights → History gets a **Products | Supermarket** switch (A2's rules). Supermarket = past trips by month (reuse
`pastTrips` / `lists.tsx` rows and the trip page), with **Add again** (merge into the current list, as E2). Supermarket
⋯ → "Past trips" opens this place. Templates stay in the Supermarket tab ⋯. Check: the trip Tal finished on prod
shows (if it doesn't, find why — e.g. finished offline / not saved — and fix).

### B3 [ ] The list first, suggestions collapsed under it
Supermarket tab order: store / trip bar → **the list** → "Nexus suggests" (collapsed by default, one line with a count;
tap to open; remembers per device) → routine offer / templates entry. The list reads as **one list** (one surface,
section headers inside it, not floating separate cards) — keep S2's row look; the full redesign is group B later.
Rows denser (Tal: less scrolling): reduce vertical padding to the board's compact density, touch targets stay ≥ 44 px.
Grid / rows view toggle must visibly change the list (it worked but was hidden under suggestions).

### B4 [ ] "You usually buy" + / suggestion + opens the item page
Today the + does nothing (reproduce). Tap + or the row → the item sheet (S2 `item-sheet.tsx`) prefilled (count / weight
from history), button **Add** — or **Update quantity** when it's already on the list (merge rule). Same in Nexus
suggests and the Add screen's suggestions.

### B5 [ ] Voice add works
Tal: tap mic, say several products with amounts, tap stop → nothing is found. Reproduce with `lib/grocery/voice.ts`
(Hebrew `he-IL`, interim vs final results, stop before final, Android Chrome / PWA), fix; the result goes through
`splitList` + `parseLine` into the same review as Paste list. Fake SpeechRecognition in tests for he + en phrases
("שני חלב, לחם וחצי קילו עגבניות").

### B6 [ ] Add-screen chips all visible
Scan · Photo · Voice · Paste list fit in one row at 360 px in he + en (icon + short label, or 2×2) — no horizontal
scroll.

### B7 [ ] Count drives weight for produce
Changing the count updates the weight (count × learned unit weight, S1/S2 tables) — today only weight → count works.
Count is the default unit for produce; weight shows as "≈ 1.8 ק״ג". Editing weight still updates count. Item sheet, Add
screen, store mode quantity.

### B8 [ ] Store mode: a finished section can be reopened
When every item of a section is checked, it folds into a one-line "Dairy · 3 ✓" row that **opens again on tap** and
items can be unchecked (undo). A toast "Dairy done · Undo" for 5 s after a fold. Mis-taps never hide items.

### B9 [ ] Finish sheet fits its content
Finish confirm (items left) is a bottom sheet sized to its content (≈ half height), no big empty dark area; drag down
closes. Same check for every S2 sheet.

### B10 [ ] "Forget everything" needs a real confirmation
A sheet that says what will be forgotten (and what stays), then **hold to confirm** (like admin delete, R17) or type
the word. One fact ✕ stays one tap + Undo toast.

### B11 [ ] Store picker: "This trip only" vs "Make default" before picking
The choice sits at the top of the picker, visible before choosing a branch (today it's unclear). Typing a chain shows
its known branches; more words narrow ("רמי לוי נתניה"); every shown row is tappable. (Real branch lists +
nearest-first = R19, not now — say so in the empty state only if a chain has no known branches.)

### B12 [ ] Insights → orders by store: grid / rows toggle
It changes nothing → make it work or remove it (Decisions says which).

## Part C — Supermarket quick wins (existing screens only)
### C1 [ ] "+" on the Supermarket tab opens the camera
"+" (dock on the Supermarket tab, and the tab's add button) opens the capture screen (`capture.tsx`) **in barcode mode
straight away**; switch to Photo there; "Type instead" goes to the Add screen (search bar stays on the tab). Long-press
dock menu unchanged. Camera permission denied → Add screen with a one-line hint.

### C2 [ ] Photo mode understands what it sees
One AI call (through `ai-gate`, feature `grocery`, counts in the quota) classifies the photo: **product** (as today,
`smPhoto`), **receipt** (→ the existing receipt review, R7 `receipt-review.tsx`), **handwritten / printed list** (→ every
line through `splitList` + `parseLine` into the Paste-list review, user confirms, then merge into the list). The result
screen says what it understood ("Looks like a list · 9 items") with a switch to the other two. Products that aren't
groceries go to Products (existing classify). Mock AI fixtures for all three + "not sure". Daily-limit state as today.

### C3 [ ] Save as template: a preview card
"Save the current list" / "Save as template" shows a card: stacked product pictures (reuse `ProjectCover`'s stacked
pictures from `project-cover.tsx`), name field, item count, estimate, store. Same card on template rows in Templates.

### C4 [ ] Next-shop card is a normal Home widget
`NextShopCard` (`supermarket/trip.tsx`) becomes a widget in `lib/home-layout.ts` (`WIDGETS`, presets: household +
minimal include it) — movable / removable in Customise like the others. During a trip the "back to your trip" bar stays
pinned at the top of Home regardless of the widget. Existing layouts get the widget where it is today (first).
Keep S2's fixed height (no layout shift).

### C5 [ ] Row gestures on the supermarket list
- Swipe toward the end side → delete (red, icon), full swipe or tap the revealed button → confirm by Undo toast
  (5 s) — **no** modal on swipe; one-tap mistakes are undoable.
- Swipe toward the start side → quick quantity (− count +, inline, closes on tap outside).
- Tap the name → rename inline. Tap the picture tile → full item sheet.
- Reuse the inbox's swipe (`components/notify/inbox.tsx`, R17 board) for physics; rubber-band at the ends; vertical
  scroll never triggers it (axis lock); RTL mirrors the directions; reduced motion = no slide, buttons instead.
- Not in store mode (there a tap checks).

### C6 [ ] Usual brand (engine + one line)
Record the brand bought per product type per home from barcode scans, store-mode checks of a known barcode and receipt
lines (additive data). Item sheet shows "Usually: Tnuva 3% · 8 of 10 times" when ≥ 3 buys and ≥ 60 % one brand.
Forget everything / forget one fact clear it. Admin counts only.

### C7 [ ] Home "Nexus suggests" timing
Rotation starts when Home is on screen (and visible: `visibilitychange`), pauses when it isn't, first change after the
normal dwell (not immediately on entering Home). Change = crossfade + small rise of the text, fixed height, no jump.

## Part G — guards and docs
### G1 [ ] Guards
Smoke steps for every item above (phone + desktop). `test:dock` rewritten for one dock. Motion checks from A2 on every
segment switch. `test:tenancy` / `test:roles` for any new data (C6) and actions. Full phone + desktop smoke pass.
### G2 [ ] Docs
`SPEC.md` R18 S3 section, `CLAUDE.md` map (dock, history trips, capture classify, brand), help topic Supermarket
(swipe, camera, list photo), `docs/ENVIRONMENT.md` log line if anything changed. Results + leftovers in Open.

## Open
### Progress
### Decisions
### For Tal
