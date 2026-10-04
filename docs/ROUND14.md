# Round 14 brief (from Tal, 2026-10-04) — fixes after Round 13: AI on Home, match the design, calmer light theme — source of truth

Tal tested Round 13 on the PC and the phone. This round fixes what he found and the places where the app drifted
from the approved design. Decisions come from the planning chat. Values for new looks are written here. The reference
mockups are `docs/design/home-v4/*.dc.html` (desktop, phone, shopping, search). The planning canvas also has a
"Round 14" page with the logo and light-theme comparisons; the values from it are copied into this brief.

One **unattended** run, same rules as Rounds 7–13 "How to run":
- Work on branch **`round14`** from `main`. Commit each item as `R14.<part><k>: …`.
- Push the branch after each part. Never stop to ask: put decisions in "## Open". Merge to `main` with `--ff-only`
  only when everything is green. Don't touch power settings. Read open reports first.
- Verify on phone (360/390) and desktop (1366), light + dark, Graphite + Plum, English + Hebrew.
- **New this round — design parity proof:** for every screen touched in Part B, save a side-by-side PNG (mockup
  left, app right, same viewport, light and dark) to `docs/design/parity-r14/`. Use ≤ 16 files, each ≤ 400 KB.
  Render the mockups with Playwright as plain HTML; `{{…}}` holes may show as text, which is fine. List every
  difference you kept on purpose in "## Open". Round 13 shipped a sidebar and a dark mode that didn't match the
  mockups. This proof is how we stop that.

---

## Part A — Bugs

### A1. [x] "Ask Nexus about …" sticks to every new chat
Tal searched "dark" on the phone and tapped **Ask Nexus about "dark"**. After that, every **New chat**, and every
reopening of the assistant, sent "dark" again.

**Cause:** `askAssistant` stores `askSeed` in the store (`store.tsx`) and never clears it. `AssistantPanel` passes it
to `ChatTab`, which is remounted with `key={chat}` on New chat. Its `seeded` ref starts empty, so the same `seedKey`
is sent again (`assistant-panel.tsx`, the `useEffect` on `seedKey`).

**Fix:** consume the seed exactly once. Clear `askSeed` in the store right after `ChatTab` sends it (e.g.
`s.consumeAskSeed()`), and keep the "already sent" key outside the component so a remount can't resend it. The same
applies to every entry that seeds the chat: command palette, phone search, Home CTAs, + menu "Plan".

**Acceptance:** a smoke test asks from the phone search, waits for the answer, then checks three things: New chat is
empty with no user bubble; closing and reopening the assistant shows the last conversation, not a resend; a full page
reload doesn't resend. Repeat from the desktop command palette.

### A2. [x] Home shows no AI ("Nexus suggests" and "Nexus noticed" are missing)
On Tal's real data both sections are hidden.

**Cause:** `homeSuggestions` and `noticed` (`src/lib/home.ts`) only fire on strict facts: a ≥ 10 % drop vs the usual
price, ≥ 3 buys for a cadence, weekday lows with price points, or a project with no budget. `home-view.tsx` hides a
section with no rows. Tal's data has none of those yet, so nothing shows.

**Fix — Home always has a voice when the account has items:**
1. **AI look, once a day, when rules give < 2 suggestions or < 2 insights.** Send the assistant's compact snapshot
   (the same one the chat uses, with price history from R13) to the AI chain. Ask for JSON: up to 3 suggestions
   `{title, why, action: {type: "open"|"add"|"budget"|"none", itemId?, collectionId?}}` and up to 3 insights
   `{text, action?}`.
   - Validate every returned `itemId`/`collectionId`, and drop entries that reference unknown ids.
   - Drop insights that contain a number not present in the snapshot (a simple number-match guard against invented
     figures).
   - Cache the result in kv by day + language. A failure retries after 3 h.
   - Respect the "AI-written suggestions" switch: off = no AI call.
2. **Broader rule fallbacks**, so there is something even with AI off or no key:
   - Suggestions:
     - no monthly budget → "Set a monthly budget";
     - the most expensive to-buy item has no target price → "Set a target price for X";
     - ordered items with no eta → "Add an arrival date to X";
     - items waiting in To buy > 30 days → "Still want X?";
     - extension not connected → "Add items from any store with the extension";
     - no receipts yet → "Scan a receipt to log a purchase".
   - Insights:
     - this month's top category or store by spend;
     - the most expensive open project;
     - the count and ₪ of items waiting > 30 days.
   - Each one is only shown when its facts exist.
