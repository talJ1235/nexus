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
- `nexus:view/home`, `nexus:view/to_buy`, `nexus:view/urgent`, `nexus:view/unsorted`, `nexus:view/ordered`, `nexus:view/history`,
  `nexus:view/orders`, `nexus:view/spending`, `nexus:view/projects`
Example: `[Open settings → Palette](nexus:settings)`.

## Where things are
<!-- spec: UI, Desktop shell, Phone shell, Collections, Phone fit, Home hierarchy, Phone shell v2 -->
- **Desktop**: sidebar with Home (בית), To buy (לקנות), Urgent (דחוף), Unsorted (לא משויך), On the way (בדרך), Order by store
  (הזמנה לפי חנות), History (היסטוריה), Spending (הוצאות), then Projects (פרויקטים) and Lists (רשימות). The sidebar
  collapses with the panel button at its top (or by dragging its edge, or Ctrl+B). Top bar: search, "Ask Nexus",
  alerts bell. The paste bar floats at the bottom. The Nexus logo always goes back to Home.
- **Phone**: top bar (your initial, logo, search, Ask, alerts) and a dock at the bottom, the same order in every
  language: Home (בית) · Shopping (קניות) · **+** · Projects · Insights (נתונים). Shopping holds To buy ⇄ On the way
  (the two big cards at its top switch between them; it reopens the one you used last), with a List / Grid switch
  (list by default, remembered) and Sort (By project / By arrival). **+** opens four coloured tiles: Scan a barcode
  (סריקת ברקוד), Scan a receipt (סריקת קבלה), Paste a link (הדבקת קישור), Plan with Nexus (תכנון עם Nexus).
- **Settings on the phone**: tap your initial (the round button at the start of the top bar) → the "Me" sheet:
  Settings, palette and theme, Browser extension, Telegram, Reports, Report a problem, Export to Excel, Backup, Sign out.
- **Command menu**: press **Esc** (or Ctrl/⌘+K) anywhere — search items, jump to views, change settings, run actions.
- **Home** (בית, the screen the app opens on): the date and greeting, a status strip (things that need you · packages
  this week · ahead of or behind your budget pace — each scrolls to its section), four stats (Left to buy, Month
  budget, On the way, Saved this year), "Nexus suggests" (one idea at a time; Not now hides it for 7 days), This week,
  Needs you (price drops, late packages, free-shipping gaps, time to reorder — ✕ or a swipe hides one for 7 days),
  On the way, Month pace, Projects and "Nexus noticed". **Customize** (top of Home) reorders or hides sections.
  Settings → Assistant → "AI-written suggestions" switches the AI wording of suggestions off (templates only).
- **To buy**: the totals card (what's left, total, split by project, Urgent · On the way · Spent this month —
  each is tappable), then the "To buy" header with project chips, Category, Sort and the layout switch. Desktop: cards
  or table. Phone: list (grouped by project) or 2-column grid.
- An item opens in a sheet: picture, price, open in store, Plan (qty, priority, project/list), Stores, Price history
  and watch/target, Tags & notes, Receipts, Advanced.

## Adding products
<!-- spec: Adding items, Extraction pipeline, Product pictures, Real product pictures, Categories -->
- Paste a product link anywhere (Ctrl/⌘+V) or into the paste bar; on phones **+ → Paste a link**. Several links at
  once work too. A placeholder card appears at once and fills in (name, price, picture, store, category).
- The same link again (still to buy) → quantity +1 (with Undo). Same product from another store → offered as another
  store for the existing item.
- Manual entry: type a name instead of a link; every field can be edited in the item sheet.
- Telegram: send a link to your linked bot (see Telegram below). Phone share sheet: share a product page to Nexus
  (installed app).
- **Pictures** work on phone and desktop without the extension: Nexus reads what the product is (even abbreviated
  receipt lines like "חלב תנ 3%"), then looks it up like a Google search — the barcode, your own items, Google Images,
  Open Food Facts, a similar product, and only last an icon — and picks the right photo. A guess it isn't sure of has a
  soft highlight ("Looks right" in the item sheet). **Change picture**: tap the picture in the item sheet (or on a
  receipt card) → choose another, search in Hebrew or English, take a photo, upload, use an icon, or no picture.
- **Missing picture?** It keeps filling in daily. Without a search key (Settings → Product pictures) only barcodes,
  Open Food Facts, your items and icons are used. Stores that block servers may still get a real photo from the
  **browser extension** in the background.
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
<!-- spec: Item lifecycle, Partial move, Alternatives, Multi-select, Project pages, Projects page v2 -->
- An item goes To buy → **Ordered** (On the way: tracking number, carrier, ETA) → **Received** (History). The price
  paid is saved when you mark it ordered. Use the truck button on a card, the sheet, or on phones swipe a row toward
  the end (rows layout). Undo is always offered.
- Priority: Urgent, Normal, Someday. Someday items are left out of store orders and the monthly forecast.
- Projects have a budget (ring in the sidebar: planned + spent vs budget); lists don't. Create one with **+** next to
  Projects/Lists, the **New** pill (New project / New list) on the Projects page, or its "Start something new" card at
  the bottom. The Projects page shows a summary (active projects, left to buy, the budget nearest its limit), then
  Projects, then Lists. A project's page shows its cover, ring and numbers,
  with Plan with Nexus, Shop this project, Share and the ⋯ menu (Export to Excel, Edit). Move items by dragging cards onto a project in the sidebar, from the item sheet, or with the
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
<!-- spec: Receipts → purchases, Receipts v2, Receipt edge detection, Receipt camera -->
- Add a receipt: phones **+ → Scan a receipt** (סריקת קבלה); desktop the **Receipt** (קבלה) button in the paste bar; also On the way /
  History headers, the command menu, or drop a file (photo or PDF) onto the app. You can paste an order email's text.
