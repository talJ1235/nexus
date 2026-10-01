# Nexus help (for the assistant)

How to use Nexus, where things are, and fixes for common problems. Written from SPEC.md and the UI. Answer from this
file only; don't invent menus or settings that aren't here. UI names are given in English (Hebrew in parentheses).

## Action buttons
You may add up to 3 buttons, each on its own line, written exactly as a markdown link with a `nexus:` address. The app
turns them into buttons; only these addresses work:
- `nexus:settings` — open Settings (הגדרות): palette, theme, language, currency, monthly budget, import limit, extension
- `nexus:palette/graphite`, `nexus:palette/plum` — switch the colour palette now
- `nexus:theme/light`, `nexus:theme/dark`, `nexus:theme/system` — switch light/dark now
- `nexus:extension` — the browser extension window (download + pairing steps)
- `nexus:alerts` — Price alerts (התראות מחיר): Telegram link, watched prices, weekly summary
- `nexus:receipt` — scan or add a receipt
- `nexus:barcode` — scan a barcode
- `nexus:shop` — Shopping mode (מצב קנייה)
- `nexus:import` — import a spreadsheet / backup
- `nexus:plan` — Plan a project with Nexus
- `nexus:commands` — the command menu (Esc)
- `nexus:report` — Report a problem (sends the details to Tal)
- `nexus:view/to_buy`, `nexus:view/urgent`, `nexus:view/unsorted`, `nexus:view/ordered`, `nexus:view/history`,
  `nexus:view/orders`, `nexus:view/spending`, `nexus:view/projects`
Example: `[Open settings → Palette](nexus:settings)`.

## Where things are
<!-- spec: UI, Desktop shell, Phone shell, Collections -->
- **Desktop**: sidebar with To buy (לקנות), Urgent (דחוף), Unsorted (לא משויך), On the way (בדרך), Order by store
  (הזמנה לפי חנות), History (היסטוריה), Spending (הוצאות), then Projects (פרויקטים) and Lists (רשימות). The sidebar
  collapses with the arrow at its top. Top bar: search, "Ask Nexus", alerts bell. The paste bar floats at the bottom.
- **Phone**: top bar (logo, search, Ask, alerts) and a dock at the bottom: To buy · Projects · **+** · On the way ·
  Stats (נתונים). **+** opens: Scan a barcode (סריקת ברקוד), Scan a receipt (סריקת קבלה), Paste a link (הדבקת
  קישור), Plan with Nexus (תכנון עם Nexus).
- **Command menu**: press **Esc** (or Ctrl/⌘+K) anywhere — search items, jump to views, change settings, run actions.
- **Home (To buy)**: the totals card (what's left, total, split by project, Urgent · On the way · Spent this month —
  each is tappable), then the "To buy" header with project chips, Category, Sort and the layout switch. Desktop: cards
  or table. Phone: 2-column cards or rows (the switch at the end of the "To buy" header).
- An item opens in a sheet: picture, price, open in store, Plan (qty, priority, project/list), Stores, Price history
  and watch/target, Tags & notes, Receipts, Advanced.

## Adding products
<!-- spec: Adding items, Extraction pipeline, Product pictures, Categories -->
- Paste a product link anywhere (Ctrl/⌘+V) or into the paste bar; on phones **+ → Paste a link**. Several links at
  once work too. A placeholder card appears at once and fills in (name, price, picture, store, category).
- The same link again (still to buy) → quantity +1 (with Undo). Same product from another store → offered as another
  store for the existing item.
- Manual entry: type a name instead of a link; every field can be edited in the item sheet.
- Telegram: send a link to your linked bot (see Telegram below). Phone share sheet: share a product page to Nexus
  (installed app).
- **Missing picture?** Nexus tries the store page, then your browser extension, then an image search, and finally a
  simple icon (shown with an "icon" badge). Stores that block servers (AliExpress, Amazon, KSP…) often need the
  **browser extension** for real photos — install it and the picture is filled in by itself within ~30 minutes, or
  open the item and paste a picture/link. Pictures keep filling in daily.
- **Missing price or name?** Same cause: the store blocked the server. The extension repairs incomplete links on its
  own (every 30 min while Chrome is open). You can also type the price in the item sheet.
- Categories are fixed: Electronics, Mechanical, Tools, Materials, Computers, Camera & audio, Home & kitchen, Office,
  Clothing & personal, Other. Change one in the item sheet.

