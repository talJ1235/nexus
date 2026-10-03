/**
 * Phone / installed-app opening. Pure SVG + CSS in the initial HTML, so it starts before any JS; shown only at
 * (max-width: 768px) or in standalone mode (globals.css). Hidden by `markBooted()` once the app has its data.
 *
 * Two modes (Round 11 A1), picked by the inline script below before the first paint and stored as
 * `<html data-boot="full|small">`:
 * - **full** — the app is being opened (new tab, PWA launch, first page of the session): the whole intro.
 * - **small** — a reload (incl. our pull-to-refresh), back/forward, or any later page load in the same session
 *   (`sessionStorage`, which in an installed PWA lives as long as the app is open): only the Box mark in a small
 *   circle, where the pull-to-refresh leaves it, over the loading app.
 *
 * The full intro (Round 11 A2, ~2.3 s): a palette-coloured field blooms from the centre over a faint isometric grid
 * that drifts; the Box faces fly in and assemble with a spring; a spark-coloured dot drops onto the top face and
 * bounces twice; the wordmark slides up; a light sweeps across; on ready the mark flies into the top-bar logo while
 * the field fades. Transform/opacity only.
 */
const TOP = "M32 8 54 20 32 32 10 20z";
const LEFT = "M10 20l22 12v24L10 44z";
const RIGHT = "M54 20 32 32v24l22-12z";
/** One cube outline per pointy-top hex cell (56 × 64); cells repeat every 56 × 96 with the odd row offset by 28. */
const CUBE = (x: number, y: number) =>
  `M${x + 28} ${y}l28 16v32l-28 16-28-16V${y + 16}z M${x} ${y + 16}l28 16 28-16 M${x + 28} ${y + 32}v32`;

const MODE_SCRIPT = `(function(){var d=document.documentElement,m="full";try{var n=performance.getEntriesByType("navigation")[0],t=n&&n.type,s=sessionStorage;if(t==="reload"||t==="back_forward"||s.getItem("nexus.opened"))m="small";s.setItem("nexus.opened","1")}catch(e){}d.setAttribute("data-boot",m)})()`;

export function BootScreen() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
      <div id="boot" aria-hidden="true">
        <div className="boot-bg">
          <div className="boot-bloom" />
          <svg className="boot-grid" aria-hidden="true">
            <defs>
              <pattern id="boot-cubes" width="56" height="96" patternUnits="userSpaceOnUse">
                <path d={`${CUBE(0, 0)} ${CUBE(-28, 48)} ${CUBE(28, 48)}`} />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#boot-cubes)" />
          </svg>
          <svg viewBox="0 0 64 64" className="boot-float boot-float-1"><path d={CUBE(4, 0)} /></svg>
          <svg viewBox="0 0 64 64" className="boot-float boot-float-2"><path d={CUBE(4, 0)} /></svg>
          <svg viewBox="0 0 64 64" className="boot-float boot-float-3"><path d={CUBE(4, 0)} /></svg>
          <div className="boot-vignette" />
          <div className="boot-sheen" />
        </div>
        <div className="boot-inner">
          <svg viewBox="0 0 64 64" className="boot-mark">
            <defs>
              <clipPath id="boot-clip">
                <path d={TOP} />
                <path d={LEFT} />
                <path d={RIGHT} />
              </clipPath>
              <linearGradient id="boot-light" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g className="boot-box">
              <path d={LEFT} className="boot-face boot-left" />
              <path d={RIGHT} className="boot-face boot-right" />
              <path d={TOP} className="boot-face boot-top" />
              <g clipPath="url(#boot-clip)">
                <rect x="-24" y="0" width="24" height="64" fill="url(#boot-light)" className="boot-sweep" />
              </g>
              <circle cx="32" cy="16.5" r="3.6" className="boot-dot" />
            </g>
          </svg>
          <div className="boot-word">Nexus</div>
        </div>
        <span className="boot-small">
          <svg viewBox="0 0 64 64" className="box-think">
            <path d={TOP} fill="var(--logo-c3)" />
            <path d={LEFT} fill="var(--logo-c1)" />
            <path d={RIGHT} fill="var(--logo-c2)" />
          </svg>
        </span>
      </div>
    </>
  );
}
