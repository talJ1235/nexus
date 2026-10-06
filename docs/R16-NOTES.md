# Round 16 input — Tal's notes after the R15 release (2026-10-06)

Raw input for the next planning chat. Tal tested prod after the R15 release (signed in with Google, created the shared
space "Jacoby Home", PC + phone) and dictated these notes in Hebrew. Each line keeps his intent; `[type]` = bug / UX /
feature; "guess" = planner's first idea, **not verified in code yet**. The planning chat turns this into
`docs/ROUND16.md` (and mockups for the visual items) — this file is not a brief.

## A. Shared spaces — live sync (Tal: "very, very important")
1. [feature] Changes in a shared space must reach the other members **immediately** (e.g. A moves items to another
   category; B sees it only after refreshing). Goal: users don't feel any delay.
2. [feature] Concurrent edits: if B tries to change data A has just changed, B gets a clear error ("already changed by
   A") instead of silently overwriting. → optimistic concurrency (row version) + live updates.
   Guess: Vercel Hobby has no websockets; options to research = a hosted realtime service (free tier), SSE, or short
   polling of a per-space change counter. Was already planned as R16 "live list"; presence (green dots, "X added 3
   items") from the R15 boards fits here.

## B. Bugs found on the PC
3. [bug] Receipt scan → items land in History (Received) with prices. Moving them to To buy (or another status) **wipes
   their prices**. Guess: status change clears paid price / price fields.
4. [bug] Opening "scan receipt" again shows the previous receipt (re-shuffled) and won't accept a new one until a page
   refresh. Guess: scanner state not reset on open/close.
5. [bug] Desktop quick actions (scan receipt, scan barcode, …) show only when the space is empty; after adding items
   they're gone. Phone has them always. Should be available on desktop too.
6. [bug] Selection bar → "Move to" shows only "Remove from project" (no lists/projects/statuses). Guess: the target list
   isn't scoped/loaded since R15 spaces.
7. [bug] Selection bar menus overlap: with "Move to" open, clicking "Priority" opens a second menu on top. Only one menu
   open at a time.
8. [UX] List view (desktop) always shows the selection checkbox next to the picture, as if in select mode — looks
   unprofessional. Show it only on hover / in select mode.
9. [bug] Switching spaces: the left sidebar jumps up, is cut off, then snaps back. Must be smooth; the switch itself
   should feel seamless but still noticeable.
10. [bug] A pasted link failed to get price and/or picture — find out why (needs the failing URL from Tal / the error log
    in item 13).

## C. Bugs / UX on the phone
11. [bug] After sign-in the app first rendered at **desktop size**; a refresh fixed it. Guess: first render after the
    auth redirect lacks the phone layout hint (cookie/viewport).
12. [UX] Sign-in screen: big empty gap between the Google button and the bottom links — centre the content (also on
    "sign in again"). Brand panel cubes are too big / cropped on PC and phone (planner saw the crop at 1280×720 too).
    Note: Tal's Windows has animation effects off → `prefers-reduced-motion`, so the panel shows a still frame by design.
13. [UX] The Nexus logo/wordmark in the phone top bar got smaller next to the new space switcher; make it big again
    (it's the "go home" button).
14. [bug] The "+" sheet opens smoothly but stutters when closing.

## D. Error reporting (Tal: "strong security")
15. [feature] When the system fails at something (e.g. adding a product from a link), the user can report it in one tap.
16. [feature] Failures are also **logged and reported automatically**, so we can fix them without users reporting.
    Must be protected against spam/abuse (rate limits, dedupe, size caps, no user content beyond what's needed) so it
    can't take the system down. Fits the R16 admin panel ("all reports").

## E. Settings and screens (look & structure)
17. [UX] Settings on desktop: not a small window in the middle with everything on one page — a large, structured screen
    split into sections (side nav), clear, not confusing, professional.
18. [UX] Space settings: also a bigger screen, **no scrolling**; split into sections if needed, otherwise just enlarge.
19. [UX] Phone: Settings, Space settings and every full-screen overlay split into sections so the user doesn't scroll
    through everything (bottom sheets that cover part of the screen are fine as they are).
20. [UX] Switching spaces: an interstitial "You're now in Jacoby Home / Personal" with a cool, smooth transition
    animation, and **always land on Home** after a switch.
21. [feature] Space identity editor as on the R15 canvas (`CreateSpace` boards): pick icon/colour etc., not only the
    first letter — plus **upload a photo** with crop/zoom like a WhatsApp group picture. Tal couldn't find any way to
    edit the space look today (R15 shipped letter tiles only).

## F. Home
22. [feature] Home customisation: keep the current hide/reorder, add **presets** (recommended orders and layouts) and
    **sizes per widget** (e.g. Nexus suggests wide; On the way etc. can be small). Think about **more indicators** for
    Home. Must feel natural and smooth, never amateurish.
23. [UX] Nexus suggests: on the phone the only way to move between suggestions is the tiny dots/arrows → add swipe
    left/right; on desktop add drag, keep arrows + dots.

## G. Admin and usage (Tal: next round or later, but important)
24. [feature] User management + usage data: who signed in, when, how often, which features are used, errors met —
    **without** seeing their content (no item, space or project names). Was already planned for R16 (admin panel:
    users + invites, AI usage, all reports, metrics). Privacy rule: aggregate/usage only.

## H. Open from R15
- One app report from before R15: "price drop and the AI didn't recognise it" (assistant context).
- R15 release: Tal signed in with Google on PC + phone and created a shared space; the GitHub prod smoke result and
  the rest of the Part G checks weren't reported in chat — the builder records them in `docs/ROUND15.md` "## Open".
