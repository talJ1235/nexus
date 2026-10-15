# Round 18 — Session 4: camera, voice, adding, store mode (fixes from Tal's use of S3, no new boards)

Source: Tal's notes after S3 (2026-10-15 evening) — `docs/R18-S3-NOTES.md` section "After S3" (read it: it has his
words and the planner's causes). Visual reference: existing boards `docs/design/r18/` + R17; **no new boards** — the
list redesign, Home widgets v2, floating Ask, monthly spending and a new start-trip look come from boards in S5.
Where this brief reverses an S3 decision (B8 auto-fold, fold toast, B9 finish sheet), **this brief wins**.
Results go to **"## Open" at the end of this file**. Tal runs it overnight (~8 h, unattended).

## How to run (Session 4)
- **Step 0 — finish S3 first.** If `round18-s3` has commits that aren't on `main` (it had `9b4919b` in CI when this was
  written): merge `origin/main` into it, let its CI finish green, `git merge --ff-only` into `main`, push, check the
  `guards` run on `main` + the prod smoke after deploy (S3 rules). Only then branch **`round18-s4`** from `main`.
- **Commit and push after every single item** (`R18.S4.<part><k>: …`, `git push origin round18-s4`); tick `[x]` here +
  one line in "### Progress" in the same commit; decisions in "### Decisions" at once; anything for Tal in "### For Tal".
- **Resuming:** `git fetch`, check out `round18-s4`, read Progress + `git log`, continue from the first unticked item.
- Unattended; never stop to ask — take the reading closest to Tal's words, write it in Decisions.
- Read open reports and the error log first. **Bugs with an unknown cause: reproduce first** (failing test / smoke
  step), then fix.
- **Real-device honesty:** camera, focus, barcode and voice can't be fully proven in headless Chromium. Test what can be
  tested (fixtures, fake streams, mocked AI) and, for each such item, write in "### For Tal" exactly what to try on his
  phone (Samsung, Chrome + installed PWA) and what he should see. Add `/debug/camera` (admin only) that prints the chosen
  camera, its capabilities (focusMode, zoom, torch, resolution) and the decoder in use, so Tal can send a screenshot.
- DB additive only; if the DB changes, rehearsal on a copy of a fresh prod snapshot before merging. Merge `--ff-only`
  only when all items are ticked, one full CI run on the final commit finished green (don't push on top of it while it
  runs), then watch `guards` on `main` + prod smoke after deploy (re-run once if flaky; twice → fix).
- Rules from S1–S3: i18n he + en, `useDevice()` / `phone:` / `desk:`, phone test contexts with mobile UA, no `ad-*`,
  `SEARCH_OFF=1`, logical RTL utilities. Visible items: phone 360/390 + desktop 1366, light + dark, he + en, worst
  case, reduced motion, a smoke step each. Motion bar: `.claude/skills/` + `nx17.css` tokens.

## Part A — adding never loses anything
### A1 [x] Every add merges into quantity / weight, never into notes
Tal typed "מלפפון" + → toast "already on the list", the row vanished, then notes showed "+ ×3 · + ×1". Cause (planner):
`addToList` in `lib/db-scoped/grocery.ts` (~l.139) writes "+ ×N" / "+ 2 kg" into notes when the row's unit differs from
the add's (row in kg, add in units). Convert with the learned unit weight (`lib/grocery/weights.ts`, S3 B7): units →
count (+ weight follows), weight → weight (+ count follows); only when no conversion exists keep both measures on the
row (count and weight fields), still never notes. Clean existing "+ ×N" / "+ <amount>" note fragments made by this
code into the row's quantity (one-off, idempotent, in the daily cron or migrate; test it on the prod snapshot copy).
Find why the row **vanished** (list re-render / filter / optimistic merge) and fix. Same rule for every add path:
search, suggestions, "you usually buy", barcode, photo, voice, paste list, templates, re-add from history.
`test:add` covers each path × (same unit, units→kg, kg→units, no unit weight).

### A2 [x] Clear feedback after adding
After any add: the row appears (or the merged row pulses) and a short inline confirmation names it with the new amount
("מלפפון · עכשיו 4"); if the row is off-screen, a small "Added · show" pill scrolls to it. No toast spam (one at a
time, replaced, not stacked).

### A3 [x] Empty list → templates first, then past products
An empty Supermarket list shows: (1) templates (Nexus + yours) with one-tap Add, (2) products from past trips / smart
suggestions ("you usually buy", due staples), (3) the camera / add actions. When the list has items, unchanged.

