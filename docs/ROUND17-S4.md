# Round 17 — Session 4 brief (fixes after S2 + S3)

From Tal's test notes (2026-10-10, phone + PC) + the leftovers of Sessions 2–3. Part of Round 17 (`docs/ROUND17.md`).
**Results go to `docs/ROUND17.md` "## Open" → "### Session 4"**; tick the items here. No new boards — build from this text
with the design bar of Sessions 2–3 (`.claude/skills/`: emil-design-eng, apple-design, mobile-native, animate +
RECIPES; easing tokens, press feedback, gated hover, reduced motion = fades only, safe areas, ≥ 44 px targets).

## How to run (Session 4)
- Branch **`round17-s4`** from `main`. Commit per item `R17.<part><k>: …`, push the branch after each part.
- Unattended, same rules as Sessions 1–3 (decisions in "## Open", don't touch power settings, read open reports + the
  error log first). DB changes, if any, additive only + the migration rehearsal before `git merge --ff-only round17-s4`.
- Verify phone 360/390 + desktop 1366 and 1280×720, light + dark, Graphite + Plum, **en + he**, reduced motion, touch +
  mouse + keyboard. `test:clip` stays at 0. Parity is not needed (no boards); add before/after PNGs for P1, P4, P6 to
  `docs/design/parity-r17/` only if the 12-file allowance is left.

## Part P — Tal's notes
### P1. [x] Space switcher: the name is cut from the wrong end, the pressed square is clipped
Tal (screenshot, Hebrew UI): the sidebar switcher shows "…coby home" — the start of "Jacoby Home" is cut, and the
pressed/selected square around the switcher looks cut off and untidy. **Cause (seen in code):** `switcher.tsx` puts the
Latin space name in a `truncate` span inside the RTL page, so the ellipsis lands at the visual start (left) and eats
the beginning of the name. Fix: user-written text (space names, item titles, people names, emails, store names) gets
`dir="auto"` (or `unicode-bidi: plaintext`) wherever it is truncated, so a Latin name truncates at its end and a Hebrew
name at its end — app-wide, not only here (one helper/class; list where you applied it in Open). The switcher's hover /
press / selected background and its focus ring sit fully inside the sidebar (no parent `overflow` clipping, even
radius on all corners, inset from the sidebar edge like the nav rows). The facepile must never squeeze the name below
~8 characters: at narrow widths show one face + "+1" or none. Collapsed sidebar: unchanged.
Acceptance: a `test:clip`-style check on the switcher at 232 px sidebar width with names "Jacoby Home", "בית יעקובי",
a 40-character Latin and a 40-character Hebrew name, en + he: the visible text starts with the name's first letter;
the switcher's highlight box is not clipped by any ancestor (its rect equals its visible rect).

### P2. [x] Mixed Hebrew + English reads in the wrong order
Tal: in the Hebrew UI the "+" (New) menu shows "תכנון עם Nexus" with **Nexus on the right**, next to the icon; it must
read "תכנון עם" first and Nexus on its left, like any Hebrew sentence. The string in `he.ts` is right, so the row is
laid out with an LTR base direction (likely a `dir="ltr"`/`direction: ltr` on the row or its label — the row also holds
the "/" shortcut key). Fix that menu, then **audit every place where English sits inside Hebrew** (brand "Nexus", store
names, units, product names in sentences, shortcut keys, chips, toasts, notifications, help, admin, onboarding, the
push payloads) — each Hebrew text block has an RTL base direction; Latin words inside it stay where Hebrew grammar puts
them; English-only names in their own element get `dir="auto"`/`<bdi>` (P1).
Acceptance: new `test:bidi` (reuse the `test:clip` walk, Hebrew only): every visible element whose text starts with a
Hebrew letter has computed `direction: rtl`, and in every text node with Hebrew + Latin the Latin run that follows a
Hebrew word is to its **left** (compare `Range` rects). In `guards.yml`. List the places you fixed in Open.

