# Round 7 brief (from Tal, 2026-10-01) — UI v2 + receipts v2 + barcode + shopping mode + compare — source of truth

This is one long **unattended** run. Read "How to run" first, then do the parts in order. Each part is a set of numbered
items; tick `[x]` as each ships. Design was decided in chat over 7 rounds on a canvas; everything needed is in this file
and in `docs/design/*.html` (static visual references — open them with Playwright at the right viewport and look).
`docs/UI-V2.md` has the motion plan and the decision history (context only; this brief wins on conflicts).

## How to run (unattended)
- Work on branch **`round7`** (create from `main`). Commit per item (`R7.<part><n>: …`), push the branch after every
  part (Vercel makes a preview). `main` is untouched until the very end.
- Never stop to ask. Pick the most reasonable option, write it under "## Open" at the end of this file, continue.
  Blocked (missing key, paid service, destructive or irreversible step) → skip that bit, note it in Open, continue.
- Plan mode approval is not needed; for big items write a ≤10-line plan in your reply and go.
- Per item: implement → `npm run -s check` → unit test if logic → `npm run smoke` (+ `SMOKE_MOBILE=1`, and
  `SMOKE_WRITE=1` with `NEXUS_AI_MOCK=1` for write paths). Extend `scripts/smoke.mjs` for new screens.
  Look at a screenshot yourself for every visual item, desktop 1366 and phone 390, light and dark, both palettes for
  shell/home. Compare with the matching `docs/design/*.html`.
