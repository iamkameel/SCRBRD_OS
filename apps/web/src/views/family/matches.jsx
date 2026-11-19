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
import { ReadState } from "../../ui/primitives.jsx";
import { readState } from "../../lib/readState.js";
import { resultText } from "../../lib/matchCentre.js";
import { fixturesOf, lineFor, opponentOf, endOf } from "../../lib/family.js";
import { MatchView } from "../matchcentre/MatchView.jsx";
import { Icon } from "../../ui/icons.jsx";
import { MatchCard } from "../../ui/matchCard.jsx";
import { openWords } from "../../lib/matchCard.js";
import { AvailabilityBlock, Back, BusCard, Card, Line, StateChip, TeamSheetLine, Title, WeatherLine, whenOf } from "./parts.jsx";
import { useFold } from "./useFold.js";
import { CaptainSection, useCaptaincy } from "./captain.jsx";
import { FixturePlan } from "./plan.jsx";
// SCRBRD-124 (db/70): lifts to this fixture, where a family or a pupil asks for a seat.
import { FixtureLifts } from "../lifts.jsx";

const now = () => Date.now();

/**
 * A postponed fixture (db/133): called off before play, to be replayed on a
 * date not yet set. Said in words, with the day it was set for; no answer is
 * asked for a day the fixture is not on.
 */
function PostponedChip({ testid }) {
  return (
    <span data-testid={testid} data-state="postponed" style={{ display: "inline-flex", alignItems: "center", gap: T.space.xs,
      ...T.role.body, fontSize: "14px", fontWeight: 600, color: T.content.primary }}>
      <Icon name="calendar"/>Postponed
    </span>
  );
}

/**
 * A fixture on his list (slice 1): the match card's row, his side first, the
 * whole row one tap to the fixture or the match. `aside` sits on the state
 * line's right (his answer); `line` is his own line.
 */
function Row({ m, child, testid, onOpen, aside = null, line = null, lineTestid, fold = null, resultSaid = null, last = false }) {
  const end = endOf(m, child);
  return (
    <MatchCard size="row" last={last} match={m} ownEnd={end} testid={testid} onOpen={() => onOpen(m)} openLabel={openWords(m, end)}
      aside={aside} line={line} lineTestid={lineTestid} resultSaid={resultSaid}
      fold={fold?.innings?.length ? { innings: fold.innings, result: fold.result } : null}/>
  );
}

/** An upcoming row: when, who, home or away — and his answer, as a word. */
function UpcomingRow({ m, child, role, onOpen, last = false }) {
  if (m.status === "postponed") {
    // A postponed fixture (db/133): the card says "Postponed"; the row says the day it was set for.
    return <Row m={m} child={child} last={last} testid={`fixture-row-${m.id}`} onOpen={onOpen} aside={<PostponedChip testid={`fixture-chip-${m.id}`}/>}
      line={`Was ${whenOf(m)} · new date to follow`}/>;
  }
  return <AnsweredRow m={m} child={child} role={role} onOpen={onOpen} last={last}/>;
}

/** A fixture that is on: when, who, home or away — and his answer, as a word. */
function AnsweredRow({ m, child, role, onOpen, last = false }) {
  const read = useLive("availability", role, 0, { matchId: m.id });
  const row = read.rows.find((r) => r.playerId === child.id) ?? null;
  // "No answer" is said only of a read that answered; one that is coming or
  // failed says that instead, in the chip's place (GA-I08).
  const said = readState(read, { what: "the answer" });
  const answered = ["ok", "empty"].includes(said.state);
  return (
    <Row m={m} child={child} last={last} testid={`fixture-row-${m.id}`} onOpen={onOpen}
      aside={answered ? <StateChip status={row?.status ?? null} testid={`fixture-chip-${m.id}`}/>
        : <span data-testid={`fixture-chip-${m.id}`} data-state={said.state} style={{ ...T.role.body, fontSize: "14px", fontWeight: 600, color: T.content.secondary }}>{(said.sentence ?? "").replace(/…$|\.$/, "")}</span>}/>
  );
}

/**
 * A live row: both scores and his line, from that match's own log, the one
 * read per match this list already makes of a played row (useFold.js, §5 G7),
 * re-read while the match is live.
 */
function LiveRow({ m, child, onOpen, self, last = false }) {
  const fold = useFold(m);
  const line = lineFor(fold.innings, child.id);
  return <Row m={m} child={child} last={last} testid={`live-row-${m.id}`} onOpen={onOpen} fold={fold}
    line={line ? (self ? `You: ${line}` : line) : null} lineTestid={`live-line-${m.id}`}/>;
}

/** A played row: the result and HIS line, folded from that match's log. */
function PlayedRow({ m, child, onOpen, self, last = false }) {
  const fold = useFold(m);
  const line = lineFor(fold.innings, child.id);
  return <Row m={m} child={child} last={last} testid={`played-row-${m.id}`} onOpen={onOpen} fold={fold} resultSaid={resultText(m, fold.result)}
    line={line ? (self ? `You: ${line}` : line) : null} lineTestid={`played-line-${m.id}`}/>;
}

