"use client";

import { useEffect } from "react";
import { addSource, bulkDelete, bulkSetStatus, bulkUpdate, createCollection, createItem, setStatus, updateItem, updateSource } from "@/app/actions";
import { useStore } from "./store";

/**
 * R16 B2 — DEV ONLY (never in a production build: nexus-app mounts it only when NODE_ENV !== "production"): a window
 * handle for test:live — read this tab's store, and call the real server actions as this tab's user (the same requests
 * the UI makes), so two browser contexts can be compared without driving every screen.
 */
export function TestBridge() {
  const s = useStore();
  useEffect(() => {
    (window as unknown as { __nexusTest?: unknown }).__nexusTest = {
      items: () => s.items,
      collections: () => s.collections,
      rev: () => s.getRev(),
      present: () => [...s.present.entries()],
      openItem: (id: string | null) => s.openItem(id),
      act: { addSource, bulkDelete, bulkSetStatus, bulkUpdate, createCollection, createItem, setStatus, updateItem, updateSource },
    };
  });
  return null;
}
