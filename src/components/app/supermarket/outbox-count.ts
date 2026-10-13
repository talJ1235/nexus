"use client";

import { useEffect, useState } from "react";
import { loadTripOps } from "@/lib/shop-outbox";

/** R18 S2 — how many supermarket actions wait in the outbox (the "Offline · 2 waiting" badge). Re-read on online /
 *  offline changes and every few seconds while offline. */
export function useOutboxCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const read = () => void loadTripOps().then((ops) => live && setN(ops.length), () => {});
    read();
    const id = window.setInterval(() => !navigator.onLine && read(), 4000);
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    window.addEventListener("nexus:sm-outbox", read);
    return () => {
      live = false;
      window.clearInterval(id);
      window.removeEventListener("online", read);
      window.removeEventListener("offline", read);
      window.removeEventListener("nexus:sm-outbox", read);
    };
  }, []);
  return n;
}
