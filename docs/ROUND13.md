# Round 13 brief (from Tal, 2026-10-04) — Home dashboard, Shopping tab, one search, new opening — source of truth

Tal reviewed the Home v3 mockups, asked for changes, and approved **Home v4** in the planning chat (account B).
The design source is in `docs/design/home-v4/*.dc.html`. These are static mockups in the design-canvas format, so read them
as HTML/CSS (they need the canvas runtime to run their small scripts). Where this brief and a mockup disagree, **this brief
wins**. The mockup copy is English; build the real strings in `en.ts` + `he.ts`, and mirror the layout in Hebrew.

One **unattended** run, same rules as Rounds 7–12 "How to run":
- Work on branch **`round13`** from `main`. Commit each item as `R13.<part><k>: …` (e.g. `R13.A2: home data module`).
- Push the branch after each part. Never stop to ask: put decisions in "## Open". Merge to `main` with `--ff-only`
  only when everything is green. Don't touch power settings. Read open reports first.
- Verify on phone (360/390) and desktop (1366), light + dark, Graphite + Plum, English + Hebrew. Take frame traces
  for anything that moves. Animate transform/opacity only, unless an item says otherwise.
- Every feature must work with no AI key and with an empty account (see A7).

Mockups → items: `home-v4/desktop` (A, C2) · `home-v4/phone` (A, B1) · `home-v4/shopping` (B) · `home-v4/search`
(C1) · `home-v4/intro` (D).

---

## Part A — Home (the dashboard) becomes the default screen

### A1. [x] New `home` view, opened by default
Tal decided on 2026-10-03 that the dashboard is the home screen. Today the app still opens on `to_buy`
(`paramToView` in `store.tsx` falls back to `to_buy`), and the top-bar logo goes to `to_buy`.
- Add a view `{ type: "home" }`. It is the fallback in `paramToView`, `?v=home` is the default URL with no param,
  and both logos (phone top bar `data-topbar-logo`, desktop sidebar) open it. Add it first in `VIEW_ORDER`.
- Desktop sidebar: **Home** first, then To buy, On the way, Projects, Order by store, History, Spending (same as today
  after Home).
- Layout follows `home-v4/desktop`: a 12-column grid of cards with gap 14 px.
  - Row 1: **header card** with the date, "Good evening, Tal" and **Customize**. Under them, a **status strip** of 3
    linked tiles (A6). Under that, a **stats row** of 4 cells (A2).
  - Then: **Nexus suggests** (A3), full width.
  - Then: **This week**, full width.
  - Then: **Needs you** (7 cols) next to **On the way** (5 cols).
  - Then: **Month pace** (5 cols) next to **Projects** (7 cols).
  - Last: **Nexus noticed** (A4), full width.
- Phone follows `home-v4/phone`, compact. The goal is ≤ 1,800 px of content at 390 px with demo-size data (v3 was
  2,440 px). Order and changes:
  - Order: greeting → one card holding the status tiles (3 columns) and the stats (2 × 2) → suggestion → This week
    → Needs you → On the way → **Money & projects** (pace + project rows merged into one card) → Nexus noticed.
  - This week shows a day strip with coloured dots, the next 3 events, and a "+N more" row that expands in place.
  - Needs you shows at most 3 rows on the phone (4 on desktop). "All" opens the alerts panel.
  - Nexus noticed shows one insight at a time with dots; swipe or tap the dots to change it.
- Section headers are small uppercase labels with an optional count and a quiet link at the end. No sparklines anywhere
  on Home: stats use meters (A2), and only the pace card has a chart.
- **Acceptance:** opening `/` shows Home on phone and desktop. A smoke test asserts the section order on both, and the
  phone page height is ≤ 1,800 px with the smoke demo data. No horizontal overflow at 360 px (extend the overflow
  smoke). The logo returns to Home from every view.

