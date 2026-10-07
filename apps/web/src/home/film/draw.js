/**
 * The film of one delivery (the home page's centrepiece, Kameel 2026-10-03):
 * five shots drawn in code on one canvas, each a pure function of where the
 * reader has scrolled to. Nothing here keeps state between frames — a frame
 * is drawn from `s` alone — so scrolling back plays the film backwards, a
 * still for the storyboard is the same call at a fixed `s`, and a resize is
 * one redraw.
 *
 *   1  SIDE-ON           the run-up, floodlit ground at dusk, parallax layers
 *   2  OVER THE SHOULDER the delivery stride; the batter, stumps and keeper far off
 *   3  OVERHEAD          the pitch from above; the ball, its seam, the bounce
 *   4  THE SHOT          the swing, and the ball over the floodlights for six
 *   5  THE SCOREBOARD    U14A 87/3 → 93/3, flip digits; a SAMPLE, team-level
 *
 * The figures are silhouettes with a rim of floodlight: nobody in particular,
 * no face, no kit colours, no crest, no number, no name. The board is the only
 * score, it is labelled SAMPLE on its face, and it names a team, not a child.
 *
 * `s` runs 0 → FILM_SCREENS: one unit is one screen height of scroll.
 */

/** How many screens of scroll the film plays over (the stage is pinned for this long). */
export const FILM_SCREENS = 5;

/** Each shot's span of `s`, and the moment a still of it is taken from. */
export const SHOTS = [
  { from: 0,    to: 1.45, still: 0.62 },
  { from: 1.45, to: 2.45, still: 0.62 },
  { from: 2.45, to: 3.45, still: 0.78 },
  { from: 3.45, to: 4.45, still: 0.42 },
  { from: 4.45, to: 5,    still: 1 },
];

const XF = 0.06;   // half-width of the cut between two shots, in screens

const PI = Math.PI;
const rad = (d) => (d * PI) / 180;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (p, a, b) => clamp((p - a) / (b - a));
const eio = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const eout = (t) => 1 - (1 - t) ** 3;
const ein = (t) => t * t;

/** A small seeded random, so the stands and the stars are the same on every frame. */
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = {
  ink: "#04070b",
  inkFar: "#0d141c",
  rim: "rgba(240,246,222,0.9)",
  turfFar: "#24733f",
  turfNear: "#0b2f1d",
  clay: "#b99a60",
  clayFar: "#d2b67c",
  creaseLine: "rgba(255,255,255,0.9)",
  lamp: "#fffbea",
  ball: "#c8262f",
  seam: "#f6efdc",
  board: "#0b0e0b",
  figure: "#f4f6f3",
  lime: "#b9f227",
  dim: "#8a94a5",
};

const MONO = "'DM Mono', ui-monospace, monospace";
const HEAD = "'Syne', system-ui, sans-serif";

// ─── Scenery ──────────────────────────────────────────────────────

/** The sky at dusk down to the horizon `hz`; `span` is how tall the gradient reads. */
function sky(ctx, w, h, hz, span = h) {
  const top = hz - span * 1.25;
  const g = ctx.createLinearGradient(0, top, 0, hz);
  g.addColorStop(0, "#020409");
  g.addColorStop(0.42, "#061024");
  g.addColorStop(0.7, "#112c4c");
  g.addColorStop(0.85, "#2c3c5c");
  g.addColorStop(0.94, "#7d4c5e");
  g.addColorStop(1, "#d9864c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, Math.min(h, hz + 2));
}

const STARS = (() => {
  const r = rng(7);
  return Array.from({ length: 70 }, () => ({ x: r(), y: r(), s: r() * 1.3 + 0.4, a: r() * 0.6 + 0.2 }));
})();

/** Stars above the horizon, drifting `dx` px with the camera. */
function stars(ctx, w, hz, dx = 0, dy = 0) {
  ctx.fillStyle = "#ffffff";
  for (const st of STARS) {
    const x = (((st.x * w * 1.5 - dx) % (w * 1.5)) + w * 1.5) % (w * 1.5);
    const y = st.y * hz * 0.75 + dy;
    if (x > w || y > hz * 0.8 || y < 0) continue;
    ctx.globalAlpha = st.a * clamp((hz * 0.8 - y) / (hz * 0.4));
    ctx.fillRect(x, y, st.s, st.s);
  }
  ctx.globalAlpha = 1;
}

const LAYOUTS = new Map();
/** Where the stands' tiers and lit seats are, for one seed and width: worked out once, not every frame. */
function standsLayout(seed, period) {
  const key = `${seed}:${period}`;
  if (LAYOUTS.has(key)) return LAYOUTS.get(key);
  const r = rng(seed);
  const tiers = [];
  for (let x = 0; x < period; ) {
    const len = period * (0.12 + r() * 0.16);
    tiers.push({ x, len, top: 0.55 + r() * 0.45, roof: r() > 0.3, low: r() > 0.86 });
    x += len;
  }
  const lr = rng(seed + 11);
  const specks = tiers.map((t) => Array.from({ length: Math.round(t.len / 9) }, () => [lr(), lr(), lr()]));
  if (LAYOUTS.size > 12) LAYOUTS.clear();
  LAYOUTS.set(key, { tiers, specks });
  return { tiers, specks };
}

/** The stands: a row of roofed stands that repeats every so often, scrolled by `off`. */
function stands(ctx, w, base, height, off, seed = 3) {
  const period = Math.max(900, Math.round(w * 1.4));
  const { tiers, specks } = standsLayout(seed, period);
  const o = ((off % period) + period) % period;
  for (let k = -1; k * period - o < w; k++) {
    const x0 = k * period - o;
    tiers.forEach((t, ti) => {
      const X = x0 + t.x + 3, L = t.len - 6;
      if (X > w || X + L < 0) return;
      const top = base - height * (t.low ? 0.2 : t.top);
      ctx.fillStyle = "#0c141d";
      ctx.fillRect(X, top, L, base - top);
      if (t.low) return;
      // Rows of seats catching the light, and the crowd's own small lights.
      ctx.fillStyle = "rgba(150,180,210,0.07)";
      for (let y = top + 4; y < base - 2; y += 5) ctx.fillRect(X, y, L, 1);
      ctx.fillStyle = "rgba(255,214,150,0.6)";
      for (const [sx, sy, on] of specks[ti]) if (on > 0.45) ctx.fillRect(X + sx * L, top + 3 + sy * (base - top - 5), 1.6, 1.4);
      if (t.roof) {
        const rt = top - height * 0.22;
        ctx.fillStyle = "#0d151e";
        for (let c = 0; c <= 4; c++) ctx.fillRect(X + (L * c) / 4 - 1, rt, 2, top - rt);
        ctx.fillStyle = "#0a1017";
        ctx.beginPath(); ctx.moveTo(X - L * 0.03, rt + height * 0.06); ctx.lineTo(X + L * 1.03, rt + height * 0.06); ctx.lineTo(X + L * 0.98, rt); ctx.lineTo(X + L * 0.02, rt); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255,232,190,0.4)";
        ctx.fillRect(X - L * 0.03, rt + height * 0.06, L * 1.06, 1);
      } else {
        ctx.fillStyle = "rgba(255,232,190,0.25)";
        ctx.fillRect(X, top, L, 1);
      }
    });
  }
}

