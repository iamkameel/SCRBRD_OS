import { T } from "../design/tokens.js";
import { useLive } from "../lib/live.js";
import { readState } from "../lib/readState.js";
import { seasonLineWords, seasonOptions, seasonPoints } from "../lib/sideSeason.js";

const bodyText = () => ({ fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.5, color: T.content.secondary });

/**
 * The side's season in one line, for the day sheet (EXPERIENCE_PASS §3.10):
 * the same `side_season` read and the same season the Stats panel opens on (views/sideseason.jsx),
 * so the figure is the one the panel's line ends on (lib/sideSeason.js
 * seasonLineWords). A read that failed is said, never a rate of nothing.
 * @param {{ role: string, school: string, team: string }} p
 */
export function SeasonLine({ role, school, team }) {
  const read = useLive("side_season", role, 0, { schoolId: school, teamCode: team });
  const said = readState(read, { what: "the side’s season" });
  const { open } = seasonOptions(read.rows);
  const words = ["ok", "stale"].includes(said.state) ? seasonLineWords(seasonPoints(read.rows, open)) : null;
  const style = { ...bodyText(), margin: 0 };
  if (said.state === "loading") return <p data-testid="day-season" data-state="loading" style={style}>Reading the season…</p>;
  if (!["ok", "stale", "empty"].includes(said.state)) return <p data-testid="day-season" data-state={said.state} style={style}>{said.sentence}</p>;
  return words ? <p data-testid="day-season" data-state="ok" style={style}>{words}</p> : null;
}
