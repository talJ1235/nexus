# R18 planning — supermarket mode v2 (and the road to the family release)

Planning chat, 2026-10-10. Status: **Tal answered §5 + asked for more (§6); push diagnosis §7; open questions §10 (answered) → §11 structure; questions §12 (answered) → architecture draft §13**.
Decisions go into `docs/PLANNER.md` "Decisions that stand" at the end of the chat; the brief is cut as `docs/ROUND18.md`.

## 1. Where we are
- R17 = product layer (Sessions 1–4 merged and live; Session 5 hotfixes `docs/ROUND17-S5.md` is the last fix run).
- Roadmap (Tal 2026-10-07/08, stands): **R18 supermarket mode v2 → R19 price comparison → R20 real apps (Android via
  Google Play closed testing, iPhone Home Screen + guide, QR desktop login) → family comes in.**
- Parked by Tal: blocked stores (Cloudflare bot management; options in `PLANNER.md`).

## 2. Gate before R18 (close R17)
1. Session 5 merged, CI green, prod smoke green.
2. ~~VAPID keys + `CRON_SECRET`~~ — Tal: done long ago. Env names still unset (fine for now): `OPENROUTER_API_KEY`
   (optional AI fallback, free), `GITHUB_ISSUES_TOKEN` (optional, reports → issues; not needed), `RESEND_API_KEY`
   (email; waits for the domain).
3. **Push does not work outside the site** (Tal 2026-10-10: on PC and phone he sees notifications only inside the app)
   → diagnosis §7, then a short fix session before R18 S1.

## 3. What exists today (code read 2026-10-10)
- Shopping mode (R7, `components/app/shopping-mode.tsx`, `lib/shop-outbox.ts`): scope everything / store / project,
  rows by category or store, tap = check, long-press = qty/price, barcode check-off, quick add, wake lock; the trip
  lives in IndexedDB `nexus-shop`; offline Finish is queued (last write wins).
- Live spaces (R16, Ably + 10 s polling), presence "Noa is shopping", trip push start / live / finish (R17 S3,
  `lib/notify/senders.ts`; the trip is a pref `pref:shop-trip`, not a table).
- Receipts v2 (camera, Gemini read, "already on your list" / "new"), barcodes (`items.gtin`, Open Food Facts), price
  points per item (`price_points`), budget per space.
- **Missing for v2:** no trip table and no check-off order log (needed to learn store-section order and for metrics);
  no recurring / staple concept on items; no templates; duplicates are not merged on add; offline adds during a trip
  are not covered by the outbox; no unit model (kg vs units) beyond qty.

## 4. R18 scope — draft (planner proposal)
Goal (from `STRATEGY.md`): the fastest, most reliable shared supermarket list in Hebrew — sync that never loses an
item, adding faster than WhatsApp, works offline in the store — plus what grocery-only apps don't do: one household
budget with online orders.

| Part | What | Boards? |
|---|---|---|
| A — data base | `trip` + `trip_check` tables (who, store, order, time, total); per-store section order learned from check order; metrics for admin (trips / week, items per trip, week-4 retention) | no |
| B — staples (recurring) | mark an item as a staple; interval learned from purchase history; when due → per §5 Q2 (suggest / auto-add) | yes |
| C — fast add | type-ahead from household history first, then Open Food Facts IL; duplicates merged ("milk" twice → qty 2); units (units / kg / g / L); add by voice optional | yes |
| D — the list in the store | sections in the learned order (drag to fix), big rows, one-hand use, offline adds + checks queued and merged per row (not last-write-wins) | yes |
| E — shopping together | two people in the same trip: live checks, "Noa took dairy", split by section | yes |
| F — after the trip | finish → summary (bought / left / total vs budget) → offer receipt scan → prices per store per product (seeds R19) | yes |
| G — guards + docs | offline + merge tests, section-order unit tests, 360/390 + desktop, he/en, parity PNGs | — |

Sessions (like R17): **S1 = Part A + plumbing of B/C/D (no new screens)**, runs while the planner makes boards;
**S2 = screens from the boards**; **S3 = fixes from Tal's supermarket test** (a real shop with Noa).

