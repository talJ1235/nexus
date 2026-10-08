// R17 E3 — /privacy and /terms (English + Hebrew). Plain language, short. Written from MULTIUSER.md §4.9 and the notice
// items of Israel's Privacy Protection Law (incl. Amendment 13). Not legal advice: Tal has it reviewed before the public
// launch (docs/ROUND17.md Open). The contact address is a placeholder until Tal creates it.

export const PRIVACY_CONTACT = "privacy@… (address coming soon)";
export const LEGAL_UPDATED = "2026-10-08";

type Section = { h: string; p: string[] };
type Doc = { title: string; intro: string; sections: Section[]; updated: string; back: string };

const en = {
  privacy: {
    title: "Privacy",
    intro: "Nexus is a shopping and household list app, invite-only for now. This page says what it keeps about you, why, who else handles it, and how to get it or delete it.",
    updated: "Last updated",
    back: "Back",
    sections: [
      { h: "Who runs Nexus", p: [`Nexus is run by Tal Jacoby, a private developer in Israel. Questions, requests and complaints: ${PRIVACY_CONTACT}.`] },
      {
        h: "What we keep, and why",
        p: [
          "Your account: your name, email address and profile picture from Google — to sign you in and to show other members of a shared space who you are.",
          "What you put in: items, links, prices, lists and projects, receipts and photos you upload, notes, your chats with the assistant and the notes it remembers (only when Memory is on). This is the app — it's kept so you can use it.",
          "Security: your sign-in sessions and devices (browser, operating system, an approximate city from the network address, times) and a security log (sign-ins, sign-outs, passkey changes) — to show you your devices and to spot sign-ins that weren't you.",
          "When something fails, an error log keeps a short technical note with emails, names and links' query strings removed; people are counted through one-way hashes, never named. AI usage is counted per person (which feature, when, did it work) — not what was asked.",
        ],
      },
      {
        h: "Google sign-in",
        p: [
          "Signing in with Google gives Nexus your name, email address and picture — nothing else from your Google account. The sign-in page loads Google's sign-in script (for the account sheet on Android), so Google can see that the page was opened.",
        ],
      },
      {
        h: "AI",
        p: [
          "Some features send text to an AI provider: reading a product page, short product names, the assistant, receipts, Home suggestions. Before anything is sent, your name, email, the space's and members' names and anything that looks like a phone number are taken out.",
          "Providers: Google (Gemini) and, as fallbacks, Groq and OpenRouter. Nexus uses their free tiers, whose terms allow the provider to use what is sent to improve their models. If you'd rather not, choose Settings → Assistant & AI → Rules only: then nothing of yours goes to an AI provider.",
        ],
      },
      {
        h: "Who else handles your data",
        p: [
          "Vercel (hosting and file storage), Turso (the database), Resend (sign-in and recovery emails), Ably (live updates between members of a shared space), Google (sign-in and AI), Groq and OpenRouter (AI fallbacks), and Cloudflare when it is used to read store pages that block Nexus. They process data only to run their service for Nexus. Some are outside Israel (mostly in the US and the EU).",
        ],
      },
      {
        h: "How long it's kept",
        p: [
          "Your content: until you delete it or your account. Sessions end after at most 90 days; the security log keeps 90 days; the error log 30 days; backups up to 30 days. A deleted account is gone for good 7 days after you ask (you can undo within those days).",
        ],
      },
      {
        h: "Your rights",
        p: [
          "You can see and download your data (Settings → Account → Download my data), correct it in the app, and delete your account (Settings → Account → Delete account). You can also write to the contact address above; we answer within 30 days. You may also complain to Israel's Privacy Protection Authority.",
        ],
      },
      {
        h: "Deleting your account",
        p: [
          "Delete account signs you out everywhere and hides your account at once. For 7 days, signing in again offers to restore it. After that your personal space, its files, your chats and memory, and your account are deleted. Items you added to spaces shared with others stay there, shown as added by \"Former member\". If you're the only owner of a shared space with other members, you first transfer it or delete it.",
        ],
      },
      { h: "Cookies", p: ["Only the cookies the app needs: your sign-in session, language, theme and current space. No advertising or analytics cookies, no trackers."] },
      { h: "Changes", p: ["If this page changes in a way that matters, the app tells you before it applies."] },
    ],
  } satisfies Doc,
  terms: {
    title: "Terms",
    intro: "Using Nexus means agreeing to these terms. They're short on purpose.",
    updated: "Last updated",
    back: "Back",
    sections: [
      { h: "The service", p: ["Nexus helps you and the people you share a space with keep shopping lists, projects, prices and deliveries. It's invite-only and free for now, and it's provided as it is — features can change or stop."] },
      { h: "Your account", p: ["Keep your sign-in to yourself. You're responsible for what's done in your account and in the spaces you own. You can delete your account at any time (Settings → Account)."] },
      { h: "Your content", p: ["What you add stays yours. You let Nexus store and process it only to run the app for you and for the members of the spaces you share it with."] },
      { h: "Prices, stores and AI", p: ["Prices, pictures and names are read from stores and may be wrong or out of date — check the store before you buy. AI suggestions and answers can be mistaken; the assistant only changes things after you confirm."] },
      { h: "Fair use", p: ["Don't use Nexus to break the law, to reach other people's data, to overload it, or to read stores in ways they forbid. Accounts that do may be closed."] },
      { h: "Liability", p: ["To the extent the law allows, Nexus is not liable for indirect losses, lost data or purchase decisions made with it."] },
      { h: "Law", p: [`Israeli law applies; the courts of Tel Aviv-Yafo have jurisdiction. Questions: ${PRIVACY_CONTACT}.`] },
    ],
  } satisfies Doc,
};

