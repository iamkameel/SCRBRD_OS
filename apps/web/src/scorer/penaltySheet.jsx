import { useId, useState } from "react";
import { NB_TYPE, PENALTY_REASON } from "@scrbrd/scoring";
import { T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { Icon } from "../ui/icons.jsx";
import {
  awardRefusal, pendingCredits, reasonWords, reasonsFor, refusalWords, shortRunRefusal, whereTheRunsGo,
} from "./penalty.js";
import { DISALLOWED_REASONS, NOT_IN_OVER_REASONS, disallowedEvents, notInOverEvents, pairRefusal } from "./penalty.js";
import { FACES_NEXT, lawsEdition } from "@scrbrd/scoring";
import { Sheet } from "./ui.jsx";

/**
 * PENALTY RUNS — the pad's sheet (Law 41; SCRBRD-094 item 1: the screen).
 *
 * Two ways in, one sheet:
 *   AN AWARD: which side gets the five, then what for — only the reasons that
 *     side can be awarded (PENALTY_REASON_SIDE), in words — then Award. The
 *     event is penalty({ runs: 5, toBattingTeam, reason }).
 *   A SHORT RUN: the umpire called deliberate short running. The delivery
 *     counts with no runs and five go to the fielding side: the two events of
 *     shortRunning(), recorded together through the pad's own ball path.
 *     The same view records the runs disallowed for a batter's further
 *     offence on the pitch or in the protected area (SCRBRD-113;
 *     runsDisallowed()). After short running under the 4th Edition (a match
 *     from 1 October 2026) it asks whom the fielding captain chose to face
 *     next; under the 3rd the batters go back to their ends, and it says so.
 *   A DELIVERY THAT DOES NOT COUNT (SCRBRD-113, both Editions): a fielder's
 *     offence on the delivery — returning without permission and touching
 *     the ball, fielding it illegally, distracting or obstructing a batter.
 *     The delivery, the runs that stand, and five to the batting side: the
 *     two events of notInOverDelivery(). After a fielder obstructs a batter
 *     the batters choose who faces, and the sheet asks.
 *
 * The Laws are asked before anything is offered (penalty.js): a refusal is
 * said here, in words, and the button that would send it is disabled with
 * that reason — never hidden, and the event is never sent to be refused.
 * No Law clause numbers anywhere on it (Kameel is checking them).
 *
 * Floors (DESIGN_DIRECTION §3.2, §3.5): nothing read under 12px, nothing
 * tapped under 44px. Tokens are read from T while it draws; useTheme() makes
 * it draw again when the theme or the colours change.
 *
 * Out of scope, said on the sheet in one line: the umpires' report of the
 * offence to the offending side (a discipline record, db/25).
 */

const DELIVERIES = [
  { type: "run", label: "Fair ball" },
  { type: "Nb", label: "No ball" },
  { type: "Wd", label: "Wide" },
];

/** A no-ball's kind, asked as the no-ball sheet asks it (NB_TYPE). */
const NO_BALL_KINDS = [
  { type: NB_TYPE.FRONT_FOOT, label: "Front foot" },
  { type: NB_TYPE.HEIGHT, label: "Waist-high full toss" },
  { type: NB_TYPE.BEAMER, label: "Beamer" },
];

/** A delivery that does not count may be any kind but a wicket. */
const NOT_IN_OVER_DELIVERIES = [
  { type: "run", label: "Off the bat" },
  { type: "B", label: "Byes" },
  { type: "LB", label: "Leg byes" },
  { type: "Nb", label: "No ball" },
  { type: "Wd", label: "Wide" },
];

/** What the umpire called, for the runs-disallowed view, in words. */
const DISALLOWED_WORDS = Object.freeze({
  short_running: "Deliberate short running",
  pitch_damage: "A batter on the pitch again, after the warning",
  striker_position: "The striker too near the protected area again, after the warning",
});

const label = () => ({ ...T.role.label, color: T.content.secondary, margin: `0 0 ${T.space.sm}` });
const body = () => ({ fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.45, color: T.content.secondary, margin: 0 });

/** A choice: 48 tall, 16px, a border that says it is chosen and a tick that says it twice. */
const choice = (on) => ({
  width: "100%", minHeight: "48px", padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md,
  cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: T.space.sm,
  fontFamily: T.type.body, fontSize: "16px", fontWeight: on ? 600 : 500, lineHeight: 1.3,
  color: T.content.primary, background: on ? T.surface.raised : T.surface.interactive,
  border: `${on ? 2 : 1}px solid ${on ? T.content.primary : T.line.normal}`,
});

/** The one button that records: filled when it may, flat with its reason when it may not. */
const commit = (enabled) => ({
  width: "100%", minHeight: "56px", padding: `${T.space.sm} ${T.space.lg}`, borderRadius: T.radius.md,
  cursor: enabled ? "pointer" : "not-allowed", border: `1px solid ${enabled ? T.content.primary : T.line.normal}`,
  fontFamily: T.type.body, fontSize: "17px", fontWeight: 600, lineHeight: 1.25,
  background: enabled ? T.content.primary : T.surface.interactive,
  color: enabled ? T.surface.canvas : T.content.tertiary,
});

/** The Laws' answer, in place and in words. */
function Refusal({ id, words }) {
  if (!words) return null;
  return (
    <div id={id} data-testid="penalty-refusal" role="status"
      style={{ display: "flex", gap: T.space.sm, alignItems: "flex-start", padding: T.space.md, borderRadius: T.radius.md,
        border: `1px solid ${T.semantic.critical}`, background: T.surface.base }}>
      <span aria-hidden="true" style={{ color: T.semantic.criticalText, fontSize: "18px", lineHeight: 1.2 }}><Icon name="ban"/></span>
      <p style={{ ...body(), color: T.semantic.criticalText, fontWeight: 500 }}>
        <span style={{ fontWeight: 700 }}>The Laws refuse this. </span>{words}
      </p>
    </div>
  );
}

/** What the scorer still has to choose, said under the button it is holding back. */
function Hint({ id, words }) {
  if (!words) return null;
  return <p id={id} data-testid="penalty-hint" style={{ ...body(), fontSize: "14px", color: T.content.secondary }}>{words}</p>;
}

/**
 * Who faces the next ball: the two batters at the wicket, by name. `who`
 * says whose choice it is, in words.
 */
function FacesNext({ who, names, value, onChange }) {
  return (
    <section aria-label="Who faces the next ball?">
      <h3 style={label()}>Who faces the next ball?</h3>
      <p style={{ ...body(), fontSize: "14px", marginBottom: T.space.sm }}>{who}</p>
      <div role="radiogroup" aria-label="Who faces the next ball?" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: T.space.sm }}>
        {[[FACES_NEXT.STRIKER, names.striker || "The striker"], [FACES_NEXT.NON_STRIKER, names.nonStriker || "The non-striker"]].map(([k, name]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} data-testid={`faces-next-${k}`}
            onClick={() => onChange(k)} className="pressBtn os-state"
            style={{ ...choice(value === k), justifyContent: "center", textAlign: "center" }}>
            {name}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * @param {object} p
 * @param {"award" | "shortRun" | "notInOver"} [p.mode]  where it opens
 * @param {any[]} p.innings   the pad's fold (foldPad)
 * @param {any[][]} p.events  the pad's log
 * @param {number} p.curIn
 * @param {object} [p.ctx]    the fold's context
 * @param {{striker: any, nonStriker: any, bowler: any}} p.crease  who is in, as the next ball's event names them
 * @param {{striker?: string, nonStriker?: string, bowler?: string}} [p.names]  the same, as names
 * @param {(c: {toBattingTeam: boolean, reason: string}) => void} p.onAward
 * @param {(type: string, nbType: string | null, o?: {reason: string, facesNext: string | null}) => void} p.onShortRun
 *   the delivery, a no-ball's kind, and why the runs were disallowed and who faces next
 * @param {(o: {type: string, value: number, nbType: string | null, reason: string, facesNext: string | null}) => void} [p.onNotInOver]
 *   a delivery that does not count in the over
 * @param {() => void} p.onClose
 */
export function PenaltySheet({ mode = "award", innings, events, curIn, ctx, crease, names = {}, onAward, onShortRun, onNotInOver = () => {}, onClose }) {
  useTheme();
  const [view, setView] = useState(mode);
  const [side, setSide] = useState(/** @type {boolean | null} */ (null));
  const [reason, setReason] = useState(/** @type {string | null} */ (null));
  const [delivery, setDelivery] = useState("run");
  const [nbType, setNbType] = useState(/** @type {string} */ (NB_TYPE.FRONT_FOOT));
  const [why, setWhy] = useState(/** @type {string} */ ("short_running"));
  const [faces, setFaces] = useState(/** @type {string | null} */ (null));
  const [notIn, setNotIn] = useState(/** @type {string | null} */ (null));
  const [runsStand, setRunsStand] = useState(0);
  const refusalId = useId(), hintId = useId();

  const inn = innings?.[curIn] ?? null;
  const batting = inn?.battingTeam || "The batting side";
  const fielding = inn?.bowlingTeam || "The fielding side";
  const match = { innings, events };
  const pending = pendingCredits(innings);
  // The Edition of the Laws the match is scored under (SCRBRD-113), as the
  // fold dated it: whether the fielding captain chooses who faces after
  // short running.
  const fourth = lawsEdition(match) === 4;

  const pendingLines = pending.length > 0 && (
    <div data-testid="penalty-pending" style={{ display: "grid", gap: T.space.xs }}>
      {pending.map((p) => (
        <p key={p.team} style={{ ...body(), color: T.content.primary }}>
          <Icon name="gavel"/> {p.words} (penalty runs).
        </p>
      ))}
    </div>
  );
  const reportLine = (
    <p data-testid="penalty-report-note" style={{ ...body(), fontSize: "13px", color: T.content.tertiary }}>
      The umpires report the offence to the offending side. This pad records the runs only.
    </p>
  );

  // ── A short run, or runs disallowed ─────────────────────────
  if (view === "shortRun") {
    const kind = delivery === "Nb" ? nbType : null;
    // The fielding captain's choice: after short running, 4th Edition only.
    const chooses = fourth && why === "short_running";
    const facesNext = chooses ? faces : null;
    const bowled = { type: delivery, value: 0, ...crease, ...(kind ? { nbType: kind } : {}), ...(facesNext ? { facesNext } : {}) };
    const code = why === "short_running"
      ? shortRunRefusal(match, curIn, bowled, ctx)
      : pairRefusal(match, curIn, disallowedEvents(curIn, bowled, why), ctx);
    const words = refusalWords(code);
    const ready = !code && (!chooses || faces != null);
    const who = [names.striker && `Faced by ${names.striker}`, names.nonStriker && `${names.nonStriker} at the other end`,
      names.bowler && `bowled by ${names.bowler}`].filter(Boolean).join(", ");
    const called = why === "short_running" ? "The umpire called deliberate short running." : "The umpire disallowed the runs.";
    const ends = chooses ? "The fielding captain chooses who faces the next ball." : "The batters go back to the ends they started from.";
    return (
      <Sheet title={why === "short_running" ? "Short run" : "Runs disallowed"} onClose={onClose}>
        <div data-testid="short-run-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.lg }}>
          <p style={body()}>
            {called} The delivery counts, with no runs. {ends} Five penalty runs go to {fielding}.
          </p>
          <section aria-label="What did the umpire call?">
            <h3 style={label()}>What did the umpire call?</h3>
            <div role="radiogroup" aria-label="What did the umpire call?" style={{ display: "grid", gap: T.space.xs }}>
              {DISALLOWED_REASONS.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={why === r} data-testid={`disallowed-reason-${r}`}
                  onClick={() => { setWhy(r); setFaces(null); }} className="pressBtn os-state" style={choice(why === r)}>
                  <span style={{ flex: 1 }}>{DISALLOWED_WORDS[r] ?? reasonWords(r)}</span>
                  {why === r && <span aria-hidden="true"><Icon name="circle-check"/></span>}
                </button>
              ))}
            </div>
          </section>
          <section aria-label="What was the delivery?">
            <h3 style={label()}>What was the delivery?</h3>
            <div role="radiogroup" aria-label="What was the delivery?" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: T.space.sm }}>
              {DELIVERIES.map((d) => (
                <button key={d.type} type="button" role="radio" aria-checked={delivery === d.type}
                  data-testid={`short-run-type-${d.type}`} onClick={() => setDelivery(d.type)} className="pressBtn os-state"
                  style={{ ...choice(delivery === d.type), justifyContent: "center", textAlign: "center" }}>
                  {d.label}
                </button>
              ))}
            </div>
            {delivery !== "run" && (
              <p style={{ ...body(), fontSize: "14px", marginTop: T.space.sm }}>
                The one run for a {delivery === "Nb" ? "no ball" : "wide"} still counts.
              </p>
            )}
          </section>
          {delivery === "Nb" && (
            <section aria-label="What kind of no ball?">
              <h3 style={label()}>What kind of no ball?</h3>
              <div role="radiogroup" aria-label="What kind of no ball?" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: T.space.sm }}>
                {NO_BALL_KINDS.map((k) => (
                  <button key={k.type} type="button" role="radio" aria-checked={nbType === k.type}
                    data-testid={`short-run-nb-${k.type}`} onClick={() => setNbType(k.type)} className="pressBtn os-state"
                    style={{ ...choice(nbType === k.type), justifyContent: "center", textAlign: "center" }}>
                    {k.label}
                  </button>
                ))}
              </div>
              <p style={{ ...body(), fontSize: "14px", marginTop: T.space.sm }}>The next delivery is a free hit.</p>
            </section>
          )}
          {who && <p data-testid="short-run-crease" style={body()}>{who}.</p>}
          {chooses && <FacesNext who="The fielding captain chooses." names={names} value={faces} onChange={setFaces}/>}
          <p style={{ ...body(), color: T.content.primary }}>{whereTheRunsGo(innings, curIn, false)}</p>
          <Refusal id={refusalId} words={words}/>
          <button type="button" data-testid="short-run-confirm" disabled={!ready}
            aria-describedby={code ? refusalId : !ready ? hintId : undefined}
            onClick={() => { if (ready) onShortRun(delivery, kind, { reason: why, facesNext }); }} className="os-state" style={commit(ready)}>
            Record the ball and 5 to {fielding}
          </button>
          <Hint id={hintId} words={!code && !ready ? "Choose who faces the next ball." : null}/>
          {mode === "award" && (
            <button type="button" data-testid="penalty-back" onClick={() => setView("award")} className="pressBtn os-state"
              style={{ ...choice(false), justifyContent: "center", background: "transparent" }}>
              Back to penalty runs
            </button>
          )}
          {pendingLines}
          {reportLine}
        </div>
      </Sheet>
    );
  }

  // ── A delivery that does not count in the over ──────────────
  if (view === "notInOver") {
    const kind = delivery === "Nb" ? nbType : null;
    const chooses = notIn === "obstructing_batter";
    const facesNext = chooses ? faces : null;
    const keys = delivery === "run" || delivery === "Nb" ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
    const bowled = { type: delivery, value: runsStand, ...crease, ...(kind ? { nbType: kind } : {}), ...(facesNext ? { facesNext } : {}) };
    const code = notIn == null ? null : pairRefusal(match, curIn, notInOverEvents(curIn, bowled, notIn), ctx);
    const words = refusalWords(code);
    const ready = notIn != null && !code && (!chooses || faces != null);
    const hint = notIn == null ? "Choose what the fielder did." : !code && !ready ? "Choose who faces the next ball." : null;
    return (
      <Sheet title="Delivery not counted" onClose={onClose}>
        <div data-testid="not-in-over-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.lg }}>
          <p style={body()}>
            A fielder's offence on the delivery. It does not count as one of the over. The runs completed stand.
            Five penalty runs go to {batting}.
          </p>
          <section aria-label="What did the fielder do?">
            <h3 style={label()}>What did the fielder do?</h3>
            <div role="radiogroup" aria-label="What did the fielder do?" style={{ display: "grid", gap: T.space.xs }}>
              {NOT_IN_OVER_REASONS.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={notIn === r} data-testid={`not-in-over-reason-${r}`}
                  onClick={() => { setNotIn(r); setFaces(null); }} className="pressBtn os-state" style={choice(notIn === r)}>
                  <span style={{ flex: 1 }}>{reasonWords(r)}</span>
                  {notIn === r && <span aria-hidden="true"><Icon name="circle-check"/></span>}
                </button>
              ))}
            </div>
          </section>
          <section aria-label="What was the delivery?">
            <h3 style={label()}>What was the delivery?</h3>
            <div role="radiogroup" aria-label="What was the delivery?" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: T.space.sm }}>
              {NOT_IN_OVER_DELIVERIES.map((d) => (
                <button key={d.type} type="button" role="radio" aria-checked={delivery === d.type}
                  data-testid={`not-in-over-type-${d.type}`} onClick={() => { setDelivery(d.type); setRunsStand(0); }} className="pressBtn os-state"
                  style={{ ...choice(delivery === d.type), justifyContent: "center", textAlign: "center" }}>
                  {d.label}
                </button>
              ))}
            </div>
            {(delivery === "Nb" || delivery === "Wd") && (
              <p style={{ ...body(), fontSize: "14px", marginTop: T.space.sm }}>
                The one run for a {delivery === "Nb" ? "no ball" : "wide"} still counts.
              </p>
            )}
          </section>
          {delivery === "Nb" && (
            <section aria-label="What kind of no ball?">
              <h3 style={label()}>What kind of no ball?</h3>
              <div role="radiogroup" aria-label="What kind of no ball?" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: T.space.sm }}>
                {NO_BALL_KINDS.map((k) => (
                  <button key={k.type} type="button" role="radio" aria-checked={nbType === k.type}
                    data-testid={`not-in-over-nb-${k.type}`} onClick={() => setNbType(k.type)} className="pressBtn os-state"
                    style={{ ...choice(nbType === k.type), justifyContent: "center", textAlign: "center" }}>
                    {k.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section aria-label="Runs that stand">
            <h3 style={label()}>Runs that stand</h3>
            <div role="radiogroup" aria-label="Runs that stand" style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap" }}>
              {keys.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={runsStand === r} data-testid={`not-in-over-runs-${r}`}
                  onClick={() => setRunsStand(r)} className="pressBtn os-state"
                  style={{ ...choice(runsStand === r), width: "auto", minWidth: "48px", justifyContent: "center" }}>
                  {r}
                </button>
              ))}
            </div>
            <p style={{ ...body(), fontSize: "14px", marginTop: T.space.sm }}>
              Runs completed, and the run in progress where the umpire gives it.
            </p>
          </section>
          {chooses && <FacesNext who="The batters choose." names={names} value={faces} onChange={setFaces}/>}
          <p style={{ ...body(), color: T.content.primary }}>{whereTheRunsGo(innings, curIn, true)}</p>
          <Refusal id={refusalId} words={words}/>
          <button type="button" data-testid="not-in-over-confirm" disabled={!ready}
            aria-describedby={code ? refusalId : hint ? hintId : undefined}
            onClick={() => { if (ready) onNotInOver({ type: delivery, value: runsStand, nbType: kind, reason: /** @type {string} */ (notIn), facesNext }); }}
            className="os-state" style={commit(ready)}>
            Record the ball and 5 to {batting}
          </button>
          <Hint id={hintId} words={hint}/>
          {mode === "award" && (
            <button type="button" data-testid="penalty-back" onClick={() => setView("award")} className="pressBtn os-state"
              style={{ ...choice(false), justifyContent: "center", background: "transparent" }}>
              Back to penalty runs
            </button>
          )}
          {pendingLines}
          {reportLine}
        </div>
      </Sheet>
    );
  }

  // ── An award ────────────────────────────────────────────────
  const reasons = side == null ? [] : reasonsFor(side);
  // Asked as soon as the side is chosen: "other" is either side's reason, so
  // a refusal of it is the side's (the match is decided, no innings), said
  // before the scorer reads down a list none of which can be awarded. Then
  // asked again of the reason chosen.
  const code = side == null ? null
    : awardRefusal(match, curIn, { toBattingTeam: side, reason: reason ?? PENALTY_REASON.OTHER });
  const words = refusalWords(code);
  const ready = side != null && reason != null && !code;
  const hint = side == null ? "Choose who gets the five runs." : reason == null && !code ? "Choose what the runs are for." : null;
  const pick = (s) => { if (s !== side) { setSide(s); setReason(null); } };
  const to = side == null ? null : side ? batting : fielding;

  return (
    <Sheet title="Penalty runs" onClose={onClose}>
      <div data-testid="penalty-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.lg }}>
        <p style={body()}>Five runs, awarded by the umpires.</p>
        <section aria-label="Who gets the five runs?">
          <h3 style={label()}>Who gets the five runs?</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: T.space.sm }}>
            {[[true, "Batting side", batting, "batting"], [false, "Fielding side", fielding, "fielding"]].map(([val, what, name, id]) => (
              <button key={id} type="button" data-testid={`penalty-side-${id}`} aria-pressed={side === val}
                onClick={() => pick(val)} className="pressBtn os-state"
                style={{ ...choice(side === val), minHeight: "64px", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: "2px" }}>
                <span style={{ fontSize: "16px", fontWeight: 600 }}>{what}</span>
                <span style={{ fontSize: "15px", fontWeight: 500, color: T.content.secondary, maxWidth: "100%",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
              </button>
            ))}
          </div>
          {side != null && !code && <p data-testid="penalty-where" style={{ ...body(), color: T.content.primary, marginTop: T.space.sm }}>{whereTheRunsGo(innings, curIn, side)}</p>}
        </section>

        <Refusal id={refusalId} words={words}/>

        {side != null && (
          <section aria-label="What for?">
            <h3 style={label()}>What for?</h3>
            <div data-testid="penalty-reasons" style={{ display: "grid", gap: T.space.xs }}>
              {side === false && (
                <button type="button" data-testid="penalty-short-run" onClick={() => setView("shortRun")} className="pressBtn os-state"
                  style={{ ...choice(false), background: T.surface.base, border: `1px dashed ${T.line.strong}` }}>
                  <span style={{ flex: 1 }}>Short run: the umpire gave five to the fielding side</span>
                  <span aria-hidden="true" style={{ color: T.content.secondary }}>›</span>
                </button>
              )}
              {side === false && (
                <button type="button" data-testid="penalty-disallowed" onClick={() => { setWhy("pitch_damage"); setView("shortRun"); }} className="pressBtn os-state"
                  style={{ ...choice(false), background: T.surface.base, border: `1px dashed ${T.line.strong}` }}>
                  <span style={{ flex: 1 }}>On a delivery: a batter on the pitch again, and its runs disallowed</span>
                  <span aria-hidden="true" style={{ color: T.content.secondary }}>›</span>
                </button>
              )}
              {side === true && (
                <button type="button" data-testid="penalty-not-in-over" onClick={() => setView("notInOver")} className="pressBtn os-state"
                  style={{ ...choice(false), background: T.surface.base, border: `1px dashed ${T.line.strong}` }}>
                  <span style={{ flex: 1 }}>On a delivery: a fielder's offence, and the ball does not count</span>
                  <span aria-hidden="true" style={{ color: T.content.secondary }}>›</span>
                </button>
              )}
              {reasons.map((r) => (
                <button key={r} type="button" data-testid={`penalty-reason-${r}`} aria-pressed={reason === r}
                  onClick={() => setReason(r)} className="pressBtn os-state" style={choice(reason === r)}>
                  <span style={{ flex: 1 }}>{reasonWords(r)}</span>
                  {reason === r && <span aria-hidden="true"><Icon name="circle-check"/></span>}
                </button>
              ))}
            </div>
          </section>
        )}

        <div style={{ display: "grid", gap: T.space.sm }}>
          <button type="button" data-testid="penalty-award" disabled={!ready}
            aria-describedby={code ? refusalId : hint ? hintId : undefined}
            onClick={() => { if (ready) onAward({ toBattingTeam: /** @type {boolean} */ (side), reason: /** @type {string} */ (reason) }); }}
            className="os-state" style={commit(ready)}>
            {to ? `Award 5 to ${to}` : "Award 5 penalty runs"}
          </button>
          <Hint id={hintId} words={hint}/>
        </div>
        {pendingLines}
        {reportLine}
      </div>
    </Sheet>
  );
}
