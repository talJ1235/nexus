# Nexus help (for the assistant)

How to use Nexus, where things are, and fixes for common problems. Written from SPEC.md and the UI. Answer from this
file only; don't invent menus or settings that aren't here. UI names are given in English (Hebrew in parentheses).

## Action buttons
You may add up to 3 buttons, each on its own line, written exactly as a markdown link with a `nexus:` address. The app
turns them into buttons; only these addresses work:
- `nexus:settings` — open Settings (הגדרות): You (account, display, notifications, assistant, calendar, memory, data) and the space (general, people, budget, danger zone)
- `nexus:palette/graphite`, `nexus:palette/plum` — switch the colour palette now
- `nexus:theme/light`, `nexus:theme/dark`, `nexus:theme/system` — switch light/dark now
- `nexus:alerts` — Price alerts (התראות מחיר): recent alerts and when to alert
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
  alerts bell. The paste bar floats at the bottom. The Nexus logo always goes back to Home. Under the logo: the
  **space switcher** (see Spaces below).
- **Phone**: top bar (the Nexus logo with the current space's name — tap it to switch — search, Ask and your initial — an orange dot on it means unread price alerts) and
  a dock at the bottom with labels, the same order in every language: Home (בית) · Shopping (קניות) · **+** · Projects ·
  Insights (נתונים). Shopping holds To buy ⇄ On the way
  (the two big cards at its top switch between them; it reopens the one you used last), with a List / Grid switch
  (list by default, remembered) and Sort (By project / By arrival). **+** opens four coloured tiles: Scan a barcode
  (סריקת ברקוד), Scan a receipt (סריקת קבלה), Paste a link (הדבקת קישור), Plan with Nexus (תכנון עם Nexus).
- **Settings on the phone**: tap your initial (end of the top bar) → the "Me" sheet (spaces, palette, theme,
  Settings, History, Price alerts, Reports, Report a problem, Export, Backup, Sign out).
- **Command menu**: press **Esc** (or Ctrl/⌘+K) anywhere — search items, jump to views, change settings, run actions.
- **Home** (בית, the screen the app opens on): the greeting, a status strip (things that need you · packages this
  week · budget pace — each scrolls to its widget) and **widgets**: Left to buy, Budget, On the way, Saved, Nexus
  suggests, This week (**Month** opens the month calendar), Needs you (✕ or a swipe hides a row for 7 days),
  Deliveries, Month pace, Projects, Nexus noticed, and new ones: Price drops, Vs last month, Next delivery, Budget by
  category, Most bought, Space today (who added or bought what in a shared space).
<!-- spec: Home widgets -->
- **Customize** (top of Home) → presets **Household · Maker · Deal watcher · Minimal**, or arrange your own: drag a
  widget by its dots (or arrow keys), resize by the corner or the size menu (S / M / L wide, 1× / 2× tall; phones:
  Half / Full and 2×), hide it (eye), add one from the Widgets list (desktop) or **Add widget** (phone). Reset = the
  Household preset; Done saves it — for you, per space.
<!-- spec: To buy filters, Phone layouts -->
- **To buy** (one list — there are no separate Urgent / Unsorted pages any more): the "To buy" header with filter chips
  **All · Urgent (דחוף) · No project (ללא פרויקט)**, each with its count, then project chips, Category, Sort and the
  layout switch. Desktop: cards or table. Phone: the same chips under the To buy ⇄ On the way switch; list (grouped by
  project) or 2-column grid. To take items out of a project: select them → Move to → Remove from project (הסרה
  מהפרויקט), or on desktop drag them onto the "No project" chip. Totals live on Home and Spending.
- **List / Grid on the phone**: the round switch next to Sort; the desktop's Cards / Table never applies there.
- An item opens in a sheet: picture, price, open in store, Plan (qty, priority, project/list), Stores, Price history
  and watch/target, Tags & notes, Receipts, Advanced.

## Accounts and sign-in
<!-- spec: Sign-in, Google sign-in, Invite-only sign-up, Settings → Security -->
- Sign in with **Google** (התחברות עם Google). Nexus is invite-only for now: a new account needs an invite code from Tal
  or an invite link to a space; without one you can leave your email on the waitlist. A failed sign-in says why, with
  **Try again** (נסו שוב).
- **Settings → Account & security** (חשבון ואבטחה): your name, a security checkup, sign-in methods (Google,
  passkeys), devices (sign one out, or all the others; a new sign-in to review is at the top — "No, sign it out" ends
  it), and Activity & recovery. **Confirm it's you** (sign in again) is asked before removing someone, transferring
  ownership, deleting a space or changing passkeys. Tal (admin): Account → **Invite codes**.

## Spaces and people
<!-- spec: Spaces, Switcher, Create a space, Space settings, Viewer, Move to space…, Space look, Space switch moment -->
- Everything lives in a **space** (מרחב): your **personal** space (only you) and **shared** spaces (a household, a
  workshop…), each with its own lists, projects, items and budget. Assistant chats and memory stay personal.
- **Switch**: desktop — the button under the logo (or Ctrl/⌘+1…9); phone — tap the space chip in the top bar. Its tile
  flies to the centre — "You're now in …" — and you land on its Home (tap to skip).
- **Create a space**: switcher → Create a space → name, icon and colour (or a photo) → invite people (or Skip).
- **Invite**: switcher → Invite → **Member** (adds and edits) or **Viewer** (only looks) → Copy the link, QR, WhatsApp
  or Share. A link works 7 days for up to 5 people. Roles: Owner manages people and the space.
- **Space settings** (switcher → Space settings, or Settings → the space's sections): **General** (name, currency, the
  look), **People & invites** (roles, remove, transfer, links + QR, Revoke), **Budget** (monthly budget, by category,
  "Warn everyone at 80%", import limit), **Danger zone** (transfer, **Leave**, **Delete** — type its name; restorable
  for 7 days).
- **Space look** (owners): Edit look → an icon (24) and one of 6 colours, or **Photo** — from the device or the camera,
  then drag / pinch or the slider to zoom, Rotate, Save. The photo is stored small, without location data.
- **Move a list or project to another space**: its edit window (pencil) → **Move to space…** (items, links, price history
  and files go along; Undo in the toast). In shared spaces a small avatar on each item shows who added it.
<!-- spec: Live shared spaces, Conflicts -->
- **Live**: in a shared space, changes by others appear within a second, no refresh. Green dots = who's here now;
  "Noa is shopping"; small toasts like "Noa added 3 items" (Settings → Notifications). If two people change the same
  thing, the second sees "Noa changed this a moment ago" with **Show** or **Apply mine**; different fields just merge.

## Home suggestions, insights and deliveries
<!-- spec: Nexus suggests, Nexus noticed, Delivery track, Home suggestions -->
- **Nexus suggests**: one idea at a time — a deal on something you want (sometimes "order both" for free shipping),
  time to reorder, a cheaper weekday, a project without a budget. The button does it; "Not now" hides it for 7 days.
  When the exact rules find little, the AI looks once a day (only at your own items and numbers) and simple tips fill
  in. Settings → Assistant & AI: AI + rules, or Rules only (no AI calls); Status shows the last run and any error.
- **Nexus noticed**: short facts from your data (shipping saved, a cheaper weekday, a project without a budget).
- Deliveries show a 4-step track — Ordered · Shipped · In country · Delivered — estimated from the order and expected
  dates; late = all four in orange; no date = "No date".

## Calendar
<!-- spec: Month view, Calendar sync -->
- **Month view**: Home → This week → **Month** (חודש): ‹ › between months, dots for arrivals, late packages, reorder
  dates, price drops and the budget; tap a day for its events.
- **Calendar sync**: Settings → **Calendar** (לוח שנה) → **Add to Google Calendar**, **Apple / Outlook** (webcal) or
  **Copy**. It shows "📦 X arrives" and "🔁 Reorder X" (choose which); moved dates move, received or deleted items go
  (Google refreshes every few hours). Names only — no prices or stores. **Reset link** stops the old address.
- Before you subscribe, events in the month view have a one-off **Add to Google Calendar** button.

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
- Phone share sheet: share a product page to Nexus (installed app).
- **Pictures**: Nexus reads what the product is (even abbreviated
  receipt lines like "חלב תנ 3%"), then looks it up like a Google search — the barcode, your own items, Google Images,
  Open Food Facts, a similar product, and only last an icon — and picks the right photo. A guess it isn't sure of has a
  soft highlight ("Looks right" in the item sheet). **Change picture**: tap the picture in the item sheet (or on a
  receipt card) → choose another, search in Hebrew or English, take a photo, upload, use an icon, or no picture.
- **Missing picture?** It keeps filling in daily. Without a search key (Settings → Product pictures) only barcodes,
  Open Food Facts, your items and icons are used.
- **Missing price or name?** The store blocked the server. Type the price in the item sheet; the daily check tries
  again.
- Categories are fixed: Electronics, Mechanical, Tools, Materials, Computers, Camera & audio, Home & kitchen, Office,
  Clothing & personal, Other. Change one in the item sheet.

## The browser extension (Nexus Clipper) — retired
<!-- spec: Browser extension -->
- The Chrome extension and the bookmarklet were retired in Round 15. Add products by pasting links or scanning
  barcodes and receipts.

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
  same product sorted by total; "Add as another store". Works best with a search key.
- **Import VAT**: foreign orders over the VAT-free limit (Settings, default $130) get a warning with the estimated 18 %
  VAT and what to split into another order.
- **Price watch**: open an item → Price history → Watch price / Target price. Prices are checked every morning; drops,
  targets and back-in-stock come as alerts in the app (the bell).

## Spending and budgets
<!-- spec: Spending, Monthly budget -->
- **Spending** (Stats on phones): this month / last month / this year, savings from cheaper stores, 12-month bars, by
  project, store and category, biggest purchases.
- Monthly budget: the pencil on "This month's budget" (Spending) or Settings. The bar shows received + ordered +
  forecast (urgent to-buy; a toggle adds normal items). Near (90 %) / over shows in colour.

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

## Telegram — retired
<!-- spec: Telegram bot input, Weekly Telegram summary -->
- Telegram messages ended in Round 15. Price alerts show in the app (the bell; phone: Me → Price alerts); phone
  notifications are coming next.

## Sharing
<!-- spec: Sharing with permissions, Users & access, Retired -->
- People share a whole **space** with accounts (see Spaces and people). The old per-list guest links (/g, /i/…) stopped
  working — they show "This link no longer works — ask for a new invite".
- A list's **Share** keeps its **public read-only link** (anyone with it can look at that one list, nothing else) and
  points to Invite people for the space.

## Look and language
<!-- spec: Design system, Box logo, Mixed Hebrew/English text, Dark mode depth, One picture style, Solid tags, Ask button, Card borders, Sidebar v4, Phone shell v4, Calmer light theme -->
- Settings → **Display** (תצוגה): theme Light / Dark / Match device, colour **Graphite** (default) or **Plum** (שזיף),
  language (English / עברית, full right-to-left), currency, Motion (Match device / Reduced). Per device, instant.
- Pictures share one style; "Ask Nexus" is always a rounded pill; mixed Hebrew/English titles keep their direction.

## Settings
<!-- spec: Settings, Notifications -->
- Desktop: a large window — sections on the side (You, then the current space), search with `/`, Esc closes. Phone: a
  list of sections, each opens as its own page (Back returns). Each section has an address (e.g. /settings/display)
  and a command-menu entry ("Settings: Budget").
- **Notifications** (התראות): in the app — a tracked price drops (any / 5 / 10 / 20 %), someone changes a shared list,
  the budget reaches 80 %, a delivery is due or late. Push to the phone: Soon.
- **Assistant & AI**: AI + rules or Rules only for "Nexus suggests"; Memory; the AI status. **Calendar**: the feed
  link and which kinds it carries. **Data**: back up / restore (owner), import a spreadsheet or receipts, export items.

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
- Full JSON backup (download) and restore (merge or replace): Settings → Data, or the command menu → Backup. Secrets are never
  in a backup.

## Report a problem
<!-- spec: Reports, Simpler reports, Report a failure, Error log -->
- From the assistant (it drafts the report when you say something is broken or have an idea), the command menu,
  Settings, or the phone's Me sheet: choose Bug / Complaint / Idea, write what happened in one box (for a bug also
  what you expected), optionally add a screenshot, Send. What's attached automatically is listed under "Included
  automatically" (screen, device, versions, recent errors — never personal data or prices).
- When something fails (a link, a picture search, a receipt, a barcode, an answer, an import), its error toast has
  **Report**: the form opens filled in; the link is attached (domain + path, can be unticked), a picture only if ticked.
- Your reports and their status: Settings → Account → Your reports, or the command menu.

## Common problems
- **A product is missing its picture or price** → the store blocked the server; wait for the daily check or set it by
  hand in the item sheet.
- **Can't see a list someone shared** → check you're in the right space (switcher); a viewer can look but not edit.
- **AI busy** → wait a minute; limits reset quickly. Receipts from photos need Gemini specifically.
- **Totals look wrong** → alternatives count only the winner/cheapest; someday items are left out of store orders;
  check the display currency.
- **Something is broken or you have an idea** → offer `[Report a problem](nexus:report)`.
