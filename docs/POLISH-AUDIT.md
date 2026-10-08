# Polish audit (read-only) — 2026-10-08

No app code was changed. This is a list of findings, ranked, each with its fix in one line. Rows marked **DESIGN**
need a decision first and go to the R17 mockup session. They should not go straight into code.

## How it was run

- **Skills** (MIT, copied from `emilkowalski/skills@e8a175d` into `.claude/skills/`): emil-design-eng,
  review-animations, improve-animations, find-animation-opportunities, mobile-native, break-ui, apple-design,
  animation-vocabulary, ask-sonner. The skills were used as checklists. The "Why" column cites the rule each finding
  breaks.
- **Build:** a local production build (`next build` + `next start -p 3110`) on an isolated file DB, `polish-smoke.db`
  (gitignored). It was migrated fresh for a fake `…@example.com` admin and seeded with `seed-local.mjs`. Three more spaces
  hold worst-case data: **Empty** (0 items), **One** (1 item, 1 project), and a 500-item space with a long Hebrew name.
  The 500-item space has 14 lists (long, one-letter, emoji, German compound), long, unbreakable, Vietnamese, CJK and
  `<script>` titles, a long store name, prices of 0, 0.30000000000000004 and 12,345,678.9, qty 1000, and members such as
  "Jo", "👩🏽‍💻 Priya", an Arabic name and a long plus-addressed email. The run used no real account and no prod. Ably,
  Gemini, Groq and Serper keys were blanked and `NEXUS_AI_MOCK=1` was set.
- **Matrix:** 135 page loads covering phone 360 and 390 (touch, DPR 2) and desktop 1366, light and dark, English and
  Hebrew, across 9 routes and 4 spaces. Each load was probed for horizontal overflow, inputs under 16px, targets under
  40px, raw values (`NaN`/`undefined`/…), "1 items"-style plurals and console errors. Interaction probes covered the phone
  boot, sheet open and close, the "+" menu, a desktop dropdown, the Ctrl K palette, view switches, the delete→Undo toast
  (3 setups), reduced motion and the login page. Each probe read `document.getAnimations()`.
- **Not verified on hardware.** Chrome emulation cannot reproduce input zoom, sticky hover, tap delay or rubber-banding
  (mobile-native rule 11). Findings that depend on those come from the CSS rule and the measured value. Check them on a
  real phone after fixing.

Effort: **S** < 1 h, **M** a few hours, **L** a day or more.

## P1 — broken / feels bad

