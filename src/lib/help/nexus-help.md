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
- `nexus:view/home`, `nexus:view/to_buy`, `nexus:view/ordered`, `nexus:view/history`, `nexus:view/orders`,
  `nexus:view/spending`, `nexus:view/projects`
Example: `[Open settings → Palette](nexus:settings)`.

## Where things are
<!-- spec: UI, Desktop shell, Phone shell, Collections, Phone fit, Home hierarchy, Phone shell v2, Home, Shopping tab, Sidebar collapse, Customize, Insights -->
- **Desktop**: sidebar with Home (בית), To buy (לקנות), On the way (בדרך), Order by store
  (הזמנה לפי חנות), History (היסטוריה), Spending (הוצאות), then Projects (פרויקטים) and Lists (רשימות). The sidebar
  collapses with the panel button at its top (or by dragging its edge, or Ctrl+B). Top bar: search, "Ask Nexus",
  alerts bell. The paste bar floats at the bottom. The Nexus logo always goes back to Home.
- **Phone**: top bar (the Nexus logo, search, Ask and your initial — an orange dot on it means unread price alerts) and
  a dock at the bottom with labels, the same order in every language: Home (בית) · Shopping (קניות) · **+** · Projects ·
  Insights (נתונים). Shopping holds To buy ⇄ On the way
  (the two big cards at its top switch between them; it reopens the one you used last), with a List / Grid switch
  (list by default, remembered) and Sort (By project / By arrival). **+** opens four coloured tiles: Scan a barcode
  (סריקת ברקוד), Scan a receipt (סריקת קבלה), Paste a link (הדבקת קישור), Plan with Nexus (תכנון עם Nexus).
- **Settings on the phone**: tap your initial (the round button at the end of the top bar) → the "Me" sheet:
  Settings, palette and theme, Browser extension, Price alerts (התראות מחיר), Telegram, Reports, Report a problem,
  Export to Excel, Backup, Sign out.
- **Command menu**: press **Esc** (or Ctrl/⌘+K) anywhere — search items, jump to views, change settings, run actions.
- **Home** (בית, the screen the app opens on): the date and greeting, a status strip (things that need you · packages
  this week · ahead of or behind your budget pace — each scrolls to its section), four stats (Left to buy, Month
  budget, On the way, Saved this year), "Nexus suggests" (one idea at a time; Not now hides it for 7 days), This week
  (its **Month** link opens the month calendar — see Calendar below),
  Needs you (price drops, late packages, free-shipping gaps, time to reorder — ✕ or a swipe hides one for 7 days),
  On the way, Month pace, Projects and "Nexus noticed". **Customize** (top of Home) reorders or hides sections.
  Settings → Assistant → "AI-written suggestions" switches the AI wording of suggestions off (templates only).
<!-- spec: To buy filters, Phone layouts -->
- **To buy** (one list — there are no separate Urgent / Unsorted pages any more): the "To buy" header with filter chips
  **All · Urgent (דחוף) · No project (ללא פרויקט)**, each with its count, then project chips, Category, Sort and the
  layout switch. Desktop: cards or table. Phone: the same chips under the To buy ⇄ On the way switch; list (grouped by
  project) or 2-column grid. To take items out of a project: select them → Move to → Remove from project (הסרה
  מהפרויקט), or on desktop drag them onto the "No project" chip. The totals and indicators live on Home and Spending
  (a project's or a store's page keeps its own budget / free-shipping summary).
- **List / Grid on the phone**: the round switch next to Sort (or "Grid" / "List" in the phone search). Phones always
  use List or Grid; the desktop's Cards / Table choice never applies there.
- An item opens in a sheet: picture, price, open in store, Plan (qty, priority, project/list), Stores, Price history
  and watch/target, Tags & notes, Receipts, Advanced.

## Home suggestions, insights and deliveries
<!-- spec: Nexus suggests, Nexus noticed, Delivery track, Home suggestions -->
- **Nexus suggests** (top of Home): one idea at a time — a deal on something you want (sometimes "order both" when
  another item makes the order ship free), time to reorder something you buy regularly, a cheaper weekday, a project
  without a budget. The main button does it; "Not now" hides it for 7 days. Wording comes from the AI once a day;
  Settings → Assistant → "AI-written suggestions" off = plain wording, no AI calls.
