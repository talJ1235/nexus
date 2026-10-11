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
- Read open reports and the error log first (`node scripts/errors.mjs`) — X1 may already have a named cause there.

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
### X1. [ ] Find and fix the empty content area
Facts: Tal's PC (Chrome, Hebrew, dark, screen 2560×1305, page zoomed): the admin frame renders (tab bar, and the
**reports badge "3"**, which comes from the Live tab's own poll → JS runs and the server answers), but `#admin-main`
shows nothing — in the computer layout too. Planner reproduced the S5 build locally (1366 / 2560 / 1017×496 /
600×300, DPR 3.5, dark, he, reduced motion, installed-app mode): content always shows. Not reproduced = something only
on prod or in Tal's browser. Suspects, in order: (1) **Chrome's Translate** rewriting the Hebrew page (S5 found its
#418 signature on Tal's PC) — React can lose the tree with no console error; (2) prod data in Live (an event/person
row that renders nothing or zero height); (3) the crash boundary's fallback invisible in the dark admin theme.
Do: run `scripts/probe-admin.mjs` on prod at Tal's sizes (2544×1240 at 100 %, and 1017×496) with Translate-like DOM
edits; read the error log. **Decided by planner:** add `translate="no"` on `<html>` + `<meta name="google"
content="notranslate">` app-wide — Nexus has its own he/en switch and machine translation breaks React. Also make the
admin crash fallback and empty states visible in dark (contrast check). Acceptance: on prod after deploy the probe shows
Live content at both sizes; Open names the cause (or what was ruled out) and what Tal should check if it remains.

## Part Y — docs
- SPEC (device class + override), help topic (Display → Layout), CLAUDE.md map (`useDevice`, `phone:`/`desk:`, the
  allow-list), ENVIRONMENT.md log (`test:device`, phone contexts need a mobile UA).

## Open