/** A floodlight pylon from `base` up to `top` at x, `s` its scale, `glow` 0..1. */
function pylon(ctx, x, base, top, s, glow = 1) {
  const hw = 26 * s, hh = 18 * s;
  ctx.strokeStyle = "#0b1119";
  ctx.lineWidth = Math.max(1, 2.2 * s);
  ctx.beginPath();
  ctx.moveTo(x - 8 * s, base); ctx.lineTo(x - 3 * s, top);
  ctx.moveTo(x + 8 * s, base); ctx.lineTo(x + 3 * s, top);
  const n = Math.max(4, Math.round((base - top) / (22 * s)));
  for (let i = 0; i < n; i++) {
    const y0 = lerp(base, top, i / n), y1 = lerp(base, top, (i + 1) / n);
    const w0 = lerp(8, 3, i / n) * s, w1 = lerp(8, 3, (i + 1) / n) * s;
    ctx.moveTo(x - w0, y0); ctx.lineTo(x + w1, y1);
  }
  ctx.stroke();
  // The head: a frame of lamps.
  ctx.fillStyle = "#121922";
  ctx.fillRect(x - hw - 2 * s, top - hh - 2 * s, hw * 2 + 4 * s, hh + 4 * s);
  ctx.fillStyle = C.lamp;
  const cols = 5, rows = 3, gw = (hw * 2) / cols, gh = hh / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) ctx.fillRect(x - hw + i * gw + gw * 0.12, top - hh + j * gh + gh * 0.14, gw * 0.76, gh * 0.72);
  if (glow <= 0) return;
  ctx.globalCompositeOperation = "lighter";
  const cy = top - hh / 2;
  const far = glow < 0.6;   // a far pylon: a tight glow, no halo (cheaper, and right for the distance)
  const r1 = far ? 90 * s : 170 * s;
  let g = ctx.createRadialGradient(x, cy, 0, x, cy, r1);
  g.addColorStop(0, `rgba(255,244,214,${far ? 0.6 : 0.75 * glow})`);
  g.addColorStop(0.25, `rgba(255,226,170,${far ? 0.18 : 0.22 * glow})`);
  g.addColorStop(1, "rgba(255,226,170,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r1, cy - r1, r1 * 2, r1 * 2);
  if (far) { ctx.globalCompositeOperation = "source-over"; return; }
  g = ctx.createRadialGradient(x, cy, 0, x, cy, 320 * s);
  g.addColorStop(0, `rgba(160,200,255,${0.12 * glow})`);
  g.addColorStop(1, "rgba(160,200,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - 320 * s, cy - 320 * s, 640 * s, 640 * s);
  ctx.globalCompositeOperation = "source-over";
}

/** A cone of light from a pylon's head down to the ground. */
function cone(ctx, x, top, groundY, spread, alpha = 0.06) {
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createLinearGradient(0, top, 0, groundY);
  g.addColorStop(0, `rgba(255,240,205,${alpha})`);
  g.addColorStop(1, "rgba(255,240,205,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - 12, top); ctx.lineTo(x + 12, top);
  ctx.lineTo(x + spread * 0.35, groundY); ctx.lineTo(x - spread, groundY);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

function vignette(ctx, w, h, k = 0.55) {
  const g = ctx.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.8);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${k})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** A streak behind a moving ball: `pts` from the oldest to the newest, tapering to nothing. */
function streak(ctx, pts, r, rgb) {
  ctx.lineCap = "round";
  for (let i = 1; i < pts.length; i++) {
    const t = i / pts.length;
    ctx.strokeStyle = `rgba(${rgb},${0.5 * t * t})`;
    ctx.lineWidth = Math.max(1, r * 1.6 * t);
    ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
  }
}

// ─── Figures ──────────────────────────────────────────────────────
//
// A side-on figure is a hip, a torso and four limbs, each an angle in
// degrees: 0 points down, 90 points the way the figure faces, 180 up. A pose
// is a plain object, so a run cycle and a bowling action are functions that
// return one.

const dir = (a, f) => [Math.sin(rad(a)) * f, Math.cos(rad(a))];
const step = (x, y, a, len, f) => { const [dx, dy] = dir(a, f); return [x + dx * len, y + dy * len]; };

/**
 * Draw a side-on silhouette. pose: { x, y (the hip, px), H (height, px),
 * f (1 faces right, -1 left), lean, arms: [[upper, fore], [upper, fore]],
 * legs: [[thigh, shin], [thigh, shin]], helmet?, pads?, bat?: {a, len},
 * hands?: [x, y] }. The first arm and leg are the far ones.
 */
function figure(ctx, P, rim = C.rim, fill = C.ink) {
  const { x, y, H, f = 1 } = P;
  const ta = 180 - (P.lean ?? 8);
  const neck = step(x, y, ta, H * 0.3, f);
  const head = step(neck[0], neck[1], ta, H * 0.085, f);
  const sh = step(x, y, ta, H * 0.27, f);
  const parts = [];
  const line = (a, b, wdt, far) => parts.push({ a, b, wdt, far });
  const leg = (L, far) => {
    const knee = step(x, y, L[0], H * 0.245, f);
    const foot = step(knee[0], knee[1], L[1], H * 0.245, f);
    line([x, y], knee, H * (P.pads ? 0.085 : 0.075), far);
    line(knee, foot, H * (P.pads ? 0.08 : 0.058), far);
    line(foot, step(foot[0], foot[1], L[1] + 95, H * 0.07, f), H * 0.045, far);
  };
  const arm = (A, far) => {
    const el = step(sh[0], sh[1], A[0], H * 0.165, f);
    const hand = step(el[0], el[1], A[1], H * 0.155, f);
    line(sh, el, H * 0.05, far);
    line(el, hand, H * 0.044, far);
    return hand;
  };
  const legs = P.legs ?? [[0, 0], [0, 0]];
  const arms = P.arms ?? [[0, 0], [0, 0]];
  leg(legs[0], true);
  let hand = null;
  if (!P.hands) arm(arms[0], true);
  line([x, y], neck, H * 0.13, false);
  leg(legs[1], false);
  if (P.hands) {
    // Both hands on the bat: one arm, shoulder to the hands, elbow eased out.
    const [hx, hy] = P.hands;
    const mx = (sh[0] + hx) / 2 + f * H * 0.03, my = (sh[1] + hy) / 2 + H * 0.02;
    line(sh, [mx, my], H * 0.055, false);
    line([mx, my], [hx, hy], H * 0.05, false);
    hand = P.hands;
  } else hand = arm(arms[1], false);

  const bat = P.bat && hand ? (() => {
    const handle = step(hand[0], hand[1], P.bat.a, P.bat.len * 0.32, f);
    const toe = step(hand[0], hand[1], P.bat.a, P.bat.len, f);
    return { hand, handle, toe };
  })() : null;

  for (const pass of [0, 1]) {
    const dx = pass ? 0 : -H * 0.012 * f, dy = pass ? 0 : -H * 0.01;
    ctx.lineCap = "round";
    for (const p of parts) {
      ctx.strokeStyle = pass ? (p.far ? "#0b1218" : fill) : rim;
      ctx.lineWidth = p.wdt + (pass ? 0 : H * 0.008);
      ctx.beginPath(); ctx.moveTo(p.a[0] + dx, p.a[1] + dy); ctx.lineTo(p.b[0] + dx, p.b[1] + dy); ctx.stroke();
    }
    if (bat) {
      ctx.strokeStyle = pass ? fill : rim;
      ctx.lineWidth = H * 0.022 + (pass ? 0 : H * 0.008);
      ctx.beginPath(); ctx.moveTo(bat.hand[0] + dx, bat.hand[1] + dy); ctx.lineTo(bat.handle[0] + dx, bat.handle[1] + dy); ctx.stroke();
      ctx.lineCap = "butt";
      ctx.lineWidth = H * 0.06 + (pass ? 0 : H * 0.008);
      ctx.beginPath(); ctx.moveTo(bat.handle[0] + dx, bat.handle[1] + dy); ctx.lineTo(bat.toe[0] + dx, bat.toe[1] + dy); ctx.stroke();
      ctx.lineCap = "round";
    }
    ctx.fillStyle = pass ? fill : rim;
    ctx.beginPath(); ctx.arc(head[0] + dx, head[1] + dy, H * (P.helmet ? 0.072 : 0.064), 0, PI * 2); ctx.fill();
    if (P.helmet) {
      // The peak, and the grille in front of the face: a helmet, not a face.
      ctx.strokeStyle = pass ? fill : rim;
      ctx.lineWidth = H * 0.018;
      ctx.beginPath(); ctx.moveTo(head[0] + dx, head[1] - H * 0.02 + dy); ctx.lineTo(head[0] + f * H * 0.105 + dx, head[1] - H * 0.005 + dy); ctx.stroke();
    }
  }
  return { head, hand, bat };
}

/** A run cycle at phase `ph` (radians), amplitude `amp` 0..1 (a walk is low). */
function runPose(ph, amp) {
  const s = Math.sin(ph), c = Math.cos(ph);
  const th = 34 * amp;
  const flex = (cc, ss) => 12 + 80 * amp * Math.max(0, cc) * (ss < 0.4 ? 1 : 0.4);
  const t0 = th * s + 6, t1 = -th * s + 6;
  return {
    lean: 6 + 12 * amp,
    legs: [[t0, t0 - flex(c, s)], [t1, t1 - flex(-c, -s)]],
    arms: [[-38 * amp * -s - 5, -38 * amp * -s + 75], [-38 * amp * s - 5, -38 * amp * s + 75]],
    bob: Math.abs(c) * 0.03 * amp,
  };
}

// ─── 1 · SIDE-ON: the run-up ──────────────────────────────────────

const CREASE = 19;   // where the run-up ends, in metres from the mark

/** The bowler's place and pose on the run-up, from shot 1's progress. */
function runUp(p) {
  const run = seg(p, 0.06, 0.84);
  const u = run;
  const x = CREASE * (0.25 * u + 0.75 * u * u);
  const amp = lerp(0.25, 1, eout(seg(p, 0.06, 0.4)));
  const ph = (x / 1.55) * PI + seg(p, 0, 0.06) * 0.6;
  let pose = runPose(ph, p < 0.06 ? 0.15 : amp);
  let hip = 0.96 - pose.bob;
  let jx = 0;
  if (p > 0.84) {
    // The gather: a leap into the delivery stride, the front arm up.
    const q = eio(seg(p, 0.84, 1));
    jx = q * 1.4;
    hip += Math.sin(q * PI * 0.9) * 0.28;
    pose = {
      lean: lerp(pose.lean, -6, q),
      legs: [[lerp(pose.legs[0][0], -25, q), lerp(pose.legs[0][1], -55, q)], [lerp(pose.legs[1][0], 78, q), lerp(pose.legs[1][1], 18, q)]],
      arms: [[lerp(pose.arms[0][0], 168, q), lerp(pose.arms[0][1], 172, q)], [lerp(pose.arms[1][0], -95, q), lerp(pose.arms[1][1], -110, q)]],
      bob: 0,
    };
  }
  return { x: x + jx, hip, pose };
}

function shot1(ctx, w, h, p) {
  // On a phone the bowler runs in from the left once the first screen's words
  // have gone, and the action sits in the middle, clear of the captions below.
  const wide = w > h;
  const hz = h * (wide ? 0.6 : 0.5);
  const k = (h * (wide ? 0.32 : 0.27)) / 1.7;          // px per metre at the bowler
  const b = runUp(p);
  const anchor = (wide ? lerp(0.56, 0.62, eio(seg(p, 0, 0.9))) : lerp(-0.35, 0.5, eout(seg(p, 0.04, 0.5)))) * w;
  const camX = b.x - anchor / k + 0.4;
  const pan = camX * k;
  sky(ctx, w, h, hz, h * 0.7);
  stars(ctx, w, hz, pan * 0.02);
  // Far: pylons, the sight screen, the stands; each slower than the one in front.
  const foot = hz + (h - hz) * (wide ? 0.62 : 0.42);
  const gap = Math.max(w * 0.62, 420), po = pan * 0.14;
  for (let i = Math.floor((po - 300) / gap); i * gap - po < w + 300; i++) {
    const x = i * gap - po + gap * 0.3;
    cone(ctx, x, hz - h * 0.42, foot, w * 0.5, 0.05);
    pylon(ctx, x, hz - 4, hz - h * 0.42, Math.max(0.55, h / 1100), 1);
  }
  stands(ctx, w, hz + 2, h * 0.085, pan * 0.32, 3);
  // The sight screen at the far end, white under the lights.
  const ssx = 44 * k * 0.5 - pan * 0.4 + w * 0.6;
  ctx.fillStyle = "#dfe5ea";
  ctx.fillRect(ssx, hz - h * 0.075, h * 0.17, h * 0.075);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(ssx - 6, hz - h * 0.08, h * 0.17 + 12, h * 0.085);
  // The turf: lit far, dark near; mown bands that move with the camera.
  const g = ctx.createLinearGradient(0, hz, 0, h);
  g.addColorStop(0, C.turfFar); g.addColorStop(0.5, "#14492b"); g.addColorStop(1, C.turfNear);
  ctx.fillStyle = g;
  ctx.fillRect(0, hz, w, h - hz);
  // The boundary boards: a dark band along the far edge of the outfield.
  const bb = hz + (h - hz) * 0.06;
  ctx.fillStyle = "#0a1a12";
  ctx.fillRect(0, hz, w, bb - hz);
  ctx.fillStyle = "rgba(185,242,39,0.35)";
  const bp = 140, bo = ((pan * 0.62) % bp + bp) % bp;
  for (let x = -bo; x < w; x += bp) ctx.fillRect(x, hz + (bb - hz) * 0.45, bp * 0.45, 1.5);
  // Mown stripes: alternate bands, across the line of the run.
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  const sp = 3.2 * k, so = ((pan % (sp * 2)) + sp * 2) % (sp * 2);
  for (let x = -so - sp * 2; x < w + sp * 2; x += sp * 2) {
    ctx.beginPath();
    ctx.moveTo(x + (w / 2 - x) * 0.6, bb); ctx.lineTo(x + sp + (w / 2 - x - sp) * 0.6, bb);
    ctx.lineTo(x + sp - (w / 2 - x - sp) * 0.25, h); ctx.lineTo(x - (w / 2 - x) * 0.25, h);
    ctx.closePath(); ctx.fill();
  }
  // The pitch: a strip of clay from the bowler's crease on.
  const sx = (m) => w * 0 + m * k - pan;
  const pTop = foot - h * 0.022, pBot = foot + h * 0.03;
  const p0 = sx(CREASE - 1.2);
  if (p0 < w) {
    const cg = ctx.createLinearGradient(0, pTop, 0, pBot);
    cg.addColorStop(0, C.clayFar); cg.addColorStop(1, C.clay);
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.moveTo(p0 + 10, pTop); ctx.lineTo(w + 10, pTop); ctx.lineTo(w + 10, pBot); ctx.lineTo(p0 - 6, pBot); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = C.creaseLine; ctx.lineWidth = 2;
    for (const m of [CREASE, CREASE + 1.22]) {
      const cx = sx(m);
      ctx.beginPath(); ctx.moveTo(cx + 6, pTop); ctx.lineTo(cx - 3, pBot); ctx.stroke();
    }
    // The stumps at this end, and the umpire behind them.
    const st = sx(CREASE) + 2;
    ctx.strokeStyle = "#f3ead6"; ctx.lineWidth = Math.max(2, k * 0.04);
    for (const d of [-0.12, 0, 0.12]) { ctx.beginPath(); ctx.moveTo(st + d * k * 0.5, foot - 2); ctx.lineTo(st + d * k * 0.5, foot - 0.71 * k); ctx.stroke(); }
    const um = sx(CREASE - 1.6);
    figure(ctx, { x: um, y: foot - 0.82 * k * 0.92 - h * 0.012, H: 1.75 * k * 0.92, f: 1, lean: 4, legs: [[4, 2], [-4, -2]], arms: [[-6, 10], [8, 30]] }, "rgba(240,246,222,0.45)", "#060a0f");
  }
  // The bowler.
  const H = 1.7 * k;
  const bx = sx(b.x);
  const by = foot - H * 0.47 - (b.hip - 0.96) * k * 1.2;
  // A shadow under the feet, one for each floodlight.
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  for (const d of [-1, 1]) { ctx.beginPath(); ctx.ellipse(bx + d * H * 0.18, foot + 3, H * 0.22, H * 0.025, 0, 0, PI * 2); ctx.fill(); }
  const fig = figure(ctx, { x: bx, y: by, H, f: 1, ...b.pose });
  // The ball, in the bowling hand.
  if (fig.hand) { ctx.fillStyle = C.ball; ctx.beginPath(); ctx.arc(fig.hand[0], fig.hand[1], Math.max(2.5, H * 0.022), 0, PI * 2); ctx.fill(); }
  // Foreground: blades of grass and blurred light, passing faster than anything.
  const fp = pan * 1.5;
  ctx.fillStyle = "rgba(4,12,8,0.85)";
  const fr = rng(41);
  for (let i = 0; i < 26; i++) {
    const base = fr() * w * 2.2;
    const x = (((base - fp) % (w * 2.2)) + w * 2.2) % (w * 2.2) - w * 0.1;
    const hh = h * (0.03 + fr() * 0.06);
    ctx.beginPath(); ctx.moveTo(x, h); ctx.quadraticCurveTo(x + 6, h - hh * 0.6, x + 2 + fr() * 14, h - hh); ctx.lineTo(x + 7, h); ctx.closePath(); ctx.fill();
  }
}

// ─── 2 · OVER THE SHOULDER: the delivery ──────────────────────────

const ZS = 22.1;     // the far stumps, metres from the camera
const ZB = 16.4;     // where the ball pitches

function shot2(ctx, w, h, p) {
  const hz = h * 0.4;
  const f = h * lerp(0.95, 1.4, eio(p));
  const camX = -0.55, camY = 2.0;
  const vx = w * (w > h ? 0.46 : 0.5);
  const P = (X, Y, Z) => [vx + (f * (X - camX)) / Z, hz + (f * (camY - Y)) / Z];
  sky(ctx, w, h, hz, h * 0.5);
  stars(ctx, w, hz, 0, 0);
  // Pylons either side, the stands across the horizon, the sight screen.
  const sc = Math.max(0.45, h / 1300) * lerp(1, 1.18, p);
  for (const [px, ht] of [[0.06, 0.34], [0.94, 0.34], [0.3, 0.22], [0.72, 0.2]]) {
    const x = vx + (px - 0.5) * w * lerp(1.15, 1.35, p);
    const near = ht > 0.3;
    if (near) cone(ctx, x, hz - h * ht, hz + h * 0.2, w * 0.4, 0.045);
    pylon(ctx, x, hz, hz - h * ht, sc * (near ? 1 : 0.7), near ? 1 : 0.5);
  }
  stands(ctx, w, hz + 1, h * 0.06, -vx + w * 0.5, 9);
  // The outfield, with mown stripes running away to the sight screen.
  const g = ctx.createLinearGradient(0, hz, 0, h);
  g.addColorStop(0, C.turfFar); g.addColorStop(1, C.turfNear);
  ctx.fillStyle = g;
  ctx.fillRect(0, hz, w, h - hz);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  for (let X = -60; X < 60; X += 6) {
    const a = P(X, 0, 2), b = P(X + 3, 0, 2), c = P(X + 3, 0, 90), d = P(X, 0, 90);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
  }
  const [s0x, s0y] = P(-5, 5.5, 88), [s1x, s1y] = P(5, 0, 88);
  ctx.fillStyle = "#e3e8ec";
  ctx.fillRect(s0x, s0y, s1x - s0x, s1y - s0y);
  // The pitch.
  const corners = [P(-1.52, 0, 2.4), P(1.52, 0, 2.4), P(1.52, 0, 24.5), P(-1.52, 0, 24.5)];
  const cg = ctx.createLinearGradient(0, corners[0][1], 0, corners[2][1]);
  cg.addColorStop(0, C.clay); cg.addColorStop(1, C.clayFar);
  ctx.fillStyle = cg;
  ctx.beginPath(); corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = C.creaseLine;
  ctx.lineWidth = Math.max(1, f * 0.05 / ZS);
  for (const Z of [ZS - 1.22, ZS]) { const a = P(-1.32, 0, Z), b = P(1.32, 0, Z); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  // The keeper, crouched behind the stumps; then the stumps; then the batter.
  const kh = (f * 1.75) / (ZS + 2);
  const [kx, ky] = P(-0.3, 0.62, ZS + 2);
  figure(ctx, { x: kx, y: ky, H: kh, f: -1, lean: 38, helmet: true, legs: [[70, -40], [60, -50]], arms: [[60, 10], [70, 20]] }, "rgba(240,246,222,0.5)", "#081017");
  ctx.strokeStyle = "#f3ead6";
  ctx.lineWidth = Math.max(1.5, (f * 0.04) / ZS);
  for (const X of [-0.11, 0, 0.11]) { const a = P(X, 0, ZS), b = P(X, 0.71, ZS); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  const bh = (f * 1.65) / (ZS - 1);
  const [btx, bty] = P(0.62, 0.86, ZS - 1);
  figure(ctx, { x: btx, y: bty, H: bh, f: -1, lean: 24, helmet: true, pads: true, legs: [[14, 2], [-12, 4]], arms: [[18, 30], [18, 30]], hands: P(0.36, 0.72, ZS - 1.3), bat: { a: -8, len: bh * 0.52 } });

  // The bowler from behind, over the camera's shoulder: low in the frame, cut off at the edge.
  const rel = 0.55;
  const H = h * (w > h ? 0.95 : 0.82);
  const cx = w * (w > h ? 0.66 : 0.8) - eio(seg(p, 0.5, 1)) * w * 0.05;
  const hy = h * 1.06 + eio(seg(p, 0.45, 0.8)) * h * 0.03;
  // The ball: from the hand at release (p .55) on its way down the pitch.
  const ballP = (q) => P(lerp(0.42, 0.1, q), lerp(2.35, 0.3, ein(q) * 0.9 + q * 0.1), lerp(3.0, ZB * 0.95, q));
  let hand = null;
  const drawBall = () => {
    if (p <= rel || !hand) return;
    const q = seg(p, rel, 1.08);
    const from = ballP(0);
    const at = (qq) => { const b = ballP(qq), m = 1 - eout(Math.min(1, qq / 0.4)); return [b[0] + (hand[0] - from[0]) * m, b[1] + (hand[1] - from[1]) * m]; };
    const Z = lerp(3.0, ZB * 0.95, q);
    const r = Math.max(2.5, lerp(H * 0.024, (f * 0.036) / Z, eout(Math.min(1, q / 0.4))));
    streak(ctx, Array.from({ length: 9 }, (_, i) => at(Math.max(0, q - (8 - i) * 0.02))), r, "255,150,130");
    const [bx, by] = at(q);
    ctx.fillStyle = C.ball; ctx.beginPath(); ctx.arc(bx, by, r, 0, PI * 2); ctx.fill();
  };
  hand = backView(ctx, cx, hy, H, p, rel);
  drawBall();
}

/**
 * The bowler seen from behind, right arm over, from the gather (p 0) through
 * release (p `rel`) to the follow-through. Returns where the hand is at
 * release, so the ball leaves from it.
 */
function backView(ctx, cx, hy, H, p, rel) {
  const armAt = (pp) => rad(lerp(-50, -330, eio(seg(pp, 0.05, 0.85))));
  const tilt = rad(lerp(-3, 16, eio(seg(p, 0.35, 0.9))));
  const lean = lerp(0, 0.18, eio(seg(p, 0.4, 0.95)));
  const shW = H * 0.25, hipW = H * 0.16, tl = H * 0.31 * (1 - lean);
  const up = [Math.sin(tilt), -Math.cos(tilt)], across = [Math.cos(tilt), Math.sin(tilt)];
  const neck = [cx + up[0] * tl, hy + up[1] * tl];
  const shL = [neck[0] - (across[0] * shW) / 2, neck[1] - (across[1] * shW) / 2 + H * 0.025];
  const shR = [neck[0] + (across[0] * shW) / 2, neck[1] + (across[1] * shW) / 2 + H * 0.025];
  const arm = H * 0.34;
  const handOf = (pp, sh) => {
    const lat = pp < 0.6 ? 0.14 : lerp(0.14, -0.62, eio(seg(pp, 0.6, 0.95)));
    return [sh[0] + arm * lat, sh[1] + arm * Math.cos(armAt(pp))];
  };
  const handR = handOf(p, shR);
  const fa = rad(lerp(-195, -15, eio(seg(p, 0.08, 0.7))));
  const handL = [shL[0] - arm * lerp(0.2, 0.42, seg(p, 0.1, 0.7)), shL[1] + arm * Math.cos(fa) * 0.95];
  const elbow = (sh, hand, out) => [(sh[0] + hand[0]) / 2 + out * H * 0.03, (sh[1] + hand[1]) / 2];
  const head = [neck[0] + up[0] * H * 0.1, neck[1] + up[1] * H * 0.1 * (1 - lean * 0.6)];
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const pass of [0, 1]) {
    const ink = pass ? C.ink : "rgba(236,244,214,0.8)";
    const o = pass ? 0 : H * 0.007;
    ctx.strokeStyle = ink; ctx.fillStyle = ink;
    const ln = (a, b, wd) => { ctx.lineWidth = wd + (pass ? 0 : H * 0.008); ctx.beginPath(); ctx.moveTo(a[0] + o, a[1] - o); ctx.lineTo(b[0] + o, b[1] - o); ctx.stroke(); };
    // Legs, mostly out of frame below.
    ln([cx - hipW * 0.45, hy], [cx - hipW * 1.0, hy + H * 0.5], H * 0.11);
    ln([cx + hipW * 0.45, hy], [cx + hipW * 1.2, hy + H * 0.46], H * 0.11);
    // The torso: wide at the shoulders, narrower at the hips.
    ctx.lineWidth = H * 0.05 + (pass ? 0 : H * 0.008);
    ctx.beginPath();
    ctx.moveTo(cx - hipW / 2 + o, hy - o); ctx.lineTo(shL[0] + o, shL[1] - o); ctx.lineTo(shR[0] + o, shR[1] - o); ctx.lineTo(cx + hipW / 2 + o, hy - o);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ln(neck, head, H * 0.07);
    ctx.beginPath(); ctx.ellipse(head[0] + o, head[1] - o, H * 0.062, H * 0.07, tilt, 0, PI * 2); ctx.fill();
    const eL = elbow(shL, handL, -1), eR = elbow(shR, handR, 1);
    ln(shL, eL, H * 0.085); ln(eL, handL, H * 0.065);
    ln(shR, eR, H * 0.085); ln(eR, handR, H * 0.065);
  }
  if (p < rel) { ctx.fillStyle = C.ball; ctx.beginPath(); ctx.arc(handR[0], handR[1], Math.max(4, H * 0.024), 0, PI * 2); ctx.fill(); }
  return handOf(rel, shR);
}

// ─── 3 · OVERHEAD: the bounce ─────────────────────────────────────

const BOUNCE = 0.62;   // the share of shot 3 before the ball pitches

/** The ball's path from above: y along the pitch (m, + towards the bowler), z its height. */
function ballAt(q) {
  if (q <= BOUNCE) { const u = q / BOUNCE; return { x: lerp(-0.35, 0.05, u), y: lerp(8.6, -4.2, u), z: lerp(2.2, 0, u * u * 0.4 + u * 0.6) }; }
  const u = (q - BOUNCE) / (1 - BOUNCE);
  return { x: lerp(0.05, 0.12, u), y: lerp(-4.2, -9.2, u), z: Math.sin(u * PI * 0.5) * 0.85 };
}

function shot3(ctx, w, h, p) {
  const q = eio(seg(p, 0, 0.96)) * 0.15 + seg(p, 0, 0.96) * 0.85;
  const ball = ballAt(q);
  const k = Math.min(h / 16, w / 6.2) * lerp(1, 1.2, eio(p));
  const rot = rad(lerp(-14, 4, eio(p)));
  // The grass, mown in bands, under four floodlights.
  ctx.fillStyle = "#123f26";
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rot);
  ctx.translate(-ball.x * k * 0.4, -lerp(2, ball.y, 0.85) * k);
  const big = Math.hypot(w, h) / k + 10;
  for (let i = -Math.ceil(big / 2.5); i < big / 2.5; i++) {
    ctx.fillStyle = i % 2 ? "#174d2e" : "#134328";
    ctx.fillRect(-big * k, i * 2.5 * k, big * 2 * k, 2.5 * k);
  }
  // The pitch, its cracks and its creases.
  ctx.fillStyle = C.clay;
  ctx.fillRect(-1.52 * k, -11.3 * k, 3.04 * k, 22.6 * k);
  ctx.strokeStyle = "rgba(90,62,26,0.45)";
  ctx.lineWidth = 1;
  const cr = rng(17);
  ctx.beginPath();
  for (let i = 0; i < 26; i++) {
    let x = (cr() - 0.5) * 2.6 * k, y = (cr() - 0.5) * 20 * k;
    ctx.moveTo(x, y);
    for (let j = 0; j < 3; j++) { x += (cr() - 0.5) * 0.6 * k; y += (cr() - 0.5) * 0.6 * k; ctx.lineTo(x, y); }
  }
  ctx.stroke();
  ctx.strokeStyle = C.creaseLine;
  ctx.lineWidth = Math.max(1.5, k * 0.05);
  for (const s of [-1, 1]) {
    const st = s * 10.06, pc = s * (10.06 - 1.22);
    ctx.beginPath();
    ctx.moveTo(-1.32 * k, st * k); ctx.lineTo(1.32 * k, st * k);
    ctx.moveTo(-1.83 * k, pc * k); ctx.lineTo(1.83 * k, pc * k);
    ctx.moveTo(-1.32 * k, pc * k); ctx.lineTo(-1.32 * k, (st + s * 1.2) * k);
    ctx.moveTo(1.32 * k, pc * k); ctx.lineTo(1.32 * k, (st + s * 1.2) * k);
    ctx.stroke();
    ctx.fillStyle = "#f3ead6";
    for (const d of [-0.11, 0, 0.11]) { ctx.beginPath(); ctx.arc(d * k, st * k, Math.max(1.5, k * 0.035), 0, PI * 2); ctx.fill(); }
  }
  // The people, from above: shapes with four floodlight shadows each.
  const top = (x, y, a, kind) => {
    for (const [sx, sy] of [[0.5, 0.35], [-0.45, 0.4], [0.4, -0.45], [-0.5, -0.3]]) { ctx.fillStyle = "rgba(0,0,0,0.13)"; person(ctx, (x + sx) * k, (y + sy) * k, a, k, kind, true); }
    person(ctx, x * k, y * k, a, k, kind, false);
  };
  top(-0.75, -12, 0, "keeper");
  if (w > h * 0.8) {
    // The slips, and the ring of fielders a wide screen has room for.
    for (const [x, y] of [[-2.1, -12.6], [-3.3, -12.2], [-4.4, -11.6]]) top(x, y, -0.2, "slip");
    for (const [x, y] of [[-12, -8], [-14, 1], [-7, 9], [7, 9], [14, 1], [11, -10], [6, -19], [-9, -20]]) top(x, y, Math.atan2(-y, -x) - PI / 2, "slip");
  }
  const swing = seg(p, 0.86, 1);
  top(0.55, -9.05, lerp(-0.1, -1.1, eio(swing)), "batter");
  top(-0.5, lerp(9.2, 6.4, eio(p)), PI, "bowler");
  // The bounce mark, once the ball has pitched; a puff of dust as it does.
  if (q > BOUNCE) {
    const bm = ballAt(BOUNCE);
    ctx.fillStyle = "rgba(70,46,18,0.55)";
    ctx.beginPath(); ctx.ellipse(bm.x * k, bm.y * k, 0.09 * k + 2, 0.16 * k + 3, 0, 0, PI * 2); ctx.fill();
    const d = seg(q, BOUNCE, BOUNCE + 0.18);
    if (d < 1) {
      const pr = rng(5);
      ctx.fillStyle = `rgba(230,205,150,${0.6 * (1 - d)})`;
      for (let i = 0; i < 14; i++) {
        const a = pr() * PI * 2, rr = (0.1 + pr() * 0.5) * k * eout(d);
        ctx.beginPath(); ctx.arc(bm.x * k + Math.cos(a) * rr, bm.y * k + Math.sin(a) * rr, 1 + pr() * 2, 0, PI * 2); ctx.fill();
      }
    }
  }
  // The trail, the shadow, then the ball with its seam spinning.
  const R = Math.max(7, 0.16 * k);
  streak(ctx, Array.from({ length: 12 }, (_, i) => { const t = ballAt(Math.max(0, q - (11 - i) * 0.012)); return [t.x * k, t.y * k]; }), R, "255,160,140");
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath(); ctx.ellipse((ball.x + ball.z * 0.5) * k, (ball.y + ball.z * 0.35) * k, R, R * 0.8, 0, 0, PI * 2); ctx.fill();
  const bx = ball.x * k, by = ball.y * k, br = R * (1 + ball.z * 0.12);
  ctx.fillStyle = C.ball; ctx.beginPath(); ctx.arc(bx, by, br, 0, PI * 2); ctx.fill();
  const spin = q * 34;
  ctx.save();
  ctx.translate(bx, by); ctx.rotate(spin);
  ctx.strokeStyle = C.seam; ctx.lineWidth = Math.max(1, br * 0.14);
  const bend = Math.sin(spin * 0.7) * br * 0.35;
  ctx.beginPath(); ctx.moveTo(-br * 0.92, 0); ctx.quadraticCurveTo(0, bend, br * 0.92, 0); ctx.stroke();
  ctx.lineWidth = Math.max(0.8, br * 0.08);
  ctx.beginPath();
  for (let i = -3; i <= 3; i++) { const x = (i / 3.6) * br, y = bend * (1 - (x / br) ** 2) * 0.5; ctx.moveTo(x - br * 0.06, y - br * 0.14); ctx.lineTo(x + br * 0.06, y + br * 0.14); }
  ctx.stroke();
  ctx.restore();
  // A glint from the lights.
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.arc(bx - br * 0.35, by - br * 0.35, br * 0.25, 0, PI * 2); ctx.fill();
  ctx.restore();
}

/** A person from above: shoulders, a head (a helmet for batter and keeper), and what they hold. */
function person(ctx, x, y, a, k, kind, shadow) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  const fill = shadow ? ctx.fillStyle : C.ink;
  ctx.fillStyle = fill;
  const s = kind === "keeper" || kind === "slip" ? 0.85 : 1;
  ctx.beginPath(); ctx.ellipse(0, 0, 0.26 * k * s, 0.14 * k * s, 0, 0, PI * 2); ctx.fill();
  if (kind === "batter") {
    // The bat, held out towards the bowler's end.
    ctx.fillRect(-0.05 * k, 0.05 * k, 0.11 * k, 0.75 * k);
  }
  if (kind === "bowler") {
    ctx.strokeStyle = fill; ctx.lineCap = "round"; ctx.lineWidth = 0.08 * k;
    ctx.beginPath(); ctx.moveTo(0.18 * k, 0); ctx.lineTo(0.55 * k, -0.25 * k); ctx.stroke();
  }
  if (!shadow) {
    ctx.strokeStyle = "rgba(236,244,214,0.7)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(0, 0, 0.26 * k * s, 0.14 * k * s, 0, PI * 1.1, PI * 1.9); ctx.stroke();
    ctx.fillStyle = "#121a22";
  }
  ctx.beginPath(); ctx.arc(0, 0, 0.11 * k * s, 0, PI * 2); ctx.fill();
  ctx.restore();
}

// ─── 4 · THE SHOT: six ────────────────────────────────────────────

const CONTACT = 0.2;

/** The batter's swing: the bat's angle and the pose around it, from the shot's progress. */
function swingPose(p) {
  const back = eio(seg(p, 0.03, 0.13)), down = ein(seg(p, 0.13, CONTACT)), thru = eout(seg(p, CONTACT, 0.42));
  let a = lerp(-20, -150, back);
  a = lerp(a, 32, down);
  a = lerp(a, 215, thru);
  const stride = eio(seg(p, 0.08, CONTACT));
  return {
    a,
    lean: lerp(lerp(22, 16, stride), 2, thru),
    legs: [[lerp(-8, -22, stride), lerp(-4, -28, stride)], [lerp(14, 34, stride), lerp(4, 6, stride)]],
  };
}

function shot4(ctx, w, h, p) {
  const k0 = (h * (w > h ? 0.46 : 0.34)) / 1.65;
  const sp = swingPose(p);
  // The batter's hands and bat, in metres, so the contact point is where the bat is.
  const bat = (a) => {
    const hand = [0.18 + Math.sin(rad(a * 0.5 + 10)) * 0.42, 1.22 - Math.cos(rad(a * 0.5 + 10)) * 0.42];
    const sweet = [hand[0] + Math.sin(rad(a)) * 0.62, hand[1] - Math.cos(rad(a)) * 0.62];
    return { hand, sweet };
  };
  const c = bat(swingPose(CONTACT).a).sweet;
  // Where the ball is, in metres: in from the right, then up and away.
  const fly = (u) => [c[0] + 92 * u, c[1] + 70 * u - 26 * u * u];
  const u = p < CONTACT ? 0 : (p - CONTACT) / (1 - CONTACT);
  let bx, by;
  if (p < CONTACT) { const v = seg(p, 0.08, CONTACT); bx = lerp(c[0] + 9, c[0], v); by = lerp(c[1] - 0.35, c[1], v); }
  else [bx, by] = fly(u);
  // The camera: on the batter, then after the ball, zooming out as it climbs.
  const fol = eio(seg(p, CONTACT, 0.36));
  const k = k0 * lerp(1, 0.11, eio(seg(p, CONTACT, 0.82)));
  const camX = lerp(0.3, bx, fol), camY = lerp(0.95, by, fol);
  const ax = w * lerp(w > h ? 0.4 : 0.4, w > h ? 0.6 : 0.64, fol), ay = h * lerp(w > h ? 0.58 : 0.46, 0.36, fol);
  const S = (x, y, d = 1) => [ax + (x - camX * d) * k * d, ay - (y - camY * d) * k * d];
  const ground = S(0, 0)[1];
  // Sky: the horizon drops as the camera tilts up after the ball.
  const farH = S(0, 0, 0.35)[1];
  sky(ctx, w, h, farH, h * 0.9);
  stars(ctx, w, farH, camX * k * 0.02, (farH - h * 0.6) * 0.1);
  // Far stands, then the turf up to them.
  const [, sb] = S(0, 0, 0.42);
  stands(ctx, w, sb + 1, h * lerp(0.07, 0.16, eio(seg(p, CONTACT, 0.8))), camX * k * 0.42 - w * 0.2, 21);
  const g = ctx.createLinearGradient(0, sb, 0, Math.max(sb + 1, ground + h * 0.4));
  g.addColorStop(0, C.turfFar); g.addColorStop(1, C.turfNear);
  ctx.fillStyle = g;
  ctx.fillRect(0, sb, w, h - sb);
  // The stand at the boundary the six clears, and the floodlight over it.
  const [fx, fy] = S(90, 52);
  const [, fb] = S(90, 14);
  const fs = Math.max(0.5, k / 9);
  cone(ctx, fx, fy, S(0, 0)[1], w * 0.9, 0.05);
  const st = [[70, 0], [70, 3], [98, 13], [98, 0]].map(([x, y]) => S(x, y));
  ctx.fillStyle = "#0c141d";
  ctx.beginPath(); st.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,214,150,0.55)";
  const sr = rng(77);
  for (let i = 0; i < 90; i++) { const xx = 71 + sr() * 26, yy = sr() * (0.4 + ((xx - 70) / 28) * 12); const [qx, qy] = S(xx, yy); ctx.fillRect(qx, qy, 1.8, 1.4); }
  const roof = [[67, 16.5], [100, 16.5], [100, 15.4], [67, 15.4]].map(([x, y]) => S(x, y));
  ctx.fillStyle = "#0a1017";
  ctx.beginPath(); roof.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,232,190,0.45)";
  ctx.fillRect(roof[3][0], roof[3][1], roof[2][0] - roof[3][0], 1.2);
  pylon(ctx, fx, fb, fy, fs, 1);
  // The pitch under the batter, the stumps behind.
  if (ground < h + 40) {
    const [p0] = S(-3, 0), [p1] = S(30, 0);
    ctx.fillStyle = C.clay;
    ctx.fillRect(p0, ground - k * 0.04, p1 - p0, k * 0.12);
    ctx.strokeStyle = "#f3ead6"; ctx.lineWidth = Math.max(2, k * 0.035);
    for (const d of [-0.36, -0.3, -0.24]) { const [sx, sy] = S(d, 0), [, ty] = S(d, 0.71); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, ty); ctx.stroke(); }
    const H = 1.65 * k;
    const b = bat(sp.a);
    const [hx, hy] = S(-0.02, 0.86);
    const hands = S(b.hand[0], b.hand[1]);
    figure(ctx, { x: hx, y: hy, H, f: 1, lean: sp.lean, helmet: true, pads: true, legs: sp.legs, hands, bat: { a: sp.a, len: 0.92 * k } });
  }
  // The contact: a flash where bat meets ball.
  const fl = seg(p, CONTACT - 0.005, CONTACT + 0.07);
  if (fl > 0 && fl < 1) {
    const [cx, cy] = S(c[0], c[1]);
    ctx.globalCompositeOperation = "lighter";
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, k * 0.9);
    rg.addColorStop(0, `rgba(255,250,220,${0.9 * (1 - fl)})`);
    rg.addColorStop(1, "rgba(255,250,220,0)");
    ctx.fillStyle = rg; ctx.fillRect(cx - k, cy - k, k * 2, k * 2);
    ctx.globalCompositeOperation = "source-over";
  }
  // The ball, its trail; larger than life so the eye can follow it up.
  if (p > 0.08) {
    const r = Math.max(5, 0.07 * k) * (p > CONTACT ? lerp(1.4, 1, seg(p, CONTACT, 0.7)) : 1);
    if (p > CONTACT) {
      streak(ctx, Array.from({ length: 16 }, (_, i) => S(...fly(Math.max(0, u - (15 - i) * 0.01)))), r, "255,190,160");
    }
    const [x, y] = S(bx, by);
    ctx.fillStyle = C.ball; ctx.beginPath(); ctx.arc(x, y, r, 0, PI * 2); ctx.fill();
    ctx.strokeStyle = C.seam; ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.beginPath(); ctx.arc(x, y, r * 0.62, p * 40, p * 40 + PI * 0.9); ctx.stroke();
  }
  // Into the lights: the flare as the ball crosses the floodlight's glare.
  const fl2 = seg(p, 0.78, 1);
  if (fl2 > 0) {
    ctx.globalCompositeOperation = "lighter";
    const rg = ctx.createRadialGradient(fx, fy, 0, fx, fy, w * 0.9);
    rg.addColorStop(0, `rgba(255,244,214,${0.55 * fl2})`);
    rg.addColorStop(0.3, `rgba(255,220,170,${0.18 * fl2})`);
    rg.addColorStop(1, "rgba(255,220,170,0)");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `rgba(255,248,230,${0.35 * fl2})`;
    ctx.fillRect(0, fy - 1.5, w, 3);
    ctx.globalCompositeOperation = "source-over";
  }
}