- Home always has something to say once you have items: when those exact rules find little, the AI looks at your list
  once a day (it may only point at your own items and numbers), and simple tips fill in — set a monthly budget, a target
  price for your priciest item, an arrival date for an order, "still want X?" after 30 days, the extension, a receipt.
  Settings → Assistant shows "Home suggestions: last run … · source rules/AI · N items" and the last error, if any.
- **Nexus noticed**: short facts from your own data (shipping saved by ordering together, a cheaper weekday for a
  category, a project without a budget), each with one link.
- Deliveries show one 4-step track — Ordered · Shipped · In country · Delivered — estimated from the order date and the
  expected date (we don't read carrier stages); late = all four in orange; no date = one step and "No date".

## Calendar
<!-- spec: Month view, Calendar sync -->
- **Month view**: on Home, This week → **Month** (חודש). Desktop: the card grows into a month grid; phone: a sheet.
  ‹ › move between months; coloured dots mark arrivals, late packages, reorder dates, price drops and the budget week
  close; tap a day to list its events, tap an event to open the item.
- **Calendar sync**: Settings → **Calendar** (לוח שנה) → **Subscribe in Google Calendar**, or **Apple / Outlook** (a
  webcal link), or **Copy link**. Your calendar then shows "📦 X arrives" on each expected date and "🔁 Reorder X";
  moved dates move and received or deleted items disappear on their own. Google refreshes subscribed calendars every
  few hours, so changes can take up to a day. Only item names are shared — no prices or stores. **Regenerate link**
  makes a new secret address and stops the old one (subscribe again with the new one).
- Before you subscribe, each event in the month view has an **Add to Google Calendar** button (a one-off copy that
  won't follow later changes); once you've subscribed, those buttons go away to avoid duplicates.

## Search, menus and gestures
<!-- spec: One search, Nested overlays, Quick actions, Row swipes, Phone bottom sheets -->
- Phone: the search button opens one search for everything — settings and actions first (theme, palette, currency,
  language and AI suggestions switch right in the results), then items, projects, stores and "Ask Nexus about …".
  Computer: the same in the command menu (Ctrl K or Esc); typing in the top search also lists matching settings.
- A window opened from another opens on top, and Esc / an outside click closes only the top one.
- Quick actions: phone rows swipe toward the start edge to delete, toward the end edge for On the way / Received
  (past 40 % they stay open); long-press a row to select, a card for its action sheet; computer: hover bar, right-click,
  keys O / R / M / Delete. Every bottom sheet on the phone closes with a swipe down, the scrim or Back.

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
<!-- spec: Design system, Box logo, Mixed Hebrew/English text, Dark mode depth, One picture style, Solid tags, Ask button, Card borders, Sidebar v4, Phone shell v4, Calmer light theme -->
- The desktop sidebar marks the open page with a soft tint and a thin coloured bar; the phone dock has labels; the light
  theme is a calm, slightly darker paper tone; the logo's side face follows light / dark (Graphite).
- Pictures share one style (cut-outs on a white tile, photos full-bleed); tags over pictures are solid; "Ask Nexus" is
  always a rounded pill; Home and Shopping cards have a clearer 1 px outline.
- Palette: Settings (הגדרות) → Palette (צבעים) → **Graphite & Amber** (גרפיט וענבר, default) or **Plum** (שזיף). Theme
  (ערכת נושא): Light / Dark / System. Both
  change instantly, per device. Language: Settings → Language (English / עברית, full right-to-left).
- Mixed Hebrew/English titles are shown in their natural direction.

## Offline and the phone app
<!-- spec: Offline, read-only v1, First load, Loading skeletons, Opening, Opening v4 -->
- The opening (3 s): on the phone when the app is opened, on the computer the first time each day; reloads show only a
  small Box mark. It always plays to the end.
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