R19 dependency: R18 must store **barcode (`gtin`) + store + price** for supermarket items wherever it can (barcode
check-off, receipt lines), so R19 can match chain price files by barcode.
R20 dependency: web push does **not** work inside an Android WebView wrapper — R20 needs native push (FCM) through the
Capacitor push plugin, plus sign-in in a Custom Tab and App Links (`MULTIUSER.md` §4.10). Plan R20 accordingly.

## 5. Tal's answers (2026-10-10)
1. **Family timing: a** — the family comes in only after the Android app is on Google Play (push on the phone must
   work as a real app). R20 stays the gate.
2. **Staples:** suggest by default ("time for milk?"), "add by itself" per item.
3. **Templates:** several named lists; make one from a past trip in one tap.
4. **Section order:** a default order from a typical supermarket layout (planner to research Israeli chains' layout),
   the user can move the groups; learning per store = open question §10.
5. **Where it lives:** no separate app, but reachable from everywhere — Tal asked for proposals (§6.1).
6. **Receipt after a trip:** offered every time, skip in one tap.

## 6. More from Tal (2026-10-10) — "the system really learns the user"
Tal: as intuitive and smooth as possible; learn the products, the usual supermarkets, the usual shopping weekday;
plan a shop with the in-app AI assistant; add a finished product (fridge) by barcode or photo to the next list; every
item shows current prices and promotions of the chain the user shops at; propose more.

### 6.1 Entry points (planner proposal, for Tal's OK)
- Shopping tab opens on a **Supermarket | Products** switch; Supermarket is the default when the space has a list.
- **Trip bar**: during a trip a slim bar sits above the dock / at the bottom on desktop on every screen (items left,
  total) — one tap back to the list (music mini-player pattern).
- Long-press the dock **+** → Add to list · Scan · Photo · Start shopping.
- **App shortcuts** (manifest `shortcuts`, works for the installed PWA on Android today; native in R20): long-press the
  app icon → Add to list / Scan / Start shopping.
- Home card **"Next shop"** (day, items, estimate vs budget, Start).
- Desktop: sidebar entry "Supermarket" with a count + keyboard shortcut.
- Later (R20 native): home-screen widget; "near your supermarket — start shopping?" by location.

### 6.2 Learning (all from the household's own data)
- Per product: usual quantity, interval, preferred brand + accepted substitutes, store(s) bought at, last price.
- Per household: usual store(s) and branch, usual weekday + hour (from trips), typical basket size.
- Uses: staples due before the usual day; "Thursday is your shop — the list is ready (12, 4 staples added)" (inbox +
  push the evening before); type-ahead ranked by this household; default quantities.

### 6.3 Adding
- Barcode (exists) and **photo** of a package → AI names it → matched to the household's own product → next list.
- Voice ("milk, eggs and two breads") → split into items.
- AI assistant plans a shop ("Shabbat for 6", "week of dinners") from history + templates + staples; the result is a
  draft the user confirms.

### 6.4 Prices and promotions in the list (R19)
- Israeli price-transparency files include promotions (incl. club deals). R19 shows each list item's current price
  and promotion at the user's chain/branch, a basket estimate, and "cheaper at X" as a secondary view (not a
  separate comparison app). R18 stores gtin + store + branch so R19 can match.

### 6.5 More ideas from the planner (for Tal to pick)
1. While someone shops, items added at home reach them live + a push ("Noa added milk").
2. "Not found" in the store → stays for next time; the branch learns it doesn't carry it.
3. Basket estimate before leaving, vs the month's budget.
4. One-hand store mode: big rows, checked items slide down, screen stays on (exists), undo.
5. Substitutes: if the preferred brand is missing or another is on promotion — suggest (R19 data).
6. After the trip: receipt → prices learned, checked items reconciled, "forgot 2 things" reminder.

## 7. Push diagnosis (code read 2026-10-10)
How it works now (`lib/notify/kinds.ts`, `enqueue.ts`, `schedule.ts`, `dispatch.ts`, `public/sw.js`):
- Only **shop** and **delivery** are urgent (sent at once via `after()`); **activity, price, budget** wait for the
  person's *active hour* (= the hour they usually open the app) and **week** for Thursday — and those are sent only by
  `hourly.yml` (GitHub Actions). If that job doesn't run (GitHub delays/skips scheduled jobs, or the secret is wrong),
  they never push and stay in the inbox → seen only inside the app. Even when it runs, the active hour is the time Tal
  is usually in the app anyway.
