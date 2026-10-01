# Round 9 brief (from Tal, 2026-10-01 evening) — phone polish, assistant memory, projects — source of truth

Tal's feedback after using Round 8 on his phone. The receipt fix "works great" — don't touch Part A of Round 8
except to keep it green. One **unattended** run, same rules as Round 7/8 "How to run": branch **`round9`** from
`main`, commit per item `R9.<part><n>: …`, push the branch after each part, never stop to ask (decisions → "## Open"),
merge to `main` with `--ff-only` only when everything is green, don't touch power settings. Read open reports first
(CLAUDE.md). Verify every visual item on phone (360/390) and desktop (1366), light + dark, Graphite + Plum.

---

## Part A — phone shell

### A1. [x] Settings within reach on the phone
Today there's no visible way into Settings on the phone. Add a clear entry: the avatar/"T" button at the start of the
phone top bar (or a gear in the top bar if that reads better — decide by screenshot) opens a phone "Me" sheet:
Settings, Palette + Theme quick switch, Reports, Extension status, Telegram, Export, Log out. 44 px targets.

### A2. [x] Dock order and a dock that never moves
- New order, **physically left → right in every language (decided by Tal: do NOT mirror in Hebrew/RTL)**:
  **To buy · On the way · + · Projects · Stats**. Implement with `dir="ltr"` on the dock's container (labels inside
  keep their own direction), and add a smoke check that the order is the same in `en` and `he`.
- The dock must stay perfectly still when switching sections (today it "jumps down" e.g. On the way → Projects).
  Find the cause (dock inside the animated/transformed view container, a `transform` on an ancestor making
  `position: fixed` relative to it, height changes / `100vh` vs `dvh`, scrollbar or safe-area changes, the view
  transition snapshotting it). Fix: dock rendered outside the view transition (portal at the shell root),
  `position: fixed` with `bottom: env(safe-area-inset-bottom)`, no ancestor transforms, view transitions animate only
  the content area. Also the top bar.
- Smoke guard: switch through all five dock targets and sample the dock's bounding box every animation frame during
  each switch; any change > 0.5 px fails.

### A3. [x] "+" menu: tell the options apart without reading
Today the four options look the same (same tile, same icon box). Make each one instantly recognizable by colour,
shape and illustration while staying inside the theme:
- Layout: a 2 × 2 grid of large tiles (≈ 160 × 120) above the +, primary action (Paste a link) can be the wide tile
  if that reads better — decide by screenshot.
- Each tile gets its own soft colour wash + matching icon colour from a small fixed "action" set defined as tokens
  per theme (e.g. Barcode = amber, Receipt = violet, Link = blue, Plan with Nexus = the spark gradient), all muted to
  the palette's lightness band, readable in dark mode.
- Bigger, more illustrative icons (barcode with scan line, receipt with zigzag edge, link chain, sparkle + list), a
  subtle per-tile motif (e.g. the scan line animates once when the menu opens).
- Keep the open/close animation (staggered spring), order stays: Scan a barcode, Scan a receipt, Paste a link,
  Plan with Nexus.

---

## Part B — dark mode depth

### B1. [ ] Cards that stand out in dark mode
In dark mode the product cards (To buy, On the way, everywhere) and every surface of the same colour blend into the
background — it's unclear where a card ends. Without making it ugly:
- Raise the surface step: card surface a little lighter than bg (both palettes), 1 px outline at ~10–12 % white,
  a top inner highlight (`inset 0 1px 0 rgba(255,255,255,.06)`), and a soft dark shadow; on hover/press a slightly
  stronger outline + lift. Optional faint glow of the palette's brand at very low alpha on hover only.
- Apply through tokens (`--surface`, `--line`, `--shadow-card`) so every card-like element follows (tiles, sheets,
  dock, menus, project cards, receipt review cards, shopping rows).
- Add to `scripts/contrast.mjs`: card vs bg must differ by a minimum luminance step in all four themes; outline
  visible (≥ 1.3:1 vs bg).

---

## Part C — assistant: one chat, history, memory