const he: typeof en = {
  privacy: {
    title: "פרטיות",
    intro: "Nexus היא אפליקציה לרשימות קניות ולמשק הבית, בינתיים בהזמנה בלבד. כאן כתוב מה נשמר עליך, למה, מי עוד מטפל במידע, ואיך לקבל אותו או למחוק אותו.",
    updated: "עודכן לאחרונה",
    back: "חזרה",
    sections: [
      { h: "מי מפעיל את Nexus", p: [`את Nexus מפעיל טל יעקבי, מפתח פרטי בישראל. שאלות, בקשות ותלונות: ${PRIVACY_CONTACT}.`] },
      {
        h: "מה נשמר ולמה",
        p: [
          "החשבון שלך: השם, כתובת המייל ותמונת הפרופיל מ-Google — כדי להכניס אותך ולהראות לחברי מרחב משותף מי את/ה.",
          "מה שמכניסים: פריטים, קישורים, מחירים, רשימות ופרויקטים, קבלות ותמונות שמעלים, הערות, השיחות עם העוזר והדברים שהוא זוכר (רק כשהזיכרון פועל). זו האפליקציה עצמה — זה נשמר כדי שאפשר יהיה להשתמש בה.",
          "אבטחה: הכניסות והמכשירים שלך (דפדפן, מערכת הפעלה, עיר משוערת לפי כתובת הרשת, זמנים) ויומן אבטחה (כניסות, יציאות, שינויי מפתחות גישה) — כדי להראות לך את המכשירים ולזהות כניסה שלא הייתה שלך.",
          "כשמשהו נכשל, יומן שגיאות שומר הערה טכנית קצרה בלי מיילים, שמות ופרמטרים של קישורים; אנשים נספרים דרך גיבוב חד-כיווני, אף פעם לא בשם. השימוש בבינה מלאכותית נספר לכל אדם (איזו יכולת, מתי, האם הצליח) — לא מה נשאל.",
        ],
      },
      {
        h: "כניסה עם Google",
        p: ["כניסה עם Google נותנת ל-Nexus את השם, המייל והתמונה — לא שום דבר אחר מחשבון ה-Google. דף הכניסה טוען את סקריפט הכניסה של Google (לחלון החשבונות באנדרואיד), כך ש-Google יכולה לדעת שהדף נפתח."],
      },
      {
        h: "בינה מלאכותית",
        p: [
          "חלק מהיכולות שולחות טקסט לספק בינה מלאכותית: קריאת דף מוצר, שמות קצרים למוצרים, העוזר, קבלות, הצעות בדף הבית. לפני שליחה מוסרים השם והמייל שלך, שמות המרחב והחברים בו, וכל מה שנראה כמו מספר טלפון.",
          "הספקים: Google (Gemini) ולגיבוי Groq ו-OpenRouter. Nexus משתמשת בשכבות החינמיות שלהם, שהתנאים שלהן מאפשרים לספק להשתמש במה שנשלח כדי לשפר את המודלים. אם לא מתאים לך, בחרו בהגדרות ← עוזר ובינה מלאכותית ← כללים בלבד: אז שום דבר שלך לא נשלח לספק בינה מלאכותית.",
        ],
      },
      {
        h: "מי עוד מטפל במידע",
        p: ["Vercel (אירוח ואחסון קבצים), Turso (מסד הנתונים), Resend (מיילים של כניסה ושחזור), Ably (עדכונים חיים בין חברי מרחב משותף), Google (כניסה ובינה מלאכותית), Groq ו-OpenRouter (גיבוי לבינה מלאכותית), ו-Cloudflare כשמשתמשים בה לקריאת דפי חנויות שחוסמות את Nexus. הם מעבדים מידע רק כדי להפעיל את השירות שלהם עבור Nexus. חלקם מחוץ לישראל (בעיקר בארה״ב ובאיחוד האירופי)."],
      },
      { h: "כמה זמן זה נשמר", p: ["התוכן שלך: עד שמוחקים אותו או את החשבון. כניסות מסתיימות אחרי 90 יום לכל היותר; יומן האבטחה נשמר 90 יום; יומן השגיאות 30 יום; גיבויים עד 30 יום. חשבון שנמחק נעלם לגמרי 7 ימים אחרי הבקשה (אפשר לבטל בימים האלה)."] },
      { h: "הזכויות שלך", p: ["אפשר לראות ולהוריד את המידע (הגדרות ← חשבון ← הורדת המידע שלי), לתקן אותו באפליקציה ולמחוק את החשבון (הגדרות ← חשבון ← מחיקת חשבון). אפשר גם לכתוב לכתובת למעלה; נענה תוך 30 יום. אפשר גם להתלונן לרשות להגנת הפרטיות."] },
      { h: "מחיקת החשבון", p: ["מחיקת החשבון מוציאה אותך מכל המכשירים ומסתירה את החשבון מיד. במשך 7 ימים, כניסה מחדש מציעה לשחזר אותו. אחרי זה נמחקים המרחב האישי, הקבצים שלו, השיחות והזיכרון, והחשבון. פריטים שהוספת למרחבים משותפים עם אחרים נשארים שם, כ״נוסף על ידי חבר/ה לשעבר״. אם את/ה הבעלים היחיד/ה של מרחב משותף עם חברים נוספים, קודם מעבירים אותו או מוחקים אותו."] },
      { h: "עוגיות", p: ["רק העוגיות שהאפליקציה צריכה: הכניסה שלך, שפה, ערכת נושא והמרחב הנוכחי. בלי עוגיות פרסום או מדידה, בלי מעקב."] },
      { h: "שינויים", p: ["אם הדף הזה ישתנה במשהו שחשוב, האפליקציה תגיד לך לפני שזה חל."] },
    ],
  },
  terms: {
    title: "תנאי שימוש",
    intro: "שימוש ב-Nexus הוא הסכמה לתנאים האלה. הם קצרים בכוונה.",
    updated: "עודכן לאחרונה",
    back: "חזרה",
    sections: [
      { h: "השירות", p: ["Nexus עוזרת לך ולמי שאת/ה משתף/ת איתם מרחב לנהל רשימות קניות, פרויקטים, מחירים ומשלוחים. בינתיים היא בהזמנה בלבד וחינמית, והיא ניתנת כמו שהיא — יכולות יכולות להשתנות או להיפסק."] },
      { h: "החשבון שלך", p: ["שמרו את הכניסה לעצמכם. את/ה אחראי/ת למה שנעשה בחשבון ובמרחבים שבבעלותך. אפשר למחוק את החשבון בכל זמן (הגדרות ← חשבון)."] },
      { h: "התוכן שלך", p: ["מה שמוסיפים נשאר שלך. את/ה מאפשר/ת ל-Nexus לשמור ולעבד אותו רק כדי להפעיל את האפליקציה בשבילך ובשביל חברי המרחבים שאיתם את/ה משתף/ת."] },
      { h: "מחירים, חנויות ובינה מלאכותית", p: ["מחירים, תמונות ושמות נקראים מחנויות ויכולים להיות שגויים או ישנים — בדקו בחנות לפני קנייה. הצעות ותשובות של בינה מלאכותית יכולות לטעות; העוזר משנה דברים רק אחרי שאישרתם."] },
      { h: "שימוש הוגן", p: ["אין להשתמש ב-Nexus כדי לעבור על החוק, להגיע למידע של אחרים, להעמיס עליה, או לקרוא חנויות בדרכים שהן אוסרות. חשבון שעושה זאת עלול להיסגר."] },
      { h: "אחריות", p: ["ככל שהחוק מאפשר, Nexus לא אחראית לנזקים עקיפים, למידע שאבד או להחלטות קנייה שנעשו בעזרתה."] },
      { h: "דין", p: [`חל הדין הישראלי; לבתי המשפט בתל אביב-יפו הסמכות. שאלות: ${PRIVACY_CONTACT}.`] },
    ],
  },
};

export const legal = { en, he };
