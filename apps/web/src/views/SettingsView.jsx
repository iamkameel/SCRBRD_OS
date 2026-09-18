import { useEffect, useMemo, useState } from "react";
import pkg from "../../package.json";
import { ROLES, ROLE_FAMILIES, ROLE_IDENTITY, canonicalRole } from "../design/roles.js";
import { GRANTABLE_ROLES, ROLE_CAPABILITIES, SUBJECT_SCOPED_ROLES, TEAM_SCOPED_ROLES } from "@scrbrd/policy/roles";
import { D, textOn } from "../design/tokens.js";
import { Avatar, Badge, Btn, Card, EmptyState, Input, Modal, SectionHeader, Select } from "../ui/primitives.jsx";
import { Metric, MetricGroup } from "../ui/data.jsx";
import { useLive, useRows } from "../lib/live.js";
import { profile, schoolsWhere } from "../lib/session.js";
import { useSports } from "../lib/features.js";
import { holdsCapability } from "../rbac/index.js";
import { api, signedIn } from "../lib/api.js";
import { disablePush, enablePush, pushSupported } from "../lib/push.js";
import { resolveBirthDate, BIRTH_DATE_MESSAGE } from "@scrbrd/policy/date-of-birth";
import { STATUS_LABEL, STATUS_TONE, UPGRADES } from "../data/roadmap.js";

// ══════════════════════════════════════════════════════
//  SETTINGS & ACCESS CONTROL
//
//  Six tabs, each answering one question the office actually asks:
//    People    — who can sign in, and who on the roster cannot yet
//    Roles     — what each role may do, read from the policy
//    Me        — my own access, this device, my clearances
//    Passport  — where a boy's record may travel
//    School    — what is on record for each school I belong to
//    Roadmap   — what is built, what is built underneath, what is planned
//
//  Everything drawn here is live and row-scoped: the reads go through the
//  same choke point as every other screen, and the client decides nothing
//  about authority. The one exception is the roadmap, which is a list about
//  the codebase and is kept honest against it by hand.
// ══════════════════════════════════════════════════════

const TABS = [
  { id: "users",    label: "People",   hint: "Accounts, and who is missing one" },
  { id: "roles",    label: "Roles",    hint: "What each role may do" },
  { id: "me",       label: "Me",       hint: "My access, this device, my clearances" },
  { id: "passport", label: "Passport", hint: "Where a record may travel" },
  { id: "school",   label: "School",   hint: "What is on record for each school" },
  { id: "upgrades", label: "Roadmap",  hint: "Built, built underneath, planned" },
];

// ── Small shared pieces ────────────────────────────────
// Card has overflow:hidden and NO padding of its own; a title set flush
// against its edge loses its first glyph to the rounded corner (the first
// screenshots read "ccounts" and "ilton College"). Every card on this
// screen is a padded one; an explicit padding in sx still wins.
const Panel = ({ sx, ...rest }) => <Card sx={{ padding: "16px", ...sx }} {...rest}/>;
const H = { fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: D.textPrimary };
const SUB = { fontFamily: D.body, fontSize: "11px", color: D.textMuted, lineHeight: 1.5 };
const MONO = { fontFamily: D.mono, fontSize: "10px", color: D.textMuted };
const EYEBROW = { fontFamily: D.head, fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: D.textMuted };

const CardHead = ({ title, sub, aside }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap", marginBottom: sub ? "12px" : "10px" }}>
    <div style={{ minWidth: 0 }}>
      <div style={H}>{title}</div>
      {sub && <div style={{ ...SUB, marginTop: "3px", maxWidth: "62ch" }}>{sub}</div>}
    </div>
    {aside && <div style={{ flexShrink: 0 }}>{aside}</div>}
  </div>
);

const TH = ({ children, align = "left" }) => (
  <th style={{ padding: "9px 12px", fontFamily: D.head, fontSize: "9px", fontWeight: 700, color: D.textMuted,
               letterSpacing: "0.08em", textTransform: "uppercase", textAlign: align, whiteSpace: "nowrap" }}>{children}</th>
);
const TD = ({ children, align = "left", mono, sx }) => (
  <td style={{ padding: "10px 12px", textAlign: align, verticalAlign: "middle",
               fontFamily: mono ? D.mono : D.body, fontSize: mono ? "10px" : "12px",
               color: mono ? D.textMuted : D.textPrimary, ...sx }}>{children}</td>
);

const SmallBtn = ({ children, sx, ...rest }) => (
  <button {...rest} style={{ background: "none", border: `1px solid ${D.border}`, borderRadius: D.sm,
    padding: "3px 9px", cursor: rest.disabled ? "default" : "pointer", fontFamily: D.body, fontSize: "10px",
    color: D.textSecondary, ...sx }}>{children}</button>
);

/** "3 d ago", "just now", or an em dash. Never a raw ISO timestamp on a screen. */
const ago = (t) => {
  if (!t) return "—";
  const ms = Date.now() - new Date(t).getTime();
  if (!Number.isFinite(ms)) return "—";
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
};
const day = (t) => (t ? String(t).slice(0, 10) : "—");

