# Round 16 brief (from Tal, 2026-10-06) — fixes after the R15 release, live shared spaces, error reporting, settings & spaces screens, Home customisation — source of truth

Source: Tal's notes after testing R15 on prod (PC + phone, shared space "Jacoby Home"), kept in `docs/R16-NOTES.md`.
Scope decided with Tal (2026-10-06): **this round = his notes**. The product layer that was planned for R16
(push + inbox, onboarding, QR desktop login, AI quota, admin/usage panel, privacy/delete account, removing the password
fallback and the old guest tables) moves to **Round 17** — see "Roadmap" at the end. Where this brief is more specific
than `docs/MULTIUSER.md`, this brief wins.

Why: R15 made Nexus multi-user; Tal's first real use of a shared space shows (1) changes don't reach the other person
until a refresh — the core of a household app, (2) a set of bugs on PC and phone, (3) failures are invisible to us,
(4) settings and space screens feel small and cramped. Fix those first, then build on them.

## How to run (two sessions)
- Branch **`round16`** from `main`. Commit each item as `R16.<part><k>: …`. Push the branch after each part.
- **Session 1 = Parts 0, A, B, C** (fixes, live sync, error reporting). Runs now.
- **Session 2 = Parts D, E, F** (settings & spaces screens, Home customisation, guards/docs). Runs **after Tal approves
  the mockups** in `docs/design/r16/` (the planner makes them in parallel; the session-2 prompt says when they're in).
  If a board is missing for an item, build from the text here and list it in "## Open".
- Each session is unattended: never stop to ask, put decisions in "## Open". Don't touch power settings. Read open
  reports first (`node scripts/reports.mjs`).
- Before each session: `git merge --no-edit origin/main` into `round16`.
- **Merging:** this round's DB changes are additive only (new tables, new nullable/defaulted columns). Each session may
  end with `git merge --ff-only round16` into `main` + push **when everything is green**, after the migration was
  rehearsed on a copy of `snapshots/prod-2026-10-06.db` (idempotent: second run = no-op; row counts equal; Tal's To buy /
  On the way / History counts unchanged). If anything in the migration is not additive, don't merge — say so in Open.
- Verify on phone (360/390) and desktop (1366, plus 1280×720 where a screen is tall), light + dark, Graphite + Plum,
  English + Hebrew. Every UI change works with touch, keyboard and `prefers-reduced-motion`.
- Visual items that change motion: **measure first** (Playwright trace / `performance` frame timings), write the
  numbers before and after in Open.
- Parity PNGs for every changed screen into `docs/design/parity-r16/` (≤ 20 files, ≤ 400 KB each) once boards exist.
- New dependencies: one-line reason in Open, exact pinned version (`docs/SECURITY.md` §11). Expected: `ably` (client +
  REST). Nothing else without a reason.
- Use plan mode for Part B (it touches the data layer and most actions); show a ≤ 10-line plan before editing.

## Before you run (Tal) — Ably key for live sync (≈ 5 minutes, optional for Session 1)
Without the key everything works: live sync falls back to light polling (changes appear within ~10 s instead of ~1 s).
1. ably.com → Sign up (free, no credit card) → create an app named `Nexus`.
2. App → API Keys → Create new key: name `nexus-server`, capabilities **Publish, Subscribe, Presence** (nothing else).
   Copy the key (looks like `xxxx.yyyy:zzzz`).
3. Vercel → Project → Settings → Environment Variables → add `ABLY_API_KEY` = the key (Production only). Redeploy happens
   with the next merge.
4. Same name in `.env.local` on the PC (the builder can do this if you paste nothing in chat — add the line yourself).
Free tier (checked 2026-10-06): 6 M messages/month, **200 concurrent connections**, 200 channels, no card. Plenty for the
closed circle; Part B keeps connections low (only visible tabs).

## Part 0 — start
### 0.1 [ ] Read and record
- Read open reports, `docs/R16-NOTES.md`, R15 "## Open". Record in Open the R15 Part G results that weren't reported (prod
  smoke run on GitHub after the merge, sign-in checks) — from the Actions history.
- Tal's failing link (notes item 10) is unknown → after C2 ships, the extract failure log will show it; ask for the URL
  in Open if it isn't there.

