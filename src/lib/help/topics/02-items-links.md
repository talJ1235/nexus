<!-- topic: Items and links -->

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

## Telegram — retired
<!-- spec: Telegram bot input, Weekly Telegram summary -->
- Telegram messages ended in Round 15. Price alerts show in the app (the bell; phone: Me → Price alerts); phone
  notifications are coming next.

## Import, export and backup
<!-- spec: Import & backup, Excel export -->
- Import a parts or shopping list from Excel/CSV (command menu → Import): Nexus detects columns (English or Hebrew
  headers), creates missing projects, and can fill in details from links.
- **Export to Excel** (a BOM: item, qty, unit price, total, store, link, priority, status): a project or list page →
  the ⋯ menu → Export to Excel; the command menu → Export to Excel (the current project/list, or everything to buy);
  phones: the Me sheet → Export to Excel.
- Full JSON backup (download) and restore (merge or replace): Settings → Data, or the command menu → Backup. Secrets are never
  in a backup.
