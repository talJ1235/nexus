# Round 17 — Session 3 brief (notifications)

Part of Round 17 (`docs/ROUND17.md`: roadmap, "Notifications — decisions", Sessions 1–2). Kept in its own file to keep
ROUND17.md readable. **Results go to `docs/ROUND17.md` "## Open" → "### Session 3"**, and tick the items here.

Boards (approved by Tal 2026-10-09, canvas "Nexus R17 — Notifications v2"): `docs/design/r17/` — `Inbox-desktop`
(bell popover), `Inbox-phone` (**full page**, not a sheet), `Permission-desktop`, `Permission-phone` (the reminder card),
`Push-previews` (Android / iPhone / computer), `Settings-notify-phone` (Account → Notifications + Space → Budget
recipients) + `nx18.css` (S3 additions, loaded after `nx.css`/`nx16.css`/`nx17.css`). Interactive — open at
1366×768 / 390×844 and use the Tweaks (`state`, `place`, `language`, `dark`, `palette`). **Boards = look and motion;
this text = behaviour and data.** Design bar = Session 2's (skills in `.claude/skills/`, same easing tokens, press
scale .97, gated hover, reduced motion = fades only, safe areas, ≥ 44 px targets).

Tal's decisions (full list in `docs/PLANNER.md` → "R17 Session 3 — notifications" + "S3 boards v2"):
- One switch On/Off (Account). No per-kind settings. Everything always lands in the inbox; the switch only stops *sending*.
- Kinds: someone shopping now / finished · shared-space activity · weekly summary · price drop / target · delivery
  today · budget 80 % / 100 %.
- Timing is automatic: urgent kinds (shopping now, delivery today) at once; the rest batched at the hour this person is
  usually active; **quiet 22:00–07:00** local time (held until 07:00); no Shabbat/holiday rule for now.
- "Someone is shopping" = **one push per trip** to the other members, **updated in place** when they finish
  ("bought 12, 3 left"). Shared activity = one grouped message per space, at most one per hour ("Noa added 5 items").
- Weekly summary on **Thursday** at the person's active hour.
- Budget alerts go to the space owner + the members the owner picks (Space settings → Budget).
- Action buttons: price drop → **Open**; delivery today → **Received**.
- Price alerts on **any** drop and/or reaching the target, **batched per check** (never one push per item per check).
  Price checks become hourly (GitHub Actions), not daily.
- Inbox keeps **30 days**, no filters, Today / Earlier, unread dot, mark all read, swipe to delete (phone).
- Permission: the first offer is onboarding step 6 (built in S2). After "Not now", a **generic** reminder card (no item,
  no price) — desktop out of the bell, phone above the dock — at **3, 7, 14 and 30 days** after the last "Not now",
  then never again (inbox banner + Settings stay). At most once a day, only on Home, never during a shopping trip.
- Admin gets notification numbers (System row + a Live stat). No content.