function SettingsView({ role, users: usersFromApp, setUsers: setUsersFromApp, onDirectoryChanged }) {
  // Read through the choke point: row-scoped and column-masked for this
  // principal. Importing the raw constant here would bypass both.
  // Bumped after a write so the accounts table re-reads instead of showing the
  // roster as it was before the enrolment. Declared ahead of the reads that
  // take it: a const used above its own declaration is a dead-zone crash.
  const [nonce, setNonce] = useState(0);
  const COACHES = useRows("coaches", role);
  const PLAYERS = useRows("players", role);
  const STAFF = useRows("staff", role);
  const USERS_INITIAL = useRows("users", role, nonce);
  const [tab, setTab] = useState("users");
  // `useState(USERS_INITIAL)` captured the directory on the first render,
  // which is now the empty array before the read resolves — the same stale
  // copy that blanked the notifications feed. Local edits are held separately
  // so a re-fetch does not discard them.
  const [usersLocal, setUsersLocal] = useState(null);
  const users    = usersFromApp || usersLocal || USERS_INITIAL;
  const setUsers = setUsersFromApp || setUsersLocal;
  void setUsers;

  const [addUser, setAddUser] = useState(false);
  // ENROLMENT, which is what this modal does. The fields are the ones
  // enrol_person() actually takes: a name, an address, a role, and the person
  // on the roster the account is FOR. `withCode` asks for the sign-in code in
  // the same breath, because there is no email channel yet and somebody has to
  // read it off the screen.
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "player", player: "", withCode: true });
  const [enrolling, setEnrolling] = useState(false);
  const [enrolError, setEnrolError] = useState(null);
  // The code, held until it is dismissed. It exists in readable form exactly
  // once — this is that once.
  const [issued, setIssued] = useState(null);
  // WHO MAY MANAGE PEOPLE, by the capability rather than by a name.
  // holdsCapability() answers from the policy and works for both vocabularies
  // — the demonstration alias and the real role name — because the alias
  // resolves through the same assignments the real name does.
  const canEdit = holdsCapability(role, "user.role.assign");
  const canAudit = holdsCapability(role, "audit.read");

  // WHICH SCHOOL the account is opened at, taken from the signed-in person's
  // own assignments rather than from a constant.
  const enrolSchools = schoolsWhere("user.role.assign");
  const [enrolSchool, setEnrolSchool] = useState(null);
  const enrolAt = enrolSchool || enrolSchools[0]?.id || null;

  // Roster people with no account, by the link the accounts read carries.
  // Both sides are already row-scoped in Postgres for this reader, so this
  // reconciles two permitted lists rather than widening either.
  const linkedPlayerIds = new Set(users.map((u) => u.player).filter(Boolean));
  const noAccount = PLAYERS.filter((p) => !linkedPlayerIds.has(p.id));

  // THE GAPS db/10 AND db/11 COULD ONLY WARN ABOUT — dob_gaps() reads the
  // same two facts back so this screen can name them where the office looks.
  const dobGaps = useRows("dob_gaps", role, nonce);
  const noDob = dobGaps.filter((g) => g.kind === "no_dob");
  const linkEnded = dobGaps.filter((g) => g.kind === "guardian_link_ended");

  // ONE MODAL DOES BOTH STEPS: capture the birthday, then re-establish the
  // guardian link the read carried along, so the office does it once.
  const [captureFor, setCaptureFor] = useState(null);
  const [captureValue, setCaptureValue] = useState({ born: "", idNumber: "" });
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState(null);
  const captureCheck = (captureValue.born || captureValue.idNumber)
    ? resolveBirthDate({ born: captureValue.born, idNumber: captureValue.idNumber })
    : null;
  const openCapture = (target) => { setCaptureFor(target); setCaptureValue({ born: "", idNumber: "" }); setCaptureError(null); };
  const saveDob = async () => {
    if (!captureFor) return;
    setCaptureError(null);
    setCapturing(true);
    try {
      await api(`/api/players/${captureFor.playerId}/date-of-birth`, { method: "POST", body: {
        born: captureValue.born || undefined,
        idNumber: captureValue.idNumber || undefined,
      } });
      if (captureFor.guardianId) {
        await api(`/api/players/${captureFor.playerId}/guardians`, { method: "POST", body: {
          guardianId: captureFor.guardianId,
          relationship: captureFor.relationship || "parent",
        } });
      }
      setCaptureFor(null);
      setCaptureValue({ born: "", idNumber: "" });
      setNonce((n) => n + 1);
    } catch (e) {
      setCaptureError(e?.code || e?.message || "capture_failed");
    } finally {
      setCapturing(false);
    }
  };

  // It enrols. The server decides everything: whether this caller may,
  // whether the role is one they can grant, whether the boy already has an
  // account. The client sends the form and shows the answer.
  const enrolPerson = async () => {
    setEnrolError(null);
    setEnrolling(true);
    try {
      const linked = PLAYERS.find((p) => p.id === newUser.player) || null;
      const out = await api("/api/users", { method: "POST", body: {
        email: newUser.email.trim(),
        name: newUser.name.trim(),
        role: newUser.role,
        schoolId: enrolAt,
        teamCode: linked?.team || undefined,
        playerId: newUser.player || undefined,
        withCode: newUser.withCode === true,
      } });
      setAddUser(false);
      setNewUser({ name: "", email: "", role: "player", player: "", withCode: true });
      if (out?.code) setIssued({ code: out.code, expiresAt: out.expiresAt, name: newUser.name.trim() });
      else if (out?.codeError) setIssued({ code: null, error: out.codeError, name: newUser.name.trim() });
      setNonce((n) => n + 1);
      onDirectoryChanged?.();
    } catch (e) {
      setEnrolError(e?.code || e?.message || "enrol_failed");
    } finally {
      setEnrolling(false);
    }
  };

  // A fresh code for an account that already exists — through
  // login_code_issue(), which refuses anyone without user.invite at that
  // school and refuses a code issued to yourself.
  const [coding, setCoding] = useState(null);
  const issueCodeFor = async (u) => {
    setCoding(u.id);
    try {
      const out = await api("/api/auth/invite", { method: "POST", body: { email: u.email } });
      setIssued({ code: out?.code, expiresAt: out?.expiresAt, name: u.name });
    } catch (e) {
      setIssued({ code: null, error: ENROL_MESSAGE[e?.code] || e?.code || "code_not_issued", name: u.name });
    } finally {
      setCoding(null);
    }
  };

  // Said in the office's words, not the database's. An unmapped code shows as
  // itself rather than as a friendly guess at what it might have meant.
  const ENROL_MESSAGE = {
    not_permitted: "You do not hold the capability to open an account at this school.",
    email_invalid: "That email address is not a valid one.",
    name_required: "A full name is needed.",
    player_required: "Choose the person on the roster this account is for.",
    no_such_player: "That person is not on the roster.",
    player_not_at_that_school: "That person is on another school's roster.",
    player_already_has_an_account: "That person already has an account. Look for them in the table above.",
    email_belongs_to_another_school: "That email address already belongs to an account at another school.",
    player_is_an_adult: "Guardian access ends at eighteen, and this person has turned eighteen.",
    player_date_of_birth_required: "Capture this person's date of birth first — guardian access is worked out from it.",
    team_required: "Choose the side this person coaches.",
    missing_token: "You are not signed in.",
  };

  // The roles THIS person may actually grant, from the policy's own table.
  const grantable = GRANTABLE_ROLES[canonicalRole(role)] ?? [];

  // The number on the People tab: things to fix, not things to read.
  const attention = noAccount.length + noDob.length + linkEnded.length;

  return (
    <div className="os-page">
      <SectionHeader title="Settings & Access Control"
        sub="Who can sign in, what each role may do, this device, and what each school has on record."
        color={D.violet}/>

      {/* A real tab strip: keyboard-reachable, announced as tabs, and each
          one says what it is for on hover. Emoji in the labels are gone —
          a screen reader read "rocket Upgrades" and a walk that clicks by
          text had to know the icon. */}
      <div role="tablist" aria-label="Settings sections"
           style={{ display: "flex", gap: "6px", marginBottom: "18px", flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const on = tab === t.id;
          const n = t.id === "users" ? attention : 0;
          return (
            <button key={t.id} role="tab" aria-selected={on} aria-controls={`settings-panel-${t.id}`}
                    id={`settings-tab-${t.id}`} title={t.hint} onClick={() => setTab(t.id)} className="pressBtn"
                    style={{ display: "inline-flex", alignItems: "center", gap: "7px",
                      padding: "6px 16px", borderRadius: D.pill, cursor: "pointer",
                      border: `1px solid ${on ? D.violet + "55" : D.border}`, background: on ? D.violet + "14" : "transparent",
                      fontFamily: D.body, fontSize: "11px", fontWeight: on ? 700 : 400, color: on ? D.violet : D.textMuted }}>
              {t.label}
              {n > 0 && (
                <span aria-label={`${n} to attend to`} style={{ fontFamily: D.mono, fontSize: "9px", fontWeight: 700,
                  padding: "1px 6px", borderRadius: D.pill, background: D.amber + "22", color: textOn(D.amber) }}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
        {tab === "users" && (
          <PeopleTab users={users} players={PLAYERS} staff={STAFF} coaches={COACHES}
                     noAccount={noAccount} noDob={noDob} linkEnded={linkEnded}
                     canEdit={canEdit} coding={coding}
                     onEnrol={() => { setEnrolError(null); setAddUser(true); }}
                     onEnrolFor={(p) => { setNewUser({ name: p.name, email: "", role: "player", player: p.id, withCode: true }); setEnrolError(null); setAddUser(true); }}
                     onCapture={openCapture} onIssueCode={issueCodeFor}/>
        )}
        {tab === "roles"    && <RolesTab users={users} grantable={grantable}/>}
        {tab === "me"       && <MeTab role={role}/>}
        {tab === "passport" && <PassportTab role={role}/>}
        {tab === "school"   && <SchoolTab role={role} users={users} players={PLAYERS} staff={STAFF} coaches={COACHES} canAudit={canAudit}/>}
        {tab === "upgrades" && <RoadmapTab/>}
      </div>

      {/* ── ENROL MODAL ──
          The fields are the ones enrol_person() takes and no others: a form
          that collects something the server has no place to put is a form
          that quietly discards it. */}
      {addUser && (
        <Modal title="Enrol a person" onClose={() => { setAddUser(false); setEnrolError(null); }}>
          <div style={{ ...SUB, marginBottom: "10px" }}>
            This opens a real account and links it to their record. There is no email yet —
            ask for a sign-in code and hand it over in person.
          </div>
          {enrolSchools.length > 1 && (
            <Select label="School" value={enrolAt || ""} onChange={(v) => setEnrolSchool(v)}
                    options={enrolSchools.map((sc) => ({ value: sc.id, label: sc.name }))}/>
          )}
          <Select label="Role" value={newUser.role} onChange={(v) => setNewUser((p) => ({ ...p, role: v }))}
                  options={grantable.map((v) => ({ value: v, label: `${ROLES[v].icon} ${ROLES[v].label}` }))}/>
          {/* The roster, narrowed to the people who have no account — the list
              this screen already shows as the problem. */}
          <Select label={newUser.role === "player" ? "Who this account is for" : "Linked person (optional)"}
                  value={newUser.player}
                  onChange={(v) => {
                    const pick = PLAYERS.find((x) => x.id === v);
                    setNewUser((p) => ({ ...p, player: v, name: p.name || pick?.name || "" }));
                  }}
                  options={[{ value: "", label: "None" }, ...noAccount.map((p) => ({ value: p.id, label: `${p.name} (${p.team})` }))]}/>
          <Input label="Full Name" value={newUser.name} onChange={(v) => setNewUser((p) => ({ ...p, name: v }))} placeholder="First Last"/>
          <Input label="Email" value={newUser.email} onChange={(v) => setNewUser((p) => ({ ...p, email: v }))} type="email" placeholder="name@school.co.za"/>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px", cursor: "pointer",
                          fontFamily: D.body, fontSize: "12px", color: D.textSecondary }}>
            <input type="checkbox" checked={newUser.withCode === true}
                   onChange={(e) => setNewUser((p) => ({ ...p, withCode: e.target.checked }))}/>
            Issue a sign-in code now
          </label>
          {enrolError && (
            <div data-testid="enrol-error" role="alert" style={{ marginTop: "10px", padding: "8px 10px", borderRadius: D.sm,
              background: D.rose + "14", border: `1px solid ${D.rose}33`, fontFamily: D.body, fontSize: "11px", color: D.roseText }}>
              {ENROL_MESSAGE[enrolError] || enrolError}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "10px" }}>
            <Btn variant="ghost" onClick={() => { setAddUser(false); setEnrolError(null); }}>Cancel</Btn>
            <Btn onClick={enrolPerson} disabled={enrolling || !enrolAt}>{enrolling ? "Enrolling…" : "Enrol"}</Btn>
          </div>
        </Modal>
      )}

      {/* ── CAPTURE A DATE OF BIRTH ── the same form for both rows of the
          card: a plain gap asks for one write, a guardian-link-ended row asks
          for two — this one and then guardian_link_establish(). */}
      {captureFor && (
        <Modal title={captureFor.guardianId ? "Capture & re-establish" : "Capture date of birth"}
               onClose={() => { setCaptureFor(null); setCaptureError(null); }}>
          <div style={{ ...SUB, marginBottom: "10px" }}>
            <strong style={{ color: D.textPrimary }}>{captureFor.name}</strong> has no date of birth on record.
            {captureFor.guardianId
              ? ` Once it is captured, ${captureFor.guardianName || "the guardian"}'s link (${captureFor.relationship || "parent"}) is re-established in the same step.`
              : " Type it, or give an ID number and it will be read from that."}
          </div>
          <Input label="Date of birth" value={captureValue.born}
                 onChange={(v) => setCaptureValue((p) => ({ ...p, born: v }))} type="date"/>
          <Input label="ID number (optional)" value={captureValue.idNumber}
                 onChange={(v) => setCaptureValue((p) => ({ ...p, idNumber: v }))} placeholder="13 digits"/>
          {captureCheck && captureCheck.ok === false && (
            <div data-testid="capture-dob-note" role="alert" style={{ marginTop: "8px", fontFamily: D.body, fontSize: "10px", color: D.roseText }}>
              {BIRTH_DATE_MESSAGE[captureCheck.reason] || captureCheck.reason}
            </div>
          )}
          {captureCheck && captureCheck.ok && captureCheck.source === "id_number" && (
            <div style={{ marginTop: "8px", fontFamily: D.body, fontSize: "10px", color: D.textMuted }}>
              Born <b style={{ color: D.textSecondary }}>{captureCheck.born}</b>, read from the ID number.
            </div>
          )}
          {captureError && (
            <div data-testid="capture-dob-error" role="alert" style={{ marginTop: "10px", padding: "8px 10px", borderRadius: D.sm,
              background: D.rose + "14", border: `1px solid ${D.rose}33`, fontFamily: D.body, fontSize: "11px", color: D.roseText }}>
              {BIRTH_DATE_MESSAGE[captureError] || ENROL_MESSAGE[captureError] || captureError}
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "10px" }}>
            <Btn variant="ghost" onClick={() => { setCaptureFor(null); setCaptureError(null); }}>Cancel</Btn>
            <Btn data-testid="save-dob" onClick={saveDob} disabled={capturing || !captureCheck?.ok}>
              {capturing ? "Saving…" : captureFor.guardianId ? "Capture & re-establish" : "Capture"}
            </Btn>
          </div>
        </Modal>
      )}

      {/* ── THE CODE, ONCE ── login_code_issue() stores a hash; the readable
          code exists in this response and nowhere else, ever again. */}
      {issued && (
        <Modal title={issued.code ? "Sign-in code" : "Account opened"} onClose={() => setIssued(null)}>
          {issued.code ? (
            <>
              <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, lineHeight: 1.6, marginBottom: "10px" }}>
                <strong style={{ color: D.textPrimary }}>{issued.name}</strong> now has an account.
                Write this code down and hand it over — it is shown once and cannot be read again.
              </div>
              <div data-testid="issued-code" style={{ fontFamily: D.mono, fontSize: "22px", letterSpacing: "0.18em",
                textAlign: "center", padding: "14px", borderRadius: D.sm, color: D.textPrimary,
                background: D.emerald + "14", border: `1px solid ${D.emerald}44` }}>{issued.code}</div>
              {issued.expiresAt && (
                <div style={{ ...SUB, marginTop: "8px", textAlign: "center" }}>Expires {new Date(issued.expiresAt).toLocaleString()}</div>
              )}
            </>
          ) : (
            <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, lineHeight: 1.6 }}>
              <strong style={{ color: D.textPrimary }}>{issued.name}</strong> now has an account, but no
              sign-in code could be issued ({issued.error}). The account is real — issue a code from
              this screen when you are ready.
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
            <Btn onClick={() => setIssued(null)}>Done</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  PEOPLE — who can sign in, and who cannot yet
// ══════════════════════════════════════════════════════
function PeopleTab({ users, players, staff, coaches, noAccount, noDob, linkEnded, canEdit, coding,
                     onEnrol, onEnrolFor, onCapture, onIssueCode }) {
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const schoolName = useMemo(() => {
    const m = new Map();
    for (const a of profile()?.assignments ?? []) if (a.school && a.schoolName) m.set(a.school, a.schoolName);
    return m;
  }, []);
  const manySchools = new Set(users.map((u) => u.school).filter(Boolean)).size > 1;
  const linkedName = (u) => u.player ? players.find((p) => p.id === u.player)?.name
    : u.staffId ? staff.find((s) => s.id === u.staffId)?.name
    : u.coachId ? coaches.find((c) => c.id === u.coachId)?.name
    : null;
  const needle = q.trim().toLowerCase();
  const shown = users.filter((u) =>
    (!roleFilter || u.role === roleFilter) &&
    (!needle || `${u.name} ${u.email} ${ROLES[u.role]?.label ?? u.role} ${linkedName(u) ?? ""}`.toLowerCase().includes(needle)));
  const rolesPresent = [...new Set(users.map((u) => u.role))].sort((a, b) => (ROLES[a]?.label ?? a).localeCompare(ROLES[b]?.label ?? b));
  const active = users.filter((u) => u.status === "active").length;

  return (
    <div>
      <MetricGroup min={150} sx={{ marginBottom: "16px" }}>
        <Metric label="Accounts" value={users.length} sub={`${active} active`}/>
        <Metric label="On the roster" value={players.length} sub="people with a record"/>
        <Metric label="Without an account" value={noAccount.length} tone={noAccount.length ? D.amber : undefined} sub="cannot sign in"/>
        <Metric label="No date of birth" value={noDob.length} tone={noDob.length ? D.rose : undefined} sub={linkEnded.length ? `${linkEnded.length} guardian link${linkEnded.length === 1 ? "" : "s"} ended` : "family access depends on it"}/>
      </MetricGroup>

      {/* THE PEOPLE WITH NO ACCOUNT. A boy on the roster who cannot sign in is
          an access-control fact, not an absence, and the chip IS the way in. */}
      {noAccount.length > 0 && (
        <Panel sx={{ padding: "14px", marginBottom: "14px", borderLeft: `3px solid ${D.amber}` }} data-testid="people-without-accounts">
          <div style={{ ...H, fontSize: "12px", marginBottom: "4px" }}>
            On a roster, no account — {noAccount.length} of {players.length}
          </div>
          <div style={{ ...SUB, marginBottom: "10px" }}>
            These people appear in Squad and Profiles and hold a passport, but cannot sign in.
            An account is what links the two: without one, nobody can read their own record.
            {canEdit ? " Choose somebody to open an account for them." : ""}
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {noAccount.map((p) => {
              const Tag = canEdit ? "button" : "span";
              return (
                <Tag key={p.id} data-testid={`no-account-${p.id}`}
                  {...(canEdit ? { onClick: () => onEnrolFor(p), title: `Enrol ${p.name}` } : {})}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px",
                    padding: "4px 10px", borderRadius: D.pill, background: D.amber + "14", border: `1px solid ${D.amber}33`,
                    fontFamily: D.body, fontSize: "11px", color: D.textSecondary, cursor: canEdit ? "pointer" : "default" }}>
                  <Avatar name={p.name} size={18} color={D.amber}/>
                  {p.name}
                  <span style={{ ...MONO, fontSize: "9px" }}>{p.team}</span>
                </Tag>
              );
            })}
          </div>
        </Panel>
      )}

      {/* THE GAPS db/10 AND db/11 COULD ONLY WARN ABOUT. Two rows from one
          read under one heading, because the second is a consequence of the
          first: a guardian link cannot be re-established until the birthday
          above it is captured. */}
      {(noDob.length > 0 || linkEnded.length > 0) && (
        <Panel sx={{ padding: "14px", marginBottom: "14px", borderLeft: `3px solid ${D.rose}` }} data-testid="dob-gaps">
          <div style={{ ...H, fontSize: "12px", marginBottom: "4px" }}>
            No date of birth on record — {noDob.length} of {players.length}
          </div>
          <div style={{ ...SUB, marginBottom: "10px" }}>
            Nobody's family can be linked to them and no guardian link can be given an end date until this is captured.
            {canEdit ? " Choose somebody to capture it." : ""}
          </div>
          {noDob.length > 0 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: linkEnded.length > 0 ? "14px" : 0 }}>
              {noDob.map((p) => {
                const Tag = canEdit ? "button" : "span";
                return (
                  <Tag key={p.playerId} data-testid={`dob-gap-${p.playerId}`}
                    {...(canEdit ? { onClick: () => onCapture({ playerId: p.playerId, name: p.name }), title: `Capture ${p.name}'s date of birth` } : {})}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px",
                      padding: "4px 10px", borderRadius: D.pill, background: D.rose + "14", border: `1px solid ${D.rose}33`,
                      fontFamily: D.body, fontSize: "11px", color: D.textSecondary, cursor: canEdit ? "pointer" : "default" }}>
                    <Avatar name={p.name} size={18} color={D.rose}/>
                    {p.name}
                    <span style={{ ...MONO, fontSize: "9px" }}>{p.team}</span>
                  </Tag>
                );
              })}
            </div>
          )}
          {linkEnded.length > 0 && (
            <>
              <div style={{ ...H, fontSize: "11px", marginBottom: "4px" }}>
                Guardian access ended for want of it — {linkEnded.length}
              </div>
              <div style={{ ...SUB, marginBottom: "10px" }}>
                These links were live once. Capturing the birthday and re-establishing the link is one step.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {linkEnded.map((g) => (
                  <div key={g.linkId} data-testid={`guardian-link-ended-${g.linkId}`}
                    style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap",
                      padding: "6px 10px", borderRadius: D.sm, background: D.amber + "0c", border: `1px solid ${D.amber}22` }}>
                    <Avatar name={g.name} size={18} color={D.amber}/>
                    <span style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary }}>{g.name}</span>
                    <span style={{ ...MONO, fontSize: "9px" }}>
                      {g.relationship} · {g.guardianName || g.guardianEmail || "unknown guardian"} · ended {g.endedOn}
                    </span>
                    {canEdit && (
                      <SmallBtn data-testid={`relink-${g.linkId}`} sx={{ marginLeft: "auto" }}
                        onClick={() => onCapture({ playerId: g.playerId, name: g.name, guardianId: g.guardianId, guardianName: g.guardianName, relationship: g.relationship })}>
                        Capture &amp; re-establish
                      </SmallBtn>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>
      )}

      <Panel>
        <CardHead title="Accounts"
          sub="Everyone who can sign in at a school you manage. Issuing a code is the one account action that is real end to end; there is no suspend or delete here because neither did anything."
          aside={canEdit && <Btn size="sm" data-testid="enrol-person" onClick={onEnrol}>+ Enrol a person</Btn>}/>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "10px" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or role…" aria-label="Search accounts"
                 style={{ flex: "1 1 220px", minWidth: "160px", background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.sm,
                          padding: "7px 10px", fontFamily: D.body, fontSize: "12px", color: D.textPrimary }}/>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role"
                  style={{ background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.sm, padding: "7px 10px", fontFamily: D.body, fontSize: "12px", color: D.textPrimary }}>
            <option value="">Every role</option>
            {rolesPresent.map((r) => <option key={r} value={r}>{ROLES[r]?.label ?? r}</option>)}
          </select>
          <span style={MONO}>{shown.length === users.length ? `${users.length} accounts` : `${shown.length} of ${users.length}`}</span>
        </div>
        {shown.length === 0
          ? <EmptyState icon="👤" message={users.length === 0 ? "No accounts to show. Enrol somebody from the roster above." : "Nobody matches that search."}/>
          : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: D.surf2 }}>
                    <TH>Person</TH><TH>Role</TH>{manySchools && <TH>School</TH>}<TH>Linked to</TH><TH align="center">Last seen</TH><TH align="center">Status</TH><TH align="center"></TH>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u, i) => {
                    const rc = ROLES[u.role];
                    return (
                      <tr key={u.id} style={{ borderTop: `1px solid ${D.border}`, background: i % 2 ? D.surf2 + "22" : "transparent", opacity: u.status === "active" ? 1 : 0.55 }}>
                        <TD>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                            <Avatar name={u.name} size={30} color={rc?.color || D.textMuted}/>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontFamily: D.body, fontSize: "12px", fontWeight: 500, color: D.textPrimary, whiteSpace: "nowrap" }}>{u.name}</div>
                              <div style={{ ...MONO, whiteSpace: "nowrap" }}>{u.email}</div>
                            </div>
                          </div>
                        </TD>
                        <TD><Badge color={rc?.color || D.textMuted}>{rc?.icon} {rc?.label ?? u.role}</Badge></TD>
                        {manySchools && <TD mono>{schoolName.get(u.school) ?? "—"}</TD>}
                        <TD sx={{ color: D.textSecondary, fontSize: "11px" }}>{linkedName(u) ?? "—"}</TD>
                        <TD align="center" mono title={u.lastLogin ? new Date(u.lastLogin).toLocaleString() : undefined}>{ago(u.lastLogin)}</TD>
                        <TD align="center"><Badge color={u.status === "active" ? D.emerald : D.rose}>{u.status}</Badge></TD>
                        <TD align="center">
                          {canEdit && (
                            <SmallBtn onClick={() => onIssueCode(u)} disabled={coding === u.id} data-testid={`issue-code-${u.id}`}>
                              {coding === u.id ? "…" : "Sign-in code"}
                            </SmallBtn>
                          )}
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Panel>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  ROLES — what each role may do, read from the policy
// ══════════════════════════════════════════════════════
// Capabilities are grouped by their own domain prefix (player.*, fixture.*,
// medical.*), which needs no table to maintain and cannot disagree with what
// the database enforces. A hand-written permission list is a second place for
// authority to live and a second place for it to drift.
const DOMAIN_LABEL = {
  player: "Players", fixture: "Fixtures", team: "Teams", scoring: "Scoring",
  medical: "Medical", clearance: "Clearances", transport: "Transport",
  facility: "Grounds", competition: "Competitions", news: "News",
  sponsorship: "Sponsorship", invoice: "Finance", user: "People",
  school: "School", platform: "Platform", analytics: "Analytics",
  opposition: "Opposition", scouting: "Scouting", officiating: "Officials",
  recognition: "Recognition", discipline: "Discipline", availability: "Availability",
  audit: "Audit", broadcast: "Broadcast", guardian: "Guardians",
};
const capsOf = (r) => [...(ROLE_CAPABILITIES[r] ?? [])];
const domainsOf = (r) => {
  const by = {};
  for (const c of capsOf(r)) (by[c.split(".")[0]] ??= []).push(c);
  return Object.entries(by).sort((a, b) => b[1].length - a[1].length);
};
// The two shape rules the database enforces on an assignment, said plainly.
const scopeNote = (r) =>
  TEAM_SCOPED_ROLES.includes(r) ? "Must name a team"
  : SUBJECT_SCOPED_ROLES.includes(r) ? "Must name a person"
  : ROLE_IDENTITY[r]?.family === "platform" ? "Platform-wide, no school"
  : "Scoped to a school";

