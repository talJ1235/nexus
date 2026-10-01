# Round 8 brief (from Tal, 2026-10-01) — fixes after Round 7 — source of truth

One **unattended** run, four parts in order. Same rules as Round 7 "How to run" (branch **`round8`** from `main`,
commit per item `R8.<part><n>: …`, push the branch after each part, never stop to ask — decisions go to "## Open",
merge to `main` with `--ff-only` only when everything is green, don't touch power settings).
Quality bar: "the most professional and polished it can be". Every item is verified on phone (360 and 390 wide) and
desktop (1366), light and dark, both palettes where it's visual.

---

## Part A — receipt edge detection that actually works (top priority)

Tal: "the receipt scanning and the automatic edge finding don't work properly — it must work well."
Current code: `src/lib/receipt-image.ts` `detectCorners()` → scanic `scanDocument(mode:"detect")` with the classical
detector, `maxProcessingDimension` 640, no cascade/dilation, quads < 8 % of the frame dropped;
`src/components/app/receipt-camera.tsx` polls every ~250 ms, auto-captures when corners move < 2 % for 0.8 s and
`sharpness > 35` (untuned). Receipts are hard for document detectors: long and narrow, thin white paper on light
tables, curled edges, shadows, thermal print.

### A1. [x] Measure first: a receipt test bench
- `scripts/receipt-bench.ts` (+ `npm run test:receipt-detect`): runs the detector (same code as the browser, in a
  headless Chromium page via Playwright so canvas/WASM behave the same) over a labelled set and prints per image:
  found yes/no, corner error (mean distance / diagonal), IoU with the truth quad, time. Summary: success rate
  (IoU ≥ 0.85) and median time. This number is the acceptance gate for A2–A4.
- **Synthetic set** (generated, committed small): render receipt-like images — white/off-white long paper (ratios 1:2
  to 1:6) with thermal-style text lines, logos and totals, Hebrew and English — composited on varied backgrounds
  (white table, light wood, dark desk, patterned cloth, hand holding it), with perspective tilt, rotation ±25°, curl,
  shadow gradient, glare, blur, noise, JPEG artefacts, partly out of frame. Known corners = ground truth. ≥ 60 images.
- **Real set** (if present): `test-data/receipts/*.jpg` (git-ignored; Tal may drop real photos there). If it exists,
  label the corners yourself (look at each image, write `labels.json`) and include it in the bench; report both sets.

### A2. [x] A receipt-specific detector
Keep scanic but make detection robust, choosing by bench numbers:
- scanic tuned: `maxProcessingDimension` 800–1000 for stills, `enableDetectionCascade`, dilation (kernel 5,
  2 iterations), `maxDocumentAspectRatio` ≥ 8 (long receipts), lower coverage threshold for distant receipts; try
  `detector: "ml"` (lazy-loaded) as a second pass when the classical result is weak.
- Add a **paper detector** made for receipts: receipts are bright, low-saturation regions. Downscale → adaptive
  threshold on brightness and saturation (HSV/Lab) → morphology close → largest plausible component → convex hull →
  minimum-area rectangle / 4-point approximation. Reject shapes that are too small, too thin or touching most of the
  frame border (table edges).
- **Fusion**: run both, score each candidate (inside mostly bright paper, edge strength along the outline, aspect
  ratio, area), keep the best. Validate: the quad must be convex, angles 50°–130°, area 5–95 % of the frame.
- Target on the bench: ≥ 90 % success on the synthetic set and ≥ 85 % on the real set (if present), median < 60 ms
  per live frame at 640 px on desktop CPU (Playwright ×4 throttle: < 200 ms).

### A3. [x] Live camera experience
- Run detection in a **Web Worker** (OffscreenCanvas + ImageBitmap from the video frame) so the UI never stutters;
  skip frames while busy.
- Smooth the outline: exponential smoothing of corners + hysteresis (only switch to a new quad when it is clearly
  better), so it doesn't jump. Animate the overlay between positions.
- Auto-capture: steady ≥ 0.7 s **and** sharp enough, where "sharp enough" is calibrated relative to the session
  (e.g. ≥ 70 % of the best sharpness seen in the last 2 s), not a fixed 35; a ring around the shutter fills while
  holding steady; shutter animation + haptic.
- Guidance chip (both languages) based on what the detector sees: "Move closer", "Hold steady", "More light",
  "Put it on a darker surface", "Whole receipt in the frame". Torch button when supported.
- After capture: corner adjust as today, starting from the still-image detection at full quality (re-detect on the
  full-resolution still, not the live 640 px frame). Magnifier loupe under the finger while dragging a corner;
  corners snap to strong edges nearby.
- Picked files (gallery/PDF image) use the same still-image detector.
- Smoke: feed a fake camera video made from synthetic receipts (`--use-file-for-fake-video-capture` with a
  generated `.mjpeg`/`.y4m`) and assert the outline appears and auto-capture fires.

### A4. [x] End-to-end check of reading
After A2/A3, run the full path on the bench images in mock mode up to the upload, and with `GEMINI_API_KEY` if the
machine has one, on 5 real images (if present): crop → enhance → tiles → read → checks. Note results in Open.

---

## Part B — phone layout: nothing wider than the screen

### B1. [x] Stats / Spending on phone
Tal: on the phone the analytics section is much wider than the screen; he has to zoom out. Fix the Spending/Stats
screen (`spending-view.tsx`, `budget-card.tsx`) for 360–430 px: single column, charts sized by their container
(`width: 100%`, viewBox scaling, no fixed px widths), 12-month bars scroll inside their own box only if they truly
can't fit (prefer fitting with thinner bars and short month labels), legends wrap, long numbers shrink/compact
(₪12.4K), tables become stacked rows. Make sure the page can't be zoomed into a broken state (viewport meta stays
`width=device-width, initial-scale=1`; no `maximum-scale` hacks).

