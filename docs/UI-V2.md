# UI v2 plan — "amateur+ → professional" (planned in chat; NOT a Claude Code brief yet)

Starts after Round 6. The brief for Claude Code (`docs/ROUND7.md`) will be written once the design is approved.

## Process
1. **Inspiration** — Tal collects 3–5 screens he likes (Mobbin or any app), for: home/grid, item details, order/checkout
   style lists, loading/empty states, mobile nav.
2. **Design System** (Claude Design System artifact, built in chat from `globals.css`): tokens for both themes,
   type scale, spacing, radius, elevation, **motion tokens**, components with live previews. Becomes the reference
   Claude Code implements against (linked from CLAUDE.md).
3. **Mockups** (Claude Design canvas): home, item sheet, order by store, spending, assistant, mobile — 2–3 directions,
   Tal picks and iterates. Motion is described per screen (see below).
4. **Implementation** in Claude Code, with the `frontend-design` plugin installed and a CLAUDE.md rule:
   implement from the design system + mockup, no one-off values.
5. **Visual regression**: screenshot baselines (seeded data, fixed clock, animations frozen) compared on every smoke
   run, so later rounds can't silently break the look. Baselines are refreshed deliberately after v2 ships.

Figma: not used (free Starter plan allows ~20 MCP calls a month; useful only for hand-designing).

## Motion plan (goes into the design system as tokens + rules)
Principles: every animation explains *where something went or came from*; fast (120–320 ms), spring-based and
interruptible; transform/opacity only (60 fps on phones); one set of motion tokens; `prefers-reduced-motion` →
fades only.

Moments to design:
- **Card → item sheet**: the card's image and title morph into the sheet (shared element; View Transitions API or
  Motion `layoutId`), and back on close.
- **Lists that move**: sorting, filtering, search, status changes → items glide to their new place (layout
  animation) instead of jumping; removed items collapse, added items grow in.
- **Move to a project**: the card shrinks and flies to the project in the sidebar (mobile: to the nav), the project's
  count bumps.
- **Status changes**: To buy → Ordered → Received with a small morphing icon (cart → truck → check) and a tint sweep
  on the card.
- **Numbers**: totals, budgets, "₪ left for free shipping" roll to the new value (number ticker); progress bars ease.
- **Micro-interactions**: checkbox/selection, priority, qty stepper, toggles — tactile press states, spring on release.
- **Views**: directional slide + fade between sections (sidebar order decides direction).
- **Phone gestures**: swipe a card/row to mark ordered or open actions, pull to refresh, sheets that follow the
  finger and snap.
- **Assistant**: answer streams in word by word; action cards unfold; "Apply" ripples into the affected items.
- **Celebrations (rare)**: project fully purchased → one short, tasteful burst on the project header.
- **Hover (desktop)**: subtle lift + shadow on cards, image slight zoom.

## Direction so far (chat, 2026-10-01)
- Tal likes: Blink (heyblink.com) roundness and boldness, E "Color studio", F "Depth", J's phone floating dock.
  Too close to Blink / too loud → colors must be calmer and ours (teal brand).
- Round 3 on the design canvas ("Nexus Style Directions", page "Round 3"): K Sage wallet, L Midnight teal,
  M Pastel studio, N Gallery + phones + a feature-patterns board.
- Patterns from the research: bento summary (big "left to buy" tile + small tiles), projects as a wallet stack with
  budget rings (Apple Wallet, Monzo pots), store logos on cards (Monzo merchants), per-project colour (Copilot
  categories), floating dock with a centre + menu (Things' Magic Plus), swipe a row to mark ordered (Things,
  Robinhood), card → sheet morph (Things, Airbnb 2025), price-drop sparkline on the card, one celebration when a
  project is fully bought (Robinhood). Fonts with Hebrew: Fredoka, Rubik, Heebo, Varela Round, Assistant.

## Decisions (chat, 2026-10-01, later)
- Layout: design **U** (round 5) — floating rounded sidebar (collapsible to icons; the paste capsule re-centres with
  it), top bar = search (hint "Esc · all actions"; **Esc** opens the command menu, not Ctrl K) + "Ask Nexus" with a
  little colour + alerts. Totals card + two tiles. Project chips + **Category** and **Sort** dropdowns.
- Too many colours / unclear theme → **one brand colour** + neutrals; a second "spark" colour only for the AI.
  Project colours = small muted dots only. Product tiles neutral. Light **and** dark palettes required.
- Product cards: no store letters; show a **category** tag from a short fixed list (Electronics, Mechanical,
  Materials, Tools, Home, Office, Clothing, Other). Store as text in the meta line.
- Phone: U phone. Dock = To buy · Projects · **+** · On the way · Stats (Order by store moves out of the dock).
  **+** opens an animated menu: scan barcode, scan receipt, paste link, plan with Nexus; closes on + or outside.
  Top bar: logo, search, Ask (coloured), alerts.
- Animations everywhere (tasteful): see Motion plan above.
- Round 6 on the canvas: 5 palettes × light/dark × desktop/phone (interactive collapse and + menu).
- Features wanted next: receipt pipeline upgrade (scanic, preprocessing, unpdf, medium resolution, deterministic
  checks, multi-shot long receipts, live camera auto-capture), product images for receipt items (match → extension
  search → optional image-search key → Fluent emoji icon), review screen with cards split "already in list" /
  "new", barcode scan, shopping mode (full new UI), cross-store comparison (any store, not a fixed list), import-tax
  alert, assistant redesign (streaming, styled message, phone full screen / desktop side panel).
  Later: parts inventory, monthly "wrapped". Not wanted: SolidWorks BOM import, item files, event wishlists.
