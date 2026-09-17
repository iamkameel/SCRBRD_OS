import * as THREE from "three";
import { SEGS, R_BND, R_IN, R_MID, lineKey, LK_COLS } from "../../scorer/field.js";
import { T } from "../../design/tokens.js";

// ══════════════════════════════════════════════════════
//  THE STAGE — a field, an innings drawn on it, and a camera that moves
//
//  This module is reached only by `import()` from the deck, so three.js lives
//  in its own chunk and is fetched by the one screen that draws in 3D. The
//  entry ceiling in tools/check-bundle.mjs is what keeps that true.
//
//  Everything geometric here is field.js's geometry re-expressed with the rope
//  at radius 1: a segment's angle, the three rings, the twelve sectors. The
//  deck does not get its own idea of where mid-wicket is.
//
//  What the scene will NOT do is claim a distance for a ball that never had
//  one. Seeded balls carry a sector and a run value and nothing finer, so a
//  spoke's length here is the run value made visible — a demonstration of the
//  chart, and the caption on the slide says so.
// ══════════════════════════════════════════════════════

const ROPE = 1;
const RING = { inner: R_IN / R_BND, middle: R_MID / R_BND, rope: ROPE };

/** A point on the field, rope at 1, from field.js's angle convention. */
const onField = (deg, r) => new THREE.Vector3(r * Math.sin(deg * Math.PI / 180), 0, -r * Math.cos(deg * Math.PI / 180));

const circlePoints = (r, n = 96) => {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(onField((i / n) * 360, r));
  return pts;
};

/**
 * The camera, named per slide. Spherical: how far, how high, from where —
 * and `look`, the point on the field the camera holds in the centre of the
 * frame. The wheel slide looks to the right of centre so the field sits in
 * the clear left half, beside the panel rather than under it.
 */
export const VIEWS = {
  orbit: { radius: 2.7, elevation: 0.55, azimuth: 0.6,  spin: 0.06 },
  low:   { radius: 2.2, elevation: 0.18, azimuth: 1.4,  spin: 0.03 },
  wheel: { radius: 3.0, elevation: 1.0,  azimuth: 0.0,  spin: 0.04, look: [0.75, 0.05, 0] },
  far:   { radius: 4.2, elevation: 0.9,  azimuth: -0.8, spin: 0.02 },
  close: { radius: 1.7, elevation: 0.35, azimuth: 2.4,  spin: 0.05 },
  top:   { radius: 2.4, elevation: 1.45, azimuth: 0.0,  spin: 0.0 },
};
const LOOK = [0, 0.05, 0];

/** Where a seeded ball's spoke ends: the run value as radius, with the rope at four. */
const spokeReach = (b) => {
  if (b.type === "W") return RING.inner * 0.55;
  if (b.value >= 6) return ROPE + 0.09;
  if (b.value === 4) return ROPE - 0.02;
  if (b.value === 3) return RING.middle + 0.08;
  if (b.value === 2) return RING.middle - 0.1;
  if (b.value === 1) return RING.inner + 0.08;
  return RING.inner * 0.45;
};

/** How high a spoke arcs: a six clears the rope; a four skims; a single rolls. */
const spokeLift = (b) => (b.value >= 6 ? 0.5 : b.value === 4 ? 0.2 : b.type === "W" ? 0.04 : 0.07);

const SPOKE_POINTS = 28;

/**
 * Can this browser draw in 3D at all? Asked before three.js is constructed so
 * the failure is a return value, not an exception with a stack trace in the
 * console — a deck that logs errors on a laptop with GPU acceleration switched
 * off has failed the person presenting it.
 */
