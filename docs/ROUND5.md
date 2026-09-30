# Round 5 brief (from Tal, 2026-09-30) — read this instead of the chat history

Everything works; this round is UX polish. Quality bar: "very professional, refined, beautiful", calm motion.
**Every item must also work well on a phone** (390×844 and 360×800, touch, safe areas) — not just "not broken".
Token budget matters: follow CLAUDE.md "Working efficiently" and "Session workflow".

Two sessions. Tick `[x]` here as items ship; at the end of each session update SPEC.md (edit the Round 5 section,
never append a second copy).

---

## Session A1 — first load + logo (desktop + phone). Order: 0 → 1 → 2b → 2

### 0. [x] Tooling first: mobile smoke
`SMOKE_MOBILE=1 npm run smoke` runs the existing read-only checks in a 390×844 touch context (isMobile, hasTouch) and
saves screenshots with a `-m` suffix. Also add `SMOKE_TRACE=1`: record a Playwright video (or 60 ms screenshot
series) of the first 2.5 s after `goto("/")`, so load flashes can be judged from frames instead of by eye.

### 1. [x] Load like YouTube: shell first, soft skeletons, data fades in — no "refresh flash"
Today: opening the site shows a quick flashing/refresh-like animation that looks amateur.
Known causes to confirm with the trace before changing anything (fix what the frames show, don't guess):
- `src/app/page.tsx` awaits `getAppData()` before sending any HTML. `loading.tsx` stays invisible for 450 ms
  (`.loading-shell` delay), then the whole page swaps in at once.
- After hydration, `store.tsx` (effect ~line 148) switches `layout` from localStorage and `view` from `?v=` → a
  second visible re-render (cards→table, To-buy→other view) right after the first paint.
- Anything else the frames show (theme/locale, fonts, settle-in/`pop-in` animations firing on first render).
Wanted:
- The shell (sidebar, header, add bar) appears immediately and never re-renders visibly.
- Content regions (title/stats, grid or table, sidebar counts) show skeletons shaped exactly like the final content,
  with one calm shimmer (a slow soft light sweep, ~1.6 s, low contrast — like YouTube), not a pulse/blink.
- When data is ready it cross-fades in (opacity only, ~220 ms, ease-out; cards may stagger 15–20 ms, capped ~150 ms
  total). No layout shift (CLS ≈ 0), no double render, no flash on fast loads.
- Render with the right layout/view on the first paint: move `layout` (and sort) to a cookie read on the server
  like `getCurrencyPref`, and read `?v=` from `searchParams` in `page.tsx`. Keep localStorage only as a migration
  fallback.
- Prefer streaming the data-dependent part (Suspense / React 19 `use()` of a promise passed to the client) over the
  whole-page `loading.tsx` swap if the trace shows `getAppData` is slow; decide in plan mode, explain in one line.
- `prefers-reduced-motion`: no shimmer movement, instant swap.
Acceptance: trace frames at desktop + mobile show shell → skeleton → content with no blank frame, no second layout,
no jump; `npm run -s check` OK; smoke PASS.

### 2. [x] Phone opening animation (PWA + mobile browser)
Today the phone shows only the static logo while the app loads. Wanted: a short, cute, cool opening animation until
the app is ready.
- The Android native splash (manifest icon on `background_color`) cannot animate. So: an in-app boot screen that is in
  the **initial HTML** (pure SVG + CSS in `layout.tsx`, no JS needed to start), shown on phones only
  (`(max-width: 768px)` or `(display-mode: standalone)`), once per app open (not on in-app navigation).
- Concept (built from the logo, `public/icons/icon.svg`: a center node linked to three outer nodes):
  center node pops in with a small overshoot → the three links draw out from the center (stroke-dashoffset) →
  outer nodes pop in one after another → one soft "heartbeat" glow on the center while waiting → when the app is ready
  the mark scales down slightly and the screen fades out into the (already rendered) app. "Nexus" wordmark fades in
  under the mark. Colours from tokens; background identical to the native splash colour so native → boot screen is
  seamless (sync `manifest.ts` `background_color`/`theme_color` with the dark `--bg`).
- Timing: first sequence ~900 ms; it never delays a ready app beyond finishing that sequence (max hold ~400 ms after
  ready); if loading takes longer, the heartbeat loops. Hidden via a class set when the store has mounted.
- Reduced motion: static mark + simple fade.
- The animation uses the teal logo from item 2b.
Acceptance: `SMOKE_MOBILE=1 SMOKE_TRACE=1` frames show the sequence and a clean hand-off; desktop never shows it.

### 2b. [x] Logo accent: orange → teal (decided by Tal) — do this before item 2
The logo's center node is still the old orange (#f2a93b) while the app accent is teal since Round 4. Align everywhere:
- `public/icons/icon.svg`, `public/icons/maskable.svg`: center node → dark-theme `--accent` (#14a898).
- `src/components/logo.tsx`: center node uses `var(--accent)` (follows light/dark), not a hard-coded colour.
- Regenerate the PNGs from the SVGs at the same sizes: `favicon-48.png`, `icon-192.png`, `icon-512.png`,
  `maskable-512.png` (sharp is fine; a one-off script under `scripts/` that can be re-run, e.g. `scripts/icons.mjs`).
- Extension: `extension/icons/*` and `extension/popup.css` (`--accent`, `--accent-fg` → the teal pair from
  `globals.css`); bump the extension version (patch).
- Leave `src/components/app/view-items.ts` `amber` alone — it's a collection colour choice, not the brand.
Acceptance: `rg -n "f2a93b" public src extension` returns only the `amber` collection colour; icons look right at
16/48/192 px (one screenshot of the favicons side by side).

---

## Session A2 — assistant, order by store, toasts (desktop + phone)

### 3. [x] Assistant suggestions that fit me
Today `assistant-panel.tsx` shows 4 fixed questions (`t.ai.ex1..ex4`). Wanted: suggestions generated from the user's
own data and activity — instant and free (client-side, no AI call).
- New pure module `src/lib/assistant-suggestions.ts`: `(items, collections, view, recentQuestions, now) → Suggestion[]`.
  Candidate rules, each with a relevance score; show the top 4 with variety (max one per rule family):
  current view/project context ("How much is left for <project>?", "What's missing to finish <project>?");
  project near/over budget (≥90 %); urgent items not ordered; store with the most to-buy items ("What should I order
  from <store>?"); ordered items with an ETA this week / overdue; watched items with a recent price drop or at target;
  alternatives groups without a winner ("Help me choose between <a> and <b>"); many Unsorted items ("Which project
  should my unsorted items go to?"); recent additions (last 3 days); spending this month vs last month.
- Recently asked questions (last 5, localStorage) are not repeated; clicking one records it.
- Templates in both dictionaries with placeholders; names inserted inside the `.bidi` isolation so mixed Hebrew/English
  names render correctly. Empty/new account → the current 4 static questions.
- After an answer, show 2–3 follow-up chips under it (same module, excluding what was just asked).
- Phone: chips in one horizontally scrollable row (snap, no wrap into 4 lines), 40 px tap height.
Acceptance: a tiny unit test for the module (pure input → expected questions) via `tsx`; smoke checks chips render.

### 4. [x] Order by store: tell stores apart at a glance + make the cards/table toggle work
Today stores differ only by name, and the cards ↔ table toggle does nothing in this view (`orders-view.tsx` never reads
`s.layout`).
- Store identity, one component `StoreMark` (`src/components/ui/store-mark.tsx`) used in the orders view group headers
  and also next to the store name on cards, table rows and the item sheet's Stores list:
  - Logo: the store's favicon (`https://www.google.com/s2/favicons?domain=<host>&sz=64`, lazy, 20–24 px, rounded),
    falling back to a monogram tile on error.
  - Colour: a curated set of ~8 store hues defined as tokens in `globals.css` (both themes, tuned to the Ink & Teal
    palette, muted — not rainbow). Known stores get a fixed hue (AliExpress, Amazon, KSP, eBay, IKEA, Ivory, Bug,
    Temu…); others get a stable hue from a hash of `storeKey`.
  - Group header: logo + name + item count + subtotal, a 3 px coloured bar on the start edge and a very light tint of
    the store hue on the header; items in the group keep a thin start-edge line in that hue.
- Toggle: cards = current layout; table = each store group rendered as table rows (reuse `ItemTable` if it fits,
  otherwise the same columns). On phones the "table" becomes compact stacked rows. Check every view that shows the
  toggle; hide it where a view has no second layout.
Acceptance: smoke switches the toggle in the orders view and asserts the layout changed; screenshots desktop + mobile.

### 5. [x] Toasts: faster, obvious close, swipe away
Today toasts (sonner, `src/components/providers.tsx`) appear a bit slowly and it's unclear they can be dismissed.
- Appear faster: shorten sonner's enter animation to ~180–200 ms (override its CSS in `globals.css`), and make sure
  toasts for optimistic actions fire immediately, not after the server action returns.
- `closeButton`: a clear ✕ on the end side (RTL-aware), 32 px tap target on phones, visible on hover on desktop and
  always on touch.
- Swipe/drag to dismiss sideways with mouse and touch: `swipeDirections` both horizontal directions (and down on
  phones). Keep durations: normal ~4 s, with Undo ~7 s; pause on hover.
- Phone: position bottom-center, above the add bar / bottom UI, safe-area inset, max one line of title + action.
Acceptance: smoke triggers a toast and checks the close button; mobile screenshot.

---

### 6. [x] Small carry-over from A1 (see Open)
Clicks in the streamed loading shell are lost when the data arrives (e.g. opening the assistant during a slow load).
Lift panel/dialog open-state above the Suspense boundary so a click made while loading takes effect once the app is
in; if that's more than a small change, disable those header/sidebar buttons while `loading` instead. Remove the
Open line when done.

## Next (planned in chat, not for Claude Code yet)
- Round 6: new features + upgrades (list to be written with Tal).
- UI "next level": research tools/workflow to go from "amateur+" to professional (design system, reference
  products, component libraries, motion, visual QA). Output will be a separate brief.

---

## Open
- (A1) Sidebar "Unsorted" entry and a project's budget bar appear only once data is in (their existence is data),
  so on those the sidebar / project header can shift a little after a slow load.
- (A1) Reduced-motion rules and the boot screen in a real installed PWA (Android splash → boot hand-off) were not
  checked on a device — only in Playwright at 390×844 and via CSS review.
- (A2) Store favicons come from Google's s2 service (the brief's choice), so store hosts are sent to Google when a
  store mark renders; unknown hosts (16 px globe) keep the monogram. Tell me if you'd rather proxy/cache them.
- (A2) Toast check and swipe run only with `SMOKE_WRITE` (they need a real toast); the read-only prod smoke can't
  trigger one. Toast swipe on a real phone was only checked with Playwright CDP touch events at 390×844.
- (A2) On phones the toast description is clamped to one line (with the title) rather than hidden.
