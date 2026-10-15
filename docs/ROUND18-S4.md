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
  one line in "### Progress" in the same commit; decisions in "- Step 0 done: `round18-s3` merged with main twice (main moved with a docs commit), CI green on `313630b`, main
  fast-forwarded and pushed; prod smoke on that deploy passed.
- G1: full smoke on the final build — computer ALL PASSED (116); phone 139 + 3 rerun alone and passing (the
  "item sheet morph" flake known since S1, an SQLITE_BUSY lock, a locator fixed). Local: the CI unit loop, authz
  coverage, scope, clip (1066 screens), polish, inbox, headers, device, adblock, bidi, shop-offline, capture, voice.
- G2: SPEC R18 S4, CLAUDE.md map, help topic Supermarket, ENVIRONMENT log, the phone checklist below.

- Merged to main (`2efc4df`, CI green). The prod smoke after the deploy failed only F1 / F2's smoke steps: they need
  the demo templates + trips (real data: skipped now, like the other seeded steps) and opened ⋯ before hydration
  (`openSmLists` waits and retries). App unaffected; fix on the branch → CI → main.

- `d4bdeb0` on main: guards green; prod smoke green on the re-run (the first run failed once on a console line
  "wasm streaming compile failed: TypeError: Failed to fetch" — the scanner prewarm aborted by a navigation, the same
  noise the smoke filters as "…aborted"; next session: widen that filter to "Failed to fetch" too).

### Decisions" at once; anything for Tal in "- B3: the AI reads the photo only after "Use photo" (a retake costs nothing from the 40/day quota) — the brief lists
  "Analysing…" and Retake / Use photo together; reading on Use keeps retakes free.
- C1 root cause found by the full smoke: the site's `Permissions-Policy` header said `microphone=()` — the browser
  refused the mic to the app itself, so S3's voice (Web Speech) could never work on a phone. Now `microphone=(self)`
  (`next.config.ts`; `test:headers` checks it).
- Smoke: S3 B5 (fake Web Speech) retired — C1 replaces that flow (`voice add (R18 S4 C1)` + `test:voice`); S2 B2's
  merge toast on the Add screen is the A2 inline line now; S3 C2 taps Use photo after the shutter (B3).
- C1: the recording is sent as a 16 kHz mono WAV (every model reads WAV; webm/opus support varies), the original
  when the browser can't decode it; sent to a route (binary, ≤ 4 MB), not a server action (2 MB body limit).
- B2: photos use the same tuned main lens as scanning (one camera start, no restart when switching modes).

### For Tal".
- **Resuming:** `git fetch`, check out `round18-s4`, read Progress + `git log`, continue from the first unticked item.
- Unattended; never stop to ask — take the reading closest to Tal's words, write it in Decisions.
- Read open reports and the error log first. **Bugs with an unknown cause: reproduce first** (failing test / smoke
  step), then fix.
- **Real-device honesty:** camera, focus, barcode and voice can't be fully proven in headless Chromium. Test what can be
  tested (fixtures, fake streams, mocked AI) and, for each such item, write in "- B3: the AI reads the photo only after "Use photo" (a retake costs nothing from the 40/day quota) — the brief lists
  "Analysing…" and Retake / Use photo together; reading on Use keeps retakes free.
- C1 root cause found by the full smoke: the site's `Permissions-Policy` header said `microphone=()` — the browser
  refused the mic to the app itself, so S3's voice (Web Speech) could never work on a phone. Now `microphone=(self)`
  (`next.config.ts`; `test:headers` checks it).
- Smoke: S3 B5 (fake Web Speech) retired — C1 replaces that flow (`voice add (R18 S4 C1)` + `test:voice`); S2 B2's
  merge toast on the Add screen is the A2 inline line now; S3 C2 taps Use photo after the shutter (B3).
- C1: the recording is sent as a 16 kHz mono WAV (every model reads WAV; webm/opus support varies), the original
  when the browser can't decode it; sent to a route (binary, ≤ 4 MB), not a server action (2 MB body limit).
- B2: photos use the same tuned main lens as scanning (one camera start, no restart when switching modes).

### For Tal" exactly what to try on his
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

### B2 [x] Barcode scanner rebuilt for reliability
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

