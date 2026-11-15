/**
 * A knockout competition's bracket (SCRBRD-060): the rounds as columns on a
 * wide screen and one after another on a phone (.os-bracket, design/tokens.js),
 * each tie a card with its two sides, its date and its result. Everything on
 * a card is the server's (GET /api/competitions/:id/bracket); a side or a
 * date nobody knows yet says "To be decided", with the tie it waits for.
 * Nothing moves, so there is no motion to reduce.
 */
import { D } from "../design/tokens.js";
import { Badge } from "../ui/primitives.jsx";
import { HOW_WORDS, roundTitle, sideSaid, whenSaid } from "../lib/bracket.js";

const S = {
  h3: { margin: "0 0 10px", fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.amber, letterSpacing: "0.06em", textTransform: "uppercase" },
  name: (through, known) => ({ fontFamily: D.body, fontSize: "13px", fontWeight: through ? 700 : 500, overflowWrap: "anywhere",
                               color: known ? D.textPrimary : D.textMuted, fontStyle: known ? "normal" : "italic" }),
  meta: { fontFamily: D.body, fontSize: "12px", color: D.textMuted, overflowWrap: "anywhere" },
  line: { fontFamily: D.body, fontSize: "12px", color: D.textSecondary, overflowWrap: "anywhere" },
};

/** @param {{ side: any, last: number, through: boolean, testid: string }} p */
function Side({ side, last, through, testid }) {
  const s = sideSaid(side, last);
  return (
    <div data-testid={testid} data-known={s.known ? "yes" : "no"} style={{ display: "flex", alignItems: "flex-start", gap: "8px", justifyContent: "space-between" }}>
      <div style={{ minWidth: 0 }}>
        <div style={S.name(through, s.known)}>{s.name}</div>
        {s.note && <div style={S.meta}>{s.note}</div>}
      </div>
      {through && <Badge color={D.emerald} data-testid="bracket-through">Through</Badge>}
    </div>
  );
}

/** @param {{ tie: any, last: number }} p */
function Tie({ tie, last }) {
  const when = whenSaid(tie);
  const done = tie.through != null;
  return (
    <li data-testid="bracket-tie" data-key={tie.key} data-match-id={tie.matchId ?? ""}
      style={{ listStyle: "none", padding: "10px 12px", background: D.surf2, borderRadius: D.md, display: "flex", flexDirection: "column", gap: "6px",
               border: `1px solid ${done ? D.emerald + "33" : D.border}` }}>
      <div style={S.meta}>Match {tie.match}</div>
      <Side side={tie.home} last={last} through={tie.through === "home"} testid="bracket-home"/>
      <div style={{ ...S.meta, fontFamily: D.mono }} aria-hidden="true">v</div>
      <Side side={tie.away} last={last} through={tie.through === "away"} testid="bracket-away"/>
      <div data-testid="bracket-when" data-known={when.known ? "yes" : "no"} style={S.meta}>{when.text}</div>
      {tie.result?.text && <div data-testid="bracket-result" style={{ ...S.line, color: done ? D.textPrimary : D.textSecondary }}>{tie.result.text}</div>}
      {tie.result?.how && HOW_WORDS[tie.result.how] && <div data-testid="bracket-how" style={S.meta}>{HOW_WORDS[tie.result.how]}</div>}
      {tie.flags?.map((/** @type {any} */ f) => (
        <div key={f.side} data-testid="bracket-flag" role="note" style={{ ...S.line, color: D.amber }}>
          {f.side === "home" ? "Home" : "Away"} side: {f.note}.
        </div>
      ))}
    </li>
  );
}

/**
 * @param {{ bracket: any, loading?: boolean, failed?: boolean, onRetry?: () => void }} p
 */
export function KnockoutBracket({ bracket, loading = false, failed = false, onRetry }) {
  if (loading && !bracket) return <p data-testid="league-bracket-loading" style={{ ...S.line, padding: "24px 0", textAlign: "center" }}>Reading the bracket…</p>;
  if (failed && !bracket) {
    return (
      <div data-testid="league-bracket-failed" style={{ ...S.line, padding: "24px 0", textAlign: "center" }}>
        The bracket could not be read just now.{" "}
        {onRetry && <button type="button" onClick={onRetry} className="pressBtn"
          style={{ minHeight: "44px", padding: "0 16px", borderRadius: D.pill, border: `1px solid ${D.border}`, background: "transparent",
                   color: D.textPrimary, fontFamily: D.body, fontSize: "12px", cursor: "pointer" }}>Try again</button>}
      </div>
    );
  }
  if (!bracket) return null;
  if (!bracket.drawn) {
    return (
      <div data-testid="league-bracket-undrawn" style={{ ...S.line, padding: "24px 0", textAlign: "center" }}>
        No draw has been published for this cup yet.
        {bracket.fixturesOutsideDraw > 0 && ` Its ${bracket.fixturesOutsideDraw === 1 ? "fixture is" : `${bracket.fixturesOutsideDraw} fixtures are`} under Fixtures and Results.`}
      </div>
    );
  }
  const rounds = bracket.rounds ?? [];
  const last = rounds.length ? rounds[rounds.length - 1].round : 0;
  return (
    <section data-testid="league-bracket" aria-label="Bracket">
      {bracket.champion && <p data-testid="bracket-champion" style={{ ...S.line, color: D.textPrimary, fontWeight: 700, margin: "0 0 12px" }}>Winner: {bracket.champion}</p>}
      <div className="os-bracket" style={/** @type {any} */ ({ "--rounds": Math.max(1, rounds.length) })}>
        {rounds.map((r) => {
          const title = r.name ?? roundTitle(r.round, last);
          return (
            <div key={r.round} className="os-bracket-round" data-testid={`bracket-round-${r.round}`} style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
              <h3 style={S.h3}>{title}</h3>
              <ol aria-label={title} style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: "8px", flex: 1 }}>
                {r.ties.map((/** @type {any} */ t) => <Tie key={t.key} tie={t} last={last}/>)}
              </ol>
            </div>
          );
        })}
      </div>
      {bracket.byes?.length > 0 && (
        <p data-testid="bracket-byes" style={{ ...S.meta, marginTop: "12px" }}>
          {bracket.byes.map((/** @type {any} */ b) => `${b.label ?? "A side"} has a bye in ${roundTitle(b.round, last)}`).join(". ")}.
        </p>
      )}
      {bracket.fixturesOutsideDraw > 0 && (
        <p data-testid="bracket-outside" style={{ ...S.meta, marginTop: "8px" }}>
          {bracket.fixturesOutsideDraw === 1 ? "One fixture in this competition is" : `${bracket.fixturesOutsideDraw} fixtures in this competition are`} not part of the draw; see Fixtures and Results.
        </p>
      )}
    </section>
  );
}
