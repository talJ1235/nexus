/**
 * Phone / installed-app opening animation. Pure SVG + CSS in the initial HTML, so it starts before any JS; shown only
 * at (max-width: 768px) or in standalone mode (globals.css), on every full load / reload / app open (Round 10 A3 —
 * in-app navigation never reloads the document). Hidden by `markBooted()` once the app has its data.
 * The Box assembles: left face, right face, then the top drops on with a small spring; a soft light sweeps across,
 * the wordmark fades in, and the box breathes while the app is still loading. Background = the active palette's bg.
 */
const TOP = "M32 8 54 20 32 32 10 20z";
const LEFT = "M10 20l22 12v24L10 44z";
const RIGHT = "M54 20 32 32v24l22-12z";

export function BootScreen() {
  return (
    <div id="boot" aria-hidden="true">
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
          </g>
        </svg>
        <div className="boot-word">Nexus</div>
      </div>
    </div>
  );
}
