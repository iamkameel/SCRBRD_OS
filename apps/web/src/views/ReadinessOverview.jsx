import { D } from "../design/tokens.js";
import { Fragment, useMemo, useState } from "react";
import { ROLES } from "../design/roles.js";
import { signedIn } from "../lib/api.js";
import { cockpitGate } from "../lib/cockpit.js";
import { requestCoach, requestDuties } from "../lib/cockpitNav.js";
import { useLive } from "../lib/live.js";
import { clockTime, headerWords } from "../lib/queue.js";
import { readState } from "../lib/readState.js";
import { profile } from "../lib/session.js";
import { Card, EmptyState, ReadState, SectionHeader } from "../ui/primitives.jsx";
import { humanDate } from "../lib/format.js";
import { useQueue } from "./cockpit/useQueue.js";
import { SLOTS } from "./duties.jsx";

// ══════════════════════════════════════════════════════
//  TO RESOLVE — what is waiting, who owns it, by when. SCRBRD-062, grown into
//  the match-day queue (docs/design/GA-I09-I11_match_day_queue.md §3.2, §3.3).
// ══════════════════════════════════════════════════════
//
// The screen that was "Readiness" (duty chips across eight fixtures) is the
// director's and the office's queue now. A ROW is a fact the data can prove,
// with the read it came from, whose it is, the queue's own clock and ONE door
// into the exact fixture tab or record. Nobody closes a row and nothing is
// marked done: it goes when the fact changes, and there is no "Seen" here
// (D7) — a school-wide blocker is open until its fact changes.
//
//   • The office's list sits above the fixtures: requests, sign-ins, adults
//     without a current clearance (O1–O3), and the lift exceptions on a TAP,
//     because that read is logged against children's names (O6, D6).
//   • Fixtures are grouped by date, then team, seven days of them; later ones
//     fold under "Later" and are read when opened.
//   • A school row is a COUNT — "1 restricted boy on the sheet", "4 have not
//     answered" — never a name; the name is one tap deeper, inside the
//     fixture the reader's own gate admits (§5, D8).
//   • A read that failed is a row that says so, never an empty group; zero
//     blockers and a failed read do not look alike (I08). The header always
//     draws its three numbers, so "0 open · 1 read failed" is never "all clear".
//
// Every row is a whole-row tap of at least 44px; its words are at least 12px;
// colour is never the only word. Presentation only: the reads are the
// database's, and a row appears only if the reader's own read returned it.
//
// The shell has no deep links, so a door leaves a note in lib/cockpitNav.js
// (the Match Centre takes it when it mounts) or just goes to the screen.

