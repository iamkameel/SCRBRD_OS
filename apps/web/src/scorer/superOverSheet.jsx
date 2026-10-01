import { useState } from "react";
import { T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { Icon } from "../ui/icons.jsx";
import { NOT_RECORDED_WORDS, UMPIRES_DECIDE_WORDS, superOverTitle } from "../lib/superOver.js";
import { Sheet } from "./ui.jsx";

/**
 * THE SUPER OVER, on the pad (SCRBRD-114 phase 3b; design §3.5, §3.6).
 *
 * Two parts, both fed by `superOverOffer()` (lib/superOver.js), which asks the
 * engine and the match's own playing conditions — this file decides nothing:
 *
 *   SuperOverOffer  the strip under a sealed, level match: the button when a
 *                   super over may start, the engine's words when it may not
 *                   (a league's tie stands), nothing when the match was not
 *                   level. It is on the result screen and on the pad itself,
 *                   so a pad reloaded after the seal still finds it.
 *   SuperOverSheet  the choice before it starts: who bats first (the
 *                   standard order, changeable with one line saying what the
 *                   standard is), what one over and two wickets mean, and what
 *                   the pad does not record, said once.
 *
 * Floors (DESIGN_DIRECTION §3.2, §3.5): nothing read under 12px, nothing
 * tapped under 44px, and every state in words, not colour alone. Tokens are
 * read from T while it draws; useTheme() draws it again when they change.
 */

const body = () => ({ fontFamily: T.type.body, fontSize: "15px", lineHeight: 1.45, color: T.content.primary, margin: 0 });
const quiet = () => ({ ...body(), fontSize: "14px", color: T.content.secondary });
const label = () => ({ ...T.role.label, color: T.content.secondary, margin: `0 0 ${T.space.sm}` });

/** A choice: 48 tall, 16px, a border and a tick that say it is chosen. */
const choice = (on) => ({
  width: "100%", minHeight: "48px", padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md,
  cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: T.space.sm,
  fontFamily: T.type.body, fontSize: "16px", fontWeight: on ? 600 : 500, lineHeight: 1.3,
  color: T.content.primary, background: on ? T.surface.raised : T.surface.interactive,
  border: `${on ? 2 : 1}px solid ${on ? T.content.primary : T.line.normal}`,
});

const commit = () => ({
  width: "100%", minHeight: "56px", padding: `${T.space.sm} ${T.space.lg}`, borderRadius: T.radius.md, cursor: "pointer",
  border: `1px solid ${T.content.primary}`, background: T.content.primary, color: T.surface.canvas,
  fontFamily: T.type.body, fontSize: "17px", fontWeight: 600, lineHeight: 1.25,
});

/**
 * The strip: the button, or the words why not, or nothing.
 * @param {{offer: ReturnType<typeof import("../lib/superOver.js").superOverOffer>, onStart: () => void}} p
 */
export function SuperOverOffer({ offer, onStart }) {
  useTheme();
  if (!offer || offer.state === "none") return null;
  if (offer.state === "refused") {
    return (
      <div data-testid="pad-superover-why" role="status"
        style={{ display: "flex", gap: T.space.sm, alignItems: "flex-start", padding: T.space.md, borderRadius: T.radius.md,
          border: `1px solid ${T.line.strong}`, background: T.surface.base }}>
        <span aria-hidden="true" style={{ color: T.content.secondary, fontSize: "18px", lineHeight: 1.2 }}><Icon name="scale"/></span>
        <p style={body()}>{offer.words}</p>
      </div>
    );
  }
  return (
    <div data-testid="pad-superover-offer"
      style={{ display: "grid", gap: T.space.sm, padding: T.space.md, borderRadius: T.radius.md,
        border: `2px solid ${T.content.primary}`, background: T.surface.base }}>
      <p style={body()} data-testid="pad-superover-words">{offer.words}</p>
      <button type="button" onClick={onStart} className="pressBtn os-state" data-testid="pad-superover-start" style={commit()}>
        Super over
      </button>
    </div>
  );
}

/**
 * The sheet before the first innings of the pair opens.
 * @param {{offer: any, onStart: (o: {swap: boolean}) => void, onClose: () => void, notes?: string[]}} p
 */
export function SuperOverSheet({ offer, onStart, onClose, notes = [] }) {
  useTheme();
  const [swap, setSwap] = useState(false);
  const first = swap ? offer.other : offer.standard;
  const second = swap ? offer.standard : offer.other;
  const choices = [[false, offer.standard], [true, offer.other]];
  return (
    <Sheet title={superOverTitle(offer.n)} accent={T.content.primary} onClose={onClose}>
      <div data-testid="superover-sheet" style={{ display: "grid", gap: T.space.lg, paddingTop: T.space.sm }}>
        <p style={body()}>{offer.words}</p>

        <section aria-label="Who bats first?">
          <h3 style={label()}>Who bats first?</h3>
          <div role="radiogroup" aria-label="Who bats first?" style={{ display: "grid", gap: T.space.sm }}>
            {choices.map(([sw, side]) => (
              <button key={String(sw)} type="button" role="radio" aria-checked={swap === sw} onClick={() => setSwap(sw)}
                className="pressBtn os-state" data-testid={sw ? "superover-order-other" : "superover-order-standard"}
                style={choice(swap === sw)}>
                <span aria-hidden="true" style={{ width: "20px", textAlign: "center" }}>{swap === sw ? "✓" : ""}</span>
                <span style={{ minWidth: 0, flex: 1 }}>{side.team} bat first{sw ? "" : " (the standard order)"}</span>
              </button>
            ))}
          </div>
          {swap && (
            <p data-testid="superover-standard-notice" style={{ ...quiet(), marginTop: T.space.sm }}>
              The standard order is {offer.standard.team} first. Record what the umpires agreed.
            </p>
          )}
        </section>

        <section aria-label="How it is played">
          <h3 style={label()}>How it is played</h3>
          <ul style={{ ...quiet(), margin: 0, paddingLeft: T.space.lg, display: "grid", gap: T.space.xs }}>
            <li>{first.team} bat one over, then {second.team} chase one run more.</li>
            <li>Two wickets end an innings.</li>
            <li>If it is level again, there is another.</li>
          </ul>
        </section>

        {notes.length > 0 && (
          <section aria-label="Who may play" data-testid="superover-eligibility">
            <h3 style={label()}>Who may play</h3>
            <ul style={{ ...quiet(), margin: 0, paddingLeft: T.space.lg, display: "grid", gap: T.space.xs }}>
              {notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
            <p style={{ ...quiet(), marginTop: T.space.sm }}>{UMPIRES_DECIDE_WORDS}</p>
          </section>
        )}

        <p data-testid="superover-not-recorded" style={quiet()}>{NOT_RECORDED_WORDS}</p>

        <button type="button" onClick={() => onStart({ swap })} className="pressBtn os-state" data-testid="superover-confirm" style={commit()}>
          Start the super over
        </button>
      </div>
    </Sheet>
  );
}
