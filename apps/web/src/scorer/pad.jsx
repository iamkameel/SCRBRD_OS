import { useState } from "react";
import { batHandOf } from "@scrbrd/scoring";
import { T, inkOn } from "../design/tokens.js";
import { Board } from "../ui/board.jsx";
import { Icon } from "../ui/icons.jsx";
import { SEGS } from "./field.js";
import { boardFromInnings } from "./boardData.js";
import { WagonWheel } from "./panels.jsx";
import { ALL_SHOTS_FLAT, SHOT_CATS } from "./shots.js";

/**
 * THE PAD — step 2 of the redesign (DESIGN_DIRECTION §4).
 *
 * The score once, at the top, on the black board; the state in one line under
 * it; then the pad asks. By default it asks in three phases — Shot, Area,
 * Outcome — with a stepper that shows where the scorer is and steps back.
 * BASIC SCORING asks for the outcome alone. Wide, no ball, dot and undo are
 * on every phase, in the same place, so the commonest deliveries never need
 * the three steps.
 *
 * WHAT THIS FILE DOES NOT DO: decide what a tap records. Every key calls the
 * engine's own handlers (engine.jsx) with the values the pad passed before
 * the redesign — onCommitDetailed(type, value, shot, seg, zone), onWicketCtx,
 * onWide, onNoBall, onUndo — so the events are the ones the pad always
 * emitted. The rules for which runs are byes or leg byes after a shot that
 * never touched the bat (runType) are the pad's own and are unchanged.
 *
 * Floors (§3.2, §3.5): nothing read under 12px, nothing tapped under 44px;
 * shot keys 44 tall at 16px, the run keys and the wicket key 64, the strip 56.
 */

/**
 * The way back to the shell. In the pad's title bar it is the first key, 44
 * square; on the setup and result screens, which have no bar, it floats where
 * it always did. One class either way (`os-exit-scorer`), which the walks and
 * GLOBAL_CSS know it by.
 */
export function ExitKey({ onExit, inBar = false }) {
  if (!onExit) return null;
  return (
    <button type="button" className="os-exit-scorer pressBtn" onClick={onExit} data-testid="exit-scorer"
      aria-label={inBar ? "Back to SCRBRD OS" : undefined} title="Leave the scorer"
      style={inBar ? { position: "static", top: "auto", left: "auto", zIndex: "auto", flexShrink: 0,
        width: "44px", height: "44px", padding: 0, justifyContent: "center", borderRadius: T.radius.md,
        background: "transparent", border: `1px solid ${T.line.normal}`, boxShadow: "none",
        backdropFilter: "none", WebkitBackdropFilter: "none", color: T.content.primary,
        fontSize: "26px", fontWeight: 400, lineHeight: 1 } : undefined}>
      <span aria-hidden="true">‹</span>{!inBar && " SCRBRD OS"}
    </button>
  );
}

/**
 * The board, fed from the fold. Every figure on it is the innings the log
 * replays to. The pad gets the partnership, the striker lit and the chips, and
 * NO insight: a line that changes by itself pulls the scorer's eye off the
 * ball (§10). Tier 3 — the interrupt — is the pad's EventOverlay.
 */
export function PadBoard({ inn, match, target }) {
  const props = boardFromInnings(inn, { target, overs: inn?.overs ?? match?.overs ?? 20 });
  return props ? <Board {...props}/> : null;
}

// ── Keys ─────────────────────────────────────────────────────────
// Styles are functions: a token is read when the key draws, never at import.

const keyBase = (h) => ({
  minHeight: h, minWidth: "44px", borderRadius: T.radius.md, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", gap: T.space.xs,
  padding: `${T.space.xs} ${T.space.xs}`, textAlign: "center", lineHeight: 1.15,
  fontFamily: T.type.body, fontSize: "16px", fontWeight: 500,
  color: T.content.primary, background: T.surface.raised, border: `1px solid ${T.line.strong}`,
  boxShadow: T.elevation.sm,
});

