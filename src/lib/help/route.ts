// Ask Nexus routing (Round 8 D2): a cheap keyword pass decides whether a question is about the user's DATA or about
// HOW TO USE the app. Clear cases go to one prompt; anything mixed or unclear goes to a prompt with both, where the
// model makes the call itself (same request, no extra round trip). Pure, unit-tested (scripts/test-help.ts).

export type AskRoute = "help" | "data" | "unsure";

const HELP_EN = [
  /\bhow (do|can|should) (i|you|we)\b/,
  /\bhow to\b/,
  /\bwhere (is|are|do|can|did)\b/,
  /\bcan i\b/,
  /\bis there (a|an) (way|setting|button|option)\b/,
  /\b(doesn'?t|does not|won'?t|isn'?t|is not|can'?t|cannot|not) (work|working|connect|connected|load|loading|show|showing|sync|open|install|installed|scan|read)\b/,
  /\bwhy (is|are|does|do|doesn'?t|isn'?t|can'?t|did)\b.*\b(missing|picture|image|photo|price|work|show|connect|load|empty|wrong|blank)\b/,
  /\b(extension|clipper|bookmarklet|settings?|palette|theme|dark mode|light mode|plum|graphite|language|hebrew|telegram|bot|install|pwa|home screen|offline|share|sharing|invite|backup|restore|import|barcode|camera|shopping mode|command menu|shortcut|notification|alerts?)\b/,
  /\b(bug|broken|crash|crashes|error|glitch|stuck|freez(e|es|ing)|feature request|idea|suggestion|complain|complaint)\b/,
];
const HELP_HE = [/איך/, /איפה/, /אפשר ל/, /יש דרך/, /לא (עובד|עובדת|מתחבר|מתחברת|נטען|מופיע|מופיעה|נפתח|סורק|מסנכרן)/, /תוסף/, /הגדרות/, /ערכת נושא/, /צבע/, /שפה/, /טלגרם/, /בוט/, /להתקין/, /התקנה/, /אופליין/, /בלי אינטרנט/, /לשתף/, /שיתוף/, /גיבוי/, /ייבוא/, /ברקוד/, /מצלמה/, /מצב קנייה/, /באג/, /תקלה/, /שגיאה/, /נתקע/, /קורס/, /רעיון/, /הצעה/, /תלונה/, /למה .*(תמונה|מחיר|ריק|חסר)/];

const DATA_EN = [
  /\bhow (much|many)\b/,
  /\b(total|totals|spent|spend|spending|budget|left to buy|cheapest|most expensive|priciest|sum|average|cost|costs|price drop|dropped)\b/,
  /\bwhat did i (buy|order|get)\b/,
  /\bwhich (items?|products?|stores?|orders?|projects?)\b/,
  /\b(my|the) (items|orders|projects?|lists?|purchases|parts)\b/,
  /\b(mark|move|set|tag|create)\b.*\b(as|to|into|priority|qty|quantity|project)\b/,
  /\b(urgent|ordered|arriving|overdue|unsorted)\b/,
];
const DATA_HE = [/כמה/, /סה"?כ|סך הכול/, /תקציב/, /הוצאתי/, /קניתי/, /הזמנתי/, /הכי (זול|יקר)/, /אילו (פריטים|מוצרים|חנויות|הזמנות)/, /מה נשאר/, /מה (קניתי|הזמנתי)/, /סמן|העבר/, /דחוף|בדרך/];

const COMPLAINT = [/\b(bug|broken|crash|crashes|glitch|feature request|complain|complaint|report)\b/i, /\b(doesn'?t|does not|won'?t|isn'?t|not) work(ing)?\b/i, /\bidea\b|\bsuggestion\b|it would be (nice|great)/i, /באג|תקלה|קורס|לא עובד|לא עובדת|תלונה|רעיון|הצעה|כדאי להוסיף/];

const hits = (q: string, res: RegExp[]) => res.reduce((n, re) => n + (re.test(q) ? 1 : 0), 0);

/**
 * Classify a question. `names`: the user's project/list names — a question naming one of them is about their data.
 * No signal either way → "unsure" (the model decides with both the data and the help in front of it).
 */
export function classifyQuestion(question: string, names: string[] = []): { route: AskRoute; complaint: boolean } {
  const q = question.toLowerCase().trim();
  const help = hits(q, HELP_EN) + hits(question, HELP_HE);
  let data = hits(q, DATA_EN) + hits(question, DATA_HE);
  if (names.some((n) => n.trim().length >= 3 && q.includes(n.trim().toLowerCase()))) data++;
  const complaint = COMPLAINT.some((re) => re.test(question));
  const route: AskRoute = help > 0 && data === 0 ? "help" : data > 0 && help === 0 ? "data" : "unsure";
  return { route, complaint };
}
