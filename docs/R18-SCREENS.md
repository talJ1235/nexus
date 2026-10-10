# R18 screens script — the supermarket, in words (before the boards)

Planning chat, 2026-10-10. Status: **approved by Tal (2026-10-10)** — changes later if needed. Context and earlier answers: `docs/R18-PLANNING.md`; this
script **supersedes its §16 (section order) and §17 (board list)** where they differ.
When approved, this file is the board list for the canvas "Nexus R18 — Supermarket" (design bar: the project skills
in `.claude/skills/` + frontend-design, as every board since R17) and the source for `docs/ROUND18.md` / R18b.

## 0. Tal's answers to R18-PLANNING §14 and the follow-up (2026-10-10)
14 b — the stores tab is called **"מוצרים" (Products)** · 15 a — one supermarket list per space; the store is chosen
per trip; an item can be pinned to a store · 16 a — **+** on the Supermarket tab adds straight to the list · 17 yes —
a setting swaps tab 4 back to Projects (onboarding "projects" sets it) · 18 a — the computer gets a planning page
only (+ "send to phone") · 19 — text rows with a small section icon by default, a toggle for thumbnails · 20 a — recipes
live inside the Supermarket tab (List | Recipes) for now; may move later · 21 yes — **recipes + AI shop planning are a
separate round/session (R18b)** · 22 a — "what's missing?" checklist when adding a recipe, no pantry inventory ·
23 b — "Build my list" also runs the evening before the usual day, **as a draft that never adds to, changes or removes
anything the user put on the list** (Tal: people build the list during the week) · 24 b — weekly meal planning later ·
25 yes, optional — usually one person shops · 26 a — chain + branch asked in onboarding, changeable per trip; **every
onboarding answer is editable in Settings** (fixes answers tapped by mistake).

## 1. Split
- **R18 (core):** P1–P13, P15–P18, D1, D3. "Build my list" here is rules-based (staples due, usual basket, holidays);
  the AI only phrases reasons (same as "Nexus suggests" on Home, rules-only setting respected).
- **R18b:** P14 recipes, D2, AI shop planning in the assistant ("Shabbat for 6", "a week of dinners").

