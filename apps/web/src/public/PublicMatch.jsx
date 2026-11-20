import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { T, GLOBAL_CSS } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";
import { boardInnings, boundaryCount, matchLine, revisionNotice, sideOfTeam, sidesOf, teamOf, tossWords } from "../lib/matchCentre.js";
import { cardModel, paceWords } from "../lib/matchCard.js";
import { MatchCardCore, UpdatedAgo } from "../ui/matchCardCore.jsx";
import { FollowOffer } from "./followOffer.jsx";
import { humanDateTime } from "../lib/format.js";
import { SummaryTab, CommentaryTab, PartnershipsTab } from "../views/matchcentre/tabs-core.jsx";
import { SourcedLazy, ballsLine, shotsCaptured } from "../ui/sourcedLazy.jsx";
import { InningsToggle, ScorecardTab } from "../views/matchcentre/scorecard.jsx";
import { SuperOverScores, markedInnings } from "../views/matchcentre/scores.jsx";
import { matchInningsOf } from "../lib/superOver.js";
import { Panel, Quiet } from "../views/matchcentre/bits.jsx";
import { RevisionBanner } from "../views/matchcentre/banners.jsx";
import { liveRefreshMs, soonRefreshMs, useAnnouncement, useMoments, useTicker } from "../views/matchcentre/live.js";
import { ErrorBoundary } from "../ui/ErrorBoundary.jsx";
import { publicStory, read, readPar, samePeople } from "./reads.js";
import { dottedNames } from "./publicLog.js";
import { LOW_LIVE_FACTOR, LOW_SOON_FACTOR, useLowData } from "./lowData.js";
import { publicOfficial } from "../lib/official.js";
import { StateLabel } from "../ui/stateLabel.jsx";
import { TabStrip, panelLabel } from "../views/matchcentre/tabStrip.jsx";
import { NARROW_PX, parsePublicPath, publicPath, tabOr } from "../lib/matchTabs.js";
import { navigate, usePath } from "../lib/route.js";

/**
 * THE PUBLIC MATCH PAGE — /live/:match and /scorecard/:match (SCRBRD-083
 * phase 1, docs/design/SCRBRD-083_public_pages.md §2.9, §3.1, §3.2).
 * Its other tabs are /live/:match/commentary, …/partnerships, …/analytics
 * and …/details (CRI-1.3, lib/matchTabs.js); on a phone the strip is
 * Summary, Scorecard and Commentary and the rest are under More.
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

// EXPERIENCE_PASS Slice 2 (Q18, Q19): Share and the ground display's link, a chunk of their own (the static graph's ceiling).
const PageLinks = lazy(() => import("../views/matchcentre/pageLinks.jsx"));

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

/**
 * The header and the log, polled while the match is live — and the par report
 * read after the log (SCRBRD-133 G2). Once it is not live, the corrections
 * half (./corrections.jsx, on demand) asks after the head and `note`s what it
 * saw; the figures change only on `refresh` (GA-I36 §7).
 *
 * `low` (CRI-2.4, ./lowData.js): a quarter of the live pace and half the
 * pre-start pace; no par read (the Board then says what it says without
 * one); and while live, after a whole read, only the log's new events
 * (`?since=`) — a whole read again whenever the names the server gives
 * change, the match changes state, or the reader asks, as the ground display
 * does (reads.js usePublicFeed), so a label is never drawn from memory.
 */
/** Events after which a Low data read is a whole one. */
const WHOLE_AFTER = new Set(["void", "revision", "amendment"]);

