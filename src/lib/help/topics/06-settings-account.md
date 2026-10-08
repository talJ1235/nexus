<!-- topic: Settings and account -->

## Accounts and sign-in
<!-- spec: Sign-in, Google sign-in, Invite-only sign-up, Settings → Security -->
- Sign in with **Google** (התחברות עם Google). Nexus is invite-only for now: a new account needs an invite code from Tal
  or an invite link to a space; without one you can leave your email on the waitlist. A failed sign-in says why, with
  **Try again** (נסו שוב).
- On Android (Chrome and the installed app) **Sign in with Google** opens Google's own sheet at the bottom of the
  screen: tap your account and you're in, no page change. For a different account use **Use another Google account**
  (חשבון Google אחר) under the button. Closing the sheet keeps you on the sign-in page; on iPhone and computers
  Google's page opens as before.
- **Settings → Account & security** (חשבון ואבטחה): your name, a security checkup, sign-in methods (Google,
  passkeys), devices (sign one out, or all the others; a new sign-in to review is at the top — "No, sign it out" ends
  it), and Activity & recovery. **Confirm it's you** (sign in again) is asked before removing someone, transferring
  ownership, deleting a space or changing passkeys. Tal (admin): Account → **Invite codes**.

## Look and language
<!-- spec: Design system, Box logo, Mixed Hebrew/English text, Dark mode depth, One picture style, Solid tags, Ask button, Card borders, Sidebar v4, Phone shell v4, Calmer light theme -->
- Settings → **Display** (תצוגה): theme Light / Dark / Match device, colour **Graphite** (default) or **Plum** (שזיף),
  language (English / עברית, full right-to-left), currency, Motion (Match device / Reduced). Per device, instant.
  **Reduced** keeps soft fades (sheets and menus fade in and out) but nothing moves or slides.
<!-- spec: Polish fixes -->
- In Settings, tapping anywhere on a row with a switch flips the switch.
- A very big amount may be shortened (e.g. ₪62.2B) when it doesn't fit; hover it (computer) or long-press it (phone)
  for the exact figure.
- Pictures share one style; "Ask Nexus" is always a rounded pill; mixed Hebrew/English titles keep their direction.

## Settings
<!-- spec: Settings, Notifications -->
- Desktop: a large window — sections on the side (You, then the current space), search with `/`, Esc closes. Phone: a
  list of sections, each opens as its own page (Back returns). Each section has an address (e.g. /settings/display)
  and a command-menu entry ("Settings: Budget").
- **Notifications** (התראות) is one switch in **Account & security**: On (default) — Nexus decides what to tell you and
  when (a price drop, a delivery, the budget at 80 %, someone's changes in a shared space); Off — nothing is sent, but
  the bell (alerts) still keeps everything. There are no per-kind settings; phone notifications are coming soon.
- **Assistant & AI**: AI + rules or Rules only for "Nexus suggests"; Memory; the AI status. **Calendar**: the feed
  link and which kinds it carries. **Data**: back up / restore (owner), import a spreadsheet or receipts, export items.

## Offline and the phone app
<!-- spec: Offline, read-only v1, First load, Loading skeletons, Opening, Opening v4 -->
- The opening (3 s) plays the first time you open Nexus each day, on the phone and on the computer. Every other open,
  reload or back/forward shows only a small Box mark. On the phone, pull down at the top of a page to reload.
  While a page loads, its outline (cards, store groups, project header) shows in place.
- Install: in the phone browser menu → "Add to Home screen" (Chrome) / Share → "Add to Home Screen" (Safari).
- **Offline**: after one online visit the app opens without a connection and shows "Offline — showing data from
  <time>". It's read-only offline (adding/editing is disabled); shopping mode trips sync later. Back online it
  refreshes by itself.
- Logging out clears the offline copy.