### B2. [x] A guard so it never happens again
Smoke check for **every** view and sheet at 360 and 390 px (to buy, urgent, on the way, history, spending/stats,
order by store, projects, a project page, item sheet, receipt review, shopping mode, assistant, settings, command
menu): `document.documentElement.scrollWidth <= innerWidth` and no element's right edge beyond the viewport
(report the offending selector). Fix everything it finds.

---

## Part C — home: the totals card shows everything, and the products stand out

Tal: the totals card doesn't show all the details it should, and it's almost the only thing that stands out on the
home screen. The products and the To-buy section must stand out too.

### C1. [x] Totals card: complete but calmer
- Show on **all** sizes (today the per-project legend is desktop-only): items left, total (big), split bar, and the
  per-project amounts (phone: top 3 + "+N more", tappable → that project), saved amount, and a compact strip:
  Urgent n · On the way n · Spent this month ₪ (each tappable to its view).
- Make it less dominant: shorter (desktop ~180 px, phone ~140 px), number one step smaller on phone, softer hero
  treatment on light themes (keep the gradient but lower contrast) so the eye moves on to the products.
- The two tiles stay on desktop; on phone they become one compact row under the card (not two tall boxes).

### C2. [x] "To buy" and the product grid lead the page
- A clear section header above the grid: "To buy" (22–24 px, 800), count and total, with the filters (project chips,
  Category, Sort, cards/table) in the same row; it becomes sticky (with a soft surface) when scrolling.
- Product cards carry more weight: larger image area, price as the strongest text on the card, clearer card edge
  (surface on bg with a subtle shadow in light themes), urgent items get a visible but quiet marker, the first row
  appears with a short staggered rise. On phone: 2-column cards by default (rows as an option), not the tall hero
  pushing products below the fold — at 390×844 at least the first row of products must be visible without scrolling.
- Compare the result with `docs/design/home-*.html` and the brief's spirit: the hero summarizes, the products are the
  page.

---

## Part D — assistant: full suggestions, help & bug reports

### D1. [x] Suggestions without sideways scrolling
Suggested questions (and follow-ups) never scroll horizontally: they wrap into a vertical list of full-width,
left/start-aligned chips (max 4, "More suggestions" reveals the rest), full text visible (2 lines max, then ellipsis).
Same for the item mini-cards row in answers: a 2-column grid on phone (first 4 + "Show all"), a wrapping row on
desktop. Check Hebrew and English.