function RolesTab({ users, grantable }) {
  const [family, setFamily] = useState("");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const families = Object.entries(ROLE_FAMILIES).filter(([f]) => !family || f === family);
  const matches = (r) => !needle || `${ROLES[r]?.label ?? r} ${capsOf(r).join(" ")}`.toLowerCase().includes(needle);
  const total = Object.values(ROLE_FAMILIES).flat().length;
  return (
    <div data-testid="roles-tab">
      <Panel sx={{ marginBottom: "14px" }}>
        <CardHead title={`${total} roles, ${Object.keys(ROLE_FAMILIES).length} families`}
          sub="Every role the authorization model knows about. What each one can do is read from the policy that generates the database's row-level security — not described alongside it. A role you may appoint people to is marked."/>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a role or a capability…" aria-label="Search roles"
                 style={{ flex: "1 1 220px", minWidth: "160px", background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.sm,
                          padding: "7px 10px", fontFamily: D.body, fontSize: "12px", color: D.textPrimary }}/>
          <select value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Filter by family"
                  style={{ background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.sm, padding: "7px 10px", fontFamily: D.body, fontSize: "12px", color: D.textPrimary, textTransform: "capitalize" }}>
            <option value="">Every family</option>
            {Object.keys(ROLE_FAMILIES).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </Panel>
      {families.map(([fam, members]) => {
        const list = members.filter(matches);
        if (list.length === 0) return null;
        return (
          <div key={fam} style={{ marginBottom: "18px" }}>
            <div style={{ ...EYEBROW, marginBottom: "8px" }}>{fam} <span style={{ ...MONO, letterSpacing: 0, textTransform: "none" }}>· {list.length}</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: "12px" }}>
              {list.map((r) => {
                const rc = ROLES[r];
                const doms = domainsOf(r);
                const n = capsOf(r).length;
                const held = users.filter((u) => u.role === r).length;
                const mine = grantable.includes(r);
                return (
                  <Panel key={r} sx={{ padding: "16px", border: mine ? `1px solid ${D.violet}33` : undefined }} data-testid={`role-card-${r}`}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                      <div style={{ width: "38px", height: "38px", borderRadius: D.md, background: rc.color + "18", border: `1px solid ${rc.color}22`,
                                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>{rc.icon}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontFamily: D.head, fontSize: "13px", fontWeight: 700, color: rc.color }}>{rc.label}</div>
                        <div style={{ ...MONO, fontSize: "9px" }}>
                          {n} capabilit{n === 1 ? "y" : "ies"} · {rc.nav.length} screens · {held} account{held === 1 ? "" : "s"}
                        </div>
                      </div>
                      {mine && <Badge color={D.violet}>You can appoint</Badge>}
                    </div>
                    <div style={{ ...MONO, fontSize: "9px", marginBottom: "9px", letterSpacing: "0.04em" }}>{scopeNote(r)}</div>
                    {doms.length === 0
                      ? <div style={SUB}>No capabilities.</div>
                      : doms.map(([dom, list2]) => (
                          <details key={dom} style={{ padding: "2px 0" }}>
                            <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: "7px",
                                              fontFamily: D.body, fontSize: "11px", color: D.textSecondary, lineHeight: 1.5 }}>
                              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: rc.color, flexShrink: 0 }}/>
                              {DOMAIN_LABEL[dom] ?? dom}
                              <span style={{ ...MONO, fontSize: "9px" }}>· {list2.length}</span>
                            </summary>
                            <div style={{ padding: "2px 0 4px 12px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                              {list2.map((c) => <code key={c} style={{ ...MONO, fontSize: "9px", padding: "1px 6px", borderRadius: D.pill, background: D.surf2, border: `1px solid ${D.border}` }}>{c}</code>)}
                            </div>
                          </details>
                        ))}
                  </Panel>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  ME — my own access, this device, my clearances
// ══════════════════════════════════════════════════════
function MeTab({ role }) {
  const me = profile();
  const live = signedIn();
  const assignments = me?.assignments ?? [];
  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <Panel>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          <Avatar name={me?.user?.name || ROLES[role]?.label || "You"} size={48} color={ROLES[role]?.color || D.violet}/>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ ...H, fontSize: "15px" }}>{me?.user?.name || (live ? "Signed in" : "Demonstration")}</div>
            <div style={MONO}>{me?.user?.email || (live ? "" : "Nothing on these screens is yours, and nothing is saved.")}</div>
          </div>
          <Badge color={live ? D.emerald : D.amber}>{live ? "Signed in" : "Demo"}</Badge>
        </div>
      </Panel>

      <Panel>
        <CardHead title="My access"
          sub="Every appointment you hold, as the database sees it. Revoking one takes effect on your next request, not your next sign-in; ask the school office if one is wrong."/>
        {assignments.length === 0
          ? <EmptyState icon="🗝️" message={live ? "You hold no appointment yet. Your requests are answered by the school." : "Sign in to see your appointments."}/>
          : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "10px" }}>
              {assignments.map((a) => {
                const rc = ROLES[a.role];
                return (
                  <div key={a.id} style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "10px 12px", borderRadius: D.md,
                                           background: D.surf2 + "66", border: `1px solid ${D.border}` }}>
                    <div style={{ fontSize: "18px", lineHeight: 1 }}>{rc?.icon ?? "•"}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: rc?.color || D.textPrimary }}>{rc?.label ?? a.role}</div>
                      <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary }}>{a.school ? (a.schoolName || "This school") : "Platform-wide — every school"}</div>
                      <div style={MONO}>{[a.team && `side ${a.team}`, a.season, a.fixture && "one fixture"].filter(Boolean).join(" · ") || scopeNote(a.role)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </Panel>

      <AlertsSection role={role}/>
      <MyClearancesSection role={role}/>
    </div>
  );
}

// What each school holds on ME and when it lapses. Read under the identity
// policy: these rows are mine, and nobody else's appear here whatever my role.
function MyClearancesSection({ role }) {
  const rows = useLive("my_clearances", role).rows;
  const tone = { missing: D.rose, expired: D.rose, revoked: D.amber, expiring: D.amber, current: D.emerald };
  return (
    <Panel data-testid="my-clearances">
      <CardHead title="My clearances"
        sub="What the school has on record that it checked, and the date it will ask again. The office records these; if one is wrong, ask them."/>
      {rows.length === 0
        ? <EmptyState icon="🪪" message="Nothing recorded for you."/>
        : rows.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: `1px solid ${D.border}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, fontWeight: 600 }}>{r.kindLabel}</div>
              <div style={{ fontFamily: D.body, fontSize: "10px", color: D.textMuted }}>{r.schoolName} · issued {r.issuedOn} · {r.status === "revoked" ? "revoked" : `lapses ${r.expiresOn}`}</div>
            </div>
            <span style={{ fontFamily: D.mono, fontSize: "9px", textTransform: "uppercase", padding: "3px 8px", borderRadius: D.pill,
                           background: tone[r.status] + "14", border: `1px solid ${tone[r.status]}33`, color: textOn(tone[r.status]) }}>{r.status}</span>
          </div>
        ))}
    </Panel>
  );
}

/**
 * Turning alerts on for THIS device, and signing the others out.
 *
 * IT DECIDES NOTHING, like the rest of the client. Registering a device can
 * only reduce what somebody receives; what they may receive is re-asked
 * server-side, as them, at send time.
 */
function AlertsSection({ role }) {
  const [nudge, setNudge] = useState(0);
  // useLive rather than useRows, for its third argument: turning alerts on or
  // signing a device out has to change what this table shows.
  const devices = useLive("my_devices", role, nudge).rows;
  const [support, setSupport] = useState(null);        // null = still asking
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);

  useEffect(() => { let off = false; pushSupported().then((s) => { if (!off) setSupport(s); }); return () => { off = true; }; }, []);

  // THREE DIFFERENT NOES NEED THREE DIFFERENT SENTENCES.
  const WHY = {
    unsupported:    "This browser cannot do push notifications. On an iPhone, add SCRBRD to your home screen first.",
    not_configured: "Push is not switched on for this deployment yet — nothing to do at your end.",
    declined:       "Your browser blocked notifications. You would need to allow them in its site settings.",
    no_token:       "The browser did not return a registration. Try again, or reload the page.",
  };

  const enable = async () => {
    setBusy(true); setSaid(null);
    const r = await enablePush({ label: navigator.platform || null });
    setBusy(false);
    setSaid(r.ok ? { ok: true, text: "This device will now receive alerts." }
                 : { ok: false, text: WHY[r.reason] ?? `Could not register this device (${r.reason}).` });
    if (r.ok) setNudge((n) => n + 1);
  };
  const disable = async () => {
    setBusy(true); setSaid(null);
    const r = await disablePush();
    setBusy(false);
    setSaid({ ok: true, text: r.retired ? "This device will no longer receive alerts." : "This device was not registered." });
    setNudge((n) => n + 1);
  };
  // Signing out one of the OTHERS, by row id rather than by token: a phone
  // that has been lost is not the phone you are holding.
  const retireOne = async (id) => {
    setBusy(true); setSaid(null);
    try {
      const r = await api("/api/devices/retire", { method: "POST", body: { id } });
      setSaid({ ok: true, text: r?.retired ? "That device has been signed out." : "That device was already signed out." });
    } catch { setSaid({ ok: false, text: "Could not sign that device out." }); }
    setBusy(false); setNudge((n) => n + 1);
  };

  const ordered = [...devices.filter((d) => d.active), ...devices.filter((d) => !d.active)];
  const when = (t) => (t ? new Date(t).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "—");
  const stateOf = (d) => d.active ? "Active"
    : d.retiredReason === "rejected" ? "Unreachable"
    : d.retiredReason === "replaced" ? "Taken over"
    : "Signed out";

  return (
    <Panel>
      <CardHead title="Alerts on this device"
        sub="A notice arrives as a prompt, not as the message itself. Open SCRBRD to read it — anything about a child stays behind your sign-in rather than on a lock screen."
        aside={support === null
          ? <Badge color={D.textMuted}>Checking</Badge>
          : support
            ? <div style={{ display: "flex", gap: "8px" }}>
                <Btn size="sm" disabled={busy} onClick={enable}>Turn on here</Btn>
                <Btn size="sm" variant="ghost" disabled={busy} onClick={disable}>Turn off</Btn>
              </div>
            : <Badge color={D.amber}>Not supported</Badge>}/>
      {said && (
        <div role="status" style={{ marginBottom: "12px", padding: "9px 12px", borderRadius: D.md, fontFamily: D.body, fontSize: "11px", lineHeight: 1.5,
          background: (said.ok ? D.emerald : D.amber) + "12", border: `1px solid ${(said.ok ? D.emerald : D.amber)}33`,
          color: said.ok ? D.emerald : D.amber }}>{said.text}</div>
      )}
      <div style={{ ...EYEBROW, marginBottom: "8px" }}>My devices</div>
      {ordered.length === 0
        ? <EmptyState icon="📱" message="No devices registered yet. Turn alerts on above and this one will appear here."/>
        : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: D.surf2 }}>
                <TH>Device</TH><TH align="center">Registered</TH><TH align="center">Last seen</TH><TH align="center">State</TH><TH align="center"></TH>
              </tr></thead>
              <tbody>
                {ordered.map((d) => (
                  <tr key={d.id} style={{ borderTop: `1px solid ${D.border}`, opacity: d.active ? 1 : 0.55 }}>
                    <TD>{d.label || d.platform}<span style={{ ...MONO, marginLeft: "8px" }}>…{d.tokenTail}</span></TD>
                    <TD align="center" mono>{when(d.registeredAt)}</TD>
                    <TD align="center" mono>{when(d.lastSeenAt)}</TD>
                    <TD align="center"><Badge color={d.active ? D.emerald : D.textMuted}>{stateOf(d)}</Badge></TD>
                    <TD align="center">{d.active && <Btn size="sm" variant="ghost" disabled={busy} onClick={() => retireOne(d.id)}>Sign out</Btn>}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {/* Retired rows are kept and shown: "signed out on the iPad in March" is
          the answer to "why did I stop getting alerts". */}
    </Panel>
  );
}

// ══════════════════════════════════════════════════════
//  PASSPORT — where a boy's record may travel
// ══════════════════════════════════════════════════════
// A boy's record goes to another school only when his family names it. The
// list is what the server lets this person see — their own grants, or the
// ones naming their school — and the form is refused by the API for anyone
// who is not his family; the message below says so in its words.
function PassportTab({ role }) {
  const [nudge, setNudge] = useState(0);
  const [schools, setSchools] = useState([]);
  const [playerId, setPlayerId] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [said, setSaid] = useState("");
  const players = useRows("players", role);
  const rows = useLive("passport_consents", role, nudge).rows;
  useEffect(() => { let off = false; api("/api/schools").then((r) => { if (!off && r?.rows) setSchools(r.rows); }).catch(() => {}); return () => { off = true; }; }, []);
  const grant = async () => {
    setSaid("");
    try { await api("/api/passport/consent", { method: "POST", body: { playerId, schoolId } }); setSchoolId(""); setNudge((n) => n + 1); }
    catch (e) { setSaid(e.message || "Refused."); }
  };
  const withdraw = async (id) => {
    setSaid("");
    try { await api(`/api/passport/consent/${id}/withdraw`, { method: "POST" }); setNudge((n) => n + 1); }
    catch (e) { setSaid(e.message || "Refused."); }
  };
  const sel = { background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.sm, padding: "7px 10px", fontFamily: D.body, fontSize: "12px", color: D.textPrimary };
  const open = rows.filter((r) => !r.withdrawnAt), closed = rows.filter((r) => r.withdrawnAt);
  return (
    <Panel data-testid="passport-tab">
      <CardHead title="Passport"
        sub="A boy's cricket record stays with his school until his family names another. Only his cricket record travels: nothing medical, no files, no notes. A family can take a name back at any time."/>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
        <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} aria-label="Which player" style={sel}>
          <option value="">Which player?</option>
          {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)} aria-label="Which school" style={sel}>
          <option value="">Which school?</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Btn onClick={grant} disabled={!playerId || !schoolId}>Name this school</Btn>
      </div>
      {said && <div role="alert" style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose), marginBottom: "8px" }}>{said}</div>}
      {rows.length === 0
        ? <EmptyState icon="🛂" message="No school has been named."/>
        : [...open, ...closed].map((r) => (
          <div key={r.id} data-testid={`passport-consent-${r.id}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: `1px solid ${D.border}`, opacity: r.withdrawnAt ? 0.6 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, fontWeight: 600 }}>{r.name} → {r.toSchoolName ?? "a school"}</div>
              <div style={{ fontFamily: D.body, fontSize: "10px", color: D.textMuted }}>named {day(r.grantedAt)}{r.withdrawnAt ? ` · withdrawn ${day(r.withdrawnAt)}` : ""}</div>
            </div>
            {r.withdrawnAt
              ? <span style={{ fontFamily: D.mono, fontSize: "9px", textTransform: "uppercase", color: D.textMuted }}>withdrawn</span>
              : <Btn variant="ghost" onClick={() => withdraw(r.id)}>Withdraw</Btn>}
          </div>
        ))}
    </Panel>
  );
}

