# Round 18 — Session 5: list v2, start-trip look, floating Ask, Home widgets v2, monthly spending, onboarding v2

Source: Tal's asks after S3/S4 (`docs/R18-S3-NOTES.md` groups B + C + "After S3", `docs/PLANNER.md` handoff) and his
review of the S5 boards (2026-10-16, all approved). Boards: **`docs/design/r18-s5/`** (+ `nx-s5.css`, self-contained
tokens) — `List-phone`, `List-desktop`, `StartTrip-phone`, `Ask-fab-phone`, `Ask-variants-phone` (history: the six
directions Tal chose from), **`Ask-final-phone`** (the look to build), `Home-widgets-phone`, `Home-widgets-desktop`,
`Widgets-catalog`, `Spending-month-phone`, `Spending-month-desktop`, `Onboarding-v2-phone`. Every board has tweaks
(he / en, dark, Plum, reduced motion, states) — check each state you build against it. S4 already shipped (don't
redo): merge-into-quantity adds (A1), add feedback (A2), "+" = camera, scanner, photo, voice, rename on the name's
letters (D1), swipe-delete motion (D2), floating "Start shopping" (D3), fixed start screen (E1), store-mode fixes, trip
history cards (F2), usual brands (F3). Where this brief and an older decision disagree, **this brief wins**.
Results go to **"## Open" at the end of this file**. Tal runs it unattended.