// ─── 5 · THE SCOREBOARD ───────────────────────────────────────────

/** The figure a flap shows at progress `u` through a change from `a` to `b`, counting up as a split-flap does. */
function flapAt(a, b, u) {
  const steps = (b - a + 10) % 10 || 0;
  if (!steps) return { now: a, next: a, t: 0 };
  const x = u * steps, i = Math.min(steps - 1, Math.floor(x));
  return u >= 1 ? { now: b, next: b, t: 0 } : { now: (a + i) % 10, next: (a + i + 1) % 10, t: x - i };
}

/** One split-flap tile at (x, y), w × h, turning from `now` to `next` (t 0..1). */
function flap(ctx, x, y, w, h, now, next, t, color, font) {
  const r = Math.min(6, w * 0.08);
  ctx.fillStyle = "#161b17";
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  const glyph = (ch, clipTop, sy = 1) => {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, clipTop ? y : y + h / 2, w, h / 2); ctx.clip();
    ctx.translate(0, y + h / 2); ctx.scale(1, sy); ctx.translate(0, -(y + h / 2));
    ctx.fillStyle = "#1b211c"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(ch), x + w / 2, y + h / 2 + h * 0.04);
    ctx.restore();
  };
  if (t <= 0) { glyph(now, true); glyph(now, false); }
  else {
    // The new top half behind; the old top folding down; then the new bottom unfolding.
    glyph(next, true);
    glyph(now, false);
    if (t < 0.5) glyph(now, true, 1 - t * 2);
    else glyph(next, false, (t - 0.5) * 2);
  }
  ctx.fillStyle = "#050605";
  ctx.fillRect(x, y + h / 2 - 1, w, 2);
}

