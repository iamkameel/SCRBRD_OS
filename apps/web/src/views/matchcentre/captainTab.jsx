import { useEffect, useMemo, useState } from "react";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { useLive } from "../../lib/live.js";
import { boardInnings, teamOf } from "../../lib/matchCentre.js";
import { endOf } from "../../lib/family.js";
import { bowlerRows, inningsOf, matchupTypes, matchupWords, nextIn, notYetBowled, overStory, sheetOf } from "../../lib/captain.js";
import { Board } from "../../ui/board.jsx";
import { atThisRate, boardFromInnings } from "../../scorer/boardData.js";
import { bowlerCapWords } from "../../scorer/conditionsLine.jsx";
import { ShotWheel } from "../../scorer/charts.jsx";
import { Panel, Quiet } from "./bits.jsx";

/**
 * THE CAPTAIN TAB (SCRBRD-138 phase A, C3 to C5; docs/design/
 * SCRBRD-138_captains_view.md §3.4 to §3.6): the Match Centre in family mode,
 * for a pupil who holds the captaincy honour, with the match as the Board shows
 * it and the side drawn as his.
 *
 * ONE TAB, DRAWN BY WHAT THE MATCH HAS. His side batting: the Board, who is in
 * next, his batters. His side fielding: his bowlers with the cap's own words
 * beside each, and where the other side have scored. After: the result, his
 * batters' innings in words, and his batters against pace and spin.
 *
 * WHAT IT SAYS ABOUT OVERS LEFT is `bowlerCapWords()`, the pad's own function,
 * over the match's frozen conditions: "Has 1 over left (4 an innings)", "Has
 * bowled his 4 overs", "5 overs; the conditions allow 4". Nothing else — never
 * a reason, never a boy's own limit (D4) — and no line at all where the
 * document has no cap. It is drawn while the innings is in play.
 *
 * WHAT IT NEVER DRAWS (§4): availability in any form (D7), anybody's health,
 * load, assessment or note, the opposition's dossier (D9), a win chance or a
 * threat level. No row on it opens: nothing here is a button, so no child of
 * another school is reached from it (D8). Matchups are his own batters against
 * bowling TYPES; the read names only bowlers the reader may read, and a type
 * with nothing to say is not drawn.
 */

/** @param {{label: string, children: any, testid: string}} p */
function Part({ label, children, testid }) {
  return (
    <Panel testid={testid}>
      <div style={{ padding: `${T.space.md} ${T.space.lg}`, display: "grid", gap: T.space.sm }}>
        <h2 style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>{label}</h2>
        {children}
      </div>
    </Panel>
  );
}

const body = () => ({ ...T.role.body, color: T.content.primary, margin: 0 });
const fig = () => ({ ...T.role.figure.sm, fontSize: "14px", color: T.content.primary });

/** His batters' innings in words, from the fold: "D Erasmus 23 off 18, 3 fours; caught" — the log's own dismissal line. */
function inningsWords(b) {
  const how = b.status === "out" ? (b.dismissal ?? "out") : b.status === "retired" ? "retired" : "not out";
  const fours = b.fours > 0 ? `, ${b.fours} four${b.fours === 1 ? "" : "s"}` : "";
  const sixes = b.sixes > 0 ? `, ${b.sixes} six${b.sixes === 1 ? "" : "es"}` : "";
  // A paper scorebook may leave the balls blank: said as it is, never as a number.
  const faced = b.balls == null ? `${b.runs}, balls not recorded` : `${b.runs} off ${b.balls}`;
  return `${b.name} ${faced}${fours}${sixes}; ${how}`;
}

