/**
 * Phone / installed-app opening animation. Pure SVG + CSS in the initial HTML, so it starts before any JS; shown only
 * at (max-width: 768px) or in standalone mode (globals.css). Hidden by `markBooted()` once the app has its data.
 * Same background as the native PWA splash (manifest `background_color` = dark `--bg`), so native → boot is seamless.
 */
export function BootScreen() {
  return (
    <div id="boot" className="dark" aria-hidden="true">
      {/* Reloads within the same tab skip it: the streamed shell + skeletons take over there. */}
      <script dangerouslySetInnerHTML={{ __html: `try{sessionStorage.getItem("nexus.booted")&&document.documentElement.classList.add("boot-skip")}catch(e){}` }} />
      <div className="boot-inner">
        <svg viewBox="0 0 32 32" className="boot-mark">
          <rect width="32" height="32" rx="9" className="boot-tile" />
          <circle cx="16" cy="16" r="4" className="boot-glow" />
          <path d="M16 16 9 9" pathLength={1} className="boot-link" style={{ animationDelay: "300ms" }} />
          <path d="M16 16l7-7" pathLength={1} className="boot-link" style={{ animationDelay: "400ms" }} />
          <path d="M16 16v8.5" pathLength={1} className="boot-link" style={{ animationDelay: "500ms" }} />
          <circle cx="9" cy="9" r="2.6" className="boot-node" style={{ animationDelay: "750ms" }} />
          <circle cx="23" cy="9" r="2.6" className="boot-node" style={{ animationDelay: "900ms" }} />
          <circle cx="16" cy="24.5" r="2.6" className="boot-node" style={{ animationDelay: "1050ms" }} />
          <circle cx="16" cy="16" r="4" className="boot-hub" />
        </svg>
        <div className="boot-word">Nexus</div>
      </div>
    </div>
  );
}
