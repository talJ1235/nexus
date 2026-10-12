// R17 S7 W1 — the device class: phone | computer, decided once per page load by real signals, never by the window's
// width (browser zoom divides the CSS width — a 2544 px window at 250 % is 1017 px — and turned a PC into the phone UI).
//   server (first guess, so SSR paints the right layout): `Sec-CH-UA-Mobile: ?1`, else a mobile UA;
//   client (boot script, before first paint): UA-CH `mobile` / the UA, or a coarse primary pointer with no hover on a
//   screen whose short side is < 600 (tablets and touchscreen laptops → computer).
// Written once as <html data-device> + the `nexus_device` cookie (`auto.phone` / `auto.computer`, so the next SSR
// matches; `phone` / `computer` = the person's override in Settings → Display → Layout). No permission prompt, nothing
// stored server-side.

export type Device = "phone" | "computer";
export type DevicePref = "auto" | Device;

export const DEVICE_COOKIE = "nexus_device";
// iPads (and Android tablets — no "Mobile") say "Mobile" too: excluded, they get the computer UI.
const MOBILE_UA = /iPhone|iPod|Android.+Mobile|^(?!.*(?:iPad|Tablet)).*Mobi/i;

type Headers = { get(name: string): string | null };

/** The server's first guess from the request (Chromium sends Sec-CH-UA-Mobile by default; Safari / Firefox: the UA). */
export function guessDevice(h: Headers): Device {
  return h.get("sec-ch-ua-mobile") === "?1" || MOBILE_UA.test(h.get("user-agent") ?? "") ? "phone" : "computer";
}

/** The cookie: the override wins, then the client's last detection, then the server's guess. */
export function deviceFrom(cookie: string | undefined, h: Headers): Device {
  if (cookie === "phone" || cookie === "computer") return cookie;
  if (cookie === "auto.phone") return "phone";
  if (cookie === "auto.computer") return "computer";
  return guessDevice(h);
}

export function prefFrom(cookie: string | undefined): DevicePref {
  return cookie === "phone" || cookie === "computer" ? cookie : "auto";
}

/** Inline, first thing in <body> (before first paint): decide, write <html data-device> + the cookie. Same rules as
 * guessDevice plus the client-only signals. `screen.width/height` aren't scaled by page zoom in Chromium; Firefox scales
 * them, but they only count together with a coarse, hover-less primary pointer, which a desktop never has. */
export const DEVICE_SCRIPT = `(function(){var d=document.documentElement;try{var c=(document.cookie.match(/(?:^|; )${DEVICE_COOKIE}=([^;]*)/)||[])[1]||"",v;if(c==="phone"||c==="computer")v=c;else{var n=navigator,u=n.userAgentData,m=(u&&u.mobile===true)||${MOBILE_UA}.test(n.userAgent),k=matchMedia("(pointer: coarse) and (hover: none)").matches,s=Math.min(screen.width,screen.height);v=m||(k&&s>0&&s<600)?"phone":"computer";if(c!=="auto."+v)document.cookie="${DEVICE_COOKIE}=auto."+v+"; path=/; max-age=31536000; samesite=lax"}d.setAttribute("data-device",v)}catch(e){}})()`;

/** Settings → Display → Layout: the override (or back to automatic — the boot script decides again on reload). */
export function deviceCookie(pref: DevicePref): string {
  return pref === "auto" ? `${DEVICE_COOKIE}=; path=/; max-age=0; samesite=lax` : `${DEVICE_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`;
}