### A2. [x] One pure data module for Home (`src/lib/home.ts`) + unit tests
Put every number on Home in one pure function: `homeModel({ items, alerts, budget, storeSettings, rates, now, tz })`.
It must not call the network and must run in `scripts/test-home.ts` (`npm run test:home`). Definitions:
- **Status strip:**
  - "N things need you" = the count of the Needs-you queue below. It must be the same number as the queue badge
    (the v3 mockup showed 3 in one place and 4 in the other — never again).
  - "N packages this week" = ordered items with `eta` in the current week. The sub-line shows the next arrival day and
    the late count.
  - "₪X under/over your pace" = from `monthForecast` in `budget.ts`.
  - Hide a tile that has nothing to say, e.g. no budget set.
- **Stats (set A, Tal 2026-10-04):**
  1. *Left to buy:* the sum of active-source line totals of countable to-buy items, the item count, and the urgent
     count. A meter split by project (project colours) with a 3-entry legend; anything else goes in "Other".
  2. *Month budget:* spent this month of the cap, "₪X left · N days to go". The meter shows spent / cap, with a thin
     marker at today's position in the month. With no cap, show spent this month vs your usual month (−12 %).
  3. *On the way:* the count, the next arrival day and the late count, plus one pip per package (late = warn colour,
     due this week = info, later = faint).
  4. *Saved this year:* `drops + freeShipping`, with "+₪X this month" and a two-line breakdown.
     - *drops* = for items bought this year, the first recorded price of the bought source (`pricePoints`) minus the
       price paid, when positive.
     - *freeShipping* = the store's `shippingFee` for orders that crossed that store's `freeShippingMin`
       (`shipping.ts`), counted only when the fee is known.
     - Never invent savings. When both parts are 0, the cell shows "Track prices to start saving" instead of ₪0.
- **This week (Sun–Sat, user timezone; Monday-first if the locale says so):** the events are
  - arrivals (`eta`),
  - late packages (on today),
  - "time to reorder" (A2 cadence),
  - price-alert items whose drop is still open,
  - the budget week close (Saturday: "₪X left").

  At most 2 events per day on desktop; overflow becomes "+1".
- **Reorder cadence:** an item (or the same normalised name) bought ≥ 3 times gets an interval equal to the median
  gap between purchases. "Due" = last purchase + interval, within ±3 days. This is pure, with unit tests for 2 buys
  (no cadence), 3 buys and irregular buys.
- **Needs you queue,** ranked:
  1. unread `alerts` of kinds `drop`, `target` and `back_in_stock` (action: Buy now),
  2. late deliveries, "Did X arrive?" (action: Mark received → status received),
  3. a free-shipping gap ≤ 30 % of the threshold that an item already on the list closes (`gapSuggestions`; action:
     Add <item> to the same order),
  4. reorder due (action: Add to list).

  Each row: icon, title, one muted line, one action. Swipe/hover ✕ dismisses it for 7 days (kv key per row).
- **On the way:** ordered items sorted by eta (late first). Progress is the 4-segment track
  (Ordered · Shipped · In country · Delivered). We have no carrier stages, so the fill is
  `elapsed / (eta − orderedAt)` rounded to segments. Late fills all four in the warn colour. With no eta, show
  "No date" and one segment.
- **Pace:** this month's cumulative spend line, the usual-month line (median of the last 6 months, dashed) and a cap
  line. The sentence comes from `monthForecast`.
- **Projects:** per collection, % bought (by money), money left and the next item (most urgent, else cheapest).
  Show the top 3 by recent activity.
- **Acceptance:** `npm run test:home` covers every definition above, including the empty account, no budget, no
  eta, the cadence edge cases and RTL-independent output. The status count equals the queue length in every test.

### A3. [x] "Nexus suggests" — stands out, rules find, AI phrases
Tal wants it to "jump out a little" so good suggestions aren't missed, and to look AI.
- **Look** (mockup): a full-width card with a 1.5 px animated gradient border (AI purple → spark amber, slow 10 s
  sheen), a soft tinted inside, a 44 px gradient "orb" with the sparkle icon (gentle 3 s twinkle), an eyebrow
  "NEXUS SUGGESTS · 1 of 4", a 16 px title, a muted "why" line, and the actions **primary CTA · Not now ·
  ‹ dots ›**. On the phone it is compact (26 px orb, dots in the header). Keep motion subtle and respect
  `prefers-reduced-motion`.
