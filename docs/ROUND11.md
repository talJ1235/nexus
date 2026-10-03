# Round 11 brief (from Tal, 2026-10-03) — fixes and quick actions — source of truth

Tal's notes after using Round 10. **Functional fixes and interactions only.** The visual maturity pass (fewer rounded
boxes, flatter sidebar, dashboard, decluttered products page) is **Round 12** — it gets mockups approved by Tal
first, so don't restyle layouts here beyond what an item needs.
One **unattended** run, same rules as Rounds 7–10 "How to run": branch **`round11`** from `main`, commit per item
`R11.<part><n>: …`, push the branch after each part, never stop to ask (decisions → "## Open"), merge to `main` with
`--ff-only` only when all green, don't touch power settings. Read open reports first. Verify on phone (360/390) and
desktop (1366), light + dark, Graphite + Plum; frame traces for every animation touched.

---

## Part A — opening the app

### A1. [ ] Full intro only when the app is opened; a small loader on reload
Round 10 made the boot sequence play on every load; Tal now wants:
- **App open** (cold start: new tab / PWA launch / first visit of the session) → the full intro.
- **Reload / pull-to-refresh / revisit within the session** → only the small loader: the Box mark in a small circle
  (the one the pull-to-refresh already shows), no full-screen sequence.
- Decide with `performance.getEntriesByType("navigation")[0].type` (`reload` → small) plus a session flag
  (sessionStorage, which in an installed PWA lives as long as the app is open). Document the rules in Open.

### A2. [ ] A more impressive intro
Tal loves the current Box assembly; make it a little longer (~2–2.4 s to "ready", still never holding a ready app
more than ~500 ms past the sequence) and fill the whole screen, not just a black field with a mark in the middle.
Reference Tal gave: the Cal AI app opener (a coloured full screen, the logo with a dot that bounces). Our version,
in the active palette:
- Background comes alive: a soft palette-coloured field that blooms from the centre, with subtle moving shapes
  (e.g. faint isometric box outlines / grid lines drifting, matching the Box logo's geometry), never noisy.
- The Box faces fly in and assemble (as now) with a spring; then a small "dot" (spark colour) drops onto the top
  face and bounces twice; the wordmark slides up; a light sweep crosses; then the whole intro scales/fades into the
  app (the mark morphs toward the top-bar logo position if cheap).
- 60 fps on the phone profile (transform/opacity only, SVG/CSS or a single canvas); reduced motion → static mark +
  fade. Frame-trace it.

---

## Part B — overlays and navigation

### B1. [ ] Settings → Reports opens behind settings; two clicks to close
Opening Reports from Settings shows a side sheet you can't see because Settings stays on top; outside click closes
Reports first and needs a second click for Settings. Fix: Reports opens as a **sub-page inside Settings** (slide in,
back arrow returns to Settings) on desktop and phone. Audit every place where one overlay opens another (settings →
memory, settings → reports, item sheet → picture picker, assistant → history, + menu → scanners, project page →
plan) and apply one rule: nested = sub-page in the same surface, or the new surface fully on top with focus, and one
outside click / Esc closes **only the top** layer with a visible result each time. Smoke: every pair opens visible
and closes in the expected order.

### B2. [ ] History within reach on the phone
There's no convenient way to the purchase history on the phone. The last dock tab becomes **Insights** with a
segmented control at the top: **Spending · History** (History = received/purchased items with search, filters by
month/store/project, and the order timeline). Update the dock icon if a better one fits both. Also: History in the
Me sheet and in search results ("Go to History").

---

## Part C — quick actions on products (phone and desktop)

### C1. [ ] Phone: swipe = delete one way, status the other
On list rows (and anywhere a row appears: To buy, On the way, project pages):
- Swipe toward **one side** → red "Delete" (full swipe deletes; toast with Undo).
- Swipe toward **the other side** → two action blocks revealed side by side: **On the way** and **Received**
  (for items already on the way: **Received** and **Back to To buy**). Tap one → status changes with the existing
  flow (price paid captured as today), row animates out of the view.
- Directions: delete toward the start edge, status toward the end edge, mirrored in Hebrew like the rest of the list
  (the dock stays fixed LTR, rows follow reading direction). Haptic tick at the threshold. Today's swipe-to-select
  moves to long-press.
- **Phone cards (grid)**: long-press a card → a compact action sheet: On the way, Received, Delete, Move to project,
  Select. Same on the item sheet's "…" menu.

### C2. [ ] Desktop: the same actions without hunting
- Card hover reveals a small action bar on the card (icon buttons with tooltips): On the way, Received, Move, Delete.
- Right-click on a card/row → context menu with the same actions + Open, Copy link, Compare.
- Keyboard: with a card focused or items selected — `O` on the way, `R` received, `M` move, `Delete` delete (Undo
  toast), `Enter` open; shown in the command menu and tooltips.
- Multi-select bar keeps all of these for several items.

---

## Part D — product pictures and tags

### D1. [ ] One consistent picture style for every product
Today some pictures have white backgrounds, some black, some transparent — the grid looks uneven. Make every product
picture look like it belongs to one catalogue, always:
- **On ingestion** (`src/lib/images.ts`, sharp): flatten transparency onto white; **trim** uniform borders (white
  or black, tolerance ~8 %); detect whether what remains is a product cut-out (uniform background) or a full photo
  (busy background).
  - Cut-out → place centred on a **white square** with ~8 % padding (480 × 480 WebP).
  - Full photo → square centre crop ("cover").
  Store `imageStyle: "cutout" | "photo"`.
- **In the UI**: one picture frame component used everywhere (cards, rows, sheet hero, receipt review, shopping
  mode, picker): cut-outs on a white "paper" tile in light **and** dark mode (dark mode: the tile is a slightly dimmed
  white with a hairline edge so it doesn't glare), photos fill the frame. Same corner radius and inset everywhere.
- Backfill all existing pictures (bounded batches via the daily cron + a one-off script). Unit test trim/detect on
  fixtures (white bg, black bg, transparent PNG, lifestyle photo).

### D2. [ ] Tags you can always read
"Lowest price" (and every tag drawn over a picture: Urgent, category, check, etc.) is semi-transparent and gets lost
on the picture. Make tags solid: opaque fill from tokens, 1 px edge, a tiny shadow for separation, consistent size and
position (category top-start, status/price flags top-end), readable on white tiles and photos in all four themes.
Add a contrast check for tag fg/bg to `scripts/contrast.mjs`.

---

## Open
