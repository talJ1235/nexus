# Competitors, open-source projects, money — research (2026-10-16)

Source: Tal's list (Grocy, InvenDo, SHULAM!, Mr Kolet, Sally, AddIt) + planner search (planning chat, account B).
Status: findings + proposals; Tal answered the five questions (§8) — the decisions live in `PLANNER.md` "Decisions
that stand". Earlier desk research: `STRATEGY.md` §4 (2026-10-05). Answers: §8.

## 1. Competitors at a glance
| App | What it is | Model | Worth taking | Weak spot |
|---|---|---|---|---|
| Grocy (grocy.info) | Self-hosted "ERP for the home": stock, min-stock → auto list, products grouped by store area, due dates, recipes with a "due score", meal plan, chores, batteries, appliance manuals, custom fields, REST API | free, donations | min-stock → list; recipes ranked by what is about to expire; "one hand, 3 seconds" input forms; feature flags to hide modules | self-hosting, heavy data entry, PWA with no offline |
| InvenDo (`com.chestersw.homelist`) | Pantry / medicine / home inventory, expiry reminders, low-stock alerts, lists by store or category, barcode, photos, Excel export, family sharing | IAP; 50K+, 4.7★ (1.6K) | expiry + low-stock alerts; "medicines" as a category | review: many features off after setup, user had to find them |
| SHULAM! (shulam-app.com) | "OS of the shared home": expense split with fewest transfers, Hebrew receipt OCR (AI), shared list linked to the receipt, fridge/pantry with shelf-life estimate (~200 products), "what to cook" from a fridge photo, fair chores, bill reminders; settle in Bit / PayBox | free; "Pro" with AI later; iOS 5.0 on 9 ratings | split + settle-up deep links; shelf-life table; bill reminders | roommates first, tiny install base |
| Mr Kolet (mrkolet.store) | WhatsApp AI bot: send items → sorted by section, remembers all week, forward from the family group, compares the list across chosen stores incl. promos, user fixes wrong product matches, web checklist link in the store, "finished shopping" reconciles the list | free (Subzee Ltd) | WhatsApp input; match correction; finish-reconcile | no app, no history/budget |
| Sally (heysally.co.il, `il.co.heysally.app.twa`) | WhatsApp + web app (TWA): live shared list, auto sort by department, prices and promos of all chains, barcode → price | IAP; 1K+ | "WhatsApp convenience + rich app" | Play data-safety says "data isn't encrypted"; small |
| AddIt (`com.mogalcop.ts.addit`) | Hebrew shared lists, 2,000 built-in products, daily price compare across major chains, colours, many lists, "recent changes" feed | ads + IAP; 100K+, 4.6★ (3.1K) | recent-changes feed ("who added what") | reviews: share link fails to join, missing prices at big chains, asks for Wear OS |
| PriceZ | Leading price comparison + shared lists: cheapest basket nearby, basket price history, unit-price sort, price-drop alerts, community "out of stock at this branch", comments | free | unit price; community stock signal; basket history | price-first, list is secondary |
| CHP | Cherry-picker: barcode / name, radius ≤ 10 km, split one list across stores | free | split a list across stores | dated |
| SnapList AI | List from receipt photo, from a **digital-receipt link**, or from pasted free text matched to real products; basket compare nearby incl. online; cheaper substitutes by unit price | free | digital-receipt link import; free-text → real products | — |
| IsraBis | Claims 49 chains; recipes with prices, recipe from a video, fridge photo AI, expense tracking, family | free | recipe priced at your store | broad, unproven |
| Savy, רשמנו (Rashamnu) | Basket index + SEO guides / free no-ads Hebrew live list | free | — | — |
| Bring! (EU) | Europe's largest list app, free | **native ads**: sponsored products in catalogue/search, retailer offers, recipe inspiration; 4.2M MAU in DACH | the ad model (§6) | — |
| AnyList (US) | Lists + recipes + meal plan | **$9.99/yr person, $14.99/yr household**; Complete gates prices + running total, per-store prices, recipe import, meal plan, photos, web/desktop/watch | household plan pricing | — |
| KitchenOwl / Mealie / Tandoor | Self-hosted list + recipes + meal plan (+ household balances in KitchenOwl) | free, AGPL-3.0 | ideas only (§5) | — |

## 2. What the market says
1. Price comparison + a Hebrew shared list are **table stakes** in Israel (8+ players) — confirmed again.
2. **WhatsApp is the Israeli input channel.** Three products (Mr Kolet, Sally, Groceroo → Sally) are built on "just send a
   message"; Nexus has no messaging door (Telegram retired in R15).
3. Everyone does one job (list, prices, pantry, or splitting money). SHULAM! is the only "whole home" play, and it
   starts from money between roommates, not family shopping.
