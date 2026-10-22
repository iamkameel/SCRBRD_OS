/**
 * COMPARE — two players' figures side by side (GA-I24-I25 S1, and the pupil's
 * "Me v a team-mate" card, D10; docs/design/GA-I24-I25_compare_and_combine.md).
 *
 * Read, not scored. Every rule this screen keeps is in lib/compare.js, and
 * the screen draws what it returns:
 *
 *   D1  two reads, not a new one: `career` and `career_by_season` for the
 *       figures, `matchups` and `matchup_coverage` for each batter, the same
 *       reads Profiles opens.
 *   D2  the picker offers only players the reader may open today, under the
 *       assignment that carries Compare. A pupil's is his own side, and he is
 *       the left column.
 *   D3  no verdict, rank, colour or invented figure: two columns, one scale,
 *       the label between them, words beside every dash.
 *   D4  a rate only on thirty legal balls; the ball count always, with its
 *       evidence word; "not enough balls to compare" said in words.
 *   D5  only the career columns (COMPARE_FIELDS); nothing about a child's
 *       development, health, availability, age or discipline.
 *   D7  match-ups by type, never a named bowler.
 *   D8  no absence: a season is offered only where both have figures.
 *   D9  nothing stored, shared, exported or posted: no pin, no file, no
 *       share, no storage of any kind; it re-reads on every open.
 *   D14 "as at" the time the reads answered, and a way to read again.
 *
 * Every panel carries the I22 line: source, scope, window, denominator.
 */
import { useEffect, useMemo, useState } from "react";
import { T } from "../design/tokens.js";
import { signedIn } from "../lib/api.js";
import { profile } from "../lib/session.js";
import { useLive, readOnce, readQuery } from "../lib/live.js";
import { readState } from "../lib/readState.js";
import { ReadState } from "../ui/primitives.jsx";
import { SourceLine } from "../ui/sourceLine.jsx";
import { SRC_BALLS, SRC_RECORD, WINDOW_ALL, seasonWindow } from "../lib/sourceWords.js";
import {
  COMPARE_FLOOR, asAtWords, battingRows, belowFloor, bowlingRows, bySide, compareScopes,
  pickable, project, seasonRow, sharedSeasons, teamMates, typeRows,
} from "../lib/compare.js";

/**
 * One read that waits for its parameter: no player chosen, no request at all,
 * rather than useLive's unfiltered read of every batter's match-ups.
 * @param {string} resource  @param {Record<string, string> | null} params  @param {number} nonce
 */
