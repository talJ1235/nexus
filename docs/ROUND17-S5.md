# Round 17 — Session 5 brief (hotfixes after S4)

From Tal's checks on prod (2026-10-10, PC + phone). Part of Round 17 (`docs/ROUND17.md`). **Results go to
`docs/ROUND17.md` "## Open" → "### Session 5"**; tick the items here. Same design bar and run rules as Session 4.

## How to run (Session 5)
- Branch **`round17-s5`** from `main`; commit per item `R17.<part><k>: …`; push after each part; unattended; decisions in
  Open; `git merge --ff-only round17-s5` only when CI is green (and the migration rehearsal if the DB changes).
- Verify desktop 1366 / 1280×720 + phone 360/390, en + he, light + dark, **with a real mouse hover** where it matters.
- Do S1 first — the admin panel is unusable on Tal's computer.

## Part S
### S1. [x] Admin panel is a black screen on the computer
Tal (Chrome, Windows, desktop width, signed in as admin): `/admin` shows the panel's sidebar for a split second, then a
black page; reload doesn't help. On the phone the panel works. Tal's console (screenshot):
- `Uncaught Error: Minified React error #418` (args `text`) = **hydration mismatch on text**: the server HTML and the
  first client render differ, and the panel's root is thrown away. Usual causes: dates/times/relative times formatted
  on the server in UTC and on the client in Asia/Jerusalem, `Date.now()` / `Math.random()` / locale-dependent number
  formatting during render, or desktop-only content that depends on `window` (the phone layout doesn't hit it).
- Two `500` on `POST https://nexus-ashen-beta.vercel.app/` (server actions — likely the panel's first polls) and two
  `500` on `/api/presence`.
Do: reproduce on **prod** at 1366×768 with the admin emergency sign-in the prod smoke uses (`SMOKE_ADMIN_TOKEN`), record
console + failed responses; read the Vercel function logs for the 500s if you can (else reproduce on a local production
build with a copy of prod-shaped data). Fix the root causes (no `suppressHydrationWarning` as the fix, except on a single
time element that is re-rendered on the client by design). Also fix `/api/presence` returning 500 (it beats on every
page). Then make it impossible to get a blank screen again: an error boundary for `/admin` (and the app shell) that shows
"Something went wrong · Reload · Report" in the app's style and files an error report.
Acceptance: prod smoke + `test:admin-access` open `/admin` (every tab) as admin at 1366×768 **and** 390, en + he, and
fail on any console error, React hydration warning, or 5xx; Open lists the exact causes found.

### S2. [x] "Nexus suggests" still shows "שקל"
Tal's screenshot: "המחיר עלה מ-99 ל-164.93 שקל". **Cause:** `home-actions.ts` caches the AI wording per space per day
(`spacePrefGet` → `return cache.map`) and runs `normalizeMoney` only when a new wording is written, so text cached before
the S4 deploy comes back untouched. Fix: normalise on read as well (title, why, "Nexus noticed"), and bump the cache key
version so old entries are ignored. Also check the rule-based templates for any money written as a word.
Acceptance: unit test with a cached entry containing "164.93 שקל" → shown as ₪164.93.

### S3. [x] Suggestions card moves up and down under the mouse
Tal (computer): hovering the suggestions card while moving between suggestions makes it bob up and down until it
settles. Likely causes: on desktop (container ≥ 600 px) the invisible "ghost" slides are `@min-[600px]:hidden`, so the
height is not fixed per set and changes per slide; and `StackHeight` animates the outer box from a `ResizeObserver` on the
inner box — the 200 ms height animation with `overflow: hidden` can change the inner layout (container queries, line
wraps), which fires the observer again → a loop of small animations. Hover (cursor-grab, `whyOpen`, hover styles) may
change line wraps too. Fix: the same fixed-height rule on every width (phone and desktop), hover never changes layout
(colour/opacity only), and the height animation can't feed itself (ignore observer changes caused by our own animation,
compare with the target height, debounce to one change per frame).
Acceptance: `test:polish` (or `test:home`) at 1366 and 1280 with a mouse: hover the card, go through all suggestions by
arrow, dot and drag, hold the hover 3 s — the card's height and the next widget's `top` never change and
`card.getAnimations()` is empty 300 ms after each move.

### S4. [x] Onboarding step 5 on a computer always shows the phone QR (Tal: yes)
When the computer can't install (already installed, or a browser without install), step 5 still shows — with only the
"On your phone" QR card and a short line; Continue / Not now as today. Unchanged where install is offered.
`test:onboarding` covers both cases.

### S5. [x] "If it were paid" uses checked prices (Tal: yes)
Admin → AI usage: look up the current official price pages of every model/provider in the table (Google AI pricing for
Gemini, Groq, OpenRouter as used), update the numbers, and show "Prices checked <date> · source" under the row (links to
the pages). Put the prices in one small data file with the date so the next check is one edit. In the same pass, open the
two onboarding "find it in" store search URLs (Shufersal, IKEA) and fix them if they don't land on a search result.

### S6. [x] Manifest warning
Chrome warns "Manifest: Enctype should be set to either application/x-www-form-urlencoded or multipart/form-data" on
every page. `app/manifest.ts` `share_target` (GET) — set `enctype: "application/x-www-form-urlencoded"` so the
warning is gone; share to Nexus from Android still works (`/share`).

## Part T — guards and docs
- The console/5xx assertions of S1 go into the prod smoke and `test:admin-access`; S3 into `test:polish`/`test:home`.
- `SPEC.md` R17 (edit), `CLAUDE.md` map, `ENVIRONMENT.md` if tests/scripts change.

## Open
Write the Session 5 results in `docs/ROUND17.md` "## Open" → "### Session 5".
