import { useEffect, useState } from "react";
import { deriveMatch, fromRow } from "@scrbrd/scoring";
import { ROLES } from "../design/roles.js";
import { D, T } from "../design/tokens.js";
import { addDays, dateStr, humanDate, today } from "../lib/format.js";
import { api, signedIn } from "../lib/api.js";
import { useDutyCoverage, useLive, useWeatherState } from "../lib/live.js";
import { useNotifications } from "../lib/notifications.js";
import { combineReads, isModuleOff, readState } from "../lib/readState.js";
import { isOff, useFeatures, useNav } from "../lib/features.js";
import { holdsAsHeld } from "../lib/held.js";
import { EmptyState, ReadState } from "../ui/primitives.jsx";
import { Bento, BentoCard } from "../ui/surfaces.jsx";
import { Board } from "../ui/board.jsx";
import { Icon, isIcon } from "../ui/icons.jsx";
import { StateLabel } from "../ui/stateLabel.jsx";
import { boardFromInnings } from "../scorer/boardData.js";
import { seedCompletedMatch } from "../scorer/seed.js";
import { aboutWhom, boardInsights } from "../scorer/signals.js";
import { parseBalls, parseScore, teamSquad } from "./shared.jsx";
import { MatchDayCard } from "./cockpit/MatchDayCard.jsx";
import { RecentMatches } from "./cockpit/RecentMatches.jsx";
import { weatherWords } from "../lib/cockpit.js";
import { observedStamp } from "../lib/weatherStamp.js";
import { saClock } from "../lib/saTime.js";
import { MatchCard } from "../ui/matchCard.jsx";
import { sideOfTeam } from "../lib/matchCentre.js";
import { openWords, resultSaidOf } from "../lib/matchCard.js";
import { cockpitGate } from "../lib/cockpit.js";
import { requestCoach, requestDuties, requestResult } from "../lib/cockpitNav.js";
import { fixFor, requestFix } from "../lib/fixNote.js";
import { profile } from "../lib/session.js";
import { LastMatch } from "./cockpit/RecentMatches.jsx";
import { NeedsYou } from "./needsyou.jsx";
import { DsoCard } from "./family/dso.jsx";
import { useFollowed } from "../lib/follow.js";
import { FollowedSchools } from "../follow/Followed.jsx";

// ══════════════════════════════════════════════════════
//  THE DAY SHEET (DESIGN_DIRECTION §5) — replaces the KPI dashboard.
//
// Six equal tiles used to open this screen: "Active players 8 — Demo data",
// "Win rate —", each with its own accent, telling a coach nothing about what
// to do next. The day sheet is the day in the order it happens instead:
//
//   1. Now         a live fixture, on the board, full width.
//   2. Today/next  the next fixture — human date, ground, bus, weather,
//                  who is ready.
//   3. Who is out  injuries, from the availability tier only.
//   4. This week   training and fixtures, as a list.
//   5. Alerts      last, unread only.
//
// EVERY READ HERE IS ONE THE APP ALREADY HAD. There is no new capability and
// no new API route: a section a role's capabilities do not reach is not
// drawn, exactly as the KPI tiles used to gate themselves with holds(). "Win
// rate" and the per-player career figures had no home in this shape and are
// gone — a batter's own passport is step 4's job (parent and pupil screens),
// not this one's.
// ══════════════════════════════════════════════════════

/** HH:MM of an instant on the SA clock, as asMatch()'s own `time` field is (lib/saTime.js). */
const hm = (ts) => saClock(ts);

/**
 * The demo's live innings, reconstructed from its scorecard line exactly as
 * Match Centre's demo scorecard reconstructs it (views/shared.jsx,
 * scorer/seed.js: deterministic per match), so the two demo screens agree
 * ball for ball. Signed in, the fold is the source and this is never used.
 */
function demoInnings(match, players) {
  const home = match?.scorecard?.home;
  if (!home) return null;
  const { runs, wkts } = parseScore(home.score);
  const seeded = seedCompletedMatch({
    matchId: match.id, team1: match.homeTeam, team2: match.awayTeam,
    squad1: teamSquad(match.homeTeam, players), squad2: teamSquad(match.awayTeam, players),
    inns: [{ runs, wickets: wkts, balls: parseBalls(home.overs) }], liveLast: true,
  });
  return seeded.innings[0] ?? null;
}

