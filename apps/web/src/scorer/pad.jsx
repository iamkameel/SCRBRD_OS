import { useEffect, useRef, useState } from "react";
import { batHandOf } from "@scrbrd/scoring";
import { T, inkOn } from "../design/tokens.js";
import { Board } from "../ui/board.jsx";
import { Icon } from "../ui/icons.jsx";
import { didNotTravel } from "./delivery.js";
import { placeWords } from "./field.js";
import { boardFromInnings } from "./boardData.js";
import { WagonWheel } from "./panels.jsx";
import { ALL_SHOTS_FLAT, SHOT_CATS } from "./shots.js";
import { EXTRAS, NB_DEFAULT, NB_FROM, NB_TYPES, extraCall, extraOf, nbFreeHit, runsWords } from "./extras.js";

/**
 * THE PAD — step 2 of the redesign (DESIGN_DIRECTION §4).
 *
 * The score once, at the top, on the black board; the state in one line under
 * it; then the pad asks. By default it asks in three phases — Shot, Area,
 * Outcome — with a stepper that shows where the scorer is and steps back.
 * BASIC SCORING asks for the outcome alone. The extras (wide, no ball, bye,
 * leg bye), dot and undo are on every phase, in the same place, so the
 * commonest deliveries never need the three steps (SCRBRD-100: an extra is
 * two taps, its kind then its runs; dot and 1 are the biggest run keys).
 *
 * WHAT THIS FILE DOES NOT DO: decide what a tap records. Every key calls the
 * engine's own handlers (engine.jsx) with the values the pad passed before
 * the redesign — onCommitDetailed(type, value, shot, seg, zone), onWicketCtx,
 * onWide(runs), onNoBall(type, runs, whose), onUndo — so the events are the
 * ones the pad always emitted (extras.js; pad-feel.test.mjs proves it). The rules for which runs are byes or leg byes after a shot that
 * never touched the bat (runType) are the pad's own and are unchanged.
 *
 * Floors (§3.2, §3.5): nothing read under 12px, nothing tapped under 44px;
 * shot keys 44 tall at 16px, the run keys and the wicket key 64 (dot and 1
 * 88), the strip's extras 48 and its Dot and Undo 56, an extra's runs 56.
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
 * ball (§10).
 *
 * THE MOMENT (a four, a six, a wicket, a milestone) is a flash on this board
 * and nowhere else (Kameel, 2026-09-26: the pad is built for speed and trust,
 * the scoreboard for emotion, and nothing on the pad may ever delay or cover
 * the next input). It was a full-screen overlay for 1.7–2.4 s that, though
 * taps passed through it, covered the keys. Now the board's frame takes the
 * accent and the words sit in the board's own space for FLASH_MS, then go;
 * with reduced motion it is a cut. The full celebration belongs to the
 * spectator surfaces. The words reach a screen reader through the pad's
 * polite live region (engine.jsx, `pad-moment`), not through this.
 */
export function PadBoard({ inn, match, target, flash = null, onFlashDone }) {
  const props = boardFromInnings(inn, { target, overs: inn?.overs ?? match?.overs ?? 20 });
  if (!props) return null;
  return (
    <div data-testid="pad-board" style={{ position: "relative" }}>
      <Board {...props} compact/>
      <BoardFlash event={flash} onDone={onFlashDone}/>
    </div>
  );
}

/** How long the moment stays on the board. */
export const FLASH_MS = 600;

/**
 * The moment, inside the board's box: its frame in lime (the accent that
 * means "the ball just recorded", §3.7) and its words in the board's top
 * corner. `pointer-events: none`, and never larger than the board.
 */
