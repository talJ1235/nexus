"use client";

import { useEffect } from "react";

export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    const sw = navigator.serviceWorker;
    // A new build registers a new worker URL; it takes over at once and the page reloads once so it never runs
    // stale code against a new server. The first install (no previous worker) doesn't reload.
    const hadController = !!sw.controller;
    let reloaded = false;
    const onChange = () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    sw.addEventListener("controllerchange", onChange);
    sw.register(`/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}`).catch(() => {});
    return () => sw.removeEventListener("controllerchange", onChange);
  }, []);
  return null;
}
