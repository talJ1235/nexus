import { enabled, notFound, read } from "@/lib/auth/test-idp";

// Test-only (allow-listed): who the token belongs to — always a verified email (like Google's email_verified).
export async function GET(req: Request) {
  if (!enabled()) return notFound();
  const who = read(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  if (!who) return Response.json({ error: "invalid_token" }, { status: 401 });
  return Response.json({ id: `test-${who.email}`, sub: `test-${who.email}`, email: who.email, email_verified: true, name: who.name });
}
