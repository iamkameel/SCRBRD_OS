import { useEffect, useMemo, useRef, useState } from "react";
import { T, GLOBAL_CSS } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { boardInnings, inningsPhase, matchLine, revisionNotice, sidesOf } from "../lib/matchCentre.js";
import { humanDateTime } from "../lib/format.js";
import { SummaryTab, CommentaryTab, PartnershipsTab } from "../views/matchcentre/tabs-core.jsx";
import { InningsToggle, ScorecardTab } from "../views/matchcentre/scorecard.jsx";
import { HeaderScores } from "../views/matchcentre/scores.jsx";
import { matchInningsOf } from "../lib/superOver.js";
import { Panel, Quiet } from "../views/matchcentre/bits.jsx";
import { PreTossCard, RevisionBanner } from "../views/matchcentre/banners.jsx";
import { liveRefreshMs, useAnnouncement, useMoments, useTicker } from "../views/matchcentre/live.js";
import { ErrorBoundary } from "../ui/ErrorBoundary.jsx";
import { publicStory, read } from "./reads.js";

/**
 * THE PUBLIC MATCH PAGE — /live/:match and /scorecard/:match (SCRBRD-083
 * phase 1, docs/design/SCRBRD-083_public_pages.md §2.9, §3.1, §3.2).
 *
 * Signed out, always: this bundle has no sign-in, no token and no API client.
 * It reads three things, same-origin, with no credentials:
 *
 *   /api/public/matches/:id        the header (team facts)
 *   /api/public/matches/:id/log    the event log with the rule already
 *                                  applied on the server: pseudonyms for
 *                                  every player, squads labelled by
 *                                  publicName(), reasons gone, and where a
 *                                  ball went a word ("cover"), never a
 *                                  coordinate (SCRBRD-139, L7 as amended)
 *   /api/public/matches/:id/shots  the team's scoring sectors (L7)
 *
 * and folds the log with the same @scrbrd/scoring the signed-in Match Centre
 * uses, drawing it with the same tabs (tabs-core.jsx, scorecard.jsx). What
 * changes in public mode: labels in place of names; the commentary says a
 * role for a boy it has no name for, names the shot and where it went from
 * the server's word ("driven through cover for four", the signed-in line),
 * and never says a health or discipline matter (`sensitive` is never
 * passed); Analytics is the team's only (no
 * batter's wheel, no matchup — the log has no placement to draw one from);
 * Match details is the header's (no official, no weather, no pitch report);
 * nothing opens a profile.
 */

const TABS = [
  { id: "summary",      label: "Summary" },
  { id: "scorecard",    label: "Scorecard" },
  { id: "commentary",   label: "Commentary" },
  { id: "partnerships", label: "Partnerships" },
  { id: "analytics",    label: "Analytics" },
  { id: "details",      label: "Match details" },
];


/** The phone breakpoint, as the shell's useIsMobile reads it — without the shell. */
function usePhone(px = 640) {
  const query = `(max-width: ${px}px)`;
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const q = window.matchMedia?.(query);
    if (!q) return undefined;
    const on = () => setPhone(q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, [query]);
  return phone;
}

/** The header and the log, polled while the match is live. */
function usePublicMatch(matchId) {
  const [state, setState] = useState({ loading: true, missing: false, error: null, header: null, fold: {}, events: [], people: {}, last: 0 });
  const [tick, setTick] = useState(0);
  const live = state.header?.status === "live";
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => { if (!document.hidden) setTick((x) => x + 1); }, Math.max(5000, liveRefreshMs()));
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ match, fold }, log] = await Promise.all([
          read(`/api/public/matches/${matchId}`),
          read(`/api/public/matches/${matchId}/log`),
        ]);
        if (!cancelled) setState({ loading: false, missing: false, error: null, header: match, fold: fold ?? {}, events: log.events ?? [], people: log.people ?? {}, last: log.last ?? 0 });
      } catch (e) {
        if (cancelled) return;
        // Not found is one answer: unpublished and no such fixture read alike.
        if (e.status === 404) setState((s) => ({ ...s, loading: false, missing: true, error: null }));
        else setState((s) => ({ ...s, loading: false, error: e.status === 429 ? "busy" : "unreachable" }));
      }
    })();
    return () => { cancelled = true; };
  }, [matchId, tick]);
  return state;
}

