import { Fragment } from "react";
import { T } from "../../design/tokens.js";
import { trailLine } from "../../lib/signals.js";

/**
 * A SIGNAL CARD'S EVIDENCE TRAIL (GA-I27 slice 1, C2;
 * docs/design/GA-I27_coach_cards.md §5.1): the card's own working, shown.
 * Three things, in this order: the source line (the read, its window, its
 * denominator, "as at" when the read answered and, for a card that stands on
 * the match's log, its head `seq`); the figures the rule stood on, label left
 * and value right in the figure face; and one link to the existing screen
 * that holds the rest, where this reader's menu has it.
 *
 * Everything here is the card's `evidence`, computed by the rule from the
 * rows it already read (lib/signals.js): this component reads nothing, writes
 * nothing and adds no figure of its own (C-D2, C-D6). It is drawn only under
 * a card that fired, so it names no read the reader did not get (C-D8).
 *
 * Loaded on the first "Where this comes from" (FeedDrawer.jsx, React.lazy):
 * tools/check-bundle.mjs holds it out of the entry graph by its figures'
 * test id. No animation: it appears and goes, as the cards do.
 *
 * @param {{card: import("../../lib/signals.js").Card, now: number, onOpen: (() => void) | null, id: string}} p
 */
export function EvidenceTrail({ card, now, onOpen, id }) {
  const e = card.evidence;
  return (
    <div id={id} data-testid="evidence-trail" data-rule={card.rule} data-read={e.read} data-as-of={e.asOf ?? ""} data-head={e.head ?? ""}
      style={{ display: "grid", gap: T.space.sm, borderTop: `1px solid ${T.line.normal}`, paddingTop: T.space.sm }}>
      <p data-testid="evidence-trail-line" style={quiet()}>{trailLine(e, now)}</p>
      {e.figures.length > 0 && (
        <dl data-testid="evidence-trail-figures" style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: T.space.md, rowGap: "2px", alignItems: "baseline" }}>
          {e.figures.map((f, i) => (
            <Fragment key={i}>
              <dt style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0, minWidth: 0, overflowWrap: "anywhere" }}>{f.label}</dt>
              <dd data-label={f.label} style={{ ...T.role.figure.sm, color: T.content.primary, margin: 0, textAlign: "right", overflowWrap: "anywhere" }}>
                {f.value}{f.unit ? ` ${f.unit}` : ""}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
      {onOpen && e.screen && (
        <a href={`#${e.screen.route}`} data-testid="evidence-trail-link" data-route={e.screen.route} className="os-state"
          onClick={(ev) => { ev.preventDefault(); onOpen(); }} style={link()}>
          {e.screen.label}
        </a>
      )}
    </div>
  );
}

const quiet = () => ({ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0 });
const link = () => ({ minHeight: "44px", padding: `0 ${T.space.lg}`, display: "inline-flex", alignItems: "center", justifySelf: "start",
  color: T.content.primary, textDecoration: "none", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill,
  fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 });
