import { useEffect, useMemo, useState } from "react";
import { T } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { profile } from "../lib/session.js";
import { useDutyCoverage, useLive } from "../lib/live.js";
import { combineReads, readState } from "../lib/readState.js";
import { humanDate, humanDateTime } from "../lib/format.js";
import { deviceMatches } from "../lib/deviceMatches.js";
import { deviceId } from "../lib/device.js";
import { practiceHomeRows } from "../lib/practice.js";
import { pilotHomeRows, pilotStatus, pilotUuid, mayOfferLive, writeFailures } from "../lib/pilot.js";
import {
  SESSION_MAX_AGE_MS, STATE_WORDS, nextToPrepare, pendingWords, prepLines, resumeItems, scorerFixtures,
} from "../lib/scorerHome.js";
import {
  SANDBOX_WORDS, finishedPilots, homeSections, lastRecord, liveOffPhone, nowItems, p0Items, scoreLine, startWords, weekOf,
} from "../lib/scorerDay.js";
// The one status sentence (CRI-1.2): what the Match Centre's card says of a fixture, said here too.
import { statusSentence } from "../lib/matchCentre.js";
import { PlainRecord } from "./ScoringBlock.jsx";
import { ReadState } from "../ui/primitives.jsx";
import { Bento, BentoCard } from "../ui/surfaces.jsx";
import { Board } from "../ui/board.jsx";
import { Icon } from "../ui/icons.jsx";
import { StateLabel } from "../ui/stateLabel.jsx";

// ══════════════════════════════════════════════════════
//  THE SCORER'S HOME: the day sheet (GA-I13; R0, ROLE_DASHBOARDS_v1.1 §3D,
//  §4, §9; the widgets of ROLE_DASHBOARDS_R0_REGISTRY.md)
//
// Where a scorer lands after signing in, in the order his day happens:
//
//   P0          only when one applies: something on this phone not yet sent,
//               another device holding the scoring of a match on this phone,
//               events SCRBRD did not take, waiting on him
//   Now         what this phone is scoring, each on the one Board, and
//               "Resume scoring"
//   Start       the quick-start: the pad's own Pilot Match setup, opened at
//               its first step. There is no second setup
//   Pilot       finished Pilot Matches, each kept as a sandbox. Promotion is
//   Matches     R1 (PILOT_MATCH_PHASE2 §6): no promote action
//   This week   the fixtures he may score, appointed first, and what is
//               missing before the toss of the next one; only if he has any
//
// lib/scorerDay.js decides which sections show and their words, purely;
// lib/scorerHome.js the fixtures and their states. Every read is one the app
// already makes, and the phone's own stores come first: with no signal the
// home is drawn from what the pad saved, and each read that did not answer
// says so (GA-I08), never "none". No child is named on this screen: the
// board is drawn without batters or bowler, a team sheet is a count. A work
// mode: no sponsor slot (§7.1). A Pilot Match is in no figure here.
// ══════════════════════════════════════════════════════

/** A 44px button: the tap floor, which the shared Btn's sizes are under. */
function Act({ children, onClick, testId, tone = "primary", label }) {
  const primary = tone === "primary";
  return (
    <button type="button" onClick={onClick} data-testid={testId} aria-label={label} className="pressBtn" style={{
      minHeight: "44px", minWidth: "44px", padding: "0 20px", borderRadius: T.radius.pill,
      border: `1px solid ${primary ? "transparent" : T.line.normal}`,
      background: primary ? T.light.cobalt : T.surface.interactive,
      color: primary ? T.light.ink : T.content.primary,
      fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, cursor: "pointer", alignSelf: "flex-start",
    }}>{children}</button>
  );
}

// Functions, not constants: a token read at import time keeps the theme it was read under (design.test.mjs).
const line = () => ({ ...T.role.body, color: T.content.secondary, margin: 0 });
const strong = () => ({ ...T.role.title.md, color: T.content.primary, margin: 0, overflowWrap: "anywhere" });
const stack = (gap = T.space.md) => ({ display: "flex", flexDirection: "column", gap });

/** The two sides, in full where the read names them. @param {any} m */
const sidesOf = (m) => `${m.homeLabel ?? m.homeTeam ?? "Home"} v ${m.awayLabel ?? m.awayTeam ?? "Away"}`;

