/**
 * The cards on a family or pupil Home (step 4 P1, S1), each about ONE child.
 *
 * Order (§2.1): the next fixture first, always; the board only while his
 * side is live; the last match in words; the season; notices last. A card a
 * read cannot fill is not drawn — there is no "—" tile.
 */
import { T } from "../../design/tokens.js";
import { useLive } from "../../lib/live.js";
import { resultText, teamOf } from "../../lib/matchCentre.js";
import { humanDate } from "../../lib/format.js";
import { fixturesOf, lineFor, noticesFor, opponentOf, endOf } from "../../lib/family.js";
import { Board } from "../../ui/board.jsx";
import { Icon } from "../../ui/icons.jsx";
import { Action, AvailabilityBlock, BusLine, Card, Line, TeamSheetLine, WeatherLine, whenOf } from "./parts.jsx";
import { useFold } from "./useFold.js";

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "SATURDAY 3 OCT" as the eyebrow says it. */
const dayLabel = (iso) => {
  if (!iso) return "Next fixture";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "Next fixture" : `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};

/**
 * The next fixture, where, how he gets there, his answer and the team sheet.
 * `onOpen` opens the fixture (P3/S3), where the answer is given.
 */
export function NextFixtureCard({ child, matches, role, self = false, onOpen, onMatches, now }) {
  const next = fixturesOf(matches, child, now).upcoming[0] ?? null;
  const name = child.knownAs || child.name;
  if (!next) {
    return (
      <Card label="Next fixture" testid="next-fixture">
        <Line testid="next-fixture-none">{self ? "No fixture is arranged for your side yet." : `No fixture is arranged for ${name} yet.`}</Line>
        {onMatches && <div><Action onClick={onMatches} testid="next-fixture-matches">See {self ? "your" : "the"} matches</Action></div>}
      </Card>
    );
  }
  const where = endOf(next, child) === "home" ? "home" : "away";
  return (
    <Card label={dayLabel(next.date)} testid="next-fixture">
      <h2 data-testid="next-fixture-title" style={{ ...T.role.title.md, color: T.content.primary, margin: 0 }}>
        v {opponentOf(next, child)} <span style={{ ...T.role.body, color: T.content.secondary }}>({where})</span>
      </h2>
      <Line quiet>{[next.time, next.venue].filter(Boolean).join(" · ") || whenOf(next)}</Line>
      <BusLine match={next} role={role}/>
      <WeatherLine match={next} role={role}/>
      <div style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: T.space.md, display: "grid", gap: T.space.sm }}>
        <AvailabilityBlock match={next} child={child} role={role} self={self} compact/>
        <div><Action onClick={() => onOpen(next)} testid="next-fixture-open">{self ? "Change or answer" : "Change"}</Action></div>
      </div>
      <TeamSheetLine match={next} child={child} role={role} self={self}/>
    </Card>
  );
}

const oversOf = (balls) => (balls % 6 === 0 ? String(balls / 6) : `${Math.floor(balls / 6)}.${balls % 6}`);

/**
 * The board, only while his side's fixture is live (§2.1). The team's score,
 * and HIS row lit when he is in — never another child's name: the full board,
 * the scorecard and the moments are one tap away, in the Match Centre (P4).
 */
export function LiveCard({ child, matches, onFollow, now, self = false }) {
  const live = fixturesOf(matches, child, now).live[0] ?? null;
  const fold = useFold(live);
  if (!live) return null;
  const inn = fold.innings.at(-1) ?? null;
  const him = inn?.batsmen?.find((b) => b.id === child.id && b.status !== "out") ?? null;
  return (
    <Card label="Live" testid="live-card">
      {inn ? (
        <Board size="card" compact testid="family-board" team={teamOf(live, inn.battingTeam).full} total={inn.runs} wickets={inn.wickets}
          overs={oversOf(inn.balls)} batters={him ? [{ name: self ? "You" : (child.knownAs || child.name), runs: him.runs, balls: him.balls, onStrike: true }] : []}/>
      ) : <Line quiet>The match has started. The first ball is not in yet.</Line>}
      <div><Action primary onClick={() => onFollow(live)} testid="live-follow">Follow the match</Action></div>
    </Card>
  );
}

/** The last match in words: his line, and the result (§2.1, §6 item 2). */
export function LastMatchCard({ child, matches, onOpen, now, self = false }) {
  const last = fixturesOf(matches, child, now).played[0] ?? null;
  const fold = useFold(last);
  if (!last) return null;
  const line = lineFor(fold.innings, child.id);
  const result = resultText(last, fold.result);
  return (
    <Card label={`Last match · ${humanDate(last.date)} · v ${opponentOf(last, child)}`} testid="last-match">
      {fold.loading ? <Line quiet>Reading the scorecard…</Line> : (
        <>
          {line && <Line testid="last-match-line" strong>{self ? `You: ${line}` : line}</Line>}
          {result && <Line testid="last-match-result">{result}.</Line>}
          {!line && !result && <Line quiet>No score was recorded for this match.</Line>}
        </>
      )}
      <div><Action onClick={() => onOpen(last)} testid="last-match-open">Open the match</Action></div>
    </Card>
  );
}

/** This season's figures and his latest milestone (§2.1). Not drawn with neither. */
export function SeasonCard({ child, role, self = false }) {
  const { rows: seasons } = useLive("career_by_season", role);
  const { rows: miles } = useLive("milestones", role, 0, { playerId: child.id });
  const s = seasons.find((r) => r.id === child.id && r.currentSeason) ?? null;
  const m = miles.filter((x) => x.playerId === child.id)[0] ?? null;
  if (!s && !m) return null;
  const bits = s ? [
    s.innings ? `${s.runs} runs in ${s.innings} innings` : null,
    s.avg != null ? `average ${s.avg}` : null,
    s.ballsBowled ? `${s.wkts} wicket${s.wkts === 1 ? "" : "s"}` : null,
  ].filter(Boolean) : [];
  return (
    <Card label={s?.season ? `This season · ${s.season}` : "This season"} testid="season-card">
      {bits.length > 0 && <p data-testid="season-line" style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, margin: 0 }}>{bits.join(" · ")}</p>}
      {s && !bits.length && <Line quiet>{self ? "You have" : `${child.knownAs || child.name} has`} not batted or bowled this season yet.</Line>}
      {m && (
        <Line testid="season-milestone"><Icon name="medal"/> {m.label}{m.opponent ? ` · v ${m.opponent}` : ""}{m.on ? ` · ${humanDate(m.on)}` : ""}</Line>
      )}
    </Card>
  );
}

/** Unread notices about this child or about nobody in particular, last (§2.1). */
export function NoticesCard({ child, role, onOpen }) {
  const { rows } = useLive("notifications", role);
  const mine = noticesFor(rows, child);
  const unread = mine.filter((n) => !n.read);
  if (!unread.length) return null;
  return (
    <Card label={`Notices · ${unread.length} unread`} testid="notices-card">
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: T.space.xs }}>
        {unread.slice(0, 3).map((n) => (
          <li key={n.id} style={{ ...T.role.body, color: T.content.primary }}>{n.title}</li>
        ))}
      </ul>
      {onOpen && <div><Action onClick={onOpen} testid="notices-open">All notices</Action></div>}
    </Card>
  );
}

/** The next training session for his side (S1), from the noticeboard read. Not drawn without one. */
export function TrainingCard({ child, role, now }) {
  const { rows, disabled } = useLive("training", role);
  if (disabled) return null;
  const next = rows.filter((t) => t.team === child.team && t.school === child.school && !t.cancelled && t.date
    && Date.parse(`${t.date}T${t.time ?? "00:00"}:00Z`) >= now - 3600e3)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  if (!next) return null;
  return (
    <Card label="Training" testid="training-card">
      <Line>{[humanDate(next.date), next.time, next.venue].filter(Boolean).join(" · ")}</Line>
      {next.title && <Line quiet>{next.title}</Line>}
    </Card>
  );
}
