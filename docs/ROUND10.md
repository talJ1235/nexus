# Round 10 brief (from Tal, 2026-10-02) — animation bugs, faster camera, projects, real product pictures — source of truth

Tal's notes after using Round 9. One **unattended** run, same rules as Rounds 7–9 "How to run": branch **`round10`**
from `main`, commit per item `R10.<part><n>: …`, push the branch after each part, never stop to ask (decisions →
"## Open"), merge to `main` with `--ff-only` only when everything is green, don't touch power settings. Read open
reports first. Verify every visual item on phone (360/390) and desktop (1366), light + dark, Graphite + Plum, and
record a frame series (`SMOKE_TRACE`) for every animation you touch — judge them from frames, not by eye.

---

## Part A — animation bugs

### A1. [x] Opening a product jumps the whole screen; closing leaves the picture behind
- Open: the whole page "jumps" then settles. Likely causes to confirm with frames: scroll-lock removing the scrollbar
  (page width changes), the sheet's shared-element/FLIP measurement, focus scroll, or layout of the sheet hero.
  Fix so nothing behind the sheet moves: `scrollbar-gutter: stable` (or the lock's gap compensation), measure before
  mounting, no `scrollIntoView`/focus scroll, transform-only.
- Close: the product picture stays in the top-left for ~2 s instead of going back to its card. Make the reverse morph
  return the image to its card's current position (re-measure on close; if the card is off-screen, fade/scale the
  picture out instead) and always remove the flying clone on `animationend`/`transitionend` **and** a safety timeout
  (≤ 450 ms). Interrupting (open → close quickly, open another) must never leave a clone.
- Smoke: open/close 10 items quickly in a row (desktop + phone) and assert no stray clone remains and no element
  outside the sheet moved > 1 px during open.

### A2. [x] Project card → project page: rounded corners all the way
The colour cover opens with square corners and then snaps to rounded. Animate with the radius preserved (shared
element with `border-radius` in the animated style or view-transition `::view-transition-group` with matching
`border-radius` + `overflow: clip`), no snap at start or end, both directions.

### A3. [ ] The boot animation on every load, never the blue circle
Today the phone boot animation shows only once per session (`sessionStorage "nexus.booted"` → `boot-skip` in
`boot-screen.tsx`), so a reload shows other loaders. Make it play on **every full page load / reload / app open** on
the phone (not on in-app navigation). Remove or replace any other loading indicator that can appear on a phone
reload. Identify the "blue circle" Tal sees on reload: if it's our spinner/skeleton, replace it with the boot screen;
if it's Chrome's pull-to-refresh indicator, set `overscroll-behavior-y: contain` on the app and add our own
pull-to-refresh (from the motion plan) that shows the Box mark and then plays the boot sequence on reload. Note which
it was in Open.

---

## Part B — faster camera

### B1. [ ] Barcode scanner opens fast
Opening "Scan a barcode" takes noticeably long. Measure time from tap → first video frame → first decode-ready, then:
start `getUserMedia` **immediately** on tap (show the viewfinder at once with a subtle placeholder), load the decoder
in parallel (not before the camera); pre-warm in idle time after the app loads (`import()` of the scanner module +
`<link rel="preload">`/`fetch` of `public/vendor/zxing_reader.wasm` into the HTTP cache) and again when the + menu
opens; prefer the native `BarcodeDetector` when present and skip loading zxing then; reuse a live stream if the
scanner is reopened within a minute; constraints that start quickly (no huge resolution on first frame; upgrade after).
Target: viewfinder visible < 300 ms after tap (permission already granted), decoding ready < 800 ms on a mid phone
profile. Same treatment for the receipt camera. Add the timings to the smoke trace output.

---

## Part C — projects page

### C1. [ ] Order and "New" controls
- Order on the page: **Projects**, then **Lists**, then at the very bottom one "Start something new" card.
- One consistent pattern for both sections: a "New" pill at the top end of the page header with a small menu
  (New project / New list), and the bottom card redesigned to match (two halves or two buttons: New project · New
  list, friendly illustration, dashed or soft outline). Projects and lists behave the same way. Decide the final look
  by screenshot; the header button and the card must look like one family.