| # | Screen | What's wrong | Why (skill rule) | Fix (one line) | Effort | Design? |
|---|---|---|---|---|---|---|
| 1 | Every phone screen with a field: the paste bar (15px), Search and History search (14px), the **item sheet** (Qty/Price/Shipping/Notes 14px, Currency select and Add tag 12px), Settings search and selects (13px) | iOS Safari zooms the page when any of these fields gets focus and does not zoom back out. Focusing Price in the item sheet leaves a cropped, zoomed layout. `Input`/`Textarea` default to `text-sm` (`ui/button.tsx:44`), and the `.nx` kit inherits 14px (`auth/nx.css:13`) | mobile-native §4: inputs need at least 16px, and disabling zoom is not the fix | One global rule in `globals.css`: `@media (pointer: coarse) { input, textarea, select { font-size: 16px } }`. Re-check the paste capsule and qty field height | S | — |
| 2 | Toasts on a phone (delete → **Undo**) | The Undo action button is **41–44 × 24 px**. It is the only way to recover a delete, sitting just above the dock where thumbs are. The ✕ is 40 × 40, so a near miss closes the toast | mobile-native §5; CLAUDE.md touch targets of at least 40px | Under `(pointer: coarse)`, give `[data-sonner-toast] [data-button]` a 40px height, `padding-inline: 14px` and 14px text in `globals.css` "Toasts" | S | — |
| 3 | Settings → Notifications, AI, Display (every switch) | Switches are **36 × 20 px**. The row around them (`.li`) cannot be tapped. The knob jumps with no transition (`auth/nx.css:63-66`, `settings/ui.tsx:70`) | mobile-native §5 (feedback on press); emil "state indication"; at least 40px targets | Make the whole `.li` row the switch's hit area (wrap in a `<label>` or put `onClick` on the row). Move the knob with `transform: translateX(16px)` plus `transition: transform 160ms var(--ease-out), background-color 160ms` | S | — |
| 4 | Shell and sheets, phone | Many targets are under 40px. The top bar has Search and Assistant at 36, the avatar at 32. The item sheet has Close and More at 32, and To buy/Ordered/Received and the priority segments at 30–32. **The modal ✕ is 24 × 24** (`ui/overlays.tsx:84`). The suggestion pager dots are 6 × 20. The text links "Month", "All", "Track all" and the login footer links are 17–19 px tall | mobile-native §5; CLAUDE.md "touch targets ≥ 40 px" | Keep the visuals and grow the hit area with an `after:absolute after:-inset-2` pseudo-element, as `phone-shell.tsx:40` already does at -0.5. Apply it to the shared `icon`/`icon-sm` Button sizes, `D.Close`, the segments and the text links | M | — |
| 5 | Every bottom sheet and modal, closed with ✕, Esc, the scrim or Back | **Closing teleports.** The dialog is gone within 30 ms with no exit, and only swipe-down animates out. Opening slides up 320–380 ms, so the exit does not mirror the entry | emil "preventing jarring changes"; apple-design §7 "enter and exit along the same path" | Add `[data-state="closed"]` keyframes (Radix keeps the node until they end): `.sheet-phone/.modal-phone` → `translateY(100%)` 200 ms `cubic-bezier(0.32,0.72,0,1)`, the scrim → fade 150 ms, desktop side sheets → slide to the end edge 180 ms | M | — |
| 6 | Every route in the 500-item space, all viewports | React **hydration error #418** (text mismatch) is logged on every load. React then throws away the server HTML and re-renders on the client, which can flash and costs the streamed first paint. The seeded personal space does not trigger it, so some value in the worst-case data renders differently on the server and the client (candidates: the `<script>`/emoji/ZWJ titles, the 0.30000000000000004 price, the 1000 qty) | break-ui "States: error" — the worst case shows a break the demo data hides | Reproduce with `next dev` on the 500-item seed, read the unminified diff, then make that value deterministic (format on one side only, or `suppressHydrationWarning` on the exact node) | M | — |
| 7 | Phone and PWA app open | The full opening plays for **about 2.9 s on every phone app open**. The shell was ready at **0.35 s**, and the opening cannot be skipped (`lib/boot.ts`, "no skip (Tal's choice)") | emil and find-animation "frequency": tens of opens a day earn no delight budget; apple-design §1 "kill latency" | **DESIGN** (re-raises a settled choice for R17 only). For example, the full sequence on the first open of the day (as desktop does) and the small mark otherwise, or let a tap skip it | S once decided | DESIGN |

## P2 — noticeably better

