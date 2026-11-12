import { useEffect, useMemo, useRef, useState } from "react";
import { deriveMatch } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { DisplayView, useWakeLock } from "../../display/DisplayView.jsx";
import { forGround, groundInnings, groundNameOf, namedOnGround } from "../../display/groundNames.js";
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
 * A MARKED BOY BY HIS POSITION (PUBLIC_BY_TERMS §2.5, slice 1). The screen
 * faces the crowd, so a boy under a never-public mark is "Batter", "Bowler"
 * or "Fielder" on it, while the Match Centre beneath still names him for its
 * signed-in reader (083 §7). The server says who (db/153), and the log is
 * folded and told again here under that answer (display/groundNames.js).
 * Until it answers, and if it never does, every boy with a row is his
 * position: the screen fails closed. Read again whenever the log grows, so a
 * mark set during play reaches the screen at the next ball; a failed re-read
 * keeps the last answer.
 *
 * Attended and signed in, as Q9 decided: a labelled "Exit big screen" and
 * Escape leave it; Space pauses the panels' rotation (WCAG 2.2.2) and Space
 * again resumes it. It holds a screen wake lock where the browser allows one.
 * It is fed by the Match Centre's own live read, so it refreshes itself.
 */
export function BigScreen({ match, events, fold, players = [], result, settled, onClose, par = null }) {
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
  const rows = useGroundPositions(match.id, events?.length ?? 0);
  const ground = useMemo(() => {
    const log = events ?? [];
    const named = namedOnGround(rows);
    const { events: evs, hidden } = forGround(log, named);
    const folded = deriveMatch(evs, fold ?? {});
    groundInnings(folded.innings, named, hidden);
    const played = folded.innings.filter(Boolean);
    const nameOf = groundNameOf(nameBook(played, players), named, hidden);
    const teamName = (/** @type {unknown} */ _key, /** @type {string} */ name) => teamOf(match, name).full;
    // The Match Centre's generator and wording (MatchView), over the same
    // log; only whom it may name differs.
    const commentary = superOverCommentary(deriveCommentary(log, { ctx: fold ?? {}, nameOf, teamName }), folded.innings, { teamName });
    return { events: evs, played, commentary };
  }, [events, fold, rows, players, match]);
  return (
    <DisplayView match={match} events={ground.events} fold={fold ?? {}} innings={ground.played} result={result} settled={settled}
      commentary={ground.commentary} ready settings={{ theme: "floodlit", dwell: "normal", reduceMotion: false }}
      onClose={() => leave.current()} paused={paused} par={par}/>
  );
}

/**
 * Who the big screen shows by position (GET /api/read/ground_screen_positions,
 * db/153): the server's rows, or null before the first answer. Asked again
 * when the log grows (`seen`); a failed read keeps what was answered last.
 * @param {string} matchId  @param {unknown} seen
 */
function useGroundPositions(matchId, seen) {
  const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
  useEffect(() => {
    let cancelled = false;
    api(`/api/read/ground_screen_positions?matchId=${encodeURIComponent(matchId)}`)
      .then((d) => { if (!cancelled) setRows(Array.isArray(d?.rows) ? d.rows : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [matchId, seen]);
  return rows;
}