3. The order inside each section: rule facts first (they're exact), then AI items, then fallbacks. Keep at most 4
   suggestions and 3 insights.
4. **Diagnostics:** Settings → Assistant shows "Home suggestions: last run <time> · source rules/AI · N items" and the
   last error if any. That way Tal can see why it is empty instead of guessing.

**Acceptance:**
- New seed variant `SEED_PROFILE=sparse` (items + collections, no alerts, no etas, no price points, no budget):
  - with AI on (mock): ≥ 2 suggestions and ≥ 1 insight;
  - with AI off: ≥ 1 suggestion and ≥ 1 insight.
- Unit tests cover the id validation and the number guard.
- The sections still hide on a truly empty account (A7 of R13).

### A3. [x] No indicators on To buy
Tal: the indicators belong on Home and Spending, not on the list pages.

**Cause:** `SUMMARY_VIEWS` in `home-summary.tsx` includes `to_buy`, `urgent` and `unsorted`.

**Fix:** remove them, so To buy (and the merged filters, B4) open straight on the toolbar and list. **Keep** the summary
on project (`collection`) and store pages (Tal: they hold that page's own budget / free-shipping info).

**Acceptance:** a smoke test asserts no `HomeSummary` on `?v=to_buy` and that it is present on a project page.

### A4. [x] Phones stuck on the table: the list ⇄ grid switch does nothing, checkboxes squeezed against the pictures
Added by the planner 2026-10-04 after Tal tested prod (R13). Do this item **first**.
Tal: on every product screen the phone shows a list with a checkbox at the edge that sits almost inside the product
picture; tapping grid (or list) changes nothing.

**Cause (reproduced in the planner's sandbox, 390 px, cookie `nexus_layout=table`):** there are two prefs —
`layout` (desktop cards/table) and `phoneLayout` (phone rows/cards). `Content()` in `nexus-app.tsx` checks
`s.layout === "table"` **before** anything phone-specific, so once `layout` is `table` the phone renders the desktop
`ItemTable` (checkbox column + 44 px picture, min-width 760) on To buy, On the way, History, projects, lists, stores.
The phone switch only changes `phoneLayout`, which that path ignores, and the desktop switch is `max-sm:hidden`, so
there is no way back. How a phone gets `layout=table`: the "Table view" command in the shared commands (`use-commands.tsx`
`id: "layout"`, shown in the R13 phone search), the Order-by-store toolbar (its desktop switch is visible on phones),
an old `nexus.layout` in localStorage, or a desktop window narrower than 640 px.

**Fix:**
- Below 640 px `layout` is ignored everywhere: `Content()`, `OrdersView`, `ContentSkeleton` choose by `phoneLayout`
  only (rows / cards). `ItemTable` never renders on a phone.
- The `layout` command: on phones it toggles `phoneLayout` (label List / Grid); on desktop it stays Cards / Table.
- The Order-by-store toolbar on phones shows the phone switch, not the desktop one.
- Don't rewrite the stored `layout` cookie on phones (the same browser can be a desktop window later).
- Desktop: re-check that Cards ⇄ Table works both ways on every product view (To buy + its filters, On the way,
  History, Order by store, project, list, store page) and that the table's checkbox has clear space from the picture
  (≥ 8 px) in English and Hebrew.

**Acceptance:** smoke at 390 px with cookie `nexus_layout=table`: To buy, History and a project page show
`[data-item-card]` and no `[data-item-row]`; tapping grid gives 2-column cards, tapping list gives rows; running the
layout command from phone search flips `phoneLayout` and never shows the table. Desktop 1366: the switch toggles
both ways on each view above. Screenshots of phone before/after go in "## Open".

---

## Part B — Match the approved design (desktop sidebar, phone shell, dark mode)

### B1. [x] Desktop sidebar = the v4 mockup, with a soft active item
Round 13 kept the old "U" sidebar: 44 px pill rows, and the active row is a solid black pill. Rebuild `sidebar.tsx`
to the `home-v4/desktop` sidebar:
- The sidebar sits on the page background with no card and no border. The content sits in its own pane, as in the
  mockup. Width 224 px (collapsed 68–76 px, keep the R13 drag/button/`Ctrl+B`).
- Rows: 34 px tall, radius 8 px, 13.5 px / 500 text, 17 px icons in `--muted`, counts at the end in 12 px muted.
  Section label "Projects" 11 px / 600 muted. Project rows have a coloured 8 px dot (or the budget ring when set).
- **Active row (Tal's choice):** a soft tint `rgb(23 23 23 / .07)` (dark: `rgb(255 255 255 / .08)`), text `--ink`
  600, icon `--ink`, plus a **3 px rounded accent bar** in the spark colour on the start edge, inset 9 px top/bottom.
  No black fill and no white-on-black. In Plum the bar uses the Plum brand colour.
- Hover: `--surface-2`.
- Bottom: the avatar + name + "Extension connected", separated by a hairline.
- The phone nav sheet (`floating={false}`) uses the same rows.
- **Acceptance:** parity PNGs (desktop light + dark, expanded + collapsed). A smoke test asserts the active row's
  computed background is not `--ink` and that its height is 34 ± 1 px.

### B2. [x] Phone shell = the v4 mockup
- **Dock:** icons **with labels** under them (10.5 px / 600), as in `home-v4/phone` and `home-v4/shopping`:
  Home · Shopping · + · Projects · Insights. Active = `--ink`, others `--muted`. The R13 note said "the dock stays
  icon-only"; Tal wants the labels.
- **Top bar:** Box + "Nexus" at the start, then the search circle, the Ask circle (hairline gradient ring) and the
  avatar, with 36 px controls, as in the mockup.
- **Acceptance:** parity PNGs for Home and Shopping, phone light + dark.

### B3. [x] Dark mode = the mockups
Light mode matches; dark doesn't. Compare every dark token the mockups use with `globals.css` `.dark` (and Plum
dark), and align them:
- Mockup dark: page `#0b0b0b`, cards `#141414`, raised `#1d1d1d`, card line `#313131`, inner line `#262626`, ink
  `#f2f2f0`, muted `#a1a19e`, warn `#fbbf24`, ok `#4ade9a`, info `#7aa7ff`, AI `#b69cff` (tints at 12–14 % alpha).
- Check the surfaces that use legacy tokens (sidebar, top bar, dock, sheets, item cards) and move them onto the same
  tokens.

**Acceptance:** parity PNGs (Home desktop + phone, Shopping, sidebar) in dark. `test:contrast` stays green in all 4
themes.

### B4. [x] One "To buy" with filters (merges To buy, Urgent and Unsorted)
Tal: having three pages is confusing.
- Remove **Urgent** and **Unsorted** from the sidebar, the command palette, the assistant navigation actions and help.
  The To buy toolbar gets filter chips **All · Urgent · No project**, each with a count. The URL is
  `?v=to_buy&f=urgent|none`. Old `?v=urgent` / `?v=unsorted` links redirect to the filtered To buy.
- The phone Shopping tab gets the same chips under the switch (To buy side only).
- Dropping items on the old "Unsorted" sidebar row used to remove them from a project. Keep that action through the
  selection bar ("Remove from project") and drag onto the "No project" chip on desktop.

**Acceptance:** smoke for each filter on desktop + phone, the redirect, and the drag/selection move.

### B5. [x] Light theme: calmer, a little darker (Tal chose "B · toned")
The light theme is too bright for Tal. Apply on phone and desktop:

| token | today | new |
|---|---|---|
| `--bg` (page) | `#f6f6f5` | `#eeede9` |
| `--surface` (cards, sheets, dock) | `#ffffff` | `#f8f7f4` |
| `--surface-2` | `#efefed` | `#e6e4df` |
| `--line` | `#e6e6e3` | `#dedcd5` |
| `--card-line` | `#dcdcd7` | `#d9d7d0` |
| `--line-in` | `#e8e8e4` | `#e4e2dc` |

- Shift the other light tints (warn/info/ai/ok-soft) the same small step so they don't look pasted on.
- Product pictures keep a white "paper" tile (`--paper: #fff`), so photos stay true.
- Plum light gets the same tone shift, staying slightly cooler/violet.
- `test:contrast` must stay green: muted text on `--bg` ≥ 4.5:1, so darken `--muted` if needed.

**Acceptance:** parity PNGs show the new tone. The contrast test is green.

### B6. [x] Logo: swap the dark face (Tal chose "B")
Graphite only. The left face of the Box follows the theme so the mark sits in the page:
- **light:** fill `#ecebe6` + 1.2 px edge `#cfcdc6` (in the 64-unit viewBox, round joins);
- **dark:** fill `#232323` + edge `#3d3d3d`.

The top and right faces stay orange `#fb7a3c` and amber `#f59e0b`. Plum keeps its violet face. Apply it to
`LogoMark`/`LogoPill`, the sidebar, the phone top bar, the assistant header, the opening animation (including the
fly-to-logo target) and the small loader. **Don't** change the PWA/app icons or the favicon (they sit on unknown
backgrounds). **Acceptance:** parity PNG of the logo in all four places, light + dark.

---

## Part C — Calendar

### C1. [x] "This week" opens a month view
Tapping the section header (or a new "Month" link) opens a month calendar:
- **desktop:** the card expands in place to a 6-row month grid with smooth height;
- **phone:** a bottom sheet (the shared Sheet).

‹ › moves between months. Days show coloured dots per event type (as the week strip). Tapping a day lists its events,
and each event opens its item. Event types are the same as A2 of R13 (arrivals, late, reorder due, price alerts,
budget close). **Acceptance:** a smoke test opens it, moves to next month, taps a day with an arrival, and opens the
item.

### C2. [x] Sync to the user's calendar — additions, changes **and deletions**
Tal wants Google Calendar to follow the app: new events appear, changed dates move, removed ones disappear.
- **Feed:** `GET /api/cal/<token>.ics`, an iCalendar feed of the next 60 days + the past 14:
  - Arrivals: an all-day event "📦 <item> arrives", with a link back to the item in the description.
  - Late packages stay on their eta day with the "late" label.
  - Reorder due ("🔁 Reorder <item>").
  - Each event has a stable `UID` (`<itemId>-eta@nexus`, …), and `SEQUENCE`/`LAST-MODIFIED` change when the date
    changes.
  - When an item is received, deleted or loses its eta, the event is **omitted** from the feed, which removes it in
    subscribing calendars.
  - The token is per owner and secret (kv), and can be regenerated in Settings (which kills the old URL). No session
    is needed. Rate-limit the endpoint, and send no prices or store names, only titles.
- **Settings → Calendar:**
  - **Subscribe in Google Calendar** (`https://calendar.google.com/calendar/r?cid=` + the `webcal://` URL),
  - **Apple / Outlook** (the `webcal://` link),
  - **Copy link**,
  - **Regenerate**.

  Also add a short note: "Google refreshes subscribed calendars every few hours, so changes can take up to a day to
  show." This is Google's limit; instant two-way sync needs Google sign-in, which is planned for the multi-user round.
- **Per-event button:** in the month view, each event has **Add to Google Calendar** (a template link) — but only
  while the feed is *not* subscribed. Once Settings records that it was subscribed (by the user's tap), hide these
  buttons to avoid duplicates. A one-off added event isn't removed automatically; say so in the button's tooltip.
- **Acceptance:**
  - Unit tests for the ICS builder (escaping, folding at 75 octets, all-day `DTSTART;VALUE=DATE`, UID stability,
    omission on received/deleted).
  - A smoke test fetches the feed with the token (200, `text/calendar`) and with a wrong token (404).
  - Validate the output with an ICS parser in the test.

---

## Part D — Tidy-ups
- Update `nexus-help.md` for the merged To buy, the month view and calendar sync. Keep `test:help` green.
- R13 Open asked about the sidebar drag direction (C2). Keep the R13 behaviour (the width follows the pointer).

## Not in this round
- Supermarket mode (recurring household purchasing) — Tal's next big feature, planned after the multi-user foundation.
- Google sign-in / instant two-way calendar sync (multi-user round).
- Changing the PWA icon.

## Open

### Run notes (session 2026-10-04, stopped at the usage limit)
- Done + committed: A1, A2, A3, B1, B2, B3, B5, B6, B4 (code). Not started: B parity PNGs (`docs/design/parity-r14/`),
  C1 month view, C2 calendar feed, Part D. `main` NOT merged (not everything green).
- B4 smoke: filters, counts, `?f=` and the old-link redirects pass on desktop + phone. The desktop write half (drag a
  card onto "No project", Move to → Remove from project) moves the item, but the smoke can't find the toast's Undo
  afterwards (toast gone before the DB check) — fix the step before trusting it. Each failed run leaves the newest
  to-buy-with-project item out of its project in `local.db` (put it back by hand).
- Boot-screen frame trace (≤ 2 dropped frames) is borderline on this PC: `main` also fails it 2/4 runs (3 dropped,
  worst ~183 ms); round14 passes 3/4 (worst 167 ms). Not a regression.
- Dark cards are `#161616`, not the mockup's `#141414`: `#141414` misses test:contrast's card-depth rule by 0.01.
- Number guard (A2) is applied to AI suggestions too, not only insights.
- Phone top bar follows the mockup (no bell): price alerts moved to a "Price alerts" row in Me; the avatar shows an
  unread dot.
- Project pages never had the summary card (they have their own header since R9); A3's smoke checks the project
  header and a store page's summary instead.
- Open report `r_rWtP3XmuRl` (price drop) was fixed in R13 (`ce81ec3`) but is still open in the app — close it there.
