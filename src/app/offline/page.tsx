import { OfflineApp } from "@/components/app/offline-app";

// The offline shell: cached by the service worker for the owner, rendered from the device snapshot (IndexedDB).
export default function OfflinePage() {
  return <OfflineApp />;
}
