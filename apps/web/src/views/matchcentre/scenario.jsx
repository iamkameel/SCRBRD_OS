import { useId, useMemo, useState } from "react";
import { scenarioOf } from "@scrbrd/scoring";
import { T } from "../../design/tokens.js";
import { SourceLine } from "../../ui/sourceLine.jsx";
import { SRC_BALLS } from "../../lib/sourceWords.js";
import { CardHead, Panel } from "./bits.jsx";

/**
 * SCENARIOS (GA-I29 A1; docs/design/SCENARIO_AND_TREND_design.md §A3–§A6):
 * one panel on the Summary, signed in and public, while a limited-overs
 * innings is being played. Every line is @scrbrd/scoring scenarioOf()'s —
 * arithmetic on the innings' own record, in the conditional mood, team-level
 * and naming no player — and this component adds nothing to it but the
 * stepper.
 *
 * THE STEPPER. Two buttons, 44px each, a rate between them in halves from
 * 0.5 to 18.0 an over. It opens on the rate scenarioOf() gives (the rate so
 * far in a first innings, the required rate rounded up in a chase) and
 * follows it ball by ball until the reader moves it; from then the rate is
 * the reader's for this innings, and a new ball, a void or an amendment
 * moves only the outcome (A6, GA-I36 §7: no figure moves under a finger). A
 * new innings opens it afresh. Nothing is stored.
 *
 * WHAT IS ANNOUNCED. The outcome is an <output> tied to the two buttons, and
 * it is NOT a live region (aria-live off): the page has a live region of its
 * own for each new ball, and the panel must not read the arithmetic out on
 * every one. A separate polite status says the stepper's line only when the
 * reader moves it (A3).
 *
 * NO MOTION. The figures change in place; the press feedback is the shared
 * .pressBtn, which prefers-reduced-motion already turns off.
 *
 * @param {object} p
 * @param {any[]} p.innings      the match's innings, folded
 * @param {number} p.index       the innings on the board
 * @param {number | null} p.target
 * @param {number} p.overs       the allotment as the board reads it
 * @param {unknown} p.format     match.format
 * @param {any[] | null} p.events  the log, for the last five overs
 * @param {any} p.fold           the fold context
 * @param {boolean} p.decided    play has decided the match
 * @param {boolean} p.atBreak
 * @param {boolean} p.estimate   the par estimate is on the board
 * @param {string} p.team        the side batting, by name
 */
export function ScenarioPanel({ innings, index, target, overs, format, events, fold, decided, atBreak, estimate, team }) {
  const id = useId();
  // The reader's rate, in halves, and the innings it was chosen in: a new innings opens the stepper afresh.
  const [chosen, setChosen] = useState(/** @type {{index: number, halves: number} | null} */ (null));
  const [said, setSaid] = useState("");
  const halves = chosen && chosen.index === index ? chosen.halves : null;
  const base = useMemo(() => ({ innings, index, target, overs, format, ctx: fold ?? {}, decided, atBreak, estimate }),
    [innings, index, target, overs, format, fold, decided, atBreak, estimate]);
  // Folded when the log or the rate moves, not on every tick of the board's runs.
  const s = useMemo(() => scenarioOf({ ...base, halves, events }), [base, halves, events]);
  if (!s) return null;
  const at = s.lines.find((l) => l.key === "at");
  const move = (/** @type {number} */ by) => {
    const next = s.halves + by;
    if (next < s.bounds.min || next > s.bounds.max) return;
    setChosen({ index, halves: next });
    // The line as it now reads, for the polite status: the stepper's own line needs no log.
    setSaid(scenarioOf({ ...base, halves: next, events: null })?.lines.find((l) => l.key === "at")?.text ?? "");
  };
  const atMin = s.halves <= s.bounds.min, atMax = s.halves >= s.bounds.max;
  // A function, not a component: a component declared here would be a new type each render, and the
  // button under the reader's finger (or the keyboard's focus) would be replaced on every press.
  /** @param {-1 | 1} dir  @param {boolean} off  @param {string} label  @param {string} glyph  @param {string} testid */
  const button = (dir, off, label, glyph, testid) => (
    <button type="button" id={`${id}-${dir < 0 ? "down" : "up"}`} data-testid={testid} aria-label={label} aria-disabled={off ? "true" : undefined}
      onClick={() => { if (!off) move(dir); }} className="pressBtn os-state"
      style={{ minWidth: `${T.floor.target}px`, minHeight: `${T.floor.target}px`, padding: 0, display: "inline-flex", alignItems: "center",
        justifyContent: "center", cursor: off ? "default" : "pointer", background: "transparent", border: `1px solid ${T.line.normal}`,
        borderRadius: T.radius.md, color: off ? T.content.tertiary : T.content.primary, fontFamily: T.type.body, fontSize: "20px", fontWeight: 600 }}>
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
  const quiet = (/** @type {string} */ key) => key === "stopped" || key === "again" || key === "no_result";
  return (
    <Panel testid="mc-scenario">
      <CardHead icon="target">Scenarios</CardHead>
      <div style={{ padding: `${T.space.sm} ${T.space.lg} ${T.space.md}`, display: "grid", gap: T.space.sm }}>
        <SourceLine testid="mc-scenario-source" source={SRC_BALLS} scope={`${team}, this innings`} window={s.source.window}
          denominator={{ n: s.source.balls, unit: "ball" }}/>
        <ul data-kind={s.kind} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: T.space.xs }}>
          {s.lines.map((l) => (
            <li key={l.key} data-testid={`mc-scenario-${l.key}`}
              style={{ ...T.role.body, color: quiet(l.key) ? T.content.secondary : T.content.primary, margin: 0, overflowWrap: "anywhere" }}>
              {l.key === "at" && at?.stepper ? (
                <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: T.space.xs }}>
                  <span>{at.stepper.lead}</span>
                  <span role="group" aria-label="The rate, runs an over" data-testid="mc-scenario-stepper"
                    style={{ display: "inline-flex", alignItems: "center", gap: T.space.xs }}>
                    {button(-1, atMin, `Lower the rate to ${((s.halves - 1) / 2).toFixed(1)} an over`, "−", "mc-scenario-down")}
                    <span data-testid="mc-scenario-rate" style={{ ...T.role.figure.md, color: T.content.primary, minWidth: "3.2ch", textAlign: "center" }}>
                      {at.stepper.rate}
                    </span>
                    {button(1, atMax, `Raise the rate to ${((s.halves + 1) / 2).toFixed(1)} an over`, "+", "mc-scenario-up")}
                  </span>
                  <output htmlFor={`${id}-down ${id}-up`} aria-live="off" data-testid="mc-scenario-outcome">{at.stepper.tail}</output>
                </span>
              ) : l.text}
            </li>
          ))}
        </ul>
        <p data-testid="mc-scenario-footnote" style={{ fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.45, color: T.content.secondary, margin: 0 }}>
          {s.footnote}
        </p>
        <span className="sr-only" role="status" aria-live="polite" data-testid="mc-scenario-said">{said}</span>
      </div>
    </Panel>
  );
}
