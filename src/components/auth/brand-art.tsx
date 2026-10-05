import { APP_NAME } from "@/lib/brand";

// The light brand panel of the sign-in screens (R15 A2, mockups SignIn-*): an isometric field of the Box logo's cubes,
// rising toward the centre, bobbing and catching a soft shine. Pure markup + CSS (no JS); colours come from the
// --cbN* variables in nx.css so it follows light/dark × Graphite/Plum. Port of the mockups' field().

type Cube = { x: number; y: number; w: number; h: number; dl: number; ct: string; cl: string; cr: string; band: number };

function field(W: number, H: number, N: number, s: number, cx: number, cy: number): Cube[] {
  const a = s * 0.866;
  const b = s * 0.5;
  const EX = 26;
  const out: Cube[] = [];
  const ox = W * cx;
  const oy = H * cy - (N - 1) * b;
  const c = (N - 1) / 2;
  const q = (v: number) => Math.round(v * 10) / 10;
  for (let k = 0; k <= 2 * (N - 1); k++)
    for (let i = 0; i < N; i++) {
      const j = k - i;
      if (j < 0 || j >= N) continue;
      const d = Math.hypot(i - c, j - c);
      if (d > N * 0.62) continue;
      const f = ((Math.cos(d * 0.62) + 1) / 2) * Math.exp(-d * 0.06);
      const h = 4 + f * s * 2.6;
      const x = ox + (i - j) * a;
      const y = oy + (i + j) * b - h;
      const A2 = q(2 * a);
      const B2 = q(2 * b);
      const HH = q(2 * b + h + EX);
      out.push({
        x: q(x - a),
        y: q(y - b),
        w: A2,
        h: HH,
        dl: q(-d * 0.42),
        ct: `polygon(${q(a)}px 0,${A2}px ${q(b)}px,${q(a)}px ${B2}px,0 ${q(b)}px)`,
        cl: `polygon(0 ${q(b)}px,${q(a)}px ${B2}px,${q(a)}px ${HH}px,0 ${q(b + h + EX)}px)`,
        cr: `polygon(${q(a)}px ${B2}px,${A2}px ${q(b)}px,${A2}px ${q(b + h + EX)}px,${q(a)}px ${HH}px)`,
        band: Math.min(4, Math.floor(f * 5.2)),
      });
    }
  return out;
}

const DESK = field(816, 876, 21, 30, 0.5, 0.45);
const PHONE = field(390, 430, 15, 20, 0.5, 0.42);

export function BoxMark({ size = 36 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <path d="M32 8 54 20 32 32 10 20z" fill="#fb7a3c" />
      <path d="M10 20l22 12v24L10 44z" fill="var(--face)" stroke="var(--edge)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M54 20 32 32v24l22-12z" fill="#f59e0b" />
    </svg>
  );
}

function Stage({ cubes, className, style }: { cubes: Cube[]; className: string; style: React.CSSProperties }) {
  return (
    <div className={`stage ${className}`} style={style}>
      {cubes.map((c, k) => (
        <div key={k} className="cube" style={{ left: c.x, top: c.y, width: c.w, height: c.h, animationDelay: `${c.dl}s` }}>
          <i style={{ clipPath: c.cl, background: `var(--cb${c.band}l)` }} />
          <i style={{ clipPath: c.cr, background: `var(--cb${c.band}r)` }} />
          <i style={{ clipPath: c.ct, background: `var(--cb${c.band}t)` }} />
          <i className="gl" style={{ clipPath: c.ct, animationDelay: `${c.dl}s` }} />
        </div>
      ))}
    </div>
  );
}

/** Desktop: the left panel (field centred on an 816 × 876 stage); phone: the top band (390 × 430). */
export function BrandArt() {
  return (
    <section className="art" dir="ltr" aria-hidden="true">
      <Stage cubes={DESK} className="auth-desk" style={{ inset: "auto", left: "50%", top: "50%", width: 816, height: 876, transform: "translate(-50%,-50%)" }} />
      <Stage cubes={PHONE} className="auth-phone" style={{ inset: "auto", left: "50%", top: 0, width: 390, height: 430, transform: "translateX(-50%)" }} />
      <div className="mark auth-desk" style={{ left: 40, bottom: 36, fontSize: 30 }}>
        <BoxMark size={40} />
        {APP_NAME}
      </div>
      <div className="mark auth-phone" style={{ left: 0, right: 0, bottom: 24, justifyContent: "center", fontSize: 26 }}>
        <BoxMark size={34} />
        {APP_NAME}
      </div>
    </section>
  );
}

/** Google's sign-in "G" mark (official 4-colour asset, per Google's sign-in branding guidelines). */
export function GoogleMark() {
  return (
    <svg className="gmark" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export const PasskeyIcon = ({ className = "i" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="9" cy="8" r="4" />
    <path d="M3 21v-1a6 6 0 0 1 9-5.2" />
    <circle cx="18" cy="15" r="2.5" />
    <path d="M18 17.5V22l1.5-1.2M18 20h1.5" />
  </svg>
);