export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Mount the stage into `host` and return its controls.
 *
 *   setView(name)         — the camera moves to VIEWS[name]
 *   setBalls(balls)       — draw an innings; spokes reveal in ball order
 *   setFilter({ seg, key }) — dim every spoke outside the sector or line key
 *   setReduced(bool)      — prefers-reduced-motion: snap, never drift
 *   dispose()             — tear down; the host is left empty
 *
 * `onLost` fires if the GL context goes away underneath us, so the deck can
 * fall back to its flat rendering rather than sit on a black rectangle.
 */
export function mountStage(host, { onLost, reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color(T.surface.canvas), 0.16);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);

  // ── The field ──
  const field = new THREE.Group();
  scene.add(field);
  const disposables = [];
  const keep = (o) => { disposables.push(o); return o; };

  const grass = new THREE.Mesh(
    keep(new THREE.CircleGeometry(ROPE, 96)),
    keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(T.semantic.positive), transparent: true, opacity: 0.07 })),
  );
  grass.rotation.x = -Math.PI / 2;
  field.add(grass);

  const lineMat = keep(new THREE.LineBasicMaterial({ color: new THREE.Color(T.content.tertiary), transparent: true, opacity: 0.35 }));
  const ropeMat = keep(new THREE.LineBasicMaterial({ color: new THREE.Color(T.brand.cyan), transparent: true, opacity: 0.8 }));
  for (const [name, r] of Object.entries(RING)) {
    field.add(new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(circlePoints(r))), name === "rope" ? ropeMat : lineMat));
  }
  // Sector borders sit fifteen degrees either side of each sector's centre.
  const borderMat = keep(new THREE.LineBasicMaterial({ color: new THREE.Color(T.content.tertiary), transparent: true, opacity: 0.14 }));
  for (const s of SEGS) {
    field.add(new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints([onField(s.angle - 15, RING.inner * 0.35), onField(s.angle - 15, ROPE)])), borderMat));
  }
  const pitch = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(0.075, 0.24)),
    keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(T.semantic.warning), transparent: true, opacity: 0.55 })),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.y = 0.002;
  field.add(pitch);

  // ── Ambient particles: the crowd, or the sky, depending on the camera ──
  const N = 700;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 2.2 + Math.random() * 3.2, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.9);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.6 + 0.1;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const dust = new THREE.Points(
    keep(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3))),
    keep(new THREE.PointsMaterial({ color: new THREE.Color(T.brand.cyan), size: 0.022, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })),
  );
  scene.add(dust);

  // ── The innings ──
  const spokes = new THREE.Group();
  field.add(spokes);
  let drawn = [];          // [{ line, seg, key, mat }]
  let revealedAt = 0;      // when setBalls was called, for the staggered reveal
  let filter = { seg: null, key: null };

  const clearSpokes = () => {
    for (const s of drawn) { spokes.remove(s.line); s.line.geometry.dispose(); s.mat.dispose(); }
    drawn = [];
  };

  const setBalls = (balls) => {
    clearSpokes();
    for (const b of balls) {
      // A ball with no sector — a wicket, a wide — went nowhere that was
      // recorded, and is not given a direction here to make the chart fuller.
      if (b.seg == null) continue;
      const seg = b.seg;
      const ang = SEGS[seg]?.angle ?? 0;
      const end = onField(ang, spokeReach(b));
      const mid = end.clone().multiplyScalar(0.5); mid.y = spokeLift(b);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.004, 0), mid, end);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(SPOKE_POINTS));
      const key = lineKey(b);
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(LK_COLS[key]), transparent: true, opacity: 0.9 });
      const line = new THREE.Line(geo, mat);
      geo.setDrawRange(0, 0);
      spokes.add(line);
      drawn.push({ line, seg, key, mat, geo });
    }
    revealedAt = performance.now();
    applyFilter();
    dirty = true;
  };

  const applyFilter = () => {
    for (const s of drawn) {
      const on = (filter.seg == null || filter.seg === s.seg) && (filter.key == null || filter.key === s.key);
      s.mat.opacity = on ? 0.92 : 0.08;
    }
    dirty = true;
  };
  const setFilter = (f) => { filter = { seg: f?.seg ?? null, key: f?.key ?? null }; applyFilter(); };

  // ── The camera ──
  let view = VIEWS.orbit;
  let cur = { radius: view.radius, elevation: view.elevation, azimuth: view.azimuth };
  const look = new THREE.Vector3(...LOOK);
  let drift = 0;                 // accumulated spin, radians
  let pointer = { x: 0, y: 0 };  // parallax, -1..1
  let drag = null;               // { x, azimuth } while the pointer is down
  let dragged = 0;               // azimuth the presenter added by hand
  let reducedMotion = reduced;
  let dirty = true;
  const setReduced = (v) => { reducedMotion = !!v; dirty = true; };

  const setView = (name) => {
    view = VIEWS[name] ?? VIEWS.orbit;
    dragged = 0;
    dirty = true;
  };

  const place = (dt) => {
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 2.6);
    cur.radius += (view.radius - cur.radius) * k;
    cur.elevation += (view.elevation - cur.elevation) * k;
    cur.azimuth += (view.azimuth - cur.azimuth) * k;
    look.lerp(new THREE.Vector3(...(view.look ?? LOOK)), k);
    if (!reducedMotion) drift += view.spin * dt;
    const az = cur.azimuth + drift + dragged + pointer.x * 0.12;
    const el = Math.max(0.08, Math.min(1.5, cur.elevation + pointer.y * 0.08));
    camera.position.set(
      cur.radius * Math.cos(el) * Math.sin(az),
      cur.radius * Math.sin(el),
      cur.radius * Math.cos(el) * Math.cos(az),
    );
    camera.lookAt(look);
  };

  // ── Interaction ──
  const onMove = (e) => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 };
    if (drag) dragged = drag.azimuth + (e.clientX - drag.x) * 0.006;
    dirty = true;
  };
  const onDown = (e) => { if (e.button === 0) drag = { x: e.clientX, azimuth: dragged }; };
  const onUp = () => { drag = null; };
  const onLeave = () => { pointer = { x: 0, y: 0 }; drag = null; dirty = true; };
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);
  host.addEventListener("pointerleave", onLeave);

  const onContextLost = (e) => { e.preventDefault(); stop(); onLost?.(); };
  canvas.addEventListener("webglcontextlost", onContextLost);

  // ── Size ──
  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  ro?.observe(host);
  resize();

  // ── The loop ──
  // Continuous while something is moving; on demand when the presenter asked
  // for stillness. Hidden tabs do not render at all.
  let raf = 0, last = performance.now(), running = true;
  const frame = (now) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    let animating = !reducedMotion;
    // Spokes reveal one after another, in the order the balls were bowled.
    if (drawn.length) {
      const per = reducedMotion ? 0 : 38, dur = reducedMotion ? 0 : 420;
      const t = now - revealedAt;
      let pending = false;
      drawn.forEach((s, i) => {
        const p = dur ? Math.max(0, Math.min(1, (t - i * per) / dur)) : 1;
        const n = Math.round(p * (SPOKE_POINTS + 1));
        if (s.geo.drawRange.count !== n) { s.geo.setDrawRange(0, n); dirty = true; }
        if (p < 1) pending = true;
      });
      if (pending) animating = true;
    }
    if (!reducedMotion) dust.rotation.y += dt * 0.02;

    if (animating || dirty) {
      place(dt);
      renderer.render(scene, camera);
      dirty = false;
    }
  };
  raf = requestAnimationFrame(frame);

  const stop = () => { running = false; cancelAnimationFrame(raf); };

  const dispose = () => {
    stop();
    ro?.disconnect();
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    host.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    clearSpokes();
    for (const d of disposables) d.dispose();
    renderer.dispose();
    if (canvas.parentNode === host) host.removeChild(canvas);
  };

  return { setView, setBalls, setFilter, setReduced, dispose };
}
