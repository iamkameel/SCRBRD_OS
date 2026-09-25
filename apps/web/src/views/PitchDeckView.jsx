import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import pkg from "../../package.json";
import SCRBRD_LOGO from "../assets/scrbrd-logo.jpg";
import { D, T, clr, textOn, themeName, themed } from "../design/tokens.js";
import { ROLE_FAMILIES, ROLE_IDENTITY } from "../design/roles.js";
import { STATUS_LABEL, STATUS_TONE, UPGRADES } from "../data/roadmap.js";
import { useSummary } from "../lib/live.js";
import { profile } from "../lib/session.js";
import { signedIn } from "../lib/api.js";
import { seedCompletedMatch } from "../scorer/seed.js";
import { CX, CY, LK_COLS, R_BND, SEGS, lineKey, pieSlice, toXY } from "../scorer/field.js";
import { ALL_CAPABILITIES, PLATFORM_ONLY, SENSITIVE } from "@scrbrd/policy/capabilities";
import { ROLES, ROLE_CAPABILITIES } from "@scrbrd/policy/roles";
import { MASKED_TABLES, TABLES } from "@scrbrd/policy/tables";
import { FEATURES, MODULES, SPORTS } from "@scrbrd/policy/modules";
import { Icon } from "../ui/icons.jsx";

// ══════════════════════════════════════════════════════
//  PITCH DECK
//
//  Eight slides over one stage. The stage is a three.js field with an
//  innings drawn on it, fetched on first use (views/pitchdeck/scene.js) so
//  the library never reaches the entry chunk; when the browser cannot draw in
//  3D the same wheel is drawn flat in SVG and the deck says nothing about it.
//
//  Every figure on these slides is read from somewhere that would change if
//  the product changed: the policy package for roles, capabilities, tables
//  and modules; the roadmap list Settings draws; the summary read for a
//  signed-in school; a deterministic seeded innings for the wheel. The one
//  slide that is prose — the problem — is prose, and is labelled as the
//  argument rather than the evidence.
//
//  Keyboard: arrows, Space, PageUp/Down, Home, End, 1-8, F for full screen.
// ══════════════════════════════════════════════════════

// ── Facts, computed once from the policy ──
const CAP_FAMILIES = (() => {
  const by = {};
  for (const c of ALL_CAPABILITIES) { const f = c.split(".")[0]; by[f] = (by[f] ?? 0) + 1; }
  return Object.entries(by).sort((a, b) => b[1] - a[1]);
})();
const ENGINES = Object.values(SPORTS).reduce((acc, s) => { acc[s.engine] = (acc[s.engine] ?? 0) + 1; return acc; }, {});
const ROADMAP = Object.fromEntries(["shipped", "partial", "planned"].map((s) => [s, UPGRADES.filter((u) => u.status === s)]));
const familyLabel = (f) => f.charAt(0).toUpperCase() + f.slice(1);

// ── The demonstration innings ──
// Deterministic from its key, so the wheel is the same wheel at every showing.
// Twenty overs, a chase-sized total, six down: enough to fill every sector.
const DEMO = (() => {
  const names = (p) => Array.from({ length: 11 }, (_, i) => `${p} ${i + 1}`);
  const { innings } = seedCompletedMatch({ matchId: "pitch-deck-2026", team1: "HOME", team2: "AWAY", squad1: names("Home"), squad2: names("Away"),
                                          inns: [{ runs: 163, wickets: 6, balls: 120 }], liveLast: false });
  const inn = innings[0];
  const balls = inn.ballLog;
  const legal = balls.filter((b) => b.type !== "Wd" && b.type !== "Nb");
  const zones = SEGS.map((s) => ({ ...s, runs: 0, balls: 0 }));
  for (const b of balls) if (b.seg != null) { zones[b.seg].runs += b.value; zones[b.seg].balls++; }
  // Only a ball with a sector draws a spoke, so only those keys are offered
  // as a filter: a wicket is on the scoreline, not on the wheel.
  const keys = {};
  for (const b of balls) if (b.seg != null) { const k = lineKey(b); keys[k] = (keys[k] ?? 0) + 1; }
  const side = (s) => zones.filter((z) => z.side === s).reduce((a, z) => a + z.runs, 0);
  return {
    balls, runs: inn.runs, wickets: inn.wickets, legal: legal.length,
    fours: legal.filter((b) => b.value === 4).length, sixes: legal.filter((b) => b.value === 6).length,
    dots: legal.filter((b) => b.value === 0 && b.type !== "W").length,
    extras: balls.length - legal.length,
    zones: [...zones].sort((a, b) => b.runs - a.runs), keys, offRuns: side("off"), legRuns: side("leg"),
    partnerships: inn.partnerships.length,
  };
})();

const VIEW_OF = { cover: "orbit", problem: "low", wheel: "wheel", platform: "far", access: "top", school: "close", roadmap: "far", close: "orbit" };

