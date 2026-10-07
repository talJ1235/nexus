/**
 * The opening (Round 13 D1, "v4", 3.0 s). Pure SVG + CSS in the initial HTML, so it starts before any JS; hidden by
 * `markBooted()` once the app has its data. Transform/opacity only.
 *
 * When (inline script below, before the first paint → `<html data-boot="full|small|none">`):
 * - **Phone / installed app**: `full` when the app is opened (new tab, PWA launch, first page of the session);
 *   `small` on a reload, back/forward or a later load in the same session (`sessionStorage`).
 * - **Desktop**: `full` on the first open of the day (a local date key in `localStorage`), `small` after that;
 *   pages other than the app (login, shared lists) show nothing.
 *
 * Timeline (seconds): 0–0.9 the palette field blooms and the isometric cube grid scales in (radial mask) and drifts ·
 * 0–0.8 eight outline cubes spin in and are swallowed by the centre · 0.15–0.85 the three Box faces fly in and assemble
 * with a spring · 0.78–1.33 the spark dot drops onto the top face and bounces, the box squashes on impact · 1.0–1.9
 * two rings + 14 particles burst, the field flashes · 1.2–1.75 a light sweep · 1.25–1.7 the letters of "Nexus" rise
 * (60 ms stagger) · 1.3–2.5 hold: the centre is still while the background moves (grid drifts, bloom breathes, five
 * cubes wander, dots orbit both ways) · 2.5–2.95 exit: the box flies into the top-bar / sidebar logo, the field
 * fades, Home's cards rise in (lib/boot.ts).
 */
const TOP = "M32 8 54 20 32 32 10 20z";
const LEFT = "M10 20l22 12v24L10 44z";
const RIGHT = "M54 20 32 32v24l22-12z";
/** One cube outline per pointy-top hex cell (56 × 64); cells repeat every 56 × 96 with the odd row offset by 28. */
const CUBE = (x: number, y: number) =>
  `M${x + 28} ${y}l28 16v32l-28 16-28-16V${y + 16}z M${x} ${y + 16}l28 16 28-16 M${x + 28} ${y + 32}v32`;
const OUTLINE = CUBE(4, 0);

const MODE_SCRIPT = `(function(){var d=document.documentElement,m="full",r=0;try{r=localStorage.getItem("nexus.motion")==="reduce";if(r)d.setAttribute("data-motion","reduce")}catch(e){}try{var p=matchMedia("(max-width: 768px), (display-mode: standalone)").matches;if(p){var n=performance.getEntriesByType("navigation")[0],t=n&&n.type,s=sessionStorage;if(t==="reload"||t==="back_forward"||s.getItem("nexus.opened"))m="small";s.setItem("nexus.opened","1")}else if(location.pathname!=="/"){m="none"}else{var a=new Date(),k=a.getFullYear()+"-"+(a.getMonth()+1)+"-"+a.getDate();if(localStorage.getItem("nexus.bootDay")===k)m="small";else localStorage.setItem("nexus.bootDay",k)}}catch(e){m="small"}if(r&&m==="full")m="small";d.setAttribute("data-boot",m)})()`;

/**
 * R16 A8 + hotfix (2026-10-07) — self-heal for a phone page laid out at desktop width. On Android, an installed app
 * (Chrome) that comes back from Google's sign-in Custom Tab can keep a stale layout width — Chrome's 980 px fallback —
 * until a manual refresh (Google's own page renders tiny too, so it's the window, not our meta tag).
 * Wrong = coarse pointer AND short screen side < 600 AND innerWidth ≥ 1.4 × the screen width in the current orientation
 * (orientation-aware so a phone in landscape — innerWidth ≈ long side — never matches; tablets and desktops never do).
 * Checked on load, pageshow, visibilitychange (visible) and resize. Fix: first re-insert the viewport meta (the last
 * one, which Chrome applies; the same node in the same place, so hydration is unaffected; ≤ 3 tries per page) and
 * re-check two frames later; still wrong → reload, at most once per 30 s per tab (sessionStorage timestamp) — never a
 * loop. One `viewport` event per page (numbers taken at detection, no content) goes to the error log (R16 C2).
 */
