"use client";

import { useEffect } from "react";
import { clearOffline } from "@/lib/offline";

/** On the login page (where every logout lands): forget the offline snapshot and cached shell on this device. */
export function ClearOffline() {
  useEffect(() => {
    void clearOffline();
  }, []);
  return null;
}
