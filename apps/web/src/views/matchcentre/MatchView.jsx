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
import { HeaderScores } from "./scores.jsx";
import { liveSuperOverLine, matchInningsOf, superOverCommentary } from "../../lib/superOver.js";
import { Quiet } from "./bits.jsx";
import { ConfirmScorecardPrompt, OnwardLinks, PreTossCard, RevisionBanner } from "./fulltime.jsx";
import { liveRefreshMs, useMoments, useTicker } from "./live.js";
import { BigScreen } from "./bigscreen.jsx";
import { CaptainTab } from "./captainTab.jsx";
import { termsOf } from "../../lib/captain.js";
import { cockpitGate } from "../../lib/cockpit.js";
import { profile } from "../../lib/session.js";
import { CoachTab } from "../cockpit/CoachTab.jsx";
import { afterTheMatch, clockWords, correctedAt, correctedInnings, correctionsOf, correctionText, withCorrectionLines } from "../../lib/corrections.js";
import { ballLine } from "../../lib/correctionEffect.js";
import { CorrectedChip, StaleLine } from "./corrected.jsx";
import { CorrectionsSheet, pendingWords } from "./corrections.jsx";

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
 *
 * While the match is live the log is read again on every poll and the
 * figures follow it, as a live board should. Once it is not, the poll asks
 * only whether the log has grown past the head on screen (`?since=head`): a
 * correction made after the match — an approved amendment, a released ball —
 * then says "Updated · refresh", and the figures change on the reader's tap,
 * never under his finger (GA-I36 §7; there is no push, Kameel 8 Oct). A
 * failed poll keeps the match on screen and says so, with the time of the
 * read it is showing (I08).
 */
function useMatchLog(match, players) {
  const [state, setState] = useState(() => ({ loading: signedIn(), error: null, events: null, recovered: new Map(), head: 0,
    okAt: null, stale: false, refreshing: false, failed: false }));
  const live = match.status === "live";
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live || !signedIn()) return undefined;
    const t = setInterval(() => { if (!document.hidden) setTick((x) => x + 1); }, liveRefreshMs());
    return () => clearInterval(t);
  }, [live]);
  // Settled: is there a head beyond ours? Asked only once a read is on screen.
  const settledHead = !live && signedIn() && state.events ? state.head : null;
  useEffect(() => {
    if (settledHead == null) return undefined;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const { events: rows } = await api(`/api/matches/${match.id}/events?since=${settledHead}`);
        setState((s) => ({ ...s, failed: false, stale: s.stale || (rows ?? []).some((r) => r.seq > settledHead) }));
      } catch {
        setState((s) => ({ ...s, failed: true }));
      }
    }, liveRefreshMs());
    return () => clearInterval(t);
  }, [match.id, settledHead]);
  useEffect(() => {
    if (!signedIn()) { setState((s) => ({ ...s, loading: false, error: null, events: null })); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: s.events == null, error: null }));
    (async () => {
      try {
        // `fold`: how the server folds this match — the fixture's start and
        // format (SCRBRD-113) — so the scorecard here folds it alike.
        const { events: rows, fold } = await api(`/api/matches/${match.id}/events`);
        // A released held ball says so on its row (db/14); when it was
        // released is the row's server time.
        const recovered = new Map((rows || []).filter((r) => r.recovered).map((r) => [r.seq, Date.parse(r.server_ts)]));
        const head = (rows || []).reduce((m, r) => Math.max(m, r.seq), 0);
        if (!cancelled) setState({ loading: false, error: null, events: (rows || []).map(fromRow), fold: fold ?? {}, recovered, head,
          okAt: Date.now(), stale: false, refreshing: false, failed: false });
      } catch (e) {
        // A read that fails with a match already on screen keeps it there and
        // says so; only a first read that fails has nothing to show.
        if (!cancelled) setState((s) => (s.events ? { ...s, loading: false, refreshing: false, failed: true }
          : { ...s, loading: false, error: e.code || "unreachable" }));
      }
    })();
    return () => { cancelled = true; };
  }, [match.id, tick]);
  const refresh = () => { setState((s) => ({ ...s, refreshing: true })); setTick((x) => x + 1); };

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
    recovered: state.recovered, okAt: state.okAt, stale: state.stale, refreshing: state.refreshing, failed: state.failed, refresh,
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

