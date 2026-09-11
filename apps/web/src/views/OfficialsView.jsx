import { useMemo, useState } from "react";
import { D } from "../design/tokens.js";
import { Avatar, Badge, Card, EmptyState, Pill, SectionHeader } from "../ui/primitives.jsx";
import { useLive, useRows } from "../lib/live.js";

// ══════════════════════════════════════════════════════
//  OFFICIALS — who stands, and how often
// ══════════════════════════════════════════════════════
//
// THE DIRECTORY IS DERIVED, and that is a decision rather than a shortcut.
//
// There is no roster of umpires anywhere in this schema and there should not
// be: a second list of people, maintained by hand beside the appointments that
// actually happened, is a list that goes stale the first time somebody is
// appointed without being added to it. Every name here has stood at a real
// fixture, and the count beside it is the number of times.
//
// It also means the directory inherits its scope for free. `match_official` is
// read under fixture.read, so this shows exactly the appointments the reader
// may see — a coach scoped to one team sees the officials who stood at their
// fixtures, and a director of sport sees the school's.
const DUTY = {
  umpire:       { label: "Umpire",       icon: "🧑‍⚖️", color: D.sky },
  third_umpire: { label: "Third umpire", icon: "📺", color: D.violet },
  scorer:       { label: "Scorer",       icon: "📋", color: D.orange },
  referee:      { label: "Referee",      icon: "⚖️", color: D.amber },
};

