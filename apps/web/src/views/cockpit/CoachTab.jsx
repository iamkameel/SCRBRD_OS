import { useMemo, useRef, useState } from "react";
import { T } from "../../design/tokens.js";
import { bowlingLimit } from "@scrbrd/scoring";
import { boardInnings, sidesOf, teamOf } from "../../lib/matchCentre.js";
import { bandLine, bandOfTeam, bowlerRows, matchupTypes, matchupWords, notYetBowled, overStory, pitchWords, sheetOf } from "../../lib/captain.js";
import {
  LOAD_SENTENCE, busOf, limitWords, liftCounts, ourInnings, shortDate, sideFoot, sideRows, spellLines, weatherWords, weekRows, weekWords,
} from "../../lib/cockpit.js";
import { MATCHUP_FLOOR } from "../../lib/signals.js";
import { humanDateTime } from "../../lib/format.js";
import { Board } from "../../ui/board.jsx";
import { atThisRate, boardFromInnings } from "../../scorer/boardData.js";
import { bowlerCapWords, conditionsWords } from "../../scorer/conditionsLine.jsx";
import { ShotWheel } from "../../scorer/charts.jsx";
import { Panel, Quiet } from "../matchcentre/bits.jsx";
import { OppositionDossier } from "../dossier.jsx";
import { FeedDrawer } from "./FeedDrawer.jsx";
import { useCockpit, useFeed } from "./useCockpit.js";

/**
 * THE COACH TAB (SCRBRD-136 phase A; docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md
 * §3): the Match Centre for the coach, in the order of his Saturday.
 *
 * ONE TAB, DRAWN BY WHAT THE MATCH HAS. Before the first ball: the day, the
 * side, our bowlers' week, the opposition while its window is open (P1 to P4).
 * While it is played: the Board, our bowlers with the cap's own words, the
 * over strip and the phases, and where the runs went (P5 to P8). After it:
 * the spells as the log recorded them, and our batters against pace and
 * spin (P9).
 *
 * EVERY PANEL CHECKS ITS OWN CAPABILITY (`staff.panels`, from lib/cockpit.js
 * cockpitGate), never a job title: an assistant coach sees what the head coach
 * sees but the selection; a team manager sees the side and the bus and no load;
 * a physio sees the load and no selection. The server's reads decide what
 * comes back; a panel the grant does not reach is not drawn.
 *
 * WHAT IT NEVER DRAWS (§3.7): the nature of an injury, or any reason an absence
 * was given (D4: restricted, and back on a date, is the status tier); a
 * wellness check-in, flag or dot (D5); a guideline's basis (D6); the ratio
 * behind a load word (D7: the word, and one fixed sentence); a win chance, a
 * pressure number, a threat level; another school's child beyond the
 * dossier's own window; and, from a lift, only a head count (D10).
 */

/** @param {{label: string, children: any, testid: string, wide?: boolean}} p */
function Part({ label, children, testid, wide = false }) {
  return (
    <div style={wide ? { gridColumn: "1 / -1", minWidth: 0 } : { minWidth: 0 }}>
      <Panel testid={testid}>
        <div style={{ padding: `${T.space.md} ${T.space.lg}`, display: "grid", gap: T.space.sm }}>
          <h2 style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>{label}</h2>
          {children}
        </div>
      </Panel>
    </div>
  );
}

const body = () => ({ ...T.role.body, color: T.content.primary, margin: 0 });
const quiet = () => ({ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0 });
const fig = () => ({ ...T.role.figure.sm, fontSize: "14px", color: T.content.primary });
const btn = () => ({ minHeight: "44px", padding: `0 ${T.space.lg}`, background: "transparent", color: T.content.primary,
  border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 });

/** A panel's line when its read did not answer: said, never a blank that reads as "nothing". */
const Unread = ({ what }) => <p style={quiet()}>{what} could not be read just now. That is not the same as there being nothing.</p>;