function usePublicMatch(matchId, low = false) {
  const [state, setState] = useState({ loading: true, missing: false, error: null, header: null, fold: {}, events: [], people: {}, last: 0, par: null, okAt: null, stale: false, refreshing: false });
  const [tick, setTick] = useState(0);
  const held = useRef(state);
  held.current = state;
  /** The next read is a whole one: the first, the reader's own, and after Low data is switched. */
  const whole = useRef(true);
  useEffect(() => { whole.current = true; }, [low]);
  const status = state.header?.status;
  const live = status === "live";
  // Opened before the first ball (19 Nov 2026): it asks again once a minute
  // from an hour before the start until twelve hours after it, so it turns
  // live by itself; then at the live pace. A tab out of view asks nothing.
  const startsAt = state.header?.startsAt ? Date.parse(state.header.startsAt) : NaN;
  const soon = status === "scheduled" && Number.isFinite(startsAt)
    && Date.now() > startsAt - 3600e3 && Date.now() < startsAt + 12 * 3600e3;
  const every = live ? Math.max(5000, liveRefreshMs()) * (low ? LOW_LIVE_FACTOR : 1) : soon ? soonRefreshMs() * (low ? LOW_SOON_FACTOR : 1) : 0;
  useEffect(() => {
    if (!every) return undefined;
    const t = setInterval(() => { if (!document.hidden) setTick((x) => x + 1); }, every);
    return () => clearInterval(t);
  }, [every]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = `/api/public/matches/${matchId}`;
        const cur = held.current;
        const since = low && !whole.current && cur.header?.status === "live" && !cur.error ? cur.last : null;
        whole.current = false;
        const [{ match, fold }, part] = await Promise.all([read(base), read(since != null ? `${base}/log?since=${since}` : `${base}/log`)]);
        let log = part, events = part.events ?? [];
        if (since != null) {
          // A correction (a void, a revision, an amendment) is read in the whole log's terms, never stitched on.
          if (match.status !== cur.header.status || !samePeople(part.people ?? {}, cur.people)
              || events.some((/** @type {any} */ e) => e.seq > cur.last && WHOLE_AFTER.has(e.kind))) {
            log = await read(`${base}/log`);
            events = log.events ?? [];
          } else {
            const fresh = events.filter((/** @type {any} */ e) => e.seq > cur.last);
            events = fresh.length ? [...cur.events, ...fresh] : cur.events;
            log = { ...part, last: Math.max(cur.last, part.last ?? 0, ...fresh.map((/** @type {any} */ e) => e.seq)) };
          }
        }
        const par = low ? null : await readPar(base);
        if (!cancelled) setState({ loading: false, missing: false, error: null, header: match, fold: fold ?? {}, events, people: log.people ?? {}, last: log.last ?? 0, par,
          okAt: Date.now(), stale: false, refreshing: false });
      } catch (e) {
        if (cancelled) return;
        // Not found is one answer: unpublished and no such fixture read alike.
        if (e.status === 404) setState((s) => ({ ...s, loading: false, missing: true, error: null }));
        else setState((s) => ({ ...s, loading: false, refreshing: false, error: e.status === 429 ? "busy" : "unreachable" }));
      }
    })();
    return () => { cancelled = true; };
  }, [matchId, tick, low]);
  const refresh = () => { whole.current = true; setState((s) => ({ ...s, refreshing: true })); setTick((x) => x + 1); };
  const note = useCallback((/** @type {any} */ r) => setState((s) => ({ ...s, ...r })), []);
  return { ...state, refresh, note };
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

/**
 * Analytics, team level only (L7): the innings' rates from the fold, and
 * where the side scored its runs, by sector, from the server's aggregate.
 * Nothing keyed to one boy.
 */