export function BoardFlash({ event, onDone }) {
  useEffect(() => {
    if (!event) return undefined;
    const t = setTimeout(() => onDone?.(), FLASH_MS);
    return () => clearTimeout(t);
    // One flash per event; a queued one (SIX then FIFTY) arrives as a new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
  if (!event?.label) return null;
  const B = T.board;
  return (
    <div data-testid="board-flash" aria-hidden="true" className="os-board-flash"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: T.radius.lg,
        boxShadow: `inset 0 0 0 3px ${B.lime}`, display: "flex", alignItems: "flex-start", justifyContent: "flex-start",
        padding: `${T.space.xs} ${T.space.sm}` }}>
      <span data-testid="board-flash-label" style={{ ...T.role.label, fontSize: "16px", lineHeight: 1.2, letterSpacing: "0.08em",
        color: B.lime, background: B.face, padding: `2px ${T.space.sm}`, borderRadius: T.radius.sm, whiteSpace: "nowrap" }}>
        {event.label}
      </span>
    </div>
  );
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
  const key = (s) => (
    <Key key={s.id} face={s.label} testid={`shot-${s.id}`} pressed={shot === s.id} onClick={() => onShot(s.id)}
      style={shot === s.id ? { border: `2px solid ${T.content.primary}`, fontWeight: 600 } : undefined}/>
  );
  return (
    <div data-testid="phase-shot" style={{ display: "grid", gap: T.space.sm }}>
      {SHOT_CATS.map((c) => c.shots.length <= 3 ? (
        // A group of three is one row with its word at the start of it — the
        // way §4's drawing has "DEFENSIVE  Fwd def  Back def  Padded" — not a
        // heading row over a row: the height it saves is what keeps the strip
        // above the bottom bar on a phone, in a chase (step 3b).
        <section key={c.cat} aria-label={c.cat}
          style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) repeat(3,minmax(0,1fr))", gap: T.space.sm, alignItems: "center" }}>
          <h3 style={{ ...sectionLabel(), margin: 0, overflowWrap: "anywhere" }}>{c.cat}</h3>
          {c.shots.map(key)}
        </section>
      ) : (
        <section key={c.cat} aria-label={c.cat}>
          <h3 style={sectionLabel()}>{c.cat}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(64px,1fr))", gap: T.space.sm }}>
            {c.shots.map(key)}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Phase 2: the area ───────────────────────────────────────────

/**
 * Where the ball went: a POINT, not a sector (SCRBRD-101, closing SCRBRD-095
 * item 1). One tap on the field, no snapping, through the same wheel and the
 * same placementFromTap() the Pro hub records a point with — so the ball is
 * the same event whichever wheel the scorer used. The field is laid out for
 * the striker's hand (OFF and LEG follow him), and the position is named, in
 * the engine's words, while the finger is down; the stepper keeps it after.
 */
function AreaPhase({ inn, area, onArea, onNone }) {
  const [preview, setPreview] = useState(null);
  const words = preview ? placeWords(preview) : null;
  return (
    <div data-testid="phase-area" style={{ display: "grid", gap: T.space.sm }}>
      <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
        <p data-testid="area-prompt" aria-live="polite" style={{ ...T.role.body, flex: 1, color: words ? T.content.primary : T.content.secondary,
          fontWeight: words ? 600 : undefined, margin: 0 }}>{words ?? "Tap where the ball went."}</p>
        <Key face="Didn’t travel" testid="area-none" onClick={onNone} say="Didn’t travel: blocked, or no stroke"
          style={{ padding: `0 ${T.space.md}`, flexShrink: 0 }}/>
      </div>
      <WagonWheel bare ballLog={inn.ballLog} selSeg={area?.theta != null ? area : null}
        onPlace={(p) => { setPreview(null); onArea(p); }} onPlacing={setPreview}
        batHand={batHandOf(inn)} handFor={(b) => batHandOf(inn, b.strikerId)}
        viewMode="wagon" onViewMode={() => {}} hidden={EMPTY} onToggle={() => {}}/>
    </div>
  );
}
const EMPTY = new Set();

/**
 * What the pad hands the engine's onCommitDetailed for a ball: the area goes
 * WHOLE — the point placementFromTap() built, or didNotTravel() — exactly as
 * the Pro hub hands its point to commitBall, so the two wheels record one
 * event (apps/web/test/pad-point.test.mjs). No area (Basic Scoring, or the
 * one-tap dot) is no placement, and the engine says why as it always has.
 */
export const padCommit = (type, value, shot, area) => [type, value, shot, area?.seg ?? null, area?.zone ?? null, area ?? undefined];

// ── Phase 3: the outcome (and Basic Scoring, which is this alone) ──

const RUNS = [
  { v: 0, say: "No run" },
  { v: 1, say: "One run" },
  { v: 2, say: "Two runs" },
  { v: 3, say: "Three runs" },
  { v: 4, say: "Four, boundary" },
  { v: 6, say: "Six, maximum" },
];
const runKey = (r, onRun, h, style) => (
  <Key key={r.v} face={String(r.v)} say={r.say} testid={`run-${r.v}`} h={h} onClick={() => onRun(r.v)}
    style={{ ...T.role.figure.lg, fontSize: "28px", ...(r.v === 4 || r.v === 6 ? { border: `2px solid ${T.content.primary}` } : {}), ...style }}/>
);

/**
 * The run keys and the wicket key (SCRBRD-100 item 1). Dot and 1 are the
 * commonest balls in the game, so they are the biggest keys — two wide, 88
 * tall — and the lowest, next to the strip, where the thumb already is; 2, 3,
 * 4 and 6 are one row above them, and the wicket key, the rarest and the one
 * a stray tap must not reach, heads the block. Nothing moves from ball to
 * ball. Byes and leg byes are on the strip with the other extras (item 3).
 */
function OutcomeKeys({ onRun, onWicket, note }) {
  return (
    <div data-testid="phase-outcome" style={{ display: "grid", gap: T.space.sm }}>
      <Key face={<><Icon name="bails-off"/> Wicket</>} say="Wicket" testid="key-wicket" h="64px" onClick={onWicket}
        style={{ background: T.semantic.critical, color: inkOn(T.semantic.critical), border: `1px solid ${T.semantic.critical}`,
          fontSize: "18px", fontWeight: 700 }}/>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: T.space.sm }}>
        {RUNS.filter((r) => r.v >= 2).map((r) => runKey(r, onRun, "64px"))}
      </div>
      {note && <p style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0 }}>{note}</p>}
      <div data-testid="run-keys-big" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: T.space.sm }}>
        {RUNS.filter((r) => r.v <= 1).map((r) => runKey(r, onRun, "88px", { fontSize: "40px" }))}
      </div>
    </div>
  );
}

