import { useMemo, useState } from "react";
import { T } from "../design/tokens.js";
import { useLive } from "../lib/live.js";
import { readState } from "../lib/readState.js";
import { inningsText, seasonOptions, seasonPoints } from "../lib/sideSeason.js";
import { sidesOf } from "../lib/matchCentre.js";
import { teamParts } from "../lib/things.js";
import { requestResult } from "../lib/cockpitNav.js";
import { Card, ReadState, SectionHeader } from "../ui/primitives.jsx";
import { SideSeason } from "./sideseason.jsx";

/** How many completed matches the results list shows (ROLE_DASHBOARDS §6: "Last 5 completed"). */
export const TEAM_RESULTS = 5;

/** A result's letter for the form line. @param {string | null} result  side_season's own word */
export const formLetter = (result) => ({ won: "W", lost: "L", tied: "T", draw: "D", no_result: "NR" })[result ?? ""] ?? null;

/**
 * The results to list, newest first, and the form line over them: the side's
 * completed matches as side_season has them, an abandoned one said and not
 * counted. Pure.
 * @param {ReturnType<typeof seasonPoints>} points  date order
 */
export function teamResults(points) {
  const newest = [...points].reverse();
  const counted = newest.filter((p) => p.result !== "abandoned");
  const shown = counted.slice(0, TEAM_RESULTS);
  const abandoned = newest.slice(0, newest.indexOf(shown[shown.length - 1]) + 1).filter((p) => p.result === "abandoned").length;
  const form = shown.map((p) => formLetter(p.result)).filter(Boolean).join(" ");
  const basis = shown.length === 0 ? null
    : `Last ${shown.length} completed, of the matches this account can read${abandoned ? `; ${abandoned} abandoned, not counted` : ""}`;
  return { shown, form, basis };
}

/**
 * A TEAM'S PAGE (EXPERIENCE_PASS §1.4, §3.5; Q11): one side, opened by its
 * address (/app/teams/<school id>.<code>, lib/things.js) inside the Team home.
 * Its results, newest first, with the form line and what they rest on; then
 * its season, match by match, which is the very panel the side's Stats
 * section draws (views/sideseason.jsx SideSeason, the `side_season` read), so
 * the two cannot differ. Team-level throughout: no child is named here; the
 * squad, who is out and the boys' figures are the Team home's sections, each
 * under its own gate.
 *
 * Every figure is the server's answer to this reader: a reader the read
 * refuses is told so, never shown an empty side. Not built here yet (listed
 * for the slice's record): the competition tables, records, caps and head to
 * head of §3.5.
 *
 * @param {{ role: string, id: string, onNav: (page: string, section?: string | null) => void }} p
 */
export function TeamPage({ role, id, onNav }) {
  const parts = teamParts(id);
  const [nonce, setNonce] = useState(0);
  const read = useLive("side_season", role, nonce, parts ? { schoolId: parts.school, teamCode: parts.code } : null);
  const said = readState(read, { what: "the side’s completed matches" });
  const matches = useLive("matches", role).rows;
  // The side's name, as the fixtures read names it where this reader reads one of its fixtures; else its code.
  const name = useMemo(() => {
    const m = matches.find((x) => x.schoolId === parts?.school && x.homeTeam === parts?.code);
    if (m) return sidesOf(m).home.full;
    const a = matches.find((x) => x.awaySchoolId === parts?.school && x.awayTeamCode === parts?.code);
    return a ? sidesOf(a).away.full : parts?.code ?? "This side";
  }, [matches, parts?.school, parts?.code]);
  const { open } = seasonOptions(read.rows);
  const results = teamResults(seasonPoints(read.rows, open));
  const line = { ...T.role.body, color: T.content.secondary, margin: 0 };

  if (!parts) return <div className="os-page" data-testid="team-page"><Card sx={{ padding: T.space.lg }}><p style={line}>This address does not name a side.</p></Card></div>;
  return (
    <div className="os-page" data-testid="team-page" data-team={parts.code}>
      <SectionHeader title={name} sub={open ? `Season ${open}` : "The side, its results and its season"} color={T.content.primary}/>
      <Card sx={{ padding: T.space.lg, marginBottom: T.space.lg }} data-testid="team-results">
        <h3 style={{ margin: `0 0 ${T.space.sm}`, ...T.role.title.md, color: T.content.primary }}>Results</h3>
        {!["ok", "stale", "empty"].includes(said.state) ? <ReadState read={said} compact testId="team-results-read" onRetry={() => setNonce((n) => n + 1)}/>
          : results.shown.length === 0 ? <p data-testid="team-results-none" style={line}>No completed match of this side's that this account can read, this season. A match it cannot read is not listed, and is not counted as none.</p>
          : (
            <>
              {results.form && <p data-testid="team-form" style={{ ...T.role.title.md, color: T.content.primary, margin: `0 0 ${T.space.xs}` }}>Form {results.form}</p>}
              <p data-testid="team-results-basis" style={{ ...line, marginBottom: T.space.sm }}>{results.basis}</p>
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: T.space.xs }}>
                {results.shown.map((p) => (
                  <li key={p.matchId} data-testid={`team-result-${p.matchId}`}>
                    <button type="button" className="os-state" onClick={() => { requestResult(p.matchId); onNav("matches"); }}
                      style={{ display: "grid", gap: "2px", width: "100%", minHeight: "44px", padding: `${T.space.sm} ${T.space.md}`, textAlign: "left", cursor: "pointer",
                        background: "transparent", color: "inherit", font: "inherit", border: `1px solid ${T.line.subtle}`, borderRadius: T.radius.md }}>
                      <span style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, overflowWrap: "anywhere" }}>v {p.opponent ?? "the opposition"}{p.date ? ` · ${p.date}` : ""}</span>
                      <span style={line}>{p.resultLine ?? "No result recorded"}{inningsText(p.forRuns, p.forWickets, p.forBalls) ? ` · ${inningsText(p.forRuns, p.forWickets, p.forBalls)}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
      </Card>
      {/* The same panel, from the same read, as the side's Stats section (Analytics). */}
      <SideSeason role={role} team={parts.code} players={[{ team: parts.code, school: parts.school }]}/>
    </div>
  );
}