- The person who caused an event is never notified — testing with one account on two devices produces no push by design.
- The service worker shows every push it receives (no "app is open" suppression), so a push that arrives is visible.
- The browser subscribes only after permission, from the card / inbox (`ensureSubscribed`). Windows Chrome shows pushes
  only while Chrome runs in the background and Windows notifications for Chrome are on; Android needs the site's
  notification channel on and no battery restriction for Chrome.
Checks for Tal: Admin → System "Push" row (devices phone / computer; sent / failed today; **due now** > 0 = the hourly
sender isn't running); GitHub → Actions → hourly → latest run log ("skipping" = secret missing); a test with Noa's
account starting a trip.
Fix session (proposal): admin **"Send a test push to my devices"** + per-device last result; a `push_state` breakdown
in System; the timing policy per §10 Q7; a guard that fails CI when due rows stay unsent > 70 min on prod smoke.

## 8. Next steps
1. ~~Tal answers §10~~ (done) → push fix brief written: `docs/ROUND17-S6.md`. Tal answers §12.
2. Planner: desk research update (Bring!, AnyList, Listonic, Israeli list apps — trip / staples / section-order UX).
3. New chat: boards on a new canvas "Nexus R18 — Supermarket" (skills bar from `PLANNER.md`): phone list in the store,
   fast add, staples, shopping together, trip summary, desktop planning view.
4. `docs/ROUND18.md`: Session 1 (no boards) can run before the boards are approved.

## 9. Tal's prep that takes calendar time (start early)
- Google Play developer account ($25) — identity verification can take days; R20 closed test = 12 testers × 14 days.
- Domain + privacy email (Play requires a privacy-policy URL; App Links + passkeys + email recovery want a domain).
- Name decision (`Karto` recommended) before the domain.
- List of 12+ testers (family + friends with Android).

## 10. Open questions (2026-10-10)
7. Push timing: a) everything at once (never at night), grouped — price drops per check run, activity at most one per
   hour per space with the first at once; b) as now (urgent at once, the rest at the active hour). *Planner: a.*
8. Store layout: a) default order + manual moves only; b) default + per-branch learning that *suggests* a new order for
   the user to confirm. *Planner: b.*
9. Photo add uses the AI (counts in the daily quota). OK? *Planner: yes.*
10. Entry points §6.1 — approve as a set, or pick.
11. Ideas §6.5 — which ones go in.

**Tal's answers (2026-10-10):** 7 a (everything at once) · 8 b (default + per-branch suggested order) · 9 yes ·
10 → §11 · 11: a, b, c, d — **but checked items stay in their section** (no sliding down; struck through in place, the
section shows its progress) · e yes · f: Tal asked what it means (explained in chat; §11.4).

## 11. Supermarket structure (planner proposal after Tal's notes, 2026-10-10)
### 11.1 Two views of one list
- **Shopping tab** gets a top switch **Supermarket | Stores** (Tal's idea). Stores = what exists today (KSP, Amazon,
  AliExpress…: To buy ⇄ On the way, list/grid). Supermarket = the household's supermarket list as a **planning view**
  (add, edit, quantities, staples strip, templates, AI plan, basket estimate, sections in store order). The tab
  remembers the last side; a new household user (onboarding "supermarket"/"home shopping") starts on Supermarket.
- **Store mode** = the same list, full screen, opened by "Start shopping": in-store features only (§11.3).
- An item is supermarket or store by its kind (category / source); a typed item with no link goes to the side you are
  on; it can be moved.