/**
 * The board, in two layers: what never changes (`fixed`), drawn once per size
 * into a cache, and the figures that turn over (`!fixed`), drawn each frame.
 */
function board(ctx, w, h, p, fixed) {
  const wide = w > h * 1.2;
  const W = Math.min(wide ? w * 0.5 : w * 0.9, 720), Hh = W * 0.74;
  const x0 = wide ? w * 0.7 - W / 2 : (w - W) / 2, y0 = (h - Hh) / 2 - h * (wide ? 0.02 : 0.08);
  const u = W / 100, pad = 5 * u;
  const tw = 5.2 * u, th = 7 * u;
  const rowY = y0 + pad + th + 7 * u;
  const fw = 13 * u, fh = 19 * u, fy = rowY, fx = x0 + pad + 22 * u;
  const oy = fy + fh + 5 * u;
  const sw = 6.5 * u, shh = 9 * u, ox = x0 + pad + 22 * u;
  const ty = oy + shh + 5 * u;
  const bigFont = `500 ${fh * 0.72}px ${MONO}`, sm = `500 ${shh * 0.66}px ${MONO}`, label = `500 ${Math.max(12, 3.2 * u)}px ${MONO}`;
  const ball = (i, sc, n, color) => {
    const cx = x0 + pad + 26 * u + i * 9 * u, cy = ty + 3.5 * u;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, 3.4 * u * sc, 0, PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `700 ${3.6 * u * sc}px ${MONO}`;
    ctx.fillText(n, cx, cy + 0.2 * u);
  };
  if (fixed) {
    // A dark ground behind the board, the floodlights' glow at its shoulders.
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#03060c"); bg.addColorStop(1, "#08121c");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    stars(ctx, w, h * 0.5, 0, 0);
    for (const sx of [x0 - W * 0.05, x0 + W * 1.05]) {
      const rg = ctx.createRadialGradient(sx, y0 - h * 0.06, 0, sx, y0 - h * 0.06, W * 0.6);
      rg.addColorStop(0, "rgba(255,236,190,0.32)"); rg.addColorStop(1, "rgba(255,236,190,0)");
      ctx.fillStyle = rg; ctx.fillRect(sx - W * 0.6, y0 - h * 0.06 - W * 0.6, W * 1.2, W * 1.2);
    }
    // The legs it stands on, its frame, its face.
    ctx.fillStyle = "#0d1218";
    ctx.fillRect(x0 + W * 0.18, y0 + Hh, W * 0.04, h);
    ctx.fillRect(x0 + W * 0.78, y0 + Hh, W * 0.04, h);
    ctx.fillStyle = "#1a2129";
    ctx.beginPath(); ctx.roundRect(x0 - 8, y0 - 8, W + 16, Hh + 16, 14); ctx.fill();
    ctx.fillStyle = C.board;
    ctx.beginPath(); ctx.roundRect(x0, y0, W, Hh, 10); ctx.fill();
    // Top row: the brand on six flaps, and SAMPLE beside it.
    "SCRBRD".split("").forEach((ch, i) => flap(ctx, x0 + pad + i * (tw + 0.8 * u), y0 + pad, tw, th, ch, ch, 0, C.figure, `700 ${th * 0.62}px ${HEAD}`));
    ctx.textBaseline = "middle";
    ctx.font = `500 ${Math.max(12, 3 * u)}px ${MONO}`;
    ctx.textAlign = "right"; ctx.fillStyle = C.dim;
    ctx.fillText("SAMPLE · NOT A REAL MATCH", x0 + W - pad, y0 + pad + th / 2);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(x0 + pad, y0 + pad + th + 3 * u, W - pad * 2, 1);
    // The labels, and the figures that do not change: the wickets, the 14.
    ctx.textAlign = "left"; ctx.fillStyle = C.dim; ctx.font = label;
    ctx.fillText("U14A", x0 + pad, rowY + 2 * u);
    ctx.fillText("TOTAL", x0 + pad, rowY + 7 * u);
    ctx.fillText("OVERS", x0 + pad, oy + 4 * u);
    ctx.fillText("THIS OVER", x0 + pad, ty + 3.5 * u);
    ctx.fillStyle = C.figure; ctx.font = `500 ${fh * 0.6}px ${MONO}`; ctx.textAlign = "center";
    ctx.fillText("/", fx + fw * 2 + 6 * u, fy + fh / 2);
    flap(ctx, fx + fw * 2 + 11 * u, fy, fw, fh, 3, 3, 0, C.figure, bigFont);
    flap(ctx, ox, oy, sw, shh, 1, 1, 0, C.figure, sm);
    flap(ctx, ox + sw + 0.8 * u, oy, sw, shh, 4, 4, 0, C.figure, sm);
    ctx.fillStyle = C.figure; ctx.fillRect(ox + sw * 2 + 1.8 * u, oy + shh * 0.78, 1.2 * u, 1.2 * u);
    // This over: the two balls already bowled, and the empty places.
    ball(0, 1, "1", "#ec4899"); ball(1, 1, "0", "#3a4350");
    ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 1.5;
    for (let i = 2; i < 6; i++) { ctx.beginPath(); ctx.arc(x0 + pad + 26 * u + i * 9 * u, ty + 3.5 * u, 3.2 * u, 0, PI * 2); ctx.stroke(); }
    return;
  }
  // The total turning over, 87 → 93; the overs, 14.2 → 14.3; the six arriving in this over.
  const ten = flapAt(8, 9, seg(p, 0.24, 0.32));
  const one = flapAt(7, 3, seg(p, 0.24, 0.5));
  const changed = p > 0.5;
  flap(ctx, fx, fy, fw, fh, ten.now, ten.next, ten.t, changed ? C.lime : C.figure, bigFont);
  flap(ctx, fx + fw + 1.2 * u, fy, fw, fh, one.now, one.next, one.t, changed ? C.lime : C.figure, bigFont);
  const ov = flapAt(2, 3, seg(p, 0.46, 0.54));
  flap(ctx, ox + sw * 2 + 4 * u, oy, sw, shh, ov.now, ov.next, ov.t, p > 0.54 ? C.lime : C.figure, sm);
  const six = eout(seg(p, 0.3, 0.42));
  if (six > 0) ball(2, six, "6", "#dd514c");
}