## The browser extension (Nexus Clipper)
<!-- spec: Browser extension -->
- What it does: reads product pages in **your** Chrome, so blocked stores (Amazon, KSP, AliExpress) still give name,
  price and photo; repairs incomplete items; checks prices the server can't read; powers some store comparisons.
- Install: Settings → Browser extension → **Download extension** → unzip → open `chrome://extensions` → turn on
  Developer mode → **Load unpacked** → choose the `nexus-extension` folder → reload Nexus. It connects by itself.
- **"Not installed" / not connected**: (1) make sure it's enabled in `chrome://extensions`; (2) reload the Nexus tab;
  (3) it only works in Chrome/Edge on a computer (not on phones); (4) if you updated the zip, click the reload icon on
  the extension card. The sidebar's owner card shows "Connected · v…" when it works.
- Shortcut: Alt+Shift+S saves the current product page. No extension? The bookmarklet button in the same window works
  as a lighter fallback.

## Statuses, priorities, projects and lists
<!-- spec: Item lifecycle, Partial move, Alternatives, Multi-select -->
- An item goes To buy → **Ordered** (On the way: tracking number, carrier, ETA) → **Received** (History). The price
  paid is saved when you mark it ordered. Use the truck button on a card, the sheet, or on phones swipe a row toward
  the end (rows layout). Undo is always offered.
- Priority: Urgent, Normal, Someday. Someday items are left out of store orders and the monthly forecast.
- Projects have a budget (ring in the sidebar: planned + spent vs budget); lists don't. Create one with **+** next to
  Projects/Lists. Move items by dragging cards onto a project in the sidebar, from the item sheet, or with the
  selection bar. Moving part of a quantity asks how many units move.
- Select several: hover a card and tick its box (or Ctrl/⌘-click, Shift for a range; on phones swipe a row toward the
  start). The bar at the bottom moves, sets status/priority, groups as alternatives, or deletes (with Undo).
- **Alternatives**: several options for one need, compared side by side; only the winner (or the cheapest until you
  pick) counts in totals and budgets.

## Prices, stores and money
<!-- spec: Prices & currency, Order by store, Free shipping per store, Compare stores, Import VAT, Price tracking -->
- Display currency: Settings → "Show prices in" (ILS, USD, EUR). Each store keeps its own currency; rates update twice
  a day ("Using approximate exchange rates" = the rate service was unreachable).
