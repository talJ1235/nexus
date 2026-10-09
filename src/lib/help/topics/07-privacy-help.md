<!-- topic: Assistant, privacy and problems -->

## The assistant (Ask Nexus)
<!-- spec: AI assistant, Assistant actions, Assistant v2, Assistant suggestions, Assistant, One chat, Conversation history, Memory, Smarter suggestions, AI gate, Privacy & terms, Help -->
- **AI limits and privacy**: each person has up to 40 AI uses a day (reading a link, a receipt, an assistant answer…);
  after that "AI is resting until tomorrow" and everything else keeps working. Settings → Assistant & AI → **Rules
  only** turns AI off for you everywhere. Names, emails and phone numbers are removed before anything goes to an AI
  provider. **Privacy** and **Terms**: links at the bottom of the sign-in page, in Settings → Account and in the Me
  sheet. **Download my data** (JSON / Excel) and **Delete account** (7 days to change your mind) are in Settings →
  Account; the page /delete-account explains it without signing in.
- Ask about your data ("how much is left for Railcam?") or how to use Nexus. Tap a suggested question to ask it.
- Ask it to change things ("mark the NEMA motors as ordered", "move these to a new project Drone"): it proposes the
  change and nothing happens until you press **Apply** (Undo after). It never deletes.
- **One chat, two modes**: under the chat box switch **Chat** / **Plan a project**. In Plan mode the next message is a
  project description → a parts list card in the chat (quantities, estimates, the store you'd usually buy from, budget
  fit) with **Add** per line and **Add all to…** a project. "Plan with Nexus" (+ menu, project page) opens Plan mode.
- **History**: the clock button in the assistant's header lists past conversations (search, rename, delete with
  Undo); the pencil starts a new chat. A conversation from the last 2 hours reopens by itself. You can ask "how did I
  … last time?" and Nexus looks through earlier conversations.
- **Memory** ("What Nexus knows about you", in Settings): Nexus works out your usual stores, categories, price ranges
  and brands from your purchases, and when you say something like "I prefer Wera tools" it offers to remember it
  (tap Remember). Notes can be edited or deleted there, and memory can be switched off. It never keeps personal data.
- **"AI busy" / no answer**: the free AI providers hit their limits; Nexus switches between Gemini, Groq and
  OpenRouter automatically. Wait a minute and ask again. Without any AI key the assistant is off.

## Report a problem
<!-- spec: Reports, Simpler reports, Report a failure, Error log -->
- From the assistant (it drafts the report when you say something is broken or have an idea), the command menu,
  Settings, or the phone's Me sheet: choose Bug / Complaint / Idea, write what happened in one box (for a bug also
  what you expected), optionally add a screenshot, Send. What's attached automatically is listed under "Included
  automatically" (screen, device, versions, recent errors — never personal data or prices).
- When something fails (a link, a picture search, a receipt, a barcode, an answer, an import), its error toast has
  **Report**: the form opens filled in; the link is attached (domain + path, can be unticked), a picture only if ticked.
- Your reports and their status: Settings → Account → Your reports, or the command menu.

## Common problems
- **A product is missing its picture or price** → the store blocked the server; wait for the daily check or set it by
  hand in the item sheet.
- **Can't see a list someone shared** → check you're in the right space (switcher); a viewer can look but not edit.
- **AI busy** → wait a minute; limits reset quickly. Receipts from photos need Gemini specifically.
- **Totals look wrong** → alternatives count only the winner/cheapest; someday items are left out of store orders;
  check the display currency.
- **Something is broken or you have an idea** → offer `[Report a problem](nexus:report)`.

## What the admin sees
<!-- spec: Admin panel -->
- The person who runs Nexus has an admin panel to keep it working: who is online, on a phone or a computer, which part
  of the app (for example Home, or the shopping list and how many items are left), and counts of what happened ("added
  3 items"). Never the content — not item names, notes, links, chats, memory or receipts. A problem report you send is
  read there.
- The admin can change your daily AI limit, sign you out, block an account that breaks the terms, or delete an account
  (it can be restored for 7 days by signing in again). Presence is kept 7 days, activity counts 30 days.
