/**
 * The cards on a family or pupil Home (step 4 P1, S1), each about ONE child.
 *
 * Order (§2.1): the next fixture first, always; the board only while his
 * side is live; the last match in words; the season; notices last. A card a
 * read cannot fill is not drawn — there is no "—" tile.
 */
import { T } from "../../design/tokens.js";
import { useLive } from "../../lib/live.js";
import { useNotifications } from "../../lib/notifications.js";
import { ReadState } from "../../ui/primitives.jsx";
import { resultText, withOpponents } from "../../lib/matchCentre.js";
import { humanDate } from "../../lib/format.js";
import { fixturesOf, lineFor, noticesFor, opponentOf, endOf } from "../../lib/family.js";
import { MatchCard } from "../../ui/matchCard.jsx";
import { openWords } from "../../lib/matchCard.js";
import { Action, AvailabilityBlock, BusLine, Card, Line, TeamSheetLine, WeatherLine, answerVerb } from "./parts.jsx";
import { careerAverage } from "../../lib/compare.js";
import { useFold } from "./useFold.js";
import { SealMark } from "../../ui/sealMark.jsx";
import { familyMilestoneLine, familyName, honourWords, isFirst, isSealed, isWithdrawn, provenanceOf } from "../../lib/recognitionWords.js";

/**
 * The next fixture, where, how he gets there, his answer and the team sheet.
 * `onOpen` opens the fixture (P3/S3), where the answer is given.
 */
export function NextFixtureCard({ child, matches, role, self = false, onOpen, onMatches, now, said = null, onRetry }) {
  const next = fixturesOf(matches, child, now).upcoming[0] ?? null;
  const name = child.knownAs || child.name;
  if (!next) {
    // "No fixture is arranged" is a statement about the season. A fixtures read
    // that is still coming, failed or was refused says that instead (GA-I08):
    // a parent decides whether to get in a car on this line.
    if (said && !["ok", "empty"].includes(said.state)) {
      return (
        <Card label="Next fixture" testid="next-fixture">
          <ReadState compact read={said} onRetry={onRetry} testId="next-fixture-read-state"/>
        </Card>
      );
    }
    return (
      <Card label="Next fixture" testid="next-fixture">
        <Line testid="next-fixture-none">{self ? "No fixture is arranged for your side yet." : `No fixture is arranged for ${name} yet.`}</Line>
        {onMatches && <div><Action onClick={onMatches} testid="next-fixture-matches">See {self ? "your" : "the"} matches</Action></div>}
      </Card>
    );
  }
  return (
    <Card label="Next fixture" testid="next-fixture">
      {/* The match card (slice 1): his side first, both named in full, and where it stands. What the card does not
          say follows it: the bus, the weather, his answer and the side. */}
      <MatchCard size="card" match={next} ownEnd={endOf(next, child)} now={now} testid="next-fixture-title" statusTestid="next-fixture-status"/>
      <BusLine match={next} role={role}/>
      <WeatherLine match={next} role={role}/>
      <div style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: T.space.md, display: "grid", gap: T.space.sm }}>
        <AvailabilityBlock match={next} child={child} role={role} self={self} compact
          action={(status) => <div><Action onClick={() => onOpen(next)} testid="next-fixture-open">{answerVerb(status)}</Action></div>}/>
      </div>
      {/* Q10 (Kameel, 15 Nov): the eleven on her child's next fixture. His own Home keeps to his line; his fixture draws the side. */}
      <TeamSheetLine match={next} child={child} role={role} self={self} sheet={!self}/>
    </Card>
  );
}

/**
 * His line while his side is live (§2.2): "You 34 (40)" at the crease, or what
 * he made once out; never another child's. Null with nothing of his yet.
 * @param {any[]} innings  @param {any} child  @param {boolean} self
 */
