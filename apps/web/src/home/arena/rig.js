/**
 * The arena's rig: where the camera is and where the ball is, as pure
 * functions of how far the page has been read. No three.js here, so a unit
 * test can hold the path (apps/web/test/home-arena.test.mjs) and scene.js
 * only turns these numbers into a picture.
 *
 * The world is in metres, the pitch along z: the bowler's stumps at
 * z = -10.06, the batter's at z = +10.06, the rope at r = 70.
 *
 * THE SHOTS. Each section of the page carries `data-cam="<name>"`; scene.js
 * measures where each one starts (anchors()) and reads the scroll position
 * into `f`, a fractional index into those anchors (progress()). The camera is
 * at SHOTS[name] while its section is on screen and flies to the next as the
 * next arrives: `hold` is how much of the way it waits first, so a section
 * holds still under its words and the move between two is quick.
 *
 * THE DELIVERY. While the hero's five captions scroll past (f 0 → 5) the ball
 * is bowled, bounces, and is hit for six into the stands, so scrolling back
 * plays it backwards. ballAt(b) is the ball at phase b: 0 → 1 the run-up,
 * 1 → 2 the delivery, 2 → 3 the bounce to the bat, 3 → 4 the six.
 * Nobody bowls it: no figure is drawn, only the ball, its trail and the
 * footfalls of a run-up, lit as it passes.
 */

/** @typedef {[number, number, number]} V3 */
/**
 * @typedef {{ pos: V3, look: V3, fov: number, follow?: number, hold?: number, sway?: number,
 *   arc?: number, dome?: number, board?: number }} Shot
 */

/** @type {Record<string, Shot>} */
export const SHOTS = {
  // The establishing shot: high over the ground at dusk, the lights on.
  hero:     { pos: [50, 17, 60], look: [-8, 9, -28], fov: 50, sway: 0.18 },
  // 01 side-on, low, beside the run-up.
  runup:    { pos: [9, 2.0, -7], look: [0, 1.0, -19], fov: 42, follow: 0.45, sway: 0.03 },
  // 02 over the shoulder, from behind the bowler's arm.
  delivery: { pos: [1.2, 2.6, -17.5], look: [0, 0.5, 6], fov: 36, follow: 0.4, sway: 0.02 },
  // 03 overhead, the bounce.
  bounce:   { pos: [0.6, 23, 3], look: [0, 0, 4.6], fov: 42, follow: 0.45, sway: 0.03 },
  // 04 the shot: low behind the batter, looking up as it goes.
  six:      { pos: [-2.4, 1.2, 15.5], look: [-14, 13, -28], fov: 58, follow: 0.8, sway: 0.02 },
  // 05 the scoreboard.
  board:    { pos: [0, 15, -52], look: [0, 23, -94], fov: 44, sway: 0.05, board: 1 },
  // After the film: the board from the side, then round the ground.
  strip:    { pos: [34, 12, -46], look: [0, 21, -94], fov: 46, hold: 0.3, arc: 0.2, sway: 0.08 },
  tiles:    { pos: [36, 15, 36], look: [0, 0, 0], fov: 46, hold: 0.3, arc: 0.25, sway: 0.2 },
  news:     { pos: [-34, 7, 20], look: [0, 4, -12], fov: 46, hold: 0.3, arc: 0.2, sway: 0.12 },
  // For families: down at the stumps, and the ground closes over.
  families: { pos: [2.8, 1.0, 13.4], look: [0, 0.5, 10.06], fov: 40, hold: 0.25, arc: 0.12, sway: 0.04, dome: 1 },
  // For schools: up, out, the whole ground under the night.
  schools:  { pos: [0, 104, 78], look: [0, 0, -6], fov: 50, hold: 0.25, arc: 0.1, sway: 0.1, dome: 0.4 },
};

/** The order the hero's shots play in: its first screen, then the five captions. */
export const FILM = ["hero", "runup", "delivery", "bounce", "six", "board"];

export const clamp = (/** @type {number} */ x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) => a + (b - a) * t;
/** @param {number} a @param {number} b @param {number} x */
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** @param {number} t */
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Each anchor's scroll position, from its top on the page: a section's shot is
 * reached as the section's top comes up to `lead` of the screen. The first is 0.
 * Kept increasing, so a section that has not laid out yet cannot fold the path back.
 * @param {number[]} tops  page-absolute tops, in page order
 * @param {number} vh
 */
export function anchors(tops, vh, lead = 0.55) {
  /** @type {number[]} */
  const out = [];
  tops.forEach((t, i) => {
    const a = i === 0 ? 0 : Math.max(0, t - vh * lead);
    out.push(i === 0 ? a : Math.max(a, out[i - 1] + 1));
  });
  return out;
}

/**
 * The scroll position as a fractional index into the anchors: 2.5 is halfway
 * from the third section's shot to the fourth's.
 * @param {number[]} at  anchors()
 * @param {number} y     window.scrollY
 */
export function progress(at, y) {
  if (at.length < 2) return 0;
  if (y <= at[0]) return 0;
  for (let i = 0; i < at.length - 1; i++) {
    if (y < at[i + 1]) return i + (y - at[i]) / (at[i + 1] - at[i]);
  }
  return at.length - 1;
}