const BOARDS = new Map();

function shot5(ctx, w, h, p) {
  const z = lerp(1.08, 1, eout(seg(p, 0, 0.3)));
  const dpr = ctx.getTransform?.().a || 1;
  const key = `${w}x${h}@${dpr}`;
  let cache = BOARDS.get(key);
  if (!cache && typeof document !== "undefined") {
    cache = document.createElement("canvas");
    cache.width = Math.round(w * dpr); cache.height = Math.round(h * dpr);
    const c2 = cache.getContext("2d");
    if (c2) { c2.setTransform(dpr, 0, 0, dpr, 0, 0); board(c2, w, h, 1, true); }
    if (BOARDS.size > 4) BOARDS.clear();
    BOARDS.set(key, cache);
  }
  ctx.save();
  ctx.translate(w / 2, h / 2); ctx.scale(z, z); ctx.translate(-w / 2, -h / 2);
  if (cache) ctx.drawImage(cache, 0, 0, w, h); else board(ctx, w, h, p, true);
  board(ctx, w, h, p, false);
  ctx.restore();
}

/** Forget the cached board: the fonts arrived, so its lettering can be drawn properly now. */
export function forgetCaches() { BOARDS.clear(); }

const DRAW = [shot1, shot2, shot3, shot4, shot5];