export function CoachTab({ match, role, innings, result, commentary, overs, phone, staff, terms, shownRuns, venueLine, eventCount, initialDrawer = false }) {
  const gate = staff;
  const panels = gate.panels;
  const sides = sidesOf(match);
  const cockpit = useCockpit({ match, gate, lifts: true, matchups: true, seen: eventCount });
  const { reads, loading } = cockpit;
  const played = innings.length > 0;
  const decided = match.status === "complete" || !!result;

  // Our side, from the sheet the read gave.
  const sheet = useMemo(() => sheetOf(reads.squad ?? [], gate.end), [reads.squad, gate.end]);
  const oursIds = useMemo(() => new Set(sheet.map((r) => r.playerId)), [sheet]);
  const mine = useMemo(() => ourInnings(match, gate.end, innings, oursIds), [match, gate.end, innings, oursIds]);
  const termsNow = terms ?? reads.terms ?? null;
  const capFor = useMemo(() => (termsNow ? (/** @type {number} */ balls) => bowlerCapWords(termsNow, balls) : null), [termsNow]);
  const fielding = useMemo(() => mine.filter((x) => x.side === "bowling").map(({ inn, i }) => ({ inn, i, inPlay: !decided && !inn.complete })), [mine, decided]);
  const feed = useFeed({ match, gate, cockpit, fielding, capFor });

  const [drawer, setDrawer] = useState(initialDrawer);
  const opener = useRef(null);
  const [dossier, setDossier] = useState(false);

  const label = `Coach · ${phone ? sides[gate.end].short : sides[gate.end].full}`;
  const cols = phone ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))";

  return (
    <section data-testid="mc-coach" aria-label="Coach" style={{ display: "grid", gap: T.space.lg }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: T.space.md, flexWrap: "wrap" }}>
        <p data-testid="mc-coach-label" style={{ ...T.role.label, color: T.brand.accentText, margin: 0 }}>{label}</p>
        <button type="button" ref={opener} data-testid="coach-signals-open" className="os-state" onClick={() => setDrawer(true)} style={btn()}>
          Signals ({loading ? "…" : feed.open.length})
        </button>
      </div>

      {loading && <Quiet testid="mc-coach-loading">Reading the day…</Quiet>}

      <div style={{ display: "grid", gridTemplateColumns: cols, gap: T.space.lg, alignItems: "start" }}>
        {!loading && !played && (
          <>
            {panels.day && <TheDay match={match} gate={gate} reads={reads} terms={termsNow} sheet={sheet} sides={sides}/>}
            {panels.side && <TheSide reads={reads} gate={gate}/>}
            {panels.load && <TheWeek reads={reads} sheet={sheet}/>}
            {panels.opposition && reads.opposition && (
              <Part label={`${reads.opposition.theirLabel ?? "The opposition"} · dossier`} testid="coach-opposition">
                <p style={body()}>{reads.opposition.open
                  ? `Open until ${reads.opposition.closesAt ? humanDateTime(String(reads.opposition.closesAt).slice(0, 10), String(reads.opposition.closesAt).slice(11, 16)) : "the first ball"}.`
                  : reads.opposition.reason === "not_yet_open" ? "The dossier has not opened yet." : "The dossier is not open for this fixture."}</p>
                {reads.opposition.open && (
                  <button type="button" data-testid="coach-dossier-open" className="os-state" onClick={() => setDossier(true)} style={{ ...btn(), justifySelf: "start" }}>Open the dossier</button>
                )}
              </Part>
            )}
          </>
        )}

        {!loading && played && (
          <DuringAndAfter match={match} gate={gate} innings={innings} overs={overs} result={result} commentary={commentary} phone={phone}
            decided={decided} fielding={fielding} sheet={sheet} oursIds={oursIds} reads={reads} capFor={capFor}
            shownRuns={shownRuns} venueLine={venueLine}/>
        )}
      </div>

      {!loading && !played && panels.matchups && reads.matchups && <Matchups reads={reads} sheet={sheet}/>}

      {drawer && (
        <FeedDrawer feed={feed} gate={gate} onClose={() => { setDrawer(false); opener.current?.focus(); }}/>
      )}
      {dossier && <OppositionDossier match={match} role={role} onClose={() => setDossier(false)}/>}
    </section>
  );
}