// ─── The ball ─────────────────────────────────────────────────────

/** Where things happen on the pitch. */
export const SPOT = {
  release: /** @type {V3} */ ([0.42, 2.3, -10.3]),
  bounce:  /** @type {V3} */ ([0.06, 0.09, 4.4]),
  bat:     /** @type {V3} */ ([-0.2, 0.95, 8.9]),
  land:    /** @type {V3} */ ([-52, 21, -74]),
};

/** The run-up's footfalls: alternate feet, closing on the crease. */
export const STRIDES = Array.from({ length: 9 }, (_, i) => {
  const u = i / 8;
  return { z: lerp(-29, -11.4, u), x: 0.42 + (i % 2 ? 0.22 : -0.22), at: u * 0.94 };
});

/**
 * The ball at phase b (see the file's header). Past 4 it stays where it landed.
 * @param {number} b
 * @returns {V3}
 */
export function ballAt(b) {
  const [rx, ry, rz] = SPOT.release, [kx, ky, kz] = SPOT.bounce, [hx, hy, hz] = SPOT.bat, [lx, ly, lz] = SPOT.land;
  if (b <= 1) {
    const u = clamp(b);
    // Carried at the hip, bobbing with each stride, then up and over in the last strides.
    const z = lerp(-30, rz, u);
    const bob = 0.07 * Math.abs(Math.sin(u * Math.PI * 8));
    const y = lerp(1.05 + bob, ry, smoothstep(0.82, 1, u));
    const x = lerp(0.62, rx, smoothstep(0.7, 1, u));
    return [x, y, z];
  }
  if (b <= 2) {
    const u = b - 1;
    return [lerp(rx, kx, u), ry - (ry - ky) * u ** 1.45, lerp(rz, kz, u)];
  }
  if (b <= 3) {
    const u = b - 2;
    return [lerp(kx, hx, u), ky + (hy - ky) * Math.sqrt(u), lerp(kz, hz, u)];
  }
  const u = clamp(b - 3);
  const uh = 1 - (1 - u) ** 1.3;   // the air takes the pace off it
  return [lerp(hx, lx, uh), lerp(hy, ly, u) + 4 * 38 * u * (1 - u), lerp(hz, lz, uh)];
}

/** The ball's phase from the film's progress f (0 → 5 over the hero's shots). @param {number} f */
export const phaseOf = (f) => clamp((f - 0.55) * 1.0, 0, 4.3);

/** Has the six landed (the board turns over)? @param {number} b */
export const landed = (b) => b >= 3.92;

// ─── The camera ───────────────────────────────────────────────────

/**
 * The camera the page asks for at progress f, before it is smoothed and swayed.
 * `names` is each anchor's shot name, in page order; `ball` is where the ball
 * is now, which a shot with `follow` turns towards.
 * @param {string[]} names
 * @param {number} f
 * @param {V3} ball
 */
export function cameraAt(names, f, ball) {
  const n = names.length;
  if (!n) return { pos: SHOTS.hero.pos, look: SHOTS.hero.look, fov: SHOTS.hero.fov, sway: 0, dome: 0, board: 0 };
  const i = Math.min(n - 1, Math.max(0, Math.floor(f)));
  const j = Math.min(n - 1, i + 1);
  const a = SHOTS[names[i]] ?? SHOTS.hero, b = SHOTS[names[j]] ?? SHOTS.hero;
  const t = clamp(f - i);
  const hold = b.hold ?? 0;
  const e = i === j ? 0 : smoother(clamp((t - hold) / (1 - hold)));
  /** @param {Shot} s @returns {V3} */
  const lookOf = (s) => {
    const k = s.follow ?? 0;
    return [lerp(s.look[0], ball[0], k), lerp(s.look[1], ball[1], k), lerp(s.look[2], ball[2], k)];
  };
  const la = lookOf(a), lb = lookOf(b);
  /** @type {V3} */
  const pos = [lerp(a.pos[0], b.pos[0], e), lerp(a.pos[1], b.pos[1], e), lerp(a.pos[2], b.pos[2], e)];
  // A move between two sections swoops up and over rather than sliding.
  const dist = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
  pos[1] += Math.sin(Math.PI * e) * Math.min(22, dist * (b.arc ?? 0));
  return {
    pos,
    look: /** @type {V3} */ ([lerp(la[0], lb[0], e), lerp(la[1], lb[1], e), lerp(la[2], lb[2], e)]),
    fov: lerp(a.fov, b.fov, e),
    sway: lerp(a.sway ?? 0, b.sway ?? 0, e),
    dome: lerp(a.dome ?? 0, b.dome ?? 0, e),
    board: lerp(a.board ?? 0, b.board ?? 0, e),
  };
}

/**
 * A portrait screen sees less across, so it is given a wider lens rather
 * than a crop of the landscape picture. @param {number} fov @param {number} aspect
 */
export const fovFor = (fov, aspect) => (aspect >= 1 ? fov : Math.min(78, fov * (1 + (1 - aspect) * 0.7)));