## Part A — bugs and small UX (Session 1)

### A1. [x] Receipt items lose their price when moved out of History
Tal: scanned a receipt → items in History with prices → moved to To buy → prices gone.
Cause (found): `statusPatch()` in `src/app/actions.ts` sets `purchasedPrice/purchasedCurrency = null` for `to_buy`.
Items created by a receipt (`applyReceipt`, `receipt-actions.ts`) have **no source**, so the paid price was their only
price. Expected: no status change ever loses a price the user had.
- Moving to To buy keeps the last paid price as **last paid** (new columns `last_paid_price`, `last_paid_currency`, or
  equivalent; set whenever an item leaves Received/On the way with a price). Cards/rows/sheet show "Last paid ₪x" when
  there is no live source price; budget/"left to buy" uses it as the estimate (mark it as an estimate, same style as other
  estimates).
- Moving back to Received/On the way pre-fills the paid price from last paid. Bulk (`bulkSetStatus`) and Undo behave the
  same. Existing data: nothing to backfill (the wiped prices are gone; say so in Open).
- Acceptance: unit test on `statusPatch` for all 9 transitions × with/without source; smoke: apply a fixture receipt →
  move 2 items to To buy → prices still visible → back to Received → paid price = original.

### A2. [x] Re-opening "Scan receipt" shows the previous receipt and won't take a new one
Tal (PC): open the scanner again → previous receipt appears (re-shuffled), a new file isn't accepted until a refresh.
Not reproduced yet — reproduce first (PC upload path and phone camera path). Candidates seen in
`receipt-dialog.tsx`: the hidden file `<input>` never clears `value` (choosing again doesn't fire `onChange`); the open
effect keeps `phase` when it isn't `pick`; the "waiting to apply" list may include receipts already applied.
Expected: every open starts clean at "pick"; picking any file (same or new) reads it; receipts waiting to be applied are
listed under their own small heading, never auto-opened. Acceptance: smoke opens → uploads A → closes → opens → uploads
B → B is read; same with A twice.

### A3. [x] Desktop quick actions disappear once the space has items
Tal: scan receipt / scan barcode / … exist on desktop only in the empty state (`HomeEmpty`, `home-view.tsx`); the phone
has them always in "+". Expected: on desktop the same set as the phone "+" (paste link, scan barcode, photo, scan
receipt, import, new list/project) is always one click away: an "Add" split button next to the add bar (and the existing
keyboard shortcuts listed in its menu). One source of truth for the action list (shared with the phone sheet).
Acceptance: smoke on a seeded space (desktop 1366) opens the menu and starts receipt + barcode.

### A4. [x] Selection bar "Move to" shows only "Remove from project"
Cause (found): the menu (`selection-bar.tsx`) lists only the current space's lists/projects; a new shared space has none,
and "Remove from project" shows even when no selected item is in one. Expected menu:
- **Status**: To buy · On the way · Received (moves status menu here; keep the separate status button only if the
  mockup keeps it — otherwise one menu).
- **Lists & projects** of the current space, with a search field when > 8, and "New list…" that creates one and moves
  the items there in one step.
- "Remove from list/project" only when at least one selected item has one.
- Empty space: a one-line hint + "New list…" (never a lone "Remove" item).
Acceptance: smoke on an empty shared space: select 2 → Move to → New list "Test" → both items in it.

### A5. [x] Two selection-bar menus open at once
Tal: "Move to" open, click "Priority" → a second menu opens on top. Expected: exactly one menu/popover open at a time
across the selection bar (Move to, Priority, Status, Compare); clicking another trigger closes the first and opens the
second in one click; Esc closes. Implement with one controlled `openMenu` state in the bar (don't rely on Radix
modality). Acceptance: smoke opens each pair in turn and asserts one `[role=menu]`/popover in the DOM.

### A6. [x] List view always shows the selection checkbox
Tal: looks unprofessional. Expected (desktop list/table, `item-table.tsx`, and grid cards): the checkbox is hidden and
the picture shows; on row hover or keyboard focus the checkbox fades in over/next to the picture (120 ms); while any item
is selected every row shows its checkbox. Phone unchanged (long-press to select). Header "select all" appears only in
selection mode. Acceptance: screenshot pair (idle vs hover vs selecting) at 1366, light + dark; smoke asserts the
checkbox is `opacity:0`/not tabbable-visible at idle and visible after hover and after the first selection.

### A7. [x] Nexus suggests: swipe on phone, drag on desktop
Expected: phone — horizontal swipe with snap, rubber-band at the ends, follows the finger 1:1, vertical scroll still
works (axis lock after ~8 px); desktop — drag with the mouse (grab cursor), plus the existing arrows and dots; keyboard
←/→ when focused; RTL flips direction. Reduced motion: no inertia, instant snap. Acceptance: smoke swipes with touch
events on 390 and drags on 1366 → the index changes; frame timing during the swipe ≥ 55 fps on the bench PC.

### A8. [x] Phone: first render after sign-in is the desktop layout
Tal: after Google sign-in on the phone the app showed desktop size; a refresh fixed it. Reproduce with the test IdP
(`AUTH_TEST_IDP=1`, dev server) in Playwright mobile emulation (390×844, `isMobile`, `hasTouch`) through the full redirect
chain (`/login` → IdP → callback → `/` or `/welcome`). Find the cause (candidates: a page in the chain without the
viewport meta / with a different `viewport` export, a server-rendered layout guess that the client keeps, the PWA
standalone window after a Custom Tab return). Expected: phone layout on the first paint, no reload. Acceptance: new smoke
step asserts the phone dock is visible and no `lg` sidebar exists on the first screenshot after the callback.

### A9. [x] Sign-in screens: centre the content; brand panel cubes fit
Tal: big gap between the Google button and the bottom links (also on "sign in again"); cubes too big and cropped on
PC and phone. Expected: on phone the form block is vertically centred in the space below the brand band, footer links
pinned at the bottom with the safe area; the cube field scales to the panel (contain, never cropped mid-cube) at
360×740, 390×844, 1280×720, 1366×768, 1920×1080. Reduced motion keeps the still frame (by design — Tal's Windows has
animations off). Acceptance: parity PNGs at those sizes vs `docs/design/r15/SignIn-*.dc.html`.

### A10. [x] Phone top bar: logo back to full size
Tal: the wordmark shrank next to the new space switcher; it's the "go Home" button. Expected: the logo + wordmark at
its R14 size (check `git log -p` on the header for the old value); the space switcher becomes a compact chip (space
tile + chevron, name only if it fits at 390 — never squeezes the logo). Both ≥ 40 px touch targets. Acceptance: 360 and
390 screenshots, Hebrew + English, no overflow (existing overflow-at-360 smoke).

### A11. [x] "+" sheet stutters when closing
Measure first (trace on 390, 6× CPU throttle): the open is smooth, the close drops frames. Likely: content unmounts or
layout-affecting properties animate on close, or the backdrop blur animates. Expected: close uses the same
transform/opacity-only curve as open (`--ease-out`, ≤ 280 ms), content stays mounted until the animation ends.
Acceptance: frame timings before/after in Open; no frame > 32 ms during close at 4× throttle.

### A12. [x] Space switch: no sidebar jump (quick fix; the full transition is D4)
Cause (found): `useSwitchSpace()` (`spaces/space-ui.tsx`) does `window.location.replace(...)` — a full page reload, so the
shell re-lays out (sidebar jumps, gets cut, snaps back). Expected now: switch **without a full reload** — the server
action sets the cookie, then the client fetches the new space's data (same loader as the first render) and swaps the
store; sidebar and shell stay mounted; land on **Home**. Realtime channel re-subscribes (Part B). D4 later adds the
"You're now in…" moment on top. Acceptance: smoke switches spaces and asserts the sidebar's bounding box doesn't change
across frames (sampled every frame during the switch), URL view = home, data = the new space only (`test:tenancy`
stays green).

### A13. [ ] Open report: "price drop and the AI didn't recognise it"
Triage: check what the assistant gets for an item with a recent price drop (price history, alerts). Fix if the context
lacks it (add last price change + alert to the item context, no other content); otherwise answer the report with the
reason. Close the report with a status.

## Part B — live shared spaces (Session 1) — Tal: "very, very important"
Goal: a change by one member appears for every other member of that space **within ~1 s**, without refresh, and two
people can't silently overwrite each other.

### B1. [ ] Change feed per space
- Per-space monotonic revision: table `space_rev(space_id pk, rev)`; every write through the scoped layer
  (`src/lib/db-scoped/index.ts` `insert/update/delete`) bumps it **in the same transaction** and stamps the new `rev` on
  every row it writes in the synced tables (items, sources, price_points, collections, alt_groups, attachments,
  space_pref, receipts, and anything else the client store holds — list them in Open). Deletes write a tombstone
  `(space_id, table, row_id, rev)`, kept 30 days (cron purges).
- `changesSince(rev)` server action (`requireCtx("read")`): returns upserted rows and tombstones with `rev > x` for the
  current space, plus the new `rev`. If `x` is older than the tombstone window → `{ reset: true }` and the client reloads
  its data (no page reload). Index `(space_id, rev)` on each synced table — add the query to `test:query-plans`.
- Client store: `applyChanges()` merges by id (upsert/remove) without resetting UI state (open sheet, selection, scroll,
  half-typed input). The sheet that is open on an item that changed shows the new values; an item deleted under an open
  sheet closes it with a short "Removed by Noa" note.

### B2. [ ] Transport: Ably with a polling fallback
- Server: after a write action commits, publish **one** message per action to channel `space:<spaceId>` via Ably REST
  (`{ rev, by: <member id> }` — **no item content, no names**). Fire-and-forget with a 1.5 s timeout; a failed publish
  never fails the action.
- Client: `/api/realtime/token` (`requireCtx("read")`) returns an Ably TokenRequest: `clientId` = user id, capability
  **only** `space:<currentSpaceId>` → `subscribe` + `presence`, TTL 15 min. Re-issued on space switch; a removed member
  gets no new token (old one dies ≤ 15 min, and `changesSince` refuses anyway). On message → `changesSince(lastRev)`
  (coalesce bursts: at most one fetch in flight, re-run once if more arrived).
- Connect only while the tab is visible; disconnect after 2 min hidden; on visible/online → reconnect + `changesSince`.
  Ignore your own messages (`by` = me and `rev` already applied).
- **No `ABLY_API_KEY`** (or Ably unreachable): poll `changesSince` every 10 s while visible, on focus and on `online`.
  A cheap `HEAD`-like check (`spaceRev()` returns only the number) keeps it to one tiny query when nothing changed.
- Tests: a transport interface with a **local fake** (dev/test only, refused in production like `AUTH_TEST_IDP`) so CI
  needs no key. New `npm run test:live`: two browser contexts (A, B) in one shared space → A adds, edits, moves to a
  list, changes status, deletes → B sees each within 1.5 s (fake transport) and within 12 s (polling mode). Viewer gets
  updates but still can't write.
- One manual check with the real key on localhost (if Tal added it): record latency A→B (p50/p95 over 20 edits) in Open.

### B3. [ ] Conflicts: "already changed by Noa"
- Edit actions on existing rows take the `rev` the client saw (`baseRev`) and update with `WHERE id = ? AND rev = ?`.
  0 rows → `{ conflict: true, row, by }` (fresh row + who changed it). Covers: item edit, status (single + bulk), move,
  priority, collection edit, alt groups, budget. Adds and deletes don't conflict (delete of an already-deleted row = no-op).
- Client: the optimistic change is rolled back to the fresh row; toast "Noa changed this a moment ago" with **Show** and
  **Apply mine** (re-sends with the new `baseRev`). Bulk: apply to the rows without conflict, report the rest in one toast.
- Field-level merge isn't needed: if the fields the user changed weren't touched by the other change, apply silently
  (compare the changed fields only) — this keeps "A moves category, B edits the price" conflict-free.
- Acceptance in `test:live`: A and B edit the same item's price from the same `rev` → second gets the conflict, nothing
  lost; A changes price while B changes list → both kept, no toast.

### B4. [ ] Presence and "who did what" (from the R15 `LiveList-phone` board)
- Ably presence on the space channel: green dot on avatars of members online now (switcher facepile, people list, space
  header); "Noa is shopping" chip when a member is in shopping mode (presence data = `{ mode: "shopping" | "app" }` only).
- Activity toasts for other members' changes, batched: at most one per 10 s per member ("Noa added 3 items",
  "Yoav checked off 5"); never while the user is typing in a field; off in Settings → Display ("Show live activity").
