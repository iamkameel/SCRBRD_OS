/**
 * THE CAPTAIN'S VIEW on the pupil's Home and fixture screen (SCRBRD-138
 * phase A; docs/design/SCRBRD-138_captains_view.md §3.2, §3.3): C1, the card
 * under his next fixture, and C2, the Captain section on the fixture.
 *
 * Switched on by one row of his own — a live captain or vice-captain honour,
 * this season, for the side he is on, at his school (lib/captain.js, §1.2) —
 * and by nothing else: no role, no flag, no capability gained. Every element
 * is drawn from a read a team-mate already holds. What it never draws (§4):
 * anybody's health, load, guideline, availability, ratings or notes, the
 * opposition's dossier, a win chance. The coach's plan waits for phase B and
 * is not drawn here, nor is a place held for it.
 */
import { useEffect, useState } from "react";
import { bowlingLimit } from "@scrbrd/scoring";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { useLive } from "../../lib/live.js";
import { stat } from "../../lib/format.js";
import { oversOf } from "../../lib/matchCentre.js";
import { endOf, fixturesOf, opponentOf } from "../../lib/family.js";
import { bandLine, bandOfTeam, captaincyOf, currentSchoolSeason, ordinal, pitchWords, sheetOf, termsOf } from "../../lib/captain.js";
import { conditionsWords } from "../../scorer/conditionsLine.jsx";
import { Action, Card, Line, whenOf } from "./parts.jsx";

/**
 * Is he the captain, for this season? `season` undefined is "the current
 * school season" (Home); a label is the fixture's own (a fixture or match
 * screen); null is "a fixture that names no season", and the gate refuses.
 * `me` null (a parent, a coach, the demonstration) never reads a thing.
 * @param {{id: string, school: string | null, team: string | null} | null} me
 */
export function useCaptaincy(me, role, season) {
  const { rows: honours, loading: l1 } = useLive("honours", role);
  const { rows: seasons, loading: l2 } = useLive("seasons", role);
  if (!me || !signedIn()) return { cap: null, loading: false };
  const label = season === undefined ? currentSchoolSeason(seasons) : season;
  return { cap: captaincyOf(honours, me, label), loading: l1 || l2 };
}

/** The match's frozen playing conditions, as the events read hands them to every reader of the fixture (null: none). */
export function useTerms(match) {
  const id = match?.id ?? null;
  const [terms, setTerms] = useState(null);
  useEffect(() => {
    if (!id || !signedIn()) { setTerms(null); return undefined; }
    let cancelled = false;
    api(`/api/matches/${id}/events`)
      .then((d) => { if (!cancelled) setTerms(termsOf(d?.fold)); })
      .catch(() => { if (!cancelled) setTerms(null); });
    return () => { cancelled = true; };
  }, [id]);
  return terms;
}

const DAY7 = 7 * 24 * 3600e3;
const startOf = (m) => Date.parse(m.startsAt ?? `${m.date}T${m.time ?? "00:00"}:00Z`);

// ── C1 · The Home card ─────────────────────────────────

/**
 * Under his next fixture, only while the gate passes and a fixture of his
 * side is live or within seven days (§3.2). The label is the honour's:
 * "Vice-captain" for that kind. Names nobody on the side; the count is the
 * sheet's, not an answer anybody gave.
 * @param {{ me: any, role: string, matches: any[], now: number, onOpen: (m: any, kind: "fixture" | "match") => void }} p
 */
export function CaptainCard({ me, role, matches, now, onOpen }) {
  const { cap } = useCaptaincy(me, role, undefined);
  const { live, upcoming } = fixturesOf(matches, me, now);
  const soon = upcoming[0] && startOf(upcoming[0]) - now <= DAY7 ? upcoming[0] : null;
  const next = live[0] ?? soon;
  if (!cap || !next) return null;
  return <CaptainCardFor cap={cap} next={next} me={me} role={role} onOpen={onOpen}/>;
}

function CaptainCardFor({ cap, next, me, role, onOpen }) {
  const { rows: sheet } = useLive("match_squad", role, 0, { matchId: next.id });
  const named = sheet.filter((r) => r.side === endOf(next, me)).length;
  const isLive = next.status === "live";
  return (
    <Card label={`${cap.label} · ${[me.schoolName, me.team].filter(Boolean).join(" ")}`} testid="captain-card">
      <p data-testid="captain-card-fixture" style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, margin: 0 }}>
        v {opponentOf(next, me)} ({endOf(next, me)}) · {isLive ? "live now" : whenOf(next)}
      </p>
      <Line quiet testid="captain-card-side">{named ? `${named} named in the side` : "The side is not out yet"}</Line>
      <div>
        <Action testid="captain-card-open" onClick={() => onOpen(next, isLive ? "match" : "fixture")}>
          {isLive ? "Open the match" : "Match day"}
        </Action>
      </div>
    </Card>
  );
}