### B3 [x] Photo mode: freeze, retake, better reading
Shutter → the still freezes at once (camera stops), "Analysing…" over it, **Retake** and **Use photo**. The AI
classification (S3 C2) gets better prompts + a confidence; low confidence → ask "Product / Receipt / List?" with the
best guess first. Overlay frame hint matches the mode the user is in (tall frame for receipt / list, square for a
product); auto-detected type shows its frame on the still. Fixtures for each type + unsure (mock AI).

## Part C — voice that works (Tal approved: record + AI)
### C1 [x] Voice add, rebuilt
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
### D1 [x] Rename only on the name's letters
Tapping the empty part of a row must not start rename; only the text itself (its inline box). The rest of the row:
nothing (or the item sheet on the picture tile, as S3).

### D2 [x] Swipe-delete animation never cuts
A fast swipe / fling: the row slides out, collapses its height, then the list closes the gap — no jump. Velocity-based
release (Apple-style), interruptible. Undo restores in place with the reverse motion.

### D3 [x] "Start shopping" floats, never covers suggestions
The Start shopping button is a floating bar above the dock (safe area aware) until the list's end is scrolled into
view, then it docks into place at the end; it never overlaps "Nexus suggests" or rows (content gets bottom padding).

## Part E — store mode
### E1 [x] Start-trip screen fixed (not scrollable)
The start screen (store, list size, estimate, Let's go, back to the list) is a fixed full screen — no scroll, no
rubber-band. Small visual lift within the current style (store colour / gradient, larger title); the full redesign
comes from S5 boards.

### E2 [x] Sections stay open; no pop-ups
Reverses S3 B8: a finished section **stays open** (rows checked, quantities and notes visible); the user can collapse
it with its header. No toast or pop-up when a section is done — nothing jumps. Undo of a check is the row itself.

### E3 [x] Finish is a full screen
Reverses S3 B9 for store mode: Finish opens a full screen (summary, items left, total, receipt, done) — not a bottom
sheet. Other app sheets keep S3's fit-to-content.

### E4 [x] No phantom scrollbar
Dragging the dark area in store mode shows a scrollbar moving with nothing scrolling (a nested scroller / body behind).
One scroller only; the background never scrolls; no visible scrollbar on phones.

### E5 [x] Aisle rail = navigation
Tap a section's colour in the rail → smooth scroll to that section (header under the top bar), the rail marks it.
Each section gets a minimum tap width (≥ 24 px; the rail scrolls or compresses gracefully with many sections) and
a ≥ 44 px tall hit area. Reduced motion: jump.

## Part F — templates and history
### F1 [x] Desktop Templates · Past trips switch
The moving pill overshoots its frame on the computer. Keep it inside: padding on the track + clamp the spring (no
overshoot past the track); same component (`components/ui/seg-pill.tsx`) everywhere.

### F2 [x] Trips history as cards
History → Supermarket and Templates → Past trips: cards in the style of the template cards (S3 C3 preview card):
stacked product pictures, date + time, store / branch, items count, total, who shopped, minutes; grouped by month with
the month total. Tapping opens the trip (as today) with Add again.

### F3 [x] Brands help find the exact product
Builds on S3 C6: the item sheet shows the usual brand as a chip; the Add search ranks the home's usual brand variant
first; in store mode a row shows the usual brand under the name (small) so someone who doesn't usually shop picks the
right one.

## Part G — guards and docs
### G1 [x] Guards
Smoke steps for every item (phone + desktop). `test:add` (A1 matrix), `test:barcode` fixtures, voice fake recorder,
long-press timings, store-mode one-scroller check. Full phone + desktop smoke pass.
### G2 [x] Docs
`SPEC.md` R18 S4 section, `CLAUDE.md` map (camera choice + `/debug/camera`, voice recorder path), help topic Supermarket
(scanning, voice), `docs/ENVIRONMENT.md` log line. "- B3: the AI reads the photo only after "Use photo" (a retake costs nothing from the 40/day quota) — the brief lists
  "Analysing…" and Retake / Use photo together; reading on Use keeps retakes free.
- C1 root cause found by the full smoke: the site's `Permissions-Policy` header said `microphone=()` — the browser
  refused the mic to the app itself, so S3's voice (Web Speech) could never work on a phone. Now `microphone=(self)`
  (`next.config.ts`; `test:headers` checks it).
- Smoke: S3 B5 (fake Web Speech) retired — C1 replaces that flow (`voice add (R18 S4 C1)` + `test:voice`); S2 B2's
  merge toast on the Add screen is the A2 inline line now; S3 C2 taps Use photo after the shutter (B3).
- C1: the recording is sent as a 16 kHz mono WAV (every model reads WAV; webm/opus support varies), the original
  when the browser can't decode it; sent to a route (binary, ≤ 4 MB), not a server action (2 MB body limit).
- B2: photos use the same tuned main lens as scanning (one camera start, no restart when switching modes).

### For Tal" = the phone checklist for camera, barcode, voice.

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
- B2: `lib/barcode-scan.ts` (pure: `pickCamera`, `scanZoom`, `regionFor` centre crop / full frame / every 3rd pass
  turned 90°, `confirmer` = 2 equal reads or a valid check digit); `lib/camera.ts` `pickMainCamera` (remembered per
  device), `tuneForScan` (1920×1080, continuous focus, ≈1.6× zoom), `focusAt`; reader reads 9 formats with corners;
  capture freezes the read frame + outline, haptic, "Scan another" (also on an unknown code), 4 s light / distance hint,
  tap-to-focus ring. `/debug/camera` (admin). `test:barcode`: 9 formats × large / small / rotated / blurry / off-centre
  all read (≤ 3 passes, times logged); smoke step with a canvas camera.
- B3: shutter → still + camera off → Retake / Use photo → "Analysing…" over the still → result; frame pick (square
  product / tall receipt · list) sent as a hint; the prompt names each kind's cues and returns `kindConfidence` (< 0.6 →
  asked, the model's guess first, else the frame's); the frame takes the seen kind's shape. `test:capture` + smoke step.
