"use client";

import { Crash } from "@/components/crash";

// R17 S5 S1: any page that throws while rendering shows the crash screen instead of a blank page.
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <Crash error={error} where="app" onRetry={retry} />;
}