const VIEWPORT_GUARD = `(function(){
var K="nexus.vpfix",VP="width=device-width, initial-scale=1, viewport-fit=cover",busy=0,tries=0,sent=0;
function dims(){var a=screen.width,b=screen.height,s=Math.min(a,b),l=Math.max(a,b),o=(screen.orientation&&screen.orientation.type)||"",land=o?o.indexOf("landscape")===0:Math.abs(window.orientation||0)===90;return[s,land?l:s]}
function bad(){try{var d=dims();return!!d[0]&&d[0]<600&&innerWidth>=1.4*d[1]&&matchMedia("(pointer: coarse)").matches}catch(e){return false}}
function mq(q){return matchMedia(q).matches}
function snap(had){try{var n=performance.getEntriesByType("navigation")[0],r="-",v=window.visualViewport;try{if(document.referrer)r=new URL(document.referrer).host}catch(e){}
return["iw="+innerWidth,"ow="+outerWidth,"s="+screen.width+"x"+screen.height,"dpr="+devicePixelRatio,"vv="+(v?Math.round(v.width)+"@"+v.scale.toFixed(2):"-"),"dm="+(mq("(display-mode: standalone)")?"standalone":mq("(display-mode: minimal-ui)")?"minimal-ui":"browser"),"mobile="+(/Mobile/.test(navigator.userAgent)?"yes":"no"),"nav="+((n&&n.type)||"-"),"ref="+r,"meta="+(had?"yes":"no")].join(" ")}catch(e){return"?"}}
function report(soft,at){if(sent)return;sent=1;try{var m=at+" soft="+(soft?"yes":"no"),b=JSON.stringify({events:[{kind:"viewport",code:"layout",where:location.pathname.slice(0,120),message:m}]});
if(navigator.sendBeacon)navigator.sendBeacon("/api/errors",new Blob([b],{type:"application/json"}));else fetch("/api/errors",{method:"POST",headers:{"content-type":"application/json"},body:b,keepalive:true})}catch(e){}}
function after(f){requestAnimationFrame(function(){requestAnimationFrame(f)})}
function hard(){try{var s=sessionStorage,t=Number(s.getItem(K))||0;if(Date.now()-t>30000){s.setItem(K,String(Date.now()));location.reload()}}catch(e){}}
function check(){if(busy||!bad())return;busy=1;var h=document.head,all=document.querySelectorAll('meta[name="viewport"]'),m=all[all.length-1],at=snap(!!m);
if(tries++>=3){report(false,at);busy=0;hard();return}
if(m){var p=m.parentNode,x=m.nextSibling;if(!/device-width/.test(m.content))m.content=VP;p.removeChild(m);p.insertBefore(m,x)}else{m=document.createElement("meta");m.name="viewport";m.content=VP;h.appendChild(m)}
after(function(){var still=bad();report(!still,at);busy=0;if(still)hard()})}
check();addEventListener("pageshow",check);addEventListener("resize",check);document.addEventListener("visibilitychange",function(){document.visibilityState==="visible"&&check()})
})()`;

/** Eight cubes gather from around the centre (offset, size). */
const GATHER: [number, number, number][] = [
  [139, 56, 30], [74, 175, 22], [-56, 139, 26], [-175, 74, 18], [-139, -56, 28], [-74, -175, 20], [56, -139, 24], [175, -74, 16],
];
/** Fourteen particles in the logo colours (end offset, size, colour). */
const BURST: [number, number, number, string][] = [
  [95, 13, 6, "c2"], [100, 67, 4, "c3"], [43, 72, 5, "c1"], [9, 110, 6, "c2"], [-34, 90, 4, "c3"], [-87, 82, 5, "c1"], [-80, 26, 6, "c2"],
  [-109, -15, 4, "c3"], [-80, -53, 5, "c1"], [-61, -103, 6, "c2"], [-7, -84, 4, "c3"], [39, -103, 5, "c1"], [70, -66, 6, "c2"], [114, -37, 4, "c3"],
];
/** Five cubes that wander during the hold (position %, size, period s, delay s, drift, turn). */
const AMBIENT: [string, string, number, number, number, number, number, number][] = [
  ["10%", "18%", 40, 3.2, 1.25, 18, -22, 14],
  ["77%", "22%", 30, 2.8, 1.35, -16, -18, -12],
  ["14%", "66%", 34, 3.0, 1.4, 20, 16, -10],
  ["74%", "71%", 44, 3.4, 1.3, -22, 14, 12],
  ["44%", "82%", 24, 2.6, 1.45, 12, -16, 16],
];

