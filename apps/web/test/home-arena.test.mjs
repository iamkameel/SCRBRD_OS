/**
 * The home page's arena (Kameel, 6 Nov 2026: "three.js, loaded after
 * paint"): the rig's path and the choice of picture, without a browser.
 * tools/smoke-browser-home.mjs (group 4c) walks the real scene.
 *
 *   - Every camera shot a section names (data-cam / cam=) exists in rig.js,
 *     and the hero's five captions name the film's shots in its order.
 *   - The ball's path is continuous through the run-up, the delivery, the
 *     bounce and the six, never under the ground, over the floodlights, and
 *     lands in the stands.
 *   - The scroll is read into a progress that only goes forward with it, and
 *     the camera is exactly at a section's shot when the page is there.
 *   - arena/capable.js: reduced motion gets the stills whatever is asked; a
 *     small device, Save-Data, no WebGL or a software renderer get the film;
 *     a hardware GPU gets the scene; ?arena= picks by hand.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/home-arena.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { SHOTS, FILM, SPOT, anchors, progress, ballAt, cameraAt, phaseOf, landed } from "../src/home/arena/rig.js";
import { arenaMode } from "../src/home/arena/capable.js";
import { SHOT_CAMS } from "../src/home/sections/Hero.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);
const near = (a, b, e = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < e);

group("A. The shots the page names are the shots the rig has");
{
  ok("the hero's captions name the film's shots, in order", JSON.stringify(SHOT_CAMS) === JSON.stringify(FILM.slice(1)), SHOT_CAMS.join(","));
  const dir = new URL("../src/home/sections/", import.meta.url);
  const src = readdirSync(dir).filter((f) => f.endsWith(".jsx")).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
  const named = [...src.matchAll(/(?:data-cam|cam)=["{]"?([a-z]+)"/g)].map((m) => m[1]);
  ok("every cam a section names is a shot", named.length >= 5 && named.every((n) => n in SHOTS), named.filter((n) => !(n in SHOTS)).join(","));
  ok("every shot is finite", Object.values(SHOTS).every((s) => [...s.pos, ...s.look, s.fov].every(Number.isFinite)));
}

group("B. The delivery");
{
  ok("continuous at release, bounce and bat", [1, 2, 3].every((b) => near(ballAt(b - 1e-9), ballAt(b + 1e-9), 1e-3)));
  ok("released at the release point, pitches at the bounce, meets the bat, lands in the stands",
     near(ballAt(1), SPOT.release, 1e-9) && near(ballAt(2), SPOT.bounce, 1e-9) && near(ballAt(3), SPOT.bat, 1e-9) && near(ballAt(4), SPOT.land, 1e-6));
  let low = Infinity, peak = 0;
  for (let b = 0; b <= 4.3; b += 0.001) { const y = ballAt(b)[1]; low = Math.min(low, y); peak = Math.max(peak, y); }
  ok("never under the ground", low > 0, low);
  ok("the six goes over the floodlights (46 m)", peak > 46, peak);
  ok("the board turns over only once the six has landed", !landed(phaseOf(4.2)) && landed(phaseOf(4.9)));
}

group("C. The scroll and the camera");
{
  const at = anchors([0, 1000, 1000, 2600, 2400, 5000], 800);
  ok("anchors only go forward, even when a section has not laid out", at.every((a, i) => i === 0 || a > at[i - 1]), at.join(","));
  let prev = -1, mono = true;
  for (let y = -100; y < 6000; y += 7) { const f = progress(at, y); if (f < prev - 1e-9) mono = false; prev = f; }
  ok("progress follows the scroll forward, and stays inside the anchors", mono && progress(at, -100) === 0 && progress(at, 99999) === at.length - 1);
  const names = [...FILM, "strip", "tiles", "families", "schools"];
  const c = cameraAt(names, names.indexOf("tiles"), [0, 0, 0]);
  ok("at a section, the camera is at its shot", near(c.pos, SHOTS.tiles.pos) && near(c.look, SHOTS.tiles.look) && c.fov === SHOTS.tiles.fov);
  const mid = cameraAt(names, names.indexOf("tiles") + 0.15, [0, 0, 0]);
  ok("a section's shot holds while its section is read", near(mid.pos, SHOTS.tiles.pos), mid.pos.join(","));
  let finite = true;
  for (let f = 0; f <= names.length - 1; f += 0.01) { const k = cameraAt(names, f, ballAt(phaseOf(f))); if (![...k.pos, ...k.look, k.fov].every(Number.isFinite) || k.pos[1] < 0.3) finite = false; }
  ok("the whole flight is finite and above the ground", finite);
}

group("D. Which picture: arena/capable.js");
{
  /** A window to ask, without a browser. */
  const win = ({ reduce = false, search = "", mem, cores, save = false, gl = "ANGLE (NVIDIA GeForce)", caveat = false } = {}) => ({
    matchMedia: (q) => ({ matches: reduce && /reduce/.test(q) }),
    location: { search },
    navigator: { deviceMemory: mem, hardwareConcurrency: cores, connection: { saveData: save } },
    document: { createElement: () => ({ getContext: (_k, o) => (gl === null || (caveat && o?.failIfMajorPerformanceCaveat) ? null : {
      RENDERER: 1, getParameter: (p) => (p === 2 || p === 1 ? gl : 0), getExtension: (n) => (n === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 2 } : { loseContext() {} }),
    }) }) },
  });
  const m = (o) => arenaMode(/** @type {any} */ (win(o)));
  ok("a hardware GPU gets the scene", m({}).mode === "3d" && m({ mem: 8, cores: 8 }).mode === "3d");
  ok("reduced motion gets the stills, whatever is asked", m({ reduce: true }).mode === "stills" && m({ reduce: true, search: "?arena=3d" }).mode === "stills");
  ok("a small device gets the film: under 4 GB, under four cores, Save-Data", m({ mem: 2 }).mode === "film" && m({ cores: 2 }).mode === "film" && m({ save: true }).mode === "film");
  ok("no WebGL, or a GL with a major performance caveat, gets the film", m({ gl: null }).mode === "film" && m({ caveat: true }).mode === "film");
  ok("a software renderer gets the film", m({ gl: "Google SwiftShader" }).mode === "film" && m({ gl: "llvmpipe (LLVM 15.0.7, 256 bits)" }).mode === "film");
  ok("?arena=3d picks the scene by hand on software GL, and says it was picked", m({ gl: "SwiftShader", search: "?arena=3d" }).mode === "3d" && m({ search: "?arena=3d" }).forced);
  ok("?arena=2d picks the film", m({ search: "?arena=2d" }).mode === "film");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
