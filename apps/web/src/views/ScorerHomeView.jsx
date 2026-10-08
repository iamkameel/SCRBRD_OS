import { useEffect, useMemo, useState } from "react";
import { T } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { profile } from "../lib/session.js";
import { useDutyCoverage, useLive } from "../lib/live.js";
import { combineReads, readState } from "../lib/readState.js";
import { humanDate, humanDateTime } from "../lib/format.js";
import { deviceMatches } from "../lib/deviceMatches.js";
import { inProgressPractice, savedWords } from "../lib/practice.js";
import {
  SESSION_MAX_AGE_MS, STATE_WORDS, nextToPrepare, pendingWords, prepLines, resumeItems, scorerFixtures,
} from "../lib/scorerHome.js";
import { EmptyState, ReadState } from "../ui/primitives.jsx";
import { Bento, BentoCard } from "../ui/surfaces.jsx";
import { Icon } from "../ui/icons.jsx";
import { PracticeLabel } from "../scorer/practiceLabel.jsx";

// ══════════════════════════════════════════════════════
//  THE SCORER'S HOME (GA-I13)
//
// Where a scorer lands after signing in. The day sheet showed him the first
// live fixture of the school and the school's next one; what he needs is
// three things, in this order:
//
//   1. Resume       a match this device is mid-way through, with what it still
//                   has to send: one tap reopens the pad, as a reload does.
//   2. Today/next   the fixtures he may score, the ones he is appointed to
//                   first (Kameel, 8 Oct: the appointment shapes this list,
//                   it does not gate the claim), each with the state a scorer
//                   acts on: not started, on this device, on another device
//                   (the pad's take-over is the route), complete.
//   3. Before the   for the next fixture: team sheet, umpires, ground, pitch
//      toss         report, playing conditions; each missing one with who
//                   fixes it.
//
// Every read is one the app already makes; lib/scorerHome.js decides the
// order and the words, purely. No child is named on this screen: a team
// sheet is a count. Each section says, per GA-I08, whether its read is still
// coming, failed, refused or old, and never draws one of those as "none".
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

const line = { ...T.role.body, color: T.content.secondary, margin: 0 };
const strong = { ...T.role.title.md, color: T.content.primary, margin: 0, overflowWrap: "anywhere" };

/** The two sides, in full where the read names them. @param {any} m */
const sidesOf = (m) => `${m.homeLabel ?? m.homeTeam ?? "Home"} v ${m.awayLabel ?? m.awayTeam ?? "Away"}`;

