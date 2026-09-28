# Round 4 brief (from Tal, 2026-09-29) — read this instead of the chat history

Two sessions. Session A = look & feel (design-heavy). Session B = reliability (research-heavy).
Quality bar: "very professional, refined, beautiful". Token budget matters: follow CLAUDE.md "Working efficiently".

## Session A — visual refresh + UX
1. **Overall look**: more professional, refined; nicer colour palette (dark + light). Today: near-black greys + mustard/orange
   accent (#c8902f-ish price tags, orange "Add"). Tal likes the product *cards* layout — keep it, improve data arrangement
   and colours. Design tokens live in `src/app/globals.css`. Decide a palette first, apply via tokens only.
2. **Mixed Hebrew/English titles**: e.g. "NOCO GENIUS1EU מטען מצברים", "Xiaomi … Lite מאוורר עומד חכם",
   "Elegoo PLA 1.75mm אדום" render with neutral/latin runs in the wrong place ("אדוםmm") and titles starting from different
   sides (Hebrew-first titles right-aligned inside an English page). Requirement: every title aligned to the page's
   start edge, one consistent line start, correct bidi order. Likely fix: don't let `dir="auto"` drive alignment —
   align by page direction, isolate the title run (`<bdi>`/`unicode-bidi: isolate` or `plaintext`) — check cards, table,
   item sheet, guest view, palette, share page.
3. **Loading spinners** everywhere (AI "thinking" indicator, add-product spinner, any `animate-spin`) look too fast and
   choppy. Replace with one smooth, slower, elegant loading component used everywhere.
4. **Add-link feedback**: the small status chip under the paste bar ("Reading the product page… aliexpress.co…",
   "✓ NEMA 17 …") is too small to notice. Wanted: when a link is pasted, a placeholder card/row appears immediately in the
   grid/table with a smooth skeleton/shimmer, then fills in (image, title, price) with a nice transition when processing
   ends; clear failure state on that card. Fast, obvious feedback that the link was accepted. Better ideas welcome.
5. **Item edit panel** (right sheet: status tabs, image+price, Qty, Priority, Project or list, Stores, Price history,
   Watch price, Target price, Tags, Notes): make it friendlier, more beautiful and professional (hierarchy, grouping,
   spacing, less form-like).
6. **Same link pasted twice** → just add +1 to that item's quantity (toast with undo), instead of the duplicate dialog.
   (Same product from a *different* store keeps the existing "add as another store" behaviour.)
7. **Partial move to a project**: when moving an item with quantity > 1 to a project/list, let the user choose how many
   units move (default = all). Moving fewer splits the item: N units go to the target, the rest stay. Inside the new
   edit panel UX (and bulk move if cheap).

## Session B — reliability
8. **Guest editors adding links** (shared list, no extension): products arrive without image/title (e.g. "AliExpress item",
   placeholder image). Asking the guest to install the extension is NOT acceptable. Find a server-side solution
   (research: why extraction fails from Vercel for AliExpress etc.; options like Gemini url-context fetch, store-specific
   endpoints/APIs, oEmbed/og via other fetchers, or letting the owner's extension fill "needs details" items in the
   background later). Must work for the guest immediately or self-heal soon after without anyone's action.
9. **AI assistant often "not available"** (Gemini free tier overloaded). Make it dependable: better fallback chain /
   retries / possibly a second free provider. Keep secrets out of chat (Tal adds keys in Vercel himself).