- **Source = rules + AI phrasing (Tal: "ג", with a switch for later):**
  - `homeSuggestions(model)` returns ranked candidates with a stable `key`, `kind`, `facts` and a template `title`
    and `why`. Kinds:
    - an item ≥ 10 % under its usual price combined with a shipping gap ("order both"),
    - reorder due,
    - "wait for <day>" when the price history shows a weekly low,
    - a project with no budget vs similar projects.
  - At most 4 candidates.
  - **AI phrasing:** once a day per user, send only the facts to the existing AI chain (Gemini → Groq/OpenRouter
    fallback). Get back one short title + why per key and cache them in kv by `key + date`. Any failure, or no key,
    falls back to the template. Never block render on AI.
  - Add a setting **"AI-written suggestions"** (on by default) in Settings → Assistant. Off = templates only. This is
    the switch Tal wants for the multi-user version, where AI costs matter. Also add it to the command palette (C1).
- **Not now** snoozes that `key` for 7 days. The CTA runs the action (add to order / add to list / open item / set
  budget).
- **Acceptance:** unit tests for ranking and snooze. A smoke test with the AI mock shows the AI text, and with AI off
  shows the template. The pager works with the keyboard (←/→ while focused). Frame trace: the border sheen stays on
  the compositor (no layout per frame).

### A4. [x] "Nexus noticed" — 3 short, true insights
Rules only (no AI needed), from `homeModel`:
- shipping saved by batching this month,
- the cheapest weekday for a category you track (needs ≥ 8 price points),
- a project with no budget vs your similar projects.

Each insight has one link-action. Show it only when its facts exist, and hide the whole section when none do.
Desktop: 3 columns. Phone: one insight at a time.

### A5. [x] Customize (Tal: in this round)
**Customize** switches Home into edit mode. Each section gets a handle and an eye toggle.
- Desktop: drag to reorder.
- Phone: ↑/↓ buttons on each section.

**Done** saves the order to the user's UI prefs (same place as layout/sort, owner-aware), and **Reset** restores the
default. The header card is fixed; everything else can move or hide. Keep it simple: no presets and no resizing.
**Acceptance:** a smoke test hides "Nexus noticed", moves "Projects" up, reloads, and checks the order persisted on
desktop and phone.

### A6. [x] Status strip tiles are links
Each tile (icon chip + bold line + muted line + chevron) scrolls smoothly to its section and briefly highlights it
(a 600 ms outline fade):
- need you → Needs you,
- packages → On the way,
- pace → Month pace.

The tile colours match the section (warn / info / ok). On the phone the tiles show a big number + a 2-line label
(mockup). **Acceptance:** a smoke test clicks each tile and checks the target section is in view.

### A7. [x] Empty and new-user states (prepares the multi-user work)
With no items: Home shows the greeting, a short "Start by adding something" line, and the 3–4 big add actions from the
phone + menu (paste a link, scan a barcode, scan a receipt, plan with Nexus). Other sections are hidden, not zero-filled.
With some data, each section shows itself only when it has content. **Acceptance:** a smoke test on a fresh DB.

---

## Part B — Phone "Shopping" tab: To buy ⇄ On the way

### B1. [x] Dock: Home · Shopping · + · Projects · Insights
Tal approved (2026-10-04). Changes to the `DOCK` in `phone-shell.tsx`:
- **Home** (house icon) first.
- **Shopping** (`he`: **קניות**, shopping-bag icon) replaces both To buy and On the way. It opens the last sub-tab
  used (default To buy).
- Projects and Insights stay as they are.

The dock order is physically left→right in every language, as today. Badges: Shopping shows the urgent count. Update
help (`nexus-help.md`) and the assistant's navigation actions.

