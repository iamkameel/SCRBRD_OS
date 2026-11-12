import { useEffect, useMemo, useRef, useState } from "react";
import { deriveMatch } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { DisplayView, useWakeLock } from "../../display/DisplayView.jsx";
import { answeredThrough, forGround, groundInnings, groundNameOf, namedOnGround } from "../../display/groundNames.js";
import { api } from "../../lib/api.js";
import { nameBook, teamOf } from "../../lib/matchCentre.js";
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
 * signed-in reader (083 §7). The server says which sides (db/153), and the
 * log is folded and told again here under that answer
 * (display/groundNames.js). Until it answers, after a read that fails, and
 * for a boy no side's first squad carries, every boy with a row is his
 * position: the screen fails closed. Read again on every ball, every 45 s
 * and whenever the log is ahead of the answer, so a mark set during play
 * reaches the screen within the minute.
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
export function BigScreen({ match, events, fold, players = [], sides = null, result, settled, onClose, par = null }) {
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
  const ground = useMemo(() => {
    const log = events ?? [];
    const named = namedOnGround(sides, log);
    const { events: evs, spoken, hidden } = forGround(log, named);
    const folded = deriveMatch(evs, fold ?? {});
    groundInnings(folded.innings, named, hidden);
    const played = folded.innings.filter(Boolean);
    const nameOf = groundNameOf(nameBook(played, players), named, hidden);
    const teamName = (/** @type {unknown} */ _key, /** @type {string} */ name) => teamOf(match, name).full;
    // The Match Centre's generator and wording (MatchView), over the same
    // log; only whom it may name differs.
    const commentary = superOverCommentary(deriveCommentary(spoken, { ctx: fold ?? {}, nameOf, teamName }), folded.innings, { teamName });
    return { events: evs, played, commentary };
  }, [events, fold, sides, players, match]);
  return (
    <DisplayView match={match} events={ground.events} fold={fold ?? {}} innings={ground.played} result={result} settled={settled}
      commentary={ground.commentary} ready settings={{ theme: "floodlit", dwell: "normal", reduceMotion: false }}
      onClose={() => leave.current()} paused={paused} par={par}/>
  );
}

/** While the big screen is open it asks again this often, ball or no ball: a mark set at drinks reaches it. */
export const GROUND_REASK_MS = 45_000;

/**
 * Which sides the big screen shows by position (GET /api/read/
 * ground_screen_sides, db/153): `{rows}`, the server's rows, or null before
 * the first answer and after a failed read (so every boy is his position).
 * Asked when `on` turns on or `follow` changes; while `follow` (the screen is
 * open) again on every new ball, every GROUND_REASK_MS, and whenever the log
 * on screen (`head`, its highest seq) is ahead of the seq the answer covered
 * (its log_seq). No rows is the server's "not yours": the caller offers no
 * big screen.
 * @param {string} matchId  @param {any[] | null} events  @param {number | null} head
 * @param {boolean} on  @param {boolean} [follow]
 * @returns {{rows: any[]} | null}
 */
export function useGroundSides(matchId, events, head, on, follow = false) {
  const [answer, setAnswer] = useState(/** @type {{rows: any[]} | null} */ (null));
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const through = answeredThrough(answer);
  const behind = follow && head != null && through != null && head > through;
  const seen = follow || failed ? (events?.length ?? 0) : -1;
  useEffect(() => {
    if (!follow) return undefined;
    const t = setInterval(() => setTick((x) => x + 1), GROUND_REASK_MS);
    return () => clearInterval(t);
  }, [follow]);
  useEffect(() => {
    if (!on) { setAnswer(null); return undefined; }
    let cancelled = false;
    api(`/api/read/ground_screen_sides?matchId=${encodeURIComponent(matchId)}`)
      .then((d) => { if (!cancelled) { setAnswer({ rows: Array.isArray(d?.rows) ? d.rows : [] }); setFailed(false); } })
      .catch(() => { if (!cancelled) { setAnswer(null); setFailed(true); } });
    return () => { cancelled = true; };
  }, [matchId, seen, on, follow, tick, behind]);
  return answer;
}
