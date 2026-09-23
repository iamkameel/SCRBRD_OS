import { D } from "../design/tokens.js";
import { useLive } from "../lib/live.js";
import { Card, EmptyState } from "../ui/primitives.jsx";

/**
 * The match-day duty roster. SCRBRD-037.
 *
 * Officials, transport, the ground report, the team sheet and the scoring
 * session each have a screen of their own. What nobody could do was stand at a
 * fixture an hour before the toss and ask the one question that matters: is
 * everything covered.
 *
 * READINESS, NOT NAMES, and the hard part is the empty case.
 *
 * `match_duties` returns only what is ON RECORD, so every row is something
 * somebody actually did. The slots below are what a fixture could have, and a
 * slot with no row reads "nothing on record" — NOT "pending". Pending claims
 * somebody is expected, and nothing in this schema says how many umpires a
 * fixture ought to have or whether a bus was ever needed. A roster that
 * printed "Umpire 2 — pending" would be inventing an obligation and then
 * reporting a school as failing it.
 *
 * What a reader cannot see is simply absent, and that is deliberate too: the
 * read is a union across tables, each under its own row-level security, so a
 * coach who may not see the transport plan gets no transport row. His roster
 * is smaller, and every line on it is still true.
 */
const SLOTS = [
  { key: "umpire",       label: "Umpires" },
  { key: "third_umpire", label: "Third umpire" },
  { key: "referee",      label: "Match referee" },
  { key: "scorer",       label: "Scorer appointed" },
  { key: "scoring",      label: "Scoring session" },
  { key: "squad",        label: "Team sheet" },
  { key: "ground",       label: "Pitch report" },
  { key: "transport",    label: "Transport" },
];

// The scoring session's own words, which are the session_state enum's. A state
// this map does not know is shown as itself rather than swallowed.
const STATE_WORD = {
  named: "named", recorded: "recorded",
  idle: "not started", active: "live",
  handover_pending: "handover offered", verifying: "verifying handover",
  arranged: "arranged", departed: "departed", arrived: "arrived", cancelled: "cancelled",
};
const TONE = {
  active: D.emerald, arrived: D.emerald, named: D.sky, recorded: D.sky, arranged: D.sky,
  departed: D.amber, handover_pending: D.amber, verifying: D.amber,
  idle: D.textMuted, cancelled: D.rose,
};

// An appointment's lifecycle (SCRBRD-034), as the server derived it
// (duty_status, db/30) — never worked out here. It says where the DUTY
// stands, which is not the same as what the person may do: a scorer whose
// fixture is complete is still the scorer on record, and holds no pen.
// 'revoked' never reaches this roster (withdrawn appointments are not on it)
// and is mapped anyway, so a change to the read cannot print a raw code.
const STATUS_WORD = {
  pending: "to come", active: "on duty", delegated: "handed over",
  completed: "completed", expired: "fixture abandoned", revoked: "stood down",
};
const STATUS_TONE = {
  pending: D.textMuted, active: D.emerald, delegated: D.amber,
  completed: D.sky, expired: D.textMuted, revoked: D.rose,
};

function DutyRoster({ matchId, role }) {
  const { rows, loading, error } = useLive("match_duties", role, 0, { matchId });
  if (loading || error) return <EmptyState loading={loading} error={error}/>;
  const byDuty = new Map();
  for (const r of rows) byDuty.set(r.duty, [...(byDuty.get(r.duty) ?? []), r]);
  const covered = SLOTS.filter((s) => byDuty.has(s.key)).length;

  return (
    <Card sx={{ padding: "14px", marginTop: "12px" }} data-testid="duty-roster">
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "8px" }}>
        <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textPrimary }}>Match-day duties</div>
        <div style={{ fontFamily: D.mono, fontSize: "9px", color: D.textMuted }} data-testid="duty-covered">
          {covered} of {SLOTS.length} on record
        </div>
      </div>
      {SLOTS.map((slot) => {
        const here = byDuty.get(slot.key) ?? [];
        return (
          <div key={slot.key} data-testid={`duty-${slot.key}`}
               style={{ display: "flex", alignItems: "baseline", gap: "10px", padding: "6px 0",
                        borderTop: `1px solid ${D.border}`, flexWrap: "wrap" }}>
            <div style={{ flex: "0 0 130px", fontFamily: D.body, fontSize: "11px", color: D.textSecondary }}>{slot.label}</div>
            {here.length === 0
              ? <span data-testid={`duty-${slot.key}-none`}
                      style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted }}>nothing on record</span>
              : <div style={{ flex: 1, minWidth: "160px", display: "grid", gap: "2px" }}>
                  {here.map((r, i) => (
                    <div key={`${r.duty}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ fontFamily: D.body, fontSize: "11px", color: D.textPrimary }}>{r.who || r.detail || "—"}</span>
                      <span data-testid={`duty-${slot.key}-state`}
                            style={{ fontFamily: D.mono, fontSize: "9px", textTransform: "uppercase",
                                     color: TONE[r.state] ?? D.textMuted }}>
                        {STATE_WORD[r.state] ?? r.state}
                      </span>
                      {r.status && <span data-testid={`duty-${slot.key}-status`} data-status={r.status}
                            title="Where this appointment stands — not what it permits"
                            style={{ fontFamily: D.mono, fontSize: "9px", textTransform: "uppercase",
                                     color: STATUS_TONE[r.status] ?? D.textMuted }}>
                        · {STATUS_WORD[r.status] ?? r.status}
                      </span>}
                      {r.who && r.detail && <span style={{ fontFamily: D.mono, fontSize: "9px", color: D.textMuted }}>{r.detail}</span>}
                    </div>
                  ))}
                </div>}
          </div>
        );
      })}
    </Card>
  );
}

export { DutyRoster, SLOTS, STATUS_WORD };