### B2. [x] The switch — seamless and a bit playful
The top of the Shopping tab is two big segmented cards: **To buy** (count, "₪X · N urgent") and **On the way**
(count, "Next Tue · 1 late").
- A white "thumb" slides between them with a soft spring (~450 ms, slight overshoot).
- The active card's icon chip takes its colour (warn for To buy, info for On the way), and the inactive one turns
  muted.
- Content transition is direction-aware: going to On the way, the new list slides in from the end side (36 px) and
  fades. Going back, it comes from the start side. Mirror this in Hebrew.
- Rows/cards enter with a 40 ms stagger, with no stagger beyond the first 8.
- Under the switch, a toolbar: sort (By project / By arrival), a muted summary, and the **list ⇄ grid** toggle (B3).
- **Acceptance:** a frame trace of a switch shows no dropped frames on a mid phone profile and no layout shift of the
  dock. A smoke test switches both ways in en + he and asserts the URL/view and the thumb position.

### B3. [x] List and grid in both sub-tabs (Tal: list by default, remember the last choice)
Reuse `phoneLayout` (`rows` = list, `cards` = grid). Change the default to `rows`, keep it persisted, and give the
toggle a sliding thumb.
- **List, To buy:** grouped by project. Each group header has a dot, name, "N items" and a thin %-bought bar. Rows:
  42 px picture, name, store, Urgent pill, price.
- **List, On the way:** rows with picture, name, store · price, the 4-segment track with tiny stage labels, and an
  ETA pill (info, or warn when late).
- **Grid (both):** 2 columns. The card has a 4:3 picture on paper, a project pill bottom-start, an Urgent or ETA pill
  top-start, the name (2 lines), the store, and the price (To buy) or the track (On the way).
- Switching list ⇄ grid uses a quick scale/fade (0.96 → 1) with the same stagger.
- Existing swipe, long-press and selection behaviour must keep working in both modes.
- **Acceptance:** smoke for each mode × each sub-tab at 360 and 390 px, with no overflow.

### B4. [x] One delivery-track component
The same 4-segment track (A2 rules) is used on Home, in the On the way list, on the On the way cards and in the item
sheet. One component, one function, unit-tested in `test:home`.

---

## Part C — Search and navigation

### C1. [ ] One search on the phone that also finds settings (Tal asked: "can I search settings on the phone?")
Today the phone search (the `searching` state in `phone-shell.tsx`) only filters items via `s.setQuery`, while
settings and actions exist only in the desktop command palette (`command-palette.tsx`).
- Move the palette's commands into a shared list (e.g. `src/lib/commands.ts` + a hook) used by both.
- On the phone, typing shows grouped results: **Settings & actions** first when they match. Inline controls work in
  place (theme Light/Dark/System segmented, palette swatches, currency), and "Open all settings" is a row. Then
  **Items** (picture, name, project · store · price), **Projects**, **Stores**, and finally **Ask Nexus about "…"**.
- Empty query: recent searches + 4 quick actions.
- Word-aware matching as in the palette, in en + he.
- The desktop search placeholder becomes "Search items, projects, settings…", with the hint `Ctrl K`.
- **Acceptance:** a smoke test on the phone types "dark", toggles the theme from the result, and checks the theme
  changed. Typing "חשמל" (he) finds the matching items.

### C2. [ ] Desktop sidebar: collapse button at the top + drag the edge
A collapsed rail already exists (`sidebarCollapsed`, 76 px). Tal wants:
- **Button at the top:** a panel icon next to the logo. In the rail it sits under the logo, and it rotates 180° when
  collapsed.
- **Drag the border:** a 9 px hit area on the sidebar's end edge. A grip pill shows on hover. Dragging toward the
  content collapses it and dragging back expands it; the width follows the finger/mouse between 76 and 248 px. On
  release it snaps to the nearer state (threshold 40 % of the way), with a 400 ms ease. Double-click on the edge
  toggles. Cursor `col-resize`. In Hebrew the edge is on the left, and the drag mirrors.
- The grid animates `grid-template-columns` smoothly, and labels fade (no text reflow jumping). The state persists,
  as today. A keyboard shortcut `Ctrl+B` toggles, and the grip has `aria-label` + Enter/Space.