/** His batters against pace and spin: one read per batter, folded by type, rows that name no type dropped. */
function useMatchups(ids) {
  const key = ids.join();
  const [by, setBy] = useState(/** @type {Record<string, any[]>} */ ({}));
  useEffect(() => {
    if (!signedIn() || !ids.length) { setBy({}); return undefined; }
    let cancelled = false;
    Promise.all(ids.map((id) => api(`/api/read/matchups?batterId=${id}`)
      .then((d) => [id, (d?.rows ?? []).map((r) => ({ bowlingStyle: r.bowling_style, balls: r.balls, runs: r.runs, dismissals: r.dismissals }))])
      .catch(() => [id, []]))).then((pairs) => { if (!cancelled) setBy(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return by;
}

export function CaptainTab({ match, role, innings, result, commentary, overs, phone, captain, terms, shownRuns }) {
  const me = captain.me;
  const { rows: squad } = useLive("match_squad", role, 0, { matchId: match.id });
  const end = endOf(match, me);
  const sheet = sheetOf(squad, end);
  const ours = useMemo(() => new Set([me.id, ...sheet.map((r) => r.playerId)]), [me.id, sheet]);
  const mine = inningsOf(match, me, innings, ours);
  const decided = match.status === "complete" || !!result;
  const bat = mine.filter((x) => x.side === "batting");
  const field = mine.filter((x) => x.side === "bowling");
  const batters = bat.flatMap((x) => x.inn.batsmen.filter((b) => b.balls > 0 || b.runs > 0 || b.status === "out"));
  const matchups = useMatchups(decided ? [...new Set(batters.map((b) => b.id))] : []);

  if (!innings.length) {
    return (
      <section data-testid="mc-captain" aria-label={`${captain.label}'s view`} style={{ display: "grid", gap: T.space.lg }}>
        <Quiet testid="mc-captain-empty">Nothing has been scored yet. This tab fills as the match is played.</Quiet>
      </section>
    );
  }

  // The Board, as the Summary draws it (the second line is the chase line as built).
  const { index } = boardInnings(innings, result ? {} : null);
  const inn = innings[index];
  const chase = innings.length >= 2 && inn === innings[1];
  const target = chase ? (innings[1].target ?? innings[0].runs + 1) : null;
  const inOvers = inn.overs ?? overs;
  const projected = decided ? null : atThisRate(inn, { overs: inOvers, chasing: chase, format: match.format });
  const props = boardFromInnings(inn, { target, overs: inOvers, projected });
  const side = teamOf(match, inn.battingTeam);

  const coming = decided ? [] : bat.filter((x) => !x.inn.complete).flatMap((x) => nextIn(sheet, x.inn.batsmen));

  return (
    <section data-testid="mc-captain" aria-label={`${captain.label}'s view`} style={{ display: "grid", gap: T.space.lg }}>
      <p data-testid="mc-captain-label" style={{ ...T.role.label, color: T.brand.accentText, margin: 0 }}>
        {captain.label} · {[me.schoolName, me.team].filter(Boolean).join(" ")}
      </p>

      {props && <Board {...props} total={shownRuns ?? props.total} team={phone ? side.short : side.full} size="card" testid="mc-captain-board"/>}

      {coming.length > 0 && (
        <Part label="Next in" testid="mc-captain-next-in">
          <ol style={{ margin: 0, paddingLeft: T.space.xl, display: "grid", gap: "2px", listStyle: "none" }}>
            {coming.map((r) => (
              <li key={r.playerId} style={body()}>{r.battingNo != null ? `${r.battingNo} ` : ""}{r.name}</li>
            ))}
          </ol>
        </Part>
      )}

      {batters.length > 0 && (
        <Part label={decided ? "Our batters" : "Our batters today"} testid="mc-captain-batters">
          {batters.map((b) => (
            <p key={b.id} style={fig()}>
              {b.name} {b.runs}{b.balls != null ? ` (${b.balls})` : ""}{b.status !== "out" && b.status !== "retired" ? " not out" : ""}{b.fours > 0 ? ` · ${b.fours}×4` : ""}{b.sixes > 0 ? ` · ${b.sixes}×6` : ""}
            </p>
          ))}
        </Part>
      )}

      {field.map(({ inn: f, i }) => {
        const inPlay = !decided && !f.complete;
        const rows = bowlerRows(f, (balls) => bowlerCapWords(terms, balls), inPlay);
        if (!rows.length) return null;
        const rest = notYetBowled(sheet, f.bowlers);
        return (
          <Part key={`bowl-${i}`} label={decided ? "Our bowlers" : "Our bowlers · overs left"} testid="mc-captain-bowlers">
            {rows.map((b) => (
              <div key={b.id} data-testid={`mc-captain-bowler-${b.id}`} style={{ display: "flex", justifyContent: "space-between", gap: T.space.md, flexWrap: "wrap" }}>
                <span style={body()}>{b.name}</span>
                <span style={fig()}>{b.figures}</span>
                {b.words && <span data-testid={`mc-captain-cap-${b.id}`} style={{ ...body(), fontWeight: 600, flexBasis: "100%" }}>{b.words}</span>}
              </div>
            ))}
            {inPlay && rest.length > 0 && (
              <p style={{ ...body(), color: T.content.secondary }}>Not yet bowled: {rest.map((r) => r.name).join(", ")}</p>
            )}
          </Part>
        );
      })}

      {field.filter((x) => x.inn.ballLog?.length).map(({ inn: o, i }) => (
        <div key={`wheel-${i}`} data-testid="mc-captain-wheel">
          <ShotWheel inn={o} playerId={null} title="Where they have scored"/>
        </div>
      ))}

      {(decided ? innings.map((_, i) => i).filter((i) => innings[i]?.superOver == null) : [index]).map((i) => {
        const story = overStory(commentary, i, decided ? null : 6);
        if (!story.length) return null;
        return (
          <Part key={`story-${i}`} label={decided ? `Over story · ${teamOf(match, innings[i].battingTeam).short}` : "Over story · last six"} testid="mc-captain-story">
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "2px" }}>
              {story.map((o) => <li key={o.key} style={{ ...body(), fontSize: "14px" }}><span style={fig()}>{o.over}</span> {o.text}</li>)}
            </ol>
          </Part>
        );
      })}

      {decided && batters.length > 0 && (
        <Part label="Our innings, in words" testid="mc-captain-words">
          {batters.map((b) => <p key={b.id} style={{ ...body(), fontSize: "14px" }}>{inningsWords(b)}.</p>)}
        </Part>
      )}

      {decided && batters.some((b) => matchupTypes(matchups[b.id]).length) && (
        <Part label="Our batters against pace and spin" testid="mc-captain-matchups">
          {batters.filter((b) => matchupTypes(matchups[b.id]).length).map((b) => (
            <div key={b.id} style={{ display: "grid", gap: "2px" }}>
              <span style={body()}>{b.name}</span>
              {matchupTypes(matchups[b.id]).map((t) => (
                <span key={t.type} style={{ ...body(), fontSize: "14px", color: T.content.secondary }}>
                  v {t.type}: {matchupWords(t)}
                </span>
              ))}
            </div>
          ))}
        </Part>
      )}
    </section>
  );
}
