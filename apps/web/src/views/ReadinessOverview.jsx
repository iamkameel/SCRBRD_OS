import { D } from "../design/tokens.js";
import { useState } from "react";
import { requestDuties } from "../lib/cockpitNav.js";
import { useDutyCoverage, useLive } from "../lib/live.js";
import { readState } from "../lib/readState.js";
import { Card, EmptyState, ReadState, SectionHeader } from "../ui/primitives.jsx";
import { SLOTS } from "./duties.jsx";

// ══════════════════════════════════════════════════════
//  READINESS OVERVIEW — several fixtures, at a glance. SCRBRD-062.
// ══════════════════════════════════════════════════════
//
// `duties.jsx`'s DutyRoster already asks the one question that matters for a
// single fixture — is everything covered — under its own "READINESS, NOT
// NAMES" discipline: a slot with nothing on record reads "nothing on
// record", never "pending", because nothing in this schema says how many
// umpires a fixture ought to have. This screen asks the same question of
// several fixtures at once, so a sportsmaster can scan a coming weekend
// without opening each match in turn.
//
// It is the SAME read, run once per fixture — `useDutyCoverage` fans out the
// identical match_duties query `useLive` runs for one match, through the
// identical `asDuty` adapter, so a coverage count here cannot say something
// different from what that fixture's own DutyRoster shows. There is no
// per-fixture formula here to get wrong: a fixture reads "ready" only when a
// real row is on record for that slot, exactly as it does on the match's own
// page.
//
// A fixture whose fetch failed shows its own failure rather than being
// silently dropped or counted as fully covered — the same distinction
// EmptyState draws between "none" and "we could not ask".
//
// Each row is one tap target that opens that fixture's duties (match-day
// queue, phase A0: docs/design/GA-I09-I11_match_day_queue.md §3.2, §7): the
// shell has no deep links, so the row leaves a note in lib/cockpitNav.js and
// goes to the Match Centre, which opens the fixture's details panel, where the
// DutyRoster is. Its words are 12px and its slots say "none" as well as being
// muted: colour is never the only word.
function ReadinessOverview({ role, onNav }) {
  // The fixtures read keeps its state: "No upcoming fixtures" is said of a read
  // that answered, never of one that failed or has not come back (GA-I08).
  const [nonce, setNonce] = useState(0);
  const matchesRead = useLive("matches", role, nonce);
  const matches = matchesRead.rows;
  const matchesSaid = readState(matchesRead, { what: "fixtures" });
  const upcoming = matches
    .filter((m) => m.status === "upcoming")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(0, 8);
  const { coverage, loading } = useDutyCoverage(upcoming.map((m) => m.id), role, nonce);
  const open = (id) => { requestDuties(id); if (onNav) onNav("matches"); };

  return (
    <div className="os-page">
      <SectionHeader title="Readiness" sub="Duty-roster coverage across the coming fixtures — one glance instead of one screen each" color={D.sky}/>

      {upcoming.length === 0 && !["ok", "empty"].includes(matchesSaid.state) ? (
        <ReadState read={matchesSaid} icon="shield-check" testId="readiness-read-state" onRetry={() => setNonce((n) => n + 1)}/>
      ) : upcoming.length === 0 ? (
        <EmptyState message="No upcoming fixtures are scheduled in your scope." icon="shield-check"/>
      ) : loading ? (
        <EmptyState loading/>
      ) : (
        <div style={{ display: "grid", gap: "10px" }}>
          {upcoming.map((m) => {
            const entry = coverage.get(m.id);
            const rows = entry?.rows ?? [];
            const byDuty = new Set(rows.map((r) => r.duty));
            const covered = SLOTS.filter((s) => byDuty.has(s.key)).length;
            return (
              <Card key={m.id} sx={{ padding: 0 }} data-testid={`readiness-fixture-${m.id}`}>
                {/* The whole row is the tap target (at least 44px) and says where it goes. */}
                <button type="button" className="os-state" data-testid={`readiness-open-${m.id}`} onClick={() => open(m.id)}
                        style={{ display: "block", width: "100%", minHeight: "44px", padding: "14px 16px", margin: 0, border: 0, background: "transparent",
                                 textAlign: "left", cursor: "pointer", color: "inherit", font: "inherit" }}>
                  <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary }}>
                      {m.homeTeam} vs {m.awayTeam}
                    </span>
                    <span style={{ fontFamily: D.mono, fontSize: "12px", color: D.textMuted }}>{m.date}{m.venue ? ` · ${m.venue}` : ""}</span>
                  </span>
                  {entry?.error ? (
                    <span style={{ display: "block", fontFamily: D.body, fontSize: "12px", color: D.roseText, marginTop: "6px" }} data-testid={`readiness-error-${m.id}`}>
                      Could not load duty coverage for this fixture ({entry.error}).
                    </span>
                  ) : (
                    <>
                      <span style={{ display: "block", fontFamily: D.mono, fontSize: "12px", color: D.textMuted, marginTop: "6px" }} data-testid={`readiness-covered-${m.id}`}>
                        {covered} of {SLOTS.length} on record
                      </span>
                      <span style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                        {SLOTS.map((s) => {
                          const on = byDuty.has(s.key);
                          return (
                            <span key={s.key} data-testid={`readiness-slot-${m.id}-${s.key}`}
                                  style={{ padding: "3px 9px", borderRadius: D.pill,
                                           fontFamily: D.head, fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em",
                                           background: on ? D.emerald + "18" : D.surf2,
                                           border: `1px solid ${on ? D.emerald + "44" : D.border}`,
                                           color: on ? D.emerald : D.textMuted }}>
                              {/* Words as well as colour: a slot with nothing on record says so. */}
                              {s.label}{on ? <span className="sr-only"> on record</span> : " · none"}
                            </span>
                          );
                        })}
                      </span>
                    </>
                  )}
                  <span style={{ display: "block", fontFamily: D.body, fontSize: "12px", color: D.textSecondary, marginTop: "8px" }}>Open duties <span aria-hidden="true">›</span></span>
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { ReadinessOverview };