/** One key. `say` is its name when the face is a figure or a mark. */
function Key({ face, say, onClick, h = "44px", style, testid, pressed, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="pressBtn os-state" data-testid={testid}
      aria-label={say} aria-pressed={pressed} style={{ ...keyBase(h), ...style }}>
      {face}
    </button>
  );
}

const sectionLabel = () => ({ ...T.role.label, color: T.content.secondary, margin: "0 0 2px" });

// ── The stepper ─────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: "Shot" },
  { n: 2, label: "Area" },
  { n: 3, label: "Outcome" },
];

function Stepper({ phase, values, onStep }) {
  return (
    <ol aria-label="Steps for this ball" data-testid="pad-stepper"
      style={{ listStyle: "none", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: T.space.sm, margin: 0, padding: 0 }}>
      {STEPS.map((s) => {
        const now = phase === s.n, done = phase > s.n;
        // Only a done step does anything — it steps back — so only a done
        // step is a button. The current one and those ahead are where the
        // scorer is and where they are going: said, not offered (and not a
        // greyed-out disabled control either).
        const Tag = done ? "button" : "div";
        return (
          <li key={s.n} style={{ minWidth: 0 }}>
            <Tag {...(done ? { type: "button", onClick: () => onStep(s.n), className: "pressBtn",
                  "aria-label": `Step ${s.n}, ${s.label}: ${values[s.n - 1] ?? "none"}. Go back to it` } : {})}
              data-testid={`step-${s.n}`} aria-current={now ? "step" : undefined}
              style={{ width: "100%", minHeight: "44px", borderRadius: T.radius.md, padding: `${T.space.xs} ${T.space.sm}`,
                display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: "2px",
                cursor: done ? "pointer" : "default", textAlign: "left",
                background: now ? T.content.primary : done ? T.surface.raised : "transparent",
                border: `1px solid ${now ? T.content.primary : T.line.normal}` }}>
              <span style={{ ...T.role.label, color: now ? T.surface.canvas : T.content.secondary }}>
                {done && <Icon name="circle-check"/>} {s.n} {s.label}
              </span>
              <span style={{ fontFamily: T.type.body, fontSize: "14px", fontWeight: 600, maxWidth: "100%",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                color: now ? T.surface.canvas : done ? T.content.primary : T.content.tertiary }}>
                {values[s.n - 1] ?? (now ? "Now" : "—")}
              </span>
            </Tag>
          </li>
        );
      })}
    </ol>
  );
}

// ── Phase 1: the shot ────────────────────────────────────────────

