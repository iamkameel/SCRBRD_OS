import { FILM_SCREENS, SHOTS, clamp, drawFilm, drawShot, forgetCaches } from "./draw.js";

/**
 * The film's engine: scroll position in, frames out. No library.
 *
 * The film section is FILM_SCREENS + 1 screens tall and its stage is pinned
 * (position: sticky, in CSS) for FILM_SCREENS of them, so `s`, the film's
 * clock, is simply how many screen heights the section's top has scrolled
 * past the top of the viewport. A passive scroll listener asks for one
 * animation frame; the frame eases the drawn `s` towards the read one (a
 * flick of the thumb plays as camera movement, not a jump cut) and asks for
 * another only until the two meet. So a still page costs nothing, and:
 *
 *   - the canvas is drawn at the device's pixel ratio, capped at 2;
 *   - nothing is drawn while the stage is off screen (IntersectionObserver);
 *   - a frame is drawn only when `s` changed;
 *   - the fonts arriving, or the stage resizing, is one redraw.
 *
 * Reduced motion never comes here: the page shows the storyboard instead,
 * drawn once by drawStills.
 */
export function mountFilm({ section, stage, canvas }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  let w = 0, h = 0, dpr = 1, drawn = -1, eased = -1, raf = 0, visible = false, dead = false;

  const target = () => clamp(-section.getBoundingClientRect().top / (h || window.innerHeight || 1), 0, FILM_SCREENS);
  const frame = () => {
    raf = 0;
    if (dead || !visible || !w) return;
    const t = target();
    eased = eased < 0 ? t : eased + (t - eased) * 0.22;
    if (Math.abs(t - eased) < 0.0006) eased = t;
    if (eased !== drawn) {
      drawn = eased;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const shot = drawFilm(ctx, w, h, eased);
      section.dataset.shot = String(shot + 1);
    }
    if (eased !== t) raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!raf && visible && !dead) raf = requestAnimationFrame(frame); };
  const size = () => {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    drawn = -1;
    kick();
  };
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) { drawn = -1; kick(); } });
  io.observe(section);
  const ro = new ResizeObserver(size);
  ro.observe(stage);
  size();
  window.addEventListener("scroll", kick, { passive: true });
  document.fonts?.ready?.then(() => { forgetCaches(); drawn = -1; kick(); });
  return () => {
    dead = true;
    if (raf) cancelAnimationFrame(raf);
    io.disconnect(); ro.disconnect();
    window.removeEventListener("scroll", kick);
  };
}

/**
 * The storyboard, for reduced motion: each shot's still, drawn once into its
 * own canvas at the moment SHOTS[i].still names (or `p`, for the hero's
 * backdrop), and again only on a resize or when the fonts arrive. Nothing
 * moves. `stills` is [{ canvas, shot, p? }].
 */
export function drawStills(stills) {
  const canvases = stills.map((x) => x.canvas);
  let dead = false;
  const draw = () => {
    if (dead) return;
    stills.forEach(({ canvas: c, shot, p }) => {
      if (!c) return;
      const r = c.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawShot(ctx, r.width, r.height, shot, p ?? SHOTS[shot].still, true);
    });
  };
  const ro = new ResizeObserver(draw);
  canvases.forEach((c) => c && ro.observe(c));
  document.fonts?.ready?.then(() => { forgetCaches(); draw(); });
  draw();
  return () => { dead = true; ro.disconnect(); };
}
