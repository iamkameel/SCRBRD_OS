import { useEffect, useState } from "react";
import { deriveMatch, fmtOvers, fromRow } from "@scrbrd/scoring";
import { ROLES } from "../design/roles.js";
import { D, T } from "../design/tokens.js";
import { addDays, dateStr, humanDate, humanDateTime, today } from "../lib/format.js";
import { api, signedIn } from "../lib/api.js";
import { useDutyCoverage, useLive, useRows, useWeather } from "../lib/live.js";
import { canScore, holdsCapability } from "../rbac/index.js";
import { Btn, EmptyState } from "../ui/primitives.jsx";
import { Bento, BentoCard } from "../ui/surfaces.jsx";
import { Board } from "../ui/board.jsx";
import { Icon, isIcon } from "../ui/icons.jsx";

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

/** "142/3" → { runs: 142, wkts: 3 } — the demo's own scorecard shape (data/mock.js). */
const parseScore = (s) => { const [r, w] = String(s).split("/").map(Number); return { runs: r, wkts: Number.isNaN(w) ? 10 : w }; };

/** HH:MM off a raw timestamp, sliced the way asMatch()'s own `time` field is — never through a Date object. */
const hm = (ts) => (ts ? String(ts).slice(11, 16) : null);

/** The chase line and run rate, in words — the same shape PadBoard (scorer/pad.jsx) draws on the pad itself. */
function boardSub(inn, target, overs) {
  const crr = inn.balls ? (inn.runs / (inn.balls / 6)).toFixed(2) : null;
  if (target == null) return crr ? `CRR ${crr}` : null;
  const need = target - inn.runs;
  const ballsLeft = Math.max(0, (overs || 20) * 6 - inn.balls);
  const rrr = need > 0 && ballsLeft > 0 ? ((need / ballsLeft) * 6).toFixed(2) : null;
  return [need > 0 ? `Need ${need} off ${ballsLeft}` : "Target reached", rrr ? `RRR ${rrr}` : null, crr ? `CRR ${crr}` : null]
    .filter(Boolean).join(" · ");
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
 * The live match's own score, folded from the ball log — the same
 * `GET /matches/:id/events` read and `deriveMatch()` fold ScorecardModal and
 * the Post-Match Report already run (packages/scoring). A stored total is
 * never the source: asMatch() sets `scorecard: null` for every real fixture on
 * purpose, because a live score is derived, not a column.
 */
function useLiveScore(matchId) {
  const [state, setState] = useState({ loading: false, error: null, inn: null, target: null });
  useEffect(() => {
    if (!matchId || !signedIn()) { setState({ loading: false, error: null, inn: null, target: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const { events: rows } = await api(`/api/matches/${matchId}/events`);
        if (cancelled) return;
        const evs = (rows || []).map(fromRow);
        const { innings } = deriveMatch(evs);
        const curIn = innings.length - 1;
        const inn = curIn >= 0 ? innings[curIn] : null;
        const target = curIn === 1 ? (inn?.target ?? ((innings[0]?.runs || 0) + 1)) : null;
        setState({ loading: false, error: null, inn, target });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.code || "unreachable", inn: null, target: null });
      }
    })();
    return () => { cancelled = true; };
  }, [matchId]);
  return state;
}