- Polling fallback: no presence (dots hidden), toasts still work from the change feed (`by` + table + op).
- Build on the existing `Avatar online` prop and LiveList board; mockups for anything new come with Session 2.

### B5. [ ] Budget and guards
- Ably budget: 200 concurrent connections, 6 M messages/month. Log publishes per day (count only) and show in Open the
  estimate for 20 households. Never publish per row — per action.
- Security: token route rate-limited (30/min/user), capability limited to one channel, no content on the wire,
  `test:authz-coverage` includes the new action/route, `test:tenancy` adds "B can't get a token or changes for A's space".
  CSP: allow Ably's realtime hosts in `connect-src` only (exact hosts, no wildcards beyond Ably's documented ones); keep
  `test:headers` green.

## Part C — error reporting (Session 1) — Tal: "strong security"
### C1. [ ] Report a failure in one tap
- Every error toast for a failed user action (add from link, picture search, receipt read, barcode lookup, AI answer,
  import, sync conflict that failed) gets a **Report** action → the existing report dialog opens pre-filled (type bug,
  title = what failed, diagnostics attached automatically) — one tap on **Send**.
- What's attached is listed in the dialog; anything that is user content (the pasted link, the receipt image) is an
  explicit checkbox, default **on** for the link (it's what we need to fix extraction), **off** for images.
- Acceptance: smoke forces an extract failure (mock) → toast → Report → Send → report row has the failure code and the
  link domain + path.

### C2. [ ] Automatic error log (no user action), abuse-proof
- Table `error_event` grouped by **fingerprint** = hash(kind + code + route/action + normalised message): `count`,
  `users` (distinct count via hashed user ids, no ids stored), `first_seen`, `last_seen`, `release` (git sha),
  `sample` (≤ 500 chars, redacted: no query strings, no emails, no item/space/list names, no numbers longer than 6
  digits), `status` (new/known/fixed). One row per fingerprint, updated with `count = count + 1`.
- Sources: (1) server — a wrapper used by every server action/route catches unexpected errors (not validation/auth
  errors) and records them before rethrowing a generic error; (2) link extraction — failure stage (fetch, blocked,
  HTTP status, parse, no price, no picture) + **domain only**; (3) AI provider failures (provider, model, code);
  (4) cron step failures; (5) client — `POST /api/errors` from `client-errors.ts`' buffer (uncaught errors, unhandled
  rejections, error toasts), batched, sent on idle/visibility change.