function liveLineOf(innings, child, self) {
  const who = self ? "You" : (child.knownAs || child.name);
  const inn = innings.at(-1) ?? null;
  const him = inn?.batsmen?.find((b) => b.id === child.id && b.status !== "out" && b.status !== "retired") ?? null;
  if (him && (him.balls > 0 || him.runs > 0 || inn?.striker === child.id || inn?.nonStriker === child.id)) return `${who} ${him.runs} (${him.balls})`;
  const line = lineFor(innings, child.id);
  return line ? `${who}: ${line}` : null;
}

/**
 * His side's match while it is live (§2.1, §1.9): the match card at its board
 * size, his side first, both scores from the one fold, the sentence and HIS
 * line, never another child's name: the scorecard and the moments are one tap
 * away, in the Match Centre (P4).
 */
export function LiveCard({ child, matches, onFollow, now, self = false }) {
  const live = fixturesOf(matches, child, now).live[0] ?? null;
  const fold = useFold(live);
  if (!live) return null;
  const end = endOf(live, child);
  return (
    // No "Live" over it: the card's own state line says so, with the dot (§2.2), once.
    <Card testid="live-card">
      <MatchCard size="board" match={live} ownEnd={end} now={now} testid="family-board" statusTestid="live-card-status"
        fold={fold.innings.length ? { innings: fold.innings, result: fold.result } : null}
        loading={fold.loading && !fold.innings.length}
        line={fold.innings.length ? liveLineOf(fold.innings, child, self) : "The match has started. The first ball is not in yet."} lineTestid="live-card-line"
        action={{ label: openWords(live, end), testid: "live-follow", onClick: () => onFollow(live) }}/>
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
  const end = endOf(last, child);
  return (
    <Card label="Last match" testid="last-match">
      {fold.loading ? <Line quiet>Reading the scorecard…</Line> : (
        // The match card (slice 1): both sides with their scores, the result, and his line.
        <MatchCard size="card" match={last} ownEnd={end} now={now} statusTestid="last-match-result"
          fold={fold.innings.length ? { innings: fold.innings, result: fold.result } : null} resultSaid={result}
          line={line ? (self ? `You: ${line}` : line) : !result && !fold.innings.length ? "No score was recorded for this match." : null}
          lineTestid={line ? "last-match-line" : "last-match-none"}
          action={{ label: openWords(last, end), testid: "last-match-open", onClick: () => onOpen(last) }}/>
      )}
    </Card>
  );
}

/**
 * This season's figures and his latest milestone (§2.1). Not drawn with neither.
 *
 * The milestone says where it came from (RECOGNITION R4, D6): once the scorer
 * has sealed it, the medal and "Rohan's first fifty · 63 v DHS · sealed by the
 * scorer, 12 Sep"; before, a dashed star and "not yet sealed by the scorer".
 * Read through recognition(), which gives a parent her own child's and nobody
 * else's. On a parent's screen his honours follow, a withdrawn one with its
 * date and "the school can say why", never the reason (D3, D4); the pupil
 * reads his own on the Passport's Honours tab.
 */
export function SeasonCard({ child, role, self = false }) {
  const { rows: seasons } = useLive("career_by_season", role);
  const { rows: read } = useLive("recognition", role, 0, { playerId: child.id });
  const { rows: matches } = useLive("matches", role);
  // The opponent from his own end of the fixture: the server's is the host's,
  // which names his own side when the other school hosted.
  const rec = withOpponents(read, matches, (m) => opponentOf(m, child));
  const s = seasons.find((r) => r.id === child.id && r.currentSeason) ?? null;
  const miles = rec.filter((x) => x.family === "milestone");
  const m = miles[0] ?? null;
  const honours = self ? [] : rec.filter((x) => x.family === "honour");
  if (!s && !m && !honours.length) return null;
  // Q12: his average only from thirty balls faced; under that, the count and "a guide, not a figure".
  const avg = s?.innings ? careerAverage(s) : null;
  const bits = s ? [
    s.innings ? `${s.runs} runs in ${s.innings} innings` : null,
    avg ? (avg.held ? `average (${avg.text})` : /balls not recorded/.test(avg.text) ? `average ${avg.text}` : s.avg != null ? `average ${avg.text} from ${avg.count}` : avg.count) : null,
    s.ballsBowled ? `${s.wkts} wicket${s.wkts === 1 ? "" : "s"}` : null,
  ].filter(Boolean) : [];
  const said = m && !self ? familyMilestoneLine(m, familyName(child), isFirst(miles, m)) : null;
  const notes = m && self ? provenanceOf(m) : [];
  return (
    <>
      {(s || m) && (
        <Card label={s?.season ? `This season · ${s.season}` : "This season"} testid="season-card">
          {bits.length > 0 && <p data-testid="season-line" style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, margin: 0 }}>{bits.join(" · ")}</p>}
          {s && !bits.length && <Line quiet>{self ? "You have" : `${child.knownAs || child.name} has`} not batted or bowled this season yet. Your first match will show here.</Line>}
          {m && (
            <Line testid="season-milestone">
              <SealMark sealed={isSealed(m)} testid="season-milestone-seal"/>{" "}
              {said ? said.line : <>{m.label}{m.opponent ? ` · v ${m.opponent}` : ""}{m.on ? ` · ${humanDate(m.on)}` : ""}</>}
              {(said?.note || notes.length > 0) && (
                <span data-testid="season-milestone-note" style={{ color: T.content.secondary }}> · {said ? said.note : notes.join(" · ")}</span>
              )}
            </Line>
          )}
        </Card>
      )}
      {honours.length > 0 && (
        <Card label="Honours" testid="family-honours">
          {honours.map((h) => (
            <Line key={h.id ?? `${h.kind}-${h.season}`} quiet={isWithdrawn(h)}
              testid={isWithdrawn(h) ? "family-honour-withdrawn" : "family-honour"}>
              {honourWords(h, { family: true })}
            </Line>
          ))}
        </Card>
      )}
    </>
  );
}

