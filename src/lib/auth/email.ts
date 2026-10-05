import "server-only";
import { appendFile } from "node:fs/promises";
import { APP_NAME } from "@/lib/brand";

// Recovery codes and sign-in notices (R15 A2). Live only with the domain + RESEND_API_KEY (full mode); without a key,
// off Vercel, mail lands in .auth-outbox.jsonl (gitignored) so the localhost tests can read the code.
export const OUTBOX_FILE = ".auth-outbox.jsonl";

export async function sendEmail(msg: { to: string; subject: string; text: string }) {
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || `${APP_NAME} <no-reply@${new URL(process.env.NEXT_PUBLIC_APP_URL || "https://example.com").host}>`, to: [msg.to], subject: msg.subject, text: msg.text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error("[email] send failed", res.status);
    return;
  }
  if (process.env.VERCEL) return;
  await appendFile(OUTBOX_FILE, JSON.stringify({ ...msg, at: Date.now() }) + "\n");
}

export function codeEmail(otp: string, locale: "en" | "he" = "en") {
  return locale === "he"
    ? { subject: `קוד הכניסה שלך ל-${APP_NAME}: ${otp}`, text: `הקוד שלך: ${otp}\nהוא תקף ל-10 דקות. אם לא ביקשת אותו, אפשר להתעלם מהמייל.` }
    : { subject: `Your ${APP_NAME} code: ${otp}`, text: `Your code: ${otp}\nIt works for 10 minutes. If you didn't ask for it, you can ignore this email.` };
}
