// What the client can tell about itself (Round 8 D2/D3): sent with help questions and attached to problem reports.
// Never secrets — no tokens, cookies or keys.
import { clientErrors, type ClientError } from "./client-errors";
import { currentPalette } from "./palette";

export type ClientDiag = {
  view: string;
  device: "phone" | "desktop";
  viewport: string;
  palette: string;
  mode: "light" | "dark";
  locale: string;
  online: boolean;
  extension: string | null;
  version: string;
  errors: ClientError[];
};

export function collectDiag(view: string, locale: string, extension: string | null): ClientDiag {
  return {
    view,
    device: window.matchMedia("(max-width: 1023px)").matches ? "phone" : "desktop",
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    palette: currentPalette(),
    mode: document.documentElement.classList.contains("dark") ? "dark" : "light",
    locale,
    online: navigator.onLine,
    extension,
    version: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
    errors: clientErrors(),
  };
}
