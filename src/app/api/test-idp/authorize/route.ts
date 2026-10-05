import { enabled, issue, notFound } from "@/lib/auth/test-idp";

// Test-only (allow-listed). GET shows a tiny form; POST sends the browser back to the app with a code.
export async function GET(req: Request) {
  if (!enabled()) return notFound();
  const u = new URL(req.url);
  const keep = ["redirect_uri", "state"].map((k) => `<input type="hidden" name="${k}" value="${(u.searchParams.get(k) ?? "").replace(/"/g, "&quot;")}">`).join("");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Test IdP</title><form method="post">${keep}<label>Email <input id="email" name="email" value="${(u.searchParams.get("login_hint") ?? "").replace(/"/g, "")}"></label><label>Name <input id="name" name="name" value="Test User"></label><button id="go">Sign in</button></form>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(req: Request) {
  if (!enabled()) return notFound();
  const f = await req.formData();
  const redirect = new URL(String(f.get("redirect_uri") ?? ""));
  if (redirect.origin !== new URL(req.url).origin) return new Response("bad redirect", { status: 400 });
  redirect.searchParams.set("code", issue(String(f.get("email") ?? "").trim().toLowerCase(), String(f.get("name") ?? "Test User")));
  redirect.searchParams.set("state", String(f.get("state") ?? ""));
  return Response.redirect(redirect.toString(), 302);
}