// ── SCRBRD-130 R3: venue par on the board (db/74) ──
/**
 * "A typical side here would be 61/3 by now" — the server's par at the point
 * the innings has reached, at this ground (GET /api/matches/:id/venue-par),
 * with how it was reckoned; or "No venue par here yet (2 of 5)". Null signed
 * out, for a demonstration fixture, a match with no ground, or once it is over.
 * @param {any} match  @param {unknown} seen  what the log has grown to
 */
function useVenueLine(match, seen) {
  const [line, setLine] = useState(/** @type {{words: string, label: string | null} | null} */ (null));
  useEffect(() => {
    if (!signedIn() || !match.live || match.status === "complete") { setLine(null); return undefined; }
    let cancelled = false;
    api(`/api/matches/${match.id}/venue-par`)
      .then((d) => { if (!cancelled) setLine(d?.words ? { words: d.words, label: d.parAt?.label ?? null } : null); })
      .catch(() => { if (!cancelled) setLine(null); });
    return () => { cancelled = true; };
  }, [match.id, match.live, match.status, seen]);
  return line;
}
// ── end SCRBRD-130 R3 ──

// ── SCRBRD-133 G2: par and pressure (GET /api/matches/:id/par) ──
/**
 * The server's par report for the innings in play — the same one the public
 * read and the ground display serve, for a reader of the result: the ground's
 * par at this point and its track, the DLS par after rain in a chase. The
 * Board shows it only while it speaks for the position the fold stands at
 * (lib/par.js reportFor()). Null signed out and for a demonstration fixture.
 * @param {any} match  @param {boolean} demo  @param {unknown} seen  what the log has grown to
 */
function useParReport(match, demo, seen) {
  const [report, setReport] = useState(/** @type {any} */ (null));
  useEffect(() => {
    if (!signedIn() || demo) { setReport(null); return undefined; }
    let cancelled = false;
    api(`/api/matches/${match.id}/par`)
      .then((d) => { if (!cancelled) setReport(d ?? null); })
      .catch(() => { if (!cancelled) setReport(null); });
    return () => { cancelled = true; };
  }, [match.id, demo, seen]);
  return report;
}
// ── end SCRBRD-133 G2 ──

// ── SCRBRD-130 R2: the rain panel's calculated line (db/75, dls.mjs) ──
/**
 * The server's DLS proposal beside the umpires' figure (GET /api/matches/:id/dls),
 * asked only once rain has touched the log (a stop, or a revision): "SCRBRD
 * calculates 133 (DLS Standard, table v1)" and "umpires 134 · calculated 133"
 * when they differ. Information, never a flag (D1). Nothing without a table:
 * the revision banner already carries the umpires' figures (§4.5).
 * @param {any} match  @param {any[]} innings  @param {unknown} seen
 * @returns {{words: string, difference: string | null} | null}
 */
function useRainLine(match, innings, seen) {
  const rained = innings.some((i) => (i?.interruptions?.length ?? 0) > 0 || i?.revised != null || i?.par != null);
  const [line, setLine] = useState(/** @type {{words: string, difference: string | null} | null} */ (null));
  useEffect(() => {
    if (!signedIn() || !match.live || !rained) { setLine(null); return undefined; }
    let cancelled = false;
    api(`/api/matches/${match.id}/dls`)
      .then((d) => {
        if (cancelled) return;
        setLine(d?.status === "ok" && d.words ? { words: d.words, difference: d.difference ? d.differenceWords : null } : null);
      })
      .catch(() => { if (!cancelled) setLine(null); });
    return () => { cancelled = true; };
  }, [match.id, match.live, rained, seen]);
  return line;
}
// ── end SCRBRD-130 R2 ──

/**
 * The corrections on this match a staff reader's policies show him (GA-I36
 * N1: GET /api/matches/:id/corrections), re-read when the log grows and
 * after a decision. `words` is the fixture's line ("1 correction awaiting
 * approval"), or null with nothing to say — and for a reader no policy
 * admits, that is always (the read answers two empty lists).
 * @param {any} match  @param {boolean} on  @param {unknown} seen  what the log has grown to
 */
