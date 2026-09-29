import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { D, T } from "../../design/tokens.js";

/**
 * A DEVICE FRAME for the deck's live slides.
 *
 * What is inside a frame is a real screen (Showcase.jsx passes the app's own
 * components), drawn at the size it is drawn on a phone or a laptop and then
 * scaled to fit the slide. Three things are true of every frame:
 *
 *   INERT. The screen is `inert` (nothing in it takes focus, a click or a
 *   screen reader's attention) and `pointer-events: none`, and the components
 *   are handed handlers that do nothing. A viewer who taps a slide writes
 *   nothing, because there is nothing to tap; tools/smoke-browser-deck.mjs
 *   holds that to "no request but static files while on these slides". A
 *   screen reader is given the frame's label instead of a form it cannot use.
 *
 *   SCALED, NOT REFLOWED. The screen keeps its natural width so the layout
 *   is the one a phone or a laptop has; a transform shrinks it to the room the
 *   slide has. Its own type is the app's (12px and up at natural size); the
 *   deck's text around it is the deck's and stays 12px and up too.
 *
 *   LABELLED. A caption names what the frame shows, and the frame is a named
 *   group, so the slide reads to anybody without the picture.
 */

// A layout effect in the browser, so the frame is the right size on its first
// paint; a plain effect where there is no layout to measure (server rendering, the suites).
const useFit = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Natural screen sizes, and the bezel each kind wears. */
const KINDS = {
  phone:  { w: 390,  h: 780, bezel: 11, radius: 44, base: 0 },
  laptop: { w: 960,  h: 600, bezel: 14, radius: 18, base: 20 },
};

/** True while the viewport is at or under `px` wide. */
export function useNarrow(px = 760) {
  const q = `(max-width: ${px}px)`;
  const [n, setN] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const m = matchMedia(q);
    const on = () => setN(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [q]);
  return n;
}

/**
 * @param {{ kind?: "phone" | "laptop", label: string, caption?: import("react").ReactNode, testid: string,
 *           fade?: boolean, children: import("react").ReactNode }} p
 */
export function Device({ kind = "phone", label, caption, testid, fade = false, children }) {
  const k = KINDS[kind];
  const outerW = k.w + k.bezel * 2, outerH = k.h + k.bezel * 2 + k.base;
  const host = useRef(null), screen = useRef(null);
  const [scale, setScale] = useState(0.6);

  // Fit: the room the slide gives it, and — beside other things, not stacked
  // on a phone — no taller than most of the window, so a frame never pushes
  // the caption off the slide at a laptop's height.
  useFit(() => {
    const el = host.current;
    if (!el) return undefined;
    const fit = () => {
      const room = el.clientWidth || outerW;
      const stacked = typeof innerWidth === "number" && innerWidth <= 840;
      const tall = stacked ? Infinity : Math.max(340, Math.min(640, (typeof innerHeight === "number" ? innerHeight : 800) * 0.62));
      setScale(Math.max(0.2, Math.min(1, room / outerW, tall / outerH)));
    };
    fit();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    addEventListener("resize", fit);
    return () => { ro.disconnect(); removeEventListener("resize", fit); };
  }, [outerW, outerH]);

  // Inert by property: React 18 does not know the attribute.
  useEffect(() => {
    const el = screen.current;
    if (el) el.inert = true;
  }, []);

  return (
    <figure className="deck-dev" data-testid={testid} data-kind={kind} data-inert="true" ref={host}>
      <div className="deck-dev-fit" style={{ width: outerW * scale, height: outerH * scale }}>
        <div role="group" aria-label={label} className="deck-dev-frame" data-kind={kind}
             style={{ width: outerW, height: outerH, transform: `scale(${scale})`, padding: `${k.bezel}px ${k.bezel}px ${k.bezel + k.base}px`,
               borderRadius: k.radius + k.bezel }}>
          <div ref={screen} className="deck-dev-screen" style={{ width: k.w, height: k.h, borderRadius: k.radius }}>
            {children}
            {fade && <div className="deck-dev-fade" aria-hidden="true"/>}
          </div>
          {kind === "phone" && <span className="deck-dev-notch" aria-hidden="true"/>}
          {kind === "laptop" && <span className="deck-dev-base" aria-hidden="true" style={{ height: k.base }}/>}
        </div>
      </div>
      {caption && <figcaption className="deck-dev-cap">{caption}</figcaption>}
    </figure>
  );
}

/** The frame's own styles, from the tokens as they stand now (see css() in PitchDeckView). */
export const deviceCss = () => `
.deck-dev{margin:0;width:100%;min-width:0;display:flex;flex-direction:column;align-items:center;gap:10px}
.deck-dev-fit{position:relative;flex:none}
.deck-dev-frame{position:absolute;left:0;top:0;transform-origin:top left;box-sizing:border-box;background:${T.line.strong};border:1px solid ${T.line.strong};box-shadow:0 18px 50px rgba(0,0,0,.28)}
.deck-dev-screen{position:relative;overflow:hidden;box-sizing:border-box;background:${T.surface.canvas};color:${T.content.primary};font-family:${T.type.body};pointer-events:none;user-select:none;-webkit-user-select:none}
.deck-dev-screen *{pointer-events:none!important}
.deck-dev-screen .pad-strip-dock{position:relative!important;bottom:auto!important;box-shadow:none!important}
.deck-dev-screen .pad-strip-dock::after{display:none!important}
.deck-dev-fade{position:absolute;left:0;right:0;bottom:0;height:120px;background:linear-gradient(180deg,transparent,${T.surface.canvas});pointer-events:none}
.deck-dev-notch{position:absolute;left:50%;top:6px;width:84px;height:6px;margin-left:-42px;border-radius:3px;background:${T.surface.canvas};opacity:.55}
.deck-dev-base{position:absolute;left:0;right:0;bottom:0;border-radius:0 0 22px 22px;background:${T.line.strong};border-top:1px solid ${T.line.normal}}
.deck-dev-cap{font-family:${D.body};font-size:12px;line-height:1.45;color:${D.textSecondary};text-align:center;max-width:46ch}
`;
