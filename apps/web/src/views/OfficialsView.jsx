import { useMemo, useState } from "react";
import { D, themed } from "../design/tokens.js";
import { Avatar, Badge, Btn, Card, EmptyState, Input, Modal, Pill, SectionHeader, Select } from "../ui/primitives.jsx";
import { useLive, useRows } from "../lib/live.js";
import { api } from "../lib/api.js";
import { holdsCapability } from "../rbac/index.js";
import { resolveBirthDate, PLAUSIBLE_YEARS_OFFICIAL, BIRTH_DATE_MESSAGE } from "@scrbrd/policy/date-of-birth";
import { Icon } from "../ui/icons.jsx";

// ══════════════════════════════════════════════════════
//  OFFICIALS — who is on the panel, and who actually stood
// ══════════════════════════════════════════════════════
//
// This screen used to be derived from appointments ALONE, and the comment here
// argued that it should be: a second list of people maintained by hand beside
// the appointments that really happened is a list that goes stale the first
// time somebody is appointed without being added to it.
//
// That concern was right and is kept. What it got wrong was the conclusion.
// Two facts about an official CANNOT be derived from the fact that he stood —
// his accreditation, and whether it is still in date — and those are precisely
// the two a school needs before appointing him. So the register (db/08) holds
// identity and accreditation, and everything countable is still derived from
// `match_official`: the appearance count below is the number of appointments,
// never a stored figure.
//
// The register also fixes the limitation the old version named honestly and
// could not solve. Keyed on a typed name, two spellings of one umpire were two
// people. An appointment now carries `official_id`, so they are one.
//
// Scope is unchanged and still comes for free: appointments are read under
// fixture.read, so a coach sees the officials who stood at their fixtures. The
// register itself is readable by anybody signed in — a name and a grade, the
// same disclosure the scorecard already makes — while date of birth, ID number
// and contact are masked to everyone but the union that keeps it.
// The accreditation ladder db/08 enforces, lowest first. `level` arrives NULL
// in two different situations and they must not be drawn the same way: nobody
// has ever accredited this person, or their accreditation has run out. The
// second is a person who stood last season and needs to renew, and a screen
// that says "unaccredited" for both tells a school to go looking for the wrong
// thing.
const LEVEL = themed(() => ({
  club:     { label: "Club Panel",     color: D.textMuted },
  level1:   { label: "Level 1",        color: D.sky },
  level2:   { label: "Level 2",        color: D.emerald },
  national: { label: "National Panel", color: D.amber },
}));

const DUTY = themed(() => ({
  umpire:       { label: "Umpire",       icon: "hand", color: D.sky },
  third_umpire: { label: "Third umpire", icon: "tv", color: D.violet },
  scorer:       { label: "Scorer",       icon: "scorebook", color: D.orange },
  referee:      { label: "Referee",      icon: "scale", color: D.amber },
}));

// ── A duty's authority: link, suspend, lift (SCRBRD-034) ─────────────
//
// An appointment on this screen is a DUTY; the permission to act on it is a
// role_assignment. The school office links the two (db/34), and may pause a
// linked duty — the assignment grants nothing until the pause is lifted — or
// lift it. Each pause and each lift carries a reason, and the database
// refuses both without one. Offered to whoever HOLDS user.role.assign; the
// definer functions decide, including the finer rule the button cannot see
// (restoring authority also asks whether you may appoint that role), and a
// refusal comes back here as a sentence.
const DUTY_REFUSAL = {
  not_permitted:       "Only the school office can do that for this duty.",
  reason_required:     "Say why — the reason is kept with the record.",
  reason_too_long:     "Keep the reason under 2,000 characters.",
  no_account:          "This official has no account here, so there is no authority to link.",
  already_linked:      "This duty is already linked.",
  already_suspended:   "This duty is already suspended.",
  not_suspended:       "This duty is not suspended.",
  duty_withdrawn:      "This appointment has been withdrawn.",
  not_linked:          "Link the duty before suspending it.",
  assignment_not_live: "The authority behind this duty has already been revoked.",
  duty_suspended:      "Lift the suspension before linking again.",
  own_duty:            "Somebody else has to lift your own suspension.",
};

