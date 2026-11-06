/**
 * Which picture the home page draws behind its words (Kameel, 6 Nov 2026:
 * "three.js, loaded after paint"). Asked once, after paint, by main.jsx; in
 * the first-paint graph, so it is small and imports nothing.
 *
 *   "stills"  prefers-reduced-motion: the film's five drawn stills, a
 *             storyboard, nothing moving (film/engine.js drawStills).
 *   "film"    the 2D canvas film (film/engine.js mountFilm): no WebGL, a GL
 *             that is software or blocklisted (failIfMajorPerformanceCaveat,
 *             or a renderer named as software),
 *             a device that says it is small (fewer than four cores, less
 *             than 4 GB, Save-Data on), or the 3D scene failing later — it
 *             did not load, the GL context was lost, or it could not hold a
 *             frame rate (scene.js hands back to the film).
 *   "3d"      the arena: the three.js scene (arena/scene.js), a lazy chunk
 *             fetched only now, behind the whole page.
 *
 * Never a blank page: every one of the three draws something, and the words
 * are real text in all of them.
 *
 * `?arena=2d` or `?arena=3d` on the URL picks one by hand, for a walk or a
 * demo on a machine the checks would refuse. `3d` still needs WebGL, and a
 * scene picked by hand keeps going when it is slow instead of handing back
 * (`forced`). Reduced motion wins over both.
 *
 * @param {Window} [win]
 * @returns {{ mode: "stills" | "film" | "3d", forced: boolean }}
 */
export function arenaMode(win = window) {
  if (win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return { mode: "stills", forced: false };
  let ask = null;
  try { ask = new URLSearchParams(win.location?.search ?? "").get("arena"); } catch { /* no query */ }
  if (ask === "2d") return { mode: "film", forced: true };
  if (ask === "3d") return { mode: webgl(win, false) ? "3d" : "film", forced: true };
  const nav = /** @type {any} */ (win.navigator ?? {});
  if (nav.connection?.saveData) return { mode: "film", forced: false };
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 4) return { mode: "film", forced: false };
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency < 4) return { mode: "film", forced: false };
  return { mode: webgl(win, true) ? "3d" : "film", forced: false };
}

/**
 * Can this browser draw in 3D, and (strict) on hardware rather than in
 * software? A return value, never an exception: a page that logs a WebGL
 * error on a phone with no GPU has failed the parent reading it. The test
 * context is released at once, so it does not count against the page's
 * limit of live contexts.
 * @param {Window} win @param {boolean} strict
 */
export function webgl(win, strict) {
  try {
    const c = win.document.createElement("canvas");
    const opts = { failIfMajorPerformanceCaveat: strict };
    const gl = /** @type {WebGLRenderingContext | null} */ (c.getContext("webgl2", opts) || c.getContext("webgl", opts));
    if (!gl) return false;
    // A renderer that draws on the CPU (SwiftShader, llvmpipe, Microsoft's
    // Basic Render Driver) passes the caveat check in some browsers, and
    // manages a few frames a second: it gets the film.
    let soft = false;
    if (strict) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      soft = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return !soft;
  } catch {
    return false;
  }
}