- C1: `lib/grocery/recorder.ts` (MediaRecorder opus/webm, mp4 on iPhone, 60 s, analyser level, 16 kHz WAV) →
  `POST /api/grocery/voice` (ai-gate `grocery`, audio only passed to the model, never stored) → lines → chips + the
  Paste review → `addParts` (A1 merge). Live words from Web Speech only when it works. Meter + clock, "Understanding…",
  errors in words (blocked + how to allow, no mic, nothing heard, limit), example on first use. `test:voice` + smoke.
- D1: the name is a button around its own letters (inline box, not selectable); the row's empty part does nothing.
- D2: a full swipe hands its velocity to the exit (120–260 ms), then the row's height closes (200 ms), then it leaves
  the list; Undo opens the height and slides it back in, in its place (rows ordered by when they were added);
  `useSwipe` is interruptible (a grab mid-settle continues from the row's place on screen).
- D3: Start shopping floats 90 px above the dock until the slot after the list reaches it (IntersectionObserver), then
  sits in that slot — never over "Nexus suggests"; the tab has bottom room for it. Smoke steps D1+D2, D3.
- E1–E5 (store-mode.tsx): start screen fixed (`touch-none`, no overflow) on the store colour's wash, 34 px title,
  72 px monogram; finished sections stay open, no fold / toast (the header collapses one by hand); Finish = a full
  screen over store mode (bought, left by name, total, Finish / Back) → the existing summary + receipt; one scroller
  (html + body locked while store mode is open, the dialog clipped, the list `overscroll-contain`, no phone scrollbar);
  the rail = ≥ 24 × 44 px buttons (scrolls sideways when many) that smooth-scroll a section under the header and mark
  it (a jump with reduced motion). Smoke step replaces S3 B8's; S3 B9's finish part moved to it.
- F1: SegPill's thumb = `.seg-thumb` (a clamped curve, no overshoot) inside the 4 px track padding — everywhere it's
  used. Smoke samples the thumb every frame (Templates · Past trips, Insights).
- F2: past trips (Templates → Past trips and History → Supermarket share `PastTrips`) are cards like the templates':
  stacked pictures of what was bought, store, weekday + date + time, items · who · minutes, total, receipt; month groups
  with the month's total; a card opens the trip (Add again).
- F3: the usual brand: a chip on the item sheet (a tap makes it the brand to buy), `rankUsualBrand` puts its variant
  first in the Add search (`usual`), `homeState.brands` (type → brand) shows it under a store-mode row (the row's own
  brand first; not when the name already says it). `test:brands` + smoke step.
### Decisions
- A1: the note cleanup covers bought rows too (prod had 2, both bought: "+ ×1" on a 12 · 2.2 kg row and "+ ×3 · + ×1 ·
  + ×1" on 1 kg) — history and Add again read their amounts; with a unit weight the count leads and the weight
  becomes the estimate (S3 B7's rule). Tried on a copy of `snapshots/prod-2026-10-15.db`: `scripts/r18s4-rehearsal.ts`.
- A1: templates, re-add from history and accepted suggestions keep an existing row's amount (S1/S2 rule shown in their
  plans as "already on it — stays"); they never write notes. Every other path (search, barcode, photo, voice, paste, trip
  add) merges through `mergeAdd`. Volume (L) onto a weighed row has no conversion → one more pack.
- B3: the AI reads the photo only after "Use photo" (a retake costs nothing from the 40/day quota) — the brief lists
  "Analysing…" and Retake / Use photo together; reading on Use keeps retakes free.
- C1 root cause found by the full smoke: the site's `Permissions-Policy` header said `microphone=()` — the browser
  refused the mic to the app itself, so S3's voice (Web Speech) could never work on a phone. Now `microphone=(self)`
  (`next.config.ts`; `test:headers` checks it).
- Smoke: S3 B5 (fake Web Speech) retired — C1 replaces that flow (`voice add (R18 S4 C1)` + `test:voice`); S2 B2's
  merge toast on the Add screen is the A2 inline line now; S3 C2 taps Use photo after the shutter (B3).
- C1: the recording is sent as a 16 kHz mono WAV (every model reads WAV; webm/opus support varies), the original
  when the browser can't decode it; sent to a route (binary, ≤ 4 MB), not a server action (2 MB body limit).
- B2: photos use the same tuned main lens as scanning (one camera start, no restart when switching modes).

### For Tal
Phone checklist (Samsung, Chrome + the installed app). Things a headless browser can't prove — what to try, what you
should see. If something's off, open **/debug/camera** (admin) and send a screenshot: it shows the lens Nexus chose and
how, its focus / zoom / torch / resolution, every camera on the phone, and the barcode decoder in use.
1. **"+" = camera**: on the Supermarket tab tap "+" 10 times, quick and slow — the camera every time. Hold it ~½ s
   (still) → the quick menu, and letting go doesn't also open the camera.
2. **Lens**: the first scan after the update picks the main back camera (not the ultra-wide). In /debug/camera,
   "chosenBy" says `picked` (then `remembered`) and "lens" names the back camera; `focusMode` shows `continuous`.
   "Pick the lens again" there redoes the choice.
3. **Barcode, near and far**: a milk carton from ~25 cm, a small yogurt / gum barcode, a barcode on a curved bottle,
   a QR code, a shelf label. Each should read within ~1 s without bringing the phone close (a slight zoom is on); the
   picture freezes with a green box on the code and you can move the phone away; "Scan another" goes on. Tap the
   screen on a spot → a yellow focus square there (where the lens supports it). In a dim corner, after 4 s without a
   read: the hint about light / distance (and the torch button).
4. **Photo**: switch to Photo, pick "Product" or "Receipt · list" (the frame changes shape), shoot → the picture
   freezes, the camera turns off; Retake brings it back; Use photo → "Analysing…" over it → the result, and the frame
   takes the shape of what it saw. A blurry / ambiguous photo asks "Product / Receipt / List?" with a best guess first.
5. **Voice**: Add → Voice. Say "שני חלב, לחם וחצי קילו עגבניות" (and once in English). You should see the mic turn red
   with bars that move with your voice and a running timer; your words may appear live (only if Chrome's recognition
   works alongside — fine if not). Tap → "Understanding…" → chips "2 · חלב", "לחם", "עגבניות" over the list to check
   → Add. If Chrome asks for the mic, allow it; if you once blocked it, the screen says how to allow it again.
6. **Adding**: with "מלפפונים 1 kg" on the list, type "מלפפון" + → the row stays, its count grows (≈ 9), no "+ ×1" in
   notes; a line under the field says "מלפפון · עכשיו …". Your old row with "+ ×3 · + ×1" notes gets cleaned by the
   next nightly run.
7. **Store mode**: the start screen doesn't scroll; finish an aisle — it stays open, no pop-up; tap its title to fold;
   tap a colour on the aisle bar → the list glides to that aisle; dragging the dark header shows no scrollbar;
   Finish opens a full screen with what stays on the list.
8. **List**: tap the empty part of a row (right of the name) — nothing; tap the name — rename. Fling a row away fast —
   it slides out and the gap closes smoothly; Undo brings it back in place. "Start shopping" floats above the dock and
   settles under the list at the end (never over "Nexus suggests").
