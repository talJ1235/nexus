# Round 17 — Session 7 brief (a computer never turns into the phone UI)

From Tal (2026-10-11, PC, screenshot): zooming the page on the computer (Chrome zoom, the magnifier in the address bar)
switches Nexus to the **phone UI** — on `/admin` the phone tab bar (חי · אנשים · דיווחים · עוד) appeared at the bottom of
a 2544 px wide window. Tal: "resolution is not enough to know the user is really on a phone — add real checks that
don't hurt the system, so the computer never switches to the phone UI by mistake." Same session: `/admin` content area
stays **empty** on Tal's PC (both layouts), with no red console line. Part of Round 17 (`docs/ROUND17.md`). **Results go
to `docs/ROUND17.md` "## Open" → "### Session 7"**; tick the items here. Run **after Session 6 is merged** and
**before R18 Session 1** (R18 adds many phone screens; they must use the new device switch from day one).

## How to run (Session 7)
- Branch **`round17-s7`** from `main`; commit per item `R17.<part><k>: …`; push after each part; unattended; decisions in
  Open; `git merge --ff-only round17-s7` only when CI is green. No DB change expected.
- **X1 first** (small, unblocks the admin panel), then W, then Y. Read open reports and the error log first (`node scripts/errors.mjs`).

## Why it happens (planner, from the code)
The phone/computer decision is made **by viewport width** in ~40 places: Tailwind `lg:` / `max-lg:` (185 + 41 uses; the
shell, dock, sidebar), `useMedia("(max-width: 1023px)")` / `"(min-width: 1024px)"` / `PHONE = "(max-width: 639px)"`
(admin-app, settings shell/you/space, home-view, onboarding, identity, inbox, ask-card, nexus-app, view-items,
spending, budget-card, use-commands, assistant-panel, home-summary), plain `matchMedia(…)` calls (add-actions, store,
motion-extras, sidebar-edge, assistant-panel, item-card, sheet-drag), CSS `@media (max-width:1023px)` in
`components/admin/admin.css` and others, the boot script (`boot-screen.tsx` MODE_SCRIPT: `max-width: 768px`), and
`providers.tsx`. Browser zoom divides the CSS width (2544 px at 250 % ≈ 1017 px) → every one of them says "phone".
`lib/client-diag.ts` reports `device` by width too, so admin Live counts a zoomed PC as a phone.

