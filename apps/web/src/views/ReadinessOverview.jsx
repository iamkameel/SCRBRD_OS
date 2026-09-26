import { D } from "../design/tokens.js";
import { useDutyCoverage, useRows } from "../lib/live.js";
import { Card, EmptyState, SectionHeader } from "../ui/primitives.jsx";
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
function ReadinessOverview({ role }) {
  const matches = useRows("matches", role);
  const upcoming = matches
    .filter((m) => m.status === "upcoming")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(0, 8);
  const { coverage, loading } = useDutyCoverage(upcoming.map((m) => m.id), role);

  return (
    <div className="os-page">
      <SectionHeader title="Readiness" sub="Duty-roster coverage across the coming fixtures — one glance instead of one screen each" color={D.sky}/>

      {upcoming.length === 0 ? (
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
              <Card key={m.id} sx={{ padding: "14px 16px" }} data-testid={`readiness-fixture-${m.id}`}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary }}>
                    {m.homeTeam} vs {m.awayTeam}
                  </div>
                  <div style={{ fontFamily: D.mono, fontSize: "11px", color: D.textMuted }}>{m.date}{m.venue ? ` · ${m.venue}` : ""}</div>
                </div>
                {entry?.error ? (
                  <div style={{ fontFamily: D.body, fontSize: "11px", color: D.roseText, marginTop: "6px" }} data-testid={`readiness-error-${m.id}`}>
                    Could not load duty coverage for this fixture ({entry.error}).
                  </div>
                ) : (
                  <>
                    <div style={{ fontFamily: D.mono, fontSize: "10px", color: D.textMuted, marginTop: "6px" }} data-testid={`readiness-covered-${m.id}`}>
                      {covered} of {SLOTS.length} on record
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                      {SLOTS.map((s) => {
                        const on = byDuty.has(s.key);
                        return (
                          <span key={s.key} data-testid={`readiness-slot-${m.id}-${s.key}`}
                                style={{ padding: "3px 9px", borderRadius: D.pill,
                                         fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em",
                                         background: on ? D.emerald + "18" : D.surf2,
                                         border: `1px solid ${on ? D.emerald + "44" : D.border}`,
                                         color: on ? D.emerald : D.textMuted }}>
                            {s.label}
                          </span>
                        );
                      })}
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { ReadinessOverview };
