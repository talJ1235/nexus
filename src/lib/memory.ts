// Learned notes (Round 9 C3), pure: the guard that keeps sensitive personal data out of memory, and the
// ```nexus-memory block the assistant uses to propose a note. Unit-tested in scripts/test-memory.ts.

export const MEMORY_FENCE = "nexus-memory";
export const MAX_NOTE = 200;

const SENSITIVE: RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.]+/, // email
  /(?:\+?\d[\s-]?){7,}/, // phone / card / id numbers (7+ digits)
  /\b(password|passcode|pin code|cvv|iban|credit card|card number|social security|passport|id number)\b/i,
  /סיסמ|קוד סודי|כרטיס אשראי|מספר כרטיס|תעודת זהות|ת\.ז|דרכון|חשבון בנק/,
  /\b(address|street|apartment|zip code)\b|כתובת|רחוב|דירה מספר|מיקוד/i,
  /\b(diagnos|illness|disease|pregnan|medication|therapy|religio|political party|sexual)\w*/i,
  /מחלה|אבחנה|תרופ|הריון|טיפול פסיכו|דת |מפלגה/,
];

/** Notes may describe shopping habits and preferences only — never contact details, ids, money credentials, health. */
export function isSensitive(note: string): boolean {
  return SENSITIVE.some((re) => re.test(note));
}

/** Clean a proposed note: one line, trimmed, ≤ 200 chars; null when empty or sensitive. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
  if (n.length < 4 || isSensitive(n)) return null;
  return n;
}

/** Pull a proposed note out of an answer (```nexus-memory {"note": "…"}```). */
export function parseMemoryBlock(text: string): { text: string; note: string | null } {
  const re = new RegExp("```" + MEMORY_FENCE + "\\s*([\\s\\S]*?)```", "m");
  const m = text.match(re);
  if (!m) return { text, note: null };
  const rest = text.replace(m[0], "").trim();
  try {
    return { text: rest, note: cleanNote((JSON.parse(m[1]) as { note?: unknown }).note) };
  } catch {
    return { text: rest, note: null };
  }
}

/** Phrases that state a lasting preference (mock mode and a hint to the model). */
export const PREFERENCE = /\b(i (always|usually|never|prefer|only|like to)|i'd rather|from now on)\b|אני (תמיד|בדרך כלל|אף פעם|מעדיף|מעדיפה|רק)|מעכשיו/i;
