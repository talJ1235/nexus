// Print the app's open problem reports as markdown (Round 8 D3) — read them at the start of a fix round.
//   node scripts/reports.mjs [--all] [--base https://…]
// Needs REPORTS_TOKEN (env or .env.local; the same value as the deployment's REPORTS_TOKEN). Base: NEXUS_URL or prod.
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);
if (existsSync(".env.local"))
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^(REPORTS_TOKEN|NEXUS_URL)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
const token = process.env.REPORTS_TOKEN;
if (!token) {
  console.error("REPORTS_TOKEN is not set (env or .env.local). Set the same value on Vercel to enable the export.");
  process.exit(2);
}
const base = (arg("base") || process.env.NEXUS_URL || "https://nexus-ashen-beta.vercel.app").replace(/\/$/, "");
// The token goes in a header (the endpoint also accepts ?token=, but URLs end up in logs).
const res = await fetch(`${base}/api/reports/export${args.includes("--all") ? "?all=1" : ""}`, { headers: { authorization: `Bearer ${token}` } }).catch((e) => {
  console.error(`Could not reach ${base}: ${e.message}`);
  process.exit(1);
});
if (res.status === 404) {
  console.error(`${base}: the export is disabled (REPORTS_TOKEN not set on the deployment).`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`${base}: ${res.status} ${res.statusText}`);
  process.exit(1);
}
process.stdout.write(await res.text());
