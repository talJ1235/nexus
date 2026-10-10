"use client";

import { useState } from "react";
import { personPhoto } from "./spaces/look";

/**
 * R17 P3: a person's photo inside an avatar circle (their upload, or Google's from sign-up), or `fallback` (the
 * initials) when there is none or it doesn't load. Fills its parent, which keeps its size, colour and ring.
 */
export function PersonPhoto({ url, fallback }: { url: string | null | undefined; fallback: React.ReactNode }) {
  const src = personPhoto(url);
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || failed === src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small avatar from Blob / Google; next/image adds nothing here
    <img src={src} alt="" draggable={false} referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(src)} style={{ width: "100%", height: "100%", borderRadius: "inherit", objectFit: "cover", display: "block" }} data-person-photo />
  );
}
