import { useMemo } from "react";
import { T, contrast } from "../design/tokens.js";
import { chipFill, chipFor } from "../ui/board.jsx";
import { oversOf } from "../lib/matchCentre.js";
import { bowlingPanel, breakPanel, fallOfWicket, overRows, partnershipPanel, pretossPanel, resultPanel, stoppedPanel } from "./data.js";

/**
 * The ground display's panels (SCRBRD-133 §2.2): 2 the partnership, 3 the over
 * story (static rows, §6.2's display form), 4 bowling, 7 the fall of a wicket
 * (an interrupt), 8 the innings break, 9 the result, 10 stopped, 11 before the
 * toss. 1, 5 and 6 (the worm, runs per over, where the runs went) are G2's
 * and G3's.
 *
 * Drawn in the board's own colours (the display's CSS variables: Daylight
 * lifts the dim one, D14), every size max(floor, vmin) from DisplayView's
 * sheet, nothing pressed. Every figure and label comes from display/data.js;
 * nothing here names anybody the innings did not.
 */

const nth = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** A row of the board's chips: each its figure or word, and said once for the row. */
export function Chips({ marks, label }) {
  if (!marks?.length) return null;
  return (
    <span className="dv-chips">
      <span className="sr-only">{label ? `${label}: ` : ""}{marks.map((m) => chipFor(m).say).join(", ")}</span>
      {marks.map((m, i) => {
        const c = chipFor(m);
        const fill = chipFill(c.kind);
        // The board's black or white, whichever reads on the chip (as the Board's own chips).
        const ink = fill ? (contrast(fill, T.board.face) >= contrast(fill, T.board.figure) ? T.board.face : T.board.figure) : undefined;
        return <span key={i} aria-hidden="true" className="dv-chip" data-chip={c.kind} data-shape={c.kind === "extra" ? "square" : "round"}
          style={fill ? { background: fill, color: ink } : undefined}>{c.text}</span>;
      })}
    </span>
  );
}

/** A share of a whole as a bar, with its words beside it (colour is never alone). */
const Bar = ({ of, value }) => (
  <span className="dv-bar" aria-hidden="true"><span style={{ width: `${of > 0 ? Math.max(2, Math.round((value / of) * 100)) : 0}%` }}/></span>
);