| # | Screen | What's wrong | Why (skill rule) | Fix (one line) | Effort | Design? |
|---|---|---|---|---|---|---|
| 8 | Hebrew UI: store names on rows and cards, the toast description | Left-to-right strings in an RTL container lose their **start**: "…ndustries Holdings International Outlet Store", "…portrait_edited_edited_FINAL_v12.HEIC". This hits most store names and any English item name inside a toast. Product titles on cards already use `.bidi` and are fine | break-ui "truncate at the end where the start carries the meaning"; catalog "RTL" | Add `dir="auto"` (or the existing `.bidi` class) to the store span at `item-card.tsx:439` and to the toast title and description (pass them as `<span dir="auto">`) | S | — |
| 9 | Toasts on phone | Title and description are forced to one line with an ellipsis (`globals.css:612`). In "Item deleted" toasts the item name is the only content, and it cannot be read | break-ui "truncated text with no way to read it" | Keep the title to 1 line and clamp the description to 2 lines (`-webkit-line-clamp: 2`) instead of `nowrap` | S | — |
| 10 | Command palette (Ctrl K and the search button) | It opens with `pop-in` 240 ms plus an overlay fade 150 ms (`command-palette.tsx:84-85`), even though it is keyboard-triggered and used constantly | emil, review-animations standard 2: "never animate keyboard-initiated actions" (the Raycast rule) | Remove `animate-pop-in`/`overlay-in` from the palette. It should appear and disappear instantly | S | — |
| 11 | Every `Button` (the app's main press) | The transition uses the overshoot curve `--ease-spring` (`cubic-bezier(0.2,1.4,0.4,1)`, `ui/button.tsx:29`) on transform **and** colors, so each release overshoots past scale 1 and hover colors swing past their target | emil "buttons: `scale(0.97)`, 160 ms ease-out"; review-animations 9 "system response snaps"; apple "bounce only after momentum" | `transition-[transform,background-color,color,opacity,box-shadow] duration-150 ease-[var(--ease-out)]`, keeping `active:scale-[0.96]` | S | — |
| 12 | Phone "+" menu | The icon rotates 450 ms on the overshoot spring. Tiles rise 450 ms with up to 125 ms of stagger, and the chips row waits 150 ms, so the menu settles after about 600 ms (`phone-shell.tsx:201,279,297-299`). It opens tens of times a day | emil "UI under 300 ms"; stagger 30–80 ms | Tiles and chips: 220 ms `cubic-bezier(0.23,1,0.32,1)`, stagger at most 40 ms, no chip delay. Icon: 200 ms ease-out, no overshoot | S | — |
| 13 | View switches (dock and sidebar) | Each switch replays the page's first-paint motion: `view-fwd` 320 ms plus `rise-in` 600 ms (with 110–165 ms delay) on hero cards plus `grow-x` 900 ms on bars. It runs tens of times a day | emil frequency table, "under 300 ms"; improve-animations §1 | Play `rise-in`/`grow-x` once per session, not per view. Shorten `view-fwd`/`view-back` to 200 ms | M | — |
| 14 | Bottom sheet swipe-to-close | After a fling the sheet finishes on an **ease-in** curve, `cubic-bezier(0.3,0,0.8,0.15)` 220 ms (`ui/sheet-drag.ts:68`). It slows to near zero right as the finger lets go, then speeds up | apple-design §5 "velocity handoff"; emil "never ease-in on UI" | Use `cubic-bezier(0.32,0.72,0,1)` with duration `clamp(120, remaining/|v|, 260)` ms so the sheet leaves at the finger's speed | S | — |
| 15 | Phone rows (To buy and other lists), 360/390 | Unbreakable titles (camera filenames, SKUs) are cut off mid-glyph with **no ellipsis** under `prow:line-clamp-1` (`item-card.tsx:426`). Other rows truncate cleanly | break-ui signature "text overflows its box"; catalog "IMG_…HEIC" | Add `[overflow-wrap:anywhere]` to the title `h3` so the clamp can place its ellipsis | S | — |
| 16 | Reduced motion (OS setting or Settings → Motion) | Everything drops to 0.01–1 ms (`globals.css:526-530, 1013-1020`). Sheets, modals, toasts and menus also lose their **fades**, so they blink in and out (sheet open measured with 0 animations) | emil, apple §14: "reduced motion = gentler, not zero; keep opacity" | Under reduce, override movement keyframes (`sheet-up`, `slide-from-*`, `pop-in`, `view-*`) with `fade 150ms ease-out` rather than zeroing every duration | M | — |
| 17 | Always-visible ambient loops | The paste capsule's `flow-border` (5.5 s, infinite) shows on every screen. The Suggests card runs `r13-sheen` (10 s) and `r13-twinkle` (3.2 s) forever | apple §14 "avoid slow looping oscillations"; find-animation "decoration on functional UI hinders"; battery | **DESIGN**: run each loop once on mount or focus (or while the AI is working), then rest | S | DESIGN |
| 18 | Desktop sidebar collapse, add bar, logo, budget/progress bars | Layout properties are animated: `grid-template-columns` 400 ms (`nexus-app.tsx:123`), `inset-inline-start` 450 ms (`add-bar.tsx:250,257`), `width,padding` 450 ms (`logo.tsx:33`), and bar `width` 500 ms (`budget-card.tsx:193`, `orders-shipping.tsx:41`, `import-dialog.tsx:288`) | emil/review-animations 7 "transform and opacity only" | Bars: `scaleX` with `origin-[inline-start]`. Sidebar, add bar and logo: animate `transform` on the moving piece, or snap and crossfade | M | — |
| 19 | Phone modals | `.modal-phone { max-height: 90vh }` (`globals.css:552`). With the URL bar showing, the bottom of a tall modal sits under the browser chrome | mobile-native §3 | `max-height: 90dvh` | S | — |
| 20 | Settings and auth kit (`.nx`) | It has **no `:active` feedback anywhere** (`.li` rows, `.tile4`, `.btn`, `.seg` buttons — 0 matches in `nx.css`/`nx16.css`). With the tap highlight removed, a tap gives no response until the page changes. Its `:hover` backgrounds are not gated (`nx16.css:6,22,54,69`), so they stick after a tap | mobile-native §1, §2, §5 | Add `:active { background: var(--hover) }` (plus `scale(.98)` on `.btn`/`.tile4`, 120 ms ease-out), and wrap the `:hover` rules in `@media (hover:hover) and (pointer:fine)` | S | — |

## P3 — nice to have

| # | Screen | What's wrong | Why (skill rule) | Fix (one line) | Effort | Design? |
|---|---|---|---|---|---|---|
| 21 | Dropdowns and popovers (space switcher, sort, more) | `pop-in` scales from the menu's centre (measured `150px 178px`) while Radix provides `--radix-dropdown-menu-content-transform-origin` (`0% 0px`) (`ui/overlays.tsx:179,225`) | emil, review-animations 5 "origin-aware popovers" | Add `origin-[var(--radix-dropdown-menu-content-transform-origin)]` (and the popover variable) to `MenuContent`/`PopContent` | S | — |
| 22 | Sonner `<Toaster>` | `theme` is not passed, so the toaster reports `data-sonner-theme="light"` in dark mode. Colours look right only because `classNames` override them; the loading and rich icons and any un-overridden parts stay light (`providers.tsx:48`) | ask-sonner "Theme defaults to light" | `theme={resolvedTheme}` from `next-themes`' `useTheme()` | S | — |
| 23 | Home stat tiles and the To buy summary with very large totals | **Numbers get an ellipsis**: "…9,882,945,541", "₪49,882,945,541 · 100 u…" | break-ui "never truncate numbers or amounts" | Switch to compact notation (`Intl.NumberFormat({ notation: "compact" })`, e.g. ₪49.9M) when the full figure does not fit, and keep the full value in `title` | S | DESIGN (the threshold) |
| 24 | Home, a space with one item | The "Spent in October" hint is cut to "Set a budget to track your…" with no way to read the rest | break-ui "truncate + nothing else" | Clamp it to 2 lines | S | — |
| 25 | Top-bar circle buttons (search, assistant, avatar) | `active:scale-95` with no transition, so the press snaps instead of easing (`phone-shell.tsx:40`) | emil "press feedback 100–160 ms ease-out" | `transition-transform duration-[120ms] ease-[var(--ease-out)]` | S | — |
| 26 | Bottom sheet drag upward | It is a hard wall (`Math.max(0, …)`, `sheet-drag.ts:39`). The pager already rubber-bands (`lib/gestures.ts` `pagerOffset`) | apple §9, emil "friction instead of hard stops" | Reuse the same `60·(1−e^(−d/150))` band for negative `dy` | S | — |
| 27 | Desktop assistant panel | It slides in over 450 ms on the overshoot spring, so the panel bounces past its edge (`globals.css:809`) | emil "under 300 ms"; apple "bounce only after a flick" | 260 ms `cubic-bezier(0.32,0.72,0,1)` | S | — |
| 28 | Motion tokens | `--ease-out` is `cubic-bezier(0.2,0.8,0.2,1)`, softer than the reference curve. About 8 near-identical curves are hand-typed (`0.22,1,0.36,1`, `0.16,1,0.3,1`, `0.2,0.9,0.3,1`, …), and `--ease-out` is defined twice (`globals.css:286, 342`) | improve-animations §7 "cohesion & tokens" | Define `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out: cubic-bezier(0.77,0,0.175,1)` and `--ease-drawer: cubic-bezier(0.32,0.72,0,1)` once, then replace the inline curves | M | — |
| 29 | Fast navigation across spaces | Requests returned **429 Too Many Requests** while the audit moved through pages at about one every 2 s, switching spaces (3 setups) | break-ui "fragile" | Find which route rate-limits page navigation and allow normal browsing pace (or retry quietly) | S | — |
| 30 | Phone list rows (cards) | Rows have no press state on touch: `active:shadow-lift` is overridden by `max-sm:shadow-[…]` and there is no scale (`item-card.tsx:363-366`) | mobile-native §5, find-animation "feedback gaps" | `max-sm:active:bg-surface-2` (rows are hit tens of times a day, so a colour change only) | S | — |

## What held up

- No horizontal overflow at 360 or 390 in any space, theme or language, including the 500-item space and its long
  Hebrew space name.
- Escaping is correct. `<script>alert(1)</script> &amp; **bold**` renders as literal text.
- Plurals hold in the one-item space ("1 item", "0 packages"), and no `NaN`/`undefined`/`null` showed anywhere.
- The **empty space** Home is a good first-run screen: four clear starting actions and no broken widgets (screenshot 08).
- Toasts: placed above the dock and the safe area, swipe directions set for phone, ✕ at 40 × 40 on touch, transitions
  (not keyframes) so they retarget, dark colours correct, and a 7 s duration for Undo.
- Platform layer: no tap highlight (Tailwind preflight), `overscroll-behavior` contain with a custom pull-to-refresh,
  `viewport-fit=cover` with `env(safe-area-inset-*)`, `theme-color` per scheme, and Tailwind `hover:` gated to hover
  devices.
- Gestures: fling-based dismissal (`FLING = 0.5 px/ms`), velocity sampled over the last 100 ms, a rubber-banded pager,
  pointer capture, an axis lock, and `touch-action: none` only on the grip.
- The card→sheet picture morph, `content-visibility` on long grids, and reduced-motion handling on almost every loop
  (the problem is only that it removes too much — #16).

## Skill notes (what was skipped)

- **break-ui** Phase 3 (a dev-only "Demo / Worst case" toggle wired into the app) and Phase 6 (fix on request) were
  skipped because they change app code. The worst case was fed in through the DB instead, which is the same data
  boundary.
- **improve-animations** writes `plans/NNN-*.md` and has an `execute` mode that dispatches executors. Both were skipped:
  this doc is the only output, and each row's one-line fix is the plan seed.
- **mobile-native** says to "apply the fixes" and to test on hardware through a LAN dev server. It was not applied
  (read-only session), and no phone was connected. See "Not verified on hardware" above.
- **emil-design-eng / review-animations** prescribe a Before/After table format for code reviews. This audit uses the
  brief's format instead.
- The skills' "Initial Response" scripts and their external links (easing.dev, easings.co, animations.dev, Sonner docs)
  were not followed or fetched. No skill asked to change settings, and no script inside the skills was run.

## Screenshots (`docs/design/polish/`)

| File | Shows |
|---|---|
| `01-boot-phone.png` | The phone opening at about 1 s; the app shell was already ready (#7) |
| `02-toast-he-truncation.png` | Hebrew dark: store names and the toast description cut at their start (#8, #9), the small Undo button (#2) |
| `03-rows-worst-case-360.png` | 360px rows: the clipped unbreakable title in row 1 (#15) and the truncated To buy summary (#23) |
| `04-home-he-big-numbers.png` | A Home total truncated with an ellipsis (#23) |
| `05-plus-menu.png` | The "+" menu once it settles (#12) |
| `06-one-item-home.png` | The one-item space: plurals right, the hint cut off (#24) |
| `07-item-sheet-inputs.png` | The item sheet fields that zoom on iOS (#1), 32px header controls (#4) |
| `08-empty-space-held-up.png` | The empty-space Home, which held up |

## Fixes (2026-10-08)

Branch `polish-fixes` (from `main` at `714a1a9`), one commit per row (`polish.<n>: …`), pushed after each priority
group, then fast-forwarded into `main`. Order as asked: #29, P1, P2, P3, except that **#28 (motion tokens) went first
among the motion rows** (before #5). The exits, the drawer curve (#5, #14, #27) and the `+` menu (#12) all needed
`--ease-drawer` and the stronger `--ease-out`, so defining them once first made every later row one token instead of
another hand-typed curve. No DB schema change. The help file was not touched (see "Help-worthy" below).

### Per row: what was done, and where it differs from the one-line fix

| # | Done | Notes / why |
|---|---|---|
| 29 | `/api/realtime/token` 30 → **120 per minute per user** | That was the limiter. Every page load asks for one token (an Ably TokenRequest for the current space), so about 30 loads a minute (fast space switches, a few tabs) hit 429. Reproduced: 14 × 429 in 30 navigations. Signing is local (no Ably call), a refused tab falls back to polling, and 120/min still stops a loop. Auth (Better Auth rules, OTP, recovery, invite/join/waitlist), AI, writes (space create/invite/join, space photo) and the error intake keep their limits. `test:tenancy` now expects 429 on the 121st call. |
| 1 | One `@media (pointer: coarse)` rule: text fields 16px (`!important`, so the `.nx` kit and `text-sm` both lose) | Fields that are already bigger opt out with `data-big` (item sheet name 17px, compare-group name 20px). The sign-in code boxes keep 22px. Every field was re-measured at 360/390: **no height changed** (paste capsule 58/62, Qty 34, Price/Currency/Shipping 32, Notes 80, searches 38). Selects got wider (Currency 57 → 65, Motion 118 → 136), with no overflow anywhere. |
| 2 | As the row | Undo is 40px tall, with 14px text and 14px side padding, on touch only. |
| 3 | A tap anywhere on a switch row flips it; the knob moves with `translateX(16px)` over 160 ms | Done in `Li` (the row's `onClick` forwards to its switch), not by wrapping the row in a `<label>`. Some rows also hold a select (Price drop %), and a label would steal its taps. Taps on the row's own select or button stay theirs. The switch stays the keyboard and screen-reader target. |
| 4 | `.hit` utility: on touch, an invisible box of at least 44 × 44 centred on the control | Applied to the shared `icon`/`icon-sm` Button sizes, the Modal ✕/back, and the item sheet's ✕, more, status and priority segments. The top-bar circles were already 40 via `::after`, except the avatar (36 → 40). The card text links ("Month", "All", "Track all") already had a −12px `::after`; the audit measured the element box. Login links get a 40px-tall `::after` on touch. Pager dots are 32 × 40, not 40 wide, because a 40px pitch would spread the dots visibly. |
| 5 | `[data-state=closed]` exits | Phone sheets, modals and quick actions go down in 200 ms on `--ease-drawer`. Desktop side sheets go to their end edge in 180 ms. Desktop modals, dropdowns and popovers pop out in 150 ms. The scrim fades in 150 ms. The card-morphed sheet fades while the picture flies back. The keyframes are `to`-only, so an exit starts wherever the surface is. **Extra:** the item sheet keeps showing its item while it leaves (it used to go blank the moment the store cleared it). The smoke's `openPalette` helper now waits for the palette itself, because a closing sheet is still a dialog for 200 ms. |
| 6 | Real cause: avatar/tile **initials** took `name[0]` | For "👩🏽‍💻 Priya" that is half a surrogate pair. The server streamed U+FFFD and the client rendered the lone surrogate, so #418 fired on every route that showed that member. Fixed at the source with `initialOf()` (first grapheme, `Intl.Segmenter`) in all 11 places that cut a first letter. No `suppressHydrationWarning`. Repeatable: `scripts/seed-worst.mjs` (Empty, One and a 500-item space, like the audit's DB) plus `npm run test:polish`, which loads 10 main routes (desktop English, phone Hebrew) with **0 hydration errors**. |
| 7 | Tal's rule | Phones now also play the full opening only on the first app open of the day (shared key `nexus.bootDay`). Every other open, reload and back/forward shows the small mark. The comment in `lib/boot.ts` now states the daily rule instead of "no skip". Reduced motion is unchanged. The smoke's boot steps follow the new rule. |
| 8 | `.bidi` on store names (rows/cards, compare sheet, orders) | Toasts get one CSS rule (`unicode-bidi: plaintext` on `.nx-toast-title/.nx-toast-desc`) instead of wrapping each call's strings in `<span dir="auto">`. It covers every `toast()` call site (about 60) without touching them. |
| 9 | As the row | The title keeps 1 line; the description gets 2 (`-webkit-line-clamp`, `overflow-wrap: anywhere`). |
| 10 | As the row | The palette's product thumbnails no longer fade in either (they were 48 running animations on open). |
| 11 | As the row | `duration-150 ease-[var(--ease-out)]`, `active:scale-[0.96]` kept. |
| 12 | As the row | Tiles and chips 220 ms on `--ease-out`, stagger in 20 ms steps (60 ms at most), no chip delay. The icon turns in 200 ms ease-out. |
| 13 | Rise-in, bar growth and card stagger are off inside a switched view; the slide is 200 ms | This is "once per page load" rather than once per session. `.view-in` only wraps views reached by switching, so the first view of a load keeps its first-paint motion and no switch after it replays it. Insights' `grow-y` is included. |
| 14 | As the row | `sheetExitMs(remaining, v)` = remaining / velocity, clamped to 120–260 ms, on `--ease-drawer`. Unit-tested in `test:gestures`. |
| 15 | As the row | |
| 16 | Gentler, not zero | Movement stops: keyframes jump to their end and transform/size transitions snap. `transition-property` keeps opacity and colours. Sheets, modals, menus, view switches, sub-pages and toasts **fade in and out in 150 ms**. The OS setting and Settings → Motion = Reduced behave the same. |
| 17 | Tal's rule | The loops stay `infinite` in CSS. `lib/ai-work.ts` pauses each one at its next cycle boundary unless AI work is in flight, and resumes them when work starts. AI work means a link being read, the assistant answering, or Home suggestions loading. The boundary is the loop's start pose, so resting is seamless. It isn't done by switching `animation-iteration-count`, because Chrome doesn't restart a finished CSS animation when its count changes (measured). Reduced motion: no loops at all. |
| 18 | No layout-property animation is left in the listed places | Single bars (shipping gap, import) grow with `scaleX` from the inline start. The budget segments (a stacked flex bar) snap when the data changes; their entrance is still `grow-x`. The desktop sidebar collapse snaps its columns inside a **180 ms cross-fade view transition** (opacity only). Morphing three moving pieces with transforms was more code than this row is worth. The add bar and its fade no longer animate their inset; they move with the cross-fade. `LogoPill` (the `width,padding` one) turned out to be unused; its transition is gone anyway. |
| 19 | `90dvh` | The quick-action sheet too (`80vh` → `80dvh`). |
| 20 | As the row, in the kit itself (`nx.css`) | The sign-in screens get press feedback too, not only Settings. |
| 21 | As the row | In the Tailwind v4 form `origin-(--radix-…-transform-origin)`. |
| 22 | As the row | `ThemedToaster` sits inside the ThemeProvider (verified: `data-sonner-theme="dark"`). |
| 23 | Tal's rule: `FitMoney` | It measures its own line with a ResizeObserver: it swaps the full figure in for one layout read, with no digit threshold. It shows `Intl` compact notation (`notation: "compact"`, currency kept, locale-aware) only when the full figure doesn't fit. A long-press on touch shows the full value in a toast. Used in the Home stat tiles and the phone To buy tile. **Deviation:** the full value is in `title` and in screen-reader text inside the number, not in `aria-label`. ARIA forbids naming a plain `<span>`, and screen readers ignore the label there. In Hebrew, Chromium's ICU writes the compact form as "₪62.2B". |
| 24 | As the row | |
| 25 | As the row | |
| 26 | As the row | The pager's band is now the shared `rubberBand()` in `lib/gestures.ts`, unit-tested. |
| 27 | As the row | |
| 28 | Done first (see above) | `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out` and `--ease-drawer` are defined once in `:root` (the `@theme` duplicate is gone), with a JS mirror in `lib/motion.ts` for WAAPI. Every hand-typed UI curve now uses them. The opening keeps its choreographed curves: the gravity drop's ease-in fall is physics, not UI. |
| 30 | As the row | `max-sm:active:bg-surface-2`, 100 ms. |

### Guards (kept)

- **`npm run test:polish`** is new and runs in `guards.yml` after `test:live`. It starts `next dev` on a throwaway DB
  seeded by `seed-local` and `seed-worst`, and checks:
  - 0 hydration errors on 10 routes of the 500-item space (desktop English, phone Hebrew)
  - text fields are at least 16px on a coarse pointer (paste bar, search, item sheet, settings)
  - a tap area of at least 40 × 40 for the icon Button sizes (`button.hit`), the Modal ✕ and the sheet's ✕, more and
    segments
  - the toast's Undo is at least 40 × 40
  - a switch row flips from its title and is at least 40px tall
  - the item sheet (✕) and a modal (Esc) on the phone, and the side sheet (Esc) on desktop, run an exit animation
    before unmounting
  - reduced motion: the sheet fades in 150 ms both ways
  - the palette opens with 0 animations
  - no amount in the Home stat tiles or the To buy tile is cut (Hebrew, 360)
  - 30 navigations across 3 spaces get 0 × 429
- `test:gestures` covers `sheetExitMs` and `rubberBand`. `test:tenancy` checks that the token limit is 120/min.

### Verification

- `npm run -s check` is green. These are all green: `test:polish`, `test:settings`, `test:home`, `test:google-signin`,
  `test:google-fedcm`, `test:viewport`, `test:live`, `test:errors`, `test:tenancy` and `test:gestures`. The server
  tests ran as in `guards.yml`, on a local production build.
- `smoke` on desktop (`SMOKE_WRITE=1`): **all passed**.
- `smoke` on the phone (`SMOKE_MOBILE=1 SMOKE_WRITE=1`): all passed except two timing steps. Both **also fail on
  `main` on this PC**, checked on a `main` build in a separate worktree against the same DB:
  - "camera opens fast": the first frame takes about 1.0–1.9 s under CPU ×4 on both builds.
  - "boot screen: frame trace": over 5 runs each, `main` dropped 0/0/0/1/6 frames and this branch 3/0/0/3/0, with the
    same ~230 ms hydration stalls.

  These are not regressions; they need CI or a calmer machine.
- Matrix sweep (scratch script, production build): 360 / 390 / 1366 × light / dark × Graphite / Plum × English /
  Hebrew, plus reduced motion. That is 144 page loads across Home, To buy, History, Projects, Insights and Settings →
  Display, with an item sheet opened and closed in each. Result: **0 horizontal overflow, 0 fields under 16px on
  phones, 0 page or console errors**.
- The 8 audit screenshots were retaken after the fixes into `docs/design/polish/after/` (same names).
  `01-boot-phone.png` is a second open on the same day: the app is already there, and the small mark is gone by
  350 ms.

### Found in passing (not fixed, not in the audit)

- Settings → Display at 360px: the Colour chips sit beside Language, and the first chip's label is cut ("Gra|phite"
  under the Plum chip). This is pre-existing and is a layout call for R17.
- The camera and boot frame-trace smoke steps are machine-sensitive on this PC (see Verification).

### Help-worthy for R17 part 0 (the help file is at its 25 KB limit, so it was not edited)

- The full opening now plays once a day on phones too; every other open shows the small mark.
- A big amount may show as ₪62.2B when it doesn't fit. A long-press (phone) or hover (desktop) shows the exact figure.
- Settings: a tap anywhere on a row with a switch flips it.
- Motion → Reduced keeps soft fades (no movement) instead of switching everything off.

### Tal — check on a real phone

- [ ] **iOS input zoom (#1):** focus Price, Notes and Add tag in the item sheet, the paste bar, Search and a Settings
  select. The page must not zoom.
- [ ] **Undo tap (#2):** delete an item, then tap Undo just above the dock. It should hit every time, never the ✕.
- [ ] **Switches (#3):** in Settings → Notifications, tap the row text. The switch should flip and the knob slide, and
  the Price-drop % select should still open.
- [ ] **Sheet close (#5):** close an item sheet with the ✕, the scrim and the Back gesture. It should slide down (or
  fade, if it opened from a card picture) and never vanish. A fling down should leave at the finger's speed.
- [ ] **The daily opening (#7):** the first open of the day should play the full opening. Opening again (a new tab, a
  PWA relaunch, a reload) should show the small mark.