function TeamAnalyticsTab({ match, innings, inningsSel, setInningsSel, sectors, lowData = false }) {
  const inn = innings[inningsSel];
  if (!inn) return <Quiet testid="mc-analytics-empty">Nothing has been scored yet.</Quiet>;
  const legal = inn.ballLog.filter((b) => b.type !== "Wd" && b.type !== "Nb");
  const dots = legal.filter((b) => (b.type ?? "run") === "run" && b.value === 0).length;
  // Fours and sixes are boundaries (the Laws audit F7): the engine's one test.
  const bnds = boundaryCount(inn);
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
      {lowData ? <Quiet testid="mc-sectors-low-data">Charts are off in Low data.</Quiet> : sectors == null ? <Quiet>Loading…</Quiet> : !mine.length ? <Quiet testid="mc-sectors-none">No placement was recorded for this innings.</Quiet> : (
        // CRI-2.2: the side's innings, and how many of its balls carried a placement (a scoring shot placed).
        <SourcedLazy line={ballsLine(`${teamOf(match, inn.battingTeam).full} innings`, inn.balls ?? 0,
          shotsCaptured(mine.reduce((a, s) => a + s.shots, 0), inn.ballLog.length))} testid="source-line-sectors">
          <TeamWheel sectors={mine} most={most}/>
        </SourcedLazy>
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
  const toss = tossWords(match);
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
  const low = useLowData();
  const data = usePublicMatch(matchId, low.on);
  const phone = usePhone(NARROW_PX);
  // CRI-1.3: the tab is the address's — /live/:id the Summary, /scorecard/:id the Scorecard, /live/:id/commentary
  // and the like the rest (lib/matchTabs.js) — so a link opens it and the back button goes back a tab.
  const path = usePath();
  const asked = parsePublicPath(path);
  const tab = tabOr(TABS, asked && asked.matchId.toLowerCase() === String(matchId).toLowerCase() ? asked.tab : view === "scorecard" ? "scorecard" : "summary");
  const setTab = useCallback((/** @type {string} */ t) => navigate(publicPath(matchId, t)), [matchId]);
  const [picked, setPicked] = useState(null);
  const sectors = useSectors(matchId, tab === "analytics" && !data.missing && !low.on);

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
  const result = story?.result ?? null;
  // The result, as one moment (SCRBRD-133 §5.2 row 13, public with reasons: false), once play has decided it: the
  // same synthetic line MatchView and the display add, keyed per match, so it arrives once and a reload replays it never.
  const settledNow = story?.settled ?? false;
  const feed = useMemo(() => {
    const lines = story?.commentary ?? [];
    return settledNow && result && lines.length && match
      ? [...lines, { innings: Math.max(0, played.length - 1), over: 0, ball: 0, kind: "result", text: result, key: `result:${match.id}` }]
      : lines;
  }, [settledNow, result, story?.commentary, match, played.length]);
  const { moment, overSummary } = useMoments(feed, !data.loading && !!match, played, (inn) => (match ? teamOf(match, inn.battingTeam).full : ""));
  // What a screen reader is told as each ball arrives (lib/announce.js): the
  // newest only, and nothing for the log as it stood on first load.
  const said = useAnnouncement(commentary, data.events, !data.loading && !!match);
  const bi = boardInnings(played, folded?.result);
  const boardInn = played[bi.index] ?? null;
  const shownRuns = useTicker(boardInn?.runs, `${matchId}:${bi.index}`);
  // GA-I36: the corrections half (./corrections.jsx), loaded once the match
  // is not live (its head is still asked after), its log has a void, or a
  // read failed; a live page with nothing corrected pays nothing for it.
  const [fx, setFx] = useState(/** @type {any} */ (null));
  const need = (!!data.header && data.header.status !== "live") || data.events.some((e) => e.kind === "void") || !!data.error;
  useEffect(() => { if (need && !fx) import("./corrections.jsx").then(setFx, () => {}); }, [need, fx]);
  const fixes = useMemo(() => (fx && story ? fx.publicFixes(data.events, story) : null), [fx, story, data.events]);

  if (data.loading) return <Frame low={low.on}><Quiet testid="public-loading">Loading the match…</Quiet></Frame>;
  if (data.missing) return <Frame low={low.on}><Quiet testid="public-missing">This page is not available. The link may be wrong, or the match may not be public.</Quiet></Frame>;
  // A ground with poor signal is where this page is opened: a failed read offers the same read again, and says nothing
  // more than it did (glossary review item 5).
  if (!match) return (
    <Frame low={low.on}>
      <div aria-live="polite">
        <Quiet testid="public-error">Couldn't load this match{data.error === "busy" ? " — too many requests; try again shortly" : ""}.</Quiet>
        <button type="button" data-testid="public-retry" onClick={() => { if (!data.refreshing) data.refresh(); }} className="pressBtn os-state"
          style={{ minHeight: "44px", minWidth: "44px", padding: `0 ${T.space.lg}`, display: "inline-flex", alignItems: "center", background: "transparent",
            border: `1px solid ${T.brand.accentText}`, borderRadius: T.radius.pill, cursor: "pointer", color: T.brand.accentText,
            fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 }}>
          {data.refreshing ? "Retrying…" : "Retry"}
        </button>
      </div>
    </Frame>
  );

  const sides = sidesOf(match);
  const isLive = match.status === "live";
  // Redesign slice 2 (DESIGN_DIRECTION §2.2, §3.5): the match card at its board size heads the page, the one way
  // every signed-in screen draws a match — the state ("Live", the day, "Result"), both sides with their scores, the
  // status sentence — made once here so Share says the very sentence the card does.
  const card = cardModel({ match, fold: folded ? { innings: played, result: folded.result, conditions: data.fold?.conditions } : null,
    resultSaid: result });
  const st = card.sentence;
  const decided = st.state === "result" || st.state === "super_over";
  // A ground, a time and an age group the card has not said already: while play is on, or after it. Before the
  // first ball the card's own sentence says where and when ("Starts 17:25 · Hilton Oval"), and it is said once.
  // Once played, the card's state line keeps the day ("Result · Tue 17 Nov"), so the line does not say it again.
  const line = card.state.kind === "upcoming" ? null
    : matchLine({ match: card.day ? { ...match, date: null } : match, competition: null, weather: null }) || null;
  const notice = revisionNotice(boardInn);
  // Q14 (Kameel, 19 Nov: "Updates every 15 seconds"): the pace this page reads at, said while it is live. In Low
  // data the switch's own line says it ("about once a minute"), so it is not said twice.
  const playing = isLive && !(story?.settled ?? false);
  const pace = playing && !low.on ? paceWords(Math.max(5000, liveRefreshMs())) : null;
  // GA-I36 §5: the "Corrected" chip, beside the side whose innings moved (or the latest), never a second figure.
  const chip = fx && fixes ? <fx.CorrectedChip at={fixes.at} lines={() => [fixes.line]}/> : null;
  const markInn = chip ? markedInnings(played, fixes.corrected) : null;
  const mark = markInn && !markInn.superOver ? { end: sideOfTeam(match, markInn.battingTeam) ?? "home", node: chip } : null;
  // The 18 Nov names (PUBLIC_DATA, after D4), where the server sends them: a boy without consent as "R ••••••".
  const dotted = dottedNames(data.people);
  const ctx = { match, innings: played, result, commentary: fixes?.commentary ?? commentary, events, fold: data.fold, par: data.par, settled: story?.settled ?? false,
    demo: false, overs: match.overs || 20,
    inningsSel, setInningsSel: setPicked, phone, setTab, moment, overSummary, shownRuns,
    status: null,           // §2.2: the card says the sentence, on every tab, once
    okAt: null,             // ...and how fresh it is; the Board under it does not say it again
    quietMoments: true,     // the region below says it; the moment is drawn, not said twice
    lowData: low.on };      // CRI-2.4: no chart, no chunk fetched for one

  return (
    <Frame low={low.on}>
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
          {/* The page's title for a reader that moves by headings; the card below says the sides to the eye. */}
          <h1 data-testid="mc-title" className="sr-only" style={{ ...T.role.title.md, margin: 0 }}>
            {sides.home.full} v {sides.away.full}
          </h1>
          <MatchCardCore size="board" match={match} model={card} testid="mc-card" stateTestid="mc-status" scoresTestid="mc-scores"
            statusTestid={decided ? "mc-result" : "mc-status-line"} sideTestid="mc-side" mark={mark}
            updated={playing && data.okAt != null ? <UpdatedAgo at={data.okAt} testid="mc-updated"/> : null}>
            {/* Each super over apart and labelled (SCRBRD-114 3b), under the match's own two sides. */}
            <SuperOverScores match={match} played={played} mark={chip} markAt={markInn?.superOver ? markInn : null}/>
            {pace && <p data-testid="mc-pace" style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary, margin: 0 }}>{pace}</p>}
          </MatchCardCore>
          {/* OFFICIAL_RESULT D11, Q3: "Provisional" or "Official result · confirmed 20:15, 11 Oct" — the
              time only, never who, never a reason, and never "Under review" (the server says a disputed
              result is not official). Announced when a poll changes it. */}
          <div role="status" aria-live="polite" data-testid="public-official">
            {(() => { const w = publicOfficial(match.result, match.status); return w ? <StateLabel kind={w.kind} why={w.why} compact/> : null; })()}
          </div>
          {line && <p data-testid="mc-match-line" style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>{line}</p>}
          {/* Q18: the page's own link, the sides and the sentence, never a boy. Q19: the ground display, which the
              server serves exactly when the home side is published (SCRBRD-133 D2), so the link is drawn only then. */}
          <ErrorBoundary name="page links" fallback={null}>
            <Suspense fallback={null}>
              <PageLinks share={{ url: window.location.origin + window.location.pathname, title: `${sides.home.full} v ${sides.away.full}`, text: st.text }}
                display={data.header?.published?.home === true ? `/display/${matchId}` : null}/>
            </Suspense>
          </ErrorBoundary>
          {fx && !isLive && <fx.SettledWatch matchId={matchId} last={data.last} note={data.note}/>}
          <LowDataSwitch low={low} live={isLive}/>
          <div role="status" aria-live="polite" data-testid="mc-stale-region">
            {fx && <fx.StaleLine bare stale={data.stale} refreshing={data.refreshing} failed={!!data.error} okAt={data.okAt} onRefresh={data.refresh}/>}
          </div>
        </header>
        </ErrorBoundary>
        <ErrorBoundary name="match notices">
        <div style={{ display: "grid", gap: T.space.md, margin: `${T.space.md} 0` }}>
          {/* No "Before the toss" card: the match card says the day, the start and the ground already (§2.2). */}
          {notice && <RevisionBanner notice={notice}/>}
        </div>
        </ErrorBoundary>
        {/* EXPERIENCE_PASS §2.4 step 2, Q8: at a pause, "Follow Hilton College's matches". An offer, never a wall. */}
        <ErrorBoundary name="follow offer" fallback={null}>
          <FollowOffer header={data.header} state={st.state} matchId={matchId}/>
        </ErrorBoundary>

        <TabStrip tabs={TABS} tab={tab} setTab={setTab} narrow={phone} label="Match"/>
        <div role="tabpanel" id={`mc-panel-${tab}`} aria-labelledby={panelLabel(TABS, tab, phone)} data-testid={`mc-panel-${tab}`} tabIndex={0} style={{ outline: "none" }}>
          <ErrorBoundary key={tab} name={tab === "details" ? "match details" : tab}>
            {tab === "summary" ? <SummaryTab {...ctx}/>
              : tab === "scorecard" ? <ScorecardTab {...ctx}/>
              : tab === "commentary" ? <CommentaryTab {...ctx}/>
              : tab === "partnerships" ? <PartnershipsTab {...ctx}/>
              : tab === "analytics" ? <TeamAnalyticsTab {...ctx} sectors={sectors}/>
              : <PublicDetailsTab {...ctx}/>}
          </ErrorBoundary>
        </div>
        <p data-testid="public-note" data-names={dotted ? "initials" : "positions"} style={{ ...T.role.body, fontSize: "13px", color: T.content.tertiary, margin: `${T.space.xl} 0 0` }}>
          {dotted
            ? "Players are named here only where their school and family have agreed to it; everyone else is shown by an initial, or by position."
            : "Players are named here only where their school and family have agreed to it; everyone else is shown by position."}
        </p>
      </div>
    </Frame>
  );
}

