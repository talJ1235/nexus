// R15 B4: safeFetch refuses every address in SECURITY.md §6 — localhost, 127.1, 0x7f000001, [::1], 169.254.169.254,
// 10/8, 192.168/16, CGNAT, IPv4-mapped IPv6, a DNS name that resolves to a private IP (local resolver stub), and a
// public URL that redirects to a private one (a local test server stands in for the public host).
//   npx tsx --conditions=react-server scripts/test-ssrf.ts
import assert from "node:assert/strict";
import type { LookupAddress } from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { __setResolverForTests, __setTestAllow, BlockedUrlError, isBlockedIp, safeFetch } from "../src/lib/safe-fetch";

const refused = async (url: string) => {
  try {
    await safeFetch(url, { timeoutMs: 3000 });
    return false;
  } catch (e) {
    return e instanceof BlockedUrlError || /blocked_url/.test(String((e as Error)?.message));
  }
};

async function main() {
  // Literal addresses and names, before any connection.
  const literal = [
    "http://localhost/",
    "http://LOCALHOST./",
    "http://foo.localhost/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://0x7f000001/",
    "http://2130706433/",
    "http://0177.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[fd00:ec2::254]/",
    "http://metadata.google.internal/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://172.16.5.5/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://224.0.0.1/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "http://example.com:8080/",
    "http://user:pass@example.com/",
  ];
  for (const u of literal) assert.ok(await refused(u), `refused: ${u}`);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isBlockedIp(ip), false, `public ${ip} allowed`);

  // DNS: a name resolving to a private address (stub resolver) is refused at connect time.
  const table: Record<string, string> = { "evil.test": "127.0.0.1", "meta.test": "169.254.169.254", "lan.test": "192.168.0.10", "redirect.test": "127.0.0.2" };
  __setResolverForTests(((host: string, _o: unknown, cb: (e: Error | null, a: LookupAddress[]) => void) => {
    const ip = table[host];
    if (!ip) return cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), []);
    cb(null, [{ address: ip, family: ip.includes(":") ? 6 : 4 }]);
  }) as never);
  for (const h of ["evil.test", "meta.test", "lan.test"]) assert.ok(await refused(`http://${h}/`), `refused: ${h} (resolves private)`);

  // Redirects: a "public" server (allowed for this test only) that redirects to private targets → refused per hop.
  const targets = ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "http://[::1]/", "http://evil.test/", "http://localhost/admin"];
  const server = http.createServer((req, res) => {
    const i = Number(new URL(req.url ?? "/", "http://x").searchParams.get("t") ?? -1);
    if (i >= 0) {
      res.writeHead(302, { location: targets[i] });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("public ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.2", r));
  const port = String((server.address() as AddressInfo).port);
  __setTestAllow({ addresses: ["127.0.0.2"], ports: [port] });
  const okRes = await safeFetch(`http://redirect.test:${port}/`, { timeoutMs: 3000 });
  assert.equal(okRes.text, "public ok", "control: the allowed test server itself answers");
  for (let i = 0; i < targets.length; i++) assert.ok(await refused(`http://redirect.test:${port}/?t=${i}`), `redirect to ${targets[i]} refused`);
  server.close();
  __setTestAllow(null);
  __setResolverForTests(null);
  console.log(`OK ssrf: ${literal.length} literal URLs, 3 private DNS names, ${targets.length} redirect targets refused; public addresses allowed`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