## Before you run (Tal) — 5 minutes, optional for the run itself
Push needs a VAPID key pair (identifies our server to the browsers' push services; free, no account).
1. The builder generates it in Step 0 and writes `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   (`mailto:` + the privacy email) into `.env.local` — never into the repo.
2. After the run, Tal copies the same three values to Vercel → Settings → Environment Variables (Production), and adds
   GitHub repo secret `CRON_SECRET` (the same value as in Vercel) for the hourly workflow.
Without the keys everything works except the push itself (inbox, badge, reminder card all run; "Turn on" stores the
permission and says push isn't set up yet — logged once, no error toast).

## How to run (Session 3)
- Branch **`round17-s3`** from `main`. Commit per item `R17.<part><k>: …`. Push the branch after each part.
- Unattended, same rules as Sessions 1–2 (decisions in "## Open", don't touch power settings, read open reports + the
  error log first). Plan mode (≤ 10 lines) for J1 (data + pipeline), J3 (scheduler) and L1 (reminder rules).
- DB changes additive only. Migration rehearsed on a fresh prod snapshot copy (idempotent, row counts equal, Tal's
  To buy / On the way / History unchanged) before `git merge --ff-only round17-s3` into `main` + push.
- Verify phone 360/390 + desktop 1366 and 1280×720, light + dark, Graphite + Plum, en + he, reduced motion, touch +
  keyboard. `test:clip` stays at 0 with the new screens added (inbox page, popover, reminder card states, settings page).
- Parity PNGs (board vs app) into `docs/design/parity-r17/` — up to 12 new files (they are already at 20; S3 may add 12).

## Part J — plumbing: data, push, scheduler
### J1. [x] Data
Two new tables (additive):
- `notification` — id, user_id, space_id (nullable), kind (`shop` | `activity` | `week` | `price` | `delivery` |
  `budget`), group_key (e.g. `shop:<tripId>`, `activity:<spaceId>:<hour>`, `price:<checkRunId>`), data (JSON: what the row
  needs to render — names, counts, item ids, prices; the row is rendered from data + i18n at read time, so Hebrew/English
  follow the reader), created_at, updated_at, read_at, deleted_at, send_after (null = no push), sent_at, push_state.
  Index (user_id, created_at). One row per group_key per user: a new event with the same key **updates** the row
  (`updated_at`, data) instead of adding one — that is how "Noa is shopping" becomes "finished" and how "Noa added 5"
  becomes "Noa and Yoav added 7".
- `push_subscription` — id, user_id, endpoint (unique), p256dh, auth, device (`phone` | `computer`), label (browser +
  OS, no fingerprinting), created_at, last_ok_at, fail_count.
Retention: the daily cron deletes notifications older than 30 days and subscriptions failing 5 times in a row.
Delete account (E4) removes both; export (E4) includes the person's inbox rows.

### J2. [x] Web push (server + service worker)
- `web-push` (pinned) in `lib/notify/push.ts`; payload = title, body, url, tag (= group_key), actions, lang/dir. A 404/410
  from the push service deletes that subscription; other failures increment fail_count. TTL 12 h for batched kinds,
  1 h for "shopping now".
- `public/sw.js`: `push` → `showNotification` (app icon, monochrome badge icon, `tag` so the same group replaces itself,
  `renotify: false` for in-place updates, `dir`/`lang` from the payload); `notificationclick` → focus an open Nexus
  window on the url or open it; action **Received** → POST to a same-origin route that marks the item received (session
  cookie; refuses without one) and then shows nothing; action **Open** → the item. Tell open clients
  (`postMessage`) so the bell badge updates without a reload.
- Client: after permission is granted, `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` and save;
  on every app start re-check `Notification.permission` + the subscription and re-save if the endpoint changed; remove it
  on sign-out. iPhone: only in standalone (Home Screen) mode.
- No content in logs. Admin sees counts only.

### J3. [x] Scheduler — when each notification is sent
- `lib/notify/enqueue.ts` — one entry point `notify(userIds, kind, groupKey, data)`: never notifies the person who
  caused the event; writes/updates the inbox row; decides `send_after`:
  - urgent (shop, delivery today): now — unless quiet hours, then 07:00 (a finished trip during the night is dropped
    from push, inbox only).
  - batched (activity, price, budget, week): the next occurrence of the person's **active hour** (the most common hour
    of their app opens over the last 14 days, from `presence`/activity; default 09:00), never inside 22:00–07:00.
    Activity: at most one push per space per hour; several batched rows due together → one push ("3 updates").
- Time zone: stored per user from the browser (`Intl…resolvedOptions().timeZone`) on app start; default Asia/Jerusalem.
- Dispatcher `/api/cron/notify` (Bearer `CRON_SECRET`, same check as `/api/cron/prices`) sends everything due and is
  idempotent (sent_at set in the same write that claims the row). Called **hourly** by a new GitHub Actions workflow
  `hourly.yml` (`schedule: '5 * * * *'`, curls `/api/cron/notify` then `/api/cron/prices?scope=hourly`), plus an
  immediate in-request send for urgent kinds. The Vercel daily cron stays for the heavy clean-up steps.
- The On/Off switch off → rows are written, nothing is sent.

## Part K — the inbox (boards `Inbox-desktop`, `Inbox-phone`)
### K1. [x] Desktop popover
The bell in the header opens the popover from the bell (origin = the bell, 200 ms `--ease-out`), 420 wide, list scrolls
inside; header Notifications + Mark all read + close; banners for "off on this computer" / "blocked in this browser"
(with How to allow); empty state; footer "Kept for 30 days · Notification settings". Esc and outside click close; focus
returns to the bell. Replaces the current `AlertsPanel` bell (price rows now come from `notification`; remove the
Telegram leftovers in `alerts-panel.tsx` if nothing else uses them).
### K2. [x] Phone page `/inbox`
The bell opens a **full page** pushed in from the inline-end over Home (Home shifts 22 % back and dims; 380 ms
`--ease-drawer`; Back / edge swipe / browser Back reverse the same path; mirrored in RTL). Large title + "N new";
Mark all read top-end; sticky Today / Earlier headers; rows full width with inset dividers; dock hidden on this page;
footer at the end of the list. Swipe to delete (1:1 follow, velocity flick, snap on the drawer curve), tap = open the
thing it's about and mark read.
### K3. [x] Rows (both)
**The media column is a fixed 40×40 block** (board fix: an inline wrapper collapsed to 0 px and the kind badges and
second face hung outside the row — `test:inbox` asserts every badge's box is inside its row). Kinds: shop (face with
ring; live "6 of 15 left" while the trip runs; text crossfades with 2–3 px blur when it finishes), price (item picture +
tag badge; now / was / −% or "target"; Open), delivery (picture + truck badge; Received → "Marked received"),
activity (two faces), budget (wallet tile + meter), week (chart tile). Unread tint + dot; time right-aligned, tabular.
### K4. [x] Badge and freshness
Unread count on the bell (desktop) and the phone header bell; updates on app focus, on a push message from the
service worker, and every 60 s while visible. Mark read is optimistic. No content over Ably.

## Part L — asking for permission (boards `Permission-desktop`, `Permission-phone`)
### L1. [x] When the reminder shows
First offer = onboarding step 6 (unchanged). The reminder card shows when **all** hold: permission is `default` or
`denied` on this device, or iPhone not in standalone; the account switch is On; this person said "Not now" (onboarding
or card) and the next step of **3 → 7 → 14 → 30 days** since the last "Not now" has passed; not shown today; the page
is Home and settled (≥ 1.5 s, no open sheet/dialog); not in shopping mode; not the first session after onboarding.
After the 4th "Not now" it never shows again. State per user: `pref:notify-ask` = `{ count, lastNo }`; "Turn on"
granted → no more cards. Unit test the schedule.
### L2. [x] The card
No item or price — the same card everywhere: bell with three kind dots, "Turn on notifications?", one line (price drops,
deliveries, what the household adds, never at night), Not now / Turn on. Desktop: popover from the bell (tip pointing at
it, `--ease-out` 200 ms, origin top-end; the bell shows a dot while it's open). Phone: above the dock (the board's
`place` tweak "top of Home" is not built), enters/leaves on the same path (400 ms `ease`), swipe down = Not now.
`Notification.requestPermission()` **only on the Turn on tap**. States: waiting for the browser → on (check, "Turn them
off any time in Settings", leaves by itself after ~2.5 s) · blocked (`denied`: How to allow → 3 steps for this browser,
"I allowed it" re-checks) · iPhone not on the Home Screen (Share → Add to Home Screen → open from there).

## Part M — the senders
### M1. [x] Shopping trip
Starting shopping mode on a shared list → `shop` to the other members of that space (urgent; one per trip). Finishing
(or 30 min idle) updates the same row + push in place: "Noa finished shopping · bought 12, 3 left".
### M2. [x] Shared activity
Adds/checks by others in a shared space → grouped `activity` rows per space per hour (names + count, the list name).
### M3. [x] Price
Price checks hourly (`scope=hourly` checks a slice so every tracked item is checked at least every few hours within the
free limits — say what you chose in Open). Any drop and/or reaching the target → one `price` row per item; all rows from
one check run → **one** push ("Steam cleaner dropped to ₪899" or "3 price drops"). Respects `minDropPct` as today.
### M4. [x] Delivery today / budget / week
Delivery due today → `delivery` at 08:00 local (urgent kind but never before 07:00) with Received. Budget 80 % / 100 %
once per space per month → owner + picked members (replaces the R16 per-device toast in `budget-watch.tsx`; the toast
stays only when push isn't on). Weekly summary Thursday at the active hour from `lib/weekly.ts` (bought, spent, drops).

## Part N — settings and admin
### N1. [x] Account → Notifications (board `Settings-notify-phone`)
The existing Account row opens a small page (phone) / section (desktop dialog): the one switch "On all your devices";
"This phone / This computer" status — Allowed · Blocked (How to allow) · Not turned on yet (Turn on); the quiet-hours
line (info, not a setting); the one-line explanation. No per-kind switches.
### N2. [x] Space settings → Budget → "Budget alerts go to"
Owner always (locked row) + member checkboxes, owner-only edit, viewers can't be picked. Stored on the space.
### N3. [x] Admin
System row: subscriptions (phone / computer), sent today, failed today, due now. Live: a "Notifications sent today"
stat. Counts only — `test:admin-privacy` extended to the new tables.

## Part O — guards and docs [x]
- `test:notify` (unit: quiet hours, active hour, grouping/in-place update, actor excluded, batching per check, reminder
  schedule, switch off), `test:push` (a local fake push endpoint receives an encrypted request; 410 deletes the
  subscription; SW click/actions via Playwright), `test:inbox` (popover + page, read/mark all/swipe, media boxes inside
  rows, RTL) — all in `guards.yml`.
- `SPEC.md` R17 (edit), help topic for notifications (one switch, quiet hours, how to allow, iPhone), `CLAUDE.md` map,
  `SECURITY.md` (push payloads, subscription data, retention, the Received route), privacy page line (we store your push
  address and inbox for 30 days), `ENVIRONMENT.md` (VAPID names, `hourly.yml`, `CRON_SECRET` GitHub secret, new tests).

## Open
Write the Session 3 results in `docs/ROUND17.md` "## Open" → "### Session 3".