function useReadFor(resource, params, nonce) {
  const query = params ? readQuery(params) : null;
  const [state, setState] = useState({ rows: [], live: false, loading: !!query, error: null, status: null });
  useEffect(() => {
    if (!query) { setState({ rows: [], live: false, loading: false, error: null, status: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    readOnce(resource, query).then((next) => { if (!cancelled) setState(next); });
    return () => { cancelled = true; };
  }, [resource, query, nonce]);
  return state;
}

// Functions, not constants: tokens are read at render, so a theme change reaches them.
const figure = () => ({ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary });
const word = () => ({ fontFamily: T.type.body, fontSize: "12px", lineHeight: 1.3, color: T.content.secondary });

/** A cell: the figure, and under it the word that says why a dash is a dash. */
function Cell({ c, testid, align }) {
  return (
    <td data-testid={testid} data-held={c.held ? "true" : undefined}
      style={{ padding: `${T.space.sm} ${T.space.xs}`, textAlign: align, verticalAlign: "top",
        borderTop: `1px solid ${T.line.subtle}` }}>
      <span style={{ ...figure(), display: "block" }}>{c.text}</span>
      {c.word && <span data-testid={`${testid}-word`} style={{ ...word(), display: "block" }}>{c.word}</span>}
    </td>
  );
}

/** The two-column table: A's figure, the label between, B's figure. */
function Pair({ caption, a, b, rows, testid }) {
  return (
    <table data-testid={`${testid}-table`} style={{ width: "100%", minWidth: "100%", borderCollapse: "collapse", tableLayout: "fixed", justifySelf: "stretch" }}>
      <caption className="sr-only">{caption}</caption>
      <colgroup><col style={{ width: "33%" }}/><col style={{ width: "34%" }}/><col style={{ width: "33%" }}/></colgroup>
      <thead>
        <tr>
          <th scope="col" style={{ ...T.role.label, color: T.content.primary, textAlign: "right", padding: `0 ${T.space.xs} ${T.space.xs}`, overflowWrap: "anywhere" }}>{a.name}</th>
          <th scope="col" style={{ padding: 0 }}><span className="sr-only">Figure</span></th>
          <th scope="col" style={{ ...T.role.label, color: T.content.primary, textAlign: "left", padding: `0 ${T.space.xs} ${T.space.xs}`, overflowWrap: "anywhere" }}>{b.name}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-testid={`${testid}-${r.key}`}>
            <Cell c={r.a} testid={`${testid}-${r.key}-a`} align="right"/>
            <th scope="row" style={{ ...word(), fontWeight: 600, textAlign: "center", padding: `${T.space.sm} ${T.space.xs}`,
              borderTop: `1px solid ${T.line.subtle}`, verticalAlign: "top" }}>{r.label}</th>
            <Cell c={r.b} testid={`${testid}-${r.key}-b`} align="left"/>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Panel({ title, testid, children }) {
  return (
    <section data-testid={testid} aria-label={title}
      style={{ background: T.surface.raised, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg,
        padding: `${T.space.md} ${T.space.lg}`, display: "grid", gap: T.space.sm }}>
      <h3 style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>{title}</h3>
      {children}
    </section>
  );
}

/** The panel's floor line, in words: who is under thirty, and that the rates are not divided for him. */
function FloorLine({ under, unit, testid }) {
  if (!under.length) return null;
  const who = under.map((s) => `${s.name}, ${s.n == null ? "balls not recorded" : `${s.n} ${unit}`}`).join("; ");
  return (
    <p data-testid={testid} style={{ ...word(), fontSize: "13px", margin: 0 }}>
      {`Not enough balls to compare these rates. Each needs ${COMPARE_FLOOR} legal balls before it is divided: ${who}. The counts are shown; the rates are not.`}
    </p>
  );
}

const selectStyle = () => ({
  width: "100%", minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.md,
  background: T.surface.interactive, color: T.content.primary, border: `1px solid ${T.line.normal}`,
  ...T.role.control,
});

/** A picker: the players offered, grouped by side, never the one in the other column. */
function Picker({ id, label, value, onChange, players, exclude, testid }) {
  const groups = bySide(players.filter((p) => p.id !== exclude));
  return (
    <div style={{ display: "grid", gap: T.space.xs, minWidth: 0 }}>
      <label htmlFor={id} style={{ ...T.role.label, color: T.content.secondary }}>{label}</label>
      <select id={id} data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle()}>
        <option value="">Choose a player</option>
        {groups.map(([team, ps]) => (
          <optgroup key={team} label={team}>
            {ps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.role
 * @param {{ id: string, name: string, team: string | null, school?: string | null } | null} [props.self]
 *        the pupil himself: he is the left column, and the one picker offers his side
 */
export function Compare({ role, self = null }) {
  const pupil = !!self;
  const [nonce, setNonce] = useState(0);
  const [aPick, setA] = useState("");
  const [bPick, setB] = useState("");
  const [season, setSeason] = useState("");
  const careerRead = useLive("career", role, nonce);
  const seasonsRead = useLive("career_by_season", role, nonce);

  const offered = useMemo(() => (pupil
    ? teamMates(careerRead.rows, self)
    : pickable(careerRead.rows, compareScopes(profile()?.assignments ?? []))),
  [careerRead.rows, pupil, self]);

  const aId = pupil ? self.id : aPick;
  // A choice the picker no longer offers (a re-read after he left the side) is no choice.
  const bId = offered.some((p) => p.id === bPick) ? bPick : "";
  const aOk = pupil || offered.some((p) => p.id === aId);
  const ready = aOk && !!aId && !!bId && aId !== bId;

  const mA = useReadFor("matchups", ready ? { batterId: aId } : null, nonce);
  const mB = useReadFor("matchups", ready ? { batterId: bId } : null, nonce);
  const cA = useReadFor("matchup_coverage", ready ? { batterId: aId } : null, nonce);
  const cB = useReadFor("matchup_coverage", ready ? { batterId: bId } : null, nonce);

  // D14: the time the reads answered, set when the last of them settles.
  const settled = !careerRead.loading && !seasonsRead.loading && !mA.loading && !mB.loading && !cA.loading && !cB.loading;
  const [asAt, setAsAt] = useState(/** @type {Date | null} */ (null));
  useEffect(() => { if (settled) setAsAt(new Date()); }, [settled, nonce, aId, bId]);

  if (!signedIn()) {
    return (
      <Panel title={pupil ? "Me v a team-mate" : "Compare"} testid="compare">
        <p data-testid="compare-signed-out" style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>
          Sign in to compare players. A comparison is drawn only from a school's own record, never from sample figures.
        </p>
      </Panel>
    );
  }

  const careerSaid = readState(careerRead, { what: "the career figures" });
  const meRow = pupil ? project(careerRead.rows.find((r) => r.id === self.id) ?? { id: self.id, name: self.name, team: self.team }) : null;
  const A = pupil ? meRow : offered.find((p) => p.id === aId) ?? null;
  const B = offered.find((p) => p.id === bId) ?? null;
  const seasons = ready ? sharedSeasons(seasonsRead.rows, aId, bId) : [];
  const inSeason = season && seasons.includes(season) ? season : "";
  const figA = inSeason ? seasonRow(seasonsRead.rows, aId, inSeason) : A;
  const figB = inSeason ? seasonRow(seasonsRead.rows, bId, inSeason) : B;
  const window = inSeason ? seasonWindow(inSeason) : WINDOW_ALL;
  const names = A && B ? `${A.name} and ${B.name}` : "";
  const bf = (r) => (r?.ballsFaced === undefined ? 0 : r.ballsFaced);

  return (
    <div data-testid="compare" data-mode={pupil ? "pupil" : "staff"} style={{ display: "grid", gap: T.space.md }}>
      <Panel title={pupil ? "Me v a team-mate" : "Compare two players"} testid="compare-head">
        <p style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>
          {pupil
            ? "Your figures beside one team-mate's, counted the same way. Nobody is ranked and nothing is kept."
            : "Two players' figures, counted the same way and set side by side. Nobody is ranked, nothing is scored, and nothing is kept."}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: T.space.sm }}>
          {pupil ? (
            <div style={{ display: "grid", gap: T.space.xs, minWidth: 0 }}>
              <span style={{ ...T.role.label, color: T.content.secondary }}>You</span>
              <span data-testid="compare-self" style={{ ...T.role.control, color: T.content.primary, minHeight: "44px", display: "flex", alignItems: "center", overflowWrap: "anywhere" }}>{self.name}</span>
            </div>
          ) : (
            <Picker id="compare-a" label="First player" value={aOk ? aId : ""} onChange={(v) => { setA(v); setSeason(""); }}
              players={offered} exclude={bId} testid="compare-pick-a"/>
          )}
          <Picker id="compare-b" label={pupil ? "A team-mate" : "Second player"} value={bId} onChange={(v) => { setB(v); setSeason(""); }}
            players={offered} exclude={aId} testid="compare-pick-b"/>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
          <span data-testid="compare-as-at" style={{ ...word(), fontSize: "13px" }}>
            {settled ? (asAtWords(asAt) ?? "Reading the figures…") : "Reading the figures…"}
          </span>
          <button type="button" data-testid="compare-reread" onClick={() => setNonce((n) => n + 1)} className="pressBtn os-state"
            style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, cursor: "pointer",
              background: "transparent", color: T.content.primary, border: `1px solid ${T.line.normal}`, ...T.role.control, fontSize: "15px" }}>
            Read again
          </button>
        </div>
        <ReadState compact read={careerSaid} onRetry={() => setNonce((n) => n + 1)} testId="compare-read-state"/>
        {careerSaid.state === "ok" && offered.length < (pupil ? 1 : 2) && (
          <p data-testid="compare-none" style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>
            {pupil ? "No team-mate on your side has a record you may open yet." : "There are not two players here whose figures you may open."}
          </p>
        )}
        {careerSaid.state === "ok" && !ready && offered.length >= (pupil ? 1 : 2) && (
          <p data-testid="compare-prompt" style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>
            {pupil ? "Choose a team-mate to see your figures side by side." : "Choose two players to see their figures side by side."}
          </p>
        )}
      </Panel>

      {ready && A && B && (
        <>
          {seasons.length > 0 && (
            <div role="group" aria-label="Which figures" data-testid="compare-window" style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap" }}>
              {[["", "Every season"], ...seasons.map((s) => [s, `${s} season`])].map(([v, l]) => (
                <button key={v || "all"} type="button" aria-pressed={inSeason === v} data-testid={`compare-season-${v || "all"}`}
                  onClick={() => setSeason(v)} className="pressBtn os-state"
                  style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, cursor: "pointer",
                    background: inSeason === v ? T.surface.interactive : "transparent", color: T.content.primary,
                    border: `1px solid ${inSeason === v ? T.line.strong : T.line.normal}`, ...T.role.control, fontSize: "15px",
                    fontWeight: inSeason === v ? 600 : 500 }}>
                  {l}
                </button>
              ))}
            </div>
          )}

          <Panel title="Batting" testid="compare-batting">
            <SourceLine testid="source-line-compare-batting" source={SRC_RECORD} scope={names} window={window}
              denominator={{ n: (bf(figA) ?? 0) + (bf(figB) ?? 0), unit: "ball faced", plural: "balls faced",
                detail: `${bf(figA) ?? "not recorded"} by ${A.name}, ${bf(figB) ?? "not recorded"} by ${B.name}` }}/>
            <Pair caption={`Batting, ${names}`} a={A} b={B} rows={battingRows(figA, figB)} testid="compare-bat"/>
            <FloorLine testid="compare-batting-floor" unit="balls faced"
              under={belowFloor([{ name: A.name, n: bf(figA) }, { name: B.name, n: bf(figB) }])}/>
          </Panel>

          <Panel title="Bowling" testid="compare-bowling">
            <SourceLine testid="source-line-compare-bowling" source={SRC_RECORD} scope={names} window={window}
              denominator={{ n: (figA?.ballsBowled ?? 0) + (figB?.ballsBowled ?? 0), unit: "legal ball bowled", plural: "legal balls bowled",
                detail: `${figA?.ballsBowled ?? 0} by ${A.name}, ${figB?.ballsBowled ?? 0} by ${B.name}` }}/>
            <Pair caption={`Bowling, ${names}`} a={A} b={B} rows={bowlingRows(figA, figB)} testid="compare-bowl"/>
            <FloorLine testid="compare-bowling-floor" unit="balls bowled"
              under={belowFloor([{ name: A.name, n: figA?.ballsBowled ?? 0 }, { name: B.name, n: figB?.ballsBowled ?? 0 }])}/>
          </Panel>

          <MatchupPanel A={A} B={B} names={names} mA={mA} mB={mB} cA={cA} cB={cB} onRetry={() => setNonce((n) => n + 1)}/>
        </>
      )}
    </div>
  );
}

/** Match-ups by bowling type (D7): pace and spin, the coverage said for each batter. */
function MatchupPanel({ A, B, names, mA, mB, cA, cB, onRetry }) {
  const said = readState({ ...mA, rows: [...mA.rows, ...mB.rows], loading: mA.loading || mB.loading, error: mA.error || mB.error,
    disabled: mA.disabled || mB.disabled, status: mA.status ?? mB.status }, { what: "the match-ups" });
  const rows = typeRows(mA.rows, mB.rows);
  const covA = cA.rows[0] ?? null, covB = cB.rows[0] ?? null;
  const attributed = (covA?.attributable ?? 0) + (covB?.attributable ?? 0);
  const deliveries = (covA?.deliveries ?? 0) + (covB?.deliveries ?? 0);
  const of = (name, c) => (c ? `${name}: ${c.attributable} of ${c.deliveries}` : `${name}: not read`);
  return (
    <Panel title="Against pace and spin" testid="compare-matchups">
      <SourceLine testid="source-line-compare-matchups" source={SRC_BALLS} scope={`${names}, by bowling type`} window={WINDOW_ALL}
        denominator={{ n: attributed, unit: "attributed ball", detail: `of ${deliveries} deliveries in the log` }}>
        {`Only the balls bowled by somebody with a record here have a bowling type to count against (${of(A.name, covA)}; ${of(B.name, covB)}). No bowler is named, and every season on record is counted.`}
      </SourceLine>
      {said.state === "ok" && rows.length > 0 ? (
        rows.map((t) => (
          <Pair key={t.type} caption={`${t.label}, ${names}`} a={A} b={B} testid={`compare-type-${t.type}`}
            rows={[
              { key: "balls", label: `${t.label}: balls`, a: t.a.balls, b: t.b.balls },
              { key: "runs", label: "Runs", a: t.a.runs, b: t.b.runs },
              { key: "out", label: "Times out", a: t.a.out, b: t.b.out },
              { key: "sr", label: "Strike rate", a: t.a.sr, b: t.b.sr },
            ]}/>
        ))
      ) : said.state === "ok" || said.state === "empty" ? (
        <p data-testid="compare-matchups-none" style={{ ...word(), fontSize: "13px", margin: 0 }}>
          Neither has faced a ball from a bowler with a record here yet, so there is no bowling type to count against.
        </p>
      ) : <ReadState compact read={said} onRetry={onRetry} testId="compare-matchups-read-state"/>}
    </Panel>
  );
}
