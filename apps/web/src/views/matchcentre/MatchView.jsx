import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "../../design/tokens.js";
import { useTheme } from "../../design/theme.js";
import { deriveMatch, fromRow } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { api, signedIn } from "../../lib/api.js";
import { useRows, useWeather } from "../../lib/live.js";
import { boardInnings, inningsPhase, matchLine, nameBook, resultText, revisionNotice, sidesOf, teamOf } from "../../lib/matchCentre.js";
import { seedCompletedMatch } from "../../scorer/seed.js";
import { PlayerProfileModal, parseBalls, parseScore, teamSquad } from "../shared.jsx";
import { can, filterRecord } from "../../rbac/index.js";
import { ShotWheel } from "../../scorer/charts.jsx";
import { useIsMobile } from "../../shell/MobileNav.jsx";
import { Icon } from "../../ui/icons.jsx";
import { ErrorBoundary } from "../../ui/ErrorBoundary.jsx";
import { AnalyticsTab, CommentaryTab, DetailsTab, PartnershipsTab, SummaryTab } from "./tabs.jsx";
import { ScorecardTab } from "./scorecard.jsx";
import { Quiet, SideName } from "./bits.jsx";
import { ConfirmScorecardPrompt, OnwardLinks, PreTossCard, RevisionBanner } from "./fulltime.jsx";
import { liveRefreshMs, useMoments, useTicker } from "./live.js";
import { BigScreen } from "./spectator.jsx";

/**
 * THE MATCH CENTRE — one fixture, followed (DESIGN_DIRECTION §10, step 3c).
 *
 * Kameel's 2.0 spectator Match Center, rebuilt on the redesign's foundations:
 * the sides named in full where there is room and by code where not, the
 * match line under the title, and six tabs in the prototype's order —
 * Summary (the Board, with its Tier 2 line), Scorecard (p7–p9), Commentary
 * (the shared generator, SCRBRD-098), Partnerships, Analytics and Match
 * details.
 *
 * SIGNED IN. Everything here is read from the match's own ball log —
 * `GET /api/matches/:id/events`, folded by @scrbrd/scoring — the read the
 * scorecard always used. Names are the ones the log carries (the squads the
 * scorer's pad wrote), exactly as the scorecard shows them; the commentary
 * takes them through its `nameOf` hook. Nothing here is public: the public
 * page (SCRBRD-083, src/public/PublicMatch.jsx) is its own component, which
 * shares this view's tabs (tabs-core.jsx, scorecard.jsx) over a log the
 * server has already redacted, and imports nothing signed-in.
 *
 * Signed out (the demonstration), the fixture's summary score is
 * reconstructed by the seeder, as the Scorecard always was, and says so; it
 * has no log, so it has no commentary.
 */

const TABS = [
  { id: "summary",      label: "Summary" },
  { id: "scorecard",    label: "Scorecard" },
  { id: "commentary",   label: "Commentary" },
  { id: "partnerships", label: "Partnerships" },
  { id: "analytics",    label: "Analytics" },
  { id: "details",      label: "Match details" },
];


/**
 * The match's log and its fold. A signed-in session reads the real log and
 * never falls back to a reconstruction (a fabricated number beside a real
 * name reads exactly like a true one); the demonstration seeds one.
 */
function useMatchLog(match, players) {
  const [state, setState] = useState(() => ({ loading: signedIn(), error: null, events: null }));
  const live = match.status === "live";
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live || !signedIn()) return undefined;
    const t = setInterval(() => { if (!document.hidden) setTick((x) => x + 1); }, liveRefreshMs());
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => {
    if (!signedIn()) { setState({ loading: false, error: null, events: null }); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: s.events == null, error: null }));
    (async () => {
      try {
        // `fold`: how the server folds this match — the fixture's start and
        // format (SCRBRD-113) — so the scorecard here folds it alike.
        const { events: rows, fold } = await api(`/api/matches/${match.id}/events`);
        if (!cancelled) setState({ loading: false, error: null, events: (rows || []).map(fromRow), fold: fold ?? {} });
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: e.code || "unreachable" }));
      }
    })();
    return () => { cancelled = true; };
  }, [match.id, tick]);

  const demo = useMemo(() => {
    if (signedIn()) return null;
    const inns = [];
    if (match.scorecard?.home) inns.push({ ...parseScore(match.scorecard.home.score), balls: parseBalls(match.scorecard.home.overs) });
    if (match.scorecard?.away) inns.push({ ...parseScore(match.scorecard.away.score), balls: parseBalls(match.scorecard.away.overs) });
    if (!inns.length) return { innings: [], cfg: { overs: match.overs || 20 } };
    return seedCompletedMatch({
      matchId: match.id, team1: match.homeTeam, team2: match.awayTeam,
      squad1: teamSquad(match.homeTeam, players), squad2: teamSquad(match.awayTeam, players),
      inns: inns.map((x) => ({ runs: x.runs, wickets: x.wkts, balls: x.balls })),
      liveLast: match.status !== "complete",
    });
  }, [match, players]);

  const folded = useMemo(() => (state.events ? deriveMatch(state.events, state.fold ?? {}) : null), [state.events, state.fold]);
  return {
    loading: state.loading, error: state.error, events: state.events, fold: state.fold ?? {}, demo: !!demo,
    innings: folded ? folded.innings : (demo?.innings ?? []),
    result: folded ? folded.result : null,
    overs: match.overs || folded?.innings?.[0]?.overs || demo?.cfg?.overs || 20,
  };
}

