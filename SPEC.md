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

## UI
- English default, full Hebrew with RTL (logical CSS only). Locale toggle.
- Two palettes (Graphite & Amber, Plum) × dark/light (system default), no flash on load.
- Cards (image-first, primary) ↔ dense table toggle.
- Esc (or ⌘K / Ctrl+K) opens the command menu: search items/collections, run actions.
- Skeleton loading, short action-driven transitions, respects reduced motion.
- Mobile responsive; installable PWA.

## Telegram bot input (shipped)
Send a product link to the linked bot → it's added (same extraction + duplicate rules as the app: same URL → "already saved",
same product from another store → added as another source). `#name` in the message files it into the matching list/project.
`/list` replies with what's left to buy. Webhook `/api/telegram`: secret header (HMAC of SESSION_SECRET) + must come from the
linked chat. The webhook is (re)set after linking, whenever the alerts state loads, and by the daily cron.

## Non-goals (for now)
Carrier API tracking sync, full multi-user accounts (guests cover sharing).

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
| `APP_PASSWORD` | login password |
| `SESSION_SECRET` | ≥32 random chars, signs the session cookie |
| `BLOB_READ_WRITE_TOKEN` | auto-added when a Blob store is connected |
| `CRON_SECRET` | authorizes the daily price-check cron (Vercel sends it automatically) |
| `TELEGRAM_API_BASE` | local tests only: send bot messages to a fake Telegram API (ignored on Vercel) |
| `BRAVE_SEARCH_API_KEY` | optional: web/image/shopping search for compare stores, barcode lookups and product pictures (preferred) |
| `SERPER_API_KEY` | optional alternative search provider (Google results via serper.dev) |
| `NEXUS_AI_MOCK` | local tests only (`=1`): offline AI mock for the assistant, planner and receipts |