function DashboardView({ role, onNav, onOpenScorer }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal, same as the KPI dashboard this replaces.
  const { rows: MATCHES, live: matchesAreLive } = useLive("matches", role);
  const INJURIES = useRows("injuries", role);
  const NOTIFICATIONS = useRows("notifications", role);
  const TRAINING = useRows("training", role);
  const PLAYERS = useRows("players", role);
  const WEATHER = useWeather(role);

  const holds = (capability) => holdsCapability(role, capability);
  const rc = ROLES[role];

  const liveMatch = MATCHES.find((m) => m.status === "live");
  const liveScore = useLiveScore(liveMatch?.id);

  const upcoming = MATCHES.filter((m) => m.status === "upcoming").sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const next = upcoming[0];

  // The bus for the next fixture — real trips when there is a session,
  // trip_mark's own read; the demo's seeded `transport` field otherwise
  // (data/mock.js, the field MatchCentreView already draws its own bus chip
  // from). No demo trip rows exist to fetch, so useLive("trips") answers []
  // signed out and this falls back on purpose.
  const { rows: TRIPS } = useLive("trips", role, 0, next ? { matchId: next.id } : null);
  const { coverage } = useDutyCoverage(next ? [next.id] : [], role);

  // ── this week: training and fixtures, as a list ──
  const weekStart = dateStr(today);
  const weekEnd = dateStr(addDays(today, 6));
  const weekMatches = upcoming.filter((m) => m.date && m.date >= weekStart && m.date <= weekEnd);
  const weekTraining = TRAINING.filter((s) => s.date && s.date >= weekStart && s.date <= weekEnd)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  // ── who is out: the availability tier alone (packages/policy/src/tables.mjs
  // — injury.read is medical.status.read; injury_type/severity/phase sit
  // behind medical.nature.read and are never read here) ──
  const out = INJURIES.filter((i) => i.restricted);

  const unread = NOTIFICATIONS.filter((n) => !n.read);

  // ── the board for "Now" ──
  let board = null;
  if (liveMatch) {
    if (signedIn()) {
      if (liveScore.inn) {
        board = {
          team: liveScore.inn.battingTeam || liveMatch.homeTeam,
          total: liveScore.inn.runs, wickets: liveScore.inn.wickets,
          overs: fmtOvers(liveScore.inn.balls),
          sub: boardSub(liveScore.inn, liveScore.target, liveMatch.overs),
        };
      }
    } else if (liveMatch.scorecard?.home) {
      const { runs, wkts } = parseScore(liveMatch.scorecard.home.score);
      board = { team: liveMatch.homeTeam, total: runs, wickets: wkts, overs: liveMatch.scorecard.home.overs, sub: null };
    }
  }

  const nextTrip = TRIPS.find((t) => t.matchId === next?.id);
  const busTime = next ? (signedIn() ? hm(nextTrip?.departAt) : (next.transport?.bus ? next.transport.depart : null)) : null;
  const dutyRows = next ? (coverage.get(next.id)?.rows ?? []) : [];
  const hasDuty = (key) => dutyRows.some((r) => r.duty === key);
  const w = next ? WEATHER[next.id] : null;

  return (
    <div className="os-page" data-testid="day-sheet">
      <div style={{ marginBottom: T.space.lg }}>
        <h1 style={{ ...T.role.title.lg, color: T.content.primary, marginBottom: "3px", display: "flex", alignItems: "center", gap: T.space.sm }}>
          <Icon name={rc?.icon ?? "layout-dashboard"} style={{ color: rc?.color }}/>
          {rc?.label ?? "Today"}
        </h1>
        <p style={{ ...T.role.body, color: T.content.secondary }}>
          {new Date().toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          {!matchesAreLive && " · Demonstration — no server connected"}
        </p>
      </div>

      <Bento>
        {/* 1. Now — a live fixture, on the board, full width. */}
        {liveMatch && (
          <BentoCard level="a" title="Now" data-testid="day-now">
            {board ? (
              <>
                <Board team={board.team} total={board.total} wickets={board.wickets} overs={board.overs} sub={board.sub} testid="day-board"/>
                <div style={{ marginTop: T.space.md }}>
                  {canScore(role)
                    ? <Btn variant="success" onClick={() => onOpenScorer && onOpenScorer(liveMatch)}>Open scorer</Btn>
                    : <Btn variant="ghost" onClick={() => onNav && onNav("matches")}>Match Centre</Btn>}
                </div>
              </>
            ) : (
              <EmptyState loading={liveScore.loading} error={liveScore.error} message="The live score is not available yet." icon="scorebook"/>
            )}
          </BentoCard>
        )}

        {/* 2. Today / next — the next fixture, ready or not. */}
        {holds("fixture.read") && (
          <BentoCard level="b" title="Next fixture" data-testid="day-next">
            {next ? (
              <div data-testid={`next-fixture-${next.id}`}>
                <div style={{ ...T.role.title.md, color: T.content.primary }}>{next.homeTeam} v {next.awayTeam}</div>
                <div style={{ ...T.role.body, color: T.content.secondary, marginTop: T.space.xs }}>
                  {humanDateTime(next.date, next.time)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: T.space.xs, marginTop: T.space.sm }}>
                  {next.venue && <div style={{ ...T.role.body, color: T.content.secondary }}><Icon name="map-pin"/> {next.venue}</div>}
                  {busTime && <div style={{ ...T.role.body, color: T.content.secondary }}><Icon name="bus"/> Bus {busTime}</div>}
                  {w && (
                    <div style={{ ...T.role.body, color: T.content.secondary }}>
                      <Icon name={isIcon(w.icon) ? w.icon : "cloud-sun"}/> {w.tempC}° {String(w.condition ?? "").toLowerCase()}
                      {w.rainChancePct >= 40 ? ", rain likely" : ""}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: T.space.xs, marginTop: T.space.md }}>
                  {READY_SLOTS.map((s) => {
                    const on = s.on(hasDuty);
                    return (
                      <span key={s.key} data-testid={`ready-${s.key}`} style={{
                        padding: "3px 10px", borderRadius: T.radius.pill,
                        ...T.role.label, textTransform: "none", letterSpacing: 0, fontWeight: 500,
                        background: on ? D.emerald + "14" : T.surface.interactive,
                        border: `1px solid ${on ? D.emerald + "38" : T.line.normal}`,
                        color: on ? D.emerald : T.content.tertiary,
                      }}>{s.label} · {on ? "on record" : "nothing on record"}</span>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyState message="No fixture is arranged yet." icon="calendar-days"/>
            )}
          </BentoCard>
        )}

        {/* 3. Who is out — availability, never the clinical tier. */}
        {holds("medical.status.read") && (
          <BentoCard level="c" title="Who is out" data-testid="day-out">
            {out.length === 0 ? (
              <EmptyState message="Nobody is out." icon="circle-check"/>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {out.map((i) => (
                  <div key={i.id} data-testid={`out-${i.id}`} style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm }}>
                    <span style={{ ...T.role.body, color: T.content.primary }}>{PLAYERS.find((p) => p.id === i.player)?.name ?? "—"}</span>
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
            {weekMatches.length === 0 && weekTraining.length === 0 ? (
              <EmptyState message="Nothing scheduled this week." icon="calendar"/>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
                {holds("fixture.read") && weekMatches.map((m) => (
                  <div key={m.id} data-testid={`week-fixture-${m.id}`} style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                    <Icon name="trophy"/>
                    <span style={{ ...T.role.body, color: T.content.primary, flex: 1 }}>{m.homeTeam} v {m.awayTeam}</span>
                    <span style={{ ...T.role.body, color: T.content.secondary }}>{humanDateTime(m.date, m.time)}</span>
                  </div>
                ))}
                {holds("team.read") && weekTraining.map((s) => (
                  <div key={s.id} data-testid={`week-training-${s.id}`} style={{ display: "flex", alignItems: "baseline", gap: T.space.sm }}>
                    <Icon name="dumbbell"/>
                    <span style={{ ...T.role.body, color: T.content.primary, flex: 1 }}>{s.title}</span>
                    <span style={{ ...T.role.body, color: T.content.secondary }}>{humanDate(s.date)}{s.time ? ` · ${s.time}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </BentoCard>
        )}

        {/* 5. Alerts — last, and only unread. Addressed to a person rather
            than read out of a scoped table, so every role that reaches this
            screen has the section; what is IN it is still scoped by news.read. */}
        <BentoCard level="c" title="Alerts" data-testid="day-alerts">
          {unread.length === 0 ? (
            <EmptyState message="Nothing unread." icon="bell"/>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
              {unread.slice(0, 6).map((n) => (
                <div key={n.id} data-testid={`alert-${n.id}`}>
                  <div style={{ ...T.role.body, fontWeight: 600, color: T.content.primary }}>{n.title}</div>
                  <div style={{ ...T.role.body, color: T.content.secondary }}>{n.body}</div>
                </div>
              ))}
            </div>
          )}
        </BentoCard>
      </Bento>
    </div>
  );
}

export { DashboardView };
