/**
 * Matches — one child's side's fixtures (step 4 P2, S2), the fixture (P3,
 * S3's fixture) and the match (P4).
 *
 * One list, upcoming then played, each row carrying HIS answer or HIS line
 * (§2.1 P2). An upcoming row opens the fixture, where the answer is given
 * beside the bus time; a played row opens the Match Centre in family mode
 * (G13): his rows lit, the Analytics tab offering only him.
 *
 * §5 G7: his line on a played row is folded from that match's own log, one
 * read per match, kept for the page's life (useFold.js).
 */
import { useState } from "react";
import { T } from "../../design/tokens.js";
import { useLive } from "../../lib/live.js";
import { humanDate } from "../../lib/format.js";
import { resultText } from "../../lib/matchCentre.js";
import { fixturesOf, lineFor, opponentOf, endOf } from "../../lib/family.js";
import { MatchView } from "../matchcentre/MatchView.jsx";
import { Icon } from "../../ui/icons.jsx";
import { AvailabilityBlock, Back, BusCard, Card, Line, OpenRow, StateChip, TeamSheetLine, Title, WeatherLine, whenOf } from "./parts.jsx";
import { useFold } from "./useFold.js";
// SCRBRD-124 (db/70): lifts to this fixture, where a family or a pupil asks for a seat.
import { FixtureLifts } from "../lifts.jsx";

const now = () => Date.now();

/** An upcoming row: when, who, home or away — and his answer, as a word. */
function UpcomingRow({ m, child, role, onOpen }) {
  const { rows } = useLive("availability", role, 0, { matchId: m.id });
  const row = rows.find((r) => r.playerId === child.id) ?? null;
  return (
    <OpenRow onClick={() => onOpen(m)} testid={`fixture-row-${m.id}`}
      aside={<StateChip status={row?.status ?? null} testid={`fixture-chip-${m.id}`}/>}>
      <span style={{ ...T.role.body, fontWeight: 600, color: T.content.primary }}>v {opponentOf(m, child)} ({endOf(m, child)})</span>
      <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{whenOf(m)}</span>
    </OpenRow>
  );
}

/** A played row: the result and HIS line, folded from that match's log. */
function PlayedRow({ m, child, onOpen, self }) {
  const fold = useFold(m);
  const line = lineFor(fold.innings, child.id);
  const result = resultText(m, fold.result);
  return (
    <OpenRow onClick={() => onOpen(m)} testid={`played-row-${m.id}`}>
      <span style={{ ...T.role.body, fontWeight: 600, color: T.content.primary }}>{humanDate(m.date)} · v {opponentOf(m, child)}</span>
      {result && <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{result}</span>}
      {line && <span data-testid={`played-line-${m.id}`} style={{ ...T.role.figure.sm, color: T.content.primary }}>{self ? `You: ${line}` : line}</span>}
    </OpenRow>
  );
}

/**
 * The list for one child. `child` is the one the screen is about — a
 * guardian's chosen child, or the pupil himself — and `head` what sits above
 * the list (the switcher).
 */
export function ChildMatches({ child, role, self = false, head = null }) {
  const { rows: matches, loading, error } = useLive("matches", role);
  const [open, setOpen] = useState(null);
  if (open?.kind === "fixture") return <FixtureDetail match={open.match} child={child} role={role} self={self} onBack={() => setOpen(null)}/>;
  if (open?.kind === "match") return <MatchFor match={open.match} child={child} role={role} self={self} matches={matches} onBack={() => setOpen(null)}/>;
  const { live, upcoming, played } = fixturesOf(matches, child, now());
  const name = child.knownAs || child.name;
  return (
    <>
      {head}
      <Title testid="matches-title">Matches · {self ? "your side" : name}</Title>
      <Line quiet>{[child.schoolName, child.team].filter(Boolean).join(" · ")}</Line>
      {loading && !matches.length ? <Line quiet>Reading the fixture list…</Line>
        : error ? <Line quiet>Could not load the fixtures just now.</Line> : null}
      {live.length > 0 && (
        <Card label="Live now" testid="matches-live">
          {live.map((m) => (
            <OpenRow key={m.id} onClick={() => setOpen({ kind: "match", match: m })} testid={`live-row-${m.id}`}>
              <span style={{ ...T.role.body, fontWeight: 600 }}>v {opponentOf(m, child)}</span>
            </OpenRow>
          ))}
        </Card>
      )}
      <Card label="Coming up" testid="matches-upcoming">
        {upcoming.length ? upcoming.map((m) => (
          <UpcomingRow key={m.id} m={m} child={child} role={role} onOpen={(x) => setOpen({ kind: "fixture", match: x })}/>
        )) : !loading && <Line quiet>{self ? "Nothing arranged for your side yet." : `Nothing arranged for ${name}'s side yet.`}</Line>}
      </Card>
      {played.length > 0 && (
        <Card label="Played" testid="matches-played">
          {played.map((m) => <PlayedRow key={m.id} m={m} child={child} self={self} onOpen={(x) => setOpen({ kind: "match", match: x })}/>)}
        </Card>
      )}
    </>
  );
}