- Limits so it can't take the system down: request body ≤ 8 KB, ≤ 10 events per request, zod strict; signed-in users
  30 events/hour, anonymous (login pages) 10/hour/IP; client dedupes by fingerprint per page load; server caps the table
  at 1 000 fingerprints (beyond that only an `overflow` counter goes up) and drops samples older than 30 days; writes are
  fire-and-forget with a timeout and never throw into the app; same-origin check on the route. The existing
  `/api/csp-report` goes through the same limits.
- Viewer: admin-only page **`/admin/errors`** (`ADMIN_EMAIL`), the seed of R17's admin panel: list by last seen /
  count, filter new/known/fixed, set status, "Create GitHub issue" when `GITHUB_ISSUES_TOKEN` is set. Plus
  `node scripts/errors.mjs` (like `reports.mjs`) so a fix round reads them first — add that to `CLAUDE.md`.
- Privacy: users aren't identified in the log; the admin sees counts, not people. Mention it in `/privacy`.
- Acceptance: `test:errors` — 200 events from one user in a minute → 30 stored, rest rejected 429; 2 000 distinct
  fingerprints → table stays at 1 000 + overflow; a sample containing an email/URL query/long number is redacted;
  a thrown error in a test action appears once with count 3 after 3 calls; `test:authz-coverage` covers the route.