### D2. [x] Help with the app itself
The assistant also answers questions about **using Nexus** ("how do I add a receipt?", "why is a product missing its
picture?", "the extension says not connected", "how do I switch to Plum?").
- Write a compact help knowledge file `src/lib/help/nexus-help.md` (both languages or English with Hebrew answers
  by the model) generated from SPEC.md + the UI: every feature, where it lives, how to use it, common problems and
  their fixes (extension pairing, blocked stores, AI busy, offline, receipts, barcode, shopping mode, sharing,
  Telegram, themes). Keep it < 25 KB; add a check that fails if a top-level SPEC feature isn't mentioned.
- Routing: a cheap classification (keyword + the model's own judgement in the same call) decides between "my data"
  and "how to use the app"; help answers use the help file (not the user's data) and may include **deep links /
  action buttons** ("Open settings → Palette", "Pair the extension", "Open the receipt scanner").
- Diagnostics it may read to troubleshoot: extension status/version, AI provider health (`/api/debug/ai` data),
  offline state, last client errors, Blob/Telegram configured yes/no. Never secrets.

### D3. [x] Report a problem (from the assistant and from the menu)
- When the assistant can't solve it (or the user says it's a bug/complaint/idea), it proposes a **report card**
  (same confirm pattern as R6.1 actions): type (Bug / Complaint / Idea), a clear title, what happened, steps,
  expected vs actual — drafted by the model from the conversation — editable before sending.
- Also reachable directly: command menu "Report a problem", Settings → "Report a problem", and a small link in the
  assistant header.
- Attached automatically: view/route, phone or desktop, viewport, palette + mode, locale, app version (commit SHA via
  `VERCEL_GIT_COMMIT_SHA`), extension version, the last 20 client errors (add a small ring buffer for `window.onerror`,
  `unhandledrejection` and failed server actions), last assistant exchange, time. Optional screenshot (user picks a
  file; no auto capture).
- Storage: new table `reports` (id, type, title, body, diagnostics JSON, status open/in progress/fixed/won't fix,
  createdAt, updatedAt) — idempotent migration, included in backup.
- Owner screen "Reports" (settings + command menu): list with status chips, detail view, change status, "Copy for
  Claude Code" (markdown with all diagnostics).
- Notification: one Telegram message per new report when Telegram is linked.
- Optional GitHub: if `GITHUB_ISSUES_TOKEN` is set (fine-grained, Issues read/write on `talJ1235/nexus`), also open a
  GitHub issue labelled `from-app` with the same markdown and store its number. Works fully without it.
- For future sessions: `scripts/reports.mjs` prints open reports as markdown from prod via an owner-only endpoint
  `/api/reports/export?token=` (`REPORTS_TOKEN` env; if not set, the endpoint is disabled) — and add a line to
  CLAUDE.md "Session workflow": "At the start of a fix round, read open reports (GitHub issues `from-app` or
  `node scripts/reports.mjs`)".
- Guests can't report (assistant is owner-only); note in Open if that seems worth adding later.

### D4. [ ] Verify
Mock mode: help question → help answer with an action button; "this is broken" → report card → send → appears in
Reports with diagnostics; suggestions wrap at 360 px. Unit test the classifier fallback and the report markdown.

---

## Open

### Part A — receipts (results and decisions)
- **Bench numbers** (`npm run test:receipt-detect`, synthetic set of 64): still 95.3 % (61/64), live 93.8 % (60/64),
  median corner error 0.35 %; live median 38 ms on this desktop, 177 ms at CPU ×4 (budgets 60 / 200 ms). Scanic alone
  (even tuned) got 45 %. The remaining misses are pale tablecloth stripes as bright as the paper and running parallel
  to it, and one nearly invisible white-on-white receipt.
- **No real photos yet**: `test-data/receipts/` doesn't exist on this machine, so the real-set bench and the real-photo
  read didn't run. To add them: drop ~10 phone photos of receipts there (git-ignored); then either label them
  (`labels.json`: `{ "file.jpg": [[x,y] TL, TR, BR, BL] }`) and run the bench, or ask a session to label them. The real
  set's target is 85 %. Tuning so far is synthetic-only, so the first real photos are the most valuable next input,
  especially for the auto-capture sharpness ratio (70 %) and the guidance thresholds.
- **Deviation from the brief**: quads are accepted from **2.5 %** of the frame (brief: 5–95 %). A long receipt
  photographed whole from arm's length covers ~3 %; "Move closer" shows below 10 %.
- **ML detector**: scanic's ML model is self-hosted (`/scanic-ml/`, 3.4 MB, copied from the `scanic-ml` npm package
  at dev/build, never from a CDN). It loads lazily on the first scan; stills wait for it, live frames use it only once
  loaded and only when the classical detectors are unsure. Offline or missing assets → the classical detectors alone.
- **A4 end-to-end** (`npm run test:receipt-e2e`): mock run over all 64 photos — every one goes through detect → crop
  → enhance → tiles (53 split, all JPEG ≤ 2000 px, under the 20 MB upload limit) → mock read; median 150 ms in the
  browser. Real Gemini read on 5 sharp synthetic receipts at phone size (2 Hebrew, 3 English, 3 tiled): **5/5 exact**
  — every line, every price and the total; 3–9 s each.
- Older browsers without OffscreenCanvas (Safari < 16.4) run detection on the main thread (same code).