// ── An extra's second tap: the runs (SCRBRD-100 item 3) ─────────

const segment = (on) => ({ minHeight: "44px", padding: `0 ${T.space.xs}`, fontSize: "16px",
  ...(on ? { background: T.content.primary, color: T.surface.canvas, border: `1px solid ${T.content.primary}`, fontWeight: 600 } : {}) });

/**
 * The runs of the extra whose kind was just tapped, in the pad's own space:
 * right above the strip, over the phase keys it does not need (the strip
 * draws it, so it follows the strip wherever a small phone docks it). The
 * likely runs are marked and focused; a tap on any runs key records. The no-ball also
 * asks its type — a height no-ball or a beamer is a free hit — and whose the
 * runs are, each already on its commonest answer, as the no-ball sheet asked.
 */
function ExtraRuns({ kind, onRuns, onCancel, fourth = false, freeHits = true }) {
  const x = extraOf(kind);
  const [nb, setNb] = useState(NB_DEFAULT);
  const likelyRef = useRef(null);
  useEffect(() => { try { likelyRef.current?.focus({ preventScroll: true }); } catch { /* focus is a courtesy */ } }, [kind]);
  if (!x) return null;
  const isNb = kind === "Nb";
  const question = isNb ? "No ball: runs completed?" : kind === "Wd" ? "Wide: runs taken?" : `${x.label}s: how many?`;
  return (
    <div role="group" aria-label={question} data-testid="extra-panel" data-kind={kind}
      style={{ display: "grid", gap: T.space.sm, background: T.surface.canvas }}>
      <div style={{ display: "flex", alignItems: "center", gap: T.space.sm }}>
        <h3 style={{ ...T.role.title.md, fontSize: "18px", flex: 1, margin: 0, color: T.content.primary }}>{question}</h3>
        <Key face="Cancel" testid="extra-cancel" onClick={onCancel} style={{ padding: `0 ${T.space.md}`, flexShrink: 0 }}/>
      </div>
      {isNb && (
        <>
          <div role="radiogroup" aria-label="Which no ball?" data-testid="nb-type"
            style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: T.space.xs }}>
            {NB_TYPES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={nb.type === t.id} data-testid={`nb-type-${t.id}`}
                className="pressBtn os-state" onClick={() => setNb((p) => ({ ...p, type: t.id }))}
                style={{ ...keyBase("44px"), ...segment(nb.type === t.id) }}>{t.label}</button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Whose runs?" data-testid="nb-runs-from"
            style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: T.space.xs }}>
            {NB_FROM.map((f) => (
              <button key={f.label} type="button" role="radio" aria-checked={nb.from === f.id} data-testid={`nb-runs-${f.id ?? "bat"}`}
                className="pressBtn os-state" onClick={() => setNb((p) => ({ ...p, from: f.id }))}
                style={{ ...keyBase("44px"), ...segment(nb.from === f.id) }}>{f.label}</button>
            ))}
          </div>
          {/* No free hit in a declaration or timed match (the fold's
              inn.freeHits, from the fixture's format; SCRBRD-113). */}
          {freeHits && nbFreeHit(nb.type) && (
            <p data-testid="nb-free-hit" style={{ ...T.role.body, fontSize: "14px", lineHeight: 1.3, margin: 0, color: T.content.secondary }}>
              Free hit on the next ball.
            </p>
          )}
        </>
      )}
      {/* The Laws' 4th Edition (a match from 1 October 2026, SCRBRD-113):
          a bouncer over head height is a wide, not a no ball. */}
      {fourth && (kind === "Wd" || kind === "Nb") && (
        <p data-testid="extra-head-height" style={{ ...T.role.body, fontSize: "14px", lineHeight: 1.3, margin: 0, color: T.content.secondary }}>
          A bouncer over head height is a wide.
        </p>
      )}
      {/* The no-ball's seven keys (0–6) on one row on a 360px phone: at the
          usual gap they wrap to two, and with the 4th Edition's line above
          them the panel rose over the board. Each key keeps its 44px. */}
      <div data-testid="extra-runs" style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit,minmax(44px,1fr))`,
        gap: x.runs.length > 6 ? "2px" : T.space.xs }}>
        {x.runs.map((n) => {
          const likely = n === x.likely;
          return (
            <button key={n} ref={likely ? likelyRef : undefined} type="button" data-testid={`extra-run-${n}`} data-likely={likely || undefined}
              aria-label={`${runsWords(kind, n)}${likely ? " (the usual)" : ""}`}
              className="pressBtn os-state" onClick={() => onRuns(n, nb)}
              style={{ ...keyBase("56px"), ...T.role.figure.md, fontSize: "24px",
                ...(likely ? { background: T.content.primary, color: T.surface.canvas, border: `2px solid ${T.content.primary}` } : {}) }}>
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── The strip: on every phase, and under Basic Scoring ──────────

/**
 * Two rows, the same on every phase and under Basic Scoring: the four
 * extras' kinds (SCRBRD-100 item 3), then Dot — wide, the ball a scorer
 * records most — and Undo, which says what it will take back (item 5).
 */
function Strip({ extra, onExtra, onDot, onUndo, undoWhat, midBall, panel = null }) {
  const label = midBall ? "Undo: start this ball again" : undoWhat ? `Undo: ${undoWhat}` : "Undo: nothing to undo";
  return (
    // `pad-strip-dock` (scorer/ui.jsx): on a phone the strip docks 16px above
    // the bottom bar when the pad is taller than the screen, so the extras,
    // Dot and Undo are never below the fold (§4 rule 1).
    <div data-testid="pad-strip" className="pad-strip-dock" style={{ display: "grid", gap: T.space.sm }}>
      {/* An extra's runs sit on the strip's top edge, over the keys above
          it: the strip never moves, docked or in its place. */}
      {panel && <div style={{ position: "absolute", left: 0, right: 0, bottom: `calc(100% + ${T.space.sm})` }}>{panel}</div>}
      <div data-testid="pad-extras" role="group" aria-label="Extras"
        style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: T.space.sm }}>
        {EXTRAS.map((x) => (
          <Key key={x.kind} face={x.label} say={x.label} h="48px" pressed={extra === x.kind}
            testid={{ Wd: "key-wide", Nb: "key-noball", B: "key-byes", LB: "key-legbyes" }[x.kind]}
            onClick={() => onExtra(x.kind)}
            style={extra === x.kind ? { border: `2px solid ${T.content.primary}`, fontWeight: 600 } : undefined}/>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,3fr) minmax(0,2fr)", gap: T.space.sm }}>
        <Key face={<><span aria-hidden="true">·</span> Dot</>} say="Dot ball, no run" testid="key-dot" h="56px" onClick={onDot}
          style={{ fontSize: "18px", fontWeight: 600 }}/>
        <Key testid="key-undo" h="56px" onClick={onUndo} say={label}
          face={<>
            <Icon name="undo-2"/>
            <span style={{ display: "grid", minWidth: 0, textAlign: "left", lineHeight: 1.15 }}>
              <span>Undo</span>
              <span data-testid="key-undo-what" style={{ fontSize: "14px", color: T.content.secondary, whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis" }}>
                {midBall ? "this ball" : undoWhat ?? "nothing"}
              </span>
            </span>
          </>}/>
      </div>
    </div>
  );
}

/**
 * The pad. `basic` is Basic Scoring: the outcome keys alone. Otherwise the
 * three phases. Both end in the same engine calls the pad has always made;
 * an extra's second tap names its call through extraCall() (extras.js).
 *
 * `guard` is the engine's readiness gate, asked at an extra's first tap as a
 * tap on No ball always asked it: a pad that cannot score opens the fix, not
 * the runs. `undoWhat` is what undo will take back, in words (prompts.js).
 */
export function Pad({ inn, basic, onCommitDetailed, onWicketCtx, onWide, onNoBall, onUndo, guard, undoWhat = null, preset = null }) {
  // `preset` is where the pad opens, for the pitch deck's showcase (views/pitchdeck/):
  // a ball part-way through, drawn by this pad and not by a picture of it. The
  // scorer never passes it, so every pad on a ground opens on Shot as before.
  const [phase, setPhase] = useState(preset?.phase ?? 1);      // 1 Shot · 2 Area · 3 Outcome
  const [shot, setShot] = useState(preset?.shot ?? null);
  const [area, setArea] = useState(preset?.area ?? null);     // a placement: the point tapped, or didNotTravel() | null (not asked yet)
  const [extra, setExtra] = useState(null);   // the kind whose runs are being asked
  if (!inn) return null;

  const reset = () => { setPhase(1); setShot(null); setArea(null); setExtra(null); };
  // Off the pads or the body are leg byes; beaten and ran are byes; otherwise
  // off the bat. Unchanged from the pad before the redesign.
  const runType = (v) => { if (v <= 0) return "run"; if (shot === "padded" || shot === "hit_body") return "LB"; if (shot === "missed") return "B"; return "run"; };
  const commitRun = (v) => { onCommitDetailed(...padCommit(runType(v), v, shot, area)); reset(); };
  const commitWicket = () => { onWicketCtx(shot, area?.seg ?? null, area?.zone ?? null, area ?? undefined); reset(); };

  // Basic Scoring never has a shot or an area: these are the one-tap pad's calls.
  const basicRun = (v) => { setExtra(null); onCommitDetailed("run", v, null, null, null); };

  // An extra: the kind opens its runs (a second tap on it closes them), and
  // the runs record — through the call the pad made before (extras.js).
  const openExtra = (kind) => {
    if (extra === kind) { setExtra(null); return; }
    if (guard && !guard()) return;
    setExtra(kind);
  };
  const recordExtra = (n, nb) => {
    const call = extraCall(extra, n, { basic, shot, area, nb });
    if (!call) return;
    if (call.to === "wide") onWide(...call.args);
    else if (call.to === "noBall") onNoBall(...call.args);
    else onCommitDetailed(...call.args);
    // A wide or a no-ball ends the ball the three phases were asking about,
    // as the one-tap wide always did; so do byes. Basic Scoring has no ball
    // in progress to end.
    if (basic) setExtra(null); else reset();
  };

  const shotMeta = shot ? ALL_SHOTS_FLAT.find((s) => s.id === shot) : null;
  const areaWord = area ? (placeWords(area) ?? "Didn’t travel") : phase > 2 ? "Didn’t travel" : null;
  const note = shot === "padded" || shot === "hit_body" ? "Runs off the pads or body are recorded as leg byes."
    : shot === "missed" ? "Runs after a miss are recorded as byes." : null;

  const runs = extra && <ExtraRuns key={extra} kind={extra} onRuns={recordExtra} onCancel={() => setExtra(null)}
    fourth={inn?.lawsEdition === 4} freeHits={inn?.freeHits !== false}/>;
  const strip = (
    <Strip extra={extra} onExtra={openExtra} undoWhat={undoWhat} midBall={extra != null || (!basic && phase > 1)} panel={runs}
      // A dot mid-ball carries what the scorer has told the pad so far — the
      // same event as the outcome's 0; with nothing chosen it is the one-tap dot.
      onDot={() => (basic ? basicRun(0) : commitRun(0))}
      onUndo={() => { if (extra != null) { if (basic) setExtra(null); else reset(); } else if (!basic && phase > 1) reset(); else onUndo(); }}/>
  );
  // The phase's own keys stay where they are, out of sight and out of reach,
  // while an extra's runs are asked over them: the strip does not move.
  const behind = extra ? { visibility: "hidden" } : undefined;

  if (basic) return (
    <div data-testid="basic-pad" style={{ display: "grid", gap: T.space.sm }}>
      <h2 style={{ ...sectionLabel(), margin: 0 }}>Basic Scoring</h2>
      <div style={behind}><OutcomeKeys onRun={basicRun} onWicket={() => onWicketCtx(null, null, null)}/></div>
      {strip}
    </div>
  );

  // The stepper says where a ball is once it is under way: on the idle pad,
  // where there is nothing to step back to, its row is the strip's extras.
  return (
    <div data-testid="three-phase-pad" data-phase={phase} style={{ display: "grid", gap: T.space.sm }}>
      {phase > 1 && (
        <Stepper phase={phase} values={[shotMeta?.label ?? null, areaWord, null]}
          onStep={(n) => { setExtra(null); setPhase(n); if (n === 1) setArea(null); }}/>
      )}
      <div style={behind}>
        {phase === 1 && <ShotPhase shot={shot} onShot={(id) => { setShot(id); setArea(null); setPhase(2); }}/>}
        {phase === 2 && <AreaPhase inn={inn} area={area} onArea={(s) => { setArea(s); setPhase(3); }} onNone={() => { setArea(didNotTravel(shot)); setPhase(3); }}/>}
        {phase === 3 && <OutcomeKeys onRun={commitRun} onWicket={commitWicket} note={note}/>}
      </div>
      {strip}
    </div>
  );
}