/** This device's saved matches and its practice match in progress; re-read on `nonce`. */
function useDevice(nonce) {
  const [s, setS] = useState({ loading: true, ok: true, saved: [], pending: new Map(), practice: null });
  useEffect(() => {
    let off = false;
    setS((x) => ({ ...x, loading: true }));
    (async () => {
      const [d, practice] = await Promise.all([
        deviceMatches().catch(() => ({ ok: false, saved: [], pending: new Map() })),
        inProgressPractice().catch(() => null),
      ]);
      if (!off) setS({ loading: false, ...d, practice });
    })();
    return () => { off = true; };
  }, [nonce]);
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

function ScorerHomeView({ role, onOpenScorer, onNav }) {
  const [nonce, setNonce] = useState(0);
  const retry = () => setNonce((n) => n + 1);
  // The clock, ticking, so "last observed 3 minutes ago" moves without a read.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30e3); return () => clearInterval(t); }, []);

  const live = signedIn();
  const matchesRead = useLive("matches", role, nonce);
  const officialsRead = useLive("officials", role, nonce);
  const me = profile();
  // Null in the demonstration: lib/scorerHome.js then lists the client-scoped fixtures as they are.
  const assignments = live ? me?.assignments ?? [] : null;
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

  const device = useDevice(nonce);
  const matchesAnswered = live && !matchesRead.loading && !matchesRead.error;
  const resume = resumeItems({ saved: device.saved, pending: device.pending, serverMatches: matchesAnswered ? matchesRead.rows : null });

  const prep = nextToPrepare(list.items);
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
  const deviceRead = readState({ rows: resume, loading: device.loading, error: device.ok ? null : "unreadable" },
                               { what: "this device's saved matches" });

  const open = (m) => onOpenScorer && onOpenScorer(m);

  return (
    <div className="os-page" data-testid="scorer-home">
      <div style={{ marginBottom: T.space.lg }}>
        <h1 style={{ ...T.role.title.lg, color: T.content.primary, marginBottom: "3px", display: "flex", alignItems: "center", gap: T.space.sm }}>
          <Icon name="notebook-pen"/> Scoring
        </h1>
        <p style={line}>
          {new Date(now).toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          {!live && " · Demonstration — no server connected"}
        </p>
      </div>

      <Bento>
        {/* 1. Resume: what this device is mid-way through. */}
        <BentoCard level="a" title="Resume on this device" data-testid="scorer-resume">
          {deviceRead.state === "loading" || deviceRead.state === "failed"
            ? <ReadState read={deviceRead} onRetry={retry} compact testId="scorer-resume-read"/>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
                {resume.length === 0 && !device.practice && (
                  <p style={line} data-testid="scorer-resume-empty">Nothing on this device to resume.</p>
                )}
                {resume.map((r) => (
                  <div key={r.matchId} data-testid={`resume-${r.matchId}`} data-pending={r.pending ?? "unknown"}
                    style={{ display: "flex", flexDirection: "column", gap: T.space.xs }}>
                    <p style={strong}>{r.title}</p>
                    <p style={line} data-testid={`resume-${r.matchId}-pending`}>
                      {pendingWords(r.pending)}{r.savedAt ? ` · saved ${savedWords(r.savedAt, now)}` : ""}
                    </p>
                    {r.openable
                      ? <Act testId={`resume-${r.matchId}-open`} onClick={() => open(r.match)}>Resume scoring</Act>
                      : <p style={line} data-testid={`resume-${r.matchId}-closed`}>
                          This match is no longer on your fixture list, so it does not open here. What is saved stays on this device; the school office can help.
                        </p>}
                  </div>
                ))}
                {device.practice && (
                  <div data-testid="resume-practice" style={{ display: "flex", flexDirection: "column", gap: T.space.xs }}>
                    <PracticeLabel/>
                    <p style={strong}>{device.practice.title}</p>
                    <p style={line}>Saved {savedWords(device.practice.savedAt, now)} · Resume is first on the pad's start screen.</p>
                    <Act tone="secondary" testId="resume-practice-open" onClick={() => open(null)}>Open the pad</Act>
                  </div>
                )}
              </div>
            )}
        </BentoCard>

        {/* 2. Today and next: appointed first, then the side's other fixtures. */}
        <BentoCard level="b" title="Today and next" data-testid="scorer-fixtures">
          {fixturesRead && ["loading", "failed", "forbidden", "disabled"].includes(fixturesRead.state) ? (
            <ReadState read={fixturesRead} onRetry={retry} compact testId="scorer-fixtures-read"/>
          ) : list.items.length === 0 ? (
            <EmptyState message="No fixture you may score is arranged from today on." icon="calendar-days"/>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: T.space.lg }}>
              {fixturesRead?.state === "partial" && <ReadState read={fixturesRead} onRetry={retry} compact testId="scorer-fixtures-read"/>}
              {sessionsRead && sessionsRead.state === "stale" && <ReadState read={sessionsRead} onRetry={retry} compact testId="scorer-sessions-read"/>}
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: T.space.lg }} data-testid="scorer-fixture-list">
                {list.shown.map(({ match: m, appointment: a, group, state, sessionError }) => {
                  const w = STATE_WORDS[state];
                  return (
                    <li key={m.id} data-testid={`fixture-${m.id}`} data-group={group} data-state={state}
                      style={{ display: "flex", flexDirection: "column", gap: T.space.xs, paddingBottom: T.space.md, borderBottom: `1px solid ${T.line.subtle}` }}>
                      {a ? (
                        <p data-testid={`fixture-${m.id}-appointed`} style={{ ...T.role.label, color: T.brand.accentText, margin: 0 }}>
                          Appointed to score{a.appointedAt ? ` · named ${humanDate(a.appointedAt)}` : ""}
                        </p>
                      ) : (
                        <p style={{ ...T.role.label, color: T.content.tertiary, margin: 0 }}>Your side's fixture</p>
                      )}
                      <p style={strong}>{sidesOf(m)}</p>
                      <p style={line}>{humanDateTime(m.date, m.time)}{m.venue ? ` · ${m.venue}` : ""}</p>
                      {a?.paused && (
                        <p data-testid={`fixture-${m.id}-paused`} style={{ ...line, color: T.semantic.warningText }}>
                          The school office has paused your appointment to this match. They can tell you more.
                        </p>
                      )}
                      <p data-testid={`fixture-${m.id}-state`} style={{ ...line, color: T.content.primary, fontWeight: 600 }}>{w.label}</p>
                      {sessionError && (
                        <p data-testid={`fixture-${m.id}-session-read`} role="alert" style={{ ...line, color: T.semantic.criticalText }}>
                          Could not read who is scoring this match.
                        </p>
                      )}
                      {w.note && <p style={line}>{w.note}</p>}
                      {w.action
                        ? <Act testId={`fixture-${m.id}-open`} tone={state === "not_started" || state === "held_here" ? "primary" : "secondary"}
                            label={`${w.action}: ${sidesOf(m)}`} onClick={() => open(m)}>{w.action}</Act>
                        : <Act testId={`fixture-${m.id}-centre`} tone="secondary" label={`Match Centre: ${sidesOf(m)}`}
                            onClick={() => onNav && onNav("matches")}>Match Centre</Act>}
                    </li>
                  );
                })}
              </ol>
              {list.later > 0 && <p style={line} data-testid="scorer-fixtures-later">{list.later} more later; the Match Centre lists them.</p>}
            </div>
          )}
        </BentoCard>

        {/* 3. Before the toss, for the next fixture not started. */}
        {prepMatch && (
          <BentoCard level="c" title="Before the toss" data-testid="scorer-prep">
            <p style={{ ...strong, marginBottom: T.space.sm }} data-testid="scorer-prep-match">{sidesOf(prepMatch)} · {humanDateTime(prepMatch.date, prepMatch.time)}</p>
            {prepDuties === undefined
              ? <ReadState read={readState({ loading: true }, { what: "the duty roster" })} compact testId="scorer-prep-read"/>
              : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: T.space.sm }}>
                  {prepLines({ match: prepMatch, duties: prepDuties, fold: prepMatch.competitionId != null && !live ? null : fold }).map((l) => (
                    <li key={l.key} data-testid={`prep-${l.key}`} data-state={l.state} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                      <span style={{ ...T.role.body, color: T.content.primary, fontWeight: 600, display: "flex", alignItems: "center", gap: T.space.xs }}>
                        <Icon name={l.state === "ok" ? "circle-check" : l.state === "missing" ? "triangle-alert" : "hourglass"}
                          style={{ color: l.state === "ok" ? T.semantic.positive : l.state === "missing" ? T.semantic.warningText : T.content.tertiary }}/>
                        {l.label}
                      </span>
                      <span style={{ ...line, color: l.state === "unknown" ? T.semantic.criticalText : T.content.secondary }}>
                        {l.text}{l.who ? ` · ${l.who} sets this` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </BentoCard>
        )}
      </Bento>
    </div>
  );
}

export { ScorerHomeView };