// ── P1 · The day ───────────────────────────────────────

function TheDay({ match, gate, reads, terms, sheet, sides }) {
  const p = gate.panels;
  const words = [match.overs ? `${match.overs} overs` : null, ...conditionsWords(terms)].filter(Boolean);
  const band = bandOfTeam(gate.teamCode);
  const directive = (reads.directives ?? []).find((d) => d.ageBand === band) ?? null;
  const band_ = bandLine(band ? bowlingLimit(terms?.conditions, band) : null, directive, band);
  const bus = p.bus ? busOf(reads.trips, gate.school) : null;
  const named = sheet.length;
  const lifts = p.lifts && reads.lifts != null ? liftCounts(reads.lifts, Date.now()) : null;
  const umpires = (reads.officials ?? []).filter((o) => o.duty === "umpire").map((o) => o.name);
  const scorerOnRecord = (reads.duties ?? []).some((d) => d.duty === "scorer");
  const pitch = pitchWords(reads.pitch);
  const weather = weatherWords(reads.weather);
  return (
    <Part label={`The day · ${humanDateTime(match.date, match.time)}`} testid="coach-day">
      <p style={body()}>{sides.home.full} v {sides.away.full}</p>
      {words.length > 0 && <p data-testid="coach-day-conditions" style={body()}>{words.join(" · ")}</p>}
      {band_ && <p data-testid="coach-day-band" style={body()}>{band_}{directive?.clauseCode ? ` · ${directive.clauseCode}` : ""}</p>}
      {pitch && <p style={quiet()}>Pitch: {pitch}</p>}
      {weather && <p style={quiet()}>Weather: {weather}</p>}
      <p style={quiet()}>Umpires: {umpires.length ? umpires.join(", ") : "none on record"}{scorerOnRecord ? "" : " · no scorer on record"}</p>
      {p.bus && (reads.trips == null ? <Unread what="The bus"/>
        : bus ? (
          <p data-testid="coach-day-bus" style={body()}>
            Bus{bus.departAt ? ` ${String(bus.departAt).slice(11, 16)}` : ""}{bus.pickup ? ` ${bus.pickup}` : ""} · {bus.capacity} seats · {named} named
            {lifts && lifts.count > 0 ? ` · ${lifts.count} arriving by lift` : ""}
          </p>)
        : <p data-testid="coach-day-bus" style={quiet()}>No bus is arranged for this fixture.</p>)}
    </Part>
  );
}

// ── P2 · The side ──────────────────────────────────────

function TheSide({ reads, gate }) {
  if (reads.readiness == null) return <Part label="The side" testid="coach-side"><Unread what="The side"/></Part>;
  const rows = sideRows(reads.readiness, gate.end, gate.panels);
  return (
    <Part label="The side" testid="coach-side">
      {rows.length === 0 ? <p style={quiet()}>No sheet has been published for this fixture.</p> : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "2px" }}>
          {rows.map((r) => (
            <li key={r.id} data-testid={`coach-side-${r.id}`} data-state={r.state} style={{ ...body(), display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
              <span style={fig()}>{r.battingNo ?? "·"}</span>
              <span>{r.name}</span>
              <span style={{ fontWeight: 600 }}>{r.words}</span>
              {r.back && <span style={quiet()}>back {shortDate(r.back)}</span>}
              {r.byWhom && <span style={quiet()}>{r.byWhom}</span>}
            </li>
          ))}
        </ol>
      )}
      <p data-testid="coach-side-foot" style={quiet()}>{sideFoot(rows)}</p>
    </Part>
  );
}

// ── P3 · Our bowlers this week ─────────────────────────