### C1. [ ] One chat with a mode switch (no separate Plan tab)
Merge "Ask" and "Plan a project" into one conversation. Near the input: a mode switch like the "thinking" toggles in AI
apps — **Chat** / **Plan a project** (pill toggle with icons). Plan mode turns the next message into a plan request
(same planner as today) and the plan appears in the chat as a rich card (parts, quantities, estimates, budget fit,
"Add all to project…", per-line add). The rest of the chat continues normally. Remove the separate planner panel/tab;
entry points that opened it ("Plan with Nexus" in the + menu, project page) open the chat in Plan mode.

### C2. [ ] Conversation history
- Conversations are saved (new tables `conversations` + `conversation_messages`, idempotent migration, included in
  backup; owner only). Each has an auto title (made by the model after the first answer, editable), created/updated
  time, mode(s) used, linked items/reports.
- History list: a drawer in the assistant (phone: full-screen list; desktop: inside the side panel) with search
  (title + text), grouped by Today / This week / Earlier; open → continue; rename; delete (with undo).
- "New chat" button; the assistant reopens the last conversation if it's less than ~2 h old, otherwise a new one.
- The model gets the current conversation; it can also be asked "how did I fix X last time?" — search past
  conversations (simple text search over titles + messages, top few snippets into context).

### C3. [ ] Nexus learns Tal's habits (memory)
- A **shopping profile** computed from data (deterministic, refreshed daily and on demand): favourite stores (by
  count/spend, last 6 months), typical categories, price ranges per category, brands, shipping/threshold habits,
  usual project types, typical order size, preferred currency. Stored in kv.
- **Learned notes**: when the user states a preference in chat ("I always order electronics from AliExpress",
  "I prefer Wera tools"), the assistant proposes to remember it (small confirm chip, like actions). Notes stored in a
  `memories` table; never stores sensitive personal data.
- Settings → "What Nexus knows about you": the computed profile (read-only) + the notes (edit/delete), and a switch to
  turn memory off.
- Used by: Ask answers (context), Plan mode (prefer his stores, his brands, his price range; say which store per line),
  compare (rank his usual stores first when prices tie), suggestions (C4).

### C4. [ ] Suggestions that follow history
Suggested questions and follow-ups use: recent conversations (don't repeat what was just asked; offer the natural next
step), the profile (e.g. "Plan the next Railcam stage at AliExpress"), and current data (as today). After a **help**
answer, follow-ups are help-related (Round 8 left this as data questions). Unit test the ranking.

---

## Part D — Report a problem, simpler

### D1. [ ] One simple form
Keep the type switch (Bug / Complaint / Idea — Tal liked it). Replace title / what happened / steps with **one text
box** ("Tell us what happened"), an optional second box only for Bug ("What did you expect?"), and an "Add a
screenshot" button (file/photo picker). The assistant-drafted path fills the same simple form.
Collect automatically, as much as is useful without touching privacy: everything from Round 8 D3 plus the last 10
navigation steps (view names only), the visible view's item count, network status, recent failed requests (URL path +
status only), extension + service-worker version, memory/perf hints (device memory, connection type), and the last
assistant exchange. Show a collapsed "Included automatically" list so the user sees what's sent. No personal data,
no item prices unless the user typed them.

---

## Part E — projects that feel like projects

### E1. [ ] Projects page redesign
A project is something big — cards should feel substantial, colourful and friendly (still inside the theme):
- Large cards (phone: full width ~180 px tall; desktop: 2–3 columns): a **cover** = the project's colour as a soft
  gradient wash with a collage of 3–4 of its item images (rounded, slightly overlapping), project name (bold, large),
  short line (items left · next to buy), budget ring with % and amount left, progress bar bought vs total, small
  avatars/flags (urgent count, on the way count).
- Project colours may be more present here than elsewhere (cover wash only), using the muted set from Round 7 at a
  slightly higher saturation; text stays on neutral surface for contrast.
- "New project" card with a dashed outline and a friendly empty state.
- Tap → project page with a matching header (cover, ring, numbers, "Plan with Nexus" in Plan mode, "Shop this
  project" → shopping mode).
- Motion: cards rise in staggered; the cover collage shifts slightly on hover/press; card → project page shared-
  element transition of the cover.

---

## Part F — small leftovers from Round 8
### F1. [ ] Export to Excel button
SPEC lists "Export collection to Excel" but there's no button (endpoint `/api/export` exists). Add it to the project
page menu, list menu and the command menu; update the help file.

---

## Open