function useCorrections(match, on, seen) {
  const [list, setList] = useState(/** @type {any} */ (null));
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) { setList(null); return undefined; }
    let cancelled = false;
    api(`/api/matches/${match.id}/corrections`)
      .then((d) => { if (!cancelled) setList({ amendments: d?.amendments ?? [], held: d?.held ?? [] }); })
      .catch(() => { if (!cancelled) setList(null); });
    return () => { cancelled = true; };
  }, [match.id, on, seen, n]);
  return { list, words: pendingWords(list), reload: () => setN((x) => x + 1) };
}

/**
 * The captain's tab (SCRBRD-138 C3 to C5): after the Summary, only for a boy
 * who holds the honour (the `captain` prop, which the pupil app's match screen
 * passes). Anybody else has the six tabs and nothing suggests one is missing.
 */
const CAPTAIN_TAB = { id: "captain", label: "Captain" };

/**
 * The coach's tab (SCRBRD-136 phase A): after the Summary, for a person whose
 * single assignment covers this fixture's side and grants `team.select` or
 * `player.workload.read` (lib/cockpit.js cockpitGate: by capability, never by
 * title). Anybody else has the six tabs, and nothing suggests one is missing.
 */
const COACH_TAB = { id: "coach", label: "Coach" };

/** The tablist: arrow keys move along it, Home and End to its ends (WAI-ARIA tabs). */
function TabBar({ tab, setTab, tabs = TABS }) {
  const refs = useRef({});
  const onKey = (e, i) => {
    const n = tabs.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n
      : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to == null) return;
    e.preventDefault();
    setTab(tabs[to].id);
    refs.current[tabs[to].id]?.focus();
  };
  return (
    <div role="tablist" aria-label="Match Centre" data-testid="mc-tabs"
      style={{ display: "flex", gap: T.space.xs, overflowX: "auto", borderBottom: `1px solid ${T.line.normal}`,
        margin: `${T.space.lg} 0`, scrollbarWidth: "thin" }}>
      {tabs.map((t, i) => {
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
function MatchView({ match, role, onClose, onNavProfile, onOpenScorer, canScoreIt, matches, onOpenFixture, onTeamResults, focus = null, focusLabel = null, backLabel = "All matches", captain = null, initialTab = null, initialDrawer = false, initialCorrections = false }) {
  useTheme();
  const COMPETITIONS = useRows("competitions", role);
  const PLAYERS = useRows("players", role);
  const WEATHER = useWeather(role);
  const log = useMatchLog(match, PLAYERS);
  const phone = useIsMobile(640);
  // The Coach tab: signed in, the staff screen (not a family's or the captain's), and a grant on this side.
  const staff = useMemo(() => (signedIn() && !captain && !focus?.length ? cockpitGate(profile()?.assignments, match) : null),
    [match, captain, focus]);
  const [tab, setTab] = useState(initialTab === "coach" && staff ? "coach" : "summary");
  // The staff screen: signed in, not a family's or the captain's view.
  const staffScreen = signedIn() && !captain && !focus?.length;
  const corrections = useCorrections(match, staffScreen && !log.demo, log.events?.length ?? 0);
  const [sheet, setSheet] = useState(!!initialCorrections);
  const played = log.innings.filter(Boolean);
  // The innings the Scorecard, Partnerships and Analytics tabs are on: the
  // one in play, until the reader picks another.
  const [picked, setPicked] = useState(null);
  // ...of the match's own innings: a super over has its block on the
  // Scorecard and the board on the Summary, and no place in the toggles.
  const inningsSel = picked ?? Math.max(0, matchInningsOf(played).length - 1);

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
    const teamName = (_key, name) => teamOf(match, name).full;
    // A super over's lines are worded by lib/superOver.js (SCRBRD-114 phase 3b).
    return superOverCommentary(deriveCommentary(log.events, {
      ctx: log.fold,
      nameOf: (ref) => nameOf(ref),
      teamName,
    }), log.innings, { teamName });
    // `played` is derived from log.events; PLAYERS is the roster read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log.events, PLAYERS, match.id]);
  // GA-I36: the corrections the log carries (voids that undid something, and
  // released balls), the latest one's time for the chip, and the innings each
  // moved. Read off the log on screen: nothing stored, nothing fetched.
  const fixes = useMemo(() => (log.events ? correctionsOf(log.events, log.recovered) : []), [log.events, log.recovered]);

  // The server's words where it has a result (SCRBRD-114 phase 3a: a no
  // result, a draw, a decision beside play); the fold's while it has none.
  const server = useServerResult(match, log.events?.length ?? 0);
  // While a super over is being played the engine's "the super over was not
  // completed" is not yet true: the line says it is in progress.
  const liveSO = liveSuperOverLine(played, match.status);
  const venueLine = useVenueLine(match, log.events?.length ?? 0);   // SCRBRD-130 R3
  const rainLine = useRainLine(match, played, log.events?.length ?? 0);   // SCRBRD-130 R2
  const par = useParReport(match, !!log.demo, log.events?.length ?? 0);   // SCRBRD-133 G2
  const result = liveSO ?? (server && server.outcome !== "in_progress" ? server.text : null)
    ?? resultText(match, log.result) ?? (match.status === "complete" ? match.result : null);
  // The result stands once play has decided it: not mid super over, and not
  // a cup tie nobody has yet settled.
  const settled = !!log.result && !liveSO
    && !(log.result.outcome === "tie" && log.result.decidedBy === null && log.fold?.conditions?.["result.tie_break"] === "super_over");
  const over = settled || match.status === "complete";
  // One quiet `correction` line each, team-level, never a moment card.
  const told = useMemo(() => withCorrectionLines(commentary, log.events ?? [], fixes, over), [commentary, log.events, fixes, over]);
  const corrected = useMemo(() => correctedInnings(log.events ?? [], fixes, log.innings), [log.events, fixes, log.innings]);
  // The staff screen names the ball and who signed (by role); a family's or
  // the captain's says what the public page says: when, never who or why.
  const correctionLines = () => {
    if (!staffScreen) return [correctionText(over)];
    const nameOf = nameBook(played, PLAYERS);
    const teamName = (_key, name) => teamOf(match, name).full;
    return [...fixes].reverse().slice(0, 5).map((c) => {
      const when = clockWords(c.at);
      if (c.kind === "recovered") return `${when} · a held ball was released and written at the end of the log`;
      const b = ballLine({ events: log.events ?? [], fold: log.fold, target: c.target, nameOf: (ref) => nameOf(ref), teamName });
      const who = c.approved ? "asked by the scorer and approved" : afterTheMatch(log.events ?? [], c, over) ? "taken back by the scorer" : "taken back by the scorer during play";
      return `${when} · ${who} · removed: ${b ? b.words : "a ball"}`;
    });
  };

  // The result, in one clear moment (SCRBRD-100 item 3): a synthetic line,
  // added only once the fold has actually decided the match, so it arrives
  // through the SAME "only while the page is open" gate every other moment
  // does — a reload never replays it. Its key is stable per match, so it can
  // only ever fire once.
  const momentsFeed = useMemo(() => {
    if (!settled || !told.length) return told;
    return [...told, { innings: Math.max(0, played.length - 1), over: 0, ball: 0, kind: "result", text: result, key: `result:${match.id}` }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [told, settled, result, match.id]);

  // The spectator's moments: only what arrives while the page is open, so a
  // reload replays nothing. And the board's run count, ticking up to a new
  // total rather than jumping to it.
  const { moment, overSummary } = useMoments(momentsFeed, !log.loading && !!log.events);
  const bi = boardInnings(played, log.result);
  const boardInn = played[bi.index] ?? null;
  const shownRuns = useTicker(boardInn?.runs, `${match.id}:${bi.index}`);
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

  const ctx = { match, role, innings: played, result, commentary: told, events: log.events, demo: log.demo, overs: log.overs,
    inningsSel, setInningsSel: setPicked, phone, players: PLAYERS, weather, competition: comp, onNavProfile, setTab,
    moment, overSummary, shownRuns, opens: signedIn() && !log.demo, profileOf, Wheel: ShotWheel,
    focus: focus?.length ? new Set(focus) : null, focusLabel, venueLine, rainLine, par, fold: log.fold, settled,
    captain, terms: captain || staff ? termsOf(log.fold) : null,
    staff, eventCount: log.events?.length ?? 0, initialDrawer };

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
      {big && <BigScreen match={match} events={log.events} fold={log.fold} innings={played} result={result} settled={settled}
        commentary={commentary} par={par} onClose={() => setBig(false)}/>}

      <header style={{ display: "grid", gap: T.space.sm }}>
        <div style={{ display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap" }}>
          {/* The log decides the match before anyone finalises it (match.status
              moves only through scoring.finalise), so a result the fold has
              reached is the header's word: it never says Live over a result. */}
          <span data-testid="mc-status" style={{ ...T.role.label, color: isLive && !(log.result && !liveSO) ? T.brand.accentText : T.content.secondary,
            display: "inline-flex", alignItems: "center", gap: T.space.xs }}>
            {isLive && !(log.result && !liveSO) && <span className="live-dot" aria-hidden="true"/>}
            {(log.result && !liveSO) || (server && server.outcome !== "in_progress" && !liveSO) || match.status === "complete" ? "Result" : isLive ? "Live" : "Fixture"}
          </span>
          {log.demo && <span style={{ ...T.role.label, color: T.content.tertiary }}>Demonstration</span>}
        </div>
        <h1 data-testid="mc-title" style={{ ...T.role.title.md, fontSize: phone ? "18px" : "22px", color: T.content.primary, margin: 0 }}>
          {sides.home.full} <span style={{ color: T.content.tertiary, fontWeight: 400 }}>v</span> {sides.away.full}
        </h1>
        {played.length > 0 && <HeaderScores match={match} played={played} corrected={corrected}/>}
        {result && <p data-testid="mc-result" style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, margin: 0 }}>{result}</p>}
        {line && <p data-testid="mc-match-line" style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>{line}</p>}
        {!log.demo && <CorrectedChip at={correctedAt(fixes)} lines={correctionLines}/>}
        {!log.demo && <StaleLine stale={log.stale} refreshing={log.refreshing} failed={log.failed} okAt={log.okAt} onRefresh={log.refresh}/>}
        {corrections.words && (
          <button type="button" data-testid="mc-corrections-open" onClick={() => { corrections.reload(); setSheet(true); }} className="pressBtn os-state"
            style={{ minHeight: "44px", padding: `0 ${T.space.md}`, justifySelf: "start", display: "inline-flex", alignItems: "center", gap: T.space.xs,
              background: "transparent", border: `1px solid ${T.semantic.warning}`, borderRadius: T.radius.pill, cursor: "pointer",
              color: T.content.primary, fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 }}>
            {corrections.words} <span aria-hidden="true">›</span>
          </button>
        )}
      </header>
      {sheet && staffScreen && !log.demo && log.events && (
        <CorrectionsSheet match={match} events={log.events} fold={log.fold} commentary={commentary} list={corrections.list}
          onClose={() => setSheet(false)} onDecided={() => { corrections.reload(); log.refresh(); }}/>
      )}

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
              <ConfirmScorecardPrompt match={match} role={role} commentary={commentary} innings={played} onFiled={corrections.reload}/>
            </>
          )}
        </div>
      )}

      <TabBar tab={tab} setTab={setTab} tabs={captain ? [TABS[0], CAPTAIN_TAB, ...TABS.slice(1)] : staff ? [TABS[0], COACH_TAB, ...TABS.slice(1)] : TABS}/>

      <div role="tabpanel" id={`mc-panel-${tab}`} aria-labelledby={`mc-tab-${tab}`} data-testid={`mc-panel-${tab}`} tabIndex={0}
        style={{ outline: "none" }}>
        {log.loading ? <Quiet>Loading the match…</Quiet>
          : log.error ? <Quiet>Could not load this match ({log.error}). This is not the same as there being nothing.</Quiet>
          // One boundary per tab's panel, keyed on the tab: a panel that
          // throws is a card in its own place, and the header, the tab bar
          // and the other five tabs stay.
          : <ErrorBoundary key={tab} name={tab === "details" ? "match details" : tab}>
            {tab === "summary" ? <SummaryTab {...ctx}/>
              : tab === "captain" && captain ? <CaptainTab {...ctx}/>
              : tab === "coach" && staff ? <CoachTab {...ctx}/>
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

export { MatchView };