const body = { fontFamily: D.body, fontSize: "12px", lineHeight: 1.45 };
const rowBtn = { display: "block", width: "100%", minHeight: "44px", padding: "12px 16px", margin: 0, border: 0, borderTop: `1px solid ${D.border}`,
  background: "transparent", textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit", boxSizing: "border-box" };
const small = (/** @type {boolean} */ muted) => ({ ...body, display: "block", color: muted ? D.textMuted : D.textSecondary });
const tryBtn = { minHeight: "44px", minWidth: "44px", padding: "0 20px", margin: "0 16px 12px", borderRadius: D.pill, border: `1px solid ${D.border}`, background: D.surf3,
  color: D.textPrimary, fontFamily: D.head, fontSize: "13px", fontWeight: 700, cursor: "pointer" };

/** @typedef {(row: import("../lib/queue.js").Row) => {label: string, go: () => void} | null} DoorOf */

/** @param {{row: import("../lib/queue.js").Row, door: {label: string, go: () => void} | null, onRetry?: () => void}} p */
function Row({ row, door, onRetry }) {
    if (row.state === "could_not_read") {
      return (
        <li data-testid="queue-unread" data-read={row.read} style={{ borderTop: `1px solid ${D.border}`, listStyle: "none" }}>
          <span role="alert" style={{ ...body, display: "block", padding: "12px 16px 8px", color: D.roseText }}>{row.fact}</span>
          <button type="button" className="os-state" data-testid="queue-retry" data-read={row.read} onClick={onRetry} style={tryBtn}>{row.action?.label ?? "Try again"}</button>
        </li>
      );
    }
    const inner = (
      <>
        <span data-testid="queue-fact" style={{ display: "block", fontFamily: D.body, fontSize: "14px", fontWeight: 600, lineHeight: 1.4, color: D.textPrimary }}>{row.fact}</span>
        {(row.owner || row.deadline || row.age) && (
          <span data-testid="queue-owner" style={small(false)}>
            {[row.owner, row.deadline?.words ?? row.age].filter(Boolean).join(" · ")}
          </span>
        )}
        <span style={{ ...small(true), display: "flex", justifyContent: "space-between", gap: "10px", marginTop: "2px" }}>
          <span data-testid="queue-source">{row.source ? `from ${row.source}` : ""}</span>
          {door && <span data-testid="queue-door">{door.label} <span aria-hidden="true">›</span></span>}
        </span>
      </>
    );
    return (
      <li data-testid="queue-row" data-rule={row.rule} data-state={row.state} data-count={row.count} data-match={row.action?.matchId} style={{ listStyle: "none" }}>
        {door
          ? <button type="button" className="os-state" data-testid={`queue-open-${row.id}`} onClick={door.go} style={rowBtn}>{inner}</button>
          : <div style={{ ...rowBtn, cursor: "default" }}>{inner}</div>}
      </li>
    );
  };

/** One fixture: its header, its rows, its failed reads. @param {{g: import("../lib/queue.js").FixtureGroup, doorOf: DoorOf, retry: (id: string) => void}} p */
function Group({ g, doorOf, retry }) {
    const covered = g.dutyKeys ? SLOTS.filter((s) => g.dutyKeys?.includes(s.key)).length : null;
    const headId = `queue-group-${g.id}-head`;
    return (
      <Card sx={{ padding: 0 }} data-testid={`readiness-fixture-${g.id}`}>
        <section aria-labelledby={headId} data-testid="queue-group" data-match={g.id} data-open={g.open} data-failed={g.failed}>
          <header style={{ padding: "12px 16px", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
            <h3 id={headId} style={{ margin: 0, fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>
              {g.label}{g.start != null ? ` · ${clockTime(g.start)}` : ""}{g.calledOff ? " · called off" : ""}
            </h3>
            <span data-testid="queue-group-line" style={{ ...body, color: g.failed && !g.open ? D.roseText : D.textSecondary, fontWeight: 600 }}>{g.line}</span>
          </header>
          {g.loading ? <p style={{ ...small(true), padding: "0 16px 12px", margin: 0 }}>Reading the fixture…</p> : (
            <>
              {(g.rows.length > 0 || g.unread.length > 0) && (
                <ul style={{ margin: 0, padding: 0 }}>
                  {g.rows.map((r) => <Row key={r.id} row={r} door={doorOf(r)}/>)}
                  {g.unread.map((r) => <Row key={r.id} row={r} door={null} onRetry={() => retry(g.id)}/>)}
                </ul>
              )}
              {covered != null && !g.calledOff && (
                // The fixture's own duty count, from the same read its roster draws, so the two cannot differ (SCRBRD-062).
                <span data-testid={`readiness-covered-${g.id}`} style={{ ...small(true), padding: "10px 16px 12px", borderTop: g.rows.length || g.unread.length ? `1px solid ${D.border}` : undefined }}>
                  {covered} of {SLOTS.length} on record
                </span>
              )}
            </>
          )}
        </section>
      </Card>
    );
}

/** @param {{days: ReturnType<typeof useQueue>["days"], doorOf: DoorOf, retry: (id: string) => void}} p */
function Days({ days, doorOf, retry }) {
  return days.map((d) => (
    <section key={d.day} aria-labelledby={`queue-day-${d.day}`} data-testid={`queue-day-${d.day}`} style={{ display: "grid", gap: "10px" }}>
      <h2 id={`queue-day-${d.day}`} style={{ margin: "6px 0 0", fontFamily: D.head, fontSize: "12px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: D.textMuted }}>{d.label}</h2>
      {d.groups.map((g) => <Group key={g.id} g={g} doorOf={doorOf} retry={retry}/>)}
    </section>
  ));
}

function ReadinessOverview({ role, onNav }) {
  // The fixtures read keeps its state: "No upcoming fixtures" is said of a read
  // that answered, never of one that failed or has not come back (GA-I08).
  const [nonce, setNonce] = useState(0);
  const matchesRead = useLive("matches", role, nonce);
  const matches = matchesRead.rows;
  const matchesSaid = readState(matchesRead, { what: "the fixtures" });
  const now = useMemo(() => Date.now(), []);
  const assignments = signedIn() ? profile()?.assignments : null;
  const q = useQueue({ matches, assignments, now });
  const nav = ROLES[role]?.nav ?? [];
  const byId = useMemo(() => new Map(matches.map((m) => [m.id, m])), [matches]);
  const schools = new Set((assignments ?? []).map((a) => a.school).filter(Boolean)).size;

  // The one door of a row: the exact screen it opens, said on the row in its own words. A door the reader has no
  // screen for falls back to the fixture, or to nothing (a row with no door is information).
  const doorOf = (/** @type {import("../lib/queue.js").Row} */ row) => {
    const a = row.action;
    if (!a || a.kind === "retry") return null;
    const m = a.matchId ? byId.get(a.matchId) : null;
    const fixture = m ? { label: "Open the fixture", go: () => { requestDuties(m.id); onNav("matches"); } } : null;
    const page = (/** @type {string} */ p, /** @type {string} */ label) => (nav.includes(p) ? { label, go: () => onNav(p) } : null);
    switch (a.kind) {
      case "side": return m && cockpitGate(assignments, m) ? { label: "Open the side", go: () => { requestCoach(m.id, false); onNav("matches"); } } : fixture;
      case "duties": return m ? { label: "Open the duties", go: () => { requestDuties(m.id); onNav("matches"); } } : null;
      case "bus": return page("logistics", "Open the bus") ?? fixture;
      case "conditions": return page("competitions", "Open the conditions") ?? fixture;
      case "fixture": return fixture;
      case "requests": return page("management", "Decide");
      case "claims": return page("settings", "Confirm");
      case "register": return page("staff", "The register");
      default: return null;
    }
  };

  const header = q.header;
  const none = !signedIn() ? <EmptyState message="Sign in to see what is waiting at your school." icon="shield-check"/>
    : !q.reader && !["ok", "empty"].includes(matchesSaid.state) ? <ReadState read={matchesSaid} icon="shield-check" testId="readiness-read-state" onRetry={() => setNonce((n) => n + 1)}/>
    : !q.reader ? <EmptyState message="Nothing here is yours to resolve: this list is for the people who run a side or the school's office." icon="shield-check"/>
    : null;

  return (
    <div className="os-page" data-testid="queue">
      <SectionHeader title="To resolve" sub="What the records say is waiting: whose it is, by when, and one tap to the place to deal with it" color={D.sky}/>
      {none ?? (
        <>
          <p data-testid="queue-header" aria-live="polite" style={{ margin: "0 0 4px", fontFamily: D.head, fontSize: "14px", fontWeight: 700, color: D.textPrimary }}>
            {header.loading ? "Reading the week…" : headerWords(header)}
          </p>
          <p data-testid="queue-clock-note" style={{ ...body, margin: "0 0 16px", color: D.textMuted, maxWidth: "70ch" }}>
            Deadlines are the queue's clock, worked from each fixture's start, not the school's rule. A row goes when its record changes; nobody closes one by hand.
          </p>
          {matchesSaid.state === "failed" && <ReadState read={matchesSaid} compact testId="readiness-read-state" onRetry={() => setNonce((n) => n + 1)}/>}
          <div style={{ display: "grid", gap: "16px", gridTemplateColumns: q.offices.length ? "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" : "1fr", alignItems: "start" }}>
            {q.offices.length > 0 && (
              <div style={{ display: "grid", gap: "12px" }}>
                {q.offices.map((o) => {
                  const state = q.lifts[o.school];
                  const headId = `queue-office-${o.school}-head`;
                  return (
                    <Card key={o.school} sx={{ padding: 0 }} data-testid={`queue-office-${o.school}`}>
                      <section aria-labelledby={headId} data-testid="queue-office" data-school={o.school}>
                        <header style={{ padding: "12px 16px" }}>
                          <h2 id={headId} style={{ margin: 0, fontFamily: D.head, fontSize: "12px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: D.textMuted }}>
                            Needs office action{schools > 1 && o.schoolName ? ` · ${o.schoolName}` : ""}
                          </h2>
                        </header>
                        {o.loading ? <p style={{ ...small(true), padding: "0 16px 12px", margin: 0 }}>Reading the office’s lists…</p> : (
                          <ul style={{ margin: 0, padding: 0 }}>
                            {o.rows.map((r) => (
                              <Fragment key={r.id}>
                                <Row row={r} door={doorOf(r)}/>
                                {r.items && (
                                  // The register names adults, never children (§3.3): who, in what role, which check, in which state.
                                  <li style={{ listStyle: "none", padding: "0 16px 12px" }}>
                                    <ul data-testid="queue-register-items" style={{ margin: 0, padding: 0 }}>
                                      {r.items.slice(0, 5).map((c) => (
                                        <li key={c.personId ?? c.id} style={{ ...small(false), listStyle: "none" }}>
                                          {c.name} · {c.role} · {c.kindLabel}: {c.status}{c.expiresOn ? ` ${c.expiresOn}` : ""}
                                        </li>
                                      ))}
                                      {r.items.length > 5 && <li style={{ ...small(true), listStyle: "none" }}>and {r.items.length - 5} more in the register</li>}
                                    </ul>
                                  </li>
                                )}
                              </Fragment>
                            ))}
                            {o.unread.map((r) => <Row key={r.id} row={r} door={null} onRetry={q.retryOffice}/>)}
                            {o.rows.length === 0 && o.unread.length === 0 && (
                              <li data-testid="queue-office-clear" style={{ ...small(false), listStyle: "none", padding: "0 16px 12px" }}>Nothing waiting for the office</li>
                            )}
                          </ul>
                        )}
                        {o.can.lifts && (
                          <div style={{ padding: "0 16px 12px" }}>
                            {/* O6: read only on this tap, because every call is logged against the children it names (D6). */}
                            <button type="button" className="os-state" data-testid="queue-lifts-check" disabled={state?.loading}
                                    onClick={() => q.checkLifts(o.school)} style={{ ...tryBtn, margin: 0 }}>
                              {state?.loading ? "Checking…" : "Check today’s lifts"}
                            </button>
                            {state && !state.loading && (
                              <div data-testid="queue-lifts" style={{ marginTop: "8px" }}>
                                {state.error ? <p role="alert" style={{ ...body, margin: 0, color: D.roseText }}>Could not read the lift exceptions ({state.error})</p>
                                  : state.rows?.length ? (
                                    <ul style={{ margin: 0, padding: 0 }}>
                                      {state.rows.map((r) => (
                                        <li key={r.id} data-testid="queue-lift" data-rule="O6" style={{ listStyle: "none", padding: "6px 0", borderTop: `1px solid ${D.border}` }}>
                                          <span style={{ display: "block", fontFamily: D.body, fontSize: "14px", fontWeight: 600, color: D.textPrimary }}>{r.fact}</span>
                                          {r.detail && <span style={small(false)}>{r.detail}</span>}
                                          <span style={small(true)}>the office, by resolving it · from the lift exceptions read</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : <p data-testid="queue-lifts-none" style={{ ...body, margin: 0, color: D.textSecondary }}>No lift exceptions today</p>}
                                {nav.includes("squad") && (
                                  <button type="button" className="os-state" data-testid="queue-lifts-open" onClick={() => onNav("squad")} style={{ ...tryBtn, margin: "8px 0 0" }}>Open the lift day screen</button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </section>
                    </Card>
                  );
                })}
              </div>
            )}
            <div style={{ display: "grid", gap: "10px" }}>
              {q.days.length === 0 && q.later.total === 0 && (
                <p data-testid="queue-no-fixtures" style={{ ...body, margin: 0, color: D.textSecondary }}>No fixtures in the coming week for your sides.</p>
              )}
              <Days days={q.days} doorOf={doorOf} retry={q.retry}/>
              {q.later.total > 0 && (
                <>
                  <Card sx={{ padding: 0 }} data-testid="queue-later">
                    <button type="button" className="os-state" data-testid="queue-later-toggle" aria-expanded={q.later.shown > 0}
                            onClick={() => (q.later.shown > 0 ? q.hideLater() : q.showLater())} style={{ ...rowBtn, borderTop: 0, display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: D.body, fontSize: "14px", fontWeight: 600, color: D.textPrimary }}>
                      <span>Later · {q.later.total} {q.later.total === 1 ? "fixture" : "fixtures"}{q.later.first ? ` · from ${humanDate(q.later.first.date)}` : ""}</span>
                      <span aria-hidden="true">{q.later.shown > 0 ? "Hide" : "Show"}</span>
                    </button>
                  </Card>
                  {/* Drawn, and read, only once opened. */}
                  <Days days={q.later.days} doorOf={doorOf} retry={q.retry}/>
                  {q.later.shown > 0 && q.later.shown < q.later.total && (
                    <button type="button" className="os-state" data-testid="queue-later-more" onClick={q.showLater} style={{ ...tryBtn, margin: 0 }}>
                      Show the next {Math.min(8, q.later.total - q.later.shown)}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export { ReadinessOverview };
