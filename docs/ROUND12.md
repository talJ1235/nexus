# Round 12 brief (from Tal, 2026-10-04) — small fixes after Round 11 — source of truth

Short run of bug fixes. The dashboard / home redesign is **Round 13** (mockups first, being designed in chat now) —
don't restyle the home, dashboard or To-buy page here.
One **unattended** run, same rules as Rounds 7–11 "How to run": branch **`round12`** from `main`, commit per item
`R12.<n>: …`, push the branch when done, never stop to ask (decisions → "## Open"), merge to `main` with `--ff-only`
only when all green, don't touch power settings. Read open reports first. Verify on phone (360/390) and desktop
(1366), light + dark, Graphite + Plum; frame traces for anything that moves.

### 1. [x] Long-press action sheet closes with a swipe down
On the phone, long-pressing a product opens the quick-action sheet, but it only closes with the ✕. Make it a real
bottom sheet: drag handle at the top, follows the finger, closes when dragged down past ~30 % of its height or with a
downward fling, springs back otherwise; tapping the scrim and the back gesture close it too. Apply the same behaviour to
every bottom sheet on the phone (audit: item sheet on phone, picture picker, me sheet, reports, assistant on phone
already swipes — keep one shared implementation). Smoke: drag-to-close on each sheet at 390 px.

### 2. [x] Slow swipes lock the status actions like delete does
Swiping a list row slowly toward the status side doesn't always stay open on "On the way / Received", while delete
locks reliably. Make both directions use the same rule: decide by **distance**, not only velocity — past the reveal
threshold (e.g. 40 % of the actions' width) the row snaps open and stays, below it snaps closed; a fast fling still
works. Same haptic tick at the threshold both ways. Unit-test the swipe decision function (slow/fast × both
directions × RTL) and add a smoke check with a slow (~15 px per frame) drag.

### 3. [x] Assistant header and suggestions
- Move the **History** button to the start side of the header, right before the Box mark + "Nexus" (so the two are
  clearly separate controls); New chat stays at the end. Mirror correctly in Hebrew.
- Suggested questions look more professional: a vertical list of full-width rows, each with a small type icon (data
  question / plan / help), the question text (max 2 lines), and a subtle chevron; hairline separators, hover/press
  state, a small "Suggested" label above. Follow-ups after an answer use the same row style, compact. No horizontal
  scrolling anywhere.

### 4. [x] Keep the Ask button a rounded pill
Tal likes the rounded "Ask Nexus" pill (Hairline). Make sure every place it appears (desktop top bar, phone icon
button, empty states) stays fully rounded — note in CLAUDE.md/UI-V2 that the Ask button is always a pill, even if
other surfaces move to smaller radii later.

## Open

**Summary (2026-10-04):** all four items done on `round12` (R12.1–R12.4); typecheck + lint + build green; unit tests
(`test:gestures`) and the full smoke (desktop 1366 + phone 390, write paths with the AI mock) green, except one timing flake: the phone
"camera opens fast" step once measured a 400 ms first barcode frame under the full run's load (budget 300 ms; the
camera isn't touched this round); re-run alone it passed twice. Sheet open/close frame trace looks clean (the card →
sheet morph still fades). Merged to `main` with `--ff-only`.

- **Reports read first:** no open GitHub issues; the in-app reports export couldn't be read locally (`REPORTS_TOKEN`
  isn't in `.env.local`).
- **#1 scope:** to keep one implementation, *every* `Modal` and `Sheet` is a bottom sheet on phones (< 640 px), not only
  the audited ones — settings, share, import, receipt, bulk add, collection dialogs too. The Me sheet used to slide in
  from the start edge; on phones it now rises from the bottom like the rest. The nav drawer (tablet) stays a side
  drawer (`phone="side"`). Desktop (≥ 640 px) is unchanged.
- **#1 back gesture:** handled on phones only (< 640 px; the + menu < 1024 px as before). Each surface pushes one
  history entry; closing it another way pops it again, so Back never has to be pressed twice.
- **#1 content pull:** besides the handle/header, a downward pull on the content closes the sheet while that content is
  scrolled to its top (inputs, sliders and `[data-no-sheet-drag]` are excluded). If Tal finds this too eager in the
  assistant chat, limit it to the handle/header by adding `data-no-sheet-drag` to the chat list.
- **#2 root cause:** besides the distance rule, the real bug was the "only one row held open" guard: it compared a new
  closure with the row's ref, never matched, and so the second time a row was held open it closed itself straight away
  (a slow status swipe after any earlier swipe on that row looked like "didn't lock"). Slowly dragging a held row back
  keeps it open until it's under the 40 % threshold (then it closes) — same both ways.
- **#4:** today the Ask button appears only in the desktop top bar and as the phone icon button; no empty state has one.
  Nothing was added; any future placement must reuse `AskButton` (CLAUDE.md, UI-V2).