## Part B — camera and barcode (much more reliable)
### B1 [x] "+" always opens the camera
On the Supermarket tab a tap on the dock "+" sometimes opens the quick menu. Tap = camera, always; only a real
long-press (≥ 450 ms, no movement > 10 px) opens the menu; the touch end of a long-press never also fires a tap.
Test with synthetic pointer timings (fast tap, slow tap, tap with jitter, long-press).

### B2 [ ] Barcode scanner rebuilt for reliability
Causes found by the planner: the stream starts at 640 px wide (`lib/camera.ts` `FIRST_WIDTH`), never asks for
continuous focus, and on multi-camera Androids `facingMode: environment` can pick the ultra-wide lens (no close focus).
Do:
- Pick the main back camera: enumerate devices after permission, prefer the back lens whose capabilities include
  `focusMode: continuous` and the widest zoom range / not "wide"/"ultra" in its label; remember the choice per device.
- Ask for ≥ 1920×1080 for scanning; `focusMode: continuous` (or `single-shot` re-triggered) where supported; a slight
  zoom (≈ 1.5–2× where `zoom` exists) so small barcodes fill the frame without bringing the phone close; tap-to-focus
  where `pointsOfInterest` exists.
- Decode: native `BarcodeDetector` when it lists the formats, else zxing-wasm; formats EAN-13, EAN-8, UPC-A, UPC-E,
  Code 128, Code 39, ITF, QR, DataMatrix; scan a centred crop **and** the full frame alternately; try rotated 90°;
  require two equal reads (or one with a valid check digit) to avoid wrong numbers.
- **On detect: freeze the frame** (show the still with the barcode outlined), haptic tick, then the result — the user
  can move the phone away. "Scan another" resumes.
- Torch button stays; low-light hint after 4 s without a read.
- `test:barcode` with fixture images: small / large / rotated / blurry / each format; time-to-first-read logged.
- `/debug/camera` (see How to run).

### B3 [ ] Photo mode: freeze, retake, better reading
Shutter → the still freezes at once (camera stops), "Analysing…" over it, **Retake** and **Use photo**. The AI
classification (S3 C2) gets better prompts + a confidence; low confidence → ask "Product / Receipt / List?" with the
best guess first. Overlay frame hint matches the mode the user is in (tall frame for receipt / list, square for a
product); auto-detected type shows its frame on the still. Fixtures for each type + unsure (mock AI).