/**
 * Low data's switch (CRI-2.4): a toggle button (aria-pressed), 44px tall; while
 * it is on, one line says why, when the browser turned it on, and what it
 * changes. Pressing it is the device's choice, remembered, so it always turns
 * Low data off, Save-Data or not. Team-level words
 * only; nothing here names anyone.
 * @param {{low: {on: boolean, why: string | null, set: (on: boolean) => void}, live: boolean}} p
 */
function LowDataSwitch({ low, live }) {
  const why = low.on && low.why === "save-data" ? "On because this phone asked to save data."
    : low.on && low.why === "slow" ? "On because the connection is slow." : null;
  return (
    <div data-testid="public-low-data" data-on={low.on ? "true" : "false"} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: T.space.sm }}>
      <button type="button" data-testid="public-low-data-switch" aria-pressed={low.on} aria-describedby={low.on ? "public-low-data-says" : undefined}
        onClick={() => low.set(!low.on)} className="pressBtn os-state"
        style={{ minHeight: "44px", minWidth: "44px", padding: `0 ${T.space.lg}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
          background: low.on ? T.surface.raised : "transparent", border: `1px solid ${low.on ? T.brand.accentText : T.line.normal}`,
          borderRadius: T.radius.pill, cursor: "pointer", color: low.on ? T.brand.accentText : T.content.primary,
          fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 }}>
        Low data<span aria-hidden="true">{low.on ? " · On" : " · Off"}</span>
      </button>
      {low.on && (
        <span id="public-low-data-says" data-testid="public-low-data-says" style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary }}>
          {why ? `${why} ` : ""}No charts; the score is checked {live ? "about once a minute" : "less often"}.
        </span>
      )}
    </div>
  );
}

/**
 * Low data keeps to the phone's own type (CRI-2.4): with every element's
 * family the system's, no web font is ever used, so none is downloaded.
 */
const LOW_DATA_CSS = `main[data-low-data] *{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif!important;font-variant-numeric:tabular-nums}`;

/** The page around it: the global sheet, a readable width, the gutters. */
function Frame({ children, low = false }) {
  return (
    <>
      <style>{GLOBAL_CSS}</style>
      {low && <style>{LOW_DATA_CSS}</style>}
      <main data-low-data={low ? "" : undefined} style={{ maxWidth: "960px", margin: "0 auto", padding: `${T.space.lg} ${T.space.md}`, minHeight: "100vh" }}>
        {children}
      </main>
    </>
  );
}
