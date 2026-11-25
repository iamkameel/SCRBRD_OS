import { useId, useMemo, useState } from "react";
import { T } from "../../design/tokens.js";
import { signedIn } from "../../lib/api.js";
import { profile } from "../../lib/session.js";
import { requestCoach } from "../../lib/cockpitNav.js";
import { busOf, isMatchDay, sideFoot, sideRows, withSwitches } from "../../lib/cockpit.js";
import { useFeatures } from "../../lib/features.js";
import { humanDate } from "../../lib/format.js";
import { sidesOf } from "../../lib/matchCentre.js";
import { chooseFixtures, countOf, fixtureRows, needsYouWords, splitForReader } from "../../lib/queue.js";
import { BentoCard } from "../../ui/surfaces.jsx";
import { MatchCard } from "../../ui/matchCard.jsx";
import { useCockpit, useFeed } from "./useCockpit.js";

/**
 * THE MATCH-DAY CARD (SCRBRD-136 phase A; design §3.2, "The Dashboard card";
 * grown to a list by the match-day queue's phase A0,
 * docs/design/GA-I09-I11_match_day_queue.md §3.1, §4): on the Dashboard, one
 * card for each fixture within seven days that the reader's single assignment
 * covers and grants the cockpit for (cockpitGate: by capability, never by
 * title; one assignment per fixture, never a union of two), in start order
 * with today's first. The first few are drawn; the rest fold under "Later" and
 * are drawn, and read, on a tap. A coach with one fixture sees one card, as
 * before.
 *
 * Each card is one line about the side and the bus, a count ("2 need you":
 * this fixture's rows on Today's "Needs you", the queue's rule over the reads
 * made here, so the two never disagree; redesign slice 11), what only the
 * office can clear said as the office's, a "Couldn't load X" line for every
 * read that failed, and one tap into the Coach tab. It draws nothing for anyone
 * the gate does not admit, and nothing signed out. The lift reads are logged by
 * the database, so they are made only on the match day, and a card that has
 * not read the lifts does not claim the bus is short for someone who may count
 * them. Opening the tab reads everything the drawer needs, so the drawer may
 * hold a signal or two the card could not count.
 *
 * The day sheet folds the card of its next fixture into that fixture's own card (EXPERIENCE_PASS C13: the same
 * fixture once, not twice): `only` draws that one fixture's card as a body to be placed inside it, `skip` draws
 * the others. With neither, it is the card as it always was.
 *
 * @param {{matches: any[], onNav: (page: string) => void, only?: string | null, skip?: string | null}} p
 */
