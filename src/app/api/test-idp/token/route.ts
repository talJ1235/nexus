import { enabled, notFound, read } from "@/lib/auth/test-idp";

// Test-only (allow-listed): exchanges the code for an access token (the same signed blob).
export async function POST(req: Request) {
  if (!enabled()) return notFound();
  const body = new URLSearchParams(await req.text());
  const code = body.get("code");
  if (!read(code)) return Response.json({ error: "invalid_grant" }, { status: 400 });
  return Response.json({ access_token: code, token_type: "Bearer", expires_in: 300 });
}
