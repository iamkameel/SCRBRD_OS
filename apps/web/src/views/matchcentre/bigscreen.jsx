import { useEffect, useMemo, useRef, useState } from "react";
import { deriveMatch } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { DisplayView, useWakeLock } from "../../display/DisplayView.jsx";
import { answeredThrough, forGround, groundAnswerOf, groundInnings, groundNameOf, namedOnGround } from "../../display/groundNames.js";
import { api } from "../../lib/api.js";
import { teamOf } from "../../lib/matchCentre.js";
import { superOverCommentary } from "../../lib/superOver.js";

/**
 * BIG-SCREEN MODE (SCRBRD-083 Q9, SCRBRD-133 D11): the Match Centre's board,
 * full screen, legible from the boundary — now the ground display's own view
 * (display/DisplayView.jsx), fed by the Match Centre's signed-in log and
 * names. One component, two feeds, and no third projection to get wrong: the
 * "public names" mode Q9 asked for is opening the ground display itself, from
 * the fixture's Publication section.
 *
 * A MARKED BOY'S SIDE BY POSITION (PUBLIC_BY_TERMS §2.5, slice 1; Kameel,
 * 12 Nov 2026, "Both as recommended", and "Season roster: hide the side all
 * season"). The screen faces the crowd, so while a boy on the host side's
 * roster is under a never-public mark, the whole side is — and the away
 * side always is — "Batter", "Bowler" or "Fielder" on it — never the one position among
 * names — while the Match Centre beneath still names them for its
 * signed-in reader (083 §7). The server says which sides (db/153's
 * ground_screen_names(), through GET /api/matches/:id/ground-names), and the
 * log is folded and told again here under that answer
 * (display/groundNames.js). Until it answers, after a read that fails, and
 * for a boy no side's first squad carries, every boy with a row is his
 * position: the screen fails closed. Read again on every ball, every 45 s
 * and whenever the log is ahead of the answer, so a mark set during play
 * reaches the screen within the minute.
 *
 * AND ONLY WHERE THE PUBLIC PAGE NAMES HIM (Kameel, 12 Nov 2026, 21:00: "we
 * should be masking the names of any boy that doesn't have a public
 * profile"). A boy is named, and by its label, only where the public live
 * page of this match would name him: the server asks the public page's own
 * rule, whether or not the public pages are on. Sides and labels are ONE
 * answer from one statement (useGroundAnswer below; Fable's red-team,
 * 13 Nov, B1), so the screen never sets a flag from one moment beside
 * labels from another. On a fixture that is not published, or when that
 * read fails, nobody is named. The screen never reads the public routes.
 *
 * ONLY THE HOST'S STAFF (Kameel's (a)). The read answers nobody else (the
 * function decides: not a pupil, and player.roster.read or scoring.start at
 * the host's side), and MatchView offers the big screen only to a reader it
 * answered (useGroundSides below).
 *
 * Attended and signed in, as Q9 decided: a labelled "Exit big screen" and
 * Escape leave it; Space pauses the panels' rotation (WCAG 2.2.2) and Space
 * again resumes it. It holds a screen wake lock where the browser allows one.
 * It is fed by the Match Centre's own live read, so it refreshes itself.
 */