/** One shot at its own progress p (0..1): a storyboard still, or one layer of a cut. */
export function drawShot(ctx, w, h, i, p, still = false) {
  ctx.save();
  DRAW[i](ctx, w, h, clamp(p));
  // The film's stage darkens its edges in CSS (home/fx.js), once, for free; a still does it here.
  if (still) vignette(ctx, w, h, 0.5);
  ctx.restore();
}

/** The film at `s` (0..FILM_SCREENS): the shot it is in, and the next one dissolving in across a cut. */
export function drawFilm(ctx, w, h, s) {
  ctx.clearRect(0, 0, w, h);
  let i = SHOTS.findIndex((sh) => s < sh.to);
  if (i < 0) i = SHOTS.length - 1;
  const sh = SHOTS[i];
  const pOf = (j) => (s - SHOTS[j].from) / (SHOTS[j].to - SHOTS[j].from);
  // Near the start of a shot, the last one is still finishing underneath.
  if (i > 0 && s < sh.from + XF) {
    drawShot(ctx, w, h, i - 1, pOf(i - 1));
    ctx.globalAlpha = clamp((s - (sh.from - XF)) / (2 * XF));
    drawShot(ctx, w, h, i, pOf(i));
    ctx.globalAlpha = 1;
  } else if (i < SHOTS.length - 1 && s > sh.to - XF) {
    drawShot(ctx, w, h, i, pOf(i));
    ctx.globalAlpha = clamp((s - (sh.to - XF)) / (2 * XF));
    drawShot(ctx, w, h, i + 1, pOf(i + 1));
    ctx.globalAlpha = 1;
  } else drawShot(ctx, w, h, i, pOf(i));
  return i;
}