const SLIDES = [
  { id: "cover",    label: "SCRBRD" },
  { id: "problem",  label: "The season, today" },
  { id: "wheel",    label: "Every ball, where it went" },
  { id: "platform", label: "One switchboard" },
  { id: "access",   label: "Who may see what" },
  { id: "school",   label: "Your school, now" },
  { id: "roadmap",  label: "Built, underneath, planned" },
  { id: "close",    label: "See it on your fixtures" },
];

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that counts up to its value when it first appears; instantly under reduced motion. */
function useCount(target, ms = 900) {
  const [n, setN] = useState(reducedMotion() ? target : 0);
  useEffect(() => {
    if (reducedMotion() || !Number.isFinite(target)) { setN(target); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      setN(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return Number.isFinite(target) ? n : target;
}

// A function, not a constant: it is built from the tokens, and a sheet built
// once at import would hold whichever theme was current when the deck loaded.
const css = () => `
.deck{position:relative;border-radius:${D.xl};overflow:hidden;background:${D.bg};border:1px solid ${D.border};min-height:min(78vh,760px);display:flex;flex-direction:column;isolation:isolate}
.deck:focus-visible{outline:2px solid ${D.cyan};outline-offset:2px}
.deck:fullscreen{border-radius:0;border:none;min-height:100vh}
.deck-stage{position:absolute;inset:0;z-index:0}
.deck-stage[data-mode="fallback"]{background:${T.light.ambient},${D.bg}}
.deck-scrim{position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(180deg,${clr(T.surface.canvas,.62)},${clr(T.surface.canvas,.28)} 40%,${clr(T.surface.canvas,.72)})}
.deck-scrim[data-side="right"]{background:linear-gradient(90deg,${clr(T.surface.canvas,.05)} 35%,${clr(T.surface.canvas,.78)} 62%)}
.deck-bar{position:relative;z-index:3;display:flex;align-items:center;gap:10px;padding:12px 16px;flex-wrap:wrap}
.deck-progress{position:absolute;left:0;top:0;height:2px;background:${D.cyan};transition:width ${T.motion.nav} ${T.motion.ease};z-index:4}
.deck-body{position:relative;z-index:2;flex:1;display:flex;flex-direction:column;justify-content:center;padding:28px 40px 36px;pointer-events:none}
.deck-slide{pointer-events:none}
.deck-slide button,.deck-slide .deck-card,.deck-slide img{pointer-events:auto}
.deck-slide{animation:deckIn ${T.motion.context} ${T.motion.ease} both}
.deck-slide[data-dir="back"]{animation-name:deckBack}
@keyframes deckIn{from{opacity:0;transform:translate3d(0,22px,0) scale(.985);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
@keyframes deckBack{from{opacity:0;transform:translate3d(0,-22px,0) scale(.985);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
.deck-rise{animation:deckRise ${T.motion.context} ${T.motion.ease} both;animation-delay:calc(var(--i,0)*70ms)}
@keyframes deckRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.deck-kicker{font-family:${D.mono};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${D.cyan};margin-bottom:10px}
.deck-h{font-family:${D.head};font-weight:800;line-height:1.02;letter-spacing:-.02em;color:${D.textPrimary};font-size:clamp(28px,4.6vw,54px);margin:0 0 14px}
.deck-lede{font-family:${D.body};font-size:clamp(14px,1.4vw,17px);color:${D.textSecondary};line-height:1.65;max-width:720px;margin:0}
.deck-grid{display:grid;gap:12px}
.deck-card{border-radius:${D.lg};border:1px solid ${D.border};background:${clr(T.surface.raised,.82)};padding:14px 16px;backdrop-filter:blur(6px)}
.deck-num{font-family:${D.mono};font-weight:700;font-size:clamp(26px,3.2vw,40px);line-height:1;color:${D.textPrimary};font-variant-numeric:tabular-nums}
.deck-cap{font-family:${D.head};font-size:11px;font-weight:700;color:${D.textPrimary};margin-top:6px}
.deck-sub{font-family:${D.body};font-size:11px;color:${D.textMuted};margin-top:2px;line-height:1.45}
.deck-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:${D.pill};border:1px solid ${D.border};background:${clr(T.surface.raised,.7)};font-family:${D.mono};font-size:11px;color:${D.textSecondary};cursor:pointer;transition:border-color ${T.motion.micro} ${T.motion.swift},transform ${T.motion.micro} ${T.motion.swift}}
.deck-chip:hover{transform:translateY(-1px)}
.deck-chip[aria-pressed="true"]{border-color:${D.cyan};color:${D.textPrimary}}
.deck-row{display:grid;grid-template-columns:110px 1fr 40px;align-items:center;gap:10px;font-family:${D.mono};font-size:11px;color:${D.textSecondary}}
.deck-track{height:8px;border-radius:4px;background:${T.line.subtle};overflow:hidden}
.deck-fill{height:100%;border-radius:4px;transform-origin:left;animation:deckGrow ${T.motion.interrupt} ${T.motion.ease} both;animation-delay:calc(var(--i,0)*60ms);display:block}
@keyframes deckGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.deck-nav{display:flex;gap:6px;align-items:center}
.deck-dot{width:22px;height:6px;border-radius:3px;border:none;padding:0;cursor:pointer;background:${T.line.strong};transition:background ${T.motion.control} ${T.motion.swift},width ${T.motion.control} ${T.motion.swift}}
.deck-dot[aria-current="true"]{background:${D.cyan};width:34px}
.deck-btn{padding:7px 14px;border-radius:${D.pill};border:1px solid ${D.border};background:${clr(T.surface.raised,.7)};color:${D.textSecondary};font-family:${D.head};font-size:11px;font-weight:700;cursor:pointer;transition:border-color ${T.motion.micro} ${T.motion.swift},color ${T.motion.micro} ${T.motion.swift}}
.deck-btn:hover:not(:disabled){border-color:${D.cyan};color:${D.textPrimary}}
.deck-btn:disabled{opacity:.35;cursor:default}
.deck-btn[data-primary="true"]{background:${D.cyan};border-color:${D.cyan};color:${D.bg}}
.deck-wheel{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,400px);gap:24px;align-items:end;min-height:52vh}
.deck-legend{display:flex;flex-wrap:wrap;gap:6px}
.deck-sw{width:10px;height:10px;border-radius:2px;display:inline-block}
.deck-two{display:grid;grid-template-columns:1.1fr .9fr;gap:24px;align-items:start}
.deck-plain{background:none;border:none;padding:4px 0;text-align:left;cursor:pointer;color:${D.textSecondary};font-family:${D.body};font-size:12px;line-height:1.4}
@media (max-width:840px){.deck-body{padding:20px 18px 26px}.deck-wheel,.deck-two{grid-template-columns:1fr}.deck-wheel{min-height:0}}
`;

// ══════════════════════════════════════════════════════
//  THE STAGE — three.js when it can be, SVG when it cannot
// ══════════════════════════════════════════════════════
function Stage({ view, balls, filter, want3d, onMode }) {
  const host = useRef(null);
  const stage = useRef(null);
  const [mode, setMode] = useState("loading");
  // The scene's fog, grass and lines are read from the tokens when it is
  // built, so a theme switch builds it again rather than leaving a night
  // field on a day page.
  const theme = themeName();

  useEffect(() => {
    if (!want3d) { setMode("fallback"); return; }
    let cancelled = false;
    setMode("loading");
    import("./pitchdeck/scene.js").then((m) => {
      if (cancelled || !host.current) return;
      if (!m.webglAvailable()) { setMode("fallback"); return; }
      try {
        stage.current = m.mountStage(host.current, { reduced: reducedMotion(), onLost: () => { stage.current = null; setMode("fallback"); } });
        stage.current.setBalls(balls);
        setMode("webgl");
      } catch {
        stage.current = null;
        setMode("fallback");
      }
    }).catch(() => { if (!cancelled) setMode("fallback"); });
    return () => {
      cancelled = true;
      stage.current?.dispose();
      stage.current = null;
    };
    // The innings is fixed for the life of the deck; `view` and `filter` are
    // pushed by the effects below rather than remounting the renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want3d, theme]);

  useEffect(() => { stage.current?.setView(view); }, [view, mode]);
  useEffect(() => { stage.current?.setFilter(filter); }, [filter, mode]);
  useEffect(() => { onMode?.(mode); }, [mode, onMode]);

  return (
    <div ref={host} className="deck-stage" data-testid="deck-stage" data-mode={mode}>
      {mode === "fallback" && <FlatWheel balls={balls} filter={filter} view={view}/>}
    </div>
  );
}

/** The same innings, flat: every spoke at its sector's nominal angle. */
function FlatWheel({ balls, filter, view }) {
  const spokes = useMemo(() => balls.filter((b) => b.seg != null).map((b, i) => {
    const ang = SEGS[b.seg].angle;
    const r = b.value >= 6 ? R_BND + 6 : b.value === 4 ? R_BND - 2 : b.value >= 2 ? R_BND * 0.7 : b.value === 1 ? R_BND * 0.5 : R_BND * 0.22;
    const [x, y] = toXY(ang, r);
    return { i, x, y, key: lineKey(b), seg: b.seg };
  }), [balls]);
  const on = (s) => (filter.seg == null || filter.seg === s.seg) && (filter.key == null || filter.key === s.key);
  const emphasis = view === "wheel" ? 1 : 0.35;
  return (
    <svg viewBox="0 0 300 300" aria-hidden="true" style={{ position: "absolute", left: view === "wheel" ? "4%" : "50%", top: "50%", width: "min(56vh,460px)", height: "min(56vh,460px)", transform: view === "wheel" ? "translateY(-50%)" : "translate(-50%,-50%)", opacity: emphasis, transition: `opacity ${T.motion.context} ${T.motion.ease}, left ${T.motion.context} ${T.motion.ease}` }}>
      {SEGS.map((s) => <path key={s.id} d={pieSlice(s.angle, R_BND)} fill="none" stroke={D.border} strokeWidth=".6"/>)}
      <circle cx={CX} cy={CY} r={R_BND} fill="none" stroke={D.cyan} strokeWidth="1"/>
      <rect x={CX - 3} y={CY - 12} width="6" height="24" fill={D.amber} opacity=".6"/>
      {spokes.map((s) => <line key={s.i} x1={CX} y1={CY} x2={s.x} y2={s.y} stroke={LK_COLS[s.key]} strokeWidth="1.1" opacity={on(s) ? 0.9 : 0.08}/>)}
    </svg>
  );
}

// ══════════════════════════════════════════════════════
//  THE SLIDES
// ══════════════════════════════════════════════════════
const Kicker = ({ children }) => <div className="deck-kicker">{children}</div>;
const H = ({ children }) => <h2 className="deck-h">{children}</h2>;
const Mono = ({ children, sx }) => <div className="deck-sub" style={{ fontFamily: D.mono, textTransform: "uppercase", letterSpacing: ".1em", ...sx }}>{children}</div>;

function Stat({ n, cap, sub, i = 0, tone }) {
  const v = useCount(typeof n === "number" ? n : NaN);
  return (
    <div className="deck-card deck-rise" style={{ "--i": i }}>
      <div className="deck-num" style={tone ? { color: tone } : undefined}>{typeof n === "number" ? v : n}</div>
      <div className="deck-cap">{cap}</div>
      {sub && <div className="deck-sub">{sub}</div>}
    </div>
  );
}

function Bars({ rows, max, tone, label }) {
  return (
    <div style={{ display: "grid", gap: "6px" }} role="group" aria-label={label}>
      {rows.map(([name, n, colour], i) => (
        <div key={name} className="deck-row">
          <span>{name}</span>
          <span className="deck-track"><span className="deck-fill" style={{ "--i": i, width: `${(n / max) * 100}%`, background: colour ?? tone }}/></span>
          <span style={{ textAlign: "right" }}>{n}</span>
        </div>
      ))}
    </div>
  );
}

const COVER_LEDE = "SCRBRD is the operating system for a school sports programme: live scoring that survives a lost signal, a squad and medical record the right people can read and nobody else can, and a roadmap that is checked against the code rather than promised.";
function CoverSlide() {
  return (
    <div style={{ maxWidth: "880px" }}>
      <img src={SCRBRD_LOGO} alt="SCRBRD" className="deck-rise" style={{ height: "44px", objectFit: "contain", marginBottom: "22px", filter: "brightness(1.15)" }}/>
      <Kicker>School sport, on one record</Kicker>
      <H>Every ball, every boy, every permission. One place, and only where it belongs.</H>
      <p className="deck-lede">{COVER_LEDE}</p>
      <div className="deck-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", marginTop: "26px", maxWidth: "820px" }}>
        <Stat i={0} n={ROLES.length} cap="Roles" sub="One policy, client and database"/>
        <Stat i={1} n={ALL_CAPABILITIES.length} cap="Capabilities" sub={`${SENSITIVE.length} sensitive, ${PLATFORM_ONLY.length} platform-only`}/>
        <Stat i={2} n={Object.keys(TABLES).length} cap="Tables under RLS" sub={`${MASKED_TABLES.length} masked column by column`}/>
        <Stat i={3} n={Object.keys(MODULES).length} cap="Modules" sub="Each one a switch a school can throw"/>
        <Stat i={4} n={Object.keys(SPORTS).length} cap="Sports" sub={`${ENGINES.scoring ?? 0} scored ball by ball, ${ENGINES.fixtures ?? 0} by fixture`}/>
      </div>
    </div>
  );
}

const PAIN = [
  { where: "The scorebook",      cost: "A season of ball-by-ball detail, in pencil, in a bag. Nothing is derived from it because nothing can be." },
  { where: "The WhatsApp group", cost: "Team news, lift arrangements and a boy's injury in the same thread, visible to whoever was added in 2023." },
  { where: "The medical file",   cost: "Clearance lives with the physio, the coach hears about it on the day, and nobody can show who read it." },
  { where: "The spreadsheet",    cost: "Squads, kit, umpires and transport in tabs that agree with each other only on the day they were made." },
];
const PROBLEM_LEDE = "A school already has all of this information. What it does not have is one record of it that a coach, a parent, a physio and a scorer can each open and see exactly their part of, and be shown nothing else.";
function ProblemSlide() {
  return (
    <div className="deck-two">
      <div>
        <Kicker>The argument</Kicker>
        <H>A season lives in six places, and none of them can be asked a question.</H>
        <p className="deck-lede">{PROBLEM_LEDE}</p>
      </div>
      <div className="deck-grid" style={{ gridTemplateColumns: "1fr" }}>
        {PAIN.map((p, i) => (
          <div key={p.where} className="deck-card deck-rise" style={{ "--i": i + 2 }}>
            <div className="deck-cap" style={{ marginTop: 0, fontSize: "12px" }}>{p.where}</div>
            <div className="deck-sub" style={{ fontSize: "12px", color: D.textSecondary }}>{p.cost}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const KEY_LABEL = { "4": "Fours", "6": "Sixes", "1-3": "Run", "0": "Dot", "W": "Wicket", "extras": "Extras" };
const WHEEL_LEDE = "A wagon wheel drawn from the ball log, not typed in afterwards. Drag the field to turn it; pick a sector or a line to isolate it. Placements are stored batter-relative, so a left-hander and a right-hander read on the same chart.";
const WHEEL_NOTE = "Seeded innings, deterministic from a key: a demonstration of the chart, not any school's record. Spoke length here is the run value; a captured placement carries its own distance.";
function WheelSlide({ filter, setFilter }) {
  const runs = useCount(DEMO.runs), maxZone = DEMO.zones[0]?.runs || 1;
  const toggleSeg = (id) => setFilter((f) => ({ seg: f.seg === id ? null : id, key: null }));
  const toggleKey = (k) => setFilter((f) => ({ seg: null, key: f.key === k ? null : k }));
  return (
    <div className="deck-wheel">
      <div>
        <Kicker>The scorer</Kicker>
        <H>Every ball, where it went.</H>
        <p className="deck-lede" style={{ maxWidth: "440px" }}>{WHEEL_LEDE}</p>
        <div className="deck-legend" style={{ marginTop: "16px" }} role="group" aria-label="Line key">
          {Object.entries(LK_COLS).filter(([k]) => DEMO.keys[k]).map(([k, c]) => (
            <button key={k} type="button" className="deck-chip" aria-pressed={filter.key === k} onClick={() => toggleKey(k)} data-testid={`deck-key-${k}`}>
              <span className="deck-sw" style={{ background: c }}/>{KEY_LABEL[k]} <span style={{ color: D.textMuted }}>{DEMO.keys[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="deck-sub" style={{ marginTop: "14px", maxWidth: "440px" }}>{WHEEL_NOTE}</div>
      </div>
      <div className="deck-card" style={{ background: clr(T.surface.raised, .9) }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
          <div className="deck-num" data-testid="deck-innings">{runs}/{DEMO.wickets}</div>
          <div className="deck-sub" style={{ fontSize: "12px" }}>{Math.floor(DEMO.legal / 6)}.{DEMO.legal % 6} overs, {DEMO.extras} extras</div>
        </div>
        <div className="deck-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginTop: "12px" }}>
          {[["Fours", DEMO.fours], ["Sixes", DEMO.sixes], ["Dot %", Math.round((DEMO.dots / DEMO.legal) * 100)], ["Stands", DEMO.partnerships]].map(([l, v]) => (
            <div key={l}><div style={{ fontFamily: D.mono, fontSize: "18px", fontWeight: 700, color: D.textPrimary }}>{v}</div><div className="deck-sub">{l}</div></div>
          ))}
        </div>
        <Mono sx={{ margin: "14px 0 6px" }}>Runs by sector: off {DEMO.offRuns} / leg {DEMO.legRuns}</Mono>
        <div style={{ display: "grid", gap: "5px" }} role="group" aria-label="Sectors">
          {DEMO.zones.slice(0, 6).map((z, i) => (
            <button key={z.id} type="button" onClick={() => toggleSeg(z.id)} aria-pressed={filter.seg === z.id} data-testid={`deck-zone-${z.id}`}
                    className="deck-row deck-plain" style={{ padding: "2px 0", color: filter.seg === z.id ? D.textPrimary : D.textSecondary }}>
              <span>{z.label}</span>
              <span className="deck-track"><span className="deck-fill" style={{ "--i": i, width: `${(z.runs / maxZone) * 100}%`, background: z.side === "off" ? D.cyan : D.lime }}/></span>
              <span style={{ textAlign: "right" }}>{z.runs}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const PLATFORM_LEDE = "Every module names the capability that governs it. A school switches one off for itself or for one person, and a write is refused as surely as a read: the switch is enforced in the database, not drawn over the top.";
const ENGINE_LABEL = { scoring: "ball by ball", fixtures: "fixtures", none: "roster" };
function PlatformSlide() {
  const mods = Object.entries(MODULES), feats = Object.entries(FEATURES), sports = Object.entries(SPORTS);
  return (
    <div>
      <Kicker>The operating system</Kicker>
      <H>{mods.length} modules, {feats.length} features, {sports.length} sports. One switchboard.</H>
      <p className="deck-lede">{PLATFORM_LEDE}</p>
      <div className="deck-grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", marginTop: "20px" }}>
        {mods.map(([k, m], i) => (
          <div key={k} className="deck-card deck-rise" style={{ "--i": i, padding: "11px 13px" }} data-testid={`deck-module-${k}`}>
            <div className="deck-cap" style={{ marginTop: 0 }}>{m.label}</div>
            <div className="deck-sub" style={{ fontFamily: D.mono }}>{m.capability}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "14px", alignItems: "center" }}>
        <Mono sx={{ marginRight: "4px" }}>Features</Mono>
        {feats.map(([k, f]) => <span key={k} className="deck-chip" style={{ cursor: "default" }}>{f.label}</span>)}
        <Mono sx={{ margin: "0 4px 0 12px" }}>Sports</Mono>
        {sports.map(([k, s]) => (
          <span key={k} className="deck-chip" style={{ cursor: "default" }}>
            {s.label} <span style={{ color: s.engine === "scoring" ? textOn(D.lime) : D.textMuted }}>{ENGINE_LABEL[s.engine] ?? s.engine}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const accessLede = () => `${ROLES.length} roles, ${ALL_CAPABILITIES.length} capabilities, ${Object.keys(TABLES).length} tables. The same policy package generates the Postgres row-level security and drives the client, so a screen cannot show what a query would refuse; and ${MASKED_TABLES.length} tables are masked column by column, so a coach sees the roster and never the clinical note beside it.`;
function AccessSlide() {
  const [family, setFamily] = useState(null);
  const families = Object.entries(ROLE_FAMILIES);
  const shown = family ? ROLE_FAMILIES[family] : ROLES;
  return (
    <div className="deck-two">
      <div>
        <Kicker>Access control</Kicker>
        <H>One definition of who may see what, shared by the screen and the database.</H>
        <p className="deck-lede">{accessLede()}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "14px" }} role="group" aria-label="Role families">
          <button type="button" className="deck-chip" aria-pressed={family == null} onClick={() => setFamily(null)}>All {ROLES.length}</button>
          {families.map(([f, rs]) => (
            <button key={f} type="button" className="deck-chip" aria-pressed={family === f} onClick={() => setFamily(family === f ? null : f)} data-testid={`deck-family-${f}`}>
              {familyLabel(f)} <span style={{ color: D.textMuted }}>{rs.length}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "10px" }} data-testid="deck-roles">
          {shown.map((r) => (
            <span key={r} className="deck-chip" style={{ cursor: "default", borderColor: `${ROLE_IDENTITY[r]?.color ?? D.border}55` }}>
              <span style={{ color: textOn(ROLE_IDENTITY[r]?.color ?? D.textSecondary) }}>{ROLE_IDENTITY[r]?.label ?? r}</span>
              <span style={{ color: D.textMuted }}>{ROLE_CAPABILITIES[r]?.length ?? 0}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="deck-card">
        <Mono sx={{ marginBottom: "10px" }}>Capabilities by domain</Mono>
        <Bars rows={CAP_FAMILIES.slice(0, 12)} max={CAP_FAMILIES[0]?.[1] || 1} tone={D.cyan} label="Capabilities by domain"/>
        <div className="deck-sub" style={{ marginTop: "12px" }}>{SENSITIVE.length} capabilities are sensitive and logged on every read; {PLATFORM_ONLY.length} exist only for the platform itself and no school can grant them.</div>
      </div>
    </div>
  );
}

const SCHOOL_LEDE = "The dashboard counts nothing in the browser. These figures come from one server-side read scoped to the person asking, so a coach sees their squads and a director of sport sees the school.";
function SchoolSlide({ role }) {
  const { summary, live, loading, error } = useSummary(role);
  const me = profile();
  const schools = [...new Map((me?.assignments ?? []).filter((a) => a.school).map((a) => [a.school, a.schoolName || "This school"])).values()];
  const pct = (n) => (n == null ? "—" : `${Math.round(Number(n))}%`);
  const src = !signedIn() ? "Demonstration figures. Sign in to see a school's own."
            : live && schools.length ? `Live from the summary read, scoped to ${schools.join(", ")}.`
            : live ? "Live from the summary read. This account holds no school assignment, so the school-scoped figures are zero; sign in as a school role to see a school's own."
            : error ? `The summary could not be read (${error}).` : "Reading…";
  return (
    <div>
      <Kicker>{live ? "Live" : signedIn() ? "Your school" : "Demonstration"}</Kicker>
      <H>Your school, now.</H>
      <p className="deck-lede">{SCHOOL_LEDE}</p>
      <div className="deck-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", marginTop: "22px" }} data-testid="deck-summary" data-live={live ? "true" : "false"}>
        {loading && !summary ? <div className="deck-sub">Reading…</div> : (
          <>
            <Stat i={0} n={summary?.activePlayers ?? "—"} cap="Active players" sub={summary?.scopePlayers ? `of ${summary.scopePlayers} in scope` : undefined}/>
            <Stat i={1} n={summary?.upcomingMatches ?? "—"} cap="Upcoming fixtures" sub={summary?.nextMatchAt ? `next ${new Date(summary.nextMatchAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}` : undefined}/>
            <Stat i={2} n={summary?.sessionsThisWeek ?? "—"} cap="Sessions this week"/>
            <Stat i={3} n={summary?.injuriesActive ?? "—"} cap="Injuries open" tone={summary?.injuriesActive ? D.amber : undefined}/>
            <Stat i={4} n={pct(summary?.winRatePct)} cap="Win rate" sub={summary?.scopeMatches ? `${summary.scopeMatches} matches in scope` : undefined}/>
            <Stat i={5} n={summary?.unreadAlerts ?? "—"} cap="Unread alerts"/>
          </>
        )}
      </div>
      <div className="deck-sub" style={{ marginTop: "12px" }} data-testid="deck-summary-source">{src}</div>
    </div>
  );
}

const CAT_TONE = themed(() => ({ "AI & Analysis": D.violetText, "Integrations": D.cyan, "Comms": D.indigoText, "Fitness": D.emerald, "Admin": D.orange, "Media": D.amber }));
const ROADMAP_LEDE = "A thing is shipped when a walk would fail if it broke. The middle column is the honest one: data that exists and is permission-scoped, with no screen drawing it yet.";
function RoadmapSlide() {
  const [open, setOpen] = useState(null);
  return (
    <div>
      <Kicker>The roadmap</Kicker>
      <H>Built, built underneath, planned. Every shipped item names the walk that covers it.</H>
      <p className="deck-lede">{ROADMAP_LEDE}</p>
      <div className="deck-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", marginTop: "20px", alignItems: "start" }}>
        {["shipped", "partial", "planned"].map((st, col) => (
          <div key={st} className="deck-card deck-rise" style={{ "--i": col, padding: "12px" }} data-testid={`deck-roadmap-${st}`}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: "8px" }}>
              <span className="deck-num" style={{ fontSize: "26px", color: textOn(STATUS_TONE[st]) }}>{ROADMAP[st].length}</span>
              <span className="deck-cap" style={{ marginTop: 0 }}>{STATUS_LABEL[st]}</span>
            </div>
            <div style={{ display: "grid", gap: "4px" }}>
              {ROADMAP[st].map((u) => (
                <button key={u.id} type="button" className="deck-plain" onClick={() => setOpen(open === u.id ? null : u.id)} aria-expanded={open === u.id}>
                  <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: CAT_TONE[u.category] ?? D.textMuted, marginRight: "8px", verticalAlign: "middle" }}/>
                  {u.title}
                  {open === u.id && <div className="deck-sub" style={{ marginTop: "4px", paddingLeft: "14px" }}>{u.desc} <span style={{ color: D.textMuted }}>({u.category}, effort {u.effort.toLowerCase()})</span></div>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const CLOSE_LEDE = "The fastest way to judge SCRBRD is to score one of your matches on it. Sign in with a school address, open Match Centre, and every screen in this deck fills with your own record: scoped to you, and to nobody else.";
function CloseSlide({ onNav }) {
  return (
    <div style={{ maxWidth: "820px" }}>
      <Kicker>Next</Kicker>
      <H>See it on your own fixtures.</H>
      <p className="deck-lede">{CLOSE_LEDE}</p>
      {onNav && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "22px" }}>
          <button type="button" className="deck-btn" data-primary="true" onClick={() => onNav("matches")} data-testid="deck-open-matches">Open Match Centre</button>
          <button type="button" className="deck-btn" onClick={() => onNav("settings")}>Settings: Roadmap</button>
        </div>
      )}
      <div className="deck-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginTop: "26px" }}>
        <Stat i={0} n={ROADMAP.shipped.length} cap="Shipped" sub="Each covered by a walk"/>
        <Stat i={1} n={ROLES.length} cap="Roles" sub="From the principal to the driver"/>
        <Stat i={2} n={`v${pkg.version}`} cap="This build" sub="The version the sidebar shows"/>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  THE DECK
// ══════════════════════════════════════════════════════
function PitchDeckView({ role, onNav }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState("fwd");
  const [filter, setFilter] = useState({ seg: null, key: null });
  const [want3d, setWant3d] = useState(true);
  const [mode, setMode] = useState("loading");
  const [auto, setAuto] = useState(false);
  const [full, setFull] = useState(false);
  const deck = useRef(null);
  const n = SLIDES.length, s = SLIDES[i];

  const go = useCallback((to) => {
    setI((cur) => {
      const next = Math.max(0, Math.min(n - 1, typeof to === "function" ? to(cur) : to));
      if (next !== cur) setDir(next > cur ? "fwd" : "back");
      return next;
    });
  }, [n]);

  const toggleFull = useCallback(() => {
    const el = deck.current;
    if (!el) return;
    if (document.fullscreenElement === el) document.exitFullscreen?.().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  }, []);

  // The keyboard drives it from anywhere on the page, so a presenter with a
  // clicker never has to find the deck with the mouse first. Typing into a
  // field is left alone.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? "")) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); go((c) => c + 1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); go((c) => c - 1); }
      else if (e.key === "Home") { e.preventDefault(); go(0); }
      else if (e.key === "End") { e.preventDefault(); go(n - 1); }
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) go(Number(e.key) - 1);
      else if (e.key === "f" || e.key === "F") toggleFull();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, n, toggleFull]);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setI((c) => { if (c + 1 >= n) { setAuto(false); return c; } setDir("fwd"); return c + 1; }), 8000);
    return () => clearInterval(id);
  }, [auto, n]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === deck.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const view = VIEW_OF[s.id] ?? "orbit";
  const wheelFilter = s.id === "wheel" ? filter : { seg: null, key: null };
  const threeLabel = !want3d ? "3D off" : mode === "fallback" ? "3D unavailable" : "3D on";

  return (
    <div>
      <style>{css()}</style>
      <div ref={deck} className="deck" role="region" aria-roledescription="presentation" aria-label={`Pitch deck, slide ${i + 1} of ${n}: ${s.label}`} data-testid="deck" data-slide={s.id}>
        <div className="deck-progress" style={{ width: `${((i + 1) / n) * 100}%` }} aria-hidden="true"/>
        <Stage view={view} balls={DEMO.balls} filter={wheelFilter} want3d={want3d} onMode={setMode}/>
        <div className="deck-scrim" data-side={s.id === "wheel" ? "right" : "full"} aria-hidden="true"/>

        <div className="deck-bar">
          <button type="button" className="deck-btn" onClick={() => go((c) => c - 1)} disabled={i === 0} data-testid="deck-prev" aria-label="Previous slide">← Prev</button>
          <div className="deck-nav" role="tablist" aria-label="Slides">
            {SLIDES.map((sl, k) => (
              <button key={sl.id} type="button" role="tab" className="deck-dot" aria-current={k === i ? "true" : undefined} aria-selected={k === i} aria-label={`${k + 1}. ${sl.label}`} title={sl.label} onClick={() => go(k)} data-testid={`deck-dot-${sl.id}`}/>
            ))}
          </div>
          <button type="button" className="deck-btn" onClick={() => go((c) => c + 1)} disabled={i === n - 1} data-testid="deck-next" aria-label="Next slide">Next →</button>
          <span style={{ fontFamily: D.mono, fontSize: "11px", color: D.textMuted }}>{i + 1}/{n} · {s.label}</span>
          <span style={{ flex: 1 }}/>
          <button type="button" className="deck-btn" aria-pressed={auto} onClick={() => setAuto((a) => !a)} data-testid="deck-auto">{auto ? "■ Stop" : <><Icon name="play"/> Auto</>}</button>
          <button type="button" className="deck-btn" aria-pressed={want3d} onClick={() => setWant3d((v) => !v)} data-testid="deck-3d-toggle">{threeLabel}</button>
          <button type="button" className="deck-btn" onClick={toggleFull} aria-pressed={full} data-testid="deck-full">{full ? "Exit full screen" : "Present (F)"}</button>
        </div>

        <div className="deck-body">
          <div key={s.id} className="deck-slide" data-dir={dir} data-testid={`deck-slide-${s.id}`}>
            {s.id === "cover"    && <CoverSlide/>}
            {s.id === "problem"  && <ProblemSlide/>}
            {s.id === "wheel"    && <WheelSlide filter={filter} setFilter={setFilter}/>}
            {s.id === "platform" && <PlatformSlide/>}
            {s.id === "access"   && <AccessSlide/>}
            {s.id === "school"   && <SchoolSlide role={role}/>}
            {s.id === "roadmap"  && <RoadmapSlide/>}
            {s.id === "close"    && <CloseSlide onNav={onNav}/>}
          </div>
        </div>
      </div>
      <div style={{ fontFamily: D.mono, fontSize: "10px", color: D.textMuted, marginTop: "8px" }}>
        Arrow keys, Space and 1–{n} move between slides. F presents full screen. Drag the field to turn it.
      </div>
    </div>
  );
}

export { PitchDeckView };