## Part W — one device class, decided by real signals
### W1. [ ] `deviceClass`: phone | computer, fixed for the page's life
- **Signals (no permission prompts, no fingerprinting, nothing stored server-side beyond one cookie):**
  1. Server: `Sec-CH-UA-Mobile: ?1` (Chromium sends it by default); otherwise the UA (`iPhone`, `iPod`, `Android … Mobile`,
     `Mobi`). → first guess, used for SSR so the first paint is already right (no flash).
  2. Client, in the boot inline script before first paint: `navigator.userAgentData?.mobile`, the **primary** input
     `matchMedia("(pointer: coarse) and (hover: none)")` (zoom-independent; a touchscreen laptop keeps a fine primary
     pointer → computer), and the short side of the physical screen (`screen.width/height`, check it isn't affected by
     page zoom in Chrome/Edge/Firefox; if it is, drop it).
  - **phone** = mobile UA hint/UA **or** (coarse + no hover **and** short screen side < 600). Everything else =
    **computer**. **Tablets** (coarse, short side ≥ 600) = computer UI (planner's choice; Tal can change it).
- Written once as `<html data-device="phone|computer">` + cookie `nexus_device` (so the next SSR matches). It never
  changes on resize, zoom or rotation — only on a new page load.
- **Override:** Settings → Display → "Layout: Automatic · Phone · Computer" (default Automatic; stored in the same
  cookie). Escape hatch for odd devices and for testing.

### W2. [ ] Every phone/computer switch reads the device class
- New Tailwind v4 variants `phone:` / `desk:` keyed on `[data-device]` (`@custom-variant`, like `dark`), and one hook
  `useDevice()` (server snapshot = the SSR guess, so no hydration mismatch). Replace every **layout-choosing** use listed
  above: `lg:`/`max-lg:` that pick shell / dock / sidebar / sheet-vs-dialog, all `useMedia`/`matchMedia` width checks
  that mean "is this the phone", the admin CSS media queries, the boot script, `providers.tsx`, `client-diag.ts`.
- Width queries **stay** where they only size things inside a layout (columns, clamps, `sm:` padding). Decide each one;
  list the kept ones in Open.
- **Narrow computer window** (zoom or a half-screen window): stays the computer UI. Under 1024 px the sidebar collapses
  to its icon rail by itself (not saved as the user's choice); dialogs/sheets keep their computer form and fit the width;
  below ~720 px the page may scroll sideways rather than switch UI. No horizontal overflow at 1024 / 900 / 768 with the
  rail.
- Phone UI unchanged on real phones (portrait **and** landscape — landscape phones must not get the computer UI).

### W3. [ ] Guards
- New `test:device` (built app, own DB; in `guards.yml`): computer contexts (no touch, fine pointer, desktop UA) at
  1366×768, 1017×496, 900×600, 768×500, plus `deviceScaleFactor` 2.5 — Home, Shopping, Settings, Inbox, `/admin` show
  the sidebar / admin side nav, **no dock, no admin tab bar**; phone contexts (Playwright `devices["Pixel 7"]`,
  `devices["iPhone 13"]`, and Pixel 7 landscape) show the phone UI; tablet (`devices["iPad (gen 7)"]`) → computer; the
  override switch flips both ways and survives a reload; 0 hydration warnings; first-paint screenshot (before
  hydration) already in the right layout.
- Every existing phone test/smoke/parity context must emulate a phone (`isMobile` + `hasTouch` + a mobile UA — most
  already pass `isMobile/hasTouch`; add the UA). A lint-style check (script in the guards unit loop) fails on new
  layout-choosing width checks outside an allow-list file.

## Part X — `/admin` content empty on Tal's PC
### X1. [x] Admin hidden by ad blockers — rename the `ad-*` classes (do this first)
**Cause found (planner, 2026-10-11, from Tal's console):** on Tal's PC `#admin-main`, `.ad-top` and `.ad-body` have
computed `display: none` with no inline style, no `hidden`, and no external stylesheet in `document.styleSheets` → an ad
blocker's cosmetic filter (injected as a user-level sheet, invisible to the page and silent in the console). EasyList
(the base list of uBlock Origin / AdBlock / Adblock Plus / Brave) has the generic rules `##.ad-main`, `##.ad-top`,
`##.ad-body`, `##.ad-side` — exactly the admin shell's class names (`admin-app.tsx`, `admin.css`, `nx17.css`, also
imported by onboarding). That is also the S5 "black admin on desktop" that survived the #418 fix (side nav + main both
hidden; on the phone layout only the tab bar is left). Translate was ruled out (no `translated-*` class, 0 `<font>`). **Tal confirmed:** turning the ad blocker off for the site
makes the panel appear — the fix must make it work **with the blocker on**.
Do:
- Rename every `ad-*` class (`ad-main`, `ad-top`, `ad-body`, `ad-side`, and any other) to a neutral prefix, e.g.
  `ops-*`, in TSX, CSS and tests; keep `id="admin-main"` only if it doesn't match a list rule (check).
- New guard **`test:adblock`** (built app, own DB, in `guards.yml`): a vendored snapshot of EasyList's generic cosmetic
  selectors (`##…` lines without a domain) in `scripts/fixtures/easylist-generic.txt` (+ a script to refresh it, run by
  hand) is injected into the page on Home, Shopping, Settings, Inbox, onboarding and every `/admin` tab (computer +
  phone). Fail if any app element is matched (`document.querySelectorAll(selector)` per rule, report rule + element).
  The quick text check also greps class names against the snapshot.
- Keep the app-wide `translate="no"` + `<meta name="google" content="notranslate">` (decided; not the cause here, but
  machine translation breaks React the same silent way).
Acceptance: `test:adblock` green; on prod after deploy Tal's PC (ad blocker on) shows the admin panel in both layouts;
Open lists the renamed classes and any other app selector the snapshot caught.

## Part Y — docs
- SPEC (device class + override), help topic (Display → Layout), CLAUDE.md map (`useDevice`, `phone:`/`desk:`, the
  allow-list), ENVIRONMENT.md log (`test:device`, phone contexts need a mobile UA).

## Open
