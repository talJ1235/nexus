"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { tileColor } from "./space-ui";
import { initialOf } from "@/lib/initial";

// R15 C2: the invite QR, drawn on the device (no third-party QR service): zxing-wasm's writer (already a dependency
// for the barcode scanner; its .wasm is self-hosted under /vendor), error correction H so the space tile can sit in
// the middle (Invite mockups).

type Mod = { w: number; h: number; on: (x: number, y: number) => boolean };

async function encode(text: string): Promise<Mod | null> {
  const z = await import("zxing-wasm/writer");
  await z.prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/vendor/zxing_writer.wasm" : prefix + path) },
    fireImmediately: true,
  });
  const r = await z.writeBarcode(text, { format: "QRCode", ecLevel: "H", scale: 1, withQuietZones: false });
  if (r.error || !r.symbol?.width) return null;
  const { data, width, height } = r.symbol;
  // A set module is dark (0) in the symbol bitmap.
  return { w: width, h: height, on: (x, y) => data[y * width + x] === 0 };
}

export function InviteQr({ value, name, color, size = 200, className }: { value: string; name: string; color: string; size?: number; className?: string }) {
  const [mod, setMod] = useState<Mod | null>(null);
  useEffect(() => {
    let gone = false;
    encode(value)
      .then((m) => !gone && setMod(m))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [value]);
  const n = mod?.w ?? 25;
  // Clear a centre square (≈ 22% of the side) for the tile; H correction absorbs it.
  const hole = Math.ceil(n * 0.22) | 1;
  const h0 = Math.floor((n - hole) / 2);
  const rects: string[] = [];
  if (mod)
    for (let y = 0; y < mod.h; y++)
      for (let x = 0; x < mod.w; x++) if (mod.on(x, y) && !(x >= h0 && x < h0 + hole && y >= h0 && y < h0 + hole)) rects.push(`M${x} ${y}h1v1h-1z`);
  return (
    <div className={cn("rounded-xl border border-line bg-white p-3", className)} style={{ width: size + 24 }} data-invite-qr={mod ? "ready" : "loading"}>
      <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label="QR" shapeRendering="crispEdges">
        {mod ? <path d={rects.join("")} fill="#111" /> : <rect width={n} height={n} fill="#f2f2f0" rx={1} />}
        <rect x={h0 + 0.5} y={h0 + 0.5} width={hole - 1} height={hole - 1} rx={(hole - 1) / 4} fill={tileColor(color)} />
        <text x={n / 2} y={n / 2} dominantBaseline="central" textAnchor="middle" fill="#fff" fontWeight={700} fontSize={(hole - 1) * 0.5} fontFamily="inherit">
          {initialOf(name, "")}
        </text>
      </svg>
    </div>
  );
}