export function BigScreen({ match, events, head = null, fold, result, settled, onClose, par = null }) {
  const [paused, setPaused] = useState(false);
  // Held, not watched: the view re-renders on every live read, and the keys
  // are listened for once, when it opens.
  const leave = useRef(onClose);
  leave.current = onClose;
  useWakeLock(true);
  useEffect(() => {
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") { e.stopPropagation(); leave.current(); }
      else if (e.key === " " || e.code === "Space") { e.preventDefault(); setPaused((p) => !p); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const answer = useGroundAnswer(match.id, events, head);
  const ground = useMemo(() => {
    const log = events ?? [];
    const named = namedOnGround(answer, log, answer?.labels ?? null);
    const { events: evs, spoken, hidden } = forGround(log, named);
    const folded = deriveMatch(evs, fold ?? {});
    groundInnings(folded.innings, named, hidden);
    const played = folded.innings.filter(Boolean);
    const nameOf = groundNameOf(named, hidden);
    const teamName = (/** @type {unknown} */ _key, /** @type {string} */ name) => teamOf(match, name).full;
    // The Match Centre's generator and wording (MatchView), over the same
    // log; only whom it may name differs.
    const commentary = superOverCommentary(deriveCommentary(spoken, { ctx: fold ?? {}, nameOf, teamName }), folded.innings, { teamName });
    return { events: evs, played, commentary };
  }, [events, fold, answer, match]);
  return (
    <DisplayView match={match} events={ground.events} fold={fold ?? {}} innings={ground.played} result={result} settled={settled}
      commentary={ground.commentary} ready settings={{ theme: "floodlit", dwell: "normal", reduceMotion: false }}
      onClose={() => leave.current()} paused={paused} par={par}/>
  );
}

/** While the big screen is open it asks again this often, ball or no ball: a mark set at drinks reaches it. */
export const GROUND_REASK_MS = 45_000;

/**
 * The big screen's one answer (GET /api/matches/:id/ground-names,
 * ground_screen_names(), db/153): each side's position-only flag and the
 * labels the public live page would show, from one statement
 * (groundAnswerOf()), or null before it answers and after it fails (every
 * boy is his position). Asked when the screen opens, on every new ball,
 * every GROUND_REASK_MS, and whenever the log on screen (`head`, its
 * highest seq) is ahead of the seq the answer covered (its log_seq).
 * @param {string} matchId  @param {any[] | null | undefined} events  @param {number | null} head
 * @returns {{rows: any[], labels: Map<string, string> | null} | null}
 */
function useGroundAnswer(matchId, events, head) {
  const [answer, setAnswer] = useState(/** @type {{rows: any[], labels: Map<string, string> | null} | null} */ (null));
  const [tick, setTick] = useState(0);
  const through = answeredThrough(answer);
  const behind = head != null && through != null && head > through;
  const seen = events?.length ?? 0;
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), GROUND_REASK_MS);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let cancelled = false;
    api(`/api/matches/${encodeURIComponent(matchId)}/ground-names`)
      .then((d) => { if (!cancelled) setAnswer(groundAnswerOf(d)); })
      .catch(() => { if (!cancelled) setAnswer(null); });
    return () => { cancelled = true; };
  }, [matchId, seen, tick, behind]);
  return answer;
}

/**
 * Whether to offer the big screen (GET /api/read/ground_screen_sides,
 * db/153: ground_screen_names() without its facts, as the caller): `{rows}`,
 * the server's rows, or null before the first answer and after a failed
 * read. Asked when `on` turns on, and again on every new ball after a read
 * that failed. No rows is the server's "not yours": the caller offers no big
 * screen. It names nobody: the screen asks its own one answer
 * (useGroundAnswer above).
 * @param {string} matchId  @param {any[] | null} events  @param {boolean} on
 * @returns {{rows: any[]} | null}
 */
export function useGroundSides(matchId, events, on) {
  const [answer, setAnswer] = useState(/** @type {{rows: any[]} | null} */ (null));
  const [failed, setFailed] = useState(false);
  const seen = failed ? (events?.length ?? 0) : -1;
  useEffect(() => {
    if (!on) { setAnswer(null); return undefined; }
    let cancelled = false;
    api(`/api/read/ground_screen_sides?matchId=${encodeURIComponent(matchId)}`)
      .then((d) => { if (!cancelled) { setAnswer({ rows: Array.isArray(d?.rows) ? d.rows : [] }); setFailed(false); } })
      .catch(() => { if (!cancelled) { setAnswer(null); setFailed(true); } });
    return () => { cancelled = true; };
  }, [matchId, seen, on]);
  return answer;
}
