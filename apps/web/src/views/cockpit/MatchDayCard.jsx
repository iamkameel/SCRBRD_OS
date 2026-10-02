import { useMemo } from "react";
import { T } from "../../design/tokens.js";
import { signedIn } from "../../lib/api.js";
import { profile } from "../../lib/session.js";
import { requestCoach } from "../../lib/cockpitNav.js";
import { busOf, cockpitGate, isMatchDay, isWithin, sideFoot, sideRows, startMs } from "../../lib/cockpit.js";
import { humanDateTime } from "../../lib/format.js";
import { sidesOf } from "../../lib/matchCentre.js";
import { BentoCard } from "../../ui/surfaces.jsx";
import { useCockpit, useFeed } from "./useCockpit.js";

/**
 * THE MATCH-DAY CARD (SCRBRD-136 phase A; design §3.2, "The Dashboard card"):
 * on the Dashboard, for the next fixture within seven days that the reader's
 * single assignment covers and grants the cockpit for (cockpitGate: by
 * capability, never by title). One line about the side and the bus, the feed's
 * count, and one tap into the Coach tab.
 *
 * It draws nothing for anyone the gate does not admit, and nothing signed out.
 * Its count is the feed over the reads made here; the lift reads are logged by
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
  const pick = useMemo(() => {
    const soon = (matches ?? []).filter((m) => isWithin(m, now, 7)).sort((a, b) => (startMs(a) ?? 0) - (startMs(b) ?? 0));
    for (const m of soon) { const g = cockpitGate(assignments, m); if (g) return { match: m, gate: g }; }
    return null;
  }, [matches, assignments, now]);
  if (!pick) return null;
  return <Card match={pick.match} gate={pick.gate} onNav={onNav} now={now}/>;
}

function Card({ match, gate, onNav, now }) {
  const cockpit = useCockpit({ match, gate, lifts: isMatchDay(match, now), matchups: false });
  const feed = useFeed({ match, gate, cockpit });
  const { reads, loading } = cockpit;
  const p = gate.panels;
  const rows = p.side && reads.readiness ? sideRows(reads.readiness, gate.end, p) : null;
  const named = (reads.squad ?? []).filter((r) => r.side === gate.end).length;
  const bus = p.bus ? busOf(reads.trips, gate.school) : null;
  const sides = sidesOf(match);
  const opponent = gate.end === "home" ? sides.away.full : sides.home.full;
  const go = (drawer) => { requestCoach(match.id, drawer); onNav("matches"); };
  const line = { ...T.role.body, color: T.content.secondary, margin: 0 };
  const btn = { minHeight: "44px", padding: `0 ${T.space.lg}`, background: "transparent", color: T.content.primary,
    border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 };
  return (
    <BentoCard level="b" title="Match day" data-testid="day-matchday">
      <div style={{ padding: T.space.lg, display: "grid", gap: T.space.sm }}>
        <p data-testid="matchday-line" style={{ ...T.role.title.md, color: T.content.primary, margin: 0 }}>v {opponent}</p>
        <p style={line}>{humanDateTime(match.date, match.time)}</p>
        {loading ? <p style={line}>Reading the day…</p> : (
          <>
            <p data-testid="matchday-side" style={line}>
              {rows ? (rows.length ? sideFoot(rows) : "No sheet published yet") : `${named} named`}
              {bus ? ` · bus ${bus.capacity} seats` : ""}
            </p>
            <p data-testid="matchday-count" style={{ ...line, color: T.content.primary, fontWeight: 600 }}>
              {feed.open.length} {feed.open.length === 1 ? "signal" : "signals"}
            </p>
          </>
        )}
        <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
          <button type="button" data-testid="matchday-open" className="os-state" onClick={() => go(false)} style={btn}>Open the Coach tab</button>
          {!loading && feed.open.length > 0 && (
            <button type="button" data-testid="matchday-signals" className="os-state" onClick={() => go(true)} style={btn}>See the signals</button>
          )}
        </div>
      </div>
    </BentoCard>
  );
}