/** The team's shot sectors, read when the Analytics tab opens. */
function useSectors(matchId, on) {
  const [sectors, setSectors] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    let cancelled = false;
    read(`/api/public/matches/${matchId}/shots`).then((r) => { if (!cancelled) setSectors(r.sectors ?? []); }).catch(() => { if (!cancelled) setSectors([]); });
    return () => { cancelled = true; };
  }, [matchId, on]);
  return sectors;
}

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
    <div role="tablist" aria-label="Match" data-testid="mc-tabs"
      style={{ display: "flex", gap: T.space.xs, overflowX: "auto", borderBottom: `1px solid ${T.line.normal}`, margin: `${T.space.lg} 0` }}>
      {TABS.map((t, i) => {
        const on = t.id === tab;
        return (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" type="button"
            id={`mc-tab-${t.id}`} data-testid={`mc-tab-${t.id}`} aria-selected={on} aria-controls={`mc-panel-${t.id}`}
            tabIndex={on ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={(e) => onKey(e, i)} className="os-state"
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
 * Analytics, team level only (L7): the innings' rates from the fold, and
 * where the side scored its runs, by sector, from the server's aggregate.
 * Nothing keyed to one boy.
 */
function TeamAnalyticsTab({ match, innings, inningsSel, setInningsSel, sectors }) {
  const inn = innings[inningsSel];
  if (!inn) return <Quiet testid="mc-analytics-empty">Nothing has been scored yet.</Quiet>;
  const legal = inn.ballLog.filter((b) => b.type !== "Wd" && b.type !== "Nb");
  const dots = legal.filter((b) => (b.type ?? "run") === "run" && b.value === 0).length;
  const bnds = legal.filter((b) => (b.type ?? "run") === "run" && (b.value === 4 || b.value === 6)).length;
  const mine = (sectors ?? []).filter((s) => s.innings === inningsSel);
  const most = Math.max(1, ...mine.map((s) => s.runs));
  const Kpi = ({ l, v }) => (
    <div style={{ flex: "1 1 120px", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: `${T.space.sm} ${T.space.md}`, background: T.surface.raised }}>
      <div style={{ ...T.role.figure.md, color: T.content.primary }}>{v}</div>
      <div style={{ ...T.role.label, color: T.content.secondary }}>{l}</div>
    </div>
  );
  const H = ({ children }) => <h2 style={{ ...T.role.label, color: T.content.secondary, margin: `${T.space.lg} 0 ${T.space.sm}` }}>{children}</h2>;
  return (
    <section data-testid="mc-analytics" aria-label="Analytics">
      <InningsToggle match={match} innings={innings} inningsSel={inningsSel} setInningsSel={setInningsSel}/>
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <Kpi l="Run rate" v={inn.balls ? ((inn.runs / inn.balls) * 6).toFixed(2) : "—"}/>
        <Kpi l="Dot balls" v={legal.length ? `${Math.round((dots / legal.length) * 100)}%` : "—"}/>
        <Kpi l="Boundaries" v={bnds}/>
        <Kpi l="Extras" v={Object.values(inn.extras).reduce((a, b) => a + b, 0)}/>
      </div>
      <H>Where the runs went — the side, by sector</H>
      {sectors == null ? <Quiet>Loading…</Quiet> : !mine.length ? <Quiet testid="mc-sectors-none">No placement was recorded for this innings.</Quiet> : (
        <TeamWheel sectors={mine} most={most}/>
      )}
    </section>
  );
}

/** Twelve 30° sectors, each shaded by the side's runs there: a team wagon wheel. */
function TeamWheel({ sectors, most }) {
  const R = 110, C = 120;
  const by = new Map(sectors.map((s) => [s.sector, s]));
  const wedge = (seg) => {
    const a0 = ((seg * 30 - 15 - 90) * Math.PI) / 180, a1 = ((seg * 30 + 15 - 90) * Math.PI) / 180;
    return `M ${C} ${C} L ${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A ${R} ${R} 0 0 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)} Z`;
  };
  return (
    <figure data-testid="mc-team-wheel" style={{ margin: 0, display: "grid", gap: T.space.sm, justifyItems: "center" }}>
      <svg viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="Runs by sector for the side">
        <circle cx={C} cy={C} r={R} fill={T.surface.raised} stroke={T.line.normal}/>
        {Array.from({ length: 12 }, (_, seg) => {
          const s = by.get(seg);
          return <path key={seg} d={wedge(seg)} fill={T.sport.batting} fillOpacity={s ? 0.15 + 0.85 * (s.runs / most) : 0}
            stroke={T.line.subtle}/>;
        })}
      </svg>
      <figcaption style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary }}>
        {sectors.reduce((a, s) => a + s.runs, 0)} runs from {sectors.reduce((a, s) => a + s.shots, 0)} scoring shots with a placement.
      </figcaption>
    </figure>
  );
}

/** Match details: the header's facts, and no official, weather or pitch report (§9 Q5). */
function PublicDetailsTab({ match, result }) {
  const sides = sidesOf(match);
  const toss = match.tossWonBy && match.tossDecision
    ? `${(match.tossWonBy === "home" ? sides.home : sides.away).full} won the toss and chose to ${match.tossDecision === "bowl" ? "bowl" : "bat"}`
    : null;
  const rows = [
    ["Format", [match.format, match.overs ? `${match.overs} overs a side` : null].filter(Boolean).join(" · ") || null],
    ["Start", match.date ? humanDateTime(match.date, match.time ?? null) : null],
    ["Ground", match.venue ?? null],
    ["Toss", toss],
    ["Result", result ?? null],
  ].filter(([, v]) => v != null && v !== "");
  return (
    <section data-testid="mc-details" aria-label="Match details">
      <Panel>
        <dl style={{ margin: 0 }}>
          {rows.map(([k, v], i) => (
            <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(110px,160px) 1fr", gap: T.space.md,
              padding: `${T.space.sm} ${T.space.md}`, borderTop: i ? `1px solid ${T.line.subtle}` : "none", minHeight: "44px", alignItems: "center" }}>
              <dt style={{ ...T.role.label, color: T.content.secondary }}>{k}</dt>
              <dd style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </section>
  );
}

export function PublicMatch({ matchId, view }) {
  useTheme();
  const data = usePublicMatch(matchId);
  const phone = usePhone();
  const [tab, setTab] = useState(view === "scorecard" ? "scorecard" : "summary");
  const [picked, setPicked] = useState(null);
  const sectors = useSectors(matchId, tab === "analytics" && !data.missing);

  // The match folded and told (public/reads.js, shared with the ground
  // display): the log made foldable, the fold, the shared generator named by
  // the page's own labels — `sensitive` never passed, so no health or
  // discipline is said on a public page — and the result: the server's words
  // where it has one (SCRBRD-114 phase 3a: sides named, never a boy, never an
  // organiser's reason), "in progress" while a super over is played (3b), the
  // fold's otherwise.
  const story = useMemo(() => publicStory({ header: data.header, fold: data.fold, events: data.events, people: data.people }),
    [data.header, data.fold, data.events, data.people]);
  const match = story?.match ?? null;
  const events = story?.events ?? [];
  const folded = story?.folded ?? null;
  const played = story?.played ?? [];
  // ...of the match's own innings: a super over has its block (SCRBRD-114 phase 3b).
  const inningsSel = picked ?? Math.max(0, matchInningsOf(played).length - 1);
  const commentary = story?.commentary ?? [];
  const liveSO = story?.liveSO ?? null;
  const result = story?.result ?? null;
  const { moment, overSummary } = useMoments(commentary, !data.loading && !!match);
  // What a screen reader is told as each ball arrives (lib/announce.js): the
  // newest only, and nothing for the log as it stood on first load.
  const said = useAnnouncement(commentary, data.events, !data.loading && !!match);
  const bi = boardInnings(played, folded?.result);
  const boardInn = played[bi.index] ?? null;
  const shownRuns = useTicker(boardInn?.runs, `${matchId}:${bi.index}`);

  if (data.loading) return <Frame><Quiet testid="public-loading">Loading the match…</Quiet></Frame>;
  if (data.missing) return <Frame><Quiet testid="public-missing">This page is not available. The link may be wrong, or the match may not be public.</Quiet></Frame>;
  if (!match) return <Frame><Quiet testid="public-error">Could not load this match{data.error === "busy" ? " — too many requests; try again shortly" : ""}.</Quiet></Frame>;

  const sides = sidesOf(match);
  const isLive = match.status === "live";
  const phase = inningsPhase(played, folded?.result);
  const line = matchLine({ match, competition: null, weather: null, phase });
  const notice = revisionNotice(boardInn);
  const ctx = { match, innings: played, result, commentary, events, demo: false, overs: match.overs || 20,
    inningsSel, setInningsSel: setPicked, phone, setTab, moment, overSummary, shownRuns,
    quietMoments: true };   // the region below says it; the moment is drawn, not said twice

  return (
    <Frame>
      <div className="os-page" data-testid="public-match" data-match={matchId}>
        {/* The ball, said (WCAG 4.1.3): "Four runs", "Wicket — bowled", "Wide",
            "End of over 5: 8 runs…". Empty on first load and on a reconnect;
            the latest ball or over only, as it arrives. Keyed on the count so
            the same words twice are two announcements. Nobody is named: the
            words are what happened to the score (lib/announce.js). */}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="public-announcer">
          {said.text && <span key={said.n}>{said.text}</span>}
        </div>
        {/* A boundary round each main section (ui/ErrorBoundary.jsx): the
            scoreboard header, the notices, and the open tab's panel. One that
            fails to draw is a card in its place, and the rest of a live match
            stays on screen. The tab bar, which moves between them, is not
            wrapped. */}
        <ErrorBoundary name="scoreboard">
        <header style={{ display: "grid", gap: T.space.sm }}>
          <span data-testid="mc-status" style={{ ...T.role.label, color: isLive && !(folded?.result && !liveSO) ? T.brand.accentText : T.content.secondary,
            display: "inline-flex", alignItems: "center", gap: T.space.xs }}>
            {isLive && !(folded?.result && !liveSO) && <span className="live-dot" aria-hidden="true"/>}
            {(folded?.result && !liveSO) || (match.result && match.result.outcome !== "in_progress" && !liveSO) || match.status === "complete" ? "Result" : isLive ? "Live" : "Fixture"}
          </span>
          <h1 data-testid="mc-title" style={{ ...T.role.title.md, fontSize: phone ? "18px" : "22px", color: T.content.primary, margin: 0 }}>
            {sides.home.full} <span style={{ color: T.content.tertiary, fontWeight: 400 }}>v</span> {sides.away.full}
          </h1>
          {played.length > 0 && <HeaderScores match={match} played={played}/>}
          {result && <p data-testid="mc-result" style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, margin: 0 }}>{result}</p>}
          {line && <p data-testid="mc-match-line" style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>{line}</p>}
        </header>
        </ErrorBoundary>
        <ErrorBoundary name="match notices">
        <div style={{ display: "grid", gap: T.space.md, margin: `${T.space.md} 0` }}>
          {match.status === "upcoming" && played.length === 0 && <PreTossCard match={match} weather={null}/>}
          {notice && <RevisionBanner notice={notice}/>}
        </div>
        </ErrorBoundary>

        <TabBar tab={tab} setTab={setTab}/>
        <div role="tabpanel" id={`mc-panel-${tab}`} aria-labelledby={`mc-tab-${tab}`} data-testid={`mc-panel-${tab}`} tabIndex={0} style={{ outline: "none" }}>
          <ErrorBoundary key={tab} name={tab === "details" ? "match details" : tab}>
            {tab === "summary" ? <SummaryTab {...ctx}/>
              : tab === "scorecard" ? <ScorecardTab {...ctx}/>
              : tab === "commentary" ? <CommentaryTab {...ctx}/>
              : tab === "partnerships" ? <PartnershipsTab {...ctx}/>
              : tab === "analytics" ? <TeamAnalyticsTab {...ctx} sectors={sectors}/>
              : <PublicDetailsTab {...ctx}/>}
          </ErrorBoundary>
        </div>
        <p data-testid="public-note" style={{ ...T.role.body, fontSize: "13px", color: T.content.tertiary, margin: `${T.space.xl} 0 0` }}>
          Players are named here only where their school and family have agreed to it; everyone else is shown by position.
        </p>
      </div>
    </Frame>
  );
}

/** The page around it: the global sheet, a readable width, the gutters. */
function Frame({ children }) {
  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <main style={{ maxWidth: "960px", margin: "0 auto", padding: `${T.space.lg} ${T.space.md}`, minHeight: "100vh" }}>
        {children}
      </main>
    </>
  );
}