4. Trust is weak across the field: unencrypted data (Sally), broken share links and missing prices (AddIt). Reliability
   + privacy are real differentiators, not slogans.
5. "AI" is marketing copy everywhere (fridge photo, receipt → list). The differentiator is AI that knows **this**
   household's history — which Nexus already has (suggestions, Nexus-made templates, learned store order).

## 3. Where Nexus already wins (say it, don't rebuild it)
Live list with conflict handling; store mode (sections, learned order, progress, "someone is shopping" push);
suggestions from the home's own history; Nexus-made templates; count + weight; voice / photo / barcode add; receipts;
budget + monthly spending; online orders, deliveries, price tracking and projects (all household buying in one place);
Galaxy Watch planned (AddIt users ask for it); no ads.

## 4. Ideas to take — ranked by value ÷ cost
**Tier A — fits the roadmap**
- **A1 WhatsApp door (inbound only first).** Send "חלב, 2 לחם" to the Nexus number → added to the person's space list;
  reply = what was added + list link; forwarding from the family group works; "רשימה" returns the store-mode link.
  Cost: Meta Cloud API — replies inside the 24 h window opened by the user are free; business-initiated templates are
  paid (IL utility rate ~6.55 on Meta's rate cards — verify before building). Needs a dedicated number + Meta business
  verification. New decision (Telegram is off) → Tal. Planner: R19b or right after R20.
- **A2 Price layer (R19) — architecture from `ronilitman/grocery-price-data`:** nightly GitHub Action; store one
  baseline price per (chain, barcode) + only the stores that differ (≈ 50× smaller, ~200 MB nationally); a word index
  (`product_tokens`) for search; barcode shards as JSON; weighted items flagged. For Nexus: build in a separate public
  data repo, load into Turso only the chains/branches of active spaces and barcodes seen on lists.
- **A3 Promo-aware list:** chip "2 ב-₪X at your branch", club-only marked, basket estimate at the chosen branch, "cheaper
  at X" as a secondary view (already planned) + **unit price** (₪/100 g) for substitutes (PriceZ, SnapList).
- **A4 Digital-receipt link import** (SnapList): share/paste the SMS receipt link → items + prices learned, trip
  reconciled. Check which chains send links and whether pages are fetchable (some chains block datacenter IPs —
  see PLANNER "Blocked stores").
- **A5 Finish-reconcile** (Mr Kolet): at "finished", unchecked items → keep for next time / not found / remove.
  Builder to check what R18 "not found" already covers.
- **A6 Community "not at this branch"** (PriceZ) — later, needs many households.

**Tier B — new scope, Tal decides**
- **B1 Split within a space** (SHULAM!, KitchenOwl balances): who paid the trip (from the receipt), running balance,
  settle with a Bit / PayBox deep link, mark paid. Natural fit (trips + receipts + budget exist); opens couples and
  roommates.
- **B2 "Use soon" without a pantry:** Tal ruled out a pantry. Instead: purchase date from the trip/receipt + a
  shelf-life table for perishables → "milk bought 9 days ago" feeds suggestions and Home "Due soon". No stock counts.
- **B3 Recipes with prices** (R18b): import by schema.org Recipe JSON-LD (no library needed), price each recipe at the
  person's branch, "cook from what we bought this week", Grocy-style due score.
- **B4 Recent-changes feed** (AddIt): check whether `activity.ts` already shows it in the list.
- **B5 Home reminders** (bills, ועד בית — SHULAM!): Nexus has calendar + ICS; low cost, but scope creep.

**Tier C — skip for now:** full pantry ERP (Grocy, InvenDo), chores, batteries/appliances, custom fields.

## 5. Code and projects (licence matters — Nexus may become commercial and closed)
Rule (Tal 2026-10-16): permissive code (MIT / Apache / BSD) may be used with its notice kept; AGPL / GPL,
non-commercial and no-licence code is **read for ideas only** — the planner writes the idea in its own words, the
builder implements from that note and never pastes from those repos. (Ideas, algorithms and architecture are not
protected; the code text is. Not legal advice — before a paid launch, a short check with a lawyer.)

| Project | Licence (checked 2026-10-16) | Use |
|---|---|---|
| `rxradar/israeli-prices` (Python, v0.2.0, nightly health check) | **MIT**, commercial use explicitly allowed | **the fetch + parse layer of our price pipeline** — 31/32 chains implemented (one portal down); prices, promos, stores |
| `OpenIsraeliSupermarkets/israeli-supermarket-scarpers` + `-parsers` | **custom, non-commercial only** (LICENSE.txt; setup.py's MIT classifier is misleading) | read only |
| `ronilitman/grocery-price-data` + `grocery-price-scrapers` | none stated; built on the non-commercial library above | read only — design ideas (§5.1) |
| `phiresky/sql.js-httpvfs` | Apache-2.0 (last push 2024-08) | not needed — Nexus has Turso |
| KitchenOwl, Mealie, Tandoor | AGPL-3.0 | read only — conclusions in §5.2 |
| Grocy | MIT (PHP) | ideas: min-stock, due score, fast input, hide-module flags |
| `hhursev/recipe-scrapers` | MIT (Python) | reference for R18b recipe import; schema.org JSON-LD covers most Israeli recipe sites |
| Open Food Facts, `zxing-wasm` | — | already used |

### 5.1 What the price-data code teaches (read 2026-10-16)
- **Join key = GTIN-14.** `israeli-prices` canonicalises UPC-12 / EAN-13 to GTIN-14 so one product isn't split in two.
  Nexus should store barcodes the same way (builder: check `barcode.ts`).
- **Reachability is daily-flaky:** the library's nightly check (2026-10-15, from a non-Israeli GitHub runner) reached
  27/32 chains; Victory, Mahsanei HaShuk and Het Cohen answer **Israeli IPs only**; Shufersal timed out that night;
  Hatzi Hinam gave 403. → keep the last good snapshot per chain and show "prices as of <date>"; the geo-blocked chains
  need an Israeli machine (later: a self-hosted Actions runner in Israel).
- **Collapse (idea from `ronilitman`):** one baseline price per (chain, GTIN) + only the branches that differ (≈ 50×
  smaller); a word→GTIN index for search instead of `LIKE '%…%'`; weighted items flagged so a basket never sums a
  per-kg price as per-item.
- **Promotions are rich:** min / max quantity, reward type, discounted price or rate, groups, minimum purchase amount,
  club id, coupon flag, "allow multiple discounts", start/end. → the basket estimate must compute the effective price
  **for the quantity on the list**, and count club / coupon deals only for clubs the home has (new question in
  Settings → Supermarket / onboarding: "which clubs do you have?").
- Some chains publish a **city code**, not a name → map with the CBS locality list.

### 5.2 What KitchenOwl's code teaches (AGPL — ideas only)
- **"Usually bought with":** a background job mines pairs only (one item → one item) from past trips and keeps a pair
  when lift > 1.2 and confidence > 0.1. Nexus today (`staples.ts`, "usually with") keeps a companion at confidence ≥ 0.6
  over ≥ 3 trips **with no lift check** → items bought on every trip (milk, bread) qualify as "usually with" anything.
  Fix for the builder: also require lift ≥ ~1.2 (companion share with A ÷ its share over all trips).
- **Store order:** it learns one walking order from the order items were checked, with **exponential decay (0.75)** so
  recent trips weigh more, then a greedy topological sort. Nexus (`order.ts`) asks ≥ 2 recent trips that never flip a
  pair → one odd trip can block a suggestion. Possible upgrade: weighted precedence votes with decay, suggest when one
  order clearly wins.

## 6. Making money — options
Context: free stack today; commercial use needs Vercel Pro and an AI budget; `STRATEGY.md` rules out selling user data.
1. **Household subscription (AnyList model)** — free core forever (list, live sync, store mode, sharing, basic
   suggestions); "Nexus Plus" per household, e.g. ₪9.90/month or ₪79/year (to test). Candidates to gate: AI beyond
   the daily quota, basket price alerts + history, spending insights, online-order/price tracking, projects, extra
   spaces. Rule from competitor reviews: never take away something that was free; say what's paid on day one.
2. **Native sponsored products (Bring! model)** — only at scale (Bring! has millions of MAU). Clearly marked, one per
   search, never added to a list by itself, none for Plus. Not before tens of thousands of households.
3. **Online-cart hand-off / affiliate** — "send this list to Shufersal Online / Rami Levy Online" with a referral, if
   chains offer one (unverified). Useful as a feature even without money.
4. Cashback / savings share — complex, later. Aggregate data sales — no (privacy stance).
Planner recommendation: don't build payments now. Ship the closed circle, measure 4 weeks (what people open, AI use per
home), then pick the Plus line. Design the free core now so nothing must be taken away later.

## 7. Positioning, sharpened
Keep "The smart way to run your household shopping". Angles this research supports: WhatsApp-easy, app-powerful ·
knows your home · all the home's buying, one budget · reliable and private. Don't promise "no ads forever" while option
6.2 is open.

## 8. Tal's answers (2026-10-16)
1. WhatsApp door — **yes, after R20**, inbound first.
2. Splitting money — **not now**.
3. Money — **decide after 4 weeks of closed-circle data**; until then the free core is designed so nothing is taken away.
4. "Use soon" for perishables (no pantry) — **yes**.
5. Price layer — Tal left it to the planner ("best long term, smartest, user gets all the information") → own pipeline,
   recorded in `PLANNER.md` "Decisions that stand".