function TheWeek({ reads, sheet }) {
  if (reads.workload == null) return <Part label="Our bowlers this week" testid="coach-week"><Unread what="The week's load"/></Part>;
  const onSheet = sheet.length ? new Set(sheet.map((r) => r.playerId)) : null;
  const rows = weekRows(reads.workload, onSheet);
  return (
    <Part label="Our bowlers this week" testid="coach-week">
      {rows.length === 0 ? <p style={quiet()}>No pace bowler to show.</p> : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "2px" }}>
          {rows.map((r) => (
            <li key={r.id} data-testid={`coach-week-${r.id}`} style={{ ...body(), display: "flex", justifyContent: "space-between", gap: T.space.sm, flexWrap: "wrap" }}>
              <span>{r.name}</span>
              <span style={fig()}>{weekWords(r)}</span>
              {limitWords(r) && <span style={{ ...quiet(), flexBasis: "100%" }}>{limitWords(r)}{r.clause ? ` · ${r.clause}` : ""}</span>}
            </li>
          ))}
        </ul>
      )}
      <p data-testid="coach-week-sentence" style={quiet()}>{LOAD_SENTENCE}</p>
    </Part>
  );
}

// ── S5 / P9 · Our batters against pace and spin ────────

function Matchups({ reads, sheet }) {
  const rows = sheet.filter((r) => !r.twelfth).flatMap((r) => {
    const m = reads.matchups?.[r.playerId];
    return m ? matchupTypes(m.rows).filter((t) => t.balls >= MATCHUP_FLOOR).map((t) => ({ r, t, cov: m.coverage })) : [];
  });
  if (!rows.length) return null;
  return (
    <Part label="Our batters against pace and spin" testid="coach-matchups" wide>
      {rows.map(({ r, t, cov }) => (
        <p key={`${r.playerId}-${t.type}`} style={body()}>
          {r.name} v {t.type}: {matchupWords(t)}
          {cov && cov.deliveries > 0 ? <span style={quiet()}> · {cov.attributable} of {cov.deliveries} balls attributable</span> : null}
        </p>
      ))}
      <p style={quiet()}>A type is shown only when thirty balls stand behind it.</p>
    </Part>
  );
}

// ── P5 to P9 · During the match, and after ─────────────

