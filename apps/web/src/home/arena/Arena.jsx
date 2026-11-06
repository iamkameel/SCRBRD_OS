import { useEffect, useRef } from "react";

/**
 * The arena's stage: a sticky screen behind the whole of <main>, its canvas,
 * and the HUD over the film (Kameel, 6 Nov 2026). In the first-paint graph,
 * so it is small: the scene itself (arena/scene.js, and three.js with it) is
 * fetched by import() once this has mounted, after the page has painted.
 *
 * While the scene loads the stage shows the film's night (home/fx.js), and
 * the hero's words are already there. When its first frame is drawn <html>
 * gets `arena-on` and the canvas fades in. If it cannot load, or later loses
 * its GL context or cannot hold a frame rate, `onFail` is called and main.jsx
 * puts the 2D film back — never a blank page.
 *
 * Decorative, all of it (aria-hidden): the HUD's score is the film's SAMPLE,
 * labelled so, and every word the page says is real text elsewhere.
 *
 * Props
 *   forced  picked by hand (?arena=3d, arena/capable.js): keep going when slow
 *   onFail  (why) the scene could not carry on
 */
export function Arena({ forced = false, onFail = (/** @type {string} */ _why) => {} }) {
  const stage = useRef(/** @type {HTMLDivElement | null} */ (null));
  const canvas = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const hud = useRef(/** @type {HTMLDivElement | null} */ (null));
  const fail = useRef(onFail);
  fail.current = onFail;

  useEffect(() => {
    const root = document.documentElement;
    let dispose = () => {}, live = true;
    root.classList.add("arena-3d");
    const give = (/** @type {string} */ why) => { if (live) fail.current(why); };
    import("./scene.js").then((m) => {
      if (!live || !stage.current || !canvas.current) return;
      const h = hud.current;
      const q = (/** @type {string} */ k) => /** @type {HTMLElement | null} */ (h?.querySelector(`[data-hud="${k}"]`) ?? null);
      try {
        dispose = m.mountArena({
          stage: stage.current, canvas: canvas.current, forced,
          film: document.getElementById("home-film"),
          hud: { root: h, shot: q("shot"), score: q("score"), overs: q("overs"), bar: q("bar") },
          onReady: () => { if (live) root.classList.add("arena-on"); },
          onFail: give,
        });
      } catch {
        give("init");
      }
    }).catch(() => give("load"));
    return () => {
      live = false;
      dispose();
      root.classList.remove("arena-3d", "arena-on");
    };
  }, [forced]);

  return (
    <div ref={stage} className="arena-stage" aria-hidden="true" data-testid="home-arena">
      <canvas ref={canvas} className="arena-canvas" />
      <div ref={hud} className="hud">
        <span className="hud-c tl" /><span className="hud-c tr" /><span className="hud-c bl" /><span className="hud-c br" />
        <div className="hud-bug">
          <span className="hud-tag">Sample</span>
          <span className="hud-team">U14A</span>
          <b className="hud-score" data-hud="score">87/3</b>
          <span className="hud-ov"><span data-hud="overs">14.2</span> ov</span>
        </div>
        <div className="hud-shot"><b data-hud="shot">01</b><span>/05</span></div>
        <div className="hud-bar"><i data-hud="bar" /></div>
      </div>
    </div>
  );
}