/**
 * The four readiness chips §5 names, grouped from DutyRoster's eight duty
 * slots (duties.jsx SLOTS) into the words a coach actually asks in. Each is a
 * word and a state — never a percentage — from the same match_duties read
 * DutyRoster and ReadinessOverview already run.
 */
const READY_SLOTS = [
  { key: "squad",     label: "Team sheet",    on: (has) => has("squad") },
  { key: "transport", label: "Transport",     on: (has) => has("transport") },
  { key: "officials", label: "Officials",     on: (has) => has("umpire") || has("third_umpire") || has("referee") },
  { key: "ground",    label: "Ground report", on: (has) => has("ground") },
];

/**
 * The chips, the ones not done first (EXPERIENCE_PASS §1.9: "Needs you", the chips that are not done), each kind
 * keeping its place among its own. Pure. @param {typeof READY_SLOTS} slots @param {(key: string) => boolean} has
 */
export const chipOrder = (slots, has) => [...slots.filter((s) => !s.on(has)), ...slots.filter((s) => s.on(has))];

/**
 * "This week": what was played since Monday, said by its result, and what is to come in the next seven days, said
 * by its start (§3.10). In date order. Pure.
 * @param {any[]} matches @param {Date} day  today
 */
export function weekOf(matches, day) {
  const monday = dateStr(addDays(day, -((day.getDay() + 6) % 7)));
  const todayStr = dateStr(day), end = dateStr(addDays(day, 6));
  const played = (m) => m.status === "complete" || m.status === "abandoned" || m.status === "postponed" || !!m.calledOff;
  return (matches ?? []).filter((m) => m.date && ((played(m) && m.date >= monday && m.date <= todayStr)
      || (m.status === "upcoming" && m.date >= todayStr && m.date <= end)))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.time ?? "").localeCompare(b.time ?? ""));
}

/**
 * The live match's own score, folded from the ball log — the same
 * `GET /matches/:id/events` read and `deriveMatch()` fold the Match Centre (views/matchcentre/) and
 * the Post-Match Report already run (packages/scoring). A stored total is
 * never the source: asMatch() sets `scorecard: null` for every real fixture on
 * purpose, because a live score is derived, not a column.
 */