### C2. [ ] Projects page polish
Building on Round 9's covers: a page header with a summary (active projects, total left to buy across projects,
nearest budget limit), section titles with counts, more breathing room, lists shown as slightly smaller cards than
projects (lists don't have budgets), empty states for each section, consistent card heights, hover/press motion.
Compare desktop 2–3 columns and phone 1 column.

### C3. [ ] Skeletons that match the page
On reload of the Projects page the loading skeleton shows To-buy product rectangles. Skeletons must match the view
being loaded: Projects → wide project cards (cover + lines + ring), project page → its header + item cards, On the way
/ History / Stats / Order by store → their own shapes. Make the skeleton choice depend on the view from the URL
(server-known), with the same soft sweep.

---

## Part D — real pictures for products (receipts first), like searching Google

Tal: items added from a receipt have no picture. The system should find the right picture automatically, like typing
"מילקי" or "חלב" in Google and taking the product photo (e.g. Tnuva milk). If it can't find the exact product, use the
closest generic picture (e.g. a pudding/dairy-dessert photo for an unknown "מילקי"), and only then a fitting icon —
never a generic box. It must work the same on **phone and desktop without the extension** (the extension is optional
extra help, not required). The user approves all pictures in one tap; changing one is a quick, local action.

### D1. [ ] Understand each receipt line first (one cheap call)
Receipt lines are abbreviated ("מילקי שוקו 3*100", "חלב תנ 3%"). One batched Gemini text call for all lines returns per
line: clean Hebrew name, English name, brand, product type (generic), size/variant, a search query in Hebrew and one
in English, an icon keyword, and the barcode/catalogue number if the receipt prints one. Store on the item (for later
re-search). Mock mode covers it.

### D2. [ ] Find candidate pictures (server-side, no extension needed)
Per item, stop at the first source that yields good candidates; gather up to 6:
1. Barcode printed on the receipt → Open Food Facts / Open Products Facts by barcode (exact product photo).
2. Own items with a similar title (existing).
3. **Google Images via Serper** (`SERPER_API_KEY`, already supported in `src/lib/search.ts`): Hebrew query first, then
   English; prefer square-ish images ≥ 300 px from store/brand domains; drop logos, banners, collages.
4. Open Food Facts **name search** (groceries, no key).
5. Generic fallback: search the generic type ("חלב", "pudding") the same way.
6. Icon: Fluent Emoji (Iconify) from the icon keyword — only when nothing else fits.
Cache every query result (kv, 30 days) so repeats cost nothing. Without `SERPER_API_KEY`: barcode/OFF/own items/
icons still work; note in the UI's settings "Add a search key for better pictures". The extension may still help
on desktop in the background, but nothing waits for it.

### D3. [ ] Pick the right one automatically
One batched Gemini **vision** call ranks the candidate thumbnails for several items at once ("which picture shows
<clean name, brand, size>? answer index or none, with confidence"). High confidence → chosen; low → chosen but marked
"check". Keep the ranked alternatives on the item (`imageCandidates` JSON, up to 6) for the picker. Resize to 480 px
WebP → Blob as today; `imageSource` = barcode / search / generic / icon.

### D4. [ ] Approve in one tap, change in two
- Receipt review (E3 of Round 7): every card shows its picture as soon as it's found (shimmer until then). Header
  button **"Pictures look right — approve all"**; "check" ones have a soft highlight. Confirm also approves.
  "Skip pictures" adds the items now with the best guesses and keeps improving in the background.
- Tap a picture (review or item sheet) → a picker sheet: the alternatives grid, a search box (runs D2 with the typed
  text, Hebrew or English), "Take a photo", "Upload", "Use an icon", "No picture". One tap to choose; the choice
  animates into place.
- Item sheet: a "Change picture" action on the hero image (works for every item, not only receipt ones).
- Backfill: existing items without a picture (or with a box icon) go through D1–D3 in the daily cron, bounded per
  run; their best guess is marked "check" until the user opens/approves.

### D5. [ ] Verify
Unit tests: line normalization (fixtures with Hebrew abbreviations), candidate filtering/ranking glue, cache. Smoke
(mock): receipt with 5 lines → pictures appear → approve all; change one via the picker; item sheet change picture.
If a real `SERPER_API_KEY`/`GEMINI_API_KEY` is on the machine, run 10 real grocery + 5 maker items and report hit
rate in Open.

---

## Open