## Part D — settings and space screens (Session 2, mockups `docs/design/r16/`)
Design language as R15 ("less text, visuals first, light, premium"). Boards to be approved: `Settings-desktop`,
`Settings-phone`, `SpaceSettings-desktop`, `SpaceSettings-phone`, `SpaceIdentity` (desktop + phone, incl. crop),
`SpaceSwitch` (motion storyboard), `HomeCustomize` (desktop + phone), `HomeWidgets` (new indicators).

### D1. [ ] Settings on desktop: a large, structured screen
Replace the small centred dialog (`settings-dialog.tsx`) with a large two-pane screen (≈ 960×640, max 90 vh; or a full
page `/settings/<section>` — follow the board): side nav of sections (You: Account & security · Display · Assistant & AI
· Calendar · Memory · Data (backup, import, export) — Space: General · People & invites · Budget · Danger zone), content
on the right, **no section scrolls at 1366×768** except long lists. Deep links (`/settings/display`), command-palette
entries per section, Esc/back closes. Existing pages `/settings/security`, `/settings/invites` become sections.

### D2. [ ] Space settings: bigger, no scrolling
Same shell as D1 (the "Space" group), opened directly from the switcher/space menu. Sections: General (identity, name,
currency), People (roles, remove, transfer), Invites (links, QR), Danger zone (leave, delete). At 1366×768 nothing
scrolls; at 1280×720 only the People list may.

