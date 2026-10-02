import { useEffect, useMemo, useState } from "react";
import { T } from "../design/tokens.js";
import { publicStory, usePublicFeed } from "../public/reads.js";
import { displaySettings } from "./data.js";
import { DisplayGlobals, DisplayView, useWakeLock } from "./DisplayView.jsx";

/**
 * /display/:match — THE GROUND DISPLAY, signed in as nothing (SCRBRD-133 G1,
 * D1). A lazy chunk of the public bundle (public/main.jsx), so /live does
 * not pay for it. It reads exactly what the live page reads — the header and
 * the redacted log, through public/reads.js, same origin, no credentials, no
 * token, no API client — and so can never show a child's name beyond what the
 * live page shows (D3): it has no way to ask for more. It is switched on by
 * the fixture's own publication (D2); unpublished, the shell is the one 404.
 *
 * How it ends (D12): once play has decided the match the result holds, and
 * after ten minutes the display dims and stops reading. A TV left on
 * overnight shows a dim result card and does not touch the API. A
 * publication withdrawn mid-match is a 404 on the next read: "This display is
 * no longer available" over a blank board, and no more reads.
 *
 * Nothing on it is pressed: no button, no link, no focusable thing.
 */

/** After full time the result holds this long, then the display sleeps (D12). */
export const SLEEP_AFTER_MS = 10 * 60_000;
/** A live read this old is stale: "Last updated 14:32 · reconnecting" (§7.4). */
export const STALE_AFTER_MS = 30_000;

/** The sleep, or what a walk asks for through window.__SCRBRD_DISPLAY_SLEEP_MS__ (never under a second). */
const sleepMs = () => {
  const asked = Number(/** @type {any} */ (window).__SCRBRD_DISPLAY_SLEEP_MS__);
  return Number.isFinite(asked) && asked >= 1000 ? asked : SLEEP_AFTER_MS;
};

export function PublicDisplay({ matchId }) {
  const settings = useMemo(() => displaySettings(window.location.search), []);
  const [sleeping, setSleeping] = useState(false);
  const data = usePublicFeed(matchId, { stop: sleeping });
  // Folded again only when what was read changed — not on every quiet poll.
  const { header, fold, events, people } = data;
  const story = useMemo(() => (header ? publicStory({ header, fold, events, people }) : null), [header, fold, events, people]);
  const over = !!story && (story.settled || story.match.status === "complete" || story.match.status === "abandoned");
  const [now, setNow] = useState(() => Date.now());
  useWakeLock(!sleeping);

  // Reduce motion is the setup's choice on a TV nobody can reach the settings of (§4.3).
  useEffect(() => {
    const root = document.documentElement;
    if (settings.reduceMotion) root.setAttribute("data-reduce-motion", "");
    else root.removeAttribute("data-reduce-motion");
    root.style.background = T.board.face;
  }, [settings.reduceMotion]);

  // Full time: the result holds, and after ten minutes the display sleeps.
  useEffect(() => {
    if (!over || sleeping) return undefined;
    const t = setTimeout(() => setSleeping(true), sleepMs());
    return () => clearTimeout(t);
  }, [over, sleeping]);

  // The stale notice's clock, while there is something live to be late for.
  useEffect(() => {
    if (sleeping || story?.match.status !== "live") return undefined;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [sleeping, story?.match.status]);

  if (data.loading) return <Quiet testid="display-loading">Loading the match…</Quiet>;
  if (data.missing) return <Quiet testid="display-missing">This page is not available. The link may be wrong, or the match may not be public.</Quiet>;
  if (!story) return <Quiet testid="display-error">The display could not reach the match{data.error === "busy" ? " — too many requests; it will try again" : ""}.</Quiet>;
  const stale = story.match.status === "live" && !sleeping && data.okAt != null && now - data.okAt > STALE_AFTER_MS;
  return (
    <>
      <DisplayGlobals/>
      <DisplayView match={story.match} events={story.events} fold={data.fold} innings={story.played} result={story.result}
        settled={story.settled} commentary={story.commentary} ready={!data.loading} settings={settings}
        status={{ stale, okAt: data.okAt, gone: data.gone, sleeping }}/>
    </>
  );
}

/** A plain line on the board's black, for the states before there is a board. */
function Quiet({ testid, children }) {
  return (
    <>
      <DisplayGlobals/>
      <main data-testid={testid} style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "max(16px, 4vmin)", background: T.board.face, color: T.board.figure, fontFamily: T.type.body,
        fontSize: "max(20px, 5vmin)", textAlign: "center" }}>
        {children}
      </main>
    </>
  );
}
