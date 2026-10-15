# R18 — Tal's notes after S2 (2026-10-15), sorted

Source: Tal's voice notes after using S2 on prod (phone). Planner sorted them into groups and proposed sessions.
Status: **proposal; Tal picks what goes into the next session.** Then the planner writes the brief(s).

## Causes the planner found in the code (2026-10-15)
- **Dock tab 4 flips to Projects / Products opens Projects.** `store.tsx` starts `tab4 = "supermarket"` and an effect
  switches it to `dockTab4(ui.why, use)` (`lib/dock-tab.ts`): onboarding answer includes "proj" + more Projects opens on
  this device → "projects". So it shows Supermarket for a moment, then Projects. With tab 4 = Projects, the Products tab
  opens `lastShopTab()` (localStorage `nexus.shopTab`), which is "projects" after visiting Projects → stuck there.
  Tal's decision: **remove the choice** — dock is always Home · Products · + · Supermarket · Insights for every user and
  space; Projects is a segment inside Products. Delete `dockTab4` / tab-use counting / the Settings swap.
- **Supermarket settings "missing".** They exist under Settings → Space → Supermarket (`settings/shell.tsx` SPACE group);
  Tal looked in the top list and didn't find them → discoverability.
- **Trip not in History.** Insights → History doesn't read trips; past trips live only in Supermarket ⋯ → Templates &
  past trips (`lists.tsx`, `pastTrips`).
- **Branch picker has no real branch list** — the branch is free text (`store-picker.tsx`). Nearest-first needs the chains'
  store lists with addresses = the same price-transparency files R19 uses for prices.

## A. Bugs and fixes (no boards needed)
1. Dock fixed for everyone (above). Products ↔ Projects stuck bug goes away with it.
2. Segment switches inside a tab (Products: To buy / On the way / Projects; Insights: Spending / History) — header and
   segment bar never move or reload; only the content changes; shorter, calmer card entrance.
3. App-wide pass: every in-tab switch (phone + computer) keeps the chrome still (same rule as 2).
4. Overscroll at the end of a page drags the dock/bottom bar → the dock never moves (like Samsung Health).
5. Supermarket settings reachable from the top of Settings (own row), not only under Space.
6. History: Products | Supermarket filter; trips listed with "add again to the list" (merge). ⋯ menu keeps a shortcut.
7. "You usually buy" + does nothing → it opens the item page (qty, add / update if already listed).
8. Voice add finds nothing (cause unknown → reproduce first).
9. Add-screen chips (scan, photo, voice, paste list) all visible at once — no horizontal scroll.
10. Insights → orders by store: grid / rows toggle does nothing → fix or remove.
11. "Forget everything" needs a real confirmation (type / hold), not one tap.
12. Produce: count drives weight (12 potatoes → weight updates); count is the default unit.
13. Store mode: a section that finished folds but can be reopened / undone (mis-taps).
14. Finish sheet: half height when it has little content (no big black area).
15. Supermarket tab: the list first; "Nexus suggests" below it, collapsed by default.
16. Home "Nexus suggests": rotates only while Home is on screen, timer starts when Home opens; smooth crossfade, no jump.
17. Admin: a back arrow (top corner, every admin screen) → back to Nexus.
18. Dock "+" turns into "×" while the long-press menu is open (S2 leftover).
19. Post-merge red runs on `6616b25` (guards FedCM step, prod smoke) — confirm / fix first.

## B. Supermarket list v2 + capture (boards first)
- List design: clearly one list (not loose sections), more compact, professional rows; real-looking product pictures.
- Row gestures: swipe one way = delete (with confirm), other way = quick quantity; tap name = rename inline; tap the
  picture = full item page.
- "+" on the Supermarket tab opens the camera straight away: barcode mode by default; Photo mode reads what it sees —
  a product, a receipt or a **handwritten list** (adds every line) — AI decides, the user can switch manually.
  Items land in the supermarket list or Products automatically.
- "Start shopping" screen redesigned (colour, light, a moment) — still fast.
- Save current list as template: preview card (stacked product pictures, name, item count, estimate).
- The Home supermarket card becomes a normal widget (movable); during a trip the "back to the trip" bar stays on top.

## C. Home widgets v2 (boards; inspiration: Samsung Health)
- Widget visual style (background, colours, card shapes) raised to Samsung Health level.
- Edit = long-press a widget → drag; widgets swap places like Android home-screen icons; remove in place.
- New shopping widgets (ideas: next shop + estimate, staples due, this month at the supermarket vs budget, last trip).
- Monthly spending: a richer breakdown (supermarket vs products, stores, categories) — maybe its own screen.
- "Ask Nexus" moves out of the top bar → a floating round button above the dock (bottom corner), moves up when a toast /
  notification shows; closing the chat returns to the same screen. (Stays a full circle per CLAUDE.md.)

## D. Needs R19 data (prices pipeline)
- Branch picker: type a chain → its branches, nearest first (location), more words narrow ("רמי לוי נתניה").
- Prices and promotions per chosen branch; totals / estimates follow; suggest promotions.
- Real product images where a source has them (coverage will be partial).
- Learn the household's usual brand per product (from barcodes / receipts) — helps someone who doesn't usually shop.

## E. Later (R20, real app)
- Offline: first view everything without internet (lists, history, store mode); later edit offline and sync on return
  (store-mode trips already queue offline since S1).

# After S3 (Tal, 2026-10-15 evening) — for S4 + boards
Fixes (no boards): "+" sometimes opens the quick menu instead of the camera → always camera. Barcode scanner much more
reliable (small / large / all formats / near + far; **freeze frame on detect** so the phone can be moved away;
autofocus — planner: stream starts at 640 px wide (`lib/camera.ts` FIRST_WIDTH) and never asks for continuous focus;
on multi-camera Androids `environment` can pick a lens without close focus). Photo: freeze on shutter, analyse the
still, retake; better product / receipt / list detection with matching frames. **Voice still doesn't work at all**,
no visual feedback (only the label changes) → working + visual (listening state, live words, recognised items).
Rename only when tapping the name's letters, not the row's empty area. Fast swipe-delete jumps (animation cut).
"Start shopping" button overlaps Nexus suggests → floating above the dock until scrolled. Empty list → templates first,
then products from past trips / smart suggestions. Clear feedback after adding. Bug: typed "מלפפון" + → "already on
the list", row vanished, then notes "+ ×3 · + ×1" instead of quantity — planner: `addToList` (`db-scoped/grocery.ts`
~l.139) notes the amount when units differ (row in kg, add in units) → convert with the unit weight (B7) instead;
every add path (search, barcode, photo, voice, suggestions) merges into count / weight, never notes. Start-trip
screen: not scrollable, nicer. Store mode: sections stay open when done (no auto-fold, no "section done" toast /
popup); the finish is a full screen, not a bottom sheet. Store mode: dragging the dark area shows a scrollbar with
nothing moving (nested scroller). Aisle rail: tap a colour → animated scroll to that section; minimum tap width per
section. Desktop Templates · Past trips switch: the pill overshoots its frame. Trips history much nicer — cards like
templates (date, time, items, total, store). Brands: learn and help find exactly the usual product.
Boards: list redesign; Home widgets Samsung-Health style + long-press drag / swap; floating Ask — **right side by
default, drag to the left and it stays; sits just above the dock; rises (or yields) cleanly when a toast / bar shows**;
monthly spending breakdown; start-trip screen look. Later (R19): real product images by brand. (Tal's last sentence
was cut off.)
