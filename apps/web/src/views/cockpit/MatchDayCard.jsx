import { useId, useMemo, useState } from "react";
import { T } from "../../design/tokens.js";
import { signedIn } from "../../lib/api.js";
import { profile } from "../../lib/session.js";
import { requestCoach } from "../../lib/cockpitNav.js";
import { busOf, isMatchDay, sideFoot, sideRows } from "../../lib/cockpit.js";
import { humanDate, humanDateTime } from "../../lib/format.js";
import { sidesOf } from "../../lib/matchCentre.js";
import { chooseFixtures, countOf } from "../../lib/queue.js";
import { BentoCard } from "../../ui/surfaces.jsx";
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
 * Each card is one line about the side and the bus, a count ("N to resolve",
 * the feed over the reads made here) with a "Could not read X" line for every
 * read that failed, and one tap into the Coach tab. It draws nothing for anyone
 * the gate does not admit, and nothing signed out. The lift reads are logged by
 * the database, so they are made only on the match day, and a card that has
 * not read the lifts does not claim the bus is short for someone who may count
 * them. Opening the tab reads everything the drawer needs, so the drawer may
 * hold a signal or two the card could not count.
 *
 * @param {{matches: any[], onNav: (page: string) => void}} p
 */
export function MatchDayCard({ matches, onNav }) {
  const now = useMemo(() => Date.now(), []);
  const assignments = signedIn() ? profile()?.assignments : null;
  const picks = useMemo(() => chooseFixtures(matches, assignments, now), [matches, assignments, now]);
  const [later, setLater] = useState(false);
  const laterId = useId();
  const total = picks.all.length;
  if (!total) return null;
  const several = total > 1;
  const draw = (/** @type {{match: any, gate: any}} */ { match, gate }, /** @type {number} */ i) => (
    <Card key={match.id} match={match} gate={gate} onNav={onNav} now={now}
          title={several ? `Match day · ${i + 1} of ${total}` : "Match day"} named={several}/>
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
      <div id={laterId} style={{ display: "contents" }}>{later && picks.later.map((p, i) => draw(p, picks.shown.length + i))}</div>
    </>
  );
}

// A function, not a constant: the theme's tokens are read when drawn, never at import.
const btn = () => ({ minHeight: "44px", padding: `0 ${T.space.lg}`, background: "transparent", color: T.content.primary,
  border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 });

/** @param {{match: any, gate: any, onNav: (page: string) => void, now: number, title: string, named: boolean}} p */
function Card({ match, gate, onNav, now, title, named }) {
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
  // With several cards the same two buttons repeat: each is named for its fixture (the visible words stay first).
  const who = named ? ` · ${ours} v ${opponent}` : "";
  const go = (drawer) => { requestCoach(match.id, drawer); onNav("matches"); };
  const line = { ...T.role.body, color: T.content.secondary, margin: 0 };
  return (
    <BentoCard level="b" title={title} data-testid="day-matchday" data-match={match.id}>
      <div style={{ padding: T.space.lg, display: "grid", gap: T.space.sm }}>
        {/* With one fixture the card says what it always has; with several, which of his sides it is. */}
        <p data-testid="matchday-line" style={{ ...T.role.title.md, color: T.content.primary, margin: 0 }}>{named ? `${ours} v ${opponent}` : `v ${opponent}`}</p>
        <p style={line}>{humanDateTime(match.date, match.time)}</p>
        {loading ? <p style={line}>Reading the day…</p> : (
          <>
            <p data-testid="matchday-side" style={line}>
              {rows ? (rows.length ? sideFoot(rows) : "No sheet published yet") : `${named11} named`}
              {bus ? ` · bus ${bus.capacity} seats` : ""}
            </p>
            <p data-testid="matchday-count" style={{ ...line, color: T.content.primary, fontWeight: 600 }}>{count.line}</p>
            {/* A read that failed is said, one line each: it is never "nothing to resolve". */}
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
    </BentoCard>
  );
}