- **Order by store**: everything to buy grouped by store with subtotals, free-shipping progress per store ("₪23 more
  for free shipping"), "Close the gap" suggestions, and **Mark as ordered** for a whole store. Set a store's free
  shipping rule from its header.
- **Compare stores**: in an item sheet (or the scale button on a card) — Nexus searches other stores and lists the
  same product sorted by total; "Add as another store". Works best with a search key or the extension.
- **Import VAT**: foreign orders over the VAT-free limit (Settings, default $130) get a warning with the estimated 18 %
  VAT and what to split into another order.
- **Price watch**: open an item → Price history → Watch price / Target price. Prices are checked every morning; drops,
  targets and back-in-stock come as alerts (and to Telegram).

## Spending and budgets
<!-- spec: Spending, Monthly budget -->
- **Spending** (Stats on phones): this month / last month / this year, savings from cheaper stores, 12-month bars, by
  project, store and category, biggest purchases.
- Monthly budget: the pencil on "This month's budget" (Spending) or Settings. The bar shows received + ordered +
  forecast (urgent to-buy; a toggle adds normal items). Near (90 %) / over shows in colour and on Telegram.

## Receipts
<!-- spec: Receipts → purchases, Receipts v2 -->
- Add a receipt: phones **+ → Scan a receipt** (סריקת קבלה); desktop the **Receipt** (קבלה) button in the paste bar; also On the way /
  History headers, the command menu, or drop a file (photo or PDF) onto the app. You can paste an order email's text.
- The camera finds the edges by itself and takes the photo when it's steady and sharp (or press the shutter). Drag a
  corner to adjust — a magnifier shows under your finger and the corner snaps to the paper edge. Long receipts:
  **Add another part**, then **Use**.
- Review: lines already on your list are matched (change a match, add as new, or ignore), then Apply → items become
  received (or ordered for an order confirmation) with the price paid and the receipt attached. Undo is offered.
- Problems: **edges not found** → put the receipt on a darker surface, more light, whole receipt in the frame, or
  adjust the corners by hand. **Reading failed / "AI busy"** → the receipt is kept under "Not applied yet"; retry
  later. Photos need Gemini (the AI); pasted text works with any AI provider.

## Barcodes and shopping mode
<!-- spec: Barcodes, Shopping mode -->
- **Scan a barcode** (phones: + menu): find an item on your list, check it off, or add a new product (Nexus looks it
  up in product databases). Torch button in dark stores; you can type the number too.
- **Shopping mode** (command menu, a project page's Shop button, or a store in Order by store): pick everything / a
  store / a project; tap a row to check it, long-press to change qty/price, quick-add at the bottom, scan to check off.
  The trip works offline and syncs when you're back online. Finish marks the checked items as received.

## The assistant (Ask Nexus)
<!-- spec: AI assistant, Assistant actions, Assistant v2, Assistant suggestions -->
- Ask about your data ("how much is left for Railcam?") or how to use Nexus. Tap a suggested question to ask it.
- Ask it to change things ("mark the NEMA motors as ordered", "move these to a new project Drone"): it proposes the
  change and nothing happens until you press **Apply** (Undo after). It never deletes.
- **Plan a project** (tab in the assistant, or + → Plan with Nexus): describe the project, get a parts list with
  quantities and price estimates, add it as a new project.
- **"AI busy" / no answer**: the free AI providers hit their limits; Nexus switches between Gemini, Groq and
  OpenRouter automatically. Wait a minute and ask again. Without any AI key the assistant is off.

## Telegram
<!-- spec: Telegram bot input, Weekly Telegram summary -->
- Link it: Price alerts (bell) → Telegram → in Telegram open @BotFather, send /newbot, paste the token, then press
  Start in your new bot. After that: price alerts every morning, budget warnings, a weekly summary on Sundays (toggle
  in the same panel), and you can **send product links to the bot** to add them (`#name` files it into that
  project/list; `/list` replies with what's left).
- Not getting messages: open the bell → Telegram → **Send test**; if it fails, Disconnect and link again.

## Sharing
<!-- spec: Sharing with permissions, Users & access -->
- Open a project or list → **Share**: an invite link as viewer or editor (revocable), or a read-only link. Guests
  type a name once; editors can add links and change qty/priority/notes; they never see receipts or other lists.
- Revoke a link from the same Share window. Guests can't use the assistant or report problems.

## Look and language
<!-- spec: Design system, Box logo, Mixed Hebrew/English text -->
- Palette: Settings (הגדרות) → Palette (צבעים) → **Graphite & Amber** (גרפיט וענבר, default) or **Plum** (שזיף). Theme
  (ערכת נושא): Light / Dark / System. Both
  change instantly, per device. Language: Settings → Language (English / עברית, full right-to-left).
- Mixed Hebrew/English titles are shown in their natural direction.

## Offline and the phone app
<!-- spec: Offline, read-only v1, First load -->
- Install: in the phone browser menu → "Add to Home screen" (Chrome) / Share → "Add to Home Screen" (Safari).
- **Offline**: after one online visit the app opens without a connection and shows "Offline — showing data from
  <time>". It's read-only offline (adding/editing is disabled); shopping mode trips sync later. Back online it
  refreshes by itself.
- Logging out clears the offline copy.

## Import, export and backup
<!-- spec: Import & backup -->
- Import a parts or shopping list from Excel/CSV (command menu → Import): Nexus detects columns (English or Hebrew
  headers), creates missing projects, and can fill in details from links.
- Full JSON backup (download) and restore (merge or replace): Settings, or the command menu → Backup. Secrets are never
  in a backup. (There is no Excel export button in the app at the moment.)

## Common problems
- **A product is missing its picture or price** → the store blocked the server; install/connect the extension, wait a
  bit, or set it by hand in the item sheet.
- **"Not installed" / extension not connected** → see The browser extension.
- **AI busy** → wait a minute; limits reset quickly. Receipts from photos need Gemini specifically.
- **Telegram silent** → Send test in the alerts panel; relink if it fails.
- **Totals look wrong** → alternatives count only the winner/cheapest; someday items are left out of store orders;
  check the display currency.
- **Something is broken or you have an idea** → offer `[Report a problem](nexus:report)`.