function DutyAuthority({ appointment: a, canAssign, live, suspension, onDone }) {
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(null);           // "suspend" | "lift" | null
  const [error, setError] = useState(null);
  if (!live || !a.id) return null;
  const act = async (verb) => {
    setError(null);
    try {
      await api(`/api/duties/${a.id}/${verb}`, { method: "POST", body: verb === "link" ? {} : { reason } });
      setAsking(null); setReason(""); onDone();
    } catch (e) { setError(DUTY_REFUSAL[e.code] ?? `Could not ${verb}: ${e.code ?? e.message}`); }
  };
  const state = a.suspended ? "suspended" : a.linked ? "linked" : "unlinked";
  if (!canAssign && !a.suspended) return null;
  return (
    <div data-testid="duty-authority" data-duty={a.id} data-state={state}
         style={{ padding: "0 13px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
      {a.suspended && (
        <div style={{ fontFamily: D.body, fontSize: "11px", color: D.roseText }}>
          Suspended — this duty's authority grants nothing until it is lifted.
          {suspension && ` ${suspension.suspendedBy ?? "The office"}: “${suspension.reason}”`}
        </div>
      )}
      {canAssign && (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {!a.linked && a.personId && (
            <Btn size="sm" variant="ghost" data-testid="duty-link" onClick={() => act("link")}>Link authority</Btn>
          )}
          {a.linked && !a.suspended && asking !== "suspend" && (
            <Btn size="sm" variant="ghost" data-testid="duty-suspend" onClick={() => setAsking("suspend")}>Suspend</Btn>
          )}
          {a.suspended && asking !== "lift" && (
            <Btn size="sm" variant="ghost" data-testid="duty-lift" onClick={() => setAsking("lift")}>Lift suspension</Btn>
          )}
        </div>
      )}
      {canAssign && asking && (
        <div style={{ display: "flex", gap: "6px", alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <Input small label={asking === "suspend" ? "Why suspend?" : "Why lift?"} value={reason}
                   onChange={setReason} data-testid="duty-reason"/>
          </div>
          <Btn size="sm" data-testid="duty-confirm" disabled={!reason.trim()} onClick={() => act(asking)}>
            {asking === "suspend" ? "Suspend" : "Lift"}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => { setAsking(null); setReason(""); setError(null); }}>Cancel</Btn>
        </div>
      )}
      {error && <div role="alert" style={{ fontFamily: D.body, fontSize: "12px", color: D.roseText }}>{error}</div>}
    </div>
  );
}

function OfficialsView({ role }) {
  // Read through the choke point: row-scoped for this principal. Importing a
  // constant here would bypass it.
  // The register is maintained by the body that accredits — competition and
  // platform administration, not a school. The screen offers the controls to
  // whoever HOLDS officiating.registry.manage; the policies on the tables
  // decide, and a refusal comes back as a message, never as a silent nothing.
  const canManage = holdsCapability(role, "officiating.registry.manage");
  const [nonce, setNonce] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ fullName: "", born: "", idNumber: "", panel: "", email: "", phone: "" });
  const [formError, setFormError] = useState(null);
  const [accredit, setAccredit] = useState({ level: "level1", validFrom: new Date().toISOString().slice(0, 10), validUntil: "" });
  const [manageError, setManageError] = useState(null);
  const dob = form.born || form.idNumber
    ? resolveBirthDate({ born: form.born, idNumber: form.idNumber }, new Date(), { plausible: PLAUSIBLE_YEARS_OFFICIAL, notPlausible: "born_not_plausible_for_an_official" })
    : null;
  const submitOfficial = async () => {
    setFormError(null);
    try {
      await api("/api/officials", { method: "POST", body: { ...form, born: form.born || undefined, idNumber: form.idNumber || undefined } });
      setAdding(false); setForm({ fullName: "", born: "", idNumber: "", panel: "", email: "", phone: "" }); setNonce((n) => n + 1);
    } catch (e) { setFormError(BIRTH_DATE_MESSAGE?.[e.code] ?? (e.code === "not_permitted" ? "You do not hold the register." : e.code === "already_registered" ? "That ID number is already on the register." : `Could not add: ${e.code ?? e.message}`)); }
  };
  const submitAccreditation = async (id) => {
    setManageError(null);
    try {
      await api(`/api/officials/${id}/accredit`, { method: "POST", body: { level: accredit.level, validFrom: accredit.validFrom, validUntil: accredit.validUntil || undefined } });
      setNonce((n) => n + 1);
    } catch (e) { setManageError(e.code === "not_permitted" ? "You do not hold the register." : `Could not accredit: ${e.code ?? e.message}`); }
  };
  const retireOfficial = async (id) => {
    setManageError(null);
    try { await api(`/api/officials/${id}/retire`, { method: "POST", body: {} }); setSel(null); setNonce((n) => n + 1); }
    catch (e) { setManageError(e.code === "not_permitted" ? "You do not hold the register." : `Could not retire: ${e.code ?? e.message}`); }
  };
  const { rows: APPOINTMENTS, loading, error, live } = useLive("officials", role, nonce);
  // The office's side of a duty's authority (SCRBRD-034). The capability, not
  // the role name; the rows are RLS-scoped to the office, so anybody else
  // gets none and sees only THAT a duty is suspended, never why.
  const canAssign = holdsCapability(role, "user.role.assign");
  const SUSPENSIONS = useRows("duty_suspensions", role, nonce);
  const openSuspension = (dutyId) => SUSPENSIONS.find((x) => x.dutyId === dutyId && !x.liftedAt) ?? null;
  const REGISTER = useRows("official_register", role, nonce);
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

    // The register first, so somebody newly accredited appears BEFORE they
    // have stood anywhere. On an appointments-only directory a new umpire was
    // invisible until his first fixture, which is exactly backwards: the
    // moment you most need to find him is when you are looking for somebody
    // to appoint.
    for (const o of REGISTER) {
      by.set(o.id, {
        key: o.id, name: o.name, personId: null, officialId: o.id, panel: o.panel,
        registered: true, active: o.active, level: o.level,
        accreditations: o.accreditations, accreditedUntil: o.accreditedUntil,
        duties: new Set(), fixtures: 0, lastAt: null, appointments: [],
      });
    }

    for (const a of APPOINTMENTS) {
      // An appointment that names somebody on the register is THAT person,
      // however the name was typed on the day. One that does not is keyed on
      // the name, as before — and that is the honest answer for a parent who
      // stood in at short notice and is on nobody's panel.
      const key = a.officialId || a.personId || `name:${(a.name || "").trim().toLowerCase()}`;
      if (!by.has(key)) {
        by.set(key, { key, name: a.name, personId: a.personId, officialId: a.officialId ?? null,
                      panel: a.panel, registered: false, active: true, level: null,
                      accreditations: 0, accreditedUntil: null,
                      duties: new Set(), fixtures: 0, lastAt: null, appointments: [] });
      }
      const p = by.get(key);
      if (a.personId) p.personId = a.personId;
      p.duties.add(a.duty);
      p.fixtures += 1;
      p.appointments.push(a);
      // The panel as most recently recorded: an umpire can move associations.
      // The register wins when it has one, because that is the maintained
      // fact and the appointment is a copy taken on the day.
      if (a.panel && !p.registered) p.panel = a.panel;
      if (!p.lastAt || a.appointedAt > p.lastAt) p.lastAt = a.appointedAt;
    }

    return [...by.values()].sort((a, b) => b.fixtures - a.fixtures || a.name.localeCompare(b.name));
  }, [APPOINTMENTS, REGISTER]);

  const shown = duty === "all" ? people : people.filter((p) => p.duties.has(duty));
  const selected = shown.find((p) => p.key === sel) ?? null;
  const fixtureOf = (id) => MATCHES.find((m) => m.id === id);
  const when = (ts) => (ts ? String(ts).slice(0, 10) : "—");

  return (
    <div className="os-page">
      <SectionHeader
        title="Officials"
        sub="Umpires · Scorers · Referees — from the appointments that were actually made"
        color={D.sky}
        actions={canManage && live && <Btn size="sm" data-testid="add-official" onClick={() => { setFormError(null); setAdding(true); }}>+ Add to the register</Btn>}/>

      {adding && (
        <Modal title="Add an official to the register" onClose={() => setAdding(false)}>
          <Input label="Full name" value={form.fullName} onChange={(v) => setForm((f) => ({ ...f, fullName: v }))} placeholder="First Last" data-testid="official-name"/>
          <Input label="Date of birth" type="date" value={form.born} onChange={(v) => setForm((f) => ({ ...f, born: v }))} data-testid="official-born"/>
          <Input label="SA ID number (optional — checked against the date of birth)" value={form.idNumber} onChange={(v) => setForm((f) => ({ ...f, idNumber: v }))} placeholder="13 digits"/>
          {dob && !dob.ok && <div style={{ fontFamily: D.body, fontSize: "12px", color: D.roseText, marginBottom: "8px" }}>{BIRTH_DATE_MESSAGE?.[dob.reason] ?? dob.reason}</div>}
          <Input label="Panel (optional)" value={form.panel} onChange={(v) => setForm((f) => ({ ...f, panel: v }))} placeholder="KZN Umpires Association"/>
          <Input label="Email (optional)" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} type="email"/>
          <Input label="Phone (optional)" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))}/>
          {formError && <div role="alert" style={{ fontFamily: D.body, fontSize: "12px", color: D.roseText, marginBottom: "8px" }}>{formError}</div>}
          <Btn data-testid="official-save" disabled={!form.fullName.trim() || !dob?.ok} onClick={submitOfficial}>Add to the register</Btn>
        </Modal>
      )}

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
                  {d === "all" ? "ALL" : <><Icon name={DUTY[d].icon}/> {DUTY[d].label.toUpperCase()}</>}
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon="hand"
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
                            {p.duties.size === 0 && p.registered ? "Has not stood yet" : ""}
                            {p.panel ? ` — ${p.panel}` : ""}
                          </div>
                          {p.registered && (
                            <div style={{ marginTop: "3px" }} data-testid={`official-standing-${p.key}`}>
                              {p.level
                                ? <Badge color={LEVEL[p.level]?.color ?? D.textMuted}>{LEVEL[p.level]?.label ?? p.level}</Badge>
                                : p.accreditations > 0
                                  ? <Badge color={D.rose}>Accreditation lapsed</Badge>
                                  : <Badge color={D.textMuted}>Not accredited</Badge>}
                            </div>
                          )}
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
                  {canManage && live && selected.registered && (
                    <div data-testid="official-manage" style={{ marginTop: "12px", padding: "12px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf2 }}>
                      <div style={{ fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: D.textMuted, marginBottom: "8px" }}>Accreditation</div>
                      <Select label="Level" value={accredit.level} onChange={(v) => setAccredit((a) => ({ ...a, level: v }))}
                              options={Object.entries(LEVEL).map(([value, l]) => ({ value, label: l.label }))}/>
                      <Input label="Valid from" type="date" value={accredit.validFrom} onChange={(v) => setAccredit((a) => ({ ...a, validFrom: v }))}/>
                      <Input label="Valid until (blank = does not lapse)" type="date" value={accredit.validUntil} onChange={(v) => setAccredit((a) => ({ ...a, validUntil: v }))}/>
                      {manageError && <div role="alert" style={{ fontFamily: D.body, fontSize: "12px", color: D.roseText, marginBottom: "8px" }}>{manageError}</div>}
                      <div style={{ display: "flex", gap: "8px" }}>
                        <Btn size="sm" data-testid="official-accredit" onClick={() => submitAccreditation(selected.id)}>Record accreditation</Btn>
                        <Btn size="sm" variant="ghost" data-testid="official-retire" onClick={() => retireOfficial(selected.id)}>Retire from the register</Btn>
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
                    {[...selected.duties].map((d) => (
                      <Pill key={d} color={DUTY[d]?.color ?? D.textMuted}>
                        {DUTY[d]?.icon && <Icon name={DUTY[d].icon}/>} {DUTY[d]?.label ?? d}
                      </Pill>
                    ))}
                    {selected.panel && <Pill color={D.violet}><Icon name="award"/> {selected.panel}</Pill>}
                    {selected.registered && selected.level && (
                      <Pill color={LEVEL[selected.level]?.color ?? D.textMuted}>
                        {LEVEL[selected.level]?.label ?? selected.level}
                        {selected.accreditedUntil ? ` — to ${selected.accreditedUntil}` : ""}
                      </Pill>
                    )}
                    {selected.registered && !selected.level && selected.accreditations > 0 && (
                      <Pill color={D.rose}>
                        Lapsed{selected.accreditedUntil ? ` ${selected.accreditedUntil}` : ""}
                      </Pill>
                    )}
                    {!selected.registered && <Pill color={D.textMuted}>Not on the register</Pill>}
                    <Pill color={D.textMuted}><Icon name="calendar-days"/> Last {when(selected.lastAt)}</Pill>
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
                          <div key={a.id ?? a.matchId + a.duty + i}
                            style={{ borderTop: i === 0 ? "none" : `1px solid ${D.border}` }}>
                          <div
                            style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                              gap: "10px", padding: "10px 13px" }}>
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
                            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                              {a.suspended && <Badge color={D.rose}>Suspended</Badge>}
                              <Badge color={DUTY[a.duty]?.color ?? D.textMuted}>
                                {DUTY[a.duty]?.label ?? a.duty}
                              </Badge>
                            </div>
                          </div>
                          <DutyAuthority appointment={a} canAssign={canAssign} live={live}
                                         suspension={openSuspension(a.id)} onDone={() => setNonce((n) => n + 1)}/>
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
