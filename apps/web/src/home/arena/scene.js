import * as THREE from "three";
import { FILM, STRIDES, SPOT, anchors, ballAt, cameraAt, clamp, fovFor, landed, phaseOf, progress, smoothstep } from "./rig.js";

// ══════════════════════════════════════════════════════════════════
//  THE ARENA — the home page's three.js scene (Kameel, 6 Nov 2026: "make
//  it look and feel like a modern video game … continue using three.js")
//
//  A floodlit school ground at dusk, drawn in code: the sky and its stars,
//  the outfield in mown stripes with pools of light under four towers, the
//  pitch and its creases, two sets of stumps, the stands with the crowd as
//  points of light and a Mexican wave, an LED ribbon round the boundary,
//  the scoreboard, haze in the light cones, dust over the square, and the
//  ball with its trail. The camera flies through it as the page is read
//  (rig.js); the hero's five captions are one delivery, bowled, bounced and
//  hit for six, and the sections after it each have a shot of their own.
//
//  WHAT IT NEVER DRAWS: a person. No player, no face, no kit, no number, no
//  name. The run-up is footfalls of light and a ball; the crowd is light.
//  The scoreboard's score is a SAMPLE (U14A 87/3 → 93/3), labelled so on its
//  face, team-level, as the 2D film's is. Every word on it is decorative:
//  the canvas is aria-hidden and the page's words are real text.
//
//  WHAT IT COSTS. Reached only by import() from arena/Arena.jsx after first
//  paint, so three.js is its own lazy chunk; tools/check-bundle.mjs holds
//  the first-paint graph and the lazy one to separate ceilings. It renders
//  only while its stage is on screen and the tab is visible, at a pixel
//  ratio capped at 2 and stepped down when frames run long; past that it
//  hands back to the 2D film (onFail("slow")), unless picked by hand. One
//  requestAnimationFrame loop reads window.scrollY and writes only the GL
//  canvas and the HUD's transforms and text: no DOM read inside a frame but
//  the scroll position. Everything it made is disposed on the way out.
// ══════════════════════════════════════════════════════════════════

const NIGHT = 0x03060d;
const LIME = new THREE.Color("#b9f227");
const CYAN = new THREE.Color("#2ee6d6");   // tokens.js brand.cyan (floodlit)
const WARM = new THREE.Color("#fff3d6");
const ROPE_R = 70;
const TOWERS = [45, 135, 225, 315].map((d) => {
  const a = (d * Math.PI) / 180;
  return { x: Math.sin(a) * 88, z: -Math.cos(a) * 88, aim: [Math.sin(a) * 18, 0, -Math.cos(a) * 18] };
});
const TOWER_H = 44;
const BOARD = { x: 0, y: 23, z: -94, w: 28, h: 11 };

const MONO = "'DM Mono', ui-monospace, monospace";
const HEAD = "'Syne', system-ui, sans-serif";

/** A canvas drawn once (or on demand) and handed to the GPU as a texture. */
function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, ctx, canvas: c };
}

/** A seeded random, so the crowd and the stars sit in the same seats on every visit. */
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Shaders ───────────────────────────────────────────────────────

/** Soft round points of light: the crowd, the stars, the haze, the dust, the trail, the bursts. */
const POINTS_VS = `
uniform float time, uScale, uAlpha, uTwinkle, uRise, uWrap, uWave, uCheer, uCrowd;
uniform vec3 uDrift;
attribute vec3 tint;
attribute float size, phase;
varying vec3 vC;
varying float vA;
void main() {
  vec3 p = position;
  p += uDrift * vec3(sin(time * 0.31 + phase * 6.28), sin(time * 0.23 + phase * 12.0), cos(time * 0.27 + phase * 9.0));
  if (uWrap > 0.0) p.y = mod(p.y + time * uRise * (0.4 + phase), uWrap);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float tw = mix(1.0, 0.25 + 0.75 * pow(0.5 + 0.5 * sin(time * (0.8 + phase * 2.6) + phase * 50.0), 4.0), uTwinkle);
  float grow = 1.0;
  if (uCrowd > 0.0) {
    float ang = atan(position.x, -position.z);
    float d = mod(ang - uWave + 3.14159, 6.28318) - 3.14159;
    float wave = exp(-d * d / 0.03);
    tw = tw + 1.3 * wave + 1.6 * uCheer;
    grow = 1.0 + 0.8 * wave + 0.7 * uCheer;
  }
  vA = uAlpha * tw;
  vC = tint;
  gl_PointSize = clamp(size * grow * uScale / max(0.1, -mv.z), 1.0, 96.0);
  gl_Position = projectionMatrix * mv;
}`;
const POINTS_FS = `
varying vec3 vC;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vC, a * a * vA);
}`;