### 11.2 Entry points (approved by Tal: long-press +, Home card, desktop, later items)
- Long-press the dock **+** → Add to list · Scan · Photo · Start shopping.
- **App-icon shortcuts** (Tal asked what it is): long-press Nexus' icon on the phone's home screen → a small menu
  (like WhatsApp's "New chat") → Add to list / Scan / Start shopping. Free for the installed app (manifest `shortcuts`).
- Home card "Next shop"; desktop sidebar "Supermarket" + shortcut; trip bar above the dock during a trip.
- The evening-before push ("tomorrow is your shop — list ready") has a **Start / Open list** action.
- Paste a WhatsApp list into Add → split into items; share text to Nexus does the same.
- Later (R20 native): home-screen widget, location ("at Shufersal?"), quick-settings tile.
- Dock tab 4 (Tal's idea: make Projects a minimal Projects/Supermarket tab, new icon + name): planner recommends
  keeping the supermarket's home in Shopping only (one home per list) — question §12.
### 11.3 Store mode features
Sections in store order with per-section progress; checked = struck through **in place**; big rows, one hand, screen
on, haptic tick, undo; barcode check-off; quick price; running total vs estimate and budget; "not found" (stays for
next time); substitutes; live: who else is in the trip, items added at home appear highlighted + push; offline; finish
→ summary → receipt.
### 11.4 After the receipt (idea f, explained)
Photo of the receipt at the end → (1) each line's price is saved for that store/branch (learning + R19); (2) lines that
match unchecked list items mark them bought; (3) items checked in the store but not on the receipt are flagged ("not
scanned? / left behind?"); (4) bought items that weren't on the list are learned as products (history, staples);
(5) list items still unchecked → "forgot 2 things" — keep for next time or remind now.

## 12. Questions (2026-10-10, after §11)
12. Dock tab 4: a) Projects stays, the supermarket lives in Shopping (planner); b) tab 4 becomes "Lists"
    (Supermarket | Projects) with a new icon; c) tab 4 becomes "Supermarket" and Projects move into Shopping → Stores
    as a filter.
13. After the receipt (§11.4): all five, or which?

**Tal's answers (2026-10-10):** 12 → a dedicated **Supermarket** dock tab on the phone **in place of Projects**
(supermarket = mostly phone, projects = mostly computer); Projects are reached from the Shopping (stores) tab and open
inside it; more ways to start a trip besides the tab. 13 → all five receipt steps. Tal wants to go over the whole
architecture in detail before the boards.

## 13. Architecture draft (for discussion with Tal, 2026-10-10)
Principle: the phone is for shopping now (supermarket), the computer for planning (projects, analysis, the weekly plan
with the AI). Same data, different weight.
### 13.1 Phone dock
Home · Stores (was Shopping) · + · **Supermarket** · Insights. Projects → inside Stores (a "Projects" chip row / entry
that opens a project in the tab). Name of the stores tab = question 14.
### 13.2 Supermarket tab (planning view)
Top → bottom: space + chosen store/branch chip + basket estimate; staples-due strip ("4 to add"); add field always on
top (type-ahead, scan, photo, voice); the list in sections (store order, drag groups); sticky **Start shopping** above the
dock. ⋯ menu: templates, plan with the assistant, past trips, receipts, store order.
### 13.3 Store mode
Full screen, dock hidden, §11.3 features; leaving it mid-trip shows the trip bar everywhere until Finish.
### 13.4 The + button
Tap = context: on Supermarket adds to the supermarket list; elsewhere the current menu. Long-press = Add to list · Scan
· Photo · Start shopping (from any tab).
### 13.5 Computer
Sidebar: "Supermarket" near the top with a count → a two-column planning page (list by sections | staples, templates,
AI plan, estimate). No full store mode on the computer (question 18).
### 13.6 What is a supermarket item
Added on the Supermarket side, or a grocery-type category (food, drinks, cleaning, toiletries, baby, pets), or a food
barcode → Supermarket; has a store link → Stores. Movable both ways.

## 14. Questions (architecture, 2026-10-10)
14. Name of the stores tab: a) "חנויות" (stores) b) "מוצרים" (products) c) keep "קניות". *Planner: a — in Hebrew
    "קניות" sounds like groceries and would clash with the Supermarket tab.*
15. Lists: a) one supermarket list per space, the store chosen when starting a trip, an item can be pinned to a store
    (e.g. Super-Pharm); b) a separate list per store. *Planner: a.*
16. The + on the Supermarket tab: a) adds straight to the list (context); b) always the menu. *Planner: a.*
17. Makers: a setting to swap tab 4 back to Projects (onboarding "projects" sets it). *Planner: yes.*
18. Computer: a) planning page only (+ "send to phone"); b) full store mode there too. *Planner: a.*