/**
 * Unread notices about this child or about nobody in particular, last (§2.1).
 * From the notices' one store (lib/notifications.js, D17): a notice opened in
 * Notices, on this device or another, is read here too.
 */
export function NoticesCard({ child, role, onOpen }) {
  const { rows } = useNotifications(role);
  const mine = noticesFor(rows, child);
  // Never a safeguarding notice on Home (EXPERIENCE_PASS Q7): its title says a concern exists; Notices and the bell have it.
  const unread = mine.filter((n) => !n.read && n.type !== "safeguarding");
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

/**
 * What the coach and the school posted (S1, §1.2 job 6): the newest three
 * posts the reader's news read returns, his side's and his school's. A post
 * not yet sent is its author's alone and is not drawn.
 */
export function NewsCard({ child, role }) {
  const { rows } = useLive("news", role);
  // A plan is not "posted" here: it is THE PLAN on its fixture (views/family/plan.jsx), and one notice in Notices.
  const posts = rows.filter((p) => !p.draft && p.kind !== "plan" && (p.scope !== "team" || p.audience === child.team)).slice(0, 3);
  if (!posts.length) return null;
  return (
    <Card label="Posted" testid="news-card">
      {posts.map((p) => (
        <div key={p.id} style={{ display: "grid", gap: "2px" }}>
          <span style={{ ...T.role.body, fontWeight: 600, color: T.content.primary }}>{p.title}</span>
          <span style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{[p.audience, humanDate(String(p.at ?? "").slice(0, 10))].filter(Boolean).join(" · ")}</span>
        </div>
      ))}
    </Card>
  );
}

/** The next training session for his side (S1), from the noticeboard read. Not drawn without one. */
export function TrainingCard({ child, role, now }) {
  const { rows, disabled } = useLive("training", role);
  if (disabled) return null;
  const next = rows.filter((t) => t.team === child.team && t.school === child.school && !t.cancelled && t.date
    && Date.parse(`${t.date}T${t.time ?? "00:00"}:00+02:00`) >= now - 3600e3)   // date and time are SA (asTraining)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  if (!next) return null;
  return (
    <Card label="Training" testid="training-card">
      <Line>{[humanDate(next.date), next.time, next.venue].filter(Boolean).join(" · ")}</Line>
      {next.title && <Line quiet>{next.title}</Line>}
    </Card>
  );
}