function DuringAndAfter({ match, gate, innings, overs, result, commentary, phone, decided, fielding, sheet, oursIds, reads, capFor, shownRuns, venueLine }) {
  const { index } = boardInnings(innings, result ? {} : null);
  const inn = innings[index];
  const chase = innings.length >= 2 && inn === innings[1];
  const target = chase ? (innings[1].target ?? innings[0].runs + 1) : null;
  const inOvers = inn.overs ?? overs;
  const projected = decided ? null : atThisRate(inn, { overs: inOvers, chasing: chase, format: match.format });
  const props = boardFromInnings(inn, { target, overs: inOvers, projected });
  const side = teamOf(match, inn.battingTeam);
  const p = gate.panels;
  const [shot, setShot] = useState("all");
  const shots = (fieldInn) => [...new Set((fieldInn.ballLog ?? []).map((b) => b.shot).filter(Boolean))].sort();
  const spells = reads.spells ?? [];
  const phases = reads.phases ?? [];

  return (
    <>
      {props && (
        <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
          <Board {...props} total={shownRuns ?? props.total} team={phone ? side.short : side.full} size="card" testid="coach-board"/>
          {venueLine?.words && !decided && <p data-testid="coach-par" style={{ ...quiet(), marginTop: T.space.sm }}>{venueLine.words}</p>}
        </div>
      )}

      {fielding.map(({ inn: f, i, inPlay }) => {
        const rows = bowlerRows(f, capFor ?? (() => null), inPlay);
        if (!rows.length) return null;
        const rest = notYetBowled(sheet, f.bowlers);
        return (
          <Part key={`bowl-${i}`} label={decided ? "Our bowlers" : "Our bowlers · overs left"} testid="coach-bowlers">
            {rows.map((b) => {
              const open = p.load && inPlay && f.bowler === b.id
                ? spells.filter((s) => s.bowlerId === b.id && s.innings === i).sort((x, y) => y.spellNo - x.spellNo)[0] : null;
              return (
                <div key={b.id} data-testid={`coach-bowler-${b.id}`} style={{ display: "flex", justifyContent: "space-between", gap: T.space.md, flexWrap: "wrap" }}>
                  <span style={body()}>{b.name}</span>
                  <span style={fig()}>{b.figures}</span>
                  {b.words && <span data-testid={`coach-cap-${b.id}`} style={{ ...body(), fontWeight: 600, flexBasis: "100%" }}>{b.words}</span>}
                  {open && open.pace === true && open.maxSpell != null && (
                    <span data-testid={`coach-spell-${b.id}`} style={{ ...quiet(), flexBasis: "100%" }}>
                      spell {open.overs} of {open.maxSpell} ({open.ageBand ? `${open.ageBand} ` : ""}directive)
                    </span>
                  )}
                </div>
              );
            })}
            {inPlay && rest.length > 0 && <p style={quiet()}>Not yet bowled: {rest.map((r) => r.name).join(", ")}</p>}
          </Part>
        );
      })}

      {(decided ? innings.map((_, k) => k).filter((k) => innings[k]?.superOver == null) : [index]).map((k) => {
        const story = overStory(commentary, k, decided ? null : 2);
        if (!story.length) return null;
        return (
          <Part key={`story-${k}`} label={decided ? `Over story · ${teamOf(match, innings[k].battingTeam).short}` : "Over story · last two"} testid="coach-story">
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "2px" }}>
              {story.map((o) => <li key={o.key} style={{ ...body(), fontSize: "14px" }}><span style={fig()}>{o.over}</span> {o.text}</li>)}
            </ol>
          </Part>
        );
      })}

      {phases.length > 0 && (
        <Part label="Phases" testid="coach-phases">
          {phases.map((row) => (
            <div key={row.innings} style={{ display: "grid", gap: "2px" }}>
              {phases.length > 1 && <span style={quiet()}>Innings {row.innings + 1}</span>}
              {["powerplay", "middle", "death"].map((k) => row.phases?.[k]).filter((ph) => ph && ph.played && ph.balls > 0).map((ph) => (
                <span key={ph.name} data-testid={`coach-phase-${ph.name}`} style={body()}>
                  {ph.label} {ph.overs} · {ph.runs}/{ph.wickets}{ph.runRate != null ? ` · RR ${ph.runRate.toFixed(1)}` : ""}
                </span>
              ))}
            </div>
          ))}
        </Part>
      )}

      {fielding.filter((x) => x.inn.ballLog?.length).map(({ inn: o, i }) => {
        const kinds = shots(o);
        const pick = kinds.includes(shot) ? shot : "all";
        const shown = pick === "all" ? o : { ...o, ballLog: o.ballLog.filter((b) => b.shot === pick) };
        return (
          <div key={`wheel-${i}`} data-testid="coach-wheel" style={{ gridColumn: "1 / -1", minWidth: 0, display: "grid", gap: T.space.sm }}>
            {kinds.length > 0 && (
              <div role="group" aria-label="Filter the wheel by shot" style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap" }}>
                {["all", ...kinds].map((k) => (
                  <button key={k} type="button" aria-pressed={pick === k} data-testid={`coach-wheel-${k}`} className="os-state" onClick={() => setShot(k)}
                    style={{ ...btn(), background: pick === k ? T.surface.interactive : "transparent" }}>{k === "all" ? "All shots" : k}</button>
                ))}
              </div>
            )}
            <ShotWheel inn={shown} playerId={null} title="Where they have scored"/>
          </div>
        );
      })}

      {decided && p.load && (() => {
        const lines = spellLines(reads.spells, oursIds);
        return lines.length > 0 ? (
          <Part label="Spells, as the log recorded them" testid="coach-spells">
            {lines.map((l) => <p key={l.key} style={body()}>{l.text}.</p>)}
          </Part>
        ) : null;
      })()}

      {decided && p.matchups && <Matchups reads={reads} sheet={sheet}/>}
    </>
  );
}
