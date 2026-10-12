<!-- topic: Supermarket -->

## Supermarket (סופרמרקט) — what works today
<!-- spec: Round 18 — Session 1: supermarket data + engines (no new screens), One supermarket list per space, Trips, Evening-before draft -->
- The **Supermarket tab** (its own list, the store walk, Add by voice / paste) is being built. Until it ships,
  groceries stay in **Products → To buy** and **Shopping mode** works as before.
- Every **Shopping mode** trip is now remembered: when it started, the store, what you checked and in which order.
  Nothing changes on your list because of this.
- After about 3 trips Nexus knows your usual shopping day. The evening before it (19:00–21:00, never at night) one
  push may arrive: **"Your list for tomorrow: 18 items, Nexus suggests 4"** (הרשימה שלך למחר). It never adds, removes
  or changes anything — tapping it opens your list. To stop it, turn notifications off in **Settings → Notifications**
  (a separate switch comes with the Supermarket tab).
- In a store with no signal your checks wait on the phone and are sent when you're back online.

## Coming with the Supermarket tab
<!-- spec: Sections, Product dictionary + classify, Learned walking order, Staples + "Build my list" engine, Fast add, Offline + live in the store -->
- The list in **sections** in the order Israeli stores are laid out (produce first, bread and dairy at the back,
  frozen last). Each product finds its section by itself, in Hebrew or English.
- Nexus learns the order **your branch** is walked in and asks before using it ("use this order?") — never on its own.
- **Nexus suggests**: what's due ("every ~9 days"), Shabbat and holiday items, "usually with pasta". Suggestions never
  change your list until you accept them; "Not now" hides one until next time.
- Fast add: type "2 חלב 3%" (quantity + product), kg / g / L, paste a list from WhatsApp, or say it; a product already
  on the list grows ("now ×3", with Undo) instead of appearing twice.
- In the store: every check, quantity and price waits on the phone without signal and merges when you're back (a note
  someone else edited meanwhile is kept); in a shared space, what others add while you shop shows up live with one
  push — **"Noa added milk"** — at most one every 10 minutes.