/**
 * Everything this phone holds of its matches, re-read on `nonce`: the pad's
 * saved fixture logs and its outbox (lib/deviceMatches.js), and the Pilot and
 * Practice stores with each match's log. All local: this is what the home is
 * drawn from with no signal.
 */
function usePhone(nonce) {
  const [s, setS] = useState({ loading: true, ok: true, saved: [], pending: new Map(), outbox: null, pilots: [], practices: [], storesOk: true });
  useEffect(() => {
    let off = false;
    setS((x) => ({ ...x, loading: true }));
    // The stores hand the home each match's board and title, never its log or a name (review S6).
    Promise.all([
      deviceMatches().catch(() => ({ ok: false, saved: [], pending: new Map(), outbox: null })),
      pilotHomeRows().then((rows) => ({ ok: true, rows })).catch(() => ({ ok: false, rows: [] })),
      practiceHomeRows().then((rows) => ({ ok: true, rows })).catch(() => ({ ok: false, rows: [] })),
    ]).then(([d, p, q]) => {
      if (!off) setS({ loading: false, ...d, pilots: p.rows, practices: q.rows, storesOk: p.ok && q.ok });
    });
    return () => { off = true; };
  }, [nonce]);
  return s;
}

/** What SCRBRD last said of this account's Pilot Matches (lib/pilot.js; remembered on this phone for a ground with no signal). */
function usePilotStatus(nonce) {
  const [s, setS] = useState({ loading: true, status: null });
  useEffect(() => {
    let off = false;
    setS((x) => ({ ...x, loading: true }));
    pilotStatus().catch(() => null).then((status) => { if (!off) setS({ loading: false, status }); });
    return () => { off = true; };
  }, [nonce]);
  return s;
}

/**
 * The server's own Pilot Matches (GET /api/pilot/mine): who holds each one's
 * scoring, and those finished that this phone does not have. Asked only with
 * a sign-in and when there is a Pilot Match to ask about; `rows` null when it
 * did not answer.
 */
function usePilotServer(nonce, wanted) {
  const [s, setS] = useState({ loading: false, rows: null, error: null, observedAt: null, asked: false });
  useEffect(() => {
    if (!wanted || !signedIn()) { setS({ loading: false, rows: null, error: null, observedAt: null, asked: false }); return undefined; }
    let off = false;
    setS((x) => ({ ...x, loading: true, asked: true }));
    api("/api/pilot/mine", { timeoutMs: 5000 })
      .then((r) => { if (!off) setS({ loading: false, rows: Array.isArray(r?.matches) ? r.matches : [], error: null, observedAt: Date.now(), asked: true }); })
      .catch((e) => { if (!off) setS({ loading: false, rows: null, error: e ?? "unreachable", observedAt: null, asked: true }); });
    return () => { off = true; };
  }, [nonce, wanted]);
  return s;
}

/**
 * The fold the events read gives (SCRBRD-114): the playing conditions the
 * first ball will fix. Asked with a `since` past any seq, so no event comes
 * back, only the fold, the pad's own liveFold() question. undefined while
 * coming, null when it did not answer.
 */
function useFold(matchId, wanted, nonce) {
  const [fold, setFold] = useState(undefined);
  useEffect(() => {
    if (!matchId || !wanted || !signedIn()) { setFold(undefined); return; }
    let off = false;
    setFold(undefined);
    api(`/api/matches/${matchId}/events?since=2147483647`)
      .then((r) => { if (!off) setFold(r?.fold ?? null); })
      .catch(() => { if (!off) setFold(null); });
    return () => { off = true; };
  }, [matchId, wanted, nonce]);
  return fold;
}

/** "today 10:42", "yesterday 17:05", "3 Oct 14:30": when this phone last saved the log. */
function savedAtWords(ts, now) {
  const d = new Date(ts), n = new Date(now);
  const hm = d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = (x) => x.toDateString();
  if (day(d) === day(n)) return `today ${hm}`;
  if (day(d) === day(new Date(now - 864e5))) return `yesterday ${hm}`;
  return `${d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} ${hm}`;
}

