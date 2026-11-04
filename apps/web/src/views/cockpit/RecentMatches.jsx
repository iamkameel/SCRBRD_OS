import { useEffect, useMemo, useState } from "react";
import { deriveMatch, fromRow } from "@scrbrd/scoring";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { profile } from "../../lib/session.js";
import { requestResult } from "../../lib/cockpitNav.js";
import { shortDate } from "../../lib/cockpit.js";
import { clockWords, correctedAt, correctionsOf } from "../../lib/corrections.js";
import { sidesOf } from "../../lib/matchCentre.js";
import { battingWords, bowlingWords, insights, leaders, LEADERS, matchSummary, recentSides } from "../../lib/recentMatches.js";
import { BentoCard } from "../../ui/surfaces.jsx";

/**
 * RECENT MATCHES (pilot item 5): on the coach's Dashboard, beside the
 * match-day card, his side's last few finished matches — the result and each
 * side's total — then our boys' leading run-scorers and wicket-takers across
 * them, and at most two plain insights. The rules are lib/recentMatches.js.
 *
 * Offered by the cockpit's gate and nothing else (D1): a parent, a pupil, a
 * scorer and a spectator are never drawn it, and nothing on their screen
 * suggests one is missing. The boys' figures need player.performance.read on
 * the same assignment; a team manager sees the results and totals only.
 *
 * Its reads are the Match Centre's own, per match: the result read and the
 * log, folded as the scorecard is. A corrected ball moves every figure here
 * on the next read; a match with a correction says when, and the card says
 * when its reads answered ("as at"). It writes nothing and notifies nobody
 * (D11). Not animated: it appears with its figures, as the cards beside it do.
 *
 * @param {{matches: any[], onNav: (page: string) => void}} p
 */
export function RecentMatches({ matches, onNav }) {
  const assignments = signedIn() ? profile()?.assignments : null;
  const sides = useMemo(() => recentSides(matches, assignments), [matches, assignments]);
  if (!sides.length) return null;
  return <>{sides.map((s) => <SideCard key={s.key} side={s} named={sides.length > 1} onNav={onNav}/>)}</>;
}

/**
 * Every pick's two reads, in parallel. `null` for a read that did not answer:
 * the card then says so for that match, never a total of nothing.
 * @param {import("../../lib/recentMatches.js").Side} side
 */