export function MatchDayCard({ matches, onNav, only = null, skip = null }) {
  const now = useMemo(() => Date.now(), []);
  const assignments = signedIn() ? profile()?.assignments : null;
  // A panel whose module is switched off for this person is not drawn (lib/cockpit.js withSwitches).
  const { features } = useFeatures();
  // Folding takes one card out of the list and leaves the list as it was: the same first few and the same Later,
  // each card numbered among them all, so the fixture folded into the next-fixture card is still "1 of 3".
  const chosen = useMemo(() => {
    const c = chooseFixtures(matches, assignments, now);
    const keep = (/** @type {{match: any}} */ p) => (only ? p.match.id === only : skip ? p.match.id !== skip : true);
    // The fixture folded into the next-fixture card is drawn there, wherever it falls in the list.
    if (only) return { all: c.all, shown: c.all.filter(keep), later: [] };
    return { all: c.all, shown: c.shown.filter(keep), later: c.later.filter(keep) };
  }, [matches, assignments, now, only, skip]);
  const picks = useMemo(() => {
    const sw = (/** @type {{match: any, gate: any}} */ p) => ({ ...p, gate: withSwitches(p.gate, features) });
    return { all: chosen.all.map(sw), shown: chosen.shown.map(sw), later: chosen.later.map(sw) };
  }, [chosen, features]);
  const [later, setLater] = useState(false);
  const laterId = useId();
  const total = picks.all.length;
  if (!picks.shown.length && !picks.later.length) return null;
  const several = total > 1;
  const nth = (/** @type {string} */ id) => picks.all.findIndex((p) => p.match.id === id);
  const draw = (/** @type {{match: any, gate: any}} */ { match, gate }) => (
    <Card key={match.id} match={match} gate={gate} onNav={onNav} now={now} folded={!!only}
          title={several ? `Match day · ${nth(match.id) + 1} of ${total}` : "Match day"} named={several}/>
  );
  return (
    <>
      {picks.shown.map(draw)}
      {picks.later.length > 0 && (
        <BentoCard level="d" data-testid="matchday-later">
          <button type="button" className="os-state" data-testid="matchday-later-toggle" aria-expanded={later} aria-controls={laterId}
                  onClick={() => setLater((v) => !v)}
                  style={{ ...btn(), width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left" }}>
            <span>Later · {picks.later.length} {picks.later.length === 1 ? "fixture" : "fixtures"} · from {humanDate(picks.later[0].match.date)}</span>
            <span aria-hidden="true">{later ? "Hide" : "Show"}</span>
          </button>
        </BentoCard>
      )}
      {/* Drawn only once opened, so a folded fixture makes none of its reads. */}
      <div id={laterId} style={{ display: "contents" }}>{later && picks.later.map((p) => draw(p))}</div>
    </>
  );
}

/** The session's own assignments, read when drawn. */
const assignmentsOf = () => (signedIn() ? profile()?.assignments ?? null : null);

// A function, not a constant: the theme's tokens are read when drawn, never at import.
const btn = () => ({ minHeight: `${T.floor.target}px`, padding: `0 ${T.space.lg}`, background: "transparent", color: T.content.primary,
  border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 });

/** @param {{match: any, gate: any, onNav: (page: string) => void, now: number, title: string, named: boolean, folded?: boolean}} p */
function Card({ match, gate, onNav, now, title, named, folded = false }) {
  const lifts = isMatchDay(match, now);
  const cockpit = useCockpit({ match, gate, lifts, matchups: false });
  const feed = useFeed({ match, gate, cockpit });
  const { reads, loading } = cockpit;
  const p = gate.panels;
  const rows = p.side && reads.readiness ? sideRows(reads.readiness, gate.end, p) : null;
  const named11 = (reads.squad ?? []).filter((r) => r.side === gate.end).length;
  const bus = p.bus ? busOf(reads.trips, gate.school) : null;
  const sides = sidesOf(match);
  const ours = gate.end === "home" ? sides.home.full : sides.away.full;
  const opponent = gate.end === "home" ? sides.away.full : sides.home.full;
  const count = countOf({ open: feed.open.length, reads, gate, lifts });
  // The one count (redesign slice 11): this fixture's rows on "Needs you", from the same rule over the same reads,
  // so the card and Today's "Needs you" never say two numbers. Needs you reads no lifts on opening (useQueue's
  // no-tap mode), so neither does the count. A fixture the queue does not hold (live or played) has no count.
  const queued = match.status === "upcoming" || match.calledOff === true;
  const mine = useMemo(() => {
    if (loading || !queued) return null;
    const g = fixtureRows({ match, gate: { ...gate, panels: { ...gate.panels, lifts: false, liftOffice: false } }, reads: { ...reads, lifts: null }, now });
    return splitForReader(g, assignmentsOf());
  }, [loading, queued, match, gate, reads, now]);
  // With several cards the same two buttons repeat: each is named for its fixture (the visible words stay first).
  const who = named ? ` · ${ours} v ${opponent}` : "";
  const go = (drawer) => { requestCoach(match.id, drawer); onNav("matches"); };
  const line = { ...T.role.body, color: T.content.secondary, margin: 0 };
  const inner = (
      <div style={{ padding: folded ? 0 : T.space.lg, display: "grid", gap: T.space.sm }}>
        {/* With one fixture the card says what it always has; with several, which of his sides it is. Folded into the
            next fixture's card, the fixture is already said above it. */}
        {folded && <p style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>{title}</p>}
        {folded
          ? <p data-testid="matchday-line" style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, margin: 0 }}>{named ? `${ours} v ${opponent}` : `v ${opponent}`}</p>
          // The match card (slice 1): the day, his side first, both named in full, where it stands. The count and
          // the two buttons that follow are the card's own.
          : <MatchCard size="card" match={match} ownEnd={gate.end} now={now} testid="matchday-line" statusTestid="matchday-status"/>}
        {loading ? <p style={line}>Reading the day…</p> : (
          <>
            <p data-testid="matchday-side" style={line}>
              {rows ? (rows.length ? sideFoot(rows) : "No sheet published yet") : `${named11} named`}
              {bus ? ` · bus ${bus.capacity} seats` : ""}
            </p>
            {mine && (
              <p data-testid="matchday-count" style={{ ...line, color: T.content.primary, fontWeight: 600 }}>
                {needsYouWords({ open: mine.mine.length, failed: count.unread.length, sayFailed: false })}
              </p>
            )}
            {/* Question 8 (decided 19 Nov): what only the office can clear is not on his "Needs you"; it is said
                here, on the fixture, as the office's. */}
            {mine?.office.map((r) => (
              <p key={r.id} data-testid="matchday-office" data-rule={r.rule} style={line}>The office's: {r.fact}</p>
            ))}
            {/* A read that failed is said, one line each: it is never "nothing needs you". */}
            {count.unread.map((r) => (
              <p key={r.key} data-testid="matchday-unread" data-read={r.key} style={line}>{r.text}</p>
            ))}
          </>
        )}
        <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
          <button type="button" data-testid="matchday-open" className="os-state" onClick={() => go(false)} aria-label={named ? `Open the Coach tab${who}` : undefined} style={btn()}>Open the Coach tab</button>
          {/* Always drawn, so the card's controls do not change under a finger (or a script) while its reads arrive. */}
          <button type="button" data-testid="matchday-signals" className="os-state" onClick={() => go(true)} aria-label={named ? `See the signals${who}` : undefined} style={btn()}>See the signals</button>
        </div>
      </div>
  );
  return folded
    ? <div data-testid="day-matchday" data-match={match.id} data-folded="true" style={{ marginTop: T.space.md, paddingTop: T.space.md, borderTop: `1px solid ${T.line.subtle}` }}>{inner}</div>
    : <BentoCard level="b" title={title} data-testid="day-matchday" data-match={match.id}>{inner}</BentoCard>;
}