/**
 * The result as the server reads it (SCRBRD-114 phase 3a, db/69): play from
 * the log, the match's status, and a decision taken off the field — a
 * concession, a walkover, an organiser's award — which no fold of the log can
 * see. Re-read when the log moves. Null while signed out, for a demonstration
 * fixture, or when the server could not say.
 * @param {any} match  @param {unknown} seen  what the log has grown to
 */
function useServerResult(match, seen) {
  const [result, setResult] = useState(/** @type {any} */ (null));
  useEffect(() => {
    if (!signedIn() || !match.live) { setResult(null); return undefined; }
    let cancelled = false;
    api(`/api/matches/${match.id}/result`)
      .then((d) => { if (!cancelled) setResult(d?.result ?? null); })
      .catch(() => { if (!cancelled) setResult(null); });
    return () => { cancelled = true; };
  }, [match.id, match.live, match.status, seen]);
  return result;
}

/** The tablist: arrow keys move along it, Home and End to its ends (WAI-ARIA tabs). */
function TabBar({ tab, setTab }) {
  const refs = useRef({});
  const onKey = (e, i) => {
    const n = TABS.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n
      : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to == null) return;
    e.preventDefault();
    setTab(TABS[to].id);
    refs.current[TABS[to].id]?.focus();
  };
  return (
    <div role="tablist" aria-label="Match Centre" data-testid="mc-tabs"
      style={{ display: "flex", gap: T.space.xs, overflowX: "auto", borderBottom: `1px solid ${T.line.normal}`,
        margin: `${T.space.lg} 0`, scrollbarWidth: "thin" }}>
      {TABS.map((t, i) => {
        const on = t.id === tab;
        return (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" type="button"
            id={`mc-tab-${t.id}`} data-testid={`mc-tab-${t.id}`} aria-selected={on} aria-controls={`mc-panel-${t.id}`}
            tabIndex={on ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={(e) => onKey(e, i)}
            className="os-state"
            style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, flexShrink: 0, cursor: "pointer",
              background: "transparent", border: "none", borderBottom: `2px solid ${on ? T.brand.accentText : "transparent"}`,
              marginBottom: "-1px", color: on ? T.content.primary : T.content.secondary,
              fontFamily: T.type.body, fontSize: "14px", fontWeight: on ? 600 : 500, whiteSpace: "nowrap" }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * `focus` is FAMILY MODE (step 4 G13): the player ids this reader is here for
 * — a parent's child, a pupil himself. Their rows are lit on the scorecard
 * with `focusLabel` beside the name ("Your child", "You"), and the Analytics
 * tab offers a per-player wheel for them only, because another child's row is
 * not one this reader may open (§2.1 P4). Everything else is the Match Centre
 * as every signed-in reader has it.
 */
function MatchView({ match, role, onClose, onNavProfile, onOpenScorer, canScoreIt, matches, onOpenFixture, onTeamResults, focus = null, focusLabel = null, backLabel = "All matches" }) {
  useTheme();
  const COMPETITIONS = useRows("competitions", role);
  const PLAYERS = useRows("players", role);
  const WEATHER = useWeather(role);
  const log = useMatchLog(match, PLAYERS);
  const phone = useIsMobile(640);
  const [tab, setTab] = useState("summary");
  const played = log.innings.filter(Boolean);
  // The innings the Scorecard, Partnerships and Analytics tabs are on: the
  // one in play, until the reader picks another.
  const [picked, setPicked] = useState(null);
  const inningsSel = picked ?? Math.max(0, played.length - 1);

  const sides = sidesOf(match);
  const comp = COMPETITIONS.find((c) => c.id === match.competition);
  const weather = WEATHER[match.id] ?? null;
  const phase = inningsPhase(played, log.result);
  const line = matchLine({ match, competition: comp?.name ?? null, weather, phase: log.demo ? null : phase });

  // The commentary: the shared generator, over the same log the scorecard
  // folds, with the names the log carries. Health and discipline are not
  // said here (a spectator surface); the pad, the scorer's own, says them.
  const commentary = useMemo(() => {
    if (!log.events) return [];
    const nameOf = nameBook(played, PLAYERS);
    return deriveCommentary(log.events, {
      ctx: log.fold,
      nameOf: (ref) => nameOf(ref),
      teamName: (_key, name) => teamOf(match, name).full,
    });
    // `played` is derived from log.events; PLAYERS is the roster read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.events, PLAYERS, match.id]);

  // The server's words where it has a result (SCRBRD-114 phase 3a: a no
  // result, a draw, a decision beside play); the fold's while it has none.
  const server = useServerResult(match, log.events?.length ?? 0);
  const result = (server && server.outcome !== "in_progress" ? server.text : null)
    ?? resultText(match, log.result) ?? (match.status === "complete" ? match.result : null);

  // The result, in one clear moment (SCRBRD-100 item 3): a synthetic line,
  // added only once the fold has actually decided the match, so it arrives
  // through the SAME "only while the page is open" gate every other moment
  // does — a reload never replays it. Its key is stable per match, so it can
  // only ever fire once.
  const momentsFeed = useMemo(() => {
    if (!log.result || !commentary.length) return commentary;
    return [...commentary, { innings: Math.max(0, played.length - 1), over: 0, ball: 0, kind: "result", text: result, key: `result:${match.id}` }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentary, log.result, result, match.id]);

  // The spectator's moments: only what arrives while the page is open, so a
  // reload replays nothing. And the board's run count, ticking up to a new
  // total rather than jumping to it.
  const { moment, overSummary } = useMoments(momentsFeed, !log.loading && !!log.events);
  const bi = boardInnings(played, log.result);
  const boardInn = played[bi.index] ?? null;
  const shownRuns = useTicker(boardInn?.runs, `${match.id}:${bi.index}`);
  const boardTarget = bi.index === 1 && played[1] ? (played[1].target ?? played[0].runs + 1) : null;
  const [big, setBig] = useState(false);

  // A rain delay or interruption (SCRBRD-100 item 1): the one signal the log
  // actually carries, off the innings the board is showing.
  const notice = revisionNotice(boardInn);
  const isLive = match.status === "live";

  // What the Scorecard's rows open to, which only a signed-in reader has
  // (scorecard.jsx takes these rather than importing them, so the public page
  // can share the tab): the row opens, with the batter's wagon wheel, and his
  // profile where the reader's role reads profiles at all.
  const [prof, setProf] = useState(null);
  const profileOf = (id) => {
    if (!can(role, "players", "r").allowed) return null;
    const p = PLAYERS.find((x) => x.id === id);
    return p ? () => setProf(filterRecord(role, "players", p)) : null;
  };

  const ctx = { match, role, innings: played, result, commentary, events: log.events, demo: log.demo, overs: log.overs,
    inningsSel, setInningsSel: setPicked, phone, players: PLAYERS, weather, competition: comp, onNavProfile, setTab,
    moment, overSummary, shownRuns, opens: signedIn() && !log.demo, profileOf, Wheel: ShotWheel,
    focus: focus?.length ? new Set(focus) : null, focusLabel };

  return (
    <div className="os-page" data-testid="match-view" data-match={match.id}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.sm, flexWrap: "wrap", marginBottom: T.space.md }}>
        <button type="button" onClick={onClose} data-testid="mc-back" className="pressBtn os-state"
          style={{ minHeight: "44px", padding: `0 ${T.space.md}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
            background: "transparent", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer",
            color: T.content.primary, fontFamily: T.type.body, fontSize: "14px", fontWeight: 500 }}>
          <Icon name="chevron-left"/> {backLabel}
        </button>
        <span style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        {!log.demo && played.length > 0 && (
          <button type="button" onClick={() => setBig(true)} data-testid="mc-bigscreen-open" className="pressBtn os-state"
            style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
              background: T.board.face, color: T.board.figure, border: `1px solid ${T.board.rule}`, borderRadius: T.radius.pill,
              cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 }}>
            <Icon name="tv"/> Big screen
          </button>
        )}
        {canScoreIt && (isLive || match.status === "upcoming") && onOpenScorer && (
          <button type="button" onClick={() => onOpenScorer(match)} className="pressBtn"
            style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, background: T.brand.green, color: T.surface.canvas,
              border: "none", borderRadius: T.radius.pill, cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 }}>
            {isLive ? "Open scorer" : "Start scoring"}
          </button>
        )}
        </span>
      </div>
      {big && <BigScreen match={match} inn={boardInn} target={boardTarget} overs={boardInn?.overs ?? log.overs} shownRuns={shownRuns}
        moment={moment} overSummary={overSummary} line={line} onClose={() => setBig(false)}/>}

      <header style={{ display: "grid", gap: T.space.sm }}>
        <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
          {/* The log decides the match before anyone finalises it (match.status
              moves only through scoring.finalise), so a result the fold has
              reached is the header's word: it never says Live over a result. */}
          <span data-testid="mc-status" style={{ ...T.role.label, color: isLive && !log.result ? T.brand.accentText : T.content.secondary,
            display: "inline-flex", alignItems: "center", gap: T.space.xs }}>
            {isLive && !log.result && <span className="live-dot" aria-hidden="true"/>}
            {log.result || (server && server.outcome !== "in_progress") || match.status === "complete" ? "Result" : isLive ? "Live" : "Fixture"}
          </span>
          {log.demo && <span style={{ ...T.role.label, color: T.content.tertiary }}>Demonstration</span>}
        </div>
        <h1 data-testid="mc-title" style={{ ...T.role.title.md, fontSize: phone ? "18px" : "22px", color: T.content.primary, margin: 0 }}>
          {sides.home.full} <span style={{ color: T.content.tertiary, fontWeight: 400 }}>v</span> {sides.away.full}
        </h1>
        {played.length > 0 && (
          <div data-testid="mc-scores" style={{ display: "grid", gap: "2px" }}>
            {played.map((inn, i) => (
              <div key={i} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.md, maxWidth: "520px" }}>
                <span style={{ ...T.role.body, color: T.content.secondary, minWidth: 0 }}>
                  <SideName side={teamOf(match, inn.battingTeam)}/>
                </span>
                <span style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary, whiteSpace: "nowrap" }}>
                  {inn.runs}/{inn.wickets} <span style={{ color: T.content.tertiary }}>({oversShort(inn.balls)})</span>
                </span>
              </div>
            ))}
          </div>
        )}
        {result && <p data-testid="mc-result" style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, margin: 0 }}>{result}</p>}
        {line && <p data-testid="mc-match-line" style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>{line}</p>}
      </header>

      {!log.loading && !log.error && (
        <div style={{ display: "grid", gap: T.space.md, margin: `${T.space.md} 0` }}>
          {/* Before the toss (item 1): the pre-toss facts, in place of a dead end. */}
          {match.status === "upcoming" && played.length === 0 && <PreTossCard match={match} weather={weather}/>}
          {/* A rain delay or interruption (item 1): a clear status, not a frozen board. */}
          {notice && <RevisionBanner notice={notice}/>}
          {/* The full-time screen links onward (item 4) and the confirm-or-correct prompt (item 5) —
              both true of the fixture once it is decided, not of any one tab of it. Never on a
              demonstration fixture: its "log" is a reconstruction with no real amendment to file. */}
          {match.status === "complete" && !log.demo && (
            <>
              <OnwardLinks match={match} sides={sides} matches={matches} onOpenFixture={onOpenFixture} onTeamResults={onTeamResults}/>
              <ConfirmScorecardPrompt match={match} role={role} commentary={commentary} innings={played}/>
            </>
          )}
        </div>
      )}

      <TabBar tab={tab} setTab={setTab}/>

      <div role="tabpanel" id={`mc-panel-${tab}`} aria-labelledby={`mc-tab-${tab}`} data-testid={`mc-panel-${tab}`} tabIndex={0}
        style={{ outline: "none" }}>
        {log.loading ? <Quiet>Loading the match…</Quiet>
          : log.error ? <Quiet>Could not load this match ({log.error}). This is not the same as there being nothing.</Quiet>
          // One boundary per tab's panel, keyed on the tab: a panel that
          // throws is a card in its own place, and the header, the tab bar
          // and the other five tabs stay.
          : <ErrorBoundary key={tab} name={tab === "details" ? "match details" : tab}>
            {tab === "summary" ? <SummaryTab {...ctx}/>
              : tab === "scorecard" ? <ScorecardTab {...ctx}/>
              : tab === "commentary" ? <CommentaryTab {...ctx}/>
              : tab === "partnerships" ? <PartnershipsTab {...ctx}/>
              : tab === "analytics" ? <AnalyticsTab {...ctx}/>
              : <DetailsTab {...ctx}/>}
          </ErrorBoundary>}
      </div>
      {prof && <PlayerProfileModal player={prof} role={role} onClose={() => setProf(null)}
        onFullProfile={onNavProfile ? (id) => { setProf(null); onNavProfile(id); } : null}/>}
    </div>
  );
}

/** "17.5", or "20" for whole overs. @param {number} balls */
const oversShort = (balls) => (balls % 6 === 0 ? String(balls / 6) : `${Math.floor(balls / 6)}.${balls % 6}`);

export { MatchView };
