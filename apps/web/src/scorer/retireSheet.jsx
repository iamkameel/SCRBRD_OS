import { useId, useState } from "react";
import { T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { Icon } from "../ui/icons.jsx";
import { END_WORDS, retireChoices, retireRefusal, retireRefusalWords } from "./retire.js";
import { Sheet } from "./ui.jsx";

/**
 * "BATTER RETIRED HURT" — the pad's sheet (SCRBRD-071; retire.js has the flow).
 *
 * Opened from the pad's menu only, never by itself (DESIGN_DIRECTION §1a).
 * One question: which batter, the striker or the non-striker, by name with
 * his figures. "Record" sends retire({batter, reason: "hurt"}); the pad then
 * opens the batting-order sheet at once for whoever comes in. It is not a
 * wicket and the sheet says so.
 *
 * The Laws are asked before anything is offered (retire.js); a refusal is said
 * in place, in words, and Record is disabled with it. No Law clause numbers.
 * Floors (DESIGN_DIRECTION §3.2, §3.5): nothing read under 12px, nothing
 * tapped under 44px; tokens read from T while it draws, useTheme() redraws it
 * when the theme or the colours change.
 */

const label = () => ({ ...T.role.label, color: T.content.secondary, margin: `0 0 ${T.space.sm}` });
const body = () => ({ fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.45, color: T.content.secondary, margin: 0 });

/** A choice: 56 tall, 16px, a border that says it is chosen. */
const choice = (on) => ({
  width: "100%", minHeight: "56px", padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md,
  cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: T.space.sm,
  fontFamily: T.type.body, fontSize: "16px", fontWeight: on ? 600 : 500, lineHeight: 1.3,
  color: T.content.primary, background: on ? T.surface.raised : T.surface.interactive,
  border: `${on ? 2 : 1}px solid ${on ? T.content.primary : T.line.normal}`,
});

/** The one button that records. */
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
    <div id={id} data-testid="retire-refusal" role="status"
      style={{ display: "flex", gap: T.space.sm, alignItems: "flex-start", padding: T.space.md, borderRadius: T.radius.md,
        border: `1px solid ${T.semantic.critical}`, background: T.surface.base }}>
      <span aria-hidden="true" style={{ color: T.semantic.criticalText, fontSize: "18px", lineHeight: 1.2 }}><Icon name="ban"/></span>
      <p style={{ ...body(), color: T.semantic.criticalText, fontWeight: 500 }}>
        <span style={{ fontWeight: 700 }}>The Laws refuse this. </span>{words}
      </p>
    </div>
  );
}

/**
 * @param {object} p
 * @param {any[]} p.innings   the pad's fold (foldPad)
 * @param {any[][]} p.events  the pad's log
 * @param {number} p.curIn
 * @param {(id: string) => void} p.onRetire
 * @param {() => void} p.onClose
 */
export function RetireSheet({ innings, events, curIn, onRetire, onClose }) {
  useTheme();
  const [picked, setPicked] = useState(/** @type {string | null} */ (null));
  const refusalId = useId(), hintId = useId();
  const match = { innings, events };
  const choices = retireChoices(match, curIn);
  const chosen = choices.find((c) => c.id === picked) ?? null;
  // Nobody at the crease: the Laws' answer for a retirement of nobody says why.
  const code = chosen ? chosen.code : choices.length === 0 ? retireRefusal(match, curIn, null) : null;
  const words = retireRefusalWords(code);
  const ready = chosen != null && !code;
  const hint = !code && chosen == null && choices.length > 0 ? "Choose the batter who is going off." : null;
  return (
    <Sheet title="Batter retired hurt" onClose={onClose}>
      <div data-testid="retire-sheet" style={{ paddingTop: T.space.md, display: "grid", gap: T.space.lg }}>
        <p style={body()}>
          Retired hurt is not out, and not a wicket. He may come back later in the innings, and his score goes on from where he left it.
        </p>
        <Refusal id={refusalId} words={words}/>
        {choices.length > 0 && (
          <section aria-label="Who is going off?">
            <h3 style={label()}>Who is going off?</h3>
            <div role="radiogroup" aria-label="Who is going off?" style={{ display: "grid", gap: T.space.xs }}>
              {choices.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={picked === c.id} data-testid={`retire-pick-${c.end}`}
                  data-batter={c.id} onClick={() => setPicked(c.id)} className="pressBtn os-state" style={choice(picked === c.id)}>
                  <span style={{ flex: 1, minWidth: 0, display: "grid", gap: "2px" }}>
                    <span>{c.name}</span>
                    <span style={{ fontSize: "13px", fontWeight: 500, color: T.content.secondary }}>{END_WORDS[c.end]}</span>
                  </span>
                  <span style={{ fontFamily: T.type.mono, fontSize: "14px", color: T.content.secondary }}>{c.runs} ({c.balls})</span>
                  {picked === c.id && <span aria-hidden="true"><Icon name="circle-check"/></span>}
                </button>
              ))}
            </div>
          </section>
        )}
        <div style={{ display: "grid", gap: T.space.sm }}>
          <button type="button" data-testid="retire-confirm" disabled={!ready}
            aria-describedby={code ? refusalId : hint ? hintId : undefined}
            onClick={() => { if (ready) onRetire(/** @type {string} */ (picked)); }}
            className="os-state" style={commit(ready)}>
            {chosen ? `Record: ${chosen.name} retired hurt` : "Record the retirement"}
          </button>
          {hint && <p id={hintId} data-testid="retire-hint" style={{ ...body(), fontSize: "14px" }}>{hint}</p>}
        </div>
        <p style={{ ...body(), fontSize: "13px", color: T.content.tertiary }}>
          Next, choose who comes in.
        </p>
      </div>
    </Sheet>
  );
}
