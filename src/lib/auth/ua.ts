// A user agent → "Chrome on Windows" (Settings → Security). Pure; nothing about the UA is stored beyond the session row.
export type DeviceInfo = { browser: string | null; os: string | null; kind: "phone" | "tablet" | "desktop"; app: boolean };

export function describeUa(ua: string | null | undefined): DeviceInfo {
  const u = ua ?? "";
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Mac OS X|Macintosh/.test(u) ? "macOS" : /Windows/.test(u) ? "Windows" : /CrOS/.test(u) ? "ChromeOS" : /Linux/.test(u) ? "Linux" : null;
  const browser = /Edg\//.test(u) ? "Edge" : /SamsungBrowser/.test(u) ? "Samsung Internet" : /OPR\//.test(u) ? "Opera" : /Firefox\//.test(u) ? "Firefox" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : null;
  const kind = /iPad|Tablet/.test(u) ? "tablet" : /iPhone|Android.*Mobile|Mobile/.test(u) ? "phone" : "desktop";
  return { browser, os, kind, app: /wv\)|; wv/.test(u) };
}