/** The outfield: mown stripes, the pools of light, the rope, the circle, and a pulse ring for the moments. */
const GROUND_VS = `
varying vec2 vP;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GROUND_FS = `
uniform vec3 grassA, grassB, apron, rope, lime;
uniform vec2 lamps[4];
uniform float uPulse, uPulseA, uLight, time;
varying vec2 vP;
void main() {
  float r = length(vP);
  float stripe = step(0.5, fract(vP.y / 6.0 + 0.5));
  vec3 g = mix(grassA, grassB, 0.25 + 0.55 * stripe);
  g *= 0.95 + 0.05 * sin(vP.x * 0.21 + sin(vP.y * 0.17) * 2.0);
  float light = 0.32;
  for (int i = 0; i < 4; i++) { vec2 d = vP - lamps[i]; light += 0.42 * exp(-dot(d, d) / 1500.0); }
  light += 0.35 * exp(-r * r / 900.0);
  g *= light * uLight;
  g = mix(g, apron * light * uLight, smoothstep(${(ROPE_R - 0.6).toFixed(1)}, ${(ROPE_R + 0.6).toFixed(1)}, r));
  g += rope * exp(-pow((r - ${ROPE_R.toFixed(1)}) / 0.32, 2.0));
  float ang = atan(vP.y, vP.x);
  g += vec3(0.85) * 0.28 * exp(-pow((r - 27.4) / 0.11, 2.0)) * step(0.45, fract(ang * 46.0 / 6.28318));
  g += lime * uPulseA * exp(-pow((r - uPulse) / 1.4, 2.0));
  g *= smoothstep(${(ROPE_R + 8).toFixed(1)}, ${(ROPE_R + 4).toFixed(1)}, r);
  gl_FragColor = vec4(g, 1.0);
}`;

/** The sky: a gradient to a band of afterglow on the horizon; below it, dark. */
const SKY_VS = `varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SKY_FS = `
uniform vec3 top, mid, horizon, glow;
varying vec3 vD;
void main() {
  float h = vD.y;
  vec3 c = mix(horizon, mid, smoothstep(0.0, 0.16, h));
  c = mix(c, top, smoothstep(0.12, 0.65, h));
  float az = max(0.0, dot(normalize(vD.xz + 1e-4), normalize(vec2(-0.55, -1.0))));
  c += glow * pow(az, 5.0) * smoothstep(0.32, 0.0, abs(h - 0.03));
  c = mix(c, vec3(0.012, 0.02, 0.03), smoothstep(0.0, -0.06, h));
  gl_FragColor = vec4(c, 1.0);
}`;

/** A floodlight's beam: brighter at its core and its source, gone at the edges. */
const CONE_VS = `
uniform float uLen;
varying float vY;
varying vec3 vN, vV;
void main() {
  vY = clamp(-position.y / uLen, 0.0, 1.0);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const CONE_FS = `
uniform vec3 uColor;
uniform float uAlpha;
varying float vY;
varying vec3 vN, vV;
void main() {
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.8);
  float a = uAlpha * edge * (1.0 - vY * 0.8) * smoothstep(0.0, 0.06, vY);
  gl_FragColor = vec4(uColor, a);
}`;

/** The dome that closes over the ground for families: a grid of light, rising, with a bright edge. */
const DOME_VS = `
varying vec3 vP, vN, vW;
void main() { vP = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const DOME_FS = `
uniform float uRise, uAlpha, uR;
uniform vec3 uColor;
varying vec3 vP, vN, vW;
void main() {
  float h = vP.y / uR;
  if (h > uRise) discard;
  vec3 V = normalize(cameraPosition - vW);
  float fr = pow(1.0 - abs(dot(normalize(vN), V)), 2.2);
  float lon = atan(vP.z, vP.x);
  float lat = asin(clamp(h, 0.0, 1.0));
  float g = max(smoothstep(0.965, 1.0, abs(sin(lon * 30.0))), smoothstep(0.965, 1.0, abs(sin(lat * 18.0))));
  float edge = exp(-pow((h - uRise) * 36.0, 2.0));
  float a = uAlpha * (0.08 * fr + 0.26 * g * (0.35 + fr) + 0.85 * edge);
  gl_FragColor = vec4(uColor, a);
}`;

// ─── Drawings for textures ─────────────────────────────────────────

function drawGlow(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.55)");
  g.addColorStop(0.45, "rgba(255,255,255,0.14)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** The pitch, 3.05 m by 22 m, at 64 px a metre across: clay, wear, and the creases. */
function drawPitch(ctx, w, h) {
  const R = rng(7);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, "#8d7446"); g.addColorStop(0.5, "#c2a46a"); g.addColorStop(1, "#8d7446");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = R() > 0.5 ? "rgba(255,240,200,0.06)" : "rgba(60,40,10,0.08)";
    ctx.fillRect(R() * w, R() * h, 2, 2);
  }
  const m = h / 22;                    // pixels a metre along
  const cx = w / 2, mx = w / 3.05;     // pixels a metre across
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 3;
  for (const end of [-1, 1]) {
    const stumps = h / 2 + end * 10.06 * m, popping = h / 2 + end * 8.84 * m;
    ctx.beginPath(); ctx.moveTo(cx - 1.32 * mx, stumps); ctx.lineTo(cx + 1.32 * mx, stumps); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, popping); ctx.lineTo(w, popping); ctx.stroke();
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(cx + s * 1.32 * mx, popping); ctx.lineTo(cx + s * 1.32 * mx, stumps + end * 1.2 * m); ctx.stroke();
    }
    // Wear where the bowlers land.
    const wear = ctx.createRadialGradient(cx, popping - end * 1.2 * m, 2, cx, popping - end * 1.2 * m, 0.9 * mx);
    wear.addColorStop(0, "rgba(90,62,28,0.45)"); wear.addColorStop(1, "rgba(90,62,28,0)");
    ctx.fillStyle = wear;
    ctx.fillRect(0, 0, w, h);
  }
}

const RIBBON = "SCRBRD  ·  SCHOOL CRICKET, SCORED LIVE  ·  KEPT SAFE  ·  ";
function drawRibbon(ctx, w, h) {
  ctx.fillStyle = "#04070b";
  ctx.fillRect(0, 0, w, h);
  ctx.font = `700 ${Math.round(h * 0.56)}px ${HEAD}`;
  ctx.textBaseline = "middle";
  let x = 8, i = 0;
  while (x < w) {
    ctx.fillStyle = i % 2 ? "#3fd8ff" : "#b9f227";
    ctx.fillText(RIBBON, x, h / 2 + 2);
    x += ctx.measureText(RIBBON).width;
    i++;
  }
}

