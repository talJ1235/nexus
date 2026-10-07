# Nexus — Product Spec (v1)

Personal procurement manager for Tal: paste a product link, Nexus pulls the name, image,
price and store, auto-tags it, and helps build purchase lists for projects, home, startup
and anything else.

## Users & access
- v1: single owner. One password (`APP_PASSWORD`) → signed cookie valid 1 year.
- Data model is owner-aware (`ownerId` on lists/items) so multi-user + per-list
  permissions can be added later without migration pain.
- A list/project can be shared read-only via a secret link `/s/<token>` (no login).
  Token can be revoked/regenerated.

## Core concepts
| Concept | Set by | Notes |
|---|---|---|
| **Item** | user (paste link) | a thing to buy; has 1..n sources |
| **Source** | auto from URL | one store listing: url, store, price, currency, shipping |
| **Store** | auto from URL host | field on source, filterable (AliExpress, KSP, IKEA…) |
| **Collection** | user | `kind = project` (has budget) or `list`; AI suggests one |
| **Tags** | AI, user-editable | product type tags (electronics, tools, furniture…) |
| **Category** | AI | one primary category from a fixed set |

## Item lifecycle
- `to_buy` → `ordered` (On the way: tracking number, carrier, ETA, tracking link) → `purchased`
  (received; History). Price paid is captured when the item is ordered.
- Priority: `urgent` | `normal` | `someday`.
- Quantity, free notes.

## Adding items
1. Paste one URL (main input, top of app, always focused on `/`).
2. Paste many URLs at once (bulk) → queued, processed 2 at a time with progress.
3. Bookmarklet: runs in the store page, extracts JSON-LD/OG in-browser (bypasses bot
   blocking), opens `/add?d=<payload>`.
4. Android PWA share target → `/share?url=&text=`.
5. Manual entry always possible; any field editable.

### Extraction pipeline (server, `/api/extract`)
1. Normalize URL (strip tracking params; canonical AliExpress `/item/<id>.html`,
   Amazon `/dp/<ASIN>`), resolve short links.
2. Fetch HTML with browser-like headers, 8 s timeout.
3. Parse in order: JSON-LD `Product` (incl. `@graph`, `AggregateOffer`) → microdata →
   OpenGraph/product meta → `<title>`.
4. If title or price still missing and Gemini is configured → LLM extraction from
   trimmed page text.
