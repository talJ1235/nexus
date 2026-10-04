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

### 3. [ ] Assistant header and suggestions
- Move the **History** button to the start side of the header, right before the Box mark + "Nexus" (so the two are
  clearly separate controls); New chat stays at the end. Mirror correctly in Hebrew.
- Suggested questions look more professional: a vertical list of full-width rows, each with a small type icon (data
  question / plan / help), the question text (max 2 lines), and a subtle chevron; hairline separators, hover/press
  state, a small "Suggested" label above. Follow-ups after an answer use the same row style, compact. No horizontal
  scrolling anywhere.

### 4. [ ] Keep the Ask button a rounded pill
Tal likes the rounded "Ask Nexus" pill (Hairline). Make sure every place it appears (desktop top bar, phone icon
button, empty states) stays fully rounded — note in CLAUDE.md/UI-V2 that the Ask button is always a pill, even if
other surfaces move to smaller radii later.

## Open