- Delegate well-specified sub-tasks to the `implementer` subagent; review its diff. `/compact` between parts.
- Every new AI path has a mock (`NEXUS_AI_MOCK=1`). Every new UI string in `en.ts` + `he.ts`. RTL: logical utilities only.
- Keys are optional everywhere: features must work (in a reduced way) without `BRAVE_SEARCH_API_KEY` / `SERPER_API_KEY`.
- **End of run**: all checks green → update SPEC.md (edit a "Round 7" section, don't duplicate), summary at the top of
  Open, `git checkout main && git merge --ff-only round7` (rebase round7 on main first if needed), push main. If
  anything is red, do NOT merge: push the branch and say why in Open. Do not touch power settings.

---

## Part A — design system, themes, logo (foundation for everything else)

### A1. [x] Tokens for two palettes × light/dark + theme switcher
Replace the current palette in `src/app/globals.css` with these tokens (names may follow the existing token names;
keep a semantic layer: components never use raw hex). Palette is chosen with `data-palette="graphite|plum"` on
`<html>` (cookie, read on the server like the currency pref → no flash); mode stays next-themes (light/dark/system).
**Default: Graphite, system mode.** Settings + command palette: "Palette: Graphite & Amber / Plum", "Theme: Light /
Dark / System". Instant switch, no reload.

| token | Graphite light | Graphite dark | Plum light | Plum dark |
|---|---|---|---|---|
| bg | #f6f6f5 | #0b0b0b | #f8f6fc | #100b1a |
| surface | #ffffff | #151515 | #ffffff | #19122a |
| surface-2 | #efefed | #1c1c1c | #f3eefb | #211836 |
| ink (text) | #171717 | #f2f2f0 | #1d1233 | #f1ecfb |
| muted | #6b6b6b | #9b9b98 | #6e6487 | #a497bf |
| line | #e6e6e3 | #262626 | #ebe5f5 | #2c2244 |
| brand (primary buttons, active nav, logo pill) | #171717 | #f2f2f0 | #7c4dff | #a78bfa |
| on-brand | #ffffff | #0b0b0b | #ffffff | #100b1a |
| hero (totals card) | linear-gradient(140deg,#171717,#262626 60%,#3a3a3a) | linear-gradient(140deg,#1f1f1f,#2a2a2a 60%,#3a3a3a) | linear-gradient(140deg,#2e1065,#4c1d95 60%,#6d3ae0) | linear-gradient(140deg,#3b1580,#5b28c0 70%,#7c4dff) |
| tint (soft highlight bg) | #fdf2dc | rgba(245,158,11,.13) | #f0e9ff | rgba(167,139,250,.15) |
| tint-ink | #9a5b00 | #fcd34d | #5b2fd1 | #d4c4ff |
| spark (AI + unread dot only) | #f59e0b | #f59e0b | #fb7a3c | #fb923c |
| project dots 1/2/3 | #8a96b8 #c9976a #7da592 | #a9b4d6 #e3b48a #9cc9b4 | #8a93cf #d39a6b #7eae95 | #b0b8f0 #e8b48a #9fd1b6 |

Rules: one brand colour + neutrals; spark appears only on the AI button outline/icon and the unread dot; project
colours only as small dots/bars (user-picked collection colours map onto a muted per-theme set — extend the set to
8 muted hues in the same lightness band). Product image tiles are neutral (surface-2). Success/warning/danger stay
semantic and separate. Check text contrast ≥ 4.5:1 in all four themes (add a tiny script `scripts/contrast.mjs`).
Font: Heebo (Hebrew + Latin) 400–900 via next/font, replacing Rubik; numbers `tabular-nums`. Radius scale: 999 pills,
30 big cards, 26 cards, 21 image tiles, 16 small. Motion tokens: `--ease-out: cubic-bezier(.2,.8,.2,1)`,
`--ease-spring: cubic-bezier(.2,1.4,.4,1)`, durations 120/200/320/450 ms.

### A2. [x] New logo "Box" everywhere
Mark (viewBox 0 0 64 64): top face `M32 8 54 20 32 32 10 20z` (c3), left face `M10 20l22 12v24L10 44z` (c1), right
face `M54 20 32 32v24l22-12z` (c2). Colours per context:
- Graphite light: c1 #171717, c2 #f59e0b, c3 #fb7a3c · Graphite dark: c1 #f2f2f0, c2 #f59e0b, c3 #fb7a3c
- Plum light: c1 #7c4dff, c2 #fb7a3c, c3 #f5b40b · Plum dark: c1 #a78bfa, c2 #fb923c, c3 #fbbf24
- App icons / PWA / favicon PNG (static, one version): Graphite app icon = #171717 rounded-square bg, c1 #f2f2f0,
  c2 #f59e0b, c3 #fb7a3c; favicon = light version on transparent. Maskable keeps the 20 % safe zone.
`src/components/logo.tsx` takes colours from CSS vars (follows palette + mode). Wordmark "Nexus" Heebo 800,
-0.02em. Regenerate PNGs with `scripts/icons.mjs`, manifest `background_color`/`theme_color` = Graphite dark bg,
extension icons + popup colours (bump extension patch version), boot screen (see A3). Reference: `docs/design/logo-box.html`.
(The home references still show the old mark — use Box.)

### A3. [ ] Boot screen with the Box
Rework the phone boot animation (`src/components/boot-screen.tsx`, `src/lib/boot.ts`) for the Box: faces fly in and
assemble (left, right, then the top drops on with a small spring), a soft light sweep across, wordmark fades in,
heartbeat while waiting, hand-off as today. Same timing rules as Round 5 (≈1.4 s, plays to the end, reduced motion →
fade). Background = active palette's bg.

---

## Part B — desktop shell and home (reference: `home-graphite-light.html`, `home-graphite-dark.html`, plum versions)

### B1. [ ] Floating sidebar, collapsible
Rounded floating panel (radius 28, 1px line, surface). Top: logo pill (brand bg) + collapse button (chevron, rotates
180°). Nav: To buy, Urgent, On the way, Order by store, History, Spending — pills, active = filled ink pill, counts
muted. Projects: dot + name + tiny budget ring; "New project". Bottom: avatar "T", name, extension status, settings.
Collapsed = 76 px icons only (tooltips on hover); state in a cookie (server-read, no jump). Transition 450 ms
`--ease-out` on the grid column; content reflows smoothly. Below 1024 px the sidebar becomes the phone layout (Part C).

### B2. [ ] Top bar: search, Ask Nexus (Hairline), alerts
Search field (filters items live, as today) with a right-side hint "Esc · all actions" — **Esc opens the command menu**
(keep that; no Ctrl K hint). "Ask Nexus" = variant **Hairline**: neutral surface, 1.5px two-tone outline
`linear-gradient(100deg, brand, spark)` via `padding-box/border-box`, ink text, sparkle icon (reference
`ask-button-variants-graphite.html`, item 2). Alerts button with a spark-coloured unread dot.

### B3. [ ] Home: totals card + tiles, filters, product cards
- Totals card (hero gradient): "Left to buy · N items", saved-amount tag top-end, big number (900 weight, decimals
  smaller), segmented bar by project (grows in on load), legend with amounts. No decorative circles.
- Tile 1 (tint bg, tint-ink): Urgent count + names. Tile 2 (surface): best free-shipping progress (store, amount to
  go, suggestion, animated bar). Tiles adapt per view (project view: budget ring tile, etc.).
- Filters row: project chips (All + projects, dot), then at the end two dropdowns: **Category** and **Sort**.
- **Categories** become a short fixed list: Electronics, Mechanical, Tools, Materials, Computers, Camera & audio,
  Home & kitchen, Office, Clothing & personal, Other (both languages). Migrate existing values (components→Mechanical,
  3d-printing→Materials, camera-video/audio→Camera & audio, home/furniture/kitchen/garden→Home & kitchen,
  health-beauty/sports/clothing→Clothing & personal, software/books/vehicle→Other, …) in `migrate.ts` idempotently;
  update `CATEGORIES` and the AI prompts.
- Product card: neutral image tile with **category tag** top-start and Urgent / Lowest price flag top-end; title
  (bidi rules unchanged); meta line "● Project · Store" (no store letter/monogram on cards); price + quantity
  stepper; hover lift. Table view restyled to match.

### B4. [ ] Floating paste capsule that moves with the sidebar
Bottom-centre capsule over the content area: link icon, "Paste a product link", Ctrl V hint, Receipt (ghost) and Add
(brand) buttons; 2px animated two-tone border (slow flow, 5–6 s). Centred on the content column, it glides when the
sidebar opens/closes (same 450 ms ease). Pasting anywhere still works; placeholder cards from Round 5 unchanged.
A soft fade at the bottom so the grid passes under it.

---

## Part C — phone (reference: `phone-graphite-light.html`, `phone-graphite-dark-plus-open.html`, plum versions)

### C1. [ ] Phone shell
Top bar: logo pill, **search, Ask (Hairline, icon only), alerts** in that order. Floating dock: **To buy · Projects ·
+ · On the way · Stats** (Order by store moves into the command menu, the Stats screen and the To-buy filter menu).
Dock: surface, 1px line, soft shadow, active item has surface-2 pill; safe-area aware.

### C2. [ ] "+" menu
Tap + → scrim (bg 55 % + blur 10px) fades in, four action cards rise with a spring, staggered 50 ms bottom-up:
Scan a barcode (D1), Scan a receipt (E2), Paste a link, Plan with Nexus. The + rotates 135° into ×. Closes on +,
on the scrim, on back gesture/Esc, or after choosing. 44 px+ targets.

### C3. [ ] Projects screen
List of projects (and lists) as cards: name, colour dot, items left, amount left, budget ring, progress of bought
vs total; tap → project page (its items with the same filters/sort, budget tile, "Plan with Nexus" for it).
Create/rename from here. Desktop sidebar project links open the same page.

### C4. [ ] Stats screen (phone + desktop Spending view)
Make it rich and alive: this month vs budget (from R6.3) as a ring/segmented bar, spent/committed/forecast numbers
rolling up, 12-month bars that grow in, by project and by store (with store marks), top categories, savings from
cheaper stores, biggest purchases. Charts follow the theme tokens; numbers tick up once on enter.

---

## Part D — barcode and shopping mode

### D1. [ ] Barcode scanning
- Scanner component: live camera (`getUserMedia`, back camera), native `BarcodeDetector` where available, otherwise
  `zxing-wasm` (lazy-loaded). Frame overlay, torch toggle if supported, haptic tick on read. EAN-13/8, UPC-A/E, Code 128.
- Store barcodes on sources: extract `gtin13/gtin12/gtin8/gtin/mpn` from JSON-LD in `extract.ts` (and the extension
  extractor) into a new `sources.gtin` column (migrate idempotently).
- Lookup chain (pure, testable): own items by gtin → Open Food Facts / Open Products Facts (free, no key) →
  UPCitemdb trial endpoint (free, no key, ~100/day) → search provider if a key is set → otherwise "Take a photo of the
  product" → Gemini vision names it. Israeli 729-prefix products often miss the global DBs — the photo path covers them.
  Store-internal and weight barcodes (prefix 2) → straight to photo.
- Results: found on my list → mark bought / ordered / open; not on the list → add (title, image, category; choose
  list/project). Cache lookups in kv.

### D2. [ ] Shopping mode (new full-screen UI, phone first)
A focused mode for being in a store (supermarket included). Enter from the command menu, a project/list page, or
Order by store ("Shop at <store>").
- Pick scope: a store, a project/list, or everything to buy. Rows grouped by category (or store), big touch rows
  (64 px), image, name, qty; tap = check (strike + slide to a "In the cart" section, haptic); long-press = qty/price.
- Sticky header: progress ("7 of 12"), running total; scan button (D1) checks items by barcode; quick-add by typing.
- Screen wake lock while in the mode; works offline: checks go to a small IndexedDB outbox and sync when online
  (owner only; conflicts: last write wins, note in Open).
- Finish → summary (bought, total, skipped) → mark bought items as purchased (price paid = their price unless edited),
  undo available. Calm, focused look, same tokens; animations: check morph, row glide, progress bar.

---

## Part E — receipts v2 and product images

### E1. [ ] Reading pipeline (accuracy first, less AI work)
- PDFs: read the text layer with `unpdf` first; if it has real text, parse with the model from **text** (cheap,
  exact). Only scanned PDFs go to vision.
- Images: client-side preprocessing before upload — auto-crop/deskew (scanic, see E2), grayscale, contrast stretch,
  max 2000 px long side, JPEG ~0.85. Very tall receipts (ratio > 2.5) are split into overlapping tiles (≈15 %
  overlap) sent in order in one request; the prompt says they are consecutive parts.
- Gemini with `media_resolution: medium` for receipts, structured output (existing schema).
- Deterministic checks after reading: qty × unit ≈ line total, Σ lines (+ shipping − discounts) ≈ total within 2 %.
  On mismatch: one targeted retry with the specific lines flagged; still off → keep, mark those lines "check" in review.
- Cache by file hash (kv) so the same receipt is never read twice. Text-pasted emails keep working.
- Unit tests: checks/merge logic with fixtures (Hebrew supermarket, AliExpress order, Amazon invoice, multi-page PDF text).

### E2. [ ] Live camera scanning with auto-capture
- Full-screen camera view; `scanic` (MIT, ~100 KB WASM) detects the receipt edges live and draws the outline;
  when the outline is stable for ~0.8 s and sharp enough, auto-capture with a shutter animation + haptic; manual
  shutter always available; then a corner-adjust screen (drag the 4 corners), perspective-corrected preview.
- **Long receipt**: "Add another part" after a capture (optional, out of the way): parts are shown as a small stack,
  reorderable, sent as tiles of one receipt. Default flow stays one shot.
- Fallback when camera isn't allowed: file picker with the same corner adjust.

### E3. [ ] Review screen as cards, split in two
After reading: a full sheet with a summary header (store, date, total, "matches the receipt ✓" or "check 2 lines")
and two sections of **product cards** (same card component as the grid, compact):
1. **Already on your list** → each card shows the matched item, qty, price paid, and the move it will make
   ("→ On the way" for an order confirmation, "→ History" for a receipt). Tap to change the match (search) or unlink.
2. **New** → items that will be added (as ordered/purchased per the document) with their found image (E4), category,
   project picker per card + one "add all to…" picker.
Lines marked "check" have a gentle highlight. Confirm → apply (existing apply/undo logic), cards fly into their
destination with a short staggered animation; toast with Undo.

### E4. [ ] Product images for items without one (long-term pipeline)
`src/lib/product-image.ts`, used by receipts, barcode adds, manual items and a backfill for existing image-less items:
1. Matched existing item / its sources → reuse.
2. Store page `og:image` / JSON-LD when the server can fetch it.
3. **Owner's extension** job: new endpoints `/api/ext/image-jobs` (list) and reuse `/api/ext/check` style posting —
   the extension searches the store's site (or Google Images) in the owner's browser for the product name and posts
   the best product image URL + the product page URL (bump extension minor version).
4. Image search provider if a key is set: `BRAVE_SEARCH_API_KEY` (preferred) or `SERPER_API_KEY`.
5. Fallback icon: Gemini picks 1–2 English keywords → Iconify search in `fluent-emoji` (3D-style, MIT) → SVG stored.
Always: download → resize 480 px WebP → Blob; record `imageSource` (store / search / extension / icon) so the UI can
show a small "icon" badge and the user can replace it. Never block the user on this: items appear at once with a
shimmer image that fills in. Daily cron step for the backfill (bounded per run).

---

## Part F — assistant v2 (phone full screen, desktop side panel)

### F1. [ ] Streaming answers
Server streams tokens (Gemini `generateContentStream`; Groq/OpenRouter OpenAI-compatible SSE) through a route handler
with the existing fallback chain and cooldowns; if a provider fails mid-stream, the client keeps what it has and the
server continues with the next provider. `nexus-actions` blocks are parsed after the stream ends (R6.1 unchanged).
Mock mode streams a canned answer.

### F2. [ ] New look
- Desktop: side panel 420 px, slides in with spring; phone: full screen sheet with a drag handle and swipe-down to close.
- Header: Box mark + "Nexus" + model status dot (ok / busy fallback); new chat button.
- User messages: compact ink-tinted bubbles at the end side. Assistant messages: **no bubble** — a styled message on
  the surface: a short bold lead line, then body with clean lists; numbers as inline chips; referenced items
  (`[[id]]`) render as **mini product cards** (image, title, price) in a horizontal row; action proposals use the
  R6.1 card restyled to the new tokens.
- Waiting: an animated Box mark (faces breathing in sequence) + a shimmer line "Looking at your items…" that changes
  every ~1.5 s with what it's doing; then text streams in with a soft fade per word and a blinking caret; finished →
  caret fades, follow-up chips rise in.
- Input: rounded field, send button morphs to stop while streaming; suggestion chips (R5.3) above it; voice later.

---

## Part G — compare stores, import tax

### G1. [ ] Compare across stores (any store, not a fixed list)
"Compare stores" on an item (sheet + card menu) and as an assistant action:
- Query building: Gemini makes 2–3 search queries from title/brand/model/specs (and gtin if known).
- Search sources, in order of availability: search provider key (Brave/Serper, web + shopping results) → **owner's
  extension** runs the searches in the owner's browser (Google Shopping, plus Google web) and posts result lists
  (works without any key) → if neither, show "connect the extension or add a search key" with a short how-to.
- Verify candidates: read each page with the existing extract pipeline (server, or extension for blocked stores),
  keep only same-product matches (model/specs check by Gemini on the extracted data), normalize currency, include
  shipping when known.
- Results sheet: sorted by total price, store mark, delivery hint, "Add as another store" (existing alt-source flow),
  "Open". Cache per item for 24 h. Never auto-add.

### G2. [ ] Import VAT alert
Setting "VAT-free import limit" in USD, **default 130** (Israel changed it several times in 2025–26 — note in the
setting that the user should check the current figure). Foreign stores (non-ILS currency or a known foreign store)
in Order by store and on "mark as ordered": if the order total (items + shipping, in USD) exceeds the limit, show a
clear warning with the estimated 18 % VAT and how much to remove to get under it (suggest which items to split into
another order). Also in the weekly Telegram summary when relevant.

---

## Part H — motion pass (last)
Apply `docs/UI-V2.md` "Motion plan" across the app with the motion tokens: card → sheet shared-element morph,
layout animations for sorting/filtering/status changes, number tickers, view transitions (directional), press states
with spring, swipe on phone rows (mark ordered / actions), pull to refresh, celebration when a project is fully bought.
All transform/opacity, interruptible, `prefers-reduced-motion` → fades only. Check 60 fps on the phone profile
(Playwright CPU throttling ×4: no long tasks > 50 ms during the main transitions).

---

## Later (not this run)
Parts inventory, monthly "Wrapped" summary. Not wanted: SolidWorks BOM import, item file attachments, event wishlists.

## Open