export function BootScreen({ nonce }: { nonce?: string }) {
  return (
    <>
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: VIEWPORT_GUARD + ";" + MODE_SCRIPT }} />
      <div id="boot" aria-hidden="true">
        <div className="boot-bg">
          <div className="boot-bloom" />
          <svg className="boot-grid" aria-hidden="true">
            <defs>
              <pattern id="boot-cubes" width="56" height="96" patternUnits="userSpaceOnUse">
                <path d={`${CUBE(0, 0)} ${CUBE(-28, 48)} ${CUBE(28, 48)}`} />
              </pattern>
              <radialGradient id="boot-fade">
                <stop offset="0" stopColor="#fff" />
                <stop offset="0.55" stopColor="#fff" stopOpacity="0.5" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
              <mask id="boot-mask">
                <rect width="100%" height="100%" fill="url(#boot-fade)" />
              </mask>
            </defs>
            <rect width="100%" height="100%" fill="url(#boot-cubes)" mask="url(#boot-mask)" />
          </svg>
          <div className="boot-vignette" />
          <div className="boot-flash" />
          {AMBIENT.map(([l, tp, s, t, dl, dx, dy, rt], k) => (
            <svg
              key={k}
              viewBox="0 0 64 64"
              className="boot-amb"
              style={{ left: l, top: tp, width: s, height: s, "--t": `${t}s`, "--dl": `${dl}s`, "--dx": `${dx}px`, "--dy": `${dy}px`, "--rt": `${rt}deg` } as React.CSSProperties}
            >
              <path d={OUTLINE} />
            </svg>
          ))}
        </div>
        <div className="boot-inner">
          {/* Effects anchored at the mark's centre. */}
          <div className="boot-fx">
            {GATHER.map(([x, y, s], k) => (
              <svg key={k} viewBox="0 0 64 64" className="boot-g" style={{ "--x": `${x}px`, "--y": `${y}px`, "--s": `${s}px`, "--d": `${k * 40}ms` } as React.CSSProperties}>
                <path d={OUTLINE} />
              </svg>
            ))}
            <span className="boot-ring boot-ring-1" />
            <span className="boot-ring boot-ring-2" />
            <div className="boot-orbs">
              <div className="boot-orbit boot-orbit-1">
                <i style={{ left: 118, top: 0, background: "var(--logo-c2)" }} />
                <i style={{ left: -122, top: 20, width: 5, height: 5, background: "var(--logo-c3)" }} />
              </div>
              <div className="boot-orbit boot-orbit-2">
                <i style={{ left: 0, top: -150, width: 4, height: 4, background: "var(--brand)" }} />
                <i style={{ left: -30, top: 146, width: 5, height: 5, background: "var(--logo-c2)" }} />
                <i style={{ left: 140, top: -50, width: 4, height: 4, background: "var(--logo-c3)" }} />
              </div>
            </div>
            <div className="boot-burst">
              {BURST.map(([x, y, z, c], k) => (
                <i key={k} style={{ "--x": `${x}px`, "--y": `${y}px`, "--z": `${z}px`, background: c === "c1" ? "var(--brand)" : `var(--logo-${c})` } as React.CSSProperties} />
              ))}
            </div>
          </div>
          <svg viewBox="0 0 64 64" className="boot-mark">
            <defs>
              <clipPath id="boot-clip">
                <path d={TOP} />
                <path d={LEFT} />
                <path d={RIGHT} />
              </clipPath>
              <linearGradient id="boot-light" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.5" stopColor="#fff" stopOpacity="0.65" />
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
          <div className="boot-word" dir="ltr">
            {"Nexus".split("").map((ch, k) => (
              <span key={k} style={{ "--d": `${1250 + k * 60}ms` } as React.CSSProperties}>
                {ch}
              </span>
            ))}
          </div>
        </div>
        <span className="boot-small">
          <svg viewBox="0 0 64 64" className="box-think">
            <path d={LEFT} fill="var(--logo-c1)" stroke="var(--logo-edge)" strokeWidth={1.2} strokeLinejoin="round" />
            <path d={TOP} fill="var(--logo-c3)" />
            <path d={RIGHT} fill="var(--logo-c2)" />
          </svg>
        </span>
      </div>
    </>
  );
}