// ── C2 · The fixture's Captain section ─────────────────

/** A titled part of the section: the heading is a real heading, so a screen reader can walk it. */
function Part({ label, children, testid }) {
  return (
    <div data-testid={testid} style={{ display: "grid", gap: T.space.xs }}>
      <h3 style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>{label}</h3>
      {children}
    </div>
  );
}

/**
 * The Captain section (§3.3), drawn under the team sheet for a boy who passes
 * the gate: the day (the frozen document's own line and the band's one rule),
 * the groundsman's report for him, the side with its places, this season's
 * figures for each name on the sheet, and where the opposition stand. A part
 * a read cannot fill is not drawn. The weather, the umpires and the bus are
 * on the fixture above it, as for every boy.
 * @param {{ match: any, child: any, role: string, label: string }} p
 */
export function CaptainSection({ match, child, role, label }) {
  const end = endOf(match, child);
  const terms = useTerms(match);
  const { rows: directives } = useLive("bowling_directives", role);
  const { rows: pitch } = useLive("pitch_report", role, 0, { matchId: match.id });
  const { rows: squad } = useLive("match_squad", role, 0, { matchId: match.id });
  const { rows: career } = useLive("career_by_season", role);
  const { rows: ladder } = useLive("league", role);

  const sheet = sheetOf(squad, end);
  const band = bandOfTeam(child.team);
  const rule = bandLine(terms ? bowlingLimit(terms.conditions, band) : null, directives.find((d) => d.ageBand === band) ?? null, band);
  const day = [match.format, match.overs ? `${match.overs} overs` : null, ...conditionsWords(terms)].filter(Boolean).join(" · ");
  const pitchLine = pitchWords(pitch.find((p) => p.matchId === match.id));

  const season = match.season ?? null;
  const figures = sheet.map((r) => {
    const s = career.find((c) => c.id === r.playerId && c.season === season);
    if (!s) return null;
    const bat = s.innings > 0 ? `${s.innings} inns · ${s.runs} runs · avg ${stat(s.avg)}` : null;
    const bowl = s.ballsBowled > 0 ? `${oversOf(s.ballsBowled)} ov · ${s.wkts} wkts · econ ${stat(s.econ)}` : null;
    const line = [bat, bowl].filter(Boolean).join(" · ");
    return line ? { id: r.playerId, name: r.name, line } : null;
  }).filter(Boolean);

  const oppSchool = end === "home" ? match.awaySchoolId : match.schoolId;
  const oppTeam = end === "home" ? match.awayTeamCode : match.homeTeam;
  const opp = opponentOf(match, child);
  const standing = ladder.find((r) => oppSchool && r.school === oppSchool && r.team === oppTeam)
    ?? ladder.find((r) => String(r.name ?? "").toLowerCase() === opp.toLowerCase()) ?? null;

  return (
    <Card label={label} testid="captain-section">
      {(day || rule) && (
        <Part label="The day" testid="captain-day">
          {day && <Line testid="captain-day-line">{day}</Line>}
          {rule && <Line testid="captain-band-rule">{rule}</Line>}
        </Part>
      )}
      {pitchLine && (
        <Part label="The pitch" testid="captain-pitch"><Line>{pitchLine}</Line></Part>
      )}
      {sheet.length > 0 && (
        <Part label={`The side · ${sheet.length} named`} testid="captain-side">
          <ol data-testid="side-sheet" style={{ margin: 0, paddingLeft: T.space.xl, display: "grid", gap: "2px" }}>
            {sheet.map((r) => (
              <li key={`${r.side}-${r.playerId}`} style={{ ...T.role.body, color: T.content.primary }}>{r.name}{r.twelfth ? " (12th)" : ""}</li>
            ))}
          </ol>
        </Part>
      )}
      {figures.length > 0 && (
        <Part label={`This season · ${season}`} testid="captain-season">
          {figures.map((f) => (
            <p key={f.id} data-testid={`captain-season-${f.id}`} style={{ ...T.role.figure.sm, fontSize: "14px", color: T.content.primary, margin: 0 }}>
              {f.name} · {f.line}
            </p>
          ))}
        </Part>
      )}
      {standing && (
        <Part label={`${opp} this season`} testid="captain-opposition">
          <Line>{[standing.rank != null ? ordinal(standing.rank) : null, `W${standing.wins ?? 0} L${standing.losses ?? 0}`].filter(Boolean).join(" · ")}</Line>
        </Part>
      )}
    </Card>
  );
}
