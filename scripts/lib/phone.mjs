// R17 S7 W3 — a phone test context is a phone by every signal the app reads (src/lib/device.ts): touch, a mobile
// viewport and a mobile UA (UA-CH `mobile` follows it). A bare 390 px window is a narrow computer now, not a phone.
export const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
export const PHONE = { isMobile: true, hasTouch: true, userAgent: PHONE_UA };
