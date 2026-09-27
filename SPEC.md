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

## UI
- English default, full Hebrew with RTL (logical CSS only). Locale toggle.
- Dark + light (system default), no flash on load.
- Cards (image-first, primary) ↔ dense table toggle.
- ⌘K / Ctrl+K command palette: search items/collections, run actions.
- Skeleton loading, short action-driven transitions, respects reduced motion.
- Mobile responsive; installable PWA.

## Non-goals (for now)
Automatic scheduled price re-checks / alerts, carrier API tracking sync, multi-user accounts.

## Stack (all free tier)
Next.js 16 (App Router) on Vercel · Turso (libSQL) + Drizzle · Gemini Flash-Lite ·
Vercel Blob · Tailwind v4 · Radix primitives · cmdk · sonner · motion.

## Environment variables
| Name | Purpose |
|---|---|
| `TURSO_DATABASE_URL` | libsql://… (local dev: `file:local.db`) |
| `TURSO_AUTH_TOKEN` | Turso token |
| `GEMINI_API_KEY` | Google AI Studio key (optional: AI features off without it) |
| `GEMINI_MODEL` | optional override, default tries `gemini-3.5-flash-lite` then fallbacks |
| `APP_PASSWORD` | login password |
| `SESSION_SECRET` | ≥32 random chars, signs the session cookie |
| `BLOB_READ_WRITE_TOKEN` | auto-added when a Blob store is connected |
