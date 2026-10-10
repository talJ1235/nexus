<!-- topic: Getting started -->

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

## First questions (getting started)
<!-- spec: Onboarding -->
- The first time you sign in, Nexus asks a few questions, one per screen (צעדים ראשונים): what you use it for (Home
  starts with a matching layout), where you shop (suggested first when you look for an item), a monthly budget (a
  target for your personal space, ₪ / $ / €), who you shop with (partner or family makes a shared space "Home" and
  offers the invite link), installing the app (iPhone: Share → Add to Home Screen), and notifications.
- **Skip** leaves at any point; a reload continues where you were. Every answer can be changed later: Home →
  Customize, Space settings → Budget, the space switcher, Settings → Account → Notifications — or run the questions
  again from Settings → Display → **Getting started**.

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

## Home suggestions, insights and deliveries
<!-- spec: Nexus suggests, Nexus noticed, Nexus suggests / noticed, Delivery track, Home suggestions -->
- **Nexus suggests**: one idea at a time — a deal on something you want (sometimes "order both" for free shipping),
  time to reorder, a cheaper weekday, a project without a budget. The button does it; "Not now" hides it for 7 days.
  Swipe (phone) or drag (computer) between ideas — past the last comes the first again.
  When the exact rules find little, the AI looks once a day (only at your own items and numbers) and simple tips fill
  in. Settings → Assistant & AI: AI + rules, or Rules only (no AI calls); Status shows the last run and any error.
- **Nexus noticed**: short facts from your data (shipping saved, a cheaper weekday, a project without a budget).
- Deliveries show a 4-step track — Ordered · Shipped · In country · Delivered — estimated from the order and expected
  dates; late = all four in orange; no date = "No date".

## Search, menus and gestures
<!-- spec: One search, Nested overlays, Quick actions, Row swipes, Phone bottom sheets -->
- Phone: the search button opens one search for everything — settings and actions first (theme, palette, currency,
  language and AI suggestions switch right in the results), then items, projects, stores and "Ask Nexus about …".
  Computer: the same in the command menu (Ctrl K or Esc); typing in the top search also lists matching settings.
- A window opened from another opens on top, and Esc / an outside click closes only the top one.
- Quick actions: phone rows swipe toward the start edge to delete, toward the end edge for On the way / Received
  (past 40 % they stay open); long-press a row to select, a card for its action sheet; computer: hover bar, right-click,
  keys O / R / M / Delete. Every bottom sheet on the phone closes with a swipe down, the scrim or Back.
