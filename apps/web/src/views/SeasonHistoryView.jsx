import { useState } from "react";
import { D } from "../design/tokens.js";
import { signedIn } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { Badge, Card, EmptyState, StatusDot } from "../ui/primitives.jsx";

/**
 * The Season History Archive — up11.
 *
 * Seasons and competitions were already modelled (the `season` table,
 * `season_for()`, `competition.season_id`) and already readable
 * (`/read/seasons`, `/read/competitions`, `/read/matches`) — there was simply
 * no screen that put a year next to what happened in it. This is that screen,
 * and it invents nothing: a fixture's season is the one `season_for()`
 * assigned it in Postgres (carried through as `season` on the matches read),
 * never a date range re-worked here, and a competition's season is the row it
 * points at through `season_id`. The two are joined client-side by that same
 * label, because the schema draws no foreign key from a fixture to a
 * competition — see CompetitionsView, whose fixture filter has quietly
 * matched nothing since the API replaced the mock.
 *
 * NO MOCK FALLBACK. `seasons` has no demo data behind it (there is no entry
 * for it in rbac/index.js's RESOURCE table) precisely so a signed-out visitor
 * cannot be shown a year that came from nowhere; this view makes that
 * explicit rather than leaving it to an empty list nobody explained.
 */
function SeasonHistory({ role }) {
  const [selected, setSelected] = useState(null);

  if (!signedIn()) {
    return (
      <Card data-testid="season-history">
        <EmptyState message="Sign in to see your school's season history." icon="📅" />
      </Card>
    );
  }

  return <SignedInSeasonHistory role={role} selected={selected} setSelected={setSelected} />;
}

// Split out so the two hooks below are never called on the signed-out path —
// they would only report "no adapter"/loading forever for a session that was
// never going to fetch anything.
function SignedInSeasonHistory({ role, selected, setSelected }) {
  const seasonsState = useLive("seasons", role);
  const compsState = useLive("competitions", role);
  const matchesState = useLive("matches", role);

  // The archive is about school seasons specifically — every fixture's own
  // season is always computed at the 'school' level (see season_for() in
  // db/08 and the matches query in read-api.mjs), so a club/provincial/
  // national season row would list here and then show nothing under it,
  // which is a worse empty state than not listing it at all.
  const seasons = seasonsState.rows
    .filter(s => s.level === "school")
    .slice()
    .sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1));

  const loading = seasonsState.loading || compsState.loading || matchesState.loading;
  const error = seasonsState.error || compsState.error || matchesState.error;

  if (loading || error || seasons.length === 0) {
    return (
      <Card data-testid="season-history">
        <EmptyState loading={loading} error={error} message="No seasons on record." icon="📅" />
      </Card>
    );
  }

  const current = seasons.find(s => s.current) ?? seasons[0];
  const active = seasons.find(s => s.id === selected) ?? current;

  const comps = compsState.rows.filter(c => c.season === active.label);
  const matches = matchesState.rows
    .filter(m => m.season === active.label)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div data-testid="season-history">
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }} data-testid="season-list">
        {seasons.map(s => (
          <button key={s.id} onClick={() => setSelected(s.id)} className="pressBtn" data-testid={`season-btn-${s.id}`}
            style={{
              padding: "8px 16px", borderRadius: D.md, cursor: "pointer", textAlign: "left",
              border: `1px solid ${active.id === s.id ? D.amber + "55" : D.border}`,
              background: active.id === s.id ? D.amber + "10" : D.surf1,
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontFamily: D.head, fontSize: "13px", fontWeight: active.id === s.id ? 700 : 500, color: active.id === s.id ? D.textPrimary : D.textSecondary }}>{s.label}</span>
              {s.current && <Badge color={D.emerald} data-testid="season-current">Current</Badge>}
            </div>
            <div style={{ fontFamily: D.mono, fontSize: "9px", color: D.textMuted, marginTop: "2px" }}>{s.startsOn} – {s.endsOn}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: "16px" }}>
        <div>
          <div style={{ fontFamily: D.head, fontSize: "11px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "10px" }}>
            Competitions in {active.label}
          </div>
          {comps.length === 0
            ? <Card sx={{ padding: "20px", textAlign: "center" }}><div style={{ color: D.textMuted, fontFamily: D.body, fontSize: "12px" }}>No competitions recorded for {active.label}.</div></Card>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }} data-testid="season-competitions">
                {comps.map(c => <SeasonCompetition key={c.id} comp={c} role={role} />)}
              </div>
            )}
        </div>

        <div>
          <div style={{ fontFamily: D.head, fontSize: "11px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "10px" }}>
            Fixtures in {active.label}
          </div>
          {matches.length === 0
            ? <Card sx={{ padding: "20px", textAlign: "center" }}><div style={{ color: D.textMuted, fontFamily: D.body, fontSize: "12px" }}>No fixtures recorded for {active.label}.</div></Card>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }} data-testid="season-fixtures">
                {matches.map(m => (
                  <Card key={m.id} sx={{ padding: "12px 16px" }} data-testid={`season-fixture-${m.id}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <StatusDot status={m.status} />
                      <span style={{ fontFamily: D.mono, fontSize: "11px", color: D.textMuted, flexShrink: 0 }}>{m.date}</span>
                      <span style={{ flex: 1, fontFamily: D.body, fontSize: "12px", fontWeight: 500, color: D.textPrimary }}>{m.homeTeam} vs {m.awayTeam}</span>
                      <Badge color={m.status === "complete" ? D.textMuted : D.sky}>{m.status}</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

/** One competition's card, with its final standings — read fresh, per
 *  competition, the same way LeagueView reads the current one's. */
function SeasonCompetition({ comp, role }) {
  const ladder = useLive("league", role, 0, { competitionId: comp.id }).rows;
  return (
    <Card data-testid={`season-competition-${comp.id}`}>
      <div style={{ padding: "12px 16px", borderBottom: ladder.length ? `1px solid ${D.border}` : "none", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary }}>{comp.name}</div>
          <div style={{ fontFamily: D.mono, fontSize: "10px", color: D.textMuted, marginTop: "2px" }}>{comp.type} · {comp.format} · {comp.ageGroup}</div>
        </div>
      </div>
      {ladder.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              {["#", "Team", "P", "W", "L", "Pts", "NRR"].map(h => (
                <th key={h} style={{ padding: "8px 12px", fontFamily: D.head, fontSize: "9px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.06em", textTransform: "uppercase", textAlign: h === "Team" ? "left" : "center" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {ladder.map((t, i) => (
                <tr key={t.id} style={{ borderTop: `1px solid ${D.border}` }}>
                  <td style={{ padding: "8px 12px", textAlign: "center", fontFamily: D.mono, fontSize: "11px", fontWeight: 700, color: i === 0 ? D.amber : D.textMuted }}>{i + 1}</td>
                  <td style={{ padding: "8px 12px", fontFamily: D.body, fontSize: "12px", color: D.textPrimary }}>{t.name}</td>
                  {[t.played, t.wins, t.losses].map((v, j) => (
                    <td key={j} style={{ padding: "8px 12px", textAlign: "center", fontFamily: D.mono, fontSize: "12px", color: D.textSecondary }}>{v}</td>
                  ))}
                  <td style={{ padding: "8px 12px", textAlign: "center", fontFamily: D.mono, fontSize: "13px", fontWeight: 700, color: D.textPrimary }}>{t.points}</td>
                  <td style={{ padding: "8px 12px", textAlign: "center", fontFamily: D.mono, fontSize: "11px", color: D.textSecondary }}>{t.nrr == null ? "—" : Number(t.nrr).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export { SeasonHistory };