## How to run (Session 5)
- **Step 0 — boards + planning docs + S4 check.**
  1. Tal unzipped `nexus-r18-s5.zip` at the repo root: `docs/design/r18-s5/` (12 boards + `nx-s5.css` + `canvas.json`)
     and `r18-s5-planning.patch`. On `main`: `git apply -3 r18-s5-planning.patch` (adds the S5 decisions + log line to
     `docs/PLANNER.md` and the planning-chat line to `docs/ENVIRONMENT.md`; on a conflict keep both sides' lines),
     delete the patch file, commit `R18.S5.0: S5 boards + planning docs (from the planning chat)`, push `main`.
     (The planning chat can't `git push`, and the GitHub connector needs whole files — too big for these two docs.)
  2. S4: `main` has its merge + the smoke follow-up (`d4bdeb0`). Check `guards` on `main` and the last prod smoke are
     green; if `round18-s4` has commits not on `main`, finish them with S4's rules first.
  3. Branch **`round18-s5`** from `main`.
- **Commit and push after every single item** (`R18.S5.<part><k>: …`, `git push origin round18-s5`); tick `[x]` here +
  one line in "### Progress" in the same commit; decisions in "### Decisions" at once; anything for Tal in
  "### For Tal".
- **Resuming:** `git fetch`, check out `round18-s5`, read Progress + `git log`, continue from the first unticked item.
- Unattended; never stop to ask — take the reading closest to the board + this brief, write it in Decisions.
- Read open reports and the error log first. Bugs with an unknown cause: reproduce first (failing test / smoke step).
- DB additive only; if the DB changes, rehearsal on a copy of a fresh prod snapshot before merging. Merge `--ff-only`
  only when all items are ticked, one full CI run on the final commit finished green (don't push on top of it while it
  runs), then watch `guards` on `main` + prod smoke after deploy (re-run once if flaky; twice → fix).
- Rules from S1–S4: i18n he + en, `useDevice()` / `phone:` / `desk:`, phone test contexts with mobile UA, no `ad-*`,
  `SEARCH_OFF=1`, logical RTL utilities. Visible items: phone 360/390 + desktop 1366, light + dark, Graphite + Plum,
  he + en, worst case, reduced motion, a smoke step each. Motion + touch bar: `.claude/skills/` (emil-design-eng,
  apple-design, mobile-native, animate) + the tokens at the top of `nx-s5.css` (`--ease-out`, `--ease-drawer`,
  `--spring`); press = scale .94–.97 on pointer-down; hover only under `(hover:hover) and (pointer:fine)`.
- The boards are reference, not code to paste: build with the app's components / Tailwind tokens; `nx-s5.css` tells
  you sizes, radii, colours and timings. Section colours are R18's (`k-*`); widget accents are listed in `nx-s5.css`.

## Part A — the list, v2 (boards `List-phone`, `List-desktop`)
### A1 [ ] One list, compact rows
One card for the whole list; sections are slim sticky bands inside it (colour dot, name, count; `position: sticky` —
the card uses `overflow: clip`, not `hidden`). Row = 60 px: picture tile 44 (R18 art on the section tint), name 15.5
bold, a second line only when there's a usual brand and/or a note ("Tnuva · Blue cap"), the quantity chip at the end
("6 · ~1 kg" = count + estimated weight from the unit weight, S3 B7 / S4 A1 rules; "×2" for units), a small dot in the
colour of who added it (tooltip / label "Added by …"). Store row on top (chain badge, branch, chevron → change store),
summary line (items · estimate · month left bar), the add field with voice + camera (S4). Worst case: long names and
notes truncate on one line; the sheet shows them in full.
### A2 [ ] Swipe both ways, with Undo
Horizontal drag on a row (8 px slop; a mostly vertical move is a scroll and never opens a row). Pulling the row
**toward the start edge** reveals Delete at the end: release past 56 px → stays open with the red Delete button;
past ~170 px or a fast fling → deletes (S4 D2 slide-out + collapse, Undo toast). Pulling **toward the end edge**
reveals the quantity stepper (− count +) at the start: past 56 px it stays open; − / + change the amount with S4 A1's
merge rules. Rubber-band past the limits, one row open at a time, tapping elsewhere closes it, snap = 380 ms drawer
ease. In Hebrew everything mirrors (the board does it with one sign flip). First time only (per user pref): the first
row peeks once and a hint line names both directions. Smoke: drag both ways, fling, Undo.
### A3 [ ] Rename inline, tile → item sheet
Tap the name's letters (S4 D1) → an inline field in the row (16 px, Enter / blur saves, Esc cancels, empty = no
change), then a short green pulse on the row. Tap the picture tile → the item sheet: big tile, name, section chip,
usual brand chip (S4 F3), stepper with the weight line ("Weight follows the count"), note field, Done / Delete,
"Don't suggest this again".
### A4 [ ] Computer list
`List-desktop`: the list panel (add field accepts a pasted list) with hover / focus-within row actions (−, quantity,
+, delete), click the name to rename; right column: this list's estimate + section split bar + month left, Nexus
suggests (Add all), Templates (stacked pictures, Add). Undo toast centred at the bottom. Keyboard: every action
reachable by Tab; Delete key on a focused row deletes (with Undo).

## Part B — start-shopping screen (board `StartTrip-phone`)
### B1 [ ] The screen
Keeps S4 E1 (fixed, no scroll). Background = the chosen colour (B2) with the soft light sweep once on open (2.4 s,
ease-out; reduced motion: none) and the faint dot grain; top: close (back to the list), look button (B2), store chip
(change store), "offline" chip when offline. Day + time, title, three glass stats (items, estimate, minutes — from
this household's past trips at this store, "~" prefix; hidden before 2 trips), the route card (aisle bar + first five
sections in this branch's learned order with counts, "+ N more"; first trip at a branch says the order is the usual
one and will be learned), who gets told ("Noa and Yoav will see you're shopping" — the members who get the trip
notification), big "Let's go" → the hand-off to store mode: content scales/blurs out (420 ms) and store mode's header
starts in the same colour with the same aisle bar.
### B2 [ ] The person picks the look
Look button → sheet "Screen look": **Auto** (the store's colour, default) + 8 colours (red, orange, green, teal, blue,
purple, pink, ink), style **Vivid / Soft / Night** (board classes `.trip`, `.trip.soft`, `.trip.night`), "Only for this
store" (default on). Saved per user: `pref:tripLook:<storeId>` or `pref:tripLook` for all stores; store mode's header
uses the same colour. Text on the colour must reach 4.5:1 — darken the colour automatically when it doesn't (check in
a unit test over all colours × light / dark). Dark mode + Vivid darkens the colour (board: 62 % mixed with black).

