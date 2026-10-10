# R18 planning — supermarket mode v2 (and the road to the family release)

Planning chat, 2026-10-10. Status: **draft — waiting for Tal's answers (§5)**. When Tal answers, the answers go into
§5, the decisions into `docs/PLANNER.md` "Decisions that stand", and the brief is cut as `docs/ROUND18.md`.

## 1. Where we are
- R17 = product layer (Sessions 1–4 merged and live; Session 5 hotfixes `docs/ROUND17-S5.md` is the last fix run).
- Roadmap (Tal 2026-10-07/08, stands): **R18 supermarket mode v2 → R19 price comparison → R20 real apps (Android via
  Google Play closed testing, iPhone Home Screen + guide, QR desktop login) → family comes in.**
- Parked by Tal: blocked stores (Cloudflare bot management; options in `PLANNER.md`).

## 2. Gate before R18 (close R17)
1. Session 5 merged, CI green, prod smoke green.
2. Tal: VAPID keys in Vercel (Production) + redeploy; GitHub secret `CRON_SECRET`; `hourly.yml` log shows the secret
   is used (not skipped).
3. End-to-end push check on Tal's phone with a second account (Noa starts a trip → push arrives; price drop → push).
   R18 leans on "someone is shopping" — it must work before we build on it.
4. Tal's short test pass of S5 (admin on desktop, suggestions card, step 5 QR).

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

## 5. Questions for Tal (answer like "1a, 2b")
1. **Family timing.** a) as decided — family after R19 + R20; b) family on the PWA right after R18 (Android app later
   for them anyway). *Planner: b — push, onboarding and admin metrics are ready; real use teaches more than R19.*
2. **Staples when due.** a) Nexus suggests ("time for milk?") and you confirm; b) added to the list by itself;
   c) manual only. *Planner: a by default, b per item ("always add by itself").*
3. **Templates.** a) none — staples cover it; b) one "weekly basket" per space; c) several named lists
   ("Shabbat", "party"). *Planner: c, made from a past trip in one tap.*
4. **Section order in the store.** a) learned from your check order per store, drag to fix; b) fixed category order
   only. *Planner: a.*
5. **Where it lives.** a) inside Shopping (dock stays the same) with a big "Start shopping" action; b) its own dock
   tab instead of Projects on the phone. *Planner: a.*
6. **Receipt after a trip.** a) offered every time (skip is one tap); b) only from the menu. *Planner: a — it feeds
   R19 prices and the budget.*

## 6. Next steps
1. This chat: Tal answers §5 → decisions into `PLANNER.md`.
2. Planner: desk research update (Bring!, AnyList, Listonic, Israeli list apps — trip / staples / section-order UX).
3. New chat: boards on a new canvas "Nexus R18 — Supermarket" (skills bar from `PLANNER.md`): phone list in the store,
   fast add, staples, shopping together, trip summary, desktop planning view.
4. `docs/ROUND18.md`: Session 1 (no boards) can run before the boards are approved.

## 7. Tal's prep that takes calendar time (start early)
- Google Play developer account ($25) — identity verification can take days; R20 closed test = 12 testers × 14 days.
- Domain + privacy email (Play requires a privacy-policy URL; App Links + passkeys + email recovery want a domain).
- Name decision (`Karto` recommended) before the domain.
- List of 12+ testers (family + friends with Android).
