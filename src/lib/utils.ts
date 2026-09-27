import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isHttpUrl(s: string) {
  try {
    const u = new URL(s.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Pull all http(s) URLs out of free text (paste, share-target text, etc). */
export function extractUrls(text: string) {
  const found = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const cleaned = found.map((u) => u.replace(/[),.;!?\]]+$/, ""));
  return Array.from(new Set(cleaned)).filter(isHttpUrl);
}

/** Block obvious internal targets before the server fetches a user-supplied URL. */
export function isPublicHttpUrl(s: string) {
  if (!isHttpUrl(s)) return false;
  const host = new URL(s).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host) || host === "::") return false;
  return true;
}