## Part C — voice that works (Tal approved: record + AI)
### C1 [ ] Voice add, rebuilt
Today it doesn't work on Tal's phone and gives no feedback (only the label changes). S3's fix was only tested with a
fake recogniser. New design (Tal's choice 2026-10-15):
- **Record** with `MediaRecorder` (opus/webm; mp4 fallback for iPhone), up to 60 s, tap to stop; send the audio to the AI
  through `ai-gate` (feature `grocery`, counts in the daily quota; audio never stored after parsing) → the model returns
  the products with amounts (Hebrew + English, "שני חלב, חצי קילו עגבניות, לחם") → the Paste-list review → merge (A1).
- **At the same time**, if the browser's speech recognition is available and working, show its live words while
  recording (nice to have, never required); if it errors, hide it silently.
- **Feedback:** a clear listening state — the mic button turns into a live level meter / waveform from the recorder's
  audio (Web Audio analyser), elapsed time, "Tap to finish"; after stop: "Understanding…" then the recognised items as
  chips before adding. Errors in words: mic blocked (how to allow), nothing heard, quota reached.
- First use: one line of example ("Say: 2 milk, bread, half a kilo of tomatoes").
- Tests: fake MediaRecorder + mock AI (he + en fixtures), quota state, permission denied. For Tal: what to try on the
  phone.

## Part D — the list
### D1 [ ] Rename only on the name's letters
Tapping the empty part of a row must not start rename; only the text itself (its inline box). The rest of the row:
nothing (or the item sheet on the picture tile, as S3).

### D2 [ ] Swipe-delete animation never cuts
A fast swipe / fling: the row slides out, collapses its height, then the list closes the gap — no jump. Velocity-based
release (Apple-style), interruptible. Undo restores in place with the reverse motion.

### D3 [ ] "Start shopping" floats, never covers suggestions
The Start shopping button is a floating bar above the dock (safe area aware) until the list's end is scrolled into
view, then it docks into place at the end; it never overlaps "Nexus suggests" or rows (content gets bottom padding).

## Part E — store mode
### E1 [ ] Start-trip screen fixed (not scrollable)
The start screen (store, list size, estimate, Let's go, back to the list) is a fixed full screen — no scroll, no
rubber-band. Small visual lift within the current style (store colour / gradient, larger title); the full redesign
comes from S5 boards.

### E2 [ ] Sections stay open; no pop-ups
Reverses S3 B8: a finished section **stays open** (rows checked, quantities and notes visible); the user can collapse
it with its header. No toast or pop-up when a section is done — nothing jumps. Undo of a check is the row itself.

### E3 [ ] Finish is a full screen
Reverses S3 B9 for store mode: Finish opens a full screen (summary, items left, total, receipt, done) — not a bottom
sheet. Other app sheets keep S3's fit-to-content.

### E4 [ ] No phantom scrollbar
Dragging the dark area in store mode shows a scrollbar moving with nothing scrolling (a nested scroller / body behind).
One scroller only; the background never scrolls; no visible scrollbar on phones.

### E5 [ ] Aisle rail = navigation
Tap a section's colour in the rail → smooth scroll to that section (header under the top bar), the rail marks it.
Each section gets a minimum tap width (≥ 24 px; the rail scrolls or compresses gracefully with many sections) and
a ≥ 44 px tall hit area. Reduced motion: jump.

## Part F — templates and history
### F1 [ ] Desktop Templates · Past trips switch
The moving pill overshoots its frame on the computer. Keep it inside: padding on the track + clamp the spring (no
overshoot past the track); same component (`components/ui/seg-pill.tsx`) everywhere.

### F2 [ ] Trips history as cards
History → Supermarket and Templates → Past trips: cards in the style of the template cards (S3 C3 preview card):
stacked product pictures, date + time, store / branch, items count, total, who shopped, minutes; grouped by month with
the month total. Tapping opens the trip (as today) with Add again.

### F3 [ ] Brands help find the exact product
Builds on S3 C6: the item sheet shows the usual brand as a chip; the Add search ranks the home's usual brand variant
first; in store mode a row shows the usual brand under the name (small) so someone who doesn't usually shop picks the
right one.

## Part G — guards and docs
### G1 [ ] Guards
Smoke steps for every item (phone + desktop). `test:add` (A1 matrix), `test:barcode` fixtures, voice fake recorder,
long-press timings, store-mode one-scroller check. Full phone + desktop smoke pass.
### G2 [ ] Docs
`SPEC.md` R18 S4 section, `CLAUDE.md` map (camera choice + `/debug/camera`, voice recorder path), help topic Supermarket
(scanning, voice), `docs/ENVIRONMENT.md` log line. "### For Tal" = the phone checklist for camera, barcode, voice.

## Open
### Progress
- Step 0: `round18-s3` merged with `origin/main` (`54996a1`), CI running; `round18-s4` cut from that commit (= main after ff).
- A1: `lib/grocery/merge.ts` `mergeAdd` (units → count, weight → weight, both kept without a unit weight) in `addToList`;
  old "+ ×N" notes cleaned by the daily cron (`cleanMergeNoteRows`); the vanished row = a delete → Undo tombstone in the
  same feed batch dropped the restored row (server + client fixed); `test:add` 14-case matrix + every path.
- A2: `supermarket/added.tsx` — `announceAdded` (one toast id, replaced) + inline line on the Add screen ("<name> · now
  <qty>", Undo) + `AddedPill` (pulse via `markFresh` bump, "Added · show" when off-screen). Smoke step phone + desktop.
  (The A3 empty-list code went into this commit by mistake; its smoke + tick are in the A3 commit.)
- A3: empty list (phone + computer) = `EmptyTemplates` (lists.tsx, one-tap Add = Apply's merge) → suggestions forced
  open → the add field (scan / photo / voice); first use keeps the cold-start cards under any templates. Smoke step.
- B1: dock "+" decides on pointer events only (`lib/press.ts` state machine, one timer, pointer capture): tap = camera,
  hold ≥ 450 ms still = menu, the hold's release is never a tap, a late timer still counts as a hold; click only for
  keyboard. `test:dock` timings (fast / slow / jitter / slide / late timer / 2nd finger / cancel) + smoke step.
### Decisions
- A1: templates, re-add from history and accepted suggestions keep an existing row's amount (S1/S2 rule shown in their
  plans as "already on it — stays"); they never write notes. Every other path (search, barcode, photo, voice, paste, trip
  add) merges through `mergeAdd`. Volume (L) onto a weighed row has no conversion → one more pack.
### For Tal