// ══════════════════════════════════════════════════════
//  SCHOOL — what is on record for each school I belong to
// ══════════════════════════════════════════════════════
// This used to draw one hard-coded institution — altitude, climate, a founding
// year — whoever was signed in, with a version number that was never true and
// an "Edit Config" button wired to nothing. Every figure here is a live row
// this person may read, per school they actually belong to.
function SchoolTab({ role, users, players, staff, coaches, canAudit }) {
  const me = profile();
  const live = signedIn();
  const sportsState = useSports();
  const sports = sportsState?.sports ?? [];
  const features = useRows("my_features", role);
  const schools = useMemo(() => {
    const m = new Map();
    for (const a of me?.assignments ?? []) if (a.school) m.set(a.school, { id: a.school, name: a.schoolName || "This school", roles: new Set() });
    for (const a of me?.assignments ?? []) if (a.school) m.get(a.school).roles.add(a.role);
    if (m.size === 0) {
      // Demonstration, or a platform-wide key: the schools are whichever ones
      // the rows this person may read belong to.
      for (const p of players) if (p.school && !m.has(p.school)) m.set(p.school, { id: p.school, name: p.schoolName || p.school, roles: new Set() });
    }
    return [...m.values()];
  }, [me, players]);
  const platformWide = (me?.assignments ?? []).some((a) => !a.school);
  const modulesOff = features.filter((f) => f.kind === "module" && !f.enabled);
  const modulesOn = features.filter((f) => f.kind === "module" && f.enabled);

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      {schools.length === 0
        ? <Panel><EmptyState icon="🏫" message={live ? "You belong to no school yet." : "Sign in to see your schools."}/></Panel>
        : schools.map((s) => {
          const at = (rows) => rows.filter((r) => r.school === s.id);
          const teams = [...new Set(at(players).map((p) => p.team).filter(Boolean))].sort();
          return (
            <Panel key={s.id}>
              <CardHead title={s.name}
                sub={s.roles.size ? `You are ${[...s.roles].map((r) => ROLES[r]?.label ?? r).join(", ")} here.` : platformWide ? "Reached through a platform-wide key." : undefined}
/>
              <MetricGroup min={130}>
                <Metric label="Players" value={at(players).length} size="sm" sub={`${teams.length} side${teams.length === 1 ? "" : "s"}`}/>
                <Metric label="Coaches" value={at(coaches).length} size="sm"/>
                <Metric label="Staff" value={at(staff).length} size="sm"/>
                <Metric label="Accounts" value={at(users).length} size="sm" sub="can sign in"/>
              </MetricGroup>
              {teams.length > 0 && (
                <div style={{ marginTop: "12px" }}>
                  <div style={{ ...EYEBROW, marginBottom: "6px" }}>Sides</div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {teams.map((t) => <Badge key={t} color={D.indigo}>{t}</Badge>)}
                  </div>
                </div>
              )}
            </Panel>
          );
        })}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "16px" }}>
        <Panel>
          <CardHead title="Sports" sub="What the platform has granted, and how much of each is in use — a sport that is on and empty is not the same as one adopted."/>
          {sports.length === 0
            ? <EmptyState icon="🏏" message={live ? "No sport has been granted." : "Sign in to see granted sports."}/>
            : sports.map((sp) => (
              <div key={sp.code} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 0", borderTop: `1px solid ${D.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, fontWeight: 600 }}>{sp.label ?? sp.code}</div>
                  <div style={MONO}>{sp.engine ? `${sp.engine} engine` : "no scoring engine"} · {sp.fixtures ?? 0} fixture{sp.fixtures === 1 ? "" : "s"}</div>
                </div>
                <Badge color={sp.enabled ? D.emerald : D.textMuted}>{sp.enabled ? "On" : "Off"}</Badge>
              </div>
            ))}
        </Panel>
        <Panel>
          <CardHead title="Modules" sub="What is switched on for you, resolved across every school you belong to: off at any of them is off. The Modules screen is where a school changes this."/>
          {features.length === 0
            ? <EmptyState icon="🧩" message={live ? "Nothing to show." : "Sign in to see your modules."}/>
            : (
              <>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: modulesOff.length ? "10px" : 0 }}>
                  {modulesOn.map((f) => <Badge key={f.key} color={D.emerald}>{f.label ?? f.key}</Badge>)}
                </div>
                {modulesOff.length > 0 && (
                  <>
                    <div style={{ ...EYEBROW, marginBottom: "6px" }}>Off</div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {modulesOff.map((f) => <Badge key={f.key} color={D.textMuted}>{f.label ?? f.key}</Badge>)}
                    </div>
                  </>
                )}
              </>
            )}
        </Panel>
      </div>

      <OpenCeiling/>

      {canAudit && <AuditSection role={role}/>}

      <Panel>
        <CardHead title="This build" sub="What is running, and where it is pointed."/>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "10px" }}>
          {[
            ["SCRBRD", `v${pkg.version}`],
            ["Data", live ? "Live — your school's database" : "Demonstration — nothing is saved"],
            ["Roles known", String(Object.values(ROLE_FAMILIES).flat().length)],
            ["Capabilities", String(new Set(Object.values(ROLE_CAPABILITIES).flat()).size)],
          ].map(([l, v]) => (
            <div key={l} style={{ padding: "8px 10px", borderRadius: D.sm, background: D.surf2 + "66", border: `1px solid ${D.border}` }}>
              <div style={EYEBROW}>{l}</div>
              <div style={{ fontFamily: D.mono, fontSize: "11px", color: D.textPrimary, marginTop: "3px" }}>{v}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// WHO READ WHAT, and who had support access. The school's own record, drawn
// for whoever holds audit.read there: the question a parent asks the office,
// and the office can now answer from this screen rather than from the
// database. The API filters every row to the reader's school.
function AuditSection({ role }) {
  const reads = useRows("access_log", role);
  const sessions = useRows("support_access", role);
  const recent = reads.slice(0, 40);
  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <Panel>
        <CardHead title="On the record: who read what"
          sub="Every read of a restricted field — a date of birth, a clinical note — and every read made from outside the school. What was actually received, not what was asked for."/>
        {recent.length === 0
          ? <EmptyState icon="📖" message="Nothing restricted has been read yet."/>
          : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: D.surf2 }}>
                  <TH>Who</TH><TH>What</TH><TH align="center">Records</TH><TH>Fields</TH><TH align="center">How</TH><TH align="center">When</TH>
                </tr></thead>
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${D.border}` }}>
                      <TD>{r.personName ?? "—"}</TD>
                      <TD mono>{r.resource}</TD>
                      <TD align="center" mono>{r.recordCount}</TD>
                      <TD mono>{(r.fields ?? []).join(", ") || "—"}</TD>
                      <TD align="center">
                        {r.supportAccessId ? <Badge color={D.amber}>Support</Badge> : r.platformWide ? <Badge color={D.violet}>Platform</Badge> : <Badge color={D.textMuted}>Own school</Badge>}
                      </TD>
                      <TD align="center" mono title={r.occurredAt ? new Date(r.occurredAt).toLocaleString() : undefined}>{ago(r.occurredAt)}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>
      <Panel>
        <CardHead title="Support access"
          sub="When the platform reached this school as one of its own roles: who, why, for how long, and who ended it. A session stops by itself within its minutes; the office can end one sooner."/>
        {sessions.length === 0
          ? <EmptyState icon="🛠️" message="No support session has reached this school."/>
          : sessions.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderTop: `1px solid ${D.border}`, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "200px" }}>
                <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textPrimary, fontWeight: 600 }}>{s.actorName ?? "Platform support"} as {ROLES[s.role]?.label ?? s.role}</div>
                <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary }}>{s.reason}</div>
                <div style={MONO}>began {ago(s.startedAt)} · {s.endedAt ? `ended ${ago(s.endedAt)}${s.endedByName ? ` by ${s.endedByName}` : ""}` : s.live ? `until ${new Date(s.expiresAt).toLocaleTimeString()}` : "expired"}</div>
              </div>
              <Badge color={s.live ? D.amber : D.textMuted}>{s.live ? "Live now" : "Over"}</Badge>
            </div>
          ))}
      </Panel>
    </div>
  );
}

// THE OPEN BAND'S CEILING. The platform's directive limits a pace bowler by
// age band and leaves Open alone: U17 and U18 play Open at school level, and
// an Open club side may field grown men. A high school may still put its own
// line under its schoolboys, and this is where it says so.
function OpenCeiling() {
  const schools = schoolsWhere("player.workload.manage");
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  const [spell, setSpell] = useState("");
  const [dayCap, setDayCap] = useState("");
  const [said, setSaid] = useState("");
  const [done, setDone] = useState("");
  if (schools.length === 0) return null;
  const save = async () => {
    setSaid(""); setDone("");
    try {
      const r = await api("/api/bowling-ceiling", { method: "POST", body: {
        schoolId,
        maxOversPerSpell: spell === "" ? null : Number(spell),
        maxOversPerDay: dayCap === "" ? null : Number(dayCap),
      } });
      setDone(`Set: ${r.maxOversPerSpell ?? "no"} per spell, ${r.maxOversPerDay ?? "no"} per day.`);
    } catch (e) { setSaid(e.message || "Refused."); }
  };
  return (
    <Panel data-testid="open-ceiling">
      <CardHead title="Open-band bowling ceiling"
        sub="The junior directives cap a pace bowler by age band. Open carries none, because U17 and U18 play Open division. A school may put its own line under them anyway. Leave a field empty to set no limit of that kind."/>
      <div style={{ maxWidth: "520px" }}>
        {schools.length > 1 && <Select label="School" value={schoolId} onChange={setSchoolId}
          options={schools.map((s) => ({ value: s.id, label: s.name }))}/>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Input label="Overs per spell" value={spell} onChange={setSpell} type="number" placeholder="e.g. 7"/>
          <Input label="Overs per day" value={dayCap} onChange={setDayCap} type="number" placeholder="e.g. 18"/>
        </div>
        {said && <div role="alert" style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.rose), marginBottom: "8px" }}>{said}</div>}
        {done && <div role="status" style={{ fontFamily: D.body, fontSize: "11px", color: textOn(D.emerald), marginBottom: "8px" }}>{done}</div>}
        <Btn size="sm" onClick={save} disabled={!schoolId || (spell === "" && dayCap === "")}>Set the ceiling</Btn>
      </div>
    </Panel>
  );
}

// ══════════════════════════════════════════════════════
//  ROADMAP — against what is actually built
const priCol = (p) => p === "high" ? D.rose : p === "medium" ? D.amber : D.sky;
const catCol = (c) => c === "AI & Analysis" ? D.violet : c === "Integrations" ? D.teal : c === "Comms" ? D.indigo : c === "Fitness" ? D.emerald : D.orange;

function RoadmapTab() {
  const [only, setOnly] = useState("");
  const counts = Object.fromEntries(["shipped", "partial", "planned"].map((s) => [s, UPGRADES.filter((u) => u.status === s).length]));
  return (
    <div>
      <Panel sx={{ marginBottom: "16px" }}>
        <CardHead title="Platform roadmap" sub="Every shipped item names the walk that covers it, and a test checks that walk exists and is registered to run — so the claim falls over in the suite rather than quietly on this page. Priority is an opinion and survives as a tint."/>
        <MetricGroup min={130}>
          {["shipped", "partial", "planned"].map((s) => (
            <button key={s} onClick={() => setOnly(only === s ? "" : s)} aria-pressed={only === s}
                    style={{ textAlign: "left", background: only === s ? STATUS_TONE[s] + "14" : "transparent", border: `1px solid ${only === s ? STATUS_TONE[s] + "55" : D.border}`, borderRadius: D.md, padding: "8px 10px", cursor: "pointer" }}>
              <Metric label={STATUS_LABEL[s]} value={counts[s]} size="sm" tone={STATUS_TONE[s]}/>
            </button>
          ))}
        </MetricGroup>
      </Panel>
      {["shipped", "partial", "planned"].filter((s) => !only || s === only).map((st) => (
        <div key={st} style={{ marginBottom: "20px" }} data-testid={`roadmap-${st}`}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
            <Badge color={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge>
            <span style={MONO}>{counts[st]} items</span>
            {st === "partial" && <span style={SUB}>— the data is built and permission-scoped; no screen reads it yet</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: "10px" }}>
            {UPGRADES.filter((u) => u.status === st).map((up) => (
              <Panel key={up.id} sx={{ padding: "14px", border: `1px solid ${STATUS_TONE[st]}22`, borderLeft: `3px solid ${priCol(up.priority)}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "6px" }}>
                  <div style={{ fontFamily: D.body, fontSize: "13px", fontWeight: 600, color: D.textPrimary, flex: 1 }}>{up.title}</div>
                  <Badge color={catCol(up.category)}>{up.category}</Badge>
                </div>
                <div style={{ fontFamily: D.body, fontSize: "11px", color: D.textSecondary, lineHeight: 1.5, marginBottom: "10px" }}>{up.desc}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <div style={MONO}>
                    {up.priority} priority · effort <span style={{ color: up.effort === "Low" ? D.emerald : up.effort === "Medium" ? D.amber : textOn(D.rose) }}>{up.effort}</span>
                  </div>
                  <span style={{ fontFamily: D.mono, fontSize: "10px", color: STATUS_TONE[st] }}>{STATUS_LABEL[st]}</span>
                </div>
              </Panel>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export { SettingsView };
