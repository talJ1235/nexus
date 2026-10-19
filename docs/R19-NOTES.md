# R19 notes — fixes after R18 S5 + price comparison (planning chat, 2026-10-19)

Source for `docs/ROUND19.md` (not written yet — waits for Tal's board approval and his test round).
Boards: canvas "Nexus R19 — Prices" (account of this chat), copies go to `docs/design/r19/` after approval.

## 1. Decisions (Tal 2026-10-19)
- Family / friends come in only after the Android app is on Google Play (the R20 gate stands; 1b).
- Domain + name: postponed for now.
- First wave = at least 12 people (Google Play closed test needs 12 testers × 14 days).
- R19 = one big unattended night run (~8 h) on Tal's PC: Tal's fixes first, then price comparison.
- Price files: ingest the chains' legally published transparency files (PriceFull / PromoFull / Stores), learning from the
  maintained open-source work (OpenIsraeliSupermarkets `israeli-supermarket-scarpers`, daily-tested per chain) so it keeps
  working; first job = probe which chains answer from GitHub Actions (some chain portals block non-Israeli IPs) and from
  Tal's PC; blocked ones → decide (Tal's PC nightly or a small Israeli server).
- **Prices are current, not "this morning's"** (Tal): besides the nightly full files, ingest the chains' partial
  price / promo files published during the day (frequent runs), and show "updated · HH:MM" (time of the newest file
  used), never "morning prices". Still "verify at the till".
- Boards in this chat first (2a); recipes: Tal said 3a but asked to rethink → planner recommends postponing (see chat).

## 2. Tal's fixes after S5 (voice note 2026-10-19)
1. Floating Ask too big → a normal size relative to the rest (board: 48 px phone, 52 px computer).
2. Dock: the active tab must be clearly visible (today only grey → black) → pill behind the icon + bolder label.
3. Home "+": one scan entry like the supermarket camera — Barcode · Product photo · Receipt; plus paste link, search.
4. Product pictures better + prices + all stores + prices kept current (part of R19 price work).
5. Row swipe: the quick menu looks bad; delete must be smoother (no "boom", no red flash), the delete point farther so
   an accidental swipe doesn't delete; a real delete animation (row folds softly). Board `Fixes-phone`.
6. Tapping the empty (white) part of a row must open the product page — today only the picture opens it. Tal asked
   before and it wasn't fixed → acceptance must be a smoke step tapping several x positions on the row (not the name).
7. Store choice: every supermarket in Israel, real chain logos (no first-letter tiles), exact branch addresses, no
   free-text stores → from the chains' Stores files.
8. "Start shopping" pill must always float above the dock on the Supermarket tab — also after switching segments /
   coming back from another tab, while scrolling up or down, and settle in its place.
9. "Nexus suggests" opening animation smoother.
10. Ask chat: opening jumps; answers should appear smoothly one after another, not as a separate jumping section.
11. A bug Tal filed in the in-app reports about how an AI question renders → the builder reads it in the reports.
12. "New chat" needs a nice transition, not a jump.
13. Reopening Ask opens the latest chat: if the newest chat is empty (New chat pressed), open it empty — not the last
    chat that has messages.

## 3. Price comparison — what Tal wants on the boards
- Every list item maps to a real catalog product (barcode, brand, size) — matched from the name + the household's
  learned brands; asks once when unsure, then remembers.
- Under a product in the list: deals that fit ("2 for ₪10 — worth taking 2"), with "verify at the till".
- Product page: price at my store, the same product across chains / branches nearby, history, cheaper alternatives of
  the same type.
- "Where is my list cheapest" across stores; store picker shows the basket estimate per branch.
- Board review 1 (Tal): money in proportion — the ₪ sign smaller than the digits (`.cur`, .66 em); tags never overlap
  (one line each, wrap to the next row); a missing item is its own line under the tags, not a tag.
