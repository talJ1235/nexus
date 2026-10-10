# Round 17 — Session 6 brief (push that reaches you outside the app)

From Tal (2026-10-10, PC + phone): notifications show **only inside the app** (the inbox), never as a system
notification while the site/app is closed. VAPID keys and `CRON_SECRET` are set (Tal). Part of Round 17
(`docs/ROUND17.md`). **Results go to `docs/ROUND17.md` "## Open" → "### Session 6"**; tick the items here. Planner
diagnosis: `docs/R18-PLANNING.md` §7. Run **after Session 5 is merged**.

## How to run (Session 6)
- Branch **`round17-s6`** from `main`; commit per item `R17.<part><k>: …`; push after each part; unattended; decisions in
  Open; `git merge --ff-only round17-s6` only when CI is green (and the migration rehearsal if the DB changes).
- U1 first — it is what lets Tal (and you) see where a push is lost.

## Part U
### U1. [x] See where a push gets lost
Cause candidates from the code (planner, §7): (a) only `shop` / `delivery` are urgent; `activity`, `price`, `budget`
wait for the person's *active hour* (the hour they usually open the app) and `week` for Thursday, and those are sent
only by `/api/cron/notify` from `hourly.yml` — if GitHub skips/delays the schedule or the call fails, they never push and
are seen only in the inbox; (b) the actor is never notified, so a one-account test shows nothing; (c) the device has no
`push_subscription` row (permission granted but subscribe/save failed, or an old endpoint); (d) the browser/OS (Chrome
not allowed to run in the background on Windows, Windows notifications for Chrome off, Android battery limits).
Build:
- **Admin → System → Push:** last dispatcher run (`pref:last_notify`: when, how long, sent / failed) with a warning when
  older than 90 min; `notification` rows of the last 7 days by `push_state` (due / sent / failed / skipped / off) and the
  age of the oldest `due` row; devices per person (phone / computer, label, last success, last failure code) — counts and
  status codes only, never content.
- **"Send a test push to my devices"** (admin, also in Settings → Notifications for everyone: "Test on this device"):
  sends a fixed text straight through `sendToUser` (no inbox row), shows the result per device (sent / 404-410 gone /
  other code). The service worker shows it like any push.
- In Settings → Notifications: this device's state in plain words (on · permission blocked · on but not registered →
  "Fix" re-runs `ensureSubscribed(…, true)`), and a short "Not arriving?" help (Windows: Chrome → Settings → System →
  "Continue running background apps"; Windows → Settings → Notifications → Chrome on; Android: Chrome/app notifications
  on, battery unrestricted; iPhone: Home Screen app only).
Acceptance: `test:push` covers the test-push path (fake push service: sent, 410 → row deleted, 500 → code shown);
`test:admin-access` opens System with the new rows; Open lists what prod showed after deploy if Tal shared it.

### U2. [x] New timing policy (Tal 2026-10-10: "everything at once")
- Every kind is sent **at once**, except: night quiet 22:00–07:00 local (sent at 07:00; a finished trip in quiet hours
  is not pushed, as today), the weekly summary (Thursday at the person's active hour, as today), and **activity**: the
  first in a space goes at once, then at most one per hour per space (the later ones grouped into the next one).
- Price drops stay one push per check run (grouped); budget 80 % / 100 % at once.
- The inbox is unchanged.
Acceptance: `test:notify` unit tables for every kind × (day / night / just after another activity push).

### U3. [x] Don't depend on GitHub's schedule alone
GitHub delays or skips scheduled workflows, so deferred rows (quiet hours, the activity hour, Thursday) and the time
sweeps (idle trips, deliveries today, budget, weekly) can't rely on `hourly.yml` alone:
- Opportunistic dispatch: any signed-in request that already runs server code (e.g. the presence beat) calls a
  `maybeDispatch()` in `after()` that claims due rows **and** runs the sweeps at most once per 5 minutes (a kv lease with
  an expiry, so two requests never both run it). Claiming stays idempotent (`claimDue`).
- Keep `hourly.yml` (nights / nobody online) and the Vercel daily cron as safety nets.
Acceptance: unit/integration test — two concurrent `maybeDispatch()` calls send each row once; a due row is sent by the
next request after its time without the cron.

### U4. [x] Guard
Prod smoke: read System (admin) and fail when the oldest `due` row is older than 70 min or the last dispatcher run is
older than 3 h. Local: `test:notify` / `test:push` in `guards.yml` as today.

## Part V — docs
`SPEC.md` R17 (Session 6), help topic for notifications ("Not arriving?"), `CLAUDE.md` map, `ENVIRONMENT.md` if
scripts/tests change.

## Open
Write the Session 6 results in `docs/ROUND17.md` "## Open" → "### Session 6".