function useRecent(side) {
  const ids = side.picks.map((p) => p.match.id).join(",");
  const [got, setGot] = useState(/** @type {{loading: boolean, rows: {route: any, innings: any[] | null, correctedAt: number | null}[], at: number | null}} */ ({ loading: true, rows: [], at: null }));
  useEffect(() => {
    let cancelled = false;
    setGot((g) => ({ ...g, loading: true }));
    (async () => {
      const rows = await Promise.all(side.picks.map(async ({ match }) => {
        const [route, log] = await Promise.all([
          api(`/api/matches/${match.id}/result`).catch(() => null),
          api(`/api/matches/${match.id}/events`).catch(() => null),
        ]);
        if (!log) return { route, innings: null, correctedAt: null };
        const evs = (log.events ?? []).map(fromRow);
        // Folded as the server folds it (SCRBRD-113), exactly as the scorecard is.
        const { innings } = deriveMatch(evs, log.fold ?? {});
        const recovered = new Map((log.events ?? []).filter((/** @type {any} */ r) => r.recovered).map((/** @type {any} */ r) => [r.seq, Date.parse(r.server_ts)]));
        return { route, innings, correctedAt: correctedAt(correctionsOf(evs, recovered)) };
      }));
      if (!cancelled) setGot({ loading: false, rows, at: Date.now() });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  return got;
}

// Functions, not constants: the theme's tokens are read when drawn, never at import.
const body = () => ({ ...T.role.body, color: T.content.primary, margin: 0 });
const quiet = () => ({ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0 });
const fig = () => ({ ...T.role.figure.sm, fontSize: "14px", color: T.content.primary, whiteSpace: "nowrap" });
const label = () => ({ ...T.role.label, color: T.content.secondary, margin: 0 });
const btn = () => ({ minHeight: "44px", padding: `0 ${T.space.lg}`, background: "transparent", color: T.content.primary,
  border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 });

/** @param {{side: import("../../lib/recentMatches.js").Side, named: boolean, onNav: (page: string) => void}} p */
function SideCard({ side, named, onNav }) {
  const { loading, rows, at } = useRecent(side);
  const first = side.picks[0];
  const ourName = (/** @type {any} */ m, /** @type {"home" | "away"} */ end) => sidesOf(m)[end];
  const theirName = (/** @type {any} */ m, /** @type {"home" | "away"} */ end) => sidesOf(m)[end === "home" ? "away" : "home"];
  const summaries = loading ? [] : side.picks.map(({ match, gate }, i) => matchSummary({
    match, end: gate.end, theirName: theirName(match, gate.end).full,
    route: rows[i]?.route ?? null, innings: rows[i]?.innings ?? null, correctedAt: rows[i]?.correctedAt ?? null,
  }));
  const n = side.picks.length;
  const top = side.figures ? leaders(summaries.map((s) => s.boys)) : null;
  const said = top ? insights(top, n) : [];
  const carded = summaries.filter((s) => s.line.carded).length;
  const unreadLogs = loading ? 0 : rows.filter((r) => r.innings == null).length;
  const open = (/** @type {string} */ id) => { requestResult(id); onNav("matches"); };
  const title = named ? `Recent matches · ${ourName(first.match, first.gate.end).full}` : "Recent matches";

  return (
    <BentoCard level="b" title={title} data-testid="day-recent" data-side={side.key}>
      <div style={{ padding: T.space.lg, display: "grid", gap: T.space.md }}>
        {loading ? <p style={quiet()} data-testid="recent-loading">Reading the scorecards…</p> : (
          <>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: T.space.md }} aria-label="The last finished matches, newest first">
              {side.picks.map(({ match, gate }, i) => {
                const l = summaries[i].line;
                const us = ourName(match, gate.end), them = theirName(match, gate.end);
                const opp = l.opponent || them.full;
                return (
                  <li key={match.id} data-testid={`recent-match-${match.id}`} data-result={l.result ?? ""} data-ours={l.ours ?? ""} data-theirs={l.theirs ?? ""}
                      style={{ display: "grid", gap: "2px", paddingBottom: T.space.md, borderBottom: i < n - 1 ? `1px solid ${T.line.subtle}` : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: T.space.sm, flexWrap: "wrap" }}>
                      <span style={{ ...body(), fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>v {opp}</span>
                      {l.date && <span style={quiet()}>{shortDate(l.date)}</span>}
                    </div>
                    {l.resultRead ? (
                      <>
                        <p data-testid="recent-result" style={body()}>{l.result ?? "No result recorded"}</p>
                        <p data-testid="recent-totals" style={quiet()}>
                          {us.short} <span style={fig()}>{l.ours ?? "did not bat"}</span>
                          {" · "}{them.short} <span style={fig()}>{l.theirs ?? "did not bat"}</span>
                        </p>
                      </>
                    ) : <p data-testid="recent-unread" style={quiet()}>The result could not be read just now. That is not the same as there being none.</p>}
                    {l.correctedAt != null && <p data-testid="recent-corrected" style={quiet()}>Corrected {clockWords(l.correctedAt)}: the figures here are the corrected ones.</p>}
                    <button type="button" className="os-state" data-testid={`recent-open-${match.id}`} onClick={() => open(match.id)}
                            aria-label={`Open the match against ${opp}`} style={{ ...btn(), justifySelf: "start", marginTop: T.space.xs }}>
                      Open the match
                    </button>
                  </li>
                );
              })}
            </ol>

            {top && (
              <div style={{ display: "grid", gap: T.space.md, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
                <Leaders testid="recent-bat" heading="Runs" rows={top.batting.slice(0, LEADERS).map((b) => ({ id: b.id, name: b.name, figure: battingWords(b) }))}
                         none="No batting card of ours in these matches."/>
                <Leaders testid="recent-bowl" heading="Wickets" rows={top.bowling.slice(0, LEADERS).map((b) => ({ id: b.id, name: b.name, figure: bowlingWords(b) }))}
                         none="No wicket of ours on these scorecards."/>
              </div>
            )}

            {said.length > 0 && (
              <div data-testid="recent-insights" style={{ display: "grid", gap: T.space.xs }}>
                <h3 style={label()}>Over these matches</h3>
                {said.map((s) => (
                  <p key={s.key} data-testid={`recent-insight-${s.key}`} style={body()}>
                    {s.text}{s.rate && <span style={quiet()}> {s.rate}</span>}
                  </p>
                ))}
              </div>
            )}

            <p data-testid="recent-source" style={quiet()}>
              From each match's result and scorecard{top ? `; our boys only, from ${carded} of ${n} ${n === 1 ? "scorecard" : "scorecards"}` : ""}
              {unreadLogs ? `; ${unreadLogs} ${unreadLogs === 1 ? "scorecard" : "scorecards"} could not be read` : ""}
              {at != null && <> · <span data-testid="recent-asat">as at {clockWords(at)}</span></>}
            </p>
          </>
        )}
      </div>
    </BentoCard>
  );
}

/** @param {{testid: string, heading: string, rows: {id: string, name: string, figure: string}[], none: string}} p */
function Leaders({ testid, heading, rows, none }) {
  return (
    <div data-testid={testid} style={{ display: "grid", gap: T.space.xs, minWidth: 0 }}>
      <h3 style={label()}>{heading}</h3>
      {rows.length ? (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "2px" }}>
          {rows.map((r) => (
            <li key={r.id} data-testid={`${testid}-${r.id}`} data-figure={r.figure} style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm }}>
              <span style={{ ...body(), minWidth: 0, overflowWrap: "anywhere" }}>{r.name}</span>
              <span style={fig()}>{r.figure}</span>
            </li>
          ))}
        </ol>
      ) : <p style={quiet()}>{none}</p>}
    </div>
  );
}
