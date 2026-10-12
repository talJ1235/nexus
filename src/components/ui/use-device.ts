"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import type { Device } from "@/lib/device";
import { PHONE, useMedia } from "./use-media";

/** R17 S7 W2: the server's device class for this request (root layout → Providers) — the hydration snapshot. */
export const DeviceContext = createContext<Device>("computer");

const read = (): Device => (document.documentElement.getAttribute("data-device") === "phone" ? "phone" : "computer");
const never = () => () => {};

/** phone | computer, fixed for the page's life (`<html data-device>`, set by the boot script before first paint). The
 * only "is this the phone UI?" check in components — never the window's width (src/lib/device.ts). */
export function useDevice(): Device {
  const ssr = useContext(DeviceContext);
  return useSyncExternalStore(never, read, () => ssr);
}

/** The same outside React (event handlers, effects). */
export const isPhone = () => typeof document !== "undefined" && read() === "phone";

/** A phone held narrow (< 640 px): bottom sheets, the List / Grid layout, swipe rows. A narrow computer window never
 * gets these; a phone in landscape keeps its wider phone layout (as before R17 S7). */
export function usePhoneNarrow(): boolean {
  const narrow = useMedia(PHONE);
  return useDevice() === "phone" && narrow;
}
export const isPhoneNarrow = () => isPhone() && window.matchMedia(PHONE).matches;
