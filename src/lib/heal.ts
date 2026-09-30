import "server-only";

/**
 * Helper fetcher for links Vercel can't read. Some stores (AliExpress) rate-limit/challenge Vercel's IPs but
 * reliably answer link-preview requests from GitHub's runners. When a link comes in incomplete, we ask the
 * `heal` workflow (.github/workflows/heal.yml) to read it; it posts the page back to /api/heal.
 * Optional: does nothing unless GITHUB_DISPATCH_TOKEN is set (fine-grained PAT, this repo, Contents: read & write).
 */
export async function requestHeal(sources: { id: string; url: string }[]) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token || !sources.length) return false;
  const repo = process.env.GITHUB_REPO || "talJ1235/nexus";
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      signal: AbortSignal.timeout(4000),
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "nexus" },
      body: JSON.stringify({ event_type: "heal", client_payload: { sources: sources.slice(0, 20).map((s) => ({ id: s.id, url: s.url })) } }),
    });
    if (!res.ok) console.warn("[heal] dispatch failed:", res.status);
    return res.ok;
  } catch (e) {
    console.warn("[heal] dispatch error:", String(e).slice(0, 120));
    return false;
  }
}