function ScorerHomeView({ role, onOpenScorer, onOpenPad, onNav }) {
  const [nonce, setNonce] = useState(0);
  const retry = () => setNonce((n) => n + 1);
  // The clock, ticking, so "last observed 3 minutes ago" and a lease's end move without a read.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30e3); return () => clearInterval(t); }, []);

  const live = signedIn();
  const matchesRead = useLive("matches", role, nonce);
  const officialsRead = useLive("officials", role, nonce);
  const me = profile();
  // Null in the demonstration: lib/scorerHome.js then lists the client-scoped fixtures as they are.
  const mine = me?.assignments;
  const assignments = useMemo(() => (live ? mine ?? [] : null), [live, mine]);
  const userId = me?.user?.id ?? null;

  // First the list without the sessions, to know which fixtures to ask about;
  // then the duty roster of each (the session's state and holder, the team
  // sheet, umpires, pitch report), the same read the office's roster runs.
  const base = useMemo(() => scorerFixtures({ matches: matchesRead.rows, assignments, officials: officialsRead.rows, userId, now }),
    [matchesRead.rows, assignments, officialsRead.rows, userId, now]);
  const ids = base.shown.map((i) => i.match.id);
  const { coverage, loading: coverageLoading } = useDutyCoverage(ids, role, nonce);
  const [observedAt, setObservedAt] = useState(null);
  useEffect(() => { if (!coverageLoading) setObservedAt(Date.now()); }, [coverage, coverageLoading]);
  const list = useMemo(() => scorerFixtures({ matches: matchesRead.rows, assignments, officials: officialsRead.rows, userId, coverage, now }),
    [matchesRead.rows, assignments, officialsRead.rows, userId, coverage, now]);

  // ── the phone's own state, first ──
  const phone = usePhone(nonce);
  const pilotNow = usePilotStatus(nonce);
  const pilotOffer = mayOfferLive(pilotNow.status);
  const pilotServer = usePilotServer(nonce, pilotOffer || phone.pilots.length > 0);
  const matchesAnswered = live && !matchesRead.loading && !matchesRead.error;
  const resume = resumeItems({ saved: phone.saved, pending: phone.pending, serverMatches: matchesAnswered ? matchesRead.rows : null });
  const nowList = nowItems({ fixtures: resume, pilots: phone.pilots, practices: phone.practices,
                             pending: phone.outbox?.pending ?? null, held: phone.outbox?.held ?? null });
  // Now is what this phone is part-way through: a Pilot Match that is over (finished, or called off)
  // is not, though what of it is unsent stays on the P0 card (re-check 1; review S1).
  const nowShown = nowList.filter((i) => !i.finished);
  // His side's fixtures that are live and not on this phone (§1.10, C1): "Now" holds them, with their sentence and the pad.
  const liveElsewhere = liveOffPhone(list.items, nowShown);
  // After a match: the last one this phone finished, as a plain record (§3.9).
  const record = lastRecord({ practices: phone.practices, pilots: phone.pilots, pending: phone.outbox?.pending ?? null, held: phone.outbox?.held ?? null });

  // ── P0: from what the phone holds and what the reads said ──
  const fixtureStates = new Map(list.items.map((i) => [i.match.id, i.state]));
  const pilotSessions = pilotServer.rows
    ? new Map(pilotServer.rows.map((m) => [`pilot-${m.id}`, m.session ?? null]))
    : null;
  // A record write the pad could not save (review S3), said on the P0 card.
  const failures = Object.entries(writeFailures()).map(([id, f]) => ({ id, what: f?.what ?? "a change", title: phone.pilots.find((r) => r.id === id)?.title ?? null }));
  const p0 = p0Items(nowList, { fixtureStates, pilotSessions, device: deviceId(), at: now, failures });

  // ── the finished Pilot Matches, and this week ──
  const finished = finishedPilots(phone.pilots, pilotServer.rows, pilotUuid);
  const pilotsKnown = phone.pilots.length + (pilotServer.rows ?? []).filter((m) => !phone.pilots.some((r) => pilotUuid(r.id) === m.id)).length;
  const { week, later } = weekOf(list, now);

  // From the fixtures drawn, whose duty rosters were read.
  const prep = nextToPrepare(week);
  const prepMatch = prep?.match ?? null;
  const fold = useFold(prepMatch?.id, prepMatch ? prepMatch.competitionId != null : false, nonce);
  const prepCov = prepMatch ? coverage.get(prepMatch.id) : null;
  const prepDuties = !live ? [] : coverageLoading && !prepCov ? undefined : prepCov?.error ? null : prepCov?.rows ?? null;

  // ── what each read says (GA-I08) ──
  const fixturesRead = live
    ? combineReads([{ what: "your fixtures", read: matchesRead }, { what: "your appointments", read: officialsRead }], { now })
    : null;
  const sessionsRead = live && ids.length
    ? readState({ rows: ids, loading: coverageLoading && !observedAt, error: null, observedAt },
                { what: "who is scoring each match", maxAgeMs: SESSION_MAX_AGE_MS, now })
    : null;
  const phoneRead = readState({ rows: nowShown, loading: phone.loading, error: phone.ok && phone.storesOk ? null : "unreadable" },
                              { what: "this phone's saved matches" });
  // Who holds each Pilot Match's scoring: only said when a Pilot Match is on the board and the answer is not a fresh one.
  const pilotOnBoard = nowShown.some((i) => i.kind === "pilot");
  const leaseRead = !pilotOnBoard ? null
    : !pilotServer.asked ? { state: "stale", sentence: "Which phone holds the scoring was not checked with SCRBRD: that needs signal and a sign-in.", retry: false }
    : readState({ rows: pilotServer.rows ?? [], loading: pilotServer.loading, error: pilotServer.error, observedAt: pilotServer.observedAt },
                { what: "which phone holds the scoring", maxAgeMs: SESSION_MAX_AGE_MS, now });
  const finishedRead = readState({ rows: finished, loading: phone.loading, error: phone.storesOk ? null : "unreadable" },
                                 { what: "this phone's Pilot Matches" });

  const sections = homeSections({ p0: p0.length, pilotOffer, pilotsKnown, week: week.length, weekRead: fixturesRead?.state ?? null, record: !!record });
  /** A fixture's status sentence, as the Match Centre's list card says it: no fold here, the fixture's own facts. @param {any} m */
  const sentenceOf = (m) => statusSentence(m, null).text;
  const start = startWords(pilotNow.status, pilotNow.loading);

  const open = (m) => onOpenScorer && onOpenScorer(m);
  /** Open the pad on what this item is: a fixture through the shell's own route, a Pilot or Practice Match by its id. */
  const openItem = (it) => (it.kind === "fixture" ? open(it.match) : onOpenPad && onOpenPad({ resume: it.matchId }));
  const labelFor = (it) => (it.kind === "pilot" ? <StateLabel kind="pilot" compact/> : it.kind === "practice" ? <StateLabel kind="practice" compact/> : null);

  return (
    <div className="os-page" data-testid="scorer-home" data-sections={sections.join(",")}>
      <div style={{ marginBottom: T.space.lg }}>
        <h1 style={{ ...T.role.title.lg, color: T.content.primary, marginBottom: "3px", display: "flex", alignItems: "center", gap: T.space.sm }}>
          <Icon name="notebook-pen"/> Scoring
        </h1>
        <div style={{ ...line(), display: "flex", flexWrap: "wrap", alignItems: "center", gap: `0 ${T.space.sm}` }}>
          <span>{new Date(now).toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</span>
          {!live && <StateLabel kind="demo" compact why="no server connected"/>}
        </div>
      </div>

      {/* P0: only when one applies. Each says its match and opens the pad, where the send, the take-over and the held list are. */}
      {sections.includes("p0") && (
        <section data-testid="scorer-p0" aria-labelledby="scorer-p0-title" style={{
          marginBottom: T.space.md, padding: `${T.space.md} ${T.space.lg}`, borderRadius: T.radius.lg,
          background: T.surface.raised, border: `1px solid ${T.line.normal}`, borderLeft: `4px solid ${T.semantic.critical}`,
        }}>
          <h2 id="scorer-p0-title" style={{ ...T.role.title.md, color: T.content.primary, margin: `0 0 ${T.space.sm}`, display: "flex", alignItems: "center", gap: T.space.xs }}>
            <Icon name="triangle-alert" style={{ color: T.semantic.criticalText }}/> Needs you first
          </h2>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, ...stack() }}>
            {p0.map((x) => (
              <li key={x.key} data-testid={`p0-${x.kind}-${x.matchId}`} data-kind={x.kind} style={stack(T.space.xs)}>
                <p style={{ ...T.role.body, color: T.content.primary, fontWeight: 700, margin: 0, overflowWrap: "anywhere" }}>{x.label}</p>
                <p style={{ ...line(), color: T.content.primary, overflowWrap: "anywhere" }}>{x.title}</p>
                <p style={line()}>{x.note}</p>
                <Act testId={`p0-${x.kind}-${x.matchId}-open`} label={`${x.kind === "queue" ? "Resume scoring" : "Open the pad"}: ${x.title}`}
                  onClick={() => openItem(x.item)}>{x.kind === "queue" ? "Resume scoring" : "Open the pad"}</Act>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Bento>
        {/* Now: what this phone is scoring, on the one Board. */}
        <BentoCard level="a" title="Now" data-testid="scorer-resume">
          {phoneRead.state === "loading" || phoneRead.state === "failed"
            ? <ReadState read={phoneRead} onRetry={retry} compact testId="scorer-resume-read"/>
            : (
              <div style={stack(T.space.lg)}>
                {nowShown.length === 0 && liveElsewhere.length === 0 && (
                  <p style={line()} data-testid="scorer-resume-empty">Nothing on this phone to resume. A match you start or score here is kept here first.</p>
                )}
                {/* His side's live fixture, not on this phone: its sentence, and the pad (whose take-over is the route where another device holds it). */}
                {liveElsewhere.map(({ match: m, state }) => {
                  const w = STATE_WORDS[state];
                  return (
                    <div key={`live-${m.id}`} data-testid={`now-live-${m.id}`} data-state={state} style={stack(T.space.sm)}>
                      <p style={strong()}>{sidesOf(m)}</p>
                      <p style={{ ...line(), color: T.content.primary, fontWeight: 600 }} data-testid={`now-live-${m.id}-sentence`}>{sentenceOf(m)}</p>
                      {w?.label && <p style={line()} data-testid={`now-live-${m.id}-state`}>{w.label}{w.note ? `. ${w.note}` : ""}</p>}
                      <Act testId={`now-live-${m.id}-open`} label={`Open the pad: ${sidesOf(m)}`} onClick={() => open(m)}>Open the pad</Act>
                    </div>
                  );
                })}
                {leaseRead && leaseRead.state !== "ok" && leaseRead.state !== "empty" && (
                  <ReadState read={leaseRead} onRetry={retry} compact testId="scorer-lease-read"/>
                )}
                {nowShown.map((it) => (
                  <div key={it.key} data-testid={`resume-${it.matchId}`} data-kind={it.kind} data-pending={it.pending ?? "unknown"} style={stack(T.space.sm)}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: `0 ${T.space.sm}` }}>
                      <p style={strong()}>{it.title}</p>
                      {labelFor(it)}
                    </div>
                    {it.error
                      ? <p role="alert" style={{ ...line(), color: T.semantic.criticalText }} data-testid={`resume-${it.matchId}-unread`}>Could not read this match's balls on this phone. Nothing is deleted.</p>
                      : it.board
                      ? <Board {...it.board} size="card" compact testid={`resume-${it.matchId}-board`}/>
                      : <p style={line()} data-testid={`resume-${it.matchId}-noboard`}>No ball on the board yet.</p>}
                    <p style={line()} data-testid={`resume-${it.matchId}-pending`}>
                      {it.kind === "practice" ? "Kept on this phone only: nothing is sent" : pendingWords(it.pending)}
                      {it.savedAt ? ` · saved ${savedAtWords(it.savedAt, now)}` : ""}
                    </p>
                    {it.openable
                      ? <Act testId={`resume-${it.matchId}-open`} label={`Resume scoring: ${it.title}`} onClick={() => openItem(it)}>Resume scoring</Act>
                      : <p style={line()} data-testid={`resume-${it.matchId}-closed`}>
                          This match is no longer on your fixture list, so it does not open here. What is saved stays on this phone; the school office can help.
                        </p>}
                  </div>
                ))}
              </div>
            )}
        </BentoCard>

        {/* Start: the pad's own quick-start, opened at its first step. */}
        <BentoCard level="b" title="Start a match" data-testid="scorer-start" data-state={start.state}>
          <div style={stack()}>
            <p style={line()} data-testid="scorer-start-note">{start.note}</p>
            <Act testId="scorer-start-pilot" label={start.action} onClick={() => onOpenPad && onOpenPad({ start: "pilot" })}>{start.action}</Act>
            <Act tone="secondary" testId="resume-practice-open" label="Open the pad's start screen" onClick={() => open(null)}>Open the pad</Act>
          </div>
        </BentoCard>

        {/* After a match: what he scored, as a plain record (§3.9). No points, streaks or rankings. */}
        {sections.includes("record") && record && (
          <BentoCard level="b" title="Your last match" data-testid="scorer-record">
            <PlainRecord record={record} testId="scorer-record-match"/>
          </BentoCard>
        )}

        {/* Finished Pilot Matches: kept as a sandbox. Promotion is R1; nothing here promotes. */}
        {sections.includes("pilots") && (
          <BentoCard level="b" title="Pilot Matches" data-testid="scorer-pilots">
            {finishedRead.state === "loading" || finishedRead.state === "failed" ? (
              <ReadState read={finishedRead} onRetry={retry} compact testId="scorer-pilots-read"/>
            ) : (
              <div style={stack()}>
                {pilotServer.asked && pilotServer.error && (
                  <p role="status" data-testid="scorer-pilots-server" style={line()}>Could not read SCRBRD's copies, so these are this phone's.</p>
                )}
                {finished.length === 0 ? (
                  <p style={line()} data-testid="scorer-pilots-empty">{SANDBOX_WORDS.empty}</p>
                ) : (
                  <ul data-testid="scorer-pilot-list" style={{ listStyle: "none", margin: 0, padding: 0, ...stack() }}>
                    {finished.map((r) => (
                      <li key={r.key} data-testid={`pilot-done-${r.id}`} data-state="sandbox" style={{ ...stack(T.space.xs), paddingBottom: T.space.md, borderBottom: `1px solid ${T.line.subtle}` }}>
                        <p style={strong()}>{r.title}</p>
                        {r.lines.length > 0 && <p style={{ ...line(), overflowWrap: "anywhere" }}>{r.lines.map(scoreLine).join(" · ")}</p>}
                        <p style={{ ...line(), color: T.content.primary, fontWeight: 600 }} data-testid={`pilot-done-${r.id}-state`}>
                          {r.words} · {SANDBOX_WORDS.kept}
                        </p>
                        <p style={line()}>{SANDBOX_WORDS.why}{r.onPhone ? "" : " On SCRBRD, not on this phone: My Pilot Matches brings it here."}</p>
                        {r.onPhone && (
                          <Act tone="secondary" testId={`pilot-done-${r.id}-open`} label={`Open the scorecard: ${r.title}`}
                            onClick={() => onOpenPad && onOpenPad({ resume: r.id })}>Open the scorecard</Act>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </BentoCard>
        )}

        {/* This week: appointed first, then the side's other fixtures; and before the toss of the next one. */}
        {sections.includes("week") && (
          <BentoCard level="b" title="This week" data-testid="scorer-fixtures">
            {fixturesRead && ["loading", "failed", "forbidden", "disabled"].includes(fixturesRead.state) ? (
              <ReadState read={fixturesRead} onRetry={retry} compact testId="scorer-fixtures-read"/>
            ) : (
              <div style={stack(T.space.lg)}>
                {fixturesRead?.state === "partial" && <ReadState read={fixturesRead} onRetry={retry} compact testId="scorer-fixtures-read"/>}
                {sessionsRead && sessionsRead.state === "stale" && <ReadState read={sessionsRead} onRetry={retry} compact testId="scorer-sessions-read"/>}
                <ol style={{ listStyle: "none", margin: 0, padding: 0, ...stack(T.space.lg) }} data-testid="scorer-fixture-list">
                  {week.map(({ match: m, appointment: a, group, state, sessionError }) => {
                    const w = STATE_WORDS[state];
                    return (
                      <li key={m.id} data-testid={`fixture-${m.id}`} data-group={group} data-state={state}
                        style={{ ...stack(T.space.xs), paddingBottom: T.space.md, borderBottom: `1px solid ${T.line.subtle}` }}>
                        {a ? (
                          <p data-testid={`fixture-${m.id}-appointed`} style={{ ...T.role.label, color: T.brand.accentText, margin: 0 }}>
                            Appointed to score{a.appointedAt ? ` · named ${humanDate(a.appointedAt)}` : ""}
                          </p>
                        ) : (
                          <p style={{ ...T.role.label, color: T.content.tertiary, margin: 0 }}>Your side's fixture</p>
                        )}
                        <p style={strong()}>{sidesOf(m)}</p>
                        <p style={line()}>{humanDateTime(m.date, m.time)}{m.venue ? ` · ${m.venue}` : ""}</p>
                        {a?.paused && (
                          <p data-testid={`fixture-${m.id}-paused`} style={{ ...line(), color: T.semantic.warningText }}>
                            The school office has paused your appointment to this match. They can tell you more.
                          </p>
                        )}
                        {/* The status sentence (§3.9), once: where it says what the state says ("Not started"), the state alone. */}
                        {sentenceOf(m) !== w.label && <p data-testid={`fixture-${m.id}-sentence`} style={{ ...line(), color: T.content.primary }}>{sentenceOf(m)}</p>}
                        <p data-testid={`fixture-${m.id}-state`} style={{ ...line(), color: T.content.primary, fontWeight: 600 }}>{w.label}</p>
                        {sessionError && (
                          <p data-testid={`fixture-${m.id}-session-read`} role="alert" style={{ ...line(), color: T.semantic.criticalText }}>
                            Could not read who is scoring this match.
                          </p>
                        )}
                        {w.note && <p style={line()}>{w.note}</p>}
                        {w.action
                          ? <Act testId={`fixture-${m.id}-open`} tone={state === "not_started" || state === "held_here" ? "primary" : "secondary"}
                              label={`${w.action}: ${sidesOf(m)}`} onClick={() => open(m)}>{w.action}</Act>
                          : <Act testId={`fixture-${m.id}-centre`} tone="secondary" label={`Match Centre: ${sidesOf(m)}`}
                              onClick={() => onNav && onNav("matches")}>Match Centre</Act>}
                      </li>
                    );
                  })}
                </ol>
                {later > 0 && <p style={line()} data-testid="scorer-fixtures-later">{later} more later; the Match Centre lists them.</p>}

                {/* Before the toss, for the next fixture this week not started. */}
                {prepMatch && (
                  <div data-testid="scorer-prep" style={{ ...stack(T.space.sm), paddingTop: T.space.sm, borderTop: `1px solid ${T.line.subtle}` }}>
                    <h3 style={{ ...T.role.label, color: T.content.tertiary, margin: 0 }}>Before the toss</h3>
                    <p style={strong()} data-testid="scorer-prep-match">{sidesOf(prepMatch)} · {humanDateTime(prepMatch.date, prepMatch.time)}</p>
                    {prepDuties === undefined
                      ? <ReadState read={readState({ loading: true }, { what: "the duty roster" })} compact testId="scorer-prep-read"/>
                      : (
                        <ul style={{ listStyle: "none", margin: 0, padding: 0, ...stack(T.space.sm) }}>
                          {prepLines({ match: prepMatch, duties: prepDuties, fold: prepMatch.competitionId != null && !live ? null : fold }).map((l) => (
                            <li key={l.key} data-testid={`prep-${l.key}`} data-state={l.state} style={stack("2px")}>
                              <span style={{ ...T.role.body, color: T.content.primary, fontWeight: 600, display: "flex", alignItems: "center", gap: T.space.xs }}>
                                <Icon name={l.state === "ok" ? "circle-check" : l.state === "missing" ? "triangle-alert" : "hourglass"}
                                  style={{ color: l.state === "ok" ? T.semantic.positive : l.state === "missing" ? T.semantic.warningText : T.content.tertiary }}/>
                                {l.label}
                              </span>
                              <span style={{ ...line(), color: l.state === "unknown" ? T.semantic.criticalText : T.content.secondary }}>
                                {l.text}{l.who ? ` · ${l.who} sets this` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>
                )}
              </div>
            )}
          </BentoCard>
        )}
      </Bento>
    </div>
  );
}

export { ScorerHomeView };