function ShotPhase({ shot, onShot }) {
  return (
    <div data-testid="phase-shot" style={{ display: "grid", gap: T.space.sm }}>
      {SHOT_CATS.map((c) => (
        <section key={c.cat} aria-label={c.cat}>
          <h3 style={sectionLabel()}>{c.cat}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(64px,1fr))", gap: T.space.sm }}>
            {c.shots.map((s) => (
              <Key key={s.id} face={s.label} testid={`shot-${s.id}`} pressed={shot === s.id} onClick={() => onShot(s.id)}
                style={shot === s.id ? { border: `2px solid ${T.content.primary}`, fontWeight: 600 } : undefined}/>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Phase 2: the area ───────────────────────────────────────────

function AreaPhase({ inn, area, onArea, onNone }) {
  const [view, setView] = useState("wagon");
  return (
    <div data-testid="phase-area" style={{ display: "grid", gap: T.space.sm }}>
      <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
        <p style={{ ...T.role.body, flex: 1, color: T.content.secondary, margin: 0 }}>Tap where the ball went.</p>
        <Key face="Didn’t travel" testid="area-none" onClick={onNone} say="Didn’t travel: blocked, or no stroke"
          style={{ padding: `0 ${T.space.md}`, flexShrink: 0 }}/>
      </div>
      <WagonWheel bare ballLog={inn.ballLog} selSeg={area} onSel={(s) => s && onArea(s)}
        batHand={batHandOf(inn)} handFor={(b) => batHandOf(inn, b.strikerId)}
        viewMode={view} onViewMode={setView} hidden={EMPTY} onToggle={() => {}}/>
    </div>
  );
}
const EMPTY = new Set();

// ── Phase 3: the outcome (and Basic Scoring, which is this alone) ──

const RUNS = [
  { v: 0, say: "No run" },
  { v: 1, say: "One run" },
  { v: 2, say: "Two runs" },
  { v: 3, say: "Three runs" },
  { v: 4, say: "Four, boundary" },
  { v: 6, say: "Six, maximum" },
];

/**
 * The run keys, byes and leg byes, and the wicket key. Byes and leg byes ask
 * the runs on the same key: a tap opens the runs in its place.
 */
function OutcomeKeys({ onRun, onExtra, onWicket, note }) {
  const [extra, setExtra] = useState(null);   // "B" | "LB" | null
  const extraName = extra === "B" ? "Byes" : "Leg byes";
  return (
    <div data-testid="phase-outcome" style={{ display: "grid", gap: T.space.sm }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: T.space.sm }}>
        {RUNS.map((r) => (
          <Key key={r.v} face={String(r.v)} say={r.say} testid={`run-${r.v}`} h="64px" onClick={() => onRun(r.v)}
            style={{ ...T.role.figure.lg, fontSize: "28px", ...(r.v === 4 || r.v === 6 ? { border: `2px solid ${T.content.primary}` } : {}) }}/>
        ))}
      </div>
      {note && <p style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0 }}>{note}</p>}
      {extra ? (
        <div role="group" aria-label={`${extraName}: how many?`} data-testid="extra-runs"
          style={{ display: "grid", gridTemplateColumns: "auto repeat(4,minmax(0,1fr)) auto", gap: T.space.sm, alignItems: "center" }}>
          <span style={{ ...T.role.label, color: T.content.secondary }}>{extraName}</span>
          {[1, 2, 3, 4].map((n) => (
            <Key key={n} face={String(n)} say={`${n} ${extra === "B" ? (n === 1 ? "bye" : "byes") : (n === 1 ? "leg bye" : "leg byes")}`}
              testid={`extra-run-${n}`} h="48px" style={{ ...T.role.figure.md }}
              onClick={() => { const t = extra; setExtra(null); onExtra(t, n); }}/>
          ))}
          <Key face="Cancel" h="48px" testid="extra-cancel" onClick={() => setExtra(null)} style={{ padding: `0 ${T.space.sm}` }}/>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: T.space.sm }}>
          <Key face="Byes" testid="key-byes" h="48px" onClick={() => setExtra("B")}/>
          <Key face="Leg byes" testid="key-legbyes" h="48px" onClick={() => setExtra("LB")}/>
        </div>
      )}
      <Key face={<><Icon name="bails-off"/> Wicket</>} say="Wicket" testid="key-wicket" h="64px" onClick={onWicket}
        style={{ background: T.semantic.critical, color: inkOn(T.semantic.critical), border: `1px solid ${T.semantic.critical}`,
          fontSize: "18px", fontWeight: 700 }}/>
    </div>
  );
}

// ── The strip: on every phase, and under Basic Scoring ──────────

function Strip({ onWide, onNoBall, onDot, onUndo, midBall }) {
  return (
    <div data-testid="pad-strip" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: T.space.sm }}>
      <Key face="Wide" say="Wide" testid="key-wide" h="56px" onClick={onWide}/>
      <Key face="No ball" say="No ball" testid="key-noball" h="56px" onClick={onNoBall}/>
      <Key face={<><span aria-hidden="true">·</span> Dot</>} say="Dot ball, no run" testid="key-dot" h="56px" onClick={onDot}/>
      <Key face={<><Icon name="undo-2"/> Undo</>} testid="key-undo" h="56px" onClick={onUndo}
        say={midBall ? "Undo: start this ball again" : "Undo the last ball"}/>
    </div>
  );
}