- **Acceptance:** a smoke test drags the edge 120 px and checks it collapsed, reloads and checks it persisted, then
  presses `Ctrl+B` and checks it expanded. Frame trace of the drag.

---

## Part D — New opening animation (3.0 s)

### D1. [ ] Replace the boot intro with the v4 sequence
Tal rejected the chip/tagline version. Keep the text to the wordmark only and the motion to real visuals. Build it from
`home-v4/intro.dc.html` into `boot-screen.tsx` + `globals.css` (pure SVG + CSS in the initial HTML, as today; keep the
`full`/`small` modes and `markBooted`/`aimAtLogo`). Timeline (seconds from start):

| t | What happens |
|---|---|
| 0–0.9 | The palette field blooms from the centre; the isometric cube grid scales in (radial mask) and drifts |
| 0.0–0.8 | 8 outline cubes spin in from around the screen and are swallowed by the centre |
| 0.15–0.85 | The three Box faces fly in (left, right, top, staggered 80 ms) and assemble with a spring |
| 0.78–1.33 | The spark dot drops onto the top face and bounces; the box squashes slightly on impact (~0.98) |
| 1.0–1.9 | Impact: 2 expanding rings (amber, orange) + 14 particles in logo colours burst outward and fade; the field flashes slightly |
| 1.2–1.75 | A light sweep crosses the box |
| 1.25–1.7 | The letters of **Nexus** rise one by one (60 ms stagger) |
| 1.3–2.5 | **Hold — readable.** The centre (box + word) is still; the background keeps moving: grid drifts faster, the bloom breathes and rotates, 5 outline cubes wander, small dots orbit in two opposite rings |
| 2.5–2.95 | Exit: the box flies into the top-bar logo (phone) / sidebar logo (desktop), the field and ambient motion fade, and Home's cards rise in with a 60 ms stagger |

- **Total = 3.0 s**, played to the end (no skip — Tal's choice). Update `SEQUENCE_MS` and the comments.
- When it plays:
  - **Phone/PWA:** on app open (the existing `full` mode).
  - **Desktop:** the first open of the day (a local date key in `localStorage`; wrap it in try/catch). Today the boot
    is phone-only by CSS, so enable it on desktop for this case. Reloads and later loads use the small loader, as
    today.
- `prefers-reduced-motion`: a 600 ms fade of the assembled mark + word only.
- Performance: transform/opacity only. The mockup blurs the letters; use blur only if the phone frame trace stays
  clean, otherwise drop it. The ambient layer must not cause layout.
- **Acceptance:** a frame trace on the phone profile with ≤ 2 dropped frames over 3 s. A smoke test checks that boot
  ends at ≥ 2,950 ms on a full open and that the desktop plays once per day (second load = small loader).

---

## Part E — Look

### E1. [x] Clearer borders (Tal: "more visible, more professional"; chose the medium strength)
Add tokens and use them on Home and Shopping cards. Check other surfaces for consistency, but don't restyle them:
- light: `--line` ≈ `#dcdcd7`, an inner separator `--line-in` ≈ `#e8e8e4`;
- dark: `#313131` / `#262626`;
- Plum light/dark: the same lightness steps in its hue.

Cards: 1 px `--line`, radius 12 px, a very light shadow in light mode and none in dark. Inner rows are separated by
`--line-in`. **Acceptance:** `npm run test:contrast` is extended so the border vs surface reaches ≥ 1.25:1 in all 4
themes.

### E2. [ ] Keep the house rules
The Ask button is always a fully rounded pill (the v3 desktop mockup had 8 px — wrong). One brand colour + neutrals.
The spark/AI colours are used only on AI surfaces (Nexus suggests / noticed / Ask). Font Heebo.

---

## Not in this round
- "Buy by" date on items (Tal: no).
- Home presets, resizing sections, Hebrew-first copywriting pass (later).
- Multi-user / sign-up / onboarding (planned for Round 15, after a bug-fix Round 14).

## Open