## 2. Default section order (Israel, before any learning)
Israeli chains put produce at the entrance and bread / dairy / eggs at the back so shoppers cross the store; packaged
goods fill the middle aisles. The list follows a walk through the store, with frozen last so it stays cold:
1 Fruit & vegetables · 2 Meat, poultry & fish · 3 Deli & salads · 4 Dry goods (pasta, rice, legumes) · 5 Cans & sauces
· 6 Spices & baking · 7 Breakfast & spreads · 8 Snacks & sweets · 9 Drinks · 10 Cleaning & disposables · 11 Toiletries &
pharm · 12 Baby · 13 Pets · 14 Bread & bakery · 15 Dairy & eggs · 16 Frozen.
Per branch: the check order of past trips suggests a new order ("In this branch dairy comes before bread — use this
order?"); the user confirms or drags groups by hand (R18-PLANNING Q8 b).

## 3. "Build my list" and "Nexus suggests" — rules
- Suggestions live in their own block ("Nexus suggests" / the evening-before draft). The user's list is never changed by
  them: no item added, removed or re-quantified until the user accepts.
- Never suggest what is already on the list (any quantity) or was dismissed for this cycle; dismissing teaches.
- Each suggestion shows its reason in a few words ("every ~9 days", "Shabbat", "usually with pasta").
- Accept one / accept all → merged into the list (same product → quantity stays the user's unless it was empty).
- Evening before the usual day (learned weekday): the draft is prepared, one push "Your list for tomorrow: 18 items,
  Nexus suggests 4" → opens the Supermarket tab with the block expanded. Off switch in Settings → Supermarket.

## 4. Phone screens
**P1 Home — "Next shop" card.** Day · items · estimate vs budget · [List] [Start]. States: normal; shopping day
(moves to the top); trip in progress (Resume, items left); empty space (Build my first list).

**P2 Supermarket tab (planning).** Header: space · chain·branch chip · basket estimate. Add field always on top with
Scan / Photo / Voice / Recipe icons. "Nexus suggests" block (collapsible, reasons, accept all). The list in sections
(icon + name + count), rows = name · quantity · note line · who added (colour dot); pinned-to-store tag. Sticky
**Start shopping** above the dock. Top switch **List | Recipes**. ⋯ menu: templates, past trips, receipts, section
order, store. States: first time (start from "Basic weekly basket" or Build my list); normal; draft open; viewer
(read-only); offline (queued badge); thumbnails toggle on.

**P3 Add.** Type-ahead ranked by this household; "2 חלב 3%" → qty 2 + product; units (units / kg / g / L); a duplicate
→ "Milk is already on the list — now ×3" with Undo; Voice (listening state → split preview); Paste a list (WhatsApp) →
split preview with checkboxes.

**P4 Scan** (existing scanner) → found product → "Add to list" / quantity; unknown → name it.
**P5 Photo of a package** → AI names it → matched to the household's product → confirm (counts in the AI quota).

**P6 Item sheet (supermarket).** Quantity + unit, note ("lactose free"), a photo of the exact product for whoever
shops, section, staple (off / suggest when due / add by itself; the learned interval shown), preferred brand + accepted
substitutes, pinned store, history (last bought, where, price).

**P7 Store picker.** Chain + branch (default from onboarding), "for this trip only" vs "make default".
**P8 Section order.** Drag groups; the learned suggestion banner (Use · Not now).

**P9 Store mode** (full screen, dock hidden). Top: store · progress ring · faces of others in the trip. Sections in
order with "3/5"; a tapped row is struck through **in place**; a finished section folds to one ✓ line. Swipe → Not
found / Substitute; long-press → quantity / price. Bottom: running total vs estimate and budget · Finish. Live: items
added at home slide in highlighted (+ push); optional "Noa: fruit & dairy" section owners. Offline badge; Undo on every
change; big rows, high contrast, screen stays on, haptic tick.

**P10 Trip bar.** Leaving store mode mid-trip → a slim bar above the dock on every screen (items left · total) → back.

**P11 Finish.** Summary (bought · left · total vs budget) → "Photo of the receipt?" (Skip) → reconcile: prices saved per
branch; unchecked items found on the receipt → bought; checked but not on the receipt → "not scanned?"; extras learned;
still-unchecked → "Forgot 2 things" (Keep for next time · Remind me).

**P12 Templates.** Named lists; "Save this trip as a template"; apply = merge into the list (never duplicates).
**P13 Past trips.** Date · store · total · items; open → reuse as template / re-add items.

**P14 Recipes (R18b).** Grid with photos; recipe page (photo, servings stepper scaling quantities, ingredients, steps,
tags, source); add from photo (book / handwriting), link (the site's recipe data) or typing; "Add ingredients" →
"What's missing?" checklist → merged into the list; cooking mode (step by step, large text, screen on).

**P15 Entry points.** Long-press **+** → Add to list · Scan · Photo · Start shopping; app-icon shortcuts (same three
for the installed app); + on the Supermarket tab adds directly.

**P16 Push.** Evening-before draft (Open list); "Noa added milk" during your trip; trip started / finished (exists).

**P17 Onboarding + Settings.** New onboarding step: chain + branch (search, "I shop at several"). Settings →
**Supermarket**: default store, section order, staple behaviour, Build-my-list evening draft on/off, thumbnails, dock
tab 4 (Supermarket / Projects). Settings → **My answers**: every onboarding answer editable.

**P18 Products tab** (renamed from Shopping): segments **To buy · On the way · Projects** (projects open inside the
tab), list/grid as today.

## 5. Computer
**D1 Supermarket page.** Sidebar "Supermarket" near the top with a count. Two columns: the list by sections | side
panel (Nexus suggests, staples due, templates, estimate, store), "Send to phone" (a push that opens the list).
**D2 Recipes (R18b).** Grid + recipe page with the same actions.
**D3 Settings → Supermarket / My answers** as P17.

## 6. Every board
Phone 390 (+ 360 checks) and desktop 1366; light + dark; Graphite + Plum; Hebrew + English tweak; worst-case text
(long product names, 40 items, 16 sections); states as tweaks; reduced motion.