/**
 * The umpires appointed to a fixture: adults, named (§2.1 P3). The umpiring
 * duties only — a scorer can be a pupil, and a pupil is not named here.
 */
const UMPIRING = new Set(["umpire", "third_umpire", "referee"]);
function Umpires({ match, role }) {
  const { rows } = useLive("officials", role, 0, { matchId: match.id });
  const ump = rows.filter((o) => o.matchId === match.id && UMPIRING.has(o.duty));
  if (!ump.length) return null;
  return <Line quiet testid="fixture-officials">Umpires: {ump.map((o) => o.name).filter(Boolean).join(", ") || "appointed"}</Line>;
}

/**
 * P3 · Fixture — where, when, how, and the declaration. The answer is given
 * here, beside the bus time (§2.1: "the declaration belongs beside it").
 */
export function FixtureDetail({ match, child, role, self = false, onBack }) {
  const name = child.knownAs || child.name;
  const maps = match.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(match.venue)}` : null;
  return (
    <>
      <Back onClick={onBack}>Matches</Back>
      <header style={{ display: "grid", gap: T.space.xs }} data-testid="fixture-detail" data-match={match.id}>
        <span style={{ ...T.role.label, color: T.content.secondary }}>{whenOf(match)}</span>
        <Title testid="fixture-title">v {opponentOf(match, child)} ({endOf(match, child)})</Title>
        <Line quiet testid="fixture-line">
          {[match.time ? `${match.time} start` : null, match.overs ? `${match.overs} overs` : null, match.format].filter(Boolean).join(" · ")}
        </Line>
        {match.venue && (
          <Line>
            <Icon name="map-pin"/> {match.venue}
            {maps && <> · <a href={maps} target="_blank" rel="noreferrer" style={{ color: T.content.primary }}>map</a></>}
          </Line>
        )}
        <Umpires match={match} role={role}/>
        <WeatherLine match={match} role={role}/>
      </header>
      <BusCard match={match} role={role}/>
      <FixtureLifts match={match}/>
      <Card label={self ? "You" : name} testid="fixture-availability">
        <AvailabilityBlock match={match} child={child} role={role} self={self}/>
      </Card>
      <Card label="Team sheet" testid="fixture-teamsheet">
        <TeamSheetLine match={match} child={child} role={role} self={self}/>
        {self && <SideSheet match={match} role={role}/>}
      </Card>
    </>
  );
}

/**
 * The side, for a pupil (S2): every name on the published sheet, in order —
 * he reads the sheet under player.profile.read across his side, as a team-mate
 * reads it. Names and places only: nobody's fitness, injury or return date
 * (K3, db/55: a child's medical needs are not in general view to children).
 */
function SideSheet({ match, role }) {
  const { rows } = useLive("match_squad", role, 0, { matchId: match.id });
  if (!rows.length) return null;
  const order = [...rows].sort((a, b) => (a.side ?? "").localeCompare(b.side ?? "") || (a.battingNo ?? 99) - (b.battingNo ?? 99));
  return (
    <ol data-testid="side-sheet" style={{ margin: 0, paddingLeft: T.space.xl, display: "grid", gap: "2px" }}>
      {order.map((r) => (
        <li key={`${r.side}-${r.playerId}`} style={{ ...T.role.body, color: T.content.primary }}>
          {r.name}{r.twelfth ? " (12th)" : ""}
        </li>
      ))}
    </ol>
  );
}

/** P4 · The match, live or past: the Match Centre in family mode (G13). */
export function MatchFor({ match, child, role, self = false, matches, onBack }) {
  return (
    <MatchView match={match} role={role} onClose={onBack} matches={matches}
      focus={[child.id]} focusLabel={self ? "You" : "Your child"} backLabel="Matches"/>
  );
}