function useLiveScore(matchId) {
  const [state, setState] = useState({ loading: false, error: null, inn: null, target: null, innings: [] });
  useEffect(() => {
    if (!matchId || !signedIn()) { setState({ loading: false, error: null, inn: null, target: null, innings: [] }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const { events: rows, fold } = await api(`/api/matches/${matchId}/events`);
        if (cancelled) return;
        const evs = (rows || []).map(fromRow);
        // Folded as the server folds it: the fixture's start and format (SCRBRD-113).
        const { innings } = deriveMatch(evs, fold ?? {});
        const curIn = innings.length - 1;
        const inn = curIn >= 0 ? innings[curIn] : null;
        const target = curIn === 1 ? (inn?.target ?? ((innings[0]?.runs || 0) + 1)) : null;
        // Every innings of the same fold: the match card's two scores (slice 1). Nothing more is read.
        setState({ loading: false, error: null, inn, target, innings });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.code || "unreachable", inn: null, target: null, innings: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [matchId]);
  return state;
}

/**
 * The results of this week's played fixtures, by id: the server's words (GET /api/matches/:id/result, the read the
 * Match Centre makes) and each innings' total by side from the same answer (the row's two scores, slice 1), null
 * for a read that failed, absent while asking. Signed in only; the demo has none.
 * @param {string[]} ids
 * @returns {Record<string, {text: string | null, innings: any[]} | null>}
 */
function useWeekResults(ids) {
  const key = ids.join(",");
  const [got, setGot] = useState(/** @type {Record<string, {text: string | null, innings: any[]} | null>} */ ({}));
  useEffect(() => {
    if (!signedIn() || !key) return undefined;
    let off = false;
    Promise.all(key.split(",").map((id) => api(`/api/matches/${id}/result`)
      .then((r) => [id, { text: resultSaidOf(r), innings: Array.isArray(r?.innings) ? r.innings : [] }], () => [id, null])))
      .then((pairs) => { if (!off) setGot(Object.fromEntries(pairs)); });
    return () => { off = true; };
  }, [key]);
  return got;
}

/**
 * THE DAY SHEET, DRAWN — every figure on it handed in.
 *
 * DashboardView reads five resources and the session, and the drawing of the
 * day used to be inline with those reads. It is split here, at that seam, so
 * that the pitch deck (views/pitchdeck/Showcase.jsx) can draw this very
 * screen on invented fixtures without a session or a request. The view is
 * unchanged in what it reads, what it derives and what it shows: it passes
 * this component exactly what it used to hold in local variables.
 *
 * What is decided in here is only what to DRAW: a section the role's
 * capabilities do not reach is not drawn (holdsAsHeld, which answers from the
 * roles held, or in the demo from the role alone, and reads nothing). Nothing
 * here fetches, and nothing here
 * is authority: the rows it is given were scoped where they were read.
 *
 *   role         whose day sheet this is (its title, and which sections show)
 *   live         true when the rows came from a server; false draws `demoNote`
 *   demoNote     what the header says when they did not
 *   held         false when the sheet is drawn for a role that is not the viewer's (the pitch deck): sections then follow `role` alone
 *   liveMatch    the live fixture, or falsy for no "Now" tile
 *   board        the props <Board/> takes for it, or null (then boardState speaks)
 *   boardState   { loading, error } of the read behind `board`
 *   next         the next fixture, or falsy
 *   busTime      "HH:MM" of the bus, or null
 *   weather      { icon, tempC, condition, rainChancePct } for the next fixture, or null
 *   dutyRows     the next fixture's duty rows ({ duty }), for the four ready chips
 *   weekMatches, weekTraining   this week's fixtures and sessions
 *   out          [{ id, name, rtw }]: who is out, resolved to a name
 *   unread       the unread alerts
 *   reads        what each read behind a section said, from lib/readState.js:
 *                { matches, out, week, alerts, weather }, each { state, sentence,
 *                retry }. Without it (the pitch deck's invented day) every
 *                section is drawn as handed in. With it, a section whose read
 *                is still coming, failed, is refused or switched off says that
 *                instead of the sentence "none" ("Nobody is out" over an
 *                injuries read that failed is good news nobody sent)
 *   off          the modules switched off for this person: { injuries, training, logistics }.
 *                Switched off is HIDDEN, not drawn as a refusal or a dash (Kameel,
 *                13 Nov 2026): no "Who is out" without Injuries, no session in
 *                "This week" without Training, no bus or Transport chip without
 *                Logistics. Presentation only; the reads decide what comes back.
 *   onRetry      the one Retry: it re-runs these reads, the same ones, with the same role
 *   onNav, onOpenScorer         the two buttons' handlers
 */
function DaySheet({ role, live = true, demoNote = "sample fixtures, no server connected", liveMatch = null, board = null, boardState = {},
                    next = null, busTime = null, weather = null, dutyRows = [], weekMatches = [], weekTraining = [], out = [], unread = [],
                    reads = null, onRetry, onNav, onOpenScorer, matchDay = null, held = true, off = {},
                    needsYou = null, nextFold = null, lastMatch = null, dso = null, chipDoor = null,
                    liveInnings = null, nowLine = null, nowAction = null, openMatch = null }) {
  // The roles the person HOLDS, as the menu is drawn from, not the one badge role: a coach who is also a
  // director of sport keeps the sections the second role reaches (GA-I07). Presentation only. A sheet drawn
  // for a role that is not the viewer's (the pitch deck's coach, `held` false) answers from that role alone.
  const holds = (capability) => holdsAsHeld(role, capability, held ? undefined : []);
  const rc = ROLES[role];
  const hasDuty = (key) => dutyRows.some((r) => r.duty === key);
  // The week's training, and the chips drawn, with what is switched off taken out.
  const training = off.training ? [] : weekTraining;
  const readySlots = off.logistics ? READY_SLOTS.filter((s) => s.key !== "transport") : READY_SLOTS;
  // With Training off the week is the fixtures alone, and its read is theirs alone.
  const weekRead = off.training ? reads?.matches : reads?.week;
  // A read that said something other than rows, or "none": null when there is
  // nothing to say beyond what the section already draws.
  const said = (r) => (r && !["ok", "empty", "stale"].includes(r.state) ? r : null);
  const draw = (r, fallback) => (said(r) ? <ReadState read={r} onRetry={onRetry} compact/> : fallback);

  return (
    <div className="os-page" data-testid="day-sheet">
      <div style={{ marginBottom: T.space.lg }}>
        <h1 style={{ ...T.role.title.lg, color: T.content.primary, marginBottom: "3px", display: "flex", alignItems: "center", gap: T.space.sm }}>
          <Icon name={rc?.icon ?? "layout-dashboard"} style={{ color: rc?.color }}/>
          {rc?.label ?? "Today"}
        </h1>
        <div style={{ ...T.role.body, color: T.content.secondary, display: "flex", flexWrap: "wrap", alignItems: "center", gap: `0 ${T.space.sm}` }}>
          <span>{new Date().toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
          {!live && <StateLabel kind="demo" compact why={demoNote}/>}
        </div>
      </div>

      <Bento>
        {/* 1. Now — a live fixture: the match card at its board size (slice 1), the Board under its two sides. */}
        {liveMatch && (
          <BentoCard level="a" title="Now" data-testid="day-now">
            <MatchCard size="board" match={liveMatch} fold={liveInnings?.length ? { innings: liveInnings, result: null } : null}
              testid="day-now-card" statusTestid="day-now-status"
              line={nowLine} lineTestid="day-now-line"
              board={board
                // No last-wicket row on the day sheet's board (CRI-1.1 is the Match Centre's and the public page's).
                ? <Board {...board} lastWicket={undefined} testid="day-board"/>
                : <EmptyState loading={boardState.loading} error={boardState.error} message="The live score is not available yet." icon="scorebook"/>}
              action={nowAction ?? (holds("scoring.edit")
                ? { label: "Resume scoring", onClick: () => onOpenScorer && onOpenScorer(liveMatch), testid: "day-now-open" }
                : { label: openMatch ? openWords(liveMatch) : "Match Centre", onClick: () => (openMatch ? openMatch(liveMatch) : onNav && onNav("matches")), testid: "day-now-open" })}/>
          </BentoCard>
        )}

        {/* 1b. Needs you — what is waiting on this reader, each row landing on its fix (EXPERIENCE_PASS §1.3, §1.10).
            Drawn only for someone who can act on a row (Q17), and only when one is open. */}
        {needsYou}

        {/* 2. Today / next — the next fixture, ready or not. */}
        {holds("fixture.read") && (
          <BentoCard level="b" title="Next fixture" data-testid="day-next">
            {next ? (
              <div data-testid={`next-fixture-${next.id}`}>
                {/* The match card (slice 1): the day and time, both sides, where it stands and where it is played.
                    What the card does not say follows it: the bus, the weather, the ready chips. */}
                <MatchCard size="card" match={next} statusTestid="day-next-status" testid="day-next-card"/>
                <div style={{ display: "flex", flexDirection: "column", gap: T.space.xs, marginTop: T.space.sm }}>
                  {busTime && !off.logistics && <div style={{ ...T.role.body, color: T.content.secondary }}><Icon name="bus"/> Bus {busTime}</div>}
                  {!weather && reads?.weather?.state === "failed" && (
                    <div data-testid="day-weather-read"><ReadState read={reads.weather} onRetry={onRetry} compact testId="day-weather-read-state"/></div>
                  )}
                  {weatherWords(weather) && (
                    <div data-testid="day-weather" style={{ ...T.role.body, color: T.content.secondary }}>
                      <Icon name={isIcon(weather.icon) ? weather.icon : "cloud-sun"}/> {weatherWords(weather)}
                      {/* When it was observed: a reading from yesterday is not this morning's. */}
                      {observedStamp(weather, { status: next.status }) && (
                        <span data-testid="weather-observed"> · {observedStamp(weather, { status: next.status }).text}</span>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.xs, marginTop: T.space.md }}>
                  {chipOrder(readySlots, hasDuty).map((s) => {
                    const on = s.on(hasDuty);
                    const chip = {
                      padding: "3px 10px", borderRadius: T.radius.pill,
                      ...T.role.label, textTransform: "none", letterSpacing: 0, fontWeight: on ? 500 : 600,
                      background: on ? D.emerald + "14" : T.surface.interactive,
                      border: `1px solid ${on ? D.emerald + "38" : T.line.normal}`,
                      color: on ? D.emerald : T.content.primary,
                    };
                    const words = `${s.label} · ${on ? "on record" : "nothing on record"}`;
                    // Each chip opens the screen that deals with it, for this fixture (§1.4): the sheet, the trip,
                    // the duties, the ground. A chip whose screen this reader has none of stays a word and a state.
                    const go = chipDoor ? chipDoor(s.key, next) : null;
                    return go
                      ? <button key={s.key} type="button" className="os-state" data-testid={`ready-${s.key}`} data-on={on ? "true" : "false"} onClick={go}
                          style={{ ...chip, minHeight: "44px", padding: "0 14px", cursor: "pointer" }}>{words} <span aria-hidden="true">›</span></button>
                      : <span key={s.key} data-testid={`ready-${s.key}`} data-on={on ? "true" : "false"} style={chip}>{words}</span>;
                  })}
                </div>
                {/* The cockpit's match-day card for this same fixture, folded in (C13): the fixture once, not twice. */}
                {nextFold}
              </div>
            ) : draw(reads?.matches, (
              <EmptyState message="No fixture is arranged yet." icon="calendar-days"/>
            ))}
          </BentoCard>
        )}

        {/* 2b. Match day — the coach's cards for his other fixtures within seven days (SCRBRD-136). Handed in, so the
            pitch deck's frame draws the day sheet without them; nothing for anyone the gate does not admit. */}
        {matchDay}

        {/* 3. Who is out — availability, never the clinical tier. */}
        {holds("medical.status.read") && !off.injuries && (
          <BentoCard level="c" title="Who is out" data-testid="day-out">
            {out.length === 0 ? draw(reads?.out, (
              <EmptyState message="Nobody is out." icon="circle-check"/>
            )) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {out.map((i) => (
                  <div key={i.id} data-testid={`out-${i.id}`} style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm }}>
                    <span style={{ ...T.role.body, color: T.content.primary }}>{i.name}</span>
                    <span style={{ ...T.role.body, color: T.content.secondary }}>{i.rtw ? `back ${humanDate(i.rtw)}` : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </BentoCard>
        )}

        {/* 4. This week — training and fixtures, as a list, not a grid. */}
        {(holds("team.read") || holds("fixture.read")) && (
          <BentoCard level="c" title="This week" data-testid="day-week">
            {weekMatches.length === 0 && training.length === 0 ? draw(weekRead, (
              <EmptyState message="Nothing scheduled this week." icon="calendar"/>
            )) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {/* One of the two reads failed: what is listed is not the whole week. */}
                {weekRead?.state === "partial" && <ReadState read={weekRead} onRetry={onRetry} compact testId="week-read-state"/>}
                {/* Each fixture is the match card's row (slice 1): played ones say their result, those to come their start. */}
                {holds("fixture.read") && weekMatches.map((m) => {
                  const played = m.status !== "upcoming";
                  return (
                    <div key={m.id} data-testid={`week-fixture-${m.id}`} data-played={played ? "true" : "false"}>
                      <MatchCard size="row" last match={m} statusTestid={`week-said-${m.id}`}
                        resultSaid={typeof m.weekResult === "string" && m.weekResult ? m.weekResult : null}
                        innings={Array.isArray(m.weekInnings) ? m.weekInnings : null}
                        // The result read did not answer: said, never "Match over" alone.
                        line={m.weekResult === null ? "The result could not be read just now." : null}
                        // A quiet list: the whole row opens the match, with no button of its own (§2.6).
                        onOpen={openMatch ? () => openMatch(m) : null} openLabel={openWords(m)}/>
                    </div>
                  );
                })}
                {holds("team.read") && training.map((s) => (
                  <div key={s.id} data-testid={`week-training-${s.id}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: `${T.space.xs} ${T.space.sm}` }}>
                    <Icon name="dumbbell"/>
                    <span style={{ ...T.role.body, color: T.content.primary, flex: "1 1 8em", minWidth: 0, overflowWrap: "anywhere" }}>{s.title}</span>
                    <span style={{ ...T.role.body, color: T.content.secondary }}>{humanDate(s.date)}{s.time ? ` · ${s.time}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </BentoCard>
        )}

        {/* 4b. Last match, and the side's season, in a line each (§3.10). */}
        {lastMatch}

        {/* 5. Alerts — last, and only unread. Addressed to a person rather
            than read out of a scoped table, so every role that reaches this
            screen has the section; what is IN it is still scoped by news.read. */}
        <BentoCard level="c" title="Alerts" data-testid="day-alerts">
          {unread.length === 0 ? draw(reads?.alerts, (
            <EmptyState message="Nothing unread." icon="bell"/>
          )) : (
            <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
              {unread.slice(0, 6).map((n) => (
                <div key={n.id} data-testid={`alert-${n.id}`}>
                  <div style={{ ...T.role.body, fontWeight: 600, color: T.content.primary }}>{n.title}</div>
                  {/* A tiered notice lists its title only; its body is read in Notices, on open (D17). */}
                  {n.body && <div style={{ ...T.role.body, color: T.content.secondary }}>{n.body}</div>}
                </div>
              ))}
            </div>
          )}
        </BentoCard>
      </Bento>
      {/* Last on every Today (Q7; SAFEGUARDING_DSO §2.5): the school's DSOs by name and how to reach them. The same
          card for everyone at the school; nothing on it says whether a concern exists. */}
      {dso && <div style={{ marginTop: T.space.lg }}>{dso}</div>}
    </div>
  );
}

function DashboardView({ role, onNav, onOpenScorer }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal, same as the KPI dashboard this replaces.
  //
  // `nonce` is the day sheet's Retry: it re-runs these reads, each with the
  // same role and params, so a retry cannot ask for more than the first read
  // did. Each read keeps its whole state (GA-I08): "Nobody is out" is only said
  // of an injuries read that answered.
  const [nonce, setNonce] = useState(0);
  const matchesRead = useLive("matches", role, nonce);
  const { rows: MATCHES, live: matchesAreLive } = matchesRead;
  const injuriesRead = useLive("injuries", role, nonce);
  const INJURIES = injuriesRead.rows;
  // The notices' one store (lib/notifications.js): the same rows and read
  // state every badge reads, so a notice opened in Notices leaves this list too.
  const { list: notificationsRead, rows: NOTIFICATIONS } = useNotifications(role, nonce, { fresh: true });
  const trainingRead = useLive("training", role, nonce);
  const TRAINING = trainingRead.rows;
  const playersRead = useLive("players", role, nonce);
  const PLAYERS = playersRead.rows;
  const weatherRead = useWeatherState(role, nonce);
  const WEATHER = weatherRead.weather;

  const liveMatch = MATCHES.find((m) => m.status === "live");
  const liveScore = useLiveScore(liveMatch?.id);

  const upcoming = MATCHES.filter((m) => m.status === "upcoming").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.time ?? "").localeCompare(b.time ?? ""));
  const next = upcoming[0];

  // The bus for the next fixture — real trips when there is a session,
  // trip_mark's own read; the demo's seeded `transport` field otherwise
  // (data/mock.js, the field MatchCentreView already draws its own bus chip
  // from). No demo trip rows exist to fetch, so useLive("trips") answers []
  // signed out and this falls back on purpose.
  const { rows: TRIPS } = useLive("trips", role, nonce, next ? { matchId: next.id } : null);
  const { coverage } = useDutyCoverage(next ? [next.id] : [], role, nonce);

  // ── this week: training and fixtures, as a list ──
  const weekStart = dateStr(today);
  const weekEnd = dateStr(addDays(today, 6));
  // A fixture played this week says its result (§3.10): the result read the Match Centre and Recent matches make,
  // match_result(), asked only for those played this week. The fixture read itself carries no result.
  const weekPlain = weekOf(MATCHES, today);
  const weekResults = useWeekResults(weekPlain.filter((m) => m.status !== "upcoming" && !m.calledOff).map((m) => m.id));
  const weekMatches = weekPlain.map((m) => (weekResults[m.id] === undefined ? m
    // The result's words where the read said them, "" where it answered without one, null where it failed.
    : { ...m, weekResult: weekResults[m.id] === null ? null : weekResults[m.id].text ?? "", weekInnings: weekResults[m.id]?.innings ?? null }));
  const weekTraining = TRAINING.filter((s) => s.date && s.date >= weekStart && s.date <= weekEnd)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  // ── who is out: the availability tier alone (packages/policy/src/tables.mjs
  // — injury.read is medical.status.read; injury_type/severity/phase sit
  // behind medical.nature.read and are never read here) ──
  const out = INJURIES.filter((i) => i.restricted)
    .map((i) => ({ id: i.id, name: PLAYERS.find((p) => p.id === i.player)?.name ?? "—", rtw: i.rtw }));

  // A safeguarding notice is never listed on Today (EXPERIENCE_PASS Q7, Slice 6): its title says a concern exists, on
  // a screen others glance at. The bell's one count carries it for the DSO, and the notice opens his inbox from there.
  const unread = NOTIFICATIONS.filter((n) => !n.read && n.type !== "safeguarding");

  // ── the board for "Now" ──
  // The whole board, from the fold: batters (the striker lit), the stand, the
  // bowler, the over as chips — and, this being a spectator screen, the Tier 2
  // line (§10). The pad draws the same board from the same function.
  let board = null;
  let liveInnings = null;
  if (liveMatch) {
    const inn = signedIn() ? liveScore.inn : demoInnings(liveMatch, PLAYERS);
    liveInnings = signedIn() ? liveScore.innings : inn ? [inn] : null;
    const target = signedIn() ? liveScore.target : null;
    const overs = liveMatch.overs || inn?.overs || 20;
    const props = boardFromInnings(inn, { target, overs });
    if (props) {
      const insight = aboutWhom(boardInsights(inn, { target, overs }));
      board = { ...props, team: props.team || liveMatch.homeTeam, insight: insight.length ? insight : undefined };
    }
  }

  const nextTrip = TRIPS.find((t) => t.matchId === next?.id);
  const busTime = next ? (signedIn() ? hm(nextTrip?.departAt) : (next.transport?.bus ? next.transport.depart : null)) : null;
  const dutyRows = next ? (coverage.get(next.id)?.rows ?? []) : [];
  const weather = next ? WEATHER[next.id] : null;

  // What is switched off for this person: the feature map, or the read itself
  // answering module_disabled (the server's word, which the map only mirrors).
  const { features } = useFeatures();
  const off = {
    injuries: isOff(features, "injuries") || isModuleOff(injuriesRead),
    training: isOff(features, "training") || isModuleOff(trainingRead),
    logistics: isOff(features, "logistics"),
  };

  // The follow list (EXPERIENCE_PASS Q8, §1.9; db/160): a followed school's
  // public live board leads Today; otherwise its block follows the day sheet.
  // Drawn only for somebody who follows a school (or was just told of one).
  const followed = useFollowed();
  const showFollowed = signedIn() && (followed.schools.length > 0 || !!followed.note || !!followed.ask);
  const followedFirst = followed.live || !!followed.ask;

  const reads = signedIn() ? {
    matches: readState(matchesRead, { what: "the fixtures" }),
    out: readState(injuriesRead, { what: "the injury list" }),
    week: combineReads([{ what: "the fixtures", read: matchesRead }, { what: "the training sessions", read: trainingRead }]),
    alerts: readState(notificationsRead, { what: "the alerts" }),
    weather: readState(weatherRead, { what: "the weather" }),
  } : null;

  // Each chip of the next fixture opens what deals with it, for that fixture (EXPERIENCE_PASS §1.4, Slice 5): the
  // team sheet on its Coach tab where the reader runs the side, else its duties; its trip on Logistics; its
  // officials on its duties; its ground on Fields. Only a screen this reader reaches (capability and module).
  const reach = useNav(role);
  const assignments = signedIn() ? profile()?.assignments : null;
  const chipDoor = (/** @type {string} */ key, /** @type {any} */ m) => {
    if (!m?.id) return null;
    const duties = reach.includes("matches") ? () => { requestDuties(m.id); onNav("matches"); } : null;
    switch (key) {
      case "squad": return signedIn() && cockpitGate(assignments, m) && reach.includes("matches") ? () => { requestCoach(m.id, false); onNav("matches"); } : duties;
      case "transport": return reach.includes("logistics") ? () => { const n = fixFor("bus", { matchId: m.id }); if (n) requestFix(n); onNav("logistics", "transport"); } : duties;
      case "officials": return duties;
      case "ground": return reach.includes("fields") ? () => onNav("fields") : duties;
      default: return null;
    }
  };

  // A fixture opens on its own page, the Match Centre's (lib/cockpitNav.js: the fixture on its first tab).
  const openMatch = (/** @type {any} */ m) => { requestResult(m.id); onNav("matches"); };
  // The live match's lead (§2.2): for his side's coach, "We're batting" or "We're bowling", from the fold the board
  // is drawn from, and the Coach tab; for a scorer, Resume scoring (DaySheet's own); for anyone else, "Open v …".
  const liveGate = liveMatch && signedIn() ? cockpitGate(assignments, liveMatch) : null;
  const atCrease = liveInnings?.length ? liveInnings[liveInnings.length - 1] : null;
  const ourEnd = liveGate?.end ?? liveMatch?.mySide ?? null;
  const batEnd = atCrease && !atCrease.complete && liveMatch ? sideOfTeam(liveMatch, atCrease.battingTeam) : null;
  const nowLine = ourEnd && batEnd ? (batEnd === ourEnd ? "We're batting" : "We're bowling") : null;
  const nowAction = liveMatch && liveGate && !holdsAsHeld(role, "scoring.edit")
    ? { label: "Coach tab", testid: "day-now-open", onClick: () => { requestCoach(liveMatch.id, false); onNav("matches"); } } : null;

  const followedBlock = showFollowed
    ? <div className="os-page" data-testid="today-followed"><FollowedSchools followed={followed} lead={followedFirst}/></div> : null;
  return (
    <>
    {followedFirst && followedBlock}
    <DaySheet role={role} live={matchesAreLive || signedIn()} liveMatch={liveMatch} board={board} boardState={liveScore}
      liveInnings={liveInnings} nowLine={nowLine} nowAction={nowAction} openMatch={openMatch}
      next={next} busTime={busTime} weather={weather} dutyRows={dutyRows}
      weekMatches={weekMatches} weekTraining={weekTraining} out={out} unread={unread}
      reads={reads} off={off} onRetry={() => setNonce((n) => n + 1)}
      onNav={onNav} onOpenScorer={onOpenScorer} chipDoor={chipDoor}
      // The set-up list leads Needs you for a school with no fixtures (Slice 6), from the fixtures and players read here,
      // once both have answered whole: a read still out, or failed, draws no list rather than one that is wrong.
      needsYou={signedIn() ? <NeedsYou role={role} matches={MATCHES} onNav={onNav} players={PLAYERS}
        matchesAnswered={[matchesRead, playersRead].every((r) => r.live && !r.loading && !r.error)}/> : null}
      nextFold={signedIn() && next ? <MatchDayCard matches={MATCHES} onNav={onNav} only={next.id}/> : null}
      matchDay={signedIn() ? <MatchDayCard matches={MATCHES} onNav={onNav} skip={next?.id ?? null}/> : null}
      lastMatch={signedIn() ? <><LastMatch matches={MATCHES} role={role} onNav={onNav}/><RecentMatches matches={MATCHES} onNav={onNav}/></> : null}
      dso={<DsoCard onRaise={() => onNav("safeguarding")}/>}/>
    {!followedFirst && followedBlock}
    </>
  );
}

export { DashboardView, DaySheet };