### D3. [ ] Phone: sectioned full-screen overlays
Settings, Space settings and every other full-screen overlay (audit the list in Open: Security, Invite codes, Memory,
Reports, Import, …): a section list → section page (push, swipe-back/Android back returns to the list), never one long
scroll of everything. Bottom sheets that cover part of the screen stay as they are.

### D4. [ ] Space switch moment: "You're now in Jacoby Home"
On a switch: the space tile flies from the switcher to the centre (shared-element), a wash of the space colour, name +
facepile, ≈ 700–900 ms total, then lands on **Home** (A12 already avoids the reload). The data loads during the
animation; if it isn't ready the moment holds with a subtle progress (max 3 s, then skeletons). Reduced motion: 150 ms
cross-fade with the name. Interruptible by a tap. Acceptance: frame timings ≥ 55 fps on the bench PC, sidebar box
constant, smoke asserts the overlay appears and Home shows the new space.

### D5. [ ] Space identity editor (+ photo like a WhatsApp group)
Tal couldn't find a way to change the space look. Build the `CreateSpace` identity step for create **and** edit:
- Tile: icon set (the board's 10–24 icons, use the unused `icon` column) × 6 colour gradients; live preview in the
  switcher/sidebar sizes.
- **Photo**: upload (or camera on phone) → crop/zoom in a rounded square (pinch + drag on phone, wheel/slider + drag on
  desktop, rotate 90°) → stored as 512 px WebP, re-encoded (EXIF/GPS stripped) in Blob under `spaces/<id>/identity/`,
  JPEG/PNG/WebP/HEIC ≤ 10 MB in, owners only, old photo deleted on replace/remove. Photo shows everywhere the tile does.
- Acceptance: smoke uploads a fixture with EXIF GPS → stored file has no EXIF; viewer/member can't change it
  (`test:roles`); tile/photo visible in switcher, sidebar, join preview.

## Part E — Home (Session 2)
### E1. [ ] Customise: presets and widget sizes
Keep hide/reorder; add **presets** (board: e.g. Household — shopping first; Maker — projects first; Deal watcher —
prices first; Minimal) and **sizes per widget** (S/M/L on a 12-column desktop grid; phone: full or half width). Drag to
reorder with smooth FLIP animation, resize by handle or size menu, live preview, Reset. Saved per user per space
(fallback to the user's last layout). Must feel native: no layout jump, ≥ 55 fps while dragging.

### E2. [ ] More indicators
New widgets from the `HomeWidgets` board (planner's candidates, all from data we have: price drops this week, money saved
by tracking, spending vs last month, next delivery, budget by category, most bought, shared-space activity today).
Hidden by default unless a preset includes them; each has an empty state and a skeleton.

## Part F — guards and docs (end of Session 2)
### F1. [ ] Guards
`test:live`, `test:errors` in `guards.yml`; overflow-at-360 and sidebar-box-per-frame smokes cover D1–D4; parity PNGs.
### F2. [ ] Docs
`SPEC.md` Round 16 section (edit, don't append twice), help (`nexus-help.md`: live sync, conflicts, reporting, settings,
space photo, Home presets), `CLAUDE.md` map (change feed, realtime, error log, `scripts/errors.mjs`), `ENVIRONMENT.md`
(`ABLY_API_KEY`, new scripts/tests, log line).

## Roadmap (Tal 2026-10-06, replaces 2026-10-05)
R16 this brief → **R17 product layer**: web push + inbox + per-kind settings, onboarding (4 screens), admin panel (users,
usage without content, AI usage, all reports, the C2 error log), AI quota + PII stripping, privacy/terms + delete account
+ export, QR desktop login, remove password fallback + old guest tables, delete `public/nexus-extension.zip` → R18
supermarket mode v2 → R19 price comparison → closed circle on the PWA → Android wrapper.

## Open

### Session 1 (2026-10-06)
- **0.1 — R15 Part G results (from the Actions history):** `guards` green on `main` after the merge (`0091467`, run 37439902988,
  08:59 UTC) and on every docs push since. The **prod smoke after the R15 deploy** (`smoke` run 37440189405,
  `0091467`, 09:02 UTC) signed in through the admin fallback (`PASS owner login`, `PASS anonymous is redirected to /login`,
  anonymous blocked from backup/export/cron) and passed 41 steps incl. AI health, offline snapshot, "no page/console
  errors"; **5 FAIL**, all data-shaped (the smoke expects the demo seed, prod has Tal's real space): Needs-you tile count,
  month view (no arrival next month), calendar feed (`arrival:false`), layouts on demo list ids (`c:demo-c-railcam`,
  `s:raspberrypi`), "to buy: no summary card" on a demo project. The same steps failed on R13/R14 prod runs → not R15
  regressions; the prod smoke needs a "real data" mode (skip demo-id steps) — left for F1/R17. Google sign-in on PC + phone
  and creating "Jacoby Home" were done by Tal by hand (notes); no other Part G check left a trace in Actions.
- Open reports at start: 1 (`r_rWtP3XmuRl`, price drop / AI → A13).
- **Migration rehearsal source:** Tal's session prompt says prod is already on the R15 schema, so the R16 rehearsal runs on a
  copy of `snapshots/prod-2026-10-06-post.db` (not `prod-2026-10-06.db`, which is the pre-R15 snapshot).
- **A1:** the prices wiped before R16 are gone (the old code stored `NULL`); nothing to backfill. "Last paid" shows on
  cards, rows, the sheet's price tag and the table as `Last paid ~₪x` (muted); To-buy totals that include such lines get
  `~` and Home says "~n estimated from last paid".
- **A2 cause:** after Apply the dialog stayed in its "busy" phase and the open effect kept a busy phase, so the next opening
  showed the old state and a read still running from the previous opening replaced the new one. Fixed with a session per
  opening (late results dropped; the receipt waits under "Not applied yet") + the file input cleared after each pick.
- **A3:** the shared list (`add-actions.tsx`) = barcode, receipt, paste link (`/`), plan with Nexus, import, new list, new
  project; desktop gets an Add split button (chevron = the menu), the phone "+" gets the last three as a compact row under
  the four cards, the empty Home uses the same list. The brief's "photo" has no entry of its own: identify-by-photo lives
  inside the barcode result (no code → take a photo) — it stays there.
- **A11 frame timings** (`node scripts/perf-frames.mjs plus`, 390×844 phone emulation, rAF deltas during a 450 ms window,
  5 runs; LoAF showed a 130–145 ms click handler at 6×: toggling `plusOpen` in the app-wide store re-rendered the whole app):

  | | open, worst frame / frames > 32 ms | close, worst frame / frames > 32 ms |
  |---|---|---|
  | before, CPU ×6 | 317 ms / 16 | 267 ms / 16 |
  | before, CPU ×4 | 300 ms / 28 | 367 ms / 18 |
  | after, CPU ×6 | 200 ms / 36 | 50 ms / 22 |
  | after, CPU ×4 | 117 ms / 7 | 33 ms / 1 |

  Fix: the open state moved to a tiny external store (`usePlusOpen`), close runs the same transform/opacity pair on
  `--ease-out` in ≤ 260 ms (no spring), content stays mounted. At 4× over 10 runs the close's worst frame is 16.8 ms in 7
  runs and 33.3 ms (one missed vsync, the click frame: 6–12 ms of script) in 3 — just over the brief's 32 ms. Open still
  has one long first frame (the sheet renders 7 actions + prewarms the scanners); it was "smooth" per Tal and not in scope.
- **A7 frame timings** (`node scripts/perf-frames.mjs suggest [--desktop] --cpu N`, 6 swipes/drags each, rAF deltas): phone
  touch swipe ×1 → 60 fps median, worst frame 16.8 ms, none > 32 ms; desktop mouse drag ×1 → 60 fps, worst 16.8 ms;
  phone ×4 → 60 fps median, worst 33.4 ms (2 frames). Before: no swipe/drag existed (only dots/arrows). Release rule
  (`pagerRelease`: 25 % of the width or a fling ≥ 0.5 px/ms, no wrap past either end) and the rubber band are unit-tested
  in `test:gestures`; keyboard ←/→ and the dots/arrows keep wrapping as before. A mouse drag that starts on a button stays
  a click; a finished drag swallows the click under it.
- **A8 — not reproduced; guarded.** Through the test IdP on a dev server in Playwright phone emulation (390×844,
  `isMobile`, `hasTouch`, `/login` → IdP → callback → `/`), the first screen is the phone layout (dock visible, no
  sidebar, no reload) — new step in `test:auth-flow`. Every page of the chain has `width=device-width` in `<head>` (byte
  ~200 of the HTML), and the app's layout is CSS-breakpoint driven before hydration + `matchMedia` after, so a stuck
  desktop layout means Chrome laid the page out at desktop width (980 px, no device-width viewport) — most likely the
  page coming back from Google inside the installed app's Custom Tab. Fix = a self-heal in the first inline script: a touch
  screen with a short side < 600 px and a layout viewport ≥ 1024 px reloads **once per tab session** (smoke: such a phone
  reloads once and stops; a normal phone and a desktop never reload). **Tal:** was it the installed app (home-screen icon)
  or Chrome? If it happens again, a screenshot of the URL bar helps.
- **A9:** phone — the form block is centred in the space under the brand band (it was top-aligned: `align-items:flex-start`
  below 900 px), legal line pinned at the bottom with the safe area. Cubes — the field was a fixed 816×876 px stage
  (390×430 on phones) centred in the panel, so any narrower panel cut it mid-cube; now every cube is placed in % of the
  field's own bounding box and the stage *contains* itself (aspect-ratio + `cqw/cqh` of an absolutely-inset room above the
  wordmark). Smoke checks the field inside its panel at 360×740, 390×844, 1280×720, 1366×768, 1920×1080 and the phone form
  centred; composite `docs/design/parity-r16/signin-sizes.png` (light, reduced motion = Tal's still frame). The re-auth
  screen is the same `/login` page (returning-account chip), so it gets the same layout.
- **A10:** R14 (`1e2b9cc`) had the Box mark + "Nexus" at 16 px / 800; R15 dropped the wordmark whenever a space exists. The
  wordmark is back (always), and the space switcher is a 40 px pill chip (26 px tile + chevron; the name, ≤ 96 px, only from
  380 px up). Smoke at 360/390 × en/he: no overlap, no overflow, both ≥ 40 px.
- **A12:** `switchSpace` (cookie) → `loadAppData()` (new action, the same loader as the first render: `getAppData` +
  `spaceShell`) → `replaceData()` swaps items, lists, groups, budget, alerts, home prefs, space/people/me in place and
  lands on Home with "Now in …"; on any failure it falls back to the old reload. Smoke samples the sidebar's box on every
  frame of a switch (one value across ~60 frames, no reload, Home, the new space's data); `test:tenancy` 42/42 (its
  "keeps the view" check is now "lands on Home", per the brief). Create / leave / delete / restore / transfer still reload
  (they change the membership list itself) — D4's moment can take those over.