function OfficialsView({ role }) {
  // Read through the choke point: row-scoped for this principal. Importing a
  // constant here would bypass it.
  const { rows: APPOINTMENTS, loading, error, live } = useLive("officials", role);
  const MATCHES = useRows("matches", role);
  const [duty, setDuty] = useState("all");
  const [sel, setSel]   = useState(null);

  /**
   * Fold the appointments into people.
   *
   * Keyed on the account where there is one and the name where there is not,
   * because most school umpires have no account here — they come off a union
   * panel and stand at four schools in a season. Two spellings of the same
   * unregistered name are two people as far as this can tell, and that is the
   * honest answer rather than a fuzzy match that quietly merges two umpires.
   */
  const people = useMemo(() => {
    const by = new Map();
    for (const a of APPOINTMENTS) {
      const key = a.personId || `name:${(a.name || "").trim().toLowerCase()}`;
      if (!by.has(key)) {
        by.set(key, { key, name: a.name, personId: a.personId, panel: a.panel,
                      duties: new Set(), fixtures: 0, lastAt: null, appointments: [] });
      }
      const p = by.get(key);
      p.duties.add(a.duty);
      p.fixtures += 1;
      p.appointments.push(a);
      // The panel as most recently recorded: an umpire can move associations.
      if (a.panel) p.panel = a.panel;
      if (!p.lastAt || a.appointedAt > p.lastAt) p.lastAt = a.appointedAt;
    }
    return [...by.values()].sort((a, b) => b.fixtures - a.fixtures || a.name.localeCompare(b.name));
  }, [APPOINTMENTS]);

  const shown = duty === "all" ? people : people.filter((p) => p.duties.has(duty));
  const selected = shown.find((p) => p.key === sel) ?? null;
  const fixtureOf = (id) => MATCHES.find((m) => m.id === id);
  const when = (ts) => (ts ? String(ts).slice(0, 10) : "—");

  return (
    <div className="os-page">
      <SectionHeader
        title="Officials"
        sub="Umpires · Scorers · Referees — from the appointments that were actually made"
        color={D.sky}/>

      {/* Loading and failure are stated, never rendered as an empty directory.
          "No officials" and "we could not ask" are different sentences and only
          one of them is true at a time. */}
      {loading && (
        <Card style={{ padding: "28px", textAlign: "center" }}>
          <span style={{ color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>Loading appointments…</span>
        </Card>
      )}
      {!loading && error && (
        <Card style={{ padding: "28px", textAlign: "center" }}>
          <span style={{ color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>
            Could not load appointments ({error}).
          </span>
        </Card>
      )}

      {!loading && !error && (
        <>
          <div style={{ display: "flex", gap: "6px", marginBottom: "18px", flexWrap: "wrap" }}>
            {["all", ...Object.keys(DUTY)].map((d) => {
              const on = duty === d;
              const c = d === "all" ? D.sky : DUTY[d].color;
              return (
                <button key={d} onClick={() => { setDuty(d); setSel(null); }} className="pressBtn"
                  style={{ padding: "6px 13px", borderRadius: D.pill, cursor: "pointer",
                    background: on ? c + "18" : D.surf1, border: `1px solid ${on ? c + "44" : D.border}`,
                    fontFamily: D.head, fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
                    color: on ? D.textPrimary : D.textMuted }}>
                  {d === "all" ? "ALL" : `${DUTY[d].icon} ${DUTY[d].label.toUpperCase()}`}
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon="🧑‍⚖️"
              title="Nobody has been appointed yet"
              sub={live
                ? "Officials appear here once they are appointed to a fixture. A director of sport or competition administrator can name a panel from the match."
                : "Sign in to see the appointments made at your school."}/>
          ) : (
            <div className="sc-grid-2" style={{ alignItems: "start" }}>
              <Card>
                <div style={{ padding: "13px 16px", borderBottom: `1px solid ${D.border}` }}>
                  <span style={{ fontFamily: D.head, fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: D.textMuted }}>
                    {shown.length} {shown.length === 1 ? "official" : "officials"}
                  </span>
                </div>
                <div style={{ padding: "8px" }}>
                  {shown.map((p) => {
                    const on = selected?.key === p.key;
                    return (
                      <button key={p.key} onClick={() => setSel(on ? null : p.key)} className="pressBtn"
                        style={{ display: "flex", alignItems: "center", gap: "11px", width: "100%",
                          padding: "10px 11px", marginBottom: "3px", borderRadius: D.md, cursor: "pointer",
                          textAlign: "left", background: on ? D.sky + "12" : "transparent",
                          border: `1px solid ${on ? D.sky + "33" : "transparent"}` }}>
                        <Avatar name={p.name} size={34} color={on ? D.sky : D.textMuted}/>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600,
                            color: D.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.name}
                          </div>
                          <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {[...p.duties].map((d) => DUTY[d]?.label ?? d).join(" · ")}
                            {p.panel ? ` — ${p.panel}` : ""}
                          </div>
                        </div>
                        <span style={{ fontFamily: D.mono, fontSize: "12px", color: D.textSecondary, flexShrink: 0 }}>
                          {p.fixtures}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>

              {selected ? (
                <Card style={{ padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "13px", marginBottom: "14px" }}>
                    <Avatar name={selected.name} size={46} color={D.sky}/>
                    <div>
                      <div style={{ fontFamily: D.head, fontSize: "17px", fontWeight: 800, color: D.textPrimary }}>
                        {selected.name}
                      </div>
                      {/* An account link is shown as a fact, not as a contact
                          card: an official's email is their own, and this
                          screen is about who stood, not how to reach them. */}
                      <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textMuted, marginTop: "2px" }}>
                        {selected.personId ? "Has an account on SCRBRD" : "No account — named on the appointment"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
                    {[...selected.duties].map((d) => (
                      <Pill key={d} color={DUTY[d]?.color ?? D.textMuted}>
                        {DUTY[d]?.icon ?? ""} {DUTY[d]?.label ?? d}
                      </Pill>
                    ))}
                    {selected.panel && <Pill color={D.violet}>🎖 {selected.panel}</Pill>}
                    <Pill color={D.textMuted}>🗓 Last {when(selected.lastAt)}</Pill>
                  </div>

                  <div style={{ fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em",
                    textTransform: "uppercase", color: D.textMuted, margin: "0 0 8px" }}>
                    Appointments ({selected.fixtures})
                  </div>
                  <div style={{ border: `1px solid ${D.border}`, borderRadius: D.lg, overflow: "hidden" }}>
                    {selected.appointments
                      .slice()
                      .sort((a, b) => String(b.appointedAt).localeCompare(String(a.appointedAt)))
                      .map((a, i) => {
                        const fx = fixtureOf(a.matchId);
                        return (
                          <div key={a.matchId + a.duty + i}
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                              gap: "10px", padding: "10px 13px",
                              borderTop: i === 0 ? "none" : `1px solid ${D.border}` }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary,
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {/* A fixture the reader cannot see is not named.
                                    The appointment is visible because it is
                                    theirs to see; the match behind it is a
                                    separate question with its own answer. */}
                                {fx ? `${fx.homeTeam} vs ${fx.awayTeam}` : "A fixture"}
                              </div>
                              <div style={{ fontFamily: D.body, fontSize: "10px", color: D.textMuted }}>
                                {fx?.date ?? when(a.appointedAt)}{fx?.venue ? ` · ${fx.venue}` : ""}
                              </div>
                            </div>
                            <Badge color={DUTY[a.duty]?.color ?? D.textMuted}>
                              {DUTY[a.duty]?.label ?? a.duty}
                            </Badge>
                          </div>
                        );
                      })}
                  </div>
                </Card>
              ) : (
                <Card style={{ padding: "34px", textAlign: "center" }}>
                  <span style={{ color: D.textMuted, fontFamily: D.body, fontSize: "13px" }}>
                    Select an official to see where they have stood.
                  </span>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export { OfficialsView };
