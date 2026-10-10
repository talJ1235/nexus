"use client";

import "./globals.css";
import { Crash } from "@/components/crash";

// R17 S5 S1: the root layout itself failed — the crash screen with its own <html> (no providers here).
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body>
        <Crash error={error} where="root" />
      </body>
    </html>
  );
}