- The camera finds the edges by itself and takes the photo when it's steady and sharp (or press the shutter). Drag a
  corner to adjust — a magnifier shows under your finger and the corner snaps to the paper edge. Long receipts:
  **Add another part**, then **Use**.
- Review: lines already on your list are matched (change a match, add as new, or ignore), then Apply → items become
  received (or ordered for an order confirmation) with the price paid and the receipt attached. Undo is offered.
- New lines get their pictures while you review: **Pictures look right — approve all** approves them in one tap (Apply
  does too); tap a picture to change it; **Skip pictures** adds the items now and the pictures follow.
- Problems: **edges not found** → put the receipt on a darker surface, more light, whole receipt in the frame, or
  adjust the corners by hand. **Reading failed / "AI busy"** → the receipt is kept under "Not applied yet"; retry
  later. Photos need Gemini (the AI); pasted text works with any AI provider.

## Barcodes and shopping mode
<!-- spec: Barcodes, Shopping mode, Faster camera -->
- **Scan a barcode** (phones: + menu): find an item on your list, check it off, or add a new product (Nexus looks it
  up in product databases). Torch button in dark stores; you can type the number too. The camera opens at once (the
  scanner is prepared in the background) and turns off as soon as you close it.
- **Shopping mode** (command menu, a project page's Shop button, or a store in Order by store): pick everything / a
  store / a project; tap a row to check it, long-press to change qty/price, quick-add at the bottom, scan to check off.
  The trip works offline and syncs when you're back online. Finish marks the checked items as received.

## The assistant (Ask Nexus)
<!-- spec: AI assistant, Assistant actions, Assistant v2, Assistant suggestions, Assistant, One chat, Conversation history, Memory, Smarter suggestions -->
- Ask about your data ("how much is left for Railcam?") or how to use Nexus. Tap a suggested question to ask it.
- Ask it to change things ("mark the NEMA motors as ordered", "move these to a new project Drone"): it proposes the
  change and nothing happens until you press **Apply** (Undo after). It never deletes.
- **One chat, two modes**: under the chat box switch **Chat** / **Plan a project**. In Plan mode the next message is a
  project description → a parts list card in the chat (quantities, estimates, the store you'd usually buy from, budget
  fit) with **Add** per line and **Add all to…** a project. "Plan with Nexus" (+ menu, project page) opens Plan mode.
- **History**: the clock button in the assistant's header lists past conversations (search, rename, delete with
  Undo); the pencil starts a new chat. A conversation from the last 2 hours reopens by itself. You can ask "how did I
  … last time?" and Nexus looks through earlier conversations.
- **Memory** ("What Nexus knows about you", in Settings): Nexus works out your usual stores, categories, price ranges
  and brands from your purchases, and when you say something like "I prefer Wera tools" it offers to remember it
  (tap Remember). Notes can be edited or deleted there, and memory can be switched off. It never keeps personal data.
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
<!-- spec: Design system, Box logo, Mixed Hebrew/English text, Dark mode depth -->
- Palette: Settings (הגדרות) → Palette (צבעים) → **Graphite & Amber** (גרפיט וענבר, default) or **Plum** (שזיף). Theme
  (ערכת נושא): Light / Dark / System. Both
  change instantly, per device. Language: Settings → Language (English / עברית, full right-to-left).
- Mixed Hebrew/English titles are shown in their natural direction.

## Offline and the phone app
<!-- spec: Offline, read-only v1, First load, Loading skeletons -->
- On the phone the Nexus box animation plays on every open and reload; pull down at the top of a page to reload.
  While a page loads, its outline (cards, store groups, project header) shows in place.
- Install: in the phone browser menu → "Add to Home screen" (Chrome) / Share → "Add to Home Screen" (Safari).
- **Offline**: after one online visit the app opens without a connection and shows "Offline — showing data from
  <time>". It's read-only offline (adding/editing is disabled); shopping mode trips sync later. Back online it
  refreshes by itself.
- Logging out clears the offline copy.

## Import, export and backup
<!-- spec: Import & backup, Excel export -->
- Import a parts or shopping list from Excel/CSV (command menu → Import): Nexus detects columns (English or Hebrew
  headers), creates missing projects, and can fill in details from links.
- **Export to Excel** (a BOM: item, qty, unit price, total, store, link, priority, status): a project or list page →
  the ⋯ menu → Export to Excel; the command menu → Export to Excel (the current project/list, or everything to buy);
  phones: the Me sheet → Export to Excel.
- Full JSON backup (download) and restore (merge or replace): Settings, or the command menu → Backup. Secrets are never
  in a backup.

## Report a problem
<!-- spec: Reports, Simpler reports -->
- From the assistant (it drafts the report when you say something is broken or have an idea), the command menu,
  Settings, or the phone's Me sheet: choose Bug / Complaint / Idea, write what happened in one box (for a bug also
  what you expected), optionally add a screenshot, Send. What's attached automatically is listed under "Included
  automatically" (screen, device, versions, recent errors — never personal data or prices).
- Your reports and their status (open / in progress / fixed / won't fix): Settings → Reports, or the command menu.

## Common problems
- **A product is missing its picture or price** → the store blocked the server; install/connect the extension, wait a
  bit, or set it by hand in the item sheet.
- **"Not installed" / extension not connected** → see The browser extension.
- **AI busy** → wait a minute; limits reset quickly. Receipts from photos need Gemini specifically.
- **Telegram silent** → Send test in the alerts panel; relink if it fails.
- **Totals look wrong** → alternatives count only the winner/cheapest; someday items are left out of store orders;
  check the display currency.
- **Something is broken or you have an idea** → offer `[Report a problem](nexus:report)`.