/** The stands' crowd, as texture: tiers of muted speckle, nobody in particular, lit by the towers. */
function drawCrowd(ctx, w, h) {
  const R = rng(5);
  ctx.fillStyle = "#0a0f18";
  ctx.fillRect(0, 0, w, h);
  const palette = ["#c9b79c", "#8a94a5", "#5d6b80", "#e0e6ee", "#7a5c4a", "#3a4a66", "#a8b8c8", "#b9f227", "#2ee6d6", "#d0603c"];
  for (let y = 0; y < h; y += 4) {
    if (y % 32 > 25) continue;   // the gangway between two tiers
    for (let x = 0; x < w; x += 3) {
      if (R() < 0.3) continue;
      const c = palette[Math.floor(R() ** 1.6 * palette.length)];
      ctx.globalAlpha = 0.25 + R() * 0.55;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 2, 3);
    }
  }
  ctx.globalAlpha = 1;
}

function drawLamps(ctx, w, h) {
  ctx.fillStyle = "#1a1d22";
  ctx.fillRect(0, 0, w, h);
  const cols = 8, rows = 4, pw = w / cols, ph = h / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const g = ctx.createRadialGradient((c + 0.5) * pw, (r + 0.5) * ph, 0, (c + 0.5) * pw, (r + 0.5) * ph, pw * 0.5);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.5, "#fff6dc"); g.addColorStop(1, "rgba(255,240,200,0)");
    ctx.fillStyle = g;
    ctx.fillRect(c * pw, r * ph, pw, ph);
  }
}

/**
 * The scoreboard's face. `state` is "sample" (the film's delivery, before or
 * after the six) or "brand"; `flip` 0 → 1 turns the figures over.
 */