/**
 * The list for one child. `child` is the one the screen is about — a
 * guardian's chosen child, or the pupil himself — and `head` what sits above
 * the list (the switcher).
 */
export function ChildMatches({ child, role, self = false, head = null }) {
  // Retry bumps this nonce: the same read again, same role, same params.
  const [nonce, setNonce] = useState(0);
  const matchesRead = useLive("matches", role, nonce);
  const { rows: matches, loading, error } = matchesRead;
  const matchesSaid = readState(matchesRead, { what: "the fixture list" });
  const [open, setOpen] = useState(null);
  if (open?.kind === "fixture") return <FixtureDetail match={open.match} child={child} role={role} self={self} onBack={() => setOpen(null)}/>;
  if (open?.kind === "match") return <MatchFor match={open.match} child={child} role={role} self={self} matches={matches} onBack={() => setOpen(null)}/>;
  const { live, upcoming, postponed, played } = fixturesOf(matches, child, now());
  const name = child.knownAs || child.name;
  return (
    <>
      {head}
      <Title testid="matches-title">Matches · {self ? "your side" : name}</Title>
      <Line quiet>{[child.schoolName, child.team].filter(Boolean).join(" · ")}</Line>
      {!["ok", "empty"].includes(matchesSaid.state) && !matches.length
        ? <ReadState compact read={matchesSaid} onRetry={() => setNonce((n) => n + 1)} testId="matches-read-state"/> : null}
      {live.length > 0 && (
        <Card label="Live now" testid="matches-live">
          {live.map((m, n) => <LiveRow key={m.id} last={n === live.length - 1} m={m} child={child} self={self} onOpen={(x) => setOpen({ kind: "match", match: x })}/>)}
        </Card>
      )}
      <Card label="Coming up" testid="matches-upcoming">
        {upcoming.length || postponed.length ? [...upcoming, ...postponed].map((m, n, all) => (
          <UpcomingRow key={m.id} last={n === all.length - 1} m={m} child={child} role={role} onOpen={(x) => setOpen({ kind: "fixture", match: x })}/>
        )) : !loading && !error && <Line quiet>{self ? "Nothing arranged for your side yet." : `Nothing arranged for ${name}'s side yet.`}</Line>}
      </Card>
      {played.length > 0 && (
        <Card label="Played" testid="matches-played">
          {played.map((m, n) => <PlayedRow key={m.id} last={n === played.length - 1} m={m} child={child} self={self} onOpen={(x) => setOpen({ kind: "match", match: x })}/>)}
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
  // SCRBRD-138: a captain's section, only for the pupil himself and only while
  // his own honour passes the gate for this fixture's season. Everyone else
  // sees the fixture exactly as it was.
  const { cap } = useCaptaincy(self ? child : null, role, match.season ?? null);
  const maps = match.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(match.venue)}` : null;
  const postponed = match.status === "postponed";
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
            {maps && <> · <a href={maps} target="_blank" rel="noreferrer" aria-label={`Map of ${match.venue}`}
              style={{ color: T.content.primary, display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "44px", minWidth: "44px", padding: "0 4px" }}>map</a></>}
          </Line>
        )}
        {postponed
          ? <p role="status" data-testid="fixture-postponed" style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, margin: 0 }}>
              Postponed. It stays on the calendar and will be played on a new date; you will be told when it has one.
            </p>
          : <><Umpires match={match} role={role}/><WeatherLine match={match} role={role}/></>}
      </header>
      {/* A postponed fixture has no day yet: no bus, no lift and no answer
          is asked for (db/133). They come back with its new date. */}
      {!postponed && <BusCard match={match} role={role}/>}
      {!postponed && <FixtureLifts match={match} child={child}/>}
      {!postponed && (
        <Card label={self ? "You" : name} testid="fixture-availability">
          <AvailabilityBlock match={match} child={child} role={role} self={self}/>
        </Card>
      )}
      <Card label="Team sheet" testid="fixture-teamsheet">
        {/* The captain's section draws the side itself (SCRBRD-138), so his card keeps to the line. */}
        <TeamSheetLine match={match} child={child} role={role} self={self} sheet={!(self && cap)}/>
      </Card>
      {/* SCRBRD-138 phase B: the coach's plan to the side, for every boy and parent it reaches, above the captain's section. */}
      <FixturePlan match={match} child={child} role={role}/>
      {self && cap && <CaptainSection match={match} child={child} role={role} label={cap.label}/>}
    </>
  );
}

/** P4 · The match, live or past: the Match Centre in family mode (G13). */
export function MatchFor({ match, child, role, self = false, matches, onBack }) {
  // SCRBRD-138: the Captain tab, for the pupil himself while his honour passes the gate.
  const { cap } = useCaptaincy(self ? child : null, role, match.season ?? null);
  return (
    <MatchView match={match} role={role} onClose={onBack} matches={matches}
      focus={[child.id]} focusLabel={self ? "You" : "Your child"} backLabel="Matches"
      captain={cap ? { label: cap.label, me: child } : null}/>
  );
}
