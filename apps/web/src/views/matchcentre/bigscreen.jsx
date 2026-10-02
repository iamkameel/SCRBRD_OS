import { useEffect, useRef, useState } from "react";
import { DisplayView, useWakeLock } from "../../display/DisplayView.jsx";

/**
 * BIG-SCREEN MODE (SCRBRD-083 Q9, SCRBRD-133 D11): the Match Centre's board,
 * full screen, legible from the boundary — now the ground display's own view
 * (display/DisplayView.jsx), fed by the Match Centre's signed-in fold and
 * names. One component, two feeds, and no third projection to get wrong: the
 * "public names" mode Q9 asked for is opening the ground display itself, from
 * the fixture's Publication section.
 *
 * Attended and signed in, as Q9 decided: a labelled "Exit big screen" and
 * Escape leave it; Space pauses the panels' rotation (WCAG 2.2.2) and Space
 * again resumes it. It holds a screen wake lock where the browser allows one.
 * It is fed by the Match Centre's own live read, so it refreshes itself.
 */
export function BigScreen({ match, events, fold, innings, result, settled, commentary, onClose }) {
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
  return (
    <DisplayView match={match} events={events ?? []} fold={fold ?? {}} innings={innings} result={result} settled={settled}
      commentary={commentary} ready settings={{ theme: "floodlit", dwell: "normal", reduceMotion: false }}
      onClose={() => leave.current()} paused={paused}/>
  );
}