## Part C — floating Ask, phone + computer (boards `Ask-final-phone`, `Ask-fab-phone`; computer on `List-desktop`, `Home-widgets-desktop`, `Spending-month-desktop`)
### C1 [ ] The look (Tal chose B + C)
`Ask-final-phone` + the `.ask` FINAL block at the end of `nx-s5.css`: an **ink orb** (radial top light, inner depth,
faint amber glow; Plum = plum orb; dark = graphite orb) with a **2 px AI ring** around it (1.5–2 px gap; conic
violet → amber → orange → pink → violet), muted at rest. Glyph: the sparkle in spark + a small white star. Full circle
(CLAUDE.md): 56–58 px phone, 60 px computer. States: rest; pressed (scale .94); **message** (ring full colour turning
once per 5 s, amber dot, one 6 px hop, bubble with the message for 6 s, tapping the bubble opens the chat); **thinking**
(ring turns every 1.4 s, the star breathes — while an assistant request runs in the background); dragging (lifts 1.08,
ring full). Reduced motion: no turning, no hop, the ring just brightens.
### C2 [ ] Phone behaviour
Default on the **physical right** side in both languages, 12 px above the dock (bottom = dock + 12), on every main tab
(Home, Products, Supermarket, Insights). Horizontal drag (6 px slop) moves it; release → the nearest side (or the
fling's direction), 420 ms `--spring`; the side is remembered per device + user. Rises with anything that appears
above the dock — the Undo / added toasts (S4 A2), the floating "Start shopping" bar shares the row and ends before it
(S4 D3 adjusts) — 340 ms drawer ease, and comes back down after. Hidden: store mode, Home edit mode, camera, any open
sheet / dialog, while the keyboard is open. Tap → the chat opens **from the button** (circle reveal from its centre,
380 ms; reduced motion: fade) as an overlay; closing returns to the same screen and scroll position (no navigation).
The phone top bars lose their Ask button. Messages come from what Nexus already surfaces (assistant notices,
suggestions) — at most one bubble per message, never during a trip.
### C3 [ ] Computer behaviour
The same orb at 60 px in the bottom corner of the content area (24–28 px from the edges, never over the sidebar),
right by default, draggable to the other corner and remembered. Opens the existing assistant panel from that side.
The top-bar Ask pill goes; the command palette keeps "Ask Nexus".

## Part D — Home widgets v2 (boards `Home-widgets-phone`, `Home-widgets-desktop`, `Widgets-catalog`)
### D1 [ ] The card look for every widget
Samsung-Health-like cards: radius 26, padding 14 / 16, a 28 px round icon chip and one accent colour per widget for its
visual only (ring, bars, icon) — text stays ink; big numbers 30–38 tabular. Sizes: small (1 cell) and wide (2 cells).
Grid: phone 2 columns (cells ~178 px square), computer 4 columns (~259 × 196), dense packing (a small card fills the
first hole). Every existing widget (R16 E2 list in `lib/home-layout.ts`) gets the new shell with its current data.
### D2 [ ] Long-press edit: drag, swap, remove, size, add
Long-press a card 450 ms without moving (10 px slop; moving earlier = scroll) → edit mode starts **with that card
already lifted under the finger** (haptic where available). While dragging, the card follows the pointer; when its
centre is over another card they **swap places** (debounce 220 ms), the rest glide to their new slots (300 ms drawer
ease). In edit mode: an outline on every card, "−" removes (scale out 200 ms, then repack), a size chip toggles
small / wide where the widget allows both, top bar "Add widget" (phone: bottom sheet; computer: dialog) lists the
widgets not on Home (NEW badge on new ones; tap adds it at the top with a short highlight), "Done". Also an Edit
(pencil) button on Home for keyboard / screen readers: arrow keys move the focused card, Delete removes. No wiggle.
The floating Ask hides in edit mode. Layout is saved per space through `lib/home-layout.ts` (add the size; additive,
old layouts read as their current sizes).
### D3 [ ] Shopping widgets — only the ones that give value (Tal)
- **Next shop** (wide default; small allowed): store, day ("Today"), items · estimate, picture stack, "Start" → the
  start screen (B1). **Live state** while another member's trip is running: "Noa is shopping now", store · "9 of 24",
  progress bar, "Add for her" → adds into the list she's shopping (she sees it live, S2 sync).
- **Due soon** (wide default): the top 3 staples due (S2 cadence) with "+" each; small: the count + "Add all".
- **Budget** (small default): ring % used, amount of the budget, wide shows the supermarket vs products split; tap →
  Monthly spending (E1).
- **Not built** (dropped by Tal): supermarket month bars, last shop, shopping rhythm, templates widget.
- Presets: Minimal and Household start with Next shop, Budget, Due soon + their current widgets.

## Part E — Monthly spending (boards `Spending-month-phone`, `Spending-month-desktop`)
### E1 [ ] Insights → Spending
Month switcher (no future months). Hero: spent this month, "of ₪X · ₪Y left for N days" (closed month: "₪Z over / under
the budget"), a delta chip (in progress: vs the same day last month; closed: vs last month). Cumulative spending chart
(SVG): the line + area, a dashed budget line, a dotted pace line, today's dot; the time axis runs left → right in both
languages. Split bar + legend: Supermarket / Products / Delivery & other. The month starts on the budget's start day
(F5; default the 1st).
### E2 [ ] Breakdowns
Phone: a three-way segment — **Sections** (supermarket spending by R18 section, sorted, a bar each, change vs last
month; tap expands the top items), **Stores** (chain badge colour, amount, number of trips, share bar), **Products**
(non-supermarket purchases with date / source). Computer: all of them at once (two columns). Last card: "Against last
month" (supermarket, products, average shop). Space-level (all members), the space's currency. States: first month
(not enough data → what will appear), no budget set (no budget line; "Set a budget" link), offline (cached).

## Part F — Onboarding v2 (board `Onboarding-v2-phone`; computer = the R17 desktop onboarding layout with these steps)
### F1 [ ] Nine steps
1 why · **2 your home** · 3 stores (S2 F2, unchanged) · **4 how you shop** · **5 food at home** · **6 budget** ·
7 install · 8 notifications · 9 done. Progress bar of 9; every step skippable; "Every answer can be changed later
where it acts." `lib/onboarding.ts`: STEPS = 9, new fields (additive; old saved answers keep working). People who
already finished onboarding aren't sent back: a dismissible Home card "3 quick questions so Nexus fits your home"
opens steps 2, 4, 5, 6 once.
### F2 [ ] Your home
Who you shop for (just me / couple / family — drives today's step-4 shared-space behaviour) + steppers: adults (≥ 1),
kids, babies, pets; the picture above adds figures as you count. Used for: starter basket amounts and estimates,
babies → diapers / formula in suggestions, pets → pet food.
### F3 [ ] How you shop
How often (once a week / twice a week / every few days / every two weeks), usual days (multi), in the store / online
delivery / both. Used for: the evening-before list reminder and draft (S2 cadence), Due soon timing, Next shop's day.
### F4 [ ] Food at home
Chips (multi): kosher, mehadrin, vegetarian, vegan, gluten-free, lactose-free, nut allergy, organic when possible;
toggle "Shabbat and holidays at home". Used for: suggestions never propose what contradicts the choices (vegan → no
meat / dairy / eggs; gluten-free, lactose-free, nut allergy → flagged items off; kosher → noted on the space, filter
only where product data has it); Shabbat → a Friday-morning nudge (challah, wine — from this home's history first);
holidays → a nudge a few days before (static table of Israeli holiday dates in code).
### F5 [ ] Budget
Household budget per month + currency; "of it, supermarket" slider (starting point from the home's size — a small
table in code, labelled as a starting point); the month starts on 1 / 10 / 15 / another day; "Not sure yet — learn it
from my first month" (no budget until the first month closes, then Nexus proposes one on Home). Alerts at 80 % and
100 % (notification + the Budget widget turns warn). Saved to the space budget (S1 money) + the new fields.
### F6 [ ] Edit later
Settings: new **Household** section (people, food choices), **Supermarket** (habits: how often, days, store / online),
Space → **Budget** (supermarket share, start day, alerts, "learn from my first month"). Each change takes effect at
once (suggestions, reminders, Spending's month).

## Part G — guards and docs
### G1 [ ] Guards
Smoke steps for every item (phone + desktop): row swipe both ways + Undo, inline rename, look picker persistence,
Ask drag + rise over a toast + open / close keeping scroll, Home long-press drag-swap / remove / add / size, Spending
month switch, onboarding new steps + the Home card. Unit: home-layout packing (dense, swap, sizes, old layouts),
trip-look contrast over all colours, onboarding field parsing, spending aggregation (month start day, members,
currency), diet filter for suggestions. Full phone + desktop smoke pass; `scripts/parity-r18.mjs` gets the S5 boards.
### G2 [ ] Docs
`SPEC.md` R18 S5 section, `CLAUDE.md` map (floating Ask, widget edit, spending, onboarding fields), help topics (Home
widgets, Supermarket list swipes, Insights → Spending, Settings → Household), `docs/ENVIRONMENT.md` log line, "### For
Tal" = a phone checklist (swipes, long-press on Home, the Ask button drag, the look picker, the new onboarding steps).

## Open
### Progress
### Decisions
### For Tal
