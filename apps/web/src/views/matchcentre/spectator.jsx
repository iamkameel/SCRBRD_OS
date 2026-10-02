import { T, contrast } from "../../design/tokens.js";
import { chipFill } from "../../ui/board.jsx";
import { teamOf } from "../../lib/matchCentre.js";
import { Icon } from "../../ui/icons.jsx";
import { SideName } from "./bits.jsx";
import { BEAT_WORD, overSummaryText } from "../../lib/announce.js";
import { superOverTitle } from "../../lib/superOver.js";

/**
 * The spectator's side of the Match Centre (Kameel's premium-feel checklist):
 * a moment on the board for a four, a six, a wicket and a milestone; a gentle
 * over summary between overs; the highlights, in order; and the board on a big
 * screen at the ground. Spectator surfaces only — the pad is built for speed
 * and trust and has none of it.
 */

/** The black or the white of the board, whichever reads better on a fill. */
const inkFor = (fill) => (contrast(fill, T.board.face) >= contrast(fill, T.board.figure) ? T.board.face : T.board.figure);

/**
 * A moment, over the board's own left-hand corner — never over the total,
 * which stays where it is, and gone within a second and a half. A four, a six
 * or a wicket is a chip-coloured beat; a milestone is the board's lime, larger,
 * with its words. Reduced motion makes the entrance a cut (GLOBAL_CSS).
 */
export function MomentMark({ moment, big = false, announce = true }) {
  if (!moment) return null;
  // The result — the match's own decided moment (SCRBRD-100 item 3) — reads
  // the same big, held slot a milestone does: never longer, never hiding the
  // score for more than about 1.5s (§3.6).
  const bigMark = moment.kind === "milestone" || moment.kind === "result";
  const fill = bigMark ? T.board.lime : moment.kind === "wicket" ? T.board.figure : chipFill(moment.kind);
  const ink = inkFor(fill);
  return (
    <div data-testid="mc-moment" data-kind={moment.kind} {...(announce ? { role: "status", "aria-live": "polite" } : { "aria-hidden": "true" })}
      className={bigMark ? "mc-moment-big" : "mc-moment"}
      style={{ position: "absolute", top: big ? T.space.xl : T.space.sm, left: big ? T.space.xl : T.space.lg, zIndex: 2,
        maxWidth: bigMark ? "58%" : "none", padding: bigMark ? `${T.space.sm} ${T.space.lg}` : `${T.space.xs} ${T.space.md}`,
        borderRadius: bigMark ? T.radius.md : T.radius.pill, background: fill, color: ink, boxShadow: T.elevation.md,
        fontFamily: T.type.body, fontWeight: 700, lineHeight: 1.25,
        fontSize: big ? (bigMark ? "clamp(20px, 3.4vmin, 44px)" : "clamp(18px, 3vmin, 36px)") : (bigMark ? "16px" : "14px") }}>
      {bigMark ? moment.text : (BEAT_WORD[moment.kind] ?? moment.text)}
      {!bigMark && announce && <span className="sr-only">: {moment.text}</span>}
    </div>
  );
}

// The words are lib/announce.js's, shared with the public page's live region.
export { overSummaryText };

/**
 * The gentle over summary between overs: the generator's end-of-over line, for
 * a few seconds. `announce={false}` where a page has a live region of its own
 * (the public page's), so the same over is not said twice.
 */
export function OverSummary({ item, big = false, announce = true }) {
  if (!item) return null;
  return (
    <div data-testid="mc-over-summary" {...(announce ? { role: "status", "aria-live": "polite" } : { "aria-hidden": "true" })} className="mc-moment"
      style={{ padding: big ? `${T.space.md} ${T.space.xl}` : `${T.space.sm} ${T.space.lg}`, borderRadius: T.radius.lg,
        background: big ? "transparent" : T.surface.raised, border: `1px solid ${big ? T.board.rule : T.line.normal}`,
        color: big ? T.board.figure : T.content.primary, fontFamily: T.type.body,
        fontSize: big ? "clamp(18px, 3vmin, 40px)" : "15px", lineHeight: 1.4 }}>
      {overSummaryText(item)}
    </div>
  );
}

/** One highlight: where it fell, its mark, its words. */
function Highlight({ item }) {
  const fill = item.kind === "milestone" ? T.board.lime : item.kind === "wicket" ? T.board.figure : chipFill(item.kind);
  const mark = item.kind === "four" ? "4" : item.kind === "six" ? "6" : item.kind === "wicket" ? "W" : <Icon name="sparkles" size={14}/>;
  return (
    <li data-testid="mc-highlight" data-kind={item.kind} data-key={item.key}
      style={{ display: "flex", gap: T.space.sm, alignItems: "flex-start", padding: `${T.space.sm} ${T.space.md}`, borderTop: `1px solid ${T.line.subtle}` }}>
      <span style={{ ...T.role.figure.sm, color: T.content.secondary, width: "40px", flexShrink: 0 }}>{item.over}.{item.ball}</span>
      <span aria-hidden="true" style={{ flexShrink: 0, width: "24px", height: "24px", borderRadius: T.radius.pill, display: "inline-flex",
        alignItems: "center", justifyContent: "center", background: fill, color: inkFor(fill), border: `1px solid ${T.line.strong}`,
        fontFamily: T.type.mono, fontSize: "13px", fontWeight: 500 }}>{mark}</span>
      <span style={{ ...T.role.body, color: T.content.primary, fontWeight: item.kind === "four" || item.kind === "six" ? 400 : 600, minWidth: 0 }}>{item.text}</span>
    </li>
  );
}

/** The kinds a highlight is. */
export const HIGHLIGHT_KINDS = new Set(["four", "six", "wicket", "milestone"]);

/** Every boundary, wicket and milestone of the match, in the order they came. */
export function Highlights({ match, innings, commentary }) {
  const items = commentary.filter((c) => HIGHLIGHT_KINDS.has(c.kind));
  if (!items.length) return null;
  const byInnings = [...new Set(items.map((i) => i.innings))];
  return (
    <section data-testid="mc-highlights" aria-label="Highlights"
      style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg, overflow: "hidden", background: T.surface.raised }}>
      <h2 style={{ ...T.role.label, color: T.content.secondary, margin: 0, padding: `${T.space.sm} ${T.space.md}`,
        borderBottom: `1px solid ${T.line.normal}`, display: "flex", gap: T.space.xs, alignItems: "center" }}>
        <Icon name="sparkles"/>Highlights
      </h2>
      {byInnings.map((n) => (
        <div key={n}>
          {byInnings.length > 1 && innings[n] && (
            <h3 style={{ ...T.role.label, color: T.content.secondary, margin: 0, padding: `${T.space.sm} ${T.space.md}`, background: T.surface.base }}>
              {innings[n].superOver != null && `${superOverTitle(innings[n].superOver)} · `}<SideName side={teamOf(match, innings[n].battingTeam)}/> innings
            </h3>
          )}
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.filter((i) => i.innings === n).map((i) => <Highlight key={i.key} item={i}/>)}
          </ol>
        </div>
      ))}
    </section>
  );
}

// BIG-SCREEN MODE moved to bigscreen.jsx (SCRBRD-133 D11): it is the ground
// display's own view now, which the public page's graph must not reach through
// this file.