5. Categorize with Gemini (structured JSON): clean title, brand, category, tags,
   suggested collection (from the user's existing collections).
6. Image → resized 480px WebP → Vercel Blob (falls back to remote URL).
7. Duplicate check (normalized URL match, then title similarity) → offer
   "add as another source to <existing item>".
Failure at any step degrades gracefully to a partially filled, editable item.

## Prices & currency
- Display currency toggle (ILS default, USD, EUR). Each source keeps its own currency.
- Rates from frankfurter (ECB), cached in DB 12 h.
- Effective source price = price + shipping (shipping manual if not extracted).
- Cheapest source per item is highlighted; line total = qty × chosen-or-cheapest.

## Collections
- Sidebar: Views (To buy, Urgent, History), Projects (with budget bar), Lists, Stores.
- Project budget: planned (to_buy) + spent (purchased) vs budget; warning at 90 %,
  alert when over.
- Export collection to Excel (BOM): #, item, qty, unit price, currency, line total,
  store, link, priority, status, notes + totals row.

## Round 2 (shipped)
- Multi-select (checkbox, Ctrl/⌘-click, Shift-range) with a floating action bar: move, priority,
  status, compare as alternatives, delete (undo).
- Drag cards/rows onto a project/list (or Unsorted) in the sidebar to move them.
- Alternatives: group options for one need, compare side by side, pick a winner. Only the winner
  (or the cheapest, until picked) counts toward totals and budgets.
- Order by store: everything to buy grouped by active store with subtotals; mark a store's order as ordered.
- Price history: every read/edit logs a price point; sparkline in the item, "lowest price seen" badge.
- Spending: this month / last month / this year, last 12 months, by project, by store.
- Receipts: images/PDFs uploaded straight to Vercel Blob (client upload), attached to items.
- Settings dialog; settings actions in the Esc command palette.

## Round 3 (shipped)
- **Import & backup**: Excel/CSV import with auto column mapping (EN/HE headers), per-row project/list
  (created if missing), manual prices without a link, "fill in details" from links (via extension when
  installed). Full JSON backup download; restore by merge (upsert) or replace. Secrets never exported.
- **Price tracking**: daily Vercel cron (`/api/cron/prices`, `CRON_SECRET`) re-reads watched links;
  alerts for drops ≥ N% (default 5), target price reached, back in stock; deduped per link/kind for 20h;
  one Telegram digest per run (bot token + chat linked from the Alerts panel, stored in kv as secrets).
  Links the server can't read (3 failures) are checked by the extension every 6h (quiet fetch) or on
  "Check now" (may open a background tab).
- **AI assistant** (Gemini Flash, free tier): "Ask" answers questions about the user's own data with
  linked item chips; "Plan a project" drafts a parts list with quantities and price estimates → adds
  link-less items with store search buttons (AliExpress, Amazon, Zap, Google Shopping).
- **Sharing with permissions**: per-collection invite links (viewer/editor, hashed tokens, revocable);
  guests enter a name once → signed guest cookie (separate HMAC context from the owner's) → `/g`
  shows only granted collections. Editors add links, change qty/priority/notes, move status, delete only
  their own items. Every guest action re-checks signature, revocation and the specific item's grant.
  Guests never see receipts or items outside shared collections. Owner sees "Added by".

## Round 4 — Session A: look & feel (shipped)
- **Palette "Ink & Teal"** (tokens only, `globals.css`): cool graphite neutrals, one teal accent for actions/focus, stronger bg↔card contrast,
  prices on a soft teal tag (`--tag`/`--tag-fg`), neutral image swatch (`--tile`, `--tile-ink`).
- **Mixed Hebrew/English text**: titles and user text use the `.bidi` class (`unicode-bidi: plaintext` + alignment to
  the page's start edge). No `dir="auto"` on titles; only assistant chat text keeps it.
- **One loader**: `components/ui/spinner.tsx` — `Spinner` (masked conic ring, transform-only, 1.15 s) and `ThinkingDots`
  for the AI. No `animate-spin` anywhere.
- **Add-link feedback**: a pasted link becomes a placeholder card/row at once (shimmer, `store.pending`), which gives way to
  the real card with a settle-in animation; failures stay on the card with Retry/Dismiss. Views without a grid
  (history, orders, spending) show a small status line under the add bar instead.
- **Same link twice** (still to buy) → quantity +1 with undo, detected client-side before any fetch (server early check as
  backup); the card glows once. Same link of an ordered/received item → new line. Other-store duplicates keep the dialog.
  (Telegram input keeps its own "already saved" rule.)
- **Cards**: title first, store · list below, price tag + total/savings in one row, status/priority/"Lowest" badges on
  the image.
- **Item sheet**: hero (image, title, store/brand, price, open-in-store) + grouped cards: Plan (qty stepper, priority,
  project/list picker), Stores, Price history + watch/target, Tags & notes, Receipts, Advanced.
- **Partial move**: choosing a project/list for an item with qty > 1 asks how many units move (default all). Fewer →
  `splitItem` copies the item (links + price history, not receipts) with N units to the target, the rest stay; undo
  folds it back (`unsplitItem`). Bulk move still moves whole items.
- Dev: `scripts/seed-local.mjs` seeds a demo catalog into the local DB; `SMOKE_WRITE=1 npm run smoke` (localhost only)
  checks the placeholder card, +1 and the partial move.

## Round 4 — Session B: reliability (shipped)
Research (2026-09-30): from Vercel, AliExpress answers with a script-only "punish"/x5sec challenge; Amazon/KSP/eBay are
blocked for server requests. Gemini url-context usually reads title + price, never the image. Workarounds that
impersonate other clients or route through third-party fetchers were tried and **dropped by decision** (unreliable, not
wanted) — don't reintroduce them. The owner's browser (extension) is the dependable source for blocked stores.

**Reading a pasted link**
- `extract.ts` detects challenge pages (`blocked`). `buildDraft` then uses Gemini (page text / url-context) and the
  categorizer inside one **38 s budget** (`DRAFT_BUDGET_MS`): each AI step gets only what's left and is skipped when too
  little remains, so a slow store or busy AI yields a partial item instead of a request killed at Vercel's 60 s limit
  (which used to show "couldn't read" and lose the link).
- Self-heal of incomplete links (no real title, no price or no image; to-buy, last 21 days), no one's action needed:
  (1) the guest page re-reads its own incomplete additions after 4 s / 25 s / 50 s (`guestRepairItem`, own recent items
  only, ≥15 s apart); (2) the owner's extension (v1.2.0, every 30 min) fetches them with the owner's browser and posts the
  HTML (`/api/ext/stale` flags them `details`, `/api/ext/check` repairs via `refreshSourceCore`); (3) daily cron
  `repairIncomplete`.
- Diagnostics (owner): `/api/debug/extract` (recent + incomplete links), `?url=…&full=1` (full pipeline).

**AI assistant**
- `ai.ts` routing: Gemini models → Groq (`GROQ_API_KEY`, gpt-oss-120b/20b) → OpenRouter (`OPENROUTER_API_KEY`,
  `openrouter/free`); page reading (url-context) stays Gemini-only. Overload → one jittered retry on the same model;
  errors classified (`classify`): per-minute 429 cools for the stated retry delay, daily quota 1 h, "limit: 0" 6 h, retired
  models 2 h. Working model + cooldowns are shared across function instances in kv (`ai:health`). ~12 s of the 45 s
  budget is reserved for a fallback provider. `/api/debug/ai` shows providers, errors and health.

## Round 5 — UX polish
Brief and checklist: `docs/ROUND5.md`. Sessions A1 + A2 shipped:
- **First load**: `/` streams the real shell at once (same `NexusApp`, empty store, `loading`) inside a Suspense
  fallback; the app with data replaces it in the same response. Skeletons match the grid/table/spending/sidebar rows,
  lit by one slow soft sweep, eased in after 140 ms (fast loads never see them). Data fades in (opacity, 220 ms);
  card/table frames stay solid and only their contents fade (cards stagger ≤150 ms). Reduced motion: instant.
- Layout/sort live in cookies (`nexus_layout`, `nexus_sort`, read by `getUiPrefs`) and `?v=` comes from
  `searchParams`, so the first paint is already the right view/layout (localStorage = one-time migration only).
- **Phone opening animation** (`components/boot-screen.tsx`, CSS in `globals.css`): in the initial HTML, phones and
  standalone only, once per tab; hub → links → nodes → wordmark (~900 ms), heartbeat while loading, fades into the app
  when the store has data (`lib/boot.ts`, holds a ready app ≤400 ms). Background = manifest splash = dark `--bg`.
- **Logo** hub is teal everywhere (SVGs, PNGs regenerated by `node scripts/icons.mjs`, extension 1.2.1).
- **Smoke**: `SMOKE_MOBILE=1` (390×844 touch, `-m` screenshots), `SMOKE_TRACE=1` (every painted frame of a load +
  contact sheet, in the OS temp dir), `SMOKE_THROTTLE`, `SMOKE_TRACE_PATH`, `SMOKE_TRACE_LAYOUT`;
  `NEXUS_TRACE_DELAY_MS` on the local server simulates a slow database.
- **Assistant suggestions** (`lib/assistant-suggestions.ts`, pure, test: `npm run test:sug`): the Ask tab's chips come
  from the user's data (current project, budget ≥90 %, urgent, top store, late/this-week orders, price drop/at target,
  undecided alternatives, unsorted, recent additions, month-over-month spend), top 4 with one per rule family; the last 5
  asked questions (localStorage `nexus_ai_recent`) aren't repeated; names are bidi-isolated; empty account → the 4
  static questions. 2–3 follow-up chips after each answer. Phones: one snap-scrolling row, 40 px chips.
- **Store identity** (`components/ui/store-mark.tsx`): favicon (Google s2, lazy) fading in over a monogram tile in one
  of 8 muted store hues (`--store-1…8`, both themes; known stores fixed, others hashed from `storeKey`). Used in the
  orders view group headers (3 px start bar + light tint, thin start line on each row), cards, table and item sheet.
  The orders view now honours cards/table: table = one aligned `ItemTable` per store on desktop, compact stacked rows
  on phones. Every view with the toggle has both layouts (spending has no toolbar).
- **Toasts**: `@/lib/toast` wraps sonner (toasts with an action stay 7 s, others 4 s, hover pauses). ~200 ms enter,
  end-side ✕ (hover on desktop, always + 40 px on touch), swipe left/right (and down on phones), phones: bottom-centre
  above the safe area and the selection bar, one-line title/description. Optimistic actions (status, mark all ordered,
  move, delete, +1) toast immediately; Undo waits for the save, a failed save turns the toast into an error.
- **Clicks during a slow load**: the streamed shell is static HTML until the data arrives (React doesn't hydrate a
  pending Suspense fallback), so an inline capture script in `page.tsx` (outside the boundary) remembers the last click
  on a `[data-carry]` control (assistant, alerts, palette, menu, settings, fixed views, new project/list, layout), shows
  it pressed, and the loaded store replays it once (`window.__nexusCarry`). Smoke: `SMOKE_SLOW=1` with a server started
  with `NEXUS_TRACE_DELAY_MS`.
- Smoke: assistant chips (count, 40 px + nowrap on phones), orders cards↔table toggle, and with `SMOKE_WRITE` the toast
  close button + swipe (real touch events on mobile).

## Round 6 — features
Brief and checklist: `docs/ROUND6.md`. All four sessions (B1–B4) shipped:
- **Assistant actions** (`lib/assistant-actions.ts`, pure, test: `npm run test:actions`): for change requests the model
  appends one ```` ```nexus-actions ```` block `{ summary, actions }` (provider-neutral, no function calling). Whitelist:
  `move` (→ project id, `null` = Unsorted, or `new:<ref>`), `setStatus`, `setPriority`, `setQty`, `addTag`/`removeTag`,
  `createCollection` (`ref`, name, kind, budget?); no deletes, ≤50 items. Anything malformed, unknown, foreign
  (item/project id not in the owner's data) or a no-op drops the whole proposal; the text answer still shows.
- `ask` returns `{ text, proposal }`; the Ask tab shows a confirmation card (summary, new projects, each item with
  before → after, "+n more", Apply / Cancel). Apply → owner-only `applyAssistant` re-validates on fresh data, creates
  projects, runs `updateItem` / `bulkSetStatus` (leaving "to buy" records the active store's price as paid, like the
  selection bar), returns the previous values; toast + card both offer Undo (`undoAssistant` restores status dates,
  paid price, project, priority, qty, tags and removes created projects that are still empty).
- Prompt lists project ids (`[id]`) and teaches the format with 2 examples. Mock mode proposes "first two to-buy →
  ordered" for mark/move/set questions. The "unsorted" suggestion chip is now action-style ("Sort my unsorted items
  into projects").
- Toasts stay clickable above modal sheets/dialogs (they set `pointer-events: none` on body) and clicking one doesn't
  close the sheet (`onInteractOutside` in `components/ui/overlays.tsx`).
- Smoke (`SMOKE_WRITE`, server with `NEXUS_AI_MOCK=1`): propose → apply → toast Undo, statuses checked via `/api/backup`.
- **Free shipping per store** (`lib/shipping.ts`, pure, test: `npm run test:ship`): table `store_settings` (`storeKey`
  PK, `freeShippingMin`, `currency`, `shippingFee`; created in `db/migrate.ts`, in backup/restore), saved by owner-only
  `saveStoreSetting` (`app/money-actions.ts`). Amazon ($49), AliExpress ($10), iHerb ($45) are pre-filled until saved.
  Order by store: someday items are **left out** of the order and its subtotal (listed per store, "Include" → normal);
  each store group shows a progress bar in its hue ("₪23 more for free shipping" / "Free shipping ✓"), the fee is added
  to the subtotal while under the threshold; settings popover from the group (header button when no rule yet).
  "Close the gap": (a) items ordered elsewhere with a priced source here → "Buy here" (switch chosen source, price
  difference shown), then (b) someday items from this store → "Include"; each with toast Undo.
- **Monthly budget** (`lib/budget.ts`, pure, test: `npm run test:budget`): optional cap + currency, set in Settings or on
  Spending (`saveMonthlyBudget`), stored as kv `pref:budget:YYYY-MM` (Israel month; later months carry it forward, a
  cleared cap is stored as null). Spending card "This month's budget": received + ordered (dated this month) + forecast
  (urgent to-buy, one per alternatives group; normal too with a per-device toggle; someday never) in one 3-segment bar,
  ok / near (≥90 %) / over. 12-month bars show the cap each month had (tick; red when over). The Telegram digest
  (cron + extension check) adds one near/over line (spent + ordered + urgent), once per state per month
  (kv `budget:notified:YYYY-MM`), and sends even without price alerts.
- **Receipts → purchases**: `receipts` table (file URL in Blob or pasted text, status new / extracted / failed /
  applied, extraction JSON; in backup/restore) and `items.order_number` (both added idempotently in `db/migrate.ts`).
  `lib/receipt.ts` reads store, order date, order number, currency, lines, shipping, total: files go to Gemini only
  (`AiFile` inline data in `lib/ai.ts`, never falls back), pasted text to any provider; mock mode parses
  `Store:` / `Order:` / `1 x Name @ price` lines. `lib/receipt-match.ts` (pure, test: `npm run test:receipt`) scores
  each line against to-buy/ordered items (title tokens incl. Hebrew one/two-letter prefixes and glued model numbers,
  store name, price proximity), assigns greedily (one line per item) and splits a line's quantity across similar
  items. Owner-only `app/receipt-actions.ts`: `createReceipt` (Blob URLs only; pasted text also saved as a .txt in Blob
  when a token is set), `readReceipt` (receipt kept as failed when AI is off or reading fails), `listReceipts` /
  `deleteReceipt`, `applyReceipt` → received (or ordered, for an order confirmation), unit price paid, order number,
  date, receipt attached to each item, price point, partial purchases split the item, chosen unmatched lines become
  new items; `undoReceipt` reverses all of it. Deleting an attachment keeps the Blob file while another item or the
  receipt still uses it. `receipt-dialog.tsx`: pick / paste → review (per line: match, changeable via search / add as
  new / ignore; received vs ordered) → Apply → toast Undo; "Not applied yet" list with retry / discard. Entry points:
  add bar (≥640 px), On the way / History headers, command palette, a file dropped on the app. The item sheet's
  shipping card shows the order number. Smoke (`SMOKE_WRITE` + mock): paste → review → apply → undo.
- **Weekly Telegram summary** (`lib/weekly.ts`, pure, test: `npm run test:weekly`): `sendWeeklySummary` (tracker) runs
  from the daily cron on Sundays (Israel), once per Sunday (kv `weekly:sent`), when Telegram alerts and
  `prefs.weekly` (Alerts panel toggle, default on) are on. Sections (≤5 rows each, "…and n more"): price drops /
  targets hit in the last 7 days (to-buy items), urgent not ordered, orders overdue / arriving within 7 days, stores
  within 25 % of free shipping (Order-by-store grouping), month vs budget; items link to `?item=<id>`. Nothing worth
  sending → skipped (a month line alone counts only when near/over the cap). Written in the owner's locale and
  currency, remembered in kv `pref:owner` from app loads. Local test: `scripts/test-telegram.mjs` with a fake
  Telegram API (`TELEGRAM_API_BASE`, ignored on Vercel) and `/api/cron/prices?only=weekly&force=1` (cron secret).
- **Offline, read-only v1**: `public/sw.js` registered as `/sw.js?v=<build>` (`NEXT_PUBLIC_BUILD_ID` in
  `next.config.ts`): `/_next/static` cache-first per build; navigations to "/" network-first, falling back (redirect)
  to the cached `/offline` shell, which the SW caches (HTML + its CSS/JS/fonts) when the owner app posts
  `cache-shell`. Guests, share/invite pages, login and APIs: network only. `lib/offline.ts` keeps the owner's
  `AppData` in IndexedDB (`nexus-offline`), saved debounced by the store on every online load/change; the login page
  clears it and the shell cache (every logout lands there). `/offline` (`offline-app.tsx`) renders `NexusApp` from the
  snapshot with `offline={{ at }}`: banner "Offline — showing data from <time>" (`offline-banner.tsx`), read-only via
  `useReadOnly()` (add bar, card status/select, item sheet fieldsets, selection bar, receipt/assistant, file drop);
  back online → "/". An online page that loses its connection also goes read-only and refreshes items when back. A
  new SW takes over and the page reloads once. Smoke: `setOffline` after an online load (with
  `PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1`) → snapshot renders, banner, edits disabled, logout clears it.

## Round 7 — UI v2, barcodes, shopping mode, receipts v2, assistant v2, compare, import VAT
Brief and checklist: `docs/ROUND7.md` (design references in `docs/design/*.html`). Shipped (merged to `main` 2026-10-01):
- **Design system** (`globals.css`): Graphite & Amber (default) and Plum palettes × light/dark; palette = cookie
  `nexus_palette` read on the server into `<html data-palette>` (no flash), mode = next-themes. Semantic tokens (bg,
  surface, surface-2, ink, muted, line, brand, on-brand, hero, tint, tint-ink, spark, 8 muted project hues
  `--proj-*`); legacy names (accent*, sunken, raised, tag, tile) alias them. Spark only on the AI button and unread
  dots. Heebo (self-hosted) replaces Rubik; radius 999/30/26/21/16; motion tokens `--ease-out`, `--ease-spring`,
  120/200/320/450 ms. Contrast ≥ 4.5:1 in all four themes: `npm run test:contrast`. Theme screenshots:
  `node --env-file=.env.local scripts/shots.mjs [paths]`.
- **Box logo** (`components/logo.tsx`, colours from CSS vars), app icons/favicon/maskable/apple-touch from
  `scripts/icons.mjs`, manifest bg Graphite dark, extension icons + popup colours; the phone boot screen assembles the
  Box (faces fly in, top drops with a spring, light sweep, breathing while loading).
- **Desktop shell**: floating sidebar collapsible to 76 px (cookie `nexus_sidebar`, server-read; 450 ms grid
  transition), pill nav, projects with budget rings, lists, owner card. Top bar: live search ("Esc · all actions";
  Esc opens the command menu), "Ask Nexus" Hairline, alerts with a spark dot. Home: totals card (hero gradient,
  saved-since-added tag, split bar by project), urgent / free-shipping / project-budget tiles, filters row (project
  chips, Category + Sort dropdowns, cards/table). Product cards: category tag, Urgent/Lowest flags, "● project ·
  store", qty stepper. Floating paste capsule (flowing two-tone border) glides with the sidebar; paste anywhere adds.
- **Categories**: short fixed list `lib/categories.ts` (Electronics, Mechanical, Tools, Materials, Computers, Camera &
  audio, Home & kitchen, Office, Clothing & personal, Other); old values migrated idempotently; AI prompts use it.
- **Phone shell** (< 1024 px): top bar (logo pill, expanding search, Ask, alerts), floating dock To buy · Projects · +
  · On the way · Stats, "+" menu (scan barcode, scan receipt, paste link, plan with Nexus), item rows < 640 px.
  **Projects** screen (`?v=projects`); project page has "Shop" and "Plan with Nexus". **Stats**: month vs budget hero
  with ring, ticking tiles (incl. savings from cheaper stores), 12-month bars, by project / store / category, biggest
  purchases. Order by store is reachable from Stats, the To-buy category menu and the command menu.
- **Barcodes** (`lib/barcode.ts` pure + `npm run test:barcode`; `app/barcode-actions.ts`): camera with native
  BarcodeDetector or self-hosted zxing-wasm (`public/vendor/zxing_reader.wasm`), EAN-13/8, UPC-A/E, Code 128, torch,
  typed fallback. Lookup: own items by gtin (`items.gtin`, `sources.gtin` from JSON-LD/extension) → Open Food Facts →
  Open Products Facts → UPCitemdb trial → search key → photo named by Gemini; store/weight codes go straight to the
  photo; cached in kv (`barcode:<gtin14>`). Found → mark bought/ordered/open; new → add (list/project) or to History.
- **Shopping mode** (`shopping-mode.tsx`, `lib/shop-outbox.ts`): scope (everything / store / project), rows by
  category or store, tap = check, long-press = qty/price, progress + total, barcode check-off, quick add, wake lock;
  the trip lives in IndexedDB `nexus-shop`; an offline Finish is queued and synced when online (last write wins).
- **Receipts v2**: PDFs with a text layer read as text (unpdf); photos prepared in the browser
  (`lib/receipt-image.ts`: scanic crop/deskew, grayscale + contrast stretch, ≤ 2000 px, JPEG 0.85, tall receipts in
  overlapping tiles stored as `receipts.parts`); Gemini `media_resolution: medium`; checks (`lib/receipt-check.ts`,
  `npm run test:receipt-check`) with one targeted retry, lines still off marked "check"; reads cached by content hash.
  Live camera (`receipt-camera.tsx`): live outline, auto-capture when steady and sharp, corner adjust with a
  straightened preview, extra parts for long receipts, file fallback. Review as cards: "Already on your list" (with
  the move) and "New" (picture, category, project, "add all to…"), cards fly out on apply.
- **Product pictures** (`lib/product-image.ts`): existing item → store page → owner's extension job
  (`/api/ext/image-jobs`, extension 1.3.0 searches Google Images in the owner's browser) → Brave/Serper image search →
  Fluent Emoji icon (Iconify); `items.image_source` with an "icon" badge; shimmer while filling; daily cron backfill.
- **Assistant v2**: `/api/ask` streams NDJSON (route/delta/done) through `generateTextStream` (Gemini stream +
  OpenAI-compatible SSE, same fallback chain/cooldowns; a provider failing mid-answer is continued by the next);
  actions parsed after the stream. 420 px side panel / full-screen phone sheet with swipe-down; bold lead line, money
  chips, referenced items as mini cards, breathing-Box waiting state, word fade + caret, stop button, new chat.
- **Compare stores** (`lib/compare.ts`, `app/compare-actions.ts`, `compare-sheet.tsx`): Gemini queries → Brave/Serper
  candidates, or the owner's extension searching Google Shopping/web in their browser → pages read (extension for
  blocked stores) → same-product check by Gemini → sorted by total in the display currency; "Add as another store";
  cached 24 h in kv; never auto-adds.
- **Import VAT** (`lib/import-vat.ts`, `npm run test:import-vat`): setting "VAT-free import limit" (USD, default 130,
  kv `pref:import-limit`); foreign stores over it get a warning in Order by store (VAT 18 % estimate, what to split), on
  "mark as ordered", and in the weekly Telegram summary.
- **Motion**: card → sheet FLIP morph, gliding/collapsing grid cells (motion), number tickers, directional view
  transitions, spring presses, phone row swipe (end = next status, start = select), pull to refresh, project-complete
  burst; reduced motion → fades. Perf: data-only store context for cards, separate open-item context, chunked grids,
  content-visibility, single layout rendered; `SMOKE_PERF=1` reports long tasks at CPU ×4.

## Round 8 — receipts that find their edges, phone fit, home hierarchy, assistant help + reports
Brief and checklist: `docs/ROUND8.md`. Shipped (merged to `main` 2026-10-01):
- **Receipt edge detection** (`lib/receipt-detect/`, pure apart from scanic): four candidate sources fused by one score —
  a receipt "paper" detector (bright + neutral regions, several thresholds + adaptive, morphology, holes filled, hull →
  4-point fit, sides refit), straight edges (Hough, near-parallel pairs, frame borders as lines), scanic classical
  (tuned) and scanic's ML detector **self-hosted** under `/scanic-ml/` (copied from the `scanic-ml` package at
  dev/build by `scripts/copy-scanic-ml.mjs`, git-ignored, outside the auth proxy). Validation (convex, 50–130°, 2.5–95 %
  of the frame, aspect ≤ 8, not two sides on the border), score = edge support + contrast + paper fill, top six polished
  onto the paper edge. Live frames: paper + lines, scanic/ML only when unsure; stills: all four. Bench
  `npm run test:receipt-detect` (Playwright + esbuild, 64 synthetic receipts in `test-data/receipt-synth/`, real photos
  in git-ignored `test-data/receipts/` + `labels.json` when present): still 95 %, live 94 %, corner error 0.35 %, live
  ~40 ms (≈ 180 ms at CPU ×4); `--snap` checks corner snapping. `npm run test:receipt-e2e`: detect → crop → enhance →
  tiles → read (mock for all, Gemini on 5 sharp synthetic receipts — exact).
- **Receipt camera**: detection in a Web Worker (`receipt-detect/worker.ts` via `lib/receipt-live.ts`, transferred 640 px
  ImageBitmaps, frames skipped while busy; main-thread fallback), tracker with smoothing + hysteresis
  (`receipt-detect/track.ts`, `npm run test:receipt-track`), rAF-glided outline, auto-capture when steady ≥ 0.7 s and
  sharp ≥ 70 % of the last 2 s best, guidance chip (light / closer / darker surface / whole receipt / hold steady),
  full-resolution re-detect after capture, magnifier loupe while dragging a corner and snapping onto the paper edge.
  Smoke feeds a fake camera `.y4m` made from a synthetic receipt.
- **Phone fit**: Spending/Stats fixed (implicit `auto` grid track + min-content tiles widened the page to ~394 px →
  the phone zoomed out): single minmax(0,1fr) column, compact amounts (`formatMoneyCompact`: ₪12.4K) on phones, 12-month
  bars with every other label when tight, inward tooltips. Guard: phone smoke step opens every view and sheet at 360 and
  390 and fails when the layout viewport or any element is wider than the device (measured against the device width —
  `innerWidth` itself grows on a too-wide phone page). `useMedia` hook; `SMOKE_ONLY=` runs matching steps.
- **Home hierarchy**: totals card shows everything on every size (per-project amounts — phone top 3 + "+N more" — each
  tappable, saved, strip "Urgent · On the way · Spent this month" linking to the views) but calmer (~180 px desktop,
  ~170 px phone, softer light-theme hero); desktop keeps the two tiles, phones get one compact row (project budget or
  nearest free shipping). A sticky "To buy" section header (count + total, chips, Category, Sort, layout switch, soft
  surface once stuck under `--app-header-h`). Cards: taller image, the price as the strongest text, a clearer edge
  (subtle shadow on light themes), a quiet urgent marker, staggered rise on first paint. Phones: 2-column cards by
  default with a cards/rows switch (cookie `nexus_phone_layout`, server-read; Tailwind variants `prow:` / `pcard:`
  keyed on `data-phone-layout` on the app shell); at 390×844 the first row of products is above the fold (smoke).
- **Assistant**: suggestions/follow-ups as a vertical list of full-width chips (4 + "More suggestions"), mini cards in a
  2-column grid on phones (4 + "Show all"). **Help with the app**: `lib/help/nexus-help.md` (< 25 KB, `npm run test:help`
  checks size and that every SPEC feature has a `<!-- spec: … -->` marker), routing `lib/help/route.ts` (keywords en/he
  + project names → help / data / unsure; unsure = data prompt + help, the model decides), action buttons from
  `[label](nexus:…)` links (whitelist `lib/help/links.ts`), diagnostics (client: view, device, theme, locale, online,
  extension, version, last errors from the `lib/client-errors.ts` ring buffer; server: AI providers/cooling/errors,
  Blob, Telegram — never secrets). The help file is traced into `/api/ask`.
- **Reports**: "Report a problem" from the assistant (drafted ```` ```nexus-report ```` card: Send / Edit / Cancel), the
  command menu, Settings and the assistant header; form with optional picked screenshot and the automatic diagnostics
  (incl. last assistant exchange and client errors). Table `reports` (in backup), owner screen "Reports" (status chips,
  detail, status change, "Copy for Claude Code"), one Telegram message per report, optional GitHub issue
  (`GITHUB_ISSUES_TOKEN`, label `from-app`), export `/api/reports/export` (`REPORTS_TOKEN`) + `node scripts/reports.mjs`.
  Owner-only. `npm run test:reports`.

## Round 9 — phone polish, assistant memory, projects
Brief and checklist: `docs/ROUND9.md`. Shipped (merged to `main` 2026-10-02):
- **Phone shell v2**: the avatar at the start of the phone top bar opens the "Me" sheet (`me-sheet.tsx`: palette +
  theme, Settings, extension, Telegram, Reports, Report a problem, Excel export, backup, sign out). Dock order To buy ·
  On the way · + · Projects · Stats, physically left → right in every language (`dir="ltr"`); the dock and + menu render
  through a portal into `body`, `<main>` clips horizontal overflow (`overflow-x: clip` — the sliding view transition
  had widened the page and moved the fixed dock), the page's minimum height is `100lvh`. Smoke samples the dock and top
  bar every frame while switching (> 0.5 px fails) and checks the order in en + he. The + menu is a 2 × 2 grid of
  coloured tiles (`--act-*` tokens per mode) with their own illustrations.
- **Dark mode depth**: dark surfaces a step above the background, a 12 % white outline, a top highlight + soft shadow
  (`--shadow`), `--shadow-lift` for hover/press; every outlined surface follows; `scripts/contrast.mjs` checks the
  surface/bg step (all themes) and the outline (dark).
- **One chat**: Ask and Plan merged — a Chat / Plan a project pill near the input; plans arrive as a card in the chat
  (`assistant-plan-card.tsx`: per-line add, add all to a project, budget fit, the usual store per line).
- **Conversation history**: tables `conversations` + `conversation_messages` (in backup), `app/chat-actions.ts`
  (list/search, get, latest, save, auto title, rename, delete + undo); the assistant reopens a conversation < 2 h old;
  history drawer with search and Today / This week / Earlier; "last time" questions search past conversations
  (`lib/conversations.ts`).
- **Memory**: a shopping profile computed from the user's data (`lib/profile.ts`, cached in kv `profile:v1`, daily
  cron), learned notes (`memories` table, in backup) proposed by the assistant and confirmed with a chip, a sensitive-
  data guard (`lib/memory.ts`), Settings → "What Nexus knows about you" (switch `pref:memory`, profile, notes). Used by
  Ask, Plan mode, compare (ties → usual stores) and suggestions. `npm run test:memory`.
- **Smarter suggestions**: follow-ups offer the natural next step, recent conversations aren't repeated, "Plan the next
  {project} stage at {store}", how-to follow-ups after help answers (`npm run test:sug`).
- **Simpler reports**: one text box (+ expected for bugs) and a screenshot; title from the text; more automatic
  diagnostics (last views, item count, network, failed request paths, service worker, device class) listed in
  "Included automatically".
- **Project pages**: Projects cards with a colour cover and picture collage, ring, bought bar, next item, flags; a
  dashed "New project" card; the project page header matches (cover morphs via View Transitions) with Plan with Nexus,
  Shop this project, Share and a ⋯ menu.
- **Excel export**: the project/list ⋯ menu, the command menu and the Me sheet download the BOM (`/api/export`).

## Round 10 — animation fixes, faster camera, projects page, real product pictures
Brief and checklist: `docs/ROUND10.md`. Shipped (merged to `main` 2026-10-02):
- **Motion fixes**: opening a product no longer replays the sheet's slide-in when the picture morph ends (the sheet
  keeps `data-morphed`); one morph clone at a time, flown back to the card's re-measured position on close (fade/scale
  out when the card is off-screen), removed on finish/cancel + a 450 ms safety timeout; `scrollbar-gutter: stable` with
  the scroll lock's gap margin neutralised. The project cover keeps its rounded corners card ↔ page (it rounds itself;
  `view-transition-class: project-cover` groups clip with the same radius; the way back morphs too). `traceFrames()` in
  the smoke records any animation's frame series (`SMOKE_TRACE`).
- **Phone opening animation on every load**: the once-per-tab skip is gone. The "blue circle" was Chrome's own
  pull-to-refresh — the root has `overscroll-behavior-y: contain` and Nexus's pull-to-refresh (Box mark) reloads into
  the boot sequence.
- **Faster camera**: `lib/camera.ts` shares one back-camera stream — `getUserMedia` starts in the tap (640 px first,
  upgraded after the first frame), off the moment the scanner/receipt camera closes (Tal's choice, no keep-alive) and
  when the page is hidden; `lib/barcode-reader.ts`
  uses the native BarcodeDetector or zxing-wasm, downloaded in idle time and compiled when the + menu opens / at the
  tap. Performance marks `cam:tap`, `cam:frame`, `scan:decoder`, `<html data-camera>`; smoke at CPU ×4: barcode
  viewfinder ~255–300 ms, receipt ~165 ms, camera off after each close.
- **Projects page v2**: header summary (active projects, left to buy, the budget nearest its limit), Projects then
  Lists (smaller cards) with counts and their own empty states, a "New" pill (New project / New list) and one "Start
  something new" card at the bottom; one-line card footers keep heights equal.
- **Loading skeletons**: chosen from the view in the URL — Projects, a project page's header, Order by store, Stats,
  On the way / History cards — with the same sweep.
- **Real product pictures**: `lib/product-lines.ts` (D1: one batched call understands every receipt line — clean
  Hebrew/English name, brand, type, size, he/en queries, icon keyword, barcode; heuristic fallback/mock),
  `lib/product-pictures.ts` + `lib/picture-rank.ts` (D2: barcode → Open Food/Products Facts, own items, Google Images
  via Serper on Google Israel in Hebrew then English, OFF name search, generic type, Fluent Emoji icon; filtering and a
  30-day kv cache; D3: one batched Gemini vision call ranks several items' thumbnails, low confidence → "check").
  Items carry `product_info`, `image_candidates` (≤ 6) and `image_check`; `image_source` = barcode / search / generic /
  icon. Receipt review streams pictures, "approve all", "Skip pictures"; the picker (`picture-picker.tsx`: alternatives,
  search, photo, upload, icon, none) from the review and the item sheet's "Change picture"; the daily cron backfills
  (marked "check"). `npm run test:pictures`; `npm run bench:pictures` (real keys: 15/15 right on 10 grocery + 5 maker
  lines). With `BRAVE_SEARCH_API_KEY` set Brave is used instead of Serper (no Google Israel locale).

## Round 11 — opening the app, nested overlays, History on the phone, quick actions, uniform pictures
Brief and checklist: `docs/ROUND11.md`. Shipped (branch `round11`, 2026-10-03):
- **Opening**: an inline script in the first HTML sets `<html data-boot="full|small">` before paint. Full intro only
  when the app is opened (new tab / PWA launch / first load of the session); reload, pull-to-refresh, back/forward and
  later loads in the same session (`sessionStorage nexus.opened`) show only the Box mark in a small circle where the
  pull-to-refresh leaves it. The full intro (~2.3 s, transform/opacity, 60 fps trace): a palette bloom over a drifting
  isometric grid, faces fly in with a spring, a spark dot drops on the top face and bounces twice, the wordmark slides
  up, a light sweep, then the mark flies into the top-bar logo (`[data-topbar-logo]`). Phones / installed app only.
- **Nested overlays**: Settings → Reports is a sub-page inside Settings (back arrow / Esc → list → Settings; `Modal`
  `onBack`). All overlay surfaces share one z-layer, so the one opened last is on top and an outside click / Esc closes
  only it. Smoke covers settings→reports, settings→extension, reports→report form, item sheet→picture picker, Me→reports.
- **Insights** (phone/tablet dock's last tab): Spending · History switch at the top of both views. History has its own
  search and Month / Store / Project filters and a month timeline (count + total per month); History in the Me sheet;
  searching any other view offers "Go to History" with the search carried over.
- **Quick actions** (`quick-actions.tsx`): status (On the way / Received / Back to To buy), Move to project, Delete with
  Undo, Open, Copy link, Compare, Select. Phone rows: swipe toward the start edge = Delete (full swipe deletes), toward
  the end edge = status blocks, held open until tapped, mirrored in Hebrew, haptic tick, `touch-action: pan-y`;
  long-press a row = select. Phone cards: long-press = action sheet (also the item sheet's "…" menu). Desktop: card
  hover bar (status, Move, Delete), right-click menu on cards and table rows, keys O / R / M / Delete / Enter on the
  focused card or the selection (also in the command menu while items are selected).
- **One picture style** (`lib/picture-style.ts`): flatten onto white, trim a uniform border (8 %), a cut-out on a light
  background → centred on a 480 × 480 white square with ~8 % padding; anything else → square cover crop. The style is
  in the stored file name (`…-c.webp` / `…-p.webp`, `lib/picture-url.ts`) and `ProductImage` (the one frame) shows
  cut-outs on a white paper tile (dimmed + hairline in dark) and photos full-bleed. Old pictures: daily cron batch +
  `scripts/backfill-pictures.ts`. `npm run test:picture-style`.
- **Solid tags** over pictures (`.nx-tag`, per-theme `--tag-*` tokens; contrast-checked in `scripts/contrast.mjs`).

## Round 12 — sheet swipe-down, slow-swipe lock, assistant header, Ask pill
Brief and checklist: `docs/ROUND12.md`. Shipped (branch `round12`, 2026-10-04):
- **Phone bottom sheets** (`src/components/ui/sheet-drag.ts`, one implementation): below 640 px every `Modal` and
  `Sheet` (except the nav drawer, `phone="side"`) is a bottom sheet with a drag handle — the quick-action sheet, item
  sheet, picture picker, Me, Reports, alerts, compare, assistant, settings, share, import… It follows the finger from
  the handle/header (`[data-sheet-grip]`) or from the content while it is scrolled to the top, closes past 30 % of its
  height or on a downward fling (`sheetRelease`), springs back otherwise; the scrim fades with the drag. Scrim tap and
  the back gesture close it: one shared history stack (`useBackClose`) closes only the top surface (the + menu uses it too).
- **Row swipes**: one rule both ways (`swipeRelease` in `src/lib/gestures.ts`): past 40 % of that side's actions the row
  snaps open and stays, below it closes; a fast fling decides too; same haptic tick per side. Fixed the real cause of
  "doesn't always stay open": the one-row-held guard never matched, so a row held open a second time closed itself.
  `npm run test:gestures` (slow/fast × both directions × RTL); smoke drags at 15 px/frame in en + he.
- **Assistant**: History button at the start of the header, before the Box mark (hairline between; mirrored in Hebrew),
  New chat at the end. Suggested questions are full-width rows under a small "Suggested" label — type icon (data /
  plan / help), up to 2 lines, chevron, hairline separators; follow-ups use the same rows, compact.
- **Ask button** is always a fully rounded pill (radius in `.ask-hairline`; noted in CLAUDE.md and UI-V2).

## Round 13 — Home dashboard, Shopping tab, one search, new opening
Brief and checklist: `docs/ROUND13.md`. Shipped (branch `round13`, 2026-10-04):
- **Home** (`home-view.tsx`, view `home`, the default screen — no `?v=`; both logos open it; first in the sidebar):
  header card (date, greeting, Customize) with a status strip of 3 linked tiles (need you · packages this week · ahead
  of / behind the budget pace — each scrolls to its section and flashes it) and 4 stats with meters (Left to buy split by
  project, Month budget with a today marker or vs the usual month, On the way pips, Saved this year = price drops +
  free shipping, never invented); then Nexus suggests, This week (Sun–Sat in the user's time zone; day strip + next 3
  on phones), Needs you (alerts → late → free-shipping gap → reorder; ✕/swipe hides a row 7 days), On the way, Month
  pace (spend line, usual month dashed, cap), Projects, Nexus noticed. Desktop 12-col grid; phone ≤ 1,800 px with demo
  data (pace + projects merge into "Money & projects"). Every number comes from one pure `homeModel()`
  (`src/lib/home.ts`, `npm run test:home`), incl. the reorder cadence (median gap, ≥ 3 buys, ±3 days). Empty account:
  greeting + the big add actions only. Alerts + Home prefs ride in `AppData` (`pref:home:dismissed`, `pref:home:ai`).
- **Nexus suggests**: rules find (`homeSuggestions`: a deal ≥ 10 % under the usual price, with a free-shipping partner
  when one closes the gap; reorder due; wait for the cheap weekday; a project with no budget), at most 4, "Not now" =
  7 days. Once a day the facts only go to the AI chain for a short title + why (kv `home:ai:<date>:<lang>`, mock with
  `NEXUS_AI_MOCK=1`); any failure or the setting off = templates. Settings → Assistant → "AI-written suggestions" (also
  in the command menu). Animated gradient border slides on the compositor; keyboard ←/→ pages.
- **Nexus noticed**: rules only — shipping saved by batching this month, the cheapest weekday for a tracked category
  (≥ 8 price points), a project with no budget vs similar ones; desktop 3 columns, phone one at a time with dots/swipe.
- **Customize**: reorder (drag or ↑/↓ keys on desktop, arrows on phones) and hide sections; Done saves the cookie
  `nexus_home`, Reset restores the default; the header card is fixed.
- **Shopping tab** (phone dock Home · Shopping · + · Projects · Insights; the urgent count as a badge; reopens the last
  sub-tab): two segmented cards To buy ⇄ On the way with a spring thumb (moves on the tap; the list renders in a
  transition), the list pane slides in from the end/start side (40 ms stagger, first 8), toolbar with sort (By project /
  By arrival or the usual sorts) and list ⇄ grid (list by default, remembered). List: To buy grouped by project (dot,
  count, %-bought bar), rows with a 42 px picture, store, Urgent pill, price; On the way rows with the track and an ETA
  pill. Grid: 4:3 picture on paper, Urgent/ETA pill, project pill. Swipes, long-press and selection unchanged.
- **Delivery track**: one 4-segment component (Ordered · Shipped · In country · Delivered) and one rule
  (`deliveryTrack`: time-based over the first 3, late = all 4 warn, no eta = 1 + "No date") on Home, in the On the way
  list and cards and in the item sheet.
- **One search**: the command menu's actions/settings/views live in one list (`lib/commands.ts` + `useCommands`). The
  phone search shows grouped results — Settings & actions first with theme / palette / currency / language / AI
  controls working in place and "Open all settings", then Items, Projects, Stores, "Ask Nexus about …"; empty = recent
  searches + 4 quick actions; word-aware matching in en + he. Desktop: "Search items, projects, settings…" (Ctrl K),
  matching settings/actions drop down under the field.
- **Sidebar collapse**: a panel button at the top (rotates when collapsed), a 9 px drag edge (width follows the pointer
  76–248 px, snaps at 40 %, double-click toggles, grip with aria-label + Enter/Space), Ctrl+B; mirrored in Hebrew;
  cookie `nexus_sidebar`.
- **Opening v4** (`boot-screen.tsx`, `lib/boot.ts`): 3.0 s, wordmark only — cubes gather, faces assemble, the dot lands
  and the box squashes, two rings + 14 particles, a sweep, the letters rise, a moving hold, then the box flies into the
  top-bar / sidebar logo and Home's cards rise in. Phones/PWA on app open; desktop on the first open of the day
  (`localStorage nexus.bootDay`), small loader otherwise; reduced motion = mark + word, 600 ms fade. Transform/opacity
  only (no letter blur).
- **Card borders**: `--card-line` / `--line-in` (+ warn / info / AI tints) on Home, Shopping and search cards; border vs
  surface ≥ 1.25:1 in all four themes (`npm run test:contrast`).

## Round 14 — fixes after Round 13: AI on Home, match the design, calmer light theme, calendar
Brief and checklist: `docs/ROUND14.md` (results and decisions under its "Open"). Shipped (branch `round14`, 2026-10-04):
- Ask seed: a question handed to the assistant (phone search, command menu) is sent exactly once — the store clears it
  (`consumeAskSeed`) and sent keys live outside the chat, so New chat, a reopen or a reload never resend it.
- **Home suggestions**: Home always speaks when the account has items. Order in each section: exact rules → the AI's
  look → broad rule fallbacks (≤ 4 suggestions, ≤ 3 insights). The AI look (`homeLook`, `src/lib/home-ai.ts`) runs once
  a day when the rules give < 2 suggestions or < 2 insights: the chat's compact snapshot → ≤ 3 suggestions
  `{title, why, action}` + ≤ 3 insights; unknown item / project ids and any number not in the snapshot are dropped;
  cached in kv by day + language, a failure retries after 3 h, off with "AI-written suggestions". Fallbacks
  (`fallbackSuggestions` / `fallbackInsights`): set a monthly budget, a target price for the priciest item, an arrival
  date, "Still want X?" after 30 days, the extension (desktop), a first receipt; this month's top store / category, the
  most expensive open project, items waiting > 30 days. Settings → Assistant shows last run · source · N · last error
  (kv `home:ai:diag`). `SEED_PROFILE=sparse` + `SMOKE_SPARSE` check it with AI on (mock) and off.
- **To buy filters**: one To buy with chips All · Urgent · No project (counts; `?v=to_buy&f=urgent|none`; old
  `?v=urgent` / `?v=unsorted` links redirect). Urgent / Unsorted are gone from the sidebar, command menu, assistant
  links and help. Desktop toolbar + phone Shopping (To buy side). Taking items out of a project: drop on "No project"
  or Move to → Remove from project (both with Undo). No totals card on To buy; store pages keep theirs, project pages
  their own header.
- **Phone layouts**: below 640 px the desktop Cards / Table pref is ignored everywhere (`useTable()`), the phone uses
  List / Grid only (the layout command flips it there); the table's checkbox sits 12 px from the picture.
- **Sidebar v4**: on the page background, 224 / 68 px (drag edge 68–224), 34 px rows (13.5 px / 500, 17 px muted
  icons), active row = soft tint (`--nav-active`) + 3 px accent bar (`--nav-bar`: spark; Plum: brand), 8 px project dots
  (budget ring only with a budget), avatar footer under a hairline.
- **Phone shell v4**: dock icons with labels (10.5 px / 600, active ink), top bar Box + Nexus, search / Ask / avatar
  as 36 px circles (40 px tap areas); price alerts moved to Me → Price alerts, the avatar shows an unread dot.
- Dark mode = the home-v4 mockups (cards #161616 — the mockup's #141414 misses the contrast test's card-depth rule —
  raised #1d1d1d, muted #a1a19e, ok #4ade9a, info #7aa7ff, 12–13 % tints, paper #ecebe8).
- **Calmer light theme** ("B · toned"): page #eeede9, cards #f8f7f4, lines and tints one step darker, muted / faint /
  status inks darkened to keep `test:contrast` green; Plum light the same, a little cooler; picture tiles stay white.
- Graphite logo: the left face follows the theme (#ecebe6 + 1.2 px edge #cfcdc6 / #232323 + #3d3d3d), everywhere the
  Box is drawn except the app icons and favicon.
- **Month view**: This week → Month (desktop: the card grows in place; phone: a sheet), ‹ › months, dots per event
  type, a day lists its events, each opens its item (`monthGrid`, `model.events`).
- **Calendar sync**: `GET /api/cal/<token>.ics` (public, token in kv `cal:token`, regenerable; 404 on a wrong token;
  best-effort rate limit) — arrivals (late ones on their eta day) and reorder dates, 14 days back / 60 ahead, stable
  UIDs, SEQUENCE / LAST-MODIFIED bump when a date moves (kv `cal:seq`), received / deleted / eta-less items omitted,
  titles only. Settings → Calendar: Google subscribe, Apple / Outlook (webcal), Copy, Regenerate, the refresh note.
  Month-view events get a one-off "Add to Google Calendar" until the feed is subscribed (kv `cal:subscribed`).
  `npm run test:ics` (parsed back with ical.js).
- Design parity proof: `scripts/parity.mjs` renders the mockups next to the app (same viewport, light + dark) into
  `docs/design/parity-r14/`.

## Round 15 — accounts, spaces, data isolation (multi-user foundation)
Brief and checklist: `docs/ROUND15.md` (decisions, numbers and the security checklist under its "Open"); the plan behind
it: `docs/MULTIUSER.md`, `docs/SECURITY.md`. Built on branch `round15` (Sessions 1–2, 2026-10-05/06); released in Part G
with Tal (merging deploys and runs the migration on the real database).
- **Sign-in** (Better Auth 1.7.7): Google (closed-circle mode on `vercel.app`: Google only, invite-only sign-up), passkeys
  and email-code recovery (built and tested on localhost; shown in production once the own domain + Resend exist), the
  admin password as a guarded fallback (`/login?admin=1`, ≥ 20 chars, 5/min + 20 failed/day per IP). Sessions in the DB
  (HMAC-signed cookie, checked on every request, cached ≤ 60 s), 30-day idle / 90-day absolute. Step-up = a sign-in in
  the last 10 minutes for passkey changes, recovery codes, removing a member, transferring ownership, deleting a space.
- **Google sign-in, instant and never dead** (R16 G): the tap shows a spinner + "Opening Google…" in the same frame;
  the invite check and the sign-in start run in parallel and the page then navigates itself (`disableRedirect`).
  Failures (a returned `{ error }`, a throw, offline, 429 → "Too many tries", no navigation within 6 s → "Taking longer
  than usual") show an error with **Try again** and go to the error log as kind `auth` (status only, no email); Back
  from Google (bfcache) or returning to the tab re-enables the button. The login screen warms the path on mount and on
  hover/touch (`GET /api/auth/ok` → function + DB connection; `preconnect` to accounts.google.com). Server: the OAuth
  state lives in an encrypted 10-minute cookie (`account.storeStateStrategy: "cookie"`, still bound to `state`), Better
  Auth's rate limits use one atomic upsert on `rate_limit` (`ba:` keys; Google 30/min per IP), the callback runs
  rotation + role + personal space in parallel and the security log after the response (`after()`). Functions run in
  `dub1` next to the Turso DB (`vercel.json`). Every `/api/auth/*` response has `Server-Timing` (cold / rl / state / db
  / hooks / other / total). Guard: `scripts/test-google-signin.mjs` (guards.yml); bench: `scripts/bench-signin.mjs`.
- **Invite-only sign-up**: admin invite codes (Settings → Invite codes, hashed + encrypted for re-copy), a `/join/<token>`
  space link also counts; otherwise "invite-only — leave your email" (waitlist, Turnstile when configured).
- **Settings → Security** (`/settings/security`): devices (sign one / all others out), passkeys, connected accounts,
  activity log (90 days), "Was this you?" on a new device, admin recovery codes.
- **Spaces**: every user has a personal space; shared spaces have roles owner / member / viewer. All data lives in a
  space (`space_id` on every data row, denormalised on children); `requireCtx(need)` (`src/lib/ctx.ts`) resolves user +
  current space (cookie `nexus_space`, checked against memberships on every request, else the personal space) and is the
  first line of every server action and route; the scoped data layer (`src/lib/db-scoped/`) adds `space_id` to every
  read and takes it from the ctx on every write (foreign ids → 404). Chats and memory are personal.
- **Switcher**: desktop button under the logo (tile in the space colour, name, "Shared · N people") → menu with every
  space (role, facepile, Ctrl/⌘+1…9), Create a space, Invite to <space>, Space settings, Log out. Phone: the space name
  next to the logo opens the Me sheet with the space rows. Switching keeps the view and says "Now in <space>".
- **Create a space**: name, colour (6), currency, live tile → invite step. **Invite links** `/join/<token>`: 32 random
  bytes stored hashed, member or viewer, 7 days, 5 uses, revocable; Copy, a QR drawn on the device (zxing writer, tile in
  the centre), WhatsApp, native share, reset. `/join/<token>` previews the space (name, colour, who invited, faces,
  role, expiry) → Accept (signed in) or Continue with Google (signed out; the account is created only if the link is
  still valid); expired / revoked / used-up links show a calm "ask <name> for a new link".
- **Space settings**: name / colour / currency (owner), people with last active and a role menu (member ↔ viewer,
  transfer ownership, remove — step-up), invite links with uses / expiry / revoke, leave (not the last owner), delete
  (owner, typed name, step-up, soft delete with restore for 7 days, then the cron purges rows and files). Settings
  is grouped: the current space first (Space & people, budget cap, import limit, backup/restore for owners), then You.
- **Viewer**: no add bar, no "+", no New project / list, card actions disabled with "View only", a "You can view this
  space" line; the server refuses every write anyway.
- **Move to space…** (a list's / project's edit dialog): moves the collection with its items, links, price history,
  attachments and alerts in one transaction (alternatives groups follow when complete), with Undo. Shared spaces show a
  small "added by" avatar on rows and cards.
- **Retired**: the guest system (`/g`, `/i/<token>` → "This link no longer works — ask <owner> for a new invite"; a
  list's Share keeps its public read-only `/s/<token>` link), Telegram (webhook 410, no digests) and the browser
  extension (`/api/ext/*` 410, UI hidden, the app ignores it). Code kept in the repo. Price alerts show in the app.
- Security: SSRF-safe server fetching (`safeFetch`: public addresses only, every redirect and resolved IP checked),
  enforced nonce CSP + security headers, rate limits, security events, `test:authz-coverage`, `test:scope`,
  `test:roles`, `test:tenancy` (two users + a viewer: every action with foreign ids; spaces flows; browser checks),
  `test:ssrf`, `test:headers`, `test:query-plans`; CI on every push (`.github/workflows/guards.yml`).
- Safety net: `scripts/db-snapshot.mjs` (read-only prod copy), `db-restore-test.mjs`, `db-restore-prod.mjs`
  (emergency, typed confirmation), `r15-rehearsal.mjs`; the migration (`src/db/migrate-r15.ts`) is idempotent and refuses
  a remote URL outside the Vercel build.
- Performance (`npm run bench:r15`, main vs round15 on the prod copy): Home and Shopping first load unchanged
  (~30 ms); a 2 000-item space's Home ≈ 250 ms server time; every space-scoped list query uses an index.

## UI
- English default, full Hebrew with RTL (logical CSS only). Locale toggle.
- Two palettes (Graphite & Amber, Plum) × dark/light (system default), no flash on load.
- Cards (image-first, primary) ↔ dense table toggle.
- Esc (or ⌘K / Ctrl+K) opens the command menu: search items/collections, run actions.
- Skeleton loading, short action-driven transitions, respects reduced motion.
- Mobile responsive; installable PWA.

## Telegram bot input (shipped)
Retired in Round 15 (webhook answers 410, no messages; code kept). Before that: send a product link to the linked bot → it's added (same extraction + duplicate rules as the app: same URL → "already saved",
same product from another store → added as another source). `#name` in the message files it into the matching list/project.
`/list` replies with what's left to buy. Webhook `/api/telegram`: secret header (HMAC of SESSION_SECRET) + must come from the
linked chat. The webhook is (re)set after linking, whenever the alerts state loads, and by the daily cron.

## Non-goals (for now)
Carrier API tracking sync. (Multi-user accounts arrived in Round 15; push + inbox, onboarding and the admin panel are Round 16.)

## Stack (all free tier)
Next.js 16 (App Router) on Vercel · Turso (libSQL) + Drizzle · Gemini Flash-Lite (+ optional Groq/OpenRouter) ·
Vercel Blob · Tailwind v4 · Radix primitives · cmdk · sonner · motion.

## Environment variables
| Name | Purpose |
|---|---|
| `TURSO_DATABASE_URL` | libsql://… (local dev: `file:local.db`) |
| `TURSO_AUTH_TOKEN` | Turso token |
| `GEMINI_API_KEY` | Google AI Studio key (optional: AI features off without it) |
| `GEMINI_MODEL` | optional override, default tries `gemini-3.5-flash-lite` then fallbacks |
| `GROQ_API_KEY` | optional second free AI provider (console.groq.com), used when Gemini is busy |
| `OPENROUTER_API_KEY` | optional third free AI provider (`openrouter/free`) |
| `APP_PASSWORD` | R15: the admin fallback password (≥ 20 chars; also the GitHub prod smoke's `NEXUS_PASSWORD`) |
| `SESSION_SECRET` | ≥32 random chars (pre-R15 sessions; still used by retired guest/Telegram code) |
| `BETTER_AUTH_SECRET` | R15: 32+ random bytes — signs session cookies, encrypts invite codes |
| `BETTER_AUTH_URL` | R15: the app's URL (prod `https://nexus-ashen-beta.vercel.app`, local `http://localhost:3100`) |
| `ADMIN_EMAIL` | R15: the admin account (migration owner of today's data; Settings → Invite codes) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | R15: Google sign-in (OAuth client, Testing mode) |
| `NEXT_PUBLIC_APP_URL` / `RESEND_API_KEY` / `EMAIL_FROM` | R15: own domain + email — turn on passkeys and email-code recovery in production |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | R15, optional: Cloudflare Turnstile on the waitlist |
| `NEXT_PUBLIC_APP_NAME` | optional: the product name on the new screens (default Nexus) |
| `PROD_TURSO_DATABASE_URL` / `PROD_TURSO_READ_TOKEN` | PC only, read-only: used by `scripts/db-snapshot.mjs` alone |
| `AUTH_FULL_LOCAL` | local only (`=1`): full sign-in mode (passkeys, recovery) on localhost; `0` = closed-circle mode |
| `AUTH_TEST_IDP` | tests only (`=1`, never production): the fake Google for `test:auth-flow` |
| `BLOB_READ_WRITE_TOKEN` | auto-added when a Blob store is connected |
| `CRON_SECRET` | authorizes the daily price-check cron (Vercel sends it automatically) |
| `TELEGRAM_API_BASE` | local tests only: send bot messages to a fake Telegram API (ignored on Vercel) |
| `BRAVE_SEARCH_API_KEY` | optional: web/image/shopping search for compare stores, barcode lookups and product pictures (preferred) |
| `SERPER_API_KEY` | optional alternative search provider (Google results via serper.dev) — real product pictures (Google Images, Israel/Hebrew first) |
| `NEXUS_AI_MOCK` | local tests only (`=1`): offline AI mock for the assistant, planner and receipts |
| `REPORTS_TOKEN` | optional: enables `/api/reports/export` for `node scripts/reports.mjs` (any long random string; same value locally) |
| `GITHUB_ISSUES_TOKEN` | optional: fine-grained token (Issues read/write) — each problem report also opens a GitHub issue labelled `from-app` |
| `GITHUB_ISSUES_REPO` | optional: `owner/repo` for those issues (default `talJ1235/nexus`) |