function drawBoard(ctx, w, h, state, flip) {
  ctx.fillStyle = "#06090a";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.textBaseline = "alphabetic";
  if (state.kind === "brand") {
    ctx.fillStyle = "#b9f227";
    ctx.font = `800 ${Math.round(h * 0.34)}px ${HEAD}`;
    ctx.textAlign = "center";
    ctx.fillText("SCRBRD", w / 2, h * 0.56);
    ctx.fillStyle = "#c9d1db";
    ctx.font = `500 ${Math.round(h * 0.085)}px ${MONO}`;
    ctx.fillText("SCORED LIVE  ·  KEPT SAFE", w / 2, h * 0.78);
    ctx.textAlign = "left";
    return;
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#8a94a5";
  ctx.font = `500 ${Math.round(h * 0.075)}px ${MONO}`;
  ctx.fillText("SAMPLE · NOT A REAL MATCH", 36, h * 0.17);
  ctx.textAlign = "right";
  ctx.fillStyle = "#b9f227";
  ctx.fillText("SCRBRD", w - 36, h * 0.17);
  ctx.textAlign = "left";
  ctx.fillStyle = "#f4f6f3";
  ctx.font = `700 ${Math.round(h * 0.2)}px ${HEAD}`;
  ctx.fillText("U14A", 36, h * 0.56);
  // The figures, turning over: squashed to nothing at the half, then the new ones.
  const s = Math.abs(Math.cos(flip * Math.PI));
  const shown = flip < 0.5 ? state.from : state.to;
  ctx.save();
  ctx.translate(w - 36, h * 0.5);
  ctx.scale(1, Math.max(0.02, s));
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = flip > 0 && state.lit ? "#b9f227" : "#f4f6f3";
  ctx.font = `500 ${Math.round(h * 0.36)}px ${MONO}`;
  ctx.fillText(shown.score, 0, 0);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.fillStyle = "#8a94a5";
  ctx.font = `500 ${Math.round(h * 0.085)}px ${MONO}`;
  ctx.fillText(`OVERS ${shown.overs}`, 36, h * 0.86);
  ctx.textAlign = "right";
  ctx.fillText(shown.last ? `LAST BALL ${shown.last}` : "", w - 36, h * 0.86);
  ctx.textAlign = "left";
}

const BEFORE = { score: "87/3", overs: "14.2", last: "" };
const AFTER = { score: "93/3", overs: "14.3", last: "6" };

// ─── The mount ─────────────────────────────────────────────────────

/**
 * Mount the arena on `canvas`, inside the sticky `stage`.
 *
 *   hud      { root, shot, score, overs, bar }: the HUD's elements (Arena.jsx),
 *            written by the loop, never read
 *   film     the hero's section, whose data-shot this keeps as the 2D film does
 *   forced   picked by hand (?arena=3d): never hand back for being slow
 *   onReady  the first frame is on the canvas (the page fades it in)
 *   onFail   (why) the scene cannot carry on: "lost" or "slow"
 *
 * Returns dispose().
 */
export function mountArena({ stage, canvas, hud, film, forced = false, onReady = () => {}, onFail = (/** @type {string} */ _why) => {} }) {
  const dprMax = Math.min(2, window.devicePixelRatio || 1);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: dprMax < 1.5, alpha: false, powerPreference: "high-performance", stencil: false });
  let dpr = dprMax;
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(NIGHT, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a1424, 140, 560);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1200);

  /** Everything made here, to be disposed. */
  const bin = /** @type {{ dispose(): void }[]} */ ([]);
  const keep = (/** @type {any} */ o) => { bin.push(o); return o; };

  const glow = keep(canvasTexture(128, 128, drawGlow).tex);
  const uScale = { value: 1 };
  const time = { value: 0 };

  /** A points material sharing the clock and the lens. */
  const pointsMat = (/** @type {Record<string, any>} */ u = {}, additive = true) => keep(new THREE.ShaderMaterial({
    uniforms: {
      time, uScale,
      uAlpha: { value: 1 }, uTwinkle: { value: 0 }, uRise: { value: 0 }, uWrap: { value: 0 },
      uWave: { value: 0 }, uCheer: { value: 0 }, uCrowd: { value: 0 }, uDrift: { value: new THREE.Vector3() },
      ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { value: v }])),
    },
    vertexShader: POINTS_VS, fragmentShader: POINTS_FS,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  }));
  /** Points from flat arrays. */
  const points = (/** @type {Float32Array} */ pos, /** @type {Float32Array} */ tint, /** @type {Float32Array} */ size, /** @type {Float32Array} */ phase, /** @type {THREE.ShaderMaterial} */ mat) => {
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
    g.setAttribute("size", new THREE.BufferAttribute(size, 1));
    g.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    scene.add(p);
    return p;
  };

  // ── Sky and stars ──
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(900, 32, 16)), keep(new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color("#02040a") }, mid: { value: new THREE.Color("#0b1a33") },
      horizon: { value: new THREE.Color("#2b3d5c") }, glow: { value: new THREE.Color("#6b3f4a") },
    },
    vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
  })));
  scene.add(sky);
  {
    const R = rng(11), N = 1100;
    const pos = new Float32Array(N * 3), tint = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const th = R() * Math.PI * 2, ph = Math.acos(0.08 + R() * 0.92);
      pos.set([Math.sin(ph) * Math.cos(th) * 820, Math.cos(ph) * 820, Math.sin(ph) * Math.sin(th) * 820], i * 3);
      const c = R() > 0.85 ? CYAN : WARM;
      tint.set([c.r, c.g, c.b], i * 3);
      size[i] = 1.6 + R() * 2.6; phase[i] = R();
    }
    points(pos, tint, size, phase, pointsMat({ uTwinkle: 0.8, uAlpha: 0.9 }));
  }

  // ── Lights, for the solid things ──
  scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x0b2f1d, 1.3));
  const key = new THREE.DirectionalLight(0xfff1d8, 2.2); key.position.set(60, 60, 40); scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 1.1); fill.position.set(-60, 50, -60); scene.add(fill);

  // ── The outfield ──
  const groundU = {
    grassA: { value: new THREE.Color("#174f2c") }, grassB: { value: new THREE.Color("#226e3c") },
    apron: { value: new THREE.Color("#0e2a1a") }, rope: { value: new THREE.Color("#e9f6ff") }, lime: { value: LIME.clone() },
    lamps: { value: TOWERS.map((t) => new THREE.Vector2(t.aim[0] * 1.6, t.aim[2] * 1.6)) },
    uPulse: { value: 0 }, uPulseA: { value: 0 }, uLight: { value: 1 }, time,
  };
  const ground = new THREE.Mesh(keep(new THREE.CircleGeometry(ROPE_R + 9, 96)), keep(new THREE.ShaderMaterial({ uniforms: groundU, vertexShader: GROUND_VS, fragmentShader: GROUND_FS })));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // ── The pitch, the stumps, the bails ──
  const pitchTex = keep(canvasTexture(196, 1408, drawPitch).tex);
  pitchTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const pitch = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.05, 22)), keep(new THREE.MeshBasicMaterial({ map: pitchTex, color: 0xd8d0c0 })));
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.y = 0.012;
  scene.add(pitch);
  const woodMat = keep(new THREE.MeshLambertMaterial({ color: 0xf1e6cc, emissive: 0x2a2418 }));
  const stumps = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.019, 0.019, 0.71, 10)), woodMat, 6);
  const bails = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.008, 0.008, 0.11, 6)), woodMat, 4);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    let s = 0, b = 0;
    for (const z of [-10.06, 10.06]) {
      for (const x of [-0.114, 0, 0.114]) stumps.setMatrixAt(s++, m.makeTranslation(x, 0.355, z));
      for (const x of [-0.057, 0.057]) bails.setMatrixAt(b++, m.compose(new THREE.Vector3(x, 0.716, z), q, new THREE.Vector3(1, 1, 1)));
    }
  }
  scene.add(stumps, bails);
  keep(stumps); keep(bails);

  // ── The footfalls of a run-up nobody is drawn making ──
  const steps = new THREE.InstancedMesh(keep(new THREE.RingGeometry(0.12, 0.26, 24)), keep(new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  })), STRIDES.length);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    STRIDES.forEach((s, i) => { steps.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, 0.03, s.z), q, new THREE.Vector3(1, 1.5, 1))); steps.setColorAt(i, new THREE.Color(0, 0, 0)); });
  }
  scene.add(steps);
  keep(steps);

  // ── The stands, their LED ribbon and roof line ──
  {
    const prof = [];
    for (let k = 0; k <= 6; k++) { prof.push(new THREE.Vector2(77 + k * 3, k * 3)); prof.push(new THREE.Vector2(77 + k * 3 + 3, k * 3)); }
    prof.push(new THREE.Vector2(98, 22), new THREE.Vector2(99, 22), new THREE.Vector2(99, 0));
    const crowdTex = keep(canvasTexture(1024, 256, drawCrowd).tex);
    crowdTex.wrapS = THREE.RepeatWrapping;
    crowdTex.repeat.set(3, 1);
    crowdTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const stands = new THREE.Mesh(keep(new THREE.LatheGeometry(prof, 96)), keep(new THREE.MeshLambertMaterial({ map: crowdTex, color: 0x9aa6bc, emissive: 0x05080e, side: THREE.DoubleSide })));
    scene.add(stands);
    const roof = new THREE.Mesh(keep(new THREE.CylinderGeometry(98.4, 98.4, 0.5, 128, 1, true)), keep(new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })));
    roof.position.y = 22.3;
    scene.add(roof);
  }
  const ribbon = keep(canvasTexture(2048, 64, drawRibbon).tex);
  ribbon.wrapS = THREE.RepeatWrapping;
  ribbon.repeat.set(-5, 1);
  const led = new THREE.Mesh(keep(new THREE.CylinderGeometry(76.6, 76.6, 1.1, 160, 1, true)), keep(new THREE.MeshBasicMaterial({ map: ribbon, side: THREE.BackSide, fog: false })));
  led.position.y = 0.55;
  scene.add(led);

  // ── The crowd, as light ──
  const crowdMat = pointsMat({ uTwinkle: 1, uAlpha: 0.6, uCrowd: 1 });
  {
    const R = rng(23), N = 2200;
    const pos = new Float32Array(N * 3), tint = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N);
    const palette = [WARM, WARM, WARM, LIME, CYAN, new THREE.Color("#ffb347"), new THREE.Color("#ff6b8a")];
    for (let i = 0; i < N; i++) {
      let th = R() * Math.PI * 2;
      // Clear of the scoreboard's stand.
      if (Math.abs(Math.atan2(Math.sin(th), -Math.cos(th))) < 0.12) th += 0.3;
      const k = Math.floor(R() * 6);
      const r = 78.5 + k * 3 + R() * 1.5, y = k * 3 + 0.9 + R() * 0.4;
      pos.set([Math.sin(th) * r, y, -Math.cos(th) * r], i * 3);
      const c = palette[Math.floor(R() * palette.length)];
      tint.set([c.r, c.g, c.b], i * 3);
      size[i] = 0.14 + R() * 0.18; phase[i] = R();
    }
    points(pos, tint, size, phase, crowdMat);
  }

  // ── The floodlights: towers, lamps, glow, beams, haze ──
  const towerMat = keep(new THREE.MeshLambertMaterial({ color: 0x2a313c }));
  const towerGeo = keep(new THREE.CylinderGeometry(0.45, 0.9, TOWER_H, 8));
  const lampTex = keep(canvasTexture(256, 128, drawLamps).tex);
  const headGeo = keep(new THREE.PlaneGeometry(9, 4.5));
  const headMat = keep(new THREE.MeshBasicMaterial({ map: lampTex, side: THREE.DoubleSide, fog: false }));
  const glowMat = keep(new THREE.SpriteMaterial({ map: glow, color: 0xfff1d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const coneMats = /** @type {THREE.ShaderMaterial[]} */ ([]);
  const haze = [];
  for (const t of TOWERS) {
    const tower = new THREE.Mesh(towerGeo, towerMat);
    tower.position.set(t.x, TOWER_H / 2, t.z);
    scene.add(tower);
    const top = new THREE.Vector3(t.x, TOWER_H + 2, t.z);
    const aim = new THREE.Vector3(...t.aim);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.copy(top);
    head.lookAt(aim);
    scene.add(head);
    const big = new THREE.Sprite(glowMat); big.position.copy(top); big.scale.set(78, 78, 1); scene.add(big);
    const core = new THREE.Sprite(glowMat); core.position.copy(top); core.scale.set(22, 22, 1); scene.add(core);
    const len = top.distanceTo(aim);
    const coneGeo = keep(new THREE.CylinderGeometry(3, 26, len, 32, 1, true));
    coneGeo.translate(0, -len / 2, 0);
    const mat = keep(new THREE.ShaderMaterial({
      uniforms: { uLen: { value: len }, uColor: { value: new THREE.Color("#fff4d8") }, uAlpha: { value: 0.11 } },
      vertexShader: CONE_VS, fragmentShader: CONE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    coneMats.push(mat);
    const cone = new THREE.Mesh(coneGeo, mat);
    cone.position.copy(top);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim.clone().sub(top).normalize());
    scene.add(cone);
    haze.push({ top, aim });
  }
  const hazeMat = pointsMat({ uAlpha: 0.12, uTwinkle: 0.4, uDrift: new THREE.Vector3(1.6, 0.9, 1.6) });
  {
    const R = rng(31), per = 70, N = per * haze.length;
    const pos = new Float32Array(N * 3), tint = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N);
    haze.forEach(({ top, aim }, h) => {
      for (let i = 0; i < per; i++) {
        const u = Math.pow(R(), 0.8), spread = 1 + u * 11;
        const p = top.clone().lerp(aim, u);
        p.x += (R() - 0.5) * spread; p.y += (R() - 0.5) * spread * 0.5; p.z += (R() - 0.5) * spread;
        const k = (h * per + i);
        pos.set([p.x, Math.max(0.5, p.y), p.z], k * 3);
        tint.set([1, 0.95, 0.85], k * 3);
        size[k] = 0.8 + R() * 1.3; phase[k] = R();
      }
    });
    points(pos, tint, size, phase, hazeMat);
  }
  // Dust over the square, rising slowly through the light.
  {
    const R = rng(41), N = 420;
    const pos = new Float32Array(N * 3), tint = new Float32Array(N * 3), size = new Float32Array(N), phase = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos.set([(R() - 0.5) * 60, R() * 14, (R() - 0.5) * 70], i * 3);
      tint.set([1, 0.93, 0.8], i * 3);
      size[i] = 0.05 + R() * 0.08; phase[i] = R();
    }
    points(pos, tint, size, phase, pointsMat({ uAlpha: 0.55, uTwinkle: 0.6, uRise: 0.18, uWrap: 14, uDrift: new THREE.Vector3(0.8, 0, 0.8) }));
  }

  // ── The scoreboard ──
  let boardState = { kind: "sample", from: BEFORE, to: AFTER, lit: true };
  const board = canvasTexture(1024, 400, (c, w, h) => drawBoard(c, w, h, { kind: "sample", from: BEFORE, to: BEFORE }, 0));
  keep(board.tex);
  const boardMesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(BOARD.w, BOARD.h)), keep(new THREE.MeshBasicMaterial({ map: board.tex, fog: false })));
  boardMesh.position.set(BOARD.x, BOARD.y, BOARD.z);
  scene.add(boardMesh);
  const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(BOARD.w + 1.4, BOARD.h + 1.4, 1)), towerMat);
  frame.position.set(BOARD.x, BOARD.y, BOARD.z - 0.6);
  scene.add(frame);
  const legs = new THREE.Mesh(keep(new THREE.BoxGeometry(2, BOARD.y - BOARD.h / 2, 2)), towerMat);
  legs.position.set(BOARD.x, (BOARD.y - BOARD.h / 2) / 2, BOARD.z - 0.6);
  scene.add(legs);
  const boardGlow = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glow, color: 0xb9f227, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
  boardGlow.position.set(BOARD.x, BOARD.y, BOARD.z - 1.2);
  boardGlow.scale.set(60, 34, 1);
  scene.add(boardGlow);
  let boardKey = "", flipAt = -1;
  const paintBoard = (/** @type {number} */ flip) => { drawBoard(board.ctx, 1024, 400, boardState, flip); board.tex.needsUpdate = true; };

  // ── The ball, its glow, its trail; the bounce's dust, the crowd's catch ──
  const ball = new THREE.Group();
  ball.add(new THREE.Mesh(keep(new THREE.SphereGeometry(0.1, 20, 14)), keep(new THREE.MeshBasicMaterial({ color: 0xd3202c }))));
  const seam = new THREE.Mesh(keep(new THREE.TorusGeometry(0.101, 0.009, 6, 36)), keep(new THREE.MeshBasicMaterial({ color: 0xf6efdc })));
  ball.add(seam);
  scene.add(ball);
  const ballGlow = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: glow, color: 0xff5a3c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
  scene.add(ballGlow);
  const TRAIL = 170;
  const trailPos = new Float32Array(TRAIL * 3), trailSize = new Float32Array(TRAIL), trailTint = new Float32Array(TRAIL * 3);
  const trail = points(trailPos, trailTint, trailSize, new Float32Array(TRAIL), pointsMat({ uAlpha: 1 }));
  const hot = new THREE.Color("#fff2c4"), tail = new THREE.Color("#ff3b2f");
  const burst = (/** @type {number} */ n, /** @type {number} */ seed, /** @type {THREE.Color[]} */ colours, /** @type {number} */ big) => {
    const R = rng(seed);
    const dir = new Float32Array(n * 3), pos = new Float32Array(n * 3), tint = new Float32Array(n * 3), size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const th = R() * Math.PI * 2, up = 0.3 + R() * 0.9, sp = 0.4 + R();
      dir.set([Math.cos(th) * sp, up * sp, Math.sin(th) * sp], i * 3);
      const c = colours[i % colours.length];
      tint.set([c.r, c.g, c.b], i * 3);
      size[i] = big * (0.6 + R() * 0.8);
    }
    const mat = pointsMat({ uAlpha: 0 });
    return { dir, pts: points(pos, tint, size, new Float32Array(n), mat), mat, n };
  };
  const dust = burst(80, 51, [new THREE.Color("#d9bf86"), new THREE.Color("#fff1d0")], 0.09);
  const catchBurst = burst(140, 61, [LIME, CYAN, WARM], 0.7);
  /** Spread a burst from `at` at progress p (0 → 1), `reach` metres, falling. */
  const spread = (/** @type {ReturnType<typeof burst>} */ bu, /** @type {number[]} */ at, /** @type {number} */ p, /** @type {number} */ reach) => {
    const a = /** @type {THREE.BufferAttribute} */ (bu.pts.geometry.getAttribute("position"));
    const arr = /** @type {Float32Array} */ (a.array);
    for (let i = 0; i < bu.n; i++) {
      arr[i * 3] = at[0] + bu.dir[i * 3] * p * reach;
      arr[i * 3 + 1] = Math.max(0.02, at[1] + bu.dir[i * 3 + 1] * p * reach - p * p * reach * 0.9);
      arr[i * 3 + 2] = at[2] + bu.dir[i * 3 + 2] * p * reach;
    }
    a.needsUpdate = true;
    bu.mat.uniforms.uAlpha.value = p > 0 && p < 1 ? (1 - p) ** 1.5 : 0;
  };

  // ── The dome that closes over the ground for families ──
  const DOME_R = 74;
  const domeMat = keep(new THREE.ShaderMaterial({
    uniforms: { uRise: { value: 0 }, uAlpha: { value: 0 }, uR: { value: DOME_R }, uColor: { value: LIME.clone().lerp(CYAN, 0.35) } },
    vertexShader: DOME_VS, fragmentShader: DOME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  const dome = new THREE.Mesh(keep(new THREE.SphereGeometry(DOME_R, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2)), domeMat);
  dome.visible = false;
  scene.add(dome);

  // ── Where the page is, and the camera that follows it ──
  /** @type {string[]} */ let names = [];
  /** @type {number[]} */ let at = [0];
  const measure = () => {
    const els = /** @type {HTMLElement[]} */ ([...document.querySelectorAll("[data-cam]")]);
    const y = window.scrollY;
    names = els.map((e) => e.dataset.cam ?? "hero");
    at = anchors(els.map((e) => e.getBoundingClientRect().top + y), window.innerHeight || 1);
  };

  const cur = { pos: new THREE.Vector3(...cameraAt(["hero"], 0, [0, 0, 0]).pos), look: new THREE.Vector3(0, 3, -4), fov: 48 };
  const want = new THREE.Vector3(), wantLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let pointer = { x: 0, y: 0 }, pointerAim = { x: 0, y: 0 };
  const onPointer = (/** @type {PointerEvent} */ e) => {
    if (e.pointerType !== "mouse") return;
    pointerAim = { x: (e.clientX / (window.innerWidth || 1)) * 2 - 1, y: (e.clientY / (window.innerHeight || 1)) * 2 - 1 };
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  let w = 0, h = 0;
  const resize = () => {
    const r = stage.getBoundingClientRect();
    w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    measure();
  };

  // ── The loop ──
  let raf = 0, last = 0, clock = 0, visible = true, dead = false, ready = false, frames = 0;
  let prevB = 0, shake = 0, cheer = 0, pulse = -1, prevAnchor = 0, wave = 0;
  let sampleSince = 0, sampleFrames = 0, sampleMs = 0, fpsSince = 0, fpsFrames = 0, born = 0;
  /** @type {Record<string, string>} */
  const hudText = {};
  const write = (/** @type {HTMLElement | null | undefined} */ el, /** @type {string} */ k, /** @type {string} */ v) => {
    if (!el || hudText[k] === v) return;
    hudText[k] = v;
    el.textContent = v;
  };
  let hudOn = "";

  const tick = (/** @type {number} */ now) => {
    raf = 0;
    if (dead || !visible || document.hidden) return;
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    clock += dt;
    time.value = clock;

    const f = progress(at, window.scrollY);
    const b = phaseOf(Math.min(f, FILM.length - 1 + 0.5));
    const bp = ballAt(b);

    // Moments, as the delivery is scrolled forward through them.
    if (prevB < 3 && b >= 3) shake = 1;                                   // bat on ball
    if (prevB < 2 && b >= 2) { pulse = 0; groundU.uPulseA.value = 0.9; }  // the bounce
    if (!landed(prevB) && landed(b)) { cheer = 1; flipAt = now; }       // six
    if (landed(prevB) && !landed(b)) flipAt = now;                      // scrolled back
    prevB = b;
    const anchor = Math.round(f);
    if (anchor !== prevAnchor && anchor >= FILM.length) { pulse = 0; groundU.uPulseA.value = 0.7; }
    prevAnchor = anchor;

    // The camera the page asks for, then smoothed, swayed, nudged by the pointer, shaken.
    const cam = cameraAt(names, f, bp);
    want.set(...cam.pos);
    wantLook.set(...cam.look);
    const k = 1 - Math.exp(-dt * 6.5);
    cur.pos.lerp(want, k);
    cur.look.lerp(wantLook, k);
    cur.fov += (fovFor(cam.fov, camera.aspect) - cur.fov) * k;
    pointer.x += (pointerAim.x - pointer.x) * Math.min(1, dt * 3);
    pointer.y += (pointerAim.y - pointer.y) * Math.min(1, dt * 3);
    tmp.copy(cur.pos).sub(cur.look);
    const dist = tmp.length();
    tmp.applyAxisAngle(THREE.Object3D.DEFAULT_UP, cam.sway * Math.sin(clock * 0.13) + pointer.x * 0.06);
    camera.position.copy(cur.look).add(tmp);
    camera.position.y += dist * (0.012 * cam.sway * Math.sin(clock * 0.21) - pointer.y * 0.02);
    if (shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * 0.12 * shake;
      camera.position.y += (Math.random() - 0.5) * 0.12 * shake;
      shake *= Math.exp(-dt * 7);
    }
    camera.position.y = Math.max(0.35, camera.position.y);
    camera.fov = cur.fov;
    camera.updateProjectionMatrix();
    camera.lookAt(cur.look);
    uScale.value = (h * dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360));

    // The ball.
    const inFilm = f < FILM.length - 0.4;
    ball.visible = inFilm && b > 0.02 && b < 4.25;
    ball.position.set(...bp);
    ball.rotation.x -= dt * (b > 1 ? 22 : 3);
    seam.rotation.y = 0.4;
    ballGlow.visible = ball.visible && b > 0.9;
    ballGlow.position.copy(ball.position);
    const gs = Math.max(0.9, camera.position.distanceTo(ball.position) * 0.045) * (b > 3 ? 1.6 : 1);
    ballGlow.scale.set(gs, gs, 1);
    // Its trail: where it was over the last third of a phase, fading.
    const pa = /** @type {THREE.BufferAttribute} */ (trail.geometry.getAttribute("position"));
    const sa = /** @type {THREE.BufferAttribute} */ (trail.geometry.getAttribute("size"));
    const ta = /** @type {THREE.BufferAttribute} */ (trail.geometry.getAttribute("tint"));
    const showTrail = ball.visible && b > 1.02;
    for (let i = 0; i < TRAIL; i++) {
      const u = i / (TRAIL - 1);
      const p = ballAt(Math.max(1, b - u * (b > 3 ? 0.42 : 0.3)));
      pa.setXYZ(i, p[0], p[1], p[2]);
      sa.setX(i, showTrail ? (0.2 + (b > 3 ? 0.35 : 0)) * (1 - u) ** 0.8 : 0);
      const c = tmpColor.copy(hot).lerp(tail, u).multiplyScalar((1 - u) ** 1.6);
      ta.setXYZ(i, c.r, c.g, c.b);
    }
    pa.needsUpdate = sa.needsUpdate = ta.needsUpdate = true;
    spread(dust, SPOT.bounce, inFilm ? clamp((b - 2) / 0.55) : 0, 1.6);
    spread(catchBurst, SPOT.land, inFilm ? clamp((b - 3.92) / 0.38) : 0, 9);
    // The run-up's footfalls, lit as the ball passes each one.
    STRIDES.forEach((s, i) => {
      const lit = inFilm ? Math.max(0, 1 - Math.abs(b - s.at) * 2.4) * (b < 1.04 ? 1 : 0) + (b > s.at && b < 1.04 ? 0.18 : 0) : 0;
      steps.setColorAt(i, tmpColor.copy(LIME).multiplyScalar(lit));
    });
    if (steps.instanceColor) steps.instanceColor.needsUpdate = true;

    // The scoreboard: the sample until the film is over, then the name.
    const nextState = f < FILM.length + 0.4 ? (landed(b) ? "after" : "before") : "brand";
    if (nextState !== boardKey) {
      if (boardKey === "" || nextState === "brand" || boardKey === "brand") flipAt = -1;
      boardState = nextState === "brand" ? { kind: "brand", from: AFTER, to: AFTER, lit: false }
        : nextState === "after" ? { kind: "sample", from: BEFORE, to: AFTER, lit: true } : { kind: "sample", from: AFTER, to: BEFORE, lit: false };
      boardKey = nextState;
      paintBoard(flipAt < 0 ? 1 : 0);
    } else if (flipAt >= 0) {
      const p = clamp((now - flipAt) / 420);
      paintBoard(p);
      if (p >= 1) flipAt = -1;
    }
    boardGlow.material.opacity = 0.18 + 0.3 * cam.board + 0.4 * cheer;

    // The crowd, the wave, the ribbon, the pulse, the lights, the dome.
    wave += dt * 0.55;
    cheer *= Math.exp(-dt * 0.9);
    crowdMat.uniforms.uWave.value = wave % (Math.PI * 2);
    crowdMat.uniforms.uCheer.value = cheer;
    ribbon.offset.x = (clock * 0.015) % 1;
    if (pulse >= 0) {
      pulse += dt * 55;
      groundU.uPulse.value = pulse;
      groundU.uPulseA.value *= Math.exp(-dt * 1.6);
      if (pulse > ROPE_R + 6) { pulse = -1; groundU.uPulseA.value = 0; }
    }
    const dim = 1 - 0.3 * cam.dome;
    groundU.uLight.value = dim;
    for (const m of coneMats) m.uniforms.uAlpha.value = 0.11 * dim;
    dome.visible = cam.dome > 0.01;
    domeMat.uniforms.uRise.value = smoothstep(0.05, 0.95, cam.dome) * 1.02;
    domeMat.uniforms.uAlpha.value = Math.min(1, cam.dome * 1.4);

    renderer.render(scene, camera);
    frames++;

    // The HUD over the film: which shot, the sample's score, the delivery's progress.
    const onFilm = f > 0.45 && f < FILM.length - 0.5;
    const nextHud = onFilm ? "on" : "";
    if (nextHud !== hudOn && hud?.root) { hudOn = nextHud; hud.root.classList.toggle("on", onFilm); }
    if (onFilm && hud) {
      write(hud.shot, "shot", `0${clamp(Math.round(f), 1, 5)}`);
      write(hud.score, "score", landed(b) ? AFTER.score : BEFORE.score);
      write(hud.overs, "overs", landed(b) ? AFTER.overs : BEFORE.overs);
      if (hud.bar) hud.bar.style.transform = `scaleX(${(b / 4.3).toFixed(4)})`;
    }
    if (film) {
      const shot = String(clamp(Math.round(f), 1, 5));
      if (film.dataset.shot !== shot) film.dataset.shot = shot;
    }

    if (!ready) { ready = true; onReady(); }

    // How fast, measured honestly, and the quality stepped down if it must be.
    fpsFrames++;
    if (now - fpsSince >= 1000) {
      stage.dataset.fps = fpsSince ? String(Math.round((fpsFrames * 1000) / (now - fpsSince))) : "";
      stage.dataset.frames = String(frames);
      stage.dataset.dpr = String(dpr);
      fpsSince = now; fpsFrames = 0;
    }
    // Over windows of a second and a half of wall time, after a second to
    // settle: past 21 ms a frame the pixel ratio steps down by half, to 1;
    // past 40 ms at 1, the film takes over (unless the scene was picked by hand).
    if (!born) born = now;
    if (now - born > 1000) {
      if (!sampleSince) sampleSince = now;
      sampleFrames++;
      sampleMs = now - sampleSince;
      if (sampleMs >= 1500 && sampleFrames >= 6) {
        const ms = sampleMs / sampleFrames;
        sampleSince = now; sampleFrames = 0;
        if (ms > 21 && dpr > 1) { dpr = Math.max(1, dpr - 0.5); resize(); }
        else if (ms > 40 && dpr <= 1 && !forced) { onFail("slow"); }
      }
    }
  };
  const tmpColor = new THREE.Color();

  const start = () => {
    if (dead || raf || !visible || document.hidden) return;
    last = 0; sampleSince = 0; sampleFrames = 0; fpsSince = 0; fpsFrames = 0;
    raf = requestAnimationFrame(tick);
  };
  const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };

  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) start(); else stop(); });
  io.observe(stage);
  const onVis = () => { if (document.hidden) stop(); else start(); };
  document.addEventListener("visibilitychange", onVis);
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  const body = new ResizeObserver(measure);
  body.observe(document.body);
  window.addEventListener("resize", measure, { passive: true });
  const onLost = (/** @type {Event} */ e) => { e.preventDefault(); stop(); onFail("lost"); };
  canvas.addEventListener("webglcontextlost", onLost);
  document.fonts?.ready?.then(() => {
    if (dead) return;
    const r = canvasTexture(2048, 64, drawRibbon);
    ribbon.image = r.canvas; ribbon.needsUpdate = true;
    boardKey = "";
  });
  resize();
  start();

  return () => {
    dead = true;
    stop();
    io.disconnect(); ro.disconnect(); body.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("resize", measure);
    window.removeEventListener("pointermove", onPointer);
    canvas.removeEventListener("webglcontextlost", onLost);
    for (const d of bin) d.dispose();
    renderer.dispose();
  };
}