### P3. [x] The profile block opens a Profile section in Settings
Tal: today only the small gear next to the profile (bottom of the sidebar) opens Settings. Clicking the **whole profile
block** (avatar + name + email) should open Settings on a new **Profile** section — personal details, not general
settings. Same on the phone: tapping the avatar/name at the top of the Me sheet opens Settings → Profile.
- Profile = first section in the "You" group: photo (Google photo by default; upload/crop with the existing space-photo
  cropper; remove → initials), display name (editable, 1–40 chars, used everywhere names show), email (read-only, "from
  your Google account"), member since, and a link row to "Account & security" for sign-in and deleting the account.
  If name/photo already live in Account & security, move them here (Account & security keeps sign-in, sessions, delete).
- The block is one button (press scale .97, gated hover tint, focus ring), `aria-label` "Profile — Tal"; the gear stays
  as is. Hebrew/RTL + both sizes of the settings dialog; the 1366×768 no-scroll rule of R16 D1 holds for Profile.
Acceptance: `test:settings` gains Profile (open from the block, from the Me sheet, edit name → sidebar + facepiles
update, photo upload + remove, en + he).

### P4. [x] The inbox opens smoothly — no skeleton jump
Tal: the first time after a page load, the bell shows a loading animation that looks broken and then jumps to the real
notifications. **Cause:** `inbox.tsx` `Skeleton` always draws three 52 px bars, whatever the real rows are, and swaps
them for the list in one frame. Fix, in this order:
1. Prefetch: load the inbox in the background when the app is idle after start (the same idle hook K4 already uses)
   and again on bell hover / pointer-down, keep it in memory, and refresh in the background when opened — so the
   popover/page almost always opens with real rows and no loading state.
2. If it still has to wait (cold start), show nothing for the first 300 ms; after that a skeleton shaped like the real
   list: as many rows as the last known count (cached per user in `sessionStorage`, max 6, default 3), the same row
   height and media column, the group header. Then crossfade (150 ms, opacity only) to the rows — no height jump; the
   popover's height animates once if the count differs.
3. Empty → the empty state directly, no skeleton.
Acceptance: `test:inbox` adds: open right after load (throttled network) → no layout shift > 0 after the first frame
(`PerformanceObserver` layout-shift inside the popover/page), and with a warm cache the first frame already has rows.

### P5. [x] "Nexus suggests" writes "שקל" instead of ₪
Tal: a suggestion like "buy again — was bought for 45 שקל"; it must be the currency sign (₪45), never the word.
The text comes from the AI phrasing (`home-actions.ts` prompt) and passes `validateHomeAi()` in `lib/home-ai.ts`.
Fix both: the prompt tells the model to write money only as the app formats it (give it the formatted strings, e.g.
"₪45", in the snapshot) and never as a word; and the validator normalises any leftover word form — `שקל`, `שקלים`,
`ש"ח`/`ש״ח`, `NIS`, `shekel(s)`, `dollar(s)`, `euro(s)` next to a number — into the user's formatted amount
(`₪45`, `$12`, `€9`), keeping the number guard. Same for "Nexus noticed" and the weekly-summary push.
Acceptance: unit tests for the normaliser (he + en, before/after the number, with commas/decimals).

### P6. [x] "Nexus suggests" must not change height on the phone
Tal: on the phone the card's height follows the current suggestion, so every slide pushes all widgets below it up and
down. Fix: the card's height is fixed per layout — measure the tallest of its suggestions (title 2 lines max, why 1–2
lines, clamped with ellipsis) once per data change and width, and keep that height while sliding; a new data set may
change it once, animated (200 ms ease-out), never per slide. Same rule for every Home widget that rotates content.
Acceptance: `test:home` (or `test:polish`) slides through all suggestions at 360 and 390 and asserts the widget's
height and the next widget's `top` never change.

### P7. [x] Suggestions carousel: drag/swipe that wraps around
Tal: you can swipe (phone) or drag (computer) between suggestions, but at the last one a further swipe does nothing
(it rubber-bands), while the arrow wraps to the first. **Cause:** the drag handler (`home-view.tsx`, the carousel
comment "rubber-bands at either end") stops at the ends. Wanted: **drag/swipe past the last goes to the first, and past
the first goes to the last** — on both phone and computer, the same as the arrows and dots, with the same glide (no
rewind through all slides: the next slide comes in from the edge as if the list were a loop). Mouse drag on desktop
(grab cursor on hover-capable pointers), touch swipe on the phone, keyboard arrows when focused; RTL mirrors; reduced
motion = instant change. Axis lock and "a drag never clicks" stay.
Acceptance: `test:home` drags past both ends (mouse + touch emulation, en + he) and lands on first / last.

### P8. [x] Tal couldn't open the admin panel
Tal tried "/admin" and didn't get the panel. The panel is at `https://nexus-ashen-beta.vercel.app/admin` (not under
`/api`); everyone who isn't `role = admin` gets a 404 on purpose (G0). Check on prod data (read-only snapshot) that
Tal's user row has `role = 'admin'`. If not: on every sign-in, a user whose email is in `ADMIN_EMAILS` (or
`ADMIN_EMAIL`) and whose role isn't admin is promoted (logged once, admin-only), and the migration step does it now for
Tal. Make the entry visible: the "Admin" row in the avatar menu / Me sheet and the palette (G0) — confirm it shows for
admins on prod. `/api/admin` and other wrong paths stay 404. Write in Open exactly what you found.

## Part Q — leftovers from Sessions 2–3 (Tal's answers 2026-10-10)
### Q1. [x] Price notifications: owner + members only
Viewers no longer get `price` notifications or pushes (inbox included). `test:notify` updated.
### Q2. [x] "Check now" is back — on the item page
An action on the item page / item sheet for items with a tracked link: checks this item's price now (same fetch ladder,
rate-limited per user, e.g. 10 an hour), shows the result inline ("Checked now · ₪899, no change" / "dropped 10 %").
No drop-% picker (`minDropPct` stays as stored, default 5). Hebrew + RTL, viewer = hidden.
### Q3. [x] Prod smoke: "category filter narrows the grid"
Fails on prod before and after S3 (click timeout). Find why (likely no category chip in the real data, or a changed
selector) and make the step robust: skip with a note when the account has < 2 categories, otherwise pass.

## Part R — guards and docs
- `test:bidi` (P2) in `guards.yml`; `test:inbox`, `test:home`, `test:settings`, `test:notify` extended as above.
- `SPEC.md` R17 (edit), help topics touched (Profile, Check now), `CLAUDE.md` map, `ENVIRONMENT.md` if tests/scripts
  are added.

## Open
Write the Session 4 results in `docs/ROUND17.md` "## Open" → "### Session 4".