/**
 * The pad. `basic` is Basic Scoring: the outcome keys alone. Otherwise the
 * three phases. Both end in the same engine calls the pad has always made.
 */
export function Pad({ inn, basic, onCommitDetailed, onWicketCtx, onWide, onNoBall, onUndo }) {
  const [phase, setPhase] = useState(1);      // 1 Shot · 2 Area · 3 Outcome
  const [shot, setShot] = useState(null);
  const [area, setArea] = useState(null);     // {seg, zone} | null (didn't travel)
  if (!inn) return null;

  const reset = () => { setPhase(1); setShot(null); setArea(null); };
  // Off the pads or the body are leg byes; beaten and ran are byes; otherwise
  // off the bat. Unchanged from the pad before the redesign.
  const runType = (v) => { if (v <= 0) return "run"; if (shot === "padded" || shot === "hit_body") return "LB"; if (shot === "missed") return "B"; return "run"; };
  const commitRun = (v) => { onCommitDetailed(runType(v), v, shot, area?.seg ?? null, area?.zone ?? null); reset(); };
  const commitExtra = (type, v) => { onCommitDetailed(type, v, shot, area?.seg ?? null, area?.zone ?? null); reset(); };
  const commitWicket = () => { onWicketCtx(shot, area?.seg ?? null, area?.zone ?? null); reset(); };

  // Basic Scoring never has a shot or an area: these are the one-tap pad's calls.
  const basicRun = (v) => onCommitDetailed("run", v, null, null, null);
  const basicExtra = (type, v) => onCommitDetailed(type, v, null, null, null);

  const shotMeta = shot ? ALL_SHOTS_FLAT.find((s) => s.id === shot) : null;
  const areaWord = area ? SEGS[area.seg]?.label + (area.zone === "boundary" ? " · boundary" : area.zone === "outer" ? " · outfield" : "")
    : phase > 2 ? "Didn’t travel" : null;
  const note = shot === "padded" || shot === "hit_body" ? "Runs off the pads or body are recorded as leg byes."
    : shot === "missed" ? "Runs after a miss are recorded as byes." : null;

  const strip = (
    <Strip midBall={!basic && phase > 1}
      onWide={() => { onWide(); if (!basic) reset(); }}
      onNoBall={onNoBall}
      // A dot mid-ball carries what the scorer has told the pad so far — the
      // same event as the outcome's 0; with nothing chosen it is the one-tap dot.
      onDot={() => (basic ? basicRun(0) : commitRun(0))}
      onUndo={() => { if (!basic && phase > 1) reset(); else onUndo(); }}/>
  );

  if (basic) return (
    <div data-testid="basic-pad" style={{ display: "grid", gap: T.space.sm }}>
      <h2 style={{ ...sectionLabel(), margin: 0 }}>Basic Scoring</h2>
      <OutcomeKeys onRun={basicRun} onExtra={basicExtra} onWicket={() => onWicketCtx(null, null, null)}/>
      {strip}
    </div>
  );

  return (
    <div data-testid="three-phase-pad" data-phase={phase} style={{ display: "grid", gap: T.space.sm }}>
      <Stepper phase={phase} values={[shotMeta?.label ?? null, areaWord, null]}
        onStep={(n) => { setPhase(n); if (n === 1) setArea(null); }}/>
      {phase === 1 && <ShotPhase shot={shot} onShot={(id) => { setShot(id); setArea(null); setPhase(2); }}/>}
      {phase === 2 && <AreaPhase inn={inn} area={area} onArea={(s) => { setArea(s); setPhase(3); }} onNone={() => { setArea(null); setPhase(3); }}/>}
      {phase === 3 && <OutcomeKeys onRun={commitRun} onExtra={commitExtra} onWicket={commitWicket} note={note}/>}
      {strip}
    </div>
  );
}