function Partnership({ inn }) {
  const p = partnershipPanel(inn);
  if (!p) return null;
  const most = Math.max(1, ...p.batters.map((b) => b.runs));
  const best = Math.max(1, p.runs, ...p.earlier.map((e) => e.runs));
  return (
    <section data-testid="display-panel-partnership" aria-label="Partnership">
      <h2 className="dv-title">Partnership · {nth(p.wicket)} wicket · <span className="dv-fig">{p.runs} ({p.balls})</span></h2>
      <div className="dv-grid2">
        {p.batters.map((b) => (
          <div key={b.id} className="dv-share dv-text">
            <span className="dv-name">{b.name}</span>
            <Bar of={most} value={b.runs}/>
            <span className="dv-fig">{b.runs} ({b.balls})</span>
          </div>
        ))}
      </div>
      <p className="dv-small dv-dim">Extras {p.extras} · run rate {p.rate}</p>
      {p.earlier.length > 0 && (
        <ol className="dv-list dv-small">
          {p.earlier.slice(-4).map((e) => (
            <li key={e.wicket} className="dv-share">
              <span className="dv-dim">{nth(e.wicket)}</span>
              <Bar of={best} value={e.runs}/>
              <span className="dv-fig">{e.runs} ({e.balls})</span>
              <span className="dv-dim dv-name">{e.names}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function OverStory({ inn, events, fold, n }) {
  // The score after each over is the fold's own, re-folded to that over's end:
  // done once per read, not once per paint.
  const rows = useMemo(() => overRows(inn, { events, fold, n }), [inn, events, fold, n]);
  if (!rows.length) return null;
  return (
    <section data-testid="display-panel-overs" aria-label="Over story">
      <h2 className="dv-title">Over story</h2>
      <ol className="dv-list">
        {rows.map((r, i) => (
          <li key={r.over} className="dv-over dv-text" data-lit={i === 0 ? "true" : undefined}>
            <span className="dv-fig dv-over-no">{r.over}</span>
            <span className="dv-name">{r.bowler}</span>
            <Chips marks={r.chips} label={`Over ${r.over}`}/>
            <span className="dv-fig">{r.figure}</span>
            {r.score && <span className="dv-fig dv-score">{r.score}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Bowling({ inn }) {
  const b = bowlingPanel(inn);
  if (!b) return null;
  return (
    <section data-testid="display-panel-bowling" aria-label="Bowling">
      <h2 className="dv-title">Bowling</h2>
      <p className="dv-text" style={{ margin: 0 }}>
        <span className="dv-name">{b.on.name}</span> <span className="dv-fig">{b.on.wickets}/{b.on.runs} ({b.on.overs})</span>
        <span className="dv-dim"> · economy {b.on.economy}</span>
      </p>
      {b.his.length > 0 && (
        <ol className="dv-list">
          {b.his.map((o) => (
            <li key={o.over} className="dv-over dv-text"><span className="dv-fig dv-over-no">{o.over}</span><Chips marks={o.chips} label={`Over ${o.over}`}/></li>
          ))}
        </ol>
      )}
      {b.others.length > 0 && (
        <table className="dv-table dv-small">
          <thead><tr><th scope="col">Bowler</th><th scope="col">O</th><th scope="col">M</th><th scope="col">R</th><th scope="col">W</th><th scope="col">Econ</th></tr></thead>
          <tbody>
            {b.others.map((x) => (
              <tr key={x.id}><th scope="row">{x.name}</th><td>{x.overs}</td><td>{x.maidens}</td><td>{x.runs}</td><td>{x.wickets}</td><td>{x.economy}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function FallOfWicket({ inn, commentary, n }) {
  const f = fallOfWicket(inn);
  if (!f) return null;
  // The wicket's own line from the shared generator — on /display the public
  // projection's words, the shot and where it went included (db/78) — its
  // first sentence: the rest is the figures drawn below it.
  const said = [...(commentary ?? [])].reverse().find((c) => c.kind === "wicket" && c.innings === n)?.text?.split(/(?<=\.)\s+/)[0] ?? null;
  return (
    <section data-testid="display-panel-fow" aria-label="Fall of wicket">
      <h2 className="dv-title">Fall of wicket · {nth(f.wicket)}</h2>
      {said && <p className="dv-text" data-testid="display-fow-line" style={{ margin: 0 }}>{said}</p>}
      <p className="dv-sub" style={{ margin: 0 }}>
        <span className="dv-name">{f.batter.name}</span>{f.batter.runs != null && <span className="dv-fig"> {f.batter.runs} ({f.batter.balls})</span>}
      </p>
      {f.batter.how && <p className="dv-text" style={{ margin: 0 }}>{f.batter.how}</p>}
      <p className="dv-text dv-dim" style={{ margin: 0 }}>Score at the fall <span className="dv-fig">{f.score}</span> ({f.overs} ov)</p>
      {f.stand && <p className="dv-small dv-dim" style={{ margin: 0 }}>The stand: <span className="dv-fig">{f.stand.runs} ({f.stand.balls})</span>, {f.stand.names}</p>}
      {f.next && <p className="dv-text" style={{ margin: 0 }}>In: <span className="dv-name">{f.next}</span></p>}
    </section>
  );
}

function InningsBreak({ match, played }) {
  const b = breakPanel(match, played);
  if (!b) return null;
  const Fact = ({ label, children, testid }) => (
    <div data-testid={testid} className="dv-fact"><span className="dv-title">{label}</span><div className="dv-small">{children}</div></div>
  );
  const Row = ({ name, fig }) => <div className="dv-factrow"><span className="dv-name">{name}</span><span className="dv-fig">{fig}</span></div>;
  return (
    <section data-testid="display-panel-break" aria-label="Innings break">
      <h2 className="dv-title">Innings break · {b.line}</h2>
      <p className="dv-sub" style={{ margin: `0 0 max(6px, 1.2vmin)` }}>{b.words}</p>
      <div className="dv-grid2">
        <Fact label="Top scorers" testid="display-break-top">
          {b.facts.topScorers.length ? b.facts.topScorers.map((x) => <Row key={x.id} name={x.name} fig={`${x.runs}${x.status === "batting" ? "*" : ""} (${x.balls})`}/>) : "Nobody scored."}
        </Fact>
        <Fact label="Best bowling" testid="display-break-bowling">
          {b.facts.bestBowling.length ? b.facts.bestBowling.map((x) => <Row key={x.id} name={x.name} fig={`${x.wickets}/${x.runs} (${oversOf(x.balls)})`}/>) : "No bowler on record."}
        </Fact>
        <Fact label="Most boundaries" testid="display-break-boundaries">
          {b.facts.boundaries ? <Row name={b.facts.boundaries.name} fig={`${b.facts.boundaries.fours} × 4, ${b.facts.boundaries.sixes} × 6`}/> : "No boundaries."}
        </Fact>
        <Fact label="Best strike rate" testid="display-break-sr">
          {b.facts.strikeRate ? <Row name={b.facts.strikeRate.name} fig={`${b.facts.strikeRate.sr.toFixed(1)} (${b.facts.strikeRate.runs} off ${b.facts.strikeRate.balls})`}/> : "Nobody faced ten balls."}
        </Fact>
      </div>
    </section>
  );
}

function Result({ match, played, words }) {
  const r = resultPanel(match, played, words);
  return (
    <section data-testid="display-panel-result" aria-label="Result">
      <h2 className="dv-title">Result</h2>
      {r.words && <p className="dv-sub" data-testid="display-result-words" style={{ margin: `0 0 max(6px, 1.2vmin)` }}>{r.words}</p>}
      <ul className="dv-list dv-text">{r.lines.map((l) => <li key={l} className="dv-fig">{l}</li>)}</ul>
      {r.superOvers.map((s) => (
        <div key={s.title} className="dv-small"><span className="dv-title">{s.title}</span>{s.lines.map((l) => <div key={l} className="dv-fig">{l}</div>)}</div>
      ))}
    </section>
  );
}

function Stopped({ inn }) {
  const s = stoppedPanel(inn);
  if (!s) return null;
  return (
    <section data-testid="display-panel-stopped" aria-label="Play stopped">
      <h2 className="dv-title">Play stopped</h2>
      <p className="dv-sub" style={{ margin: 0 }}>{s.words}</p>
      {s.revised && <p className="dv-text" style={{ margin: 0 }}>{s.revised}</p>}
    </section>
  );
}

function PreToss({ match }) {
  const p = pretossPanel(match);
  return (
    <section data-testid="display-panel-pretoss" aria-label="Before the toss">
      <h2 className="dv-title">Before the toss</h2>
      <p className="dv-sub" style={{ margin: `0 0 max(6px, 1.2vmin)` }}>{p.sides}</p>
      <dl className="dv-dl dv-text">
        {p.rows.map(([k, v]) => <div key={k}><dt className="dv-dim">{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <p className="dv-small dv-dim">The board opens with the first ball.</p>
    </section>
  );
}

/**
 * One panel, by id.
 * @param {{panel: string | null, match: any, played: any[], inn: any, index: number, events: any[], fold: any, result: string | null, commentary: any[]}} p
 */
export function DisplayPanel({ panel, match, played, inn, index, events, fold, result, commentary }) {
  switch (panel) {
    case "partnership": return <Partnership inn={inn}/>;
    case "overs": return <OverStory inn={inn} events={events} fold={fold} n={index}/>;
    case "bowling": return <Bowling inn={inn}/>;
    case "fow": return <FallOfWicket inn={inn} commentary={commentary} n={index}/>;
    case "break": return <InningsBreak match={match} played={played}/>;
    case "result": return <Result match={match} played={played} words={result}/>;
    case "stopped": return <Stopped inn={inn}/>;
    case "pretoss": return <PreToss match={match}/>;
    default: return null;
  }
}
