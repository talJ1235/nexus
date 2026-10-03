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

### A1. [x] Full intro only when the app is opened; a small loader on reload
Round 10 made the boot sequence play on every load; Tal now wants:
- **App open** (cold start: new tab / PWA launch / first visit of the session) → the full intro.
- **Reload / pull-to-refresh / revisit within the session** → only the small loader: the Box mark in a small circle
  (the one the pull-to-refresh already shows), no full-screen sequence.
- Decide with `performance.getEntriesByType("navigation")[0].type` (`reload` → small) plus a session flag
  (sessionStorage, which in an installed PWA lives as long as the app is open). Document the rules in Open.

### A2. [x] A more impressive intro
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

### B1. [x] Settings → Reports opens behind settings; two clicks to close
Opening Reports from Settings shows a side sheet you can't see because Settings stays on top; outside click closes
Reports first and needs a second click for Settings. Fix: Reports opens as a **sub-page inside Settings** (slide in,
back arrow returns to Settings) on desktop and phone. Audit every place where one overlay opens another (settings →
memory, settings → reports, item sheet → picture picker, assistant → history, + menu → scanners, project page →
plan) and apply one rule: nested = sub-page in the same surface, or the new surface fully on top with focus, and one
outside click / Esc closes **only the top** layer with a visible result each time. Smoke: every pair opens visible
and closes in the expected order.

### B2. [x] History within reach on the phone
There's no convenient way to the purchase history on the phone. The last dock tab becomes **Insights** with a
segmented control at the top: **Spending · History** (History = received/purchased items with search, filters by
month/store/project, and the order timeline). Update the dock icon if a better one fits both. Also: History in the
Me sheet and in search results ("Go to History").

---

## Part C — quick actions on products (phone and desktop)

### C1. [x] Phone: swipe = delete one way, status the other
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

### C2. [x] Desktop: the same actions without hunting
- Card hover reveals a small action bar on the card (icon buttons with tooltips): On the way, Received, Move, Delete.
- Right-click on a card/row → context menu with the same actions + Open, Copy link, Compare.
- Keyboard: with a card focused or items selected — `O` on the way, `R` received, `M` move, `Delete` delete (Undo
  toast), `Enter` open; shown in the command menu and tooltips.
- Multi-select bar keeps all of these for several items.

---

## Part D — product pictures and tags

### D1. [x] One consistent picture style for every product
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

### D2. [x] Tags you can always read
"Lowest price" (and every tag drawn over a picture: Urgent, category, check, etc.) is semi-transparent and gets lost
on the picture. Make tags solid: opaque fill from tokens, 1 px edge, a tiny shadow for separation, consistent size and
position (category top-start, status/price flags top-end), readable on white tiles and photos in all four themes.
Add a contrast check for tag fg/bg to `scripts/contrast.mjs`.

---

## Open

### End-of-run summary (2026-10-03)
All 8 items (A1, A2, B1, B2, C1, C2, D1, D2) shipped on `round11`. A1+A2 share one commit, and so do C1+C2; there is
one follow-up commit (the hover bar's position). Green at the end: typecheck + lint + build, 20 unit-test scripts (new: `test:picture-style`; contrast now checks tags), full smoke with `SMOKE_WRITE=1` on a `NEXUS_AI_MOCK=1` server — desktop 49 checks, phone 55 (new: boot modes, nested overlays, insights/history, quick actions).
Nothing to configure. D1's backfill only writes where Blob storage exists, so it runs on Vercel: 30 pictures per daily
cron run, or all at once with `scripts/backfill-pictures.ts` and the production env.
Worth checking on the real phone: the intro (A2) and how it hands off to the top-bar logo, the reload loader (A1), how
the swipe thresholds and haptics feel (C1), and the dimmed paper tile in dark mode (D1).

### Notes and decisions (Round 11 run)
- **Open reports**: still unreadable. `REPORTS_TOKEN` isn't set locally, and there are no `from-app` GitHub issues.
- **A1 rules**: the full intro plays when navigation type is `navigate` / `prerender` and this tab has no
  `sessionStorage["nexus.opened"]` yet (new tab, PWA launch, first page of the session). Everything else gets the
  small loader: `reload` (including our pull-to-refresh), `back_forward`, and any later load in the same tab. If
  storage throws, the full intro plays. As before, the desktop browser shows neither; only phones and the installed
  app do.
- **A2**: the intro reaches "ready" at about 2.3 s and hands off within 480 ms. The frame trace is 16–17 ms per frame
  for the whole sequence. The mark flies into the top-bar Box (`[data-topbar-logo]`); on pages without one (login,
  shared lists) it settles in place. The spark dot comes to rest on the top face with a thin outline in the
  background colour, so it stays visible on the amber top face.
- **B1 cause**: Settings is a `Modal` (z-50) and Reports was a `Sheet` (z-40). Reports opened underneath, but Radix
  treated it as the top layer, so the first outside click closed the invisible Reports. Radix already closes only the
  top layer, so the fix is one z-layer for every surface (the newest portal is on top) plus the Reports sub-page. The
  other listed pairs were already sequential or inline: memory is a section, assistant history is a pane, the + menu
  closes before a scanner opens, and the project plan opens the assistant.
- **B2**: I kept the dock icon (bar chart) because it fits "Insights". History's search is separate from the global
  search, so typing there doesn't open the top-bar search. History drops the project chips in favour of a Project menu
  (the chips were hidden on phones anyway). The month timeline is the "order timeline"; the desktop table layout stays
  one flat table.
- **C1**: delete is a swipe toward the start edge (left in English, right in Hebrew) and status toward the end edge.
  The row is held open past 64 px. Releasing past half the row width deletes at once. Received items get a single
  block, "Back to To buy". Long-press is 480 ms. Swipes apply to the rows layout; grid cards only have long-press.
  Rows now set `touch-action: pan-y`: without it Chrome cancels the pointer as soon as it treats the touch as a pan,
  so the old swipe was unreliable.
- **C2**: the hover bar shows the status moves, Move and Delete in the picture's top-end corner. At the bottom-end it
  reached the middle of the card, where a click meant to open the item could change its status instead. Compare and
  Open in store moved to the right-click menu. Backspace also deletes (Mac keyboards). The command menu shows the
  "Selected items" actions only while something is selected.
- **D1**: the style is stored in the picture's file name (`…-c.webp` / `…-p.webp`) rather than a DB column, so it
  travels with the picture, needs no migration, and covers all eight places that store pictures.
  - Pictures on a uniform dark or coloured background (e.g. black) are trimmed and then treated as photos (they fill
    the frame). Turning a black background white would also eat dark products.
  - Pictures not normalized yet look like cut-outs: paper tile with an 8 % inset.
  - Locally (no Blob token) nothing gets normalized. I checked the frame with normalized fixture files served for one
    run. The unit test covers white, black, transparent and photo inputs.
- **Fixed in passing**: a picture that failed to load before hydration stayed invisible. It now shows the placeholder.
