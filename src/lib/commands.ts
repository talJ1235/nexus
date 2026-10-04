// One command list for the desktop command menu and the phone search (Round 13 C1): word-aware matching, pure.

/**
 * Word-aware matching: every typed word must appear; when each starts a word ("sett" → "Open settings") it scores 1,
 * a match inside a word scores 0.5, no match 0. Case-insensitive, works for Hebrew (no letter case) the same way.
 */
export function matchScore(value: string, search: string) {
  const q = search.toLowerCase().trim();
  if (!q) return 1;
  const v = value.toLowerCase();
  const words = q.split(/\s+/);
  if (!words.every((w) => v.includes(w))) return 0;
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Hebrew prefixes (ה/ב/ל/ו/מ/ש/כ) glue to the word: "בחשמל" still starts the word "חשמל".
  const wordStarts = words.every((w) => new RegExp(`(^|[\\s/,.:·()\\-])([הבלומשכ]{0,2})${esc(w)}`).test(v));
  return wordStarts ? 1 : 0.5;
}

export type CommandGroup = "actions" | "settings" | "views";
/** An inline control the phone search can show in place (theme / palette / currency segmented, language, a switch). */
export type CommandControl = "theme" | "palette" | "currency" | "language" | "ai";

export type AppCommand = {
  id: string;
  group: CommandGroup;
  label: string;
  /** Extra words it should be found by (both languages where useful). */
  keywords: string;
  icon: React.ReactNode;
  run: () => void;
  /** The current value (✓ in the menu). */
  active?: boolean;
  control?: CommandControl;
  /** data-* attribute for tests. */
  testId?: string;
};

/** Matching commands, best first (stable within the same score). */
export function matchCommands(cmds: AppCommand[], search: string) {
  return cmds
    .map((c, k) => ({ c, k, s: matchScore(`${c.label} ${c.keywords}`, search) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.k - b.k)
    .map((x) => x.c);
}
