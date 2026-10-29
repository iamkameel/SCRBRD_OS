import { T } from "../../design/tokens.js";
import { oversOf, teamOf } from "../../lib/matchCentre.js";
import { isSuperOver, superOverTitle, superOversOf } from "../../lib/superOver.js";
import { SideName } from "./bits.jsx";

/**
 * The scores under a match's title, one line a side: the match's own
 * innings, and under them — apart, labelled and never added in — each super
 * over (SCRBRD-114 phase 3b, §4). Shared by the signed-in Match Centre and
 * the public page, so the two cannot say it differently.
 *
 * An innings a correction moved says so beside its figure, "· corrected
 * 18:42" (GA-I36 §5): `corrected` is lib/corrections.js inningsWords(),
 * keyed by the fold's own innings, so this file imports nothing for it.
 *
 * @param {{match: any, played: any[], corrected?: Map<any, string> | null}} p  `played` is the fold's innings, null-free
 */
export function HeaderScores({ match, played, corrected = null }) {
  const own = played.filter((inn) => !isSuperOver(inn));
  const pairs = superOversOf(played);
  const line = (inn, k) => (
    <div key={k} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", columnGap: T.space.md, maxWidth: "520px" }}>
      <span style={{ ...T.role.body, color: T.content.secondary, minWidth: 0 }}>
        <SideName side={teamOf(match, inn.battingTeam)}/>
      </span>
      <span style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, whiteSpace: "nowrap" }}>
        {inn.runs}/{inn.wickets} <span style={{ color: T.content.tertiary }}>({oversOf(inn.balls)})</span>
      </span>
      {corrected?.has(inn) && (
        <span data-testid="mc-score-corrected" style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary, flexBasis: "100%", textAlign: "right" }}>
          {corrected.get(inn)}
        </span>
      )}
    </div>
  );
  return (
    <div data-testid="mc-scores" style={{ display: "grid", gap: "2px" }}>
      {own.map((inn, i) => line(inn, i))}
      {pairs.map((p) => (
        <div key={p.n} data-testid={`mc-superover-score-${p.n}`} role="group" aria-label={superOverTitle(p.n)}
          style={{ display: "grid", gap: "2px", marginTop: T.space.xs, paddingTop: T.space.xs, borderTop: `1px solid ${T.line.subtle}` }}>
          <span style={{ ...T.role.label, color: T.content.secondary }}>{superOverTitle(p.n)}</span>
          {p.innings.map((inn, k) => line(inn, k))}
        </div>
      ))}
    </div>
  );
}

/**
 * Where the match stands, in one sentence (CRI-1.2): lib/matchCentre.js
 * statusSentence()'s `{state, text}`, drawn the one way on the signed-in
 * header and the public page's. A decided match keeps the result line's
 * test id (`mc-result`), as it was before the sentence; every other state is
 * `mc-status-line`. `except`: states a page leaves to a line of its own (the
 * header's match line already says when a fixture starts).
 * @param {{st: {state: string, text: string} | null, except?: string[]}} p
 */
export function StatusLine({ st, except = [] }) {
  if (!st?.text || except.includes(st.state)) return null;
  const decided = st.state === "result" || st.state === "super_over";
  return (
    <p data-testid={decided ? "mc-result" : "mc-status-line"} data-state={st.state}
      style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, margin: 0 }}>
      {st.text}
    </p>
  );
}
