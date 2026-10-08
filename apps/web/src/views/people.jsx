import { useState } from "react";
import { ROLES } from "../design/roles.js";
import { D, textOn } from "../design/tokens.js";
import { holdsCapability } from "../rbac/index.js";
import { useLive } from "../lib/live.js";
import { signedIn } from "../lib/api.js";
import { profile, reachesEverySchool, schoolsWhere } from "../lib/session.js";
import { humanDate } from "../lib/format.js";
import { accountAction, liveRoles, matchesPerson, peopleWithRoles } from "../lib/people.js";
import { Avatar } from "../ui/primitives.jsx";
import { Icon } from "../ui/icons.jsx";
import { EnrolModal, FormBtn, IssuedCodeModal, grantableFor, issuedFrom } from "./enrol.jsx";
// SCRBRD-132 C1 (db/77): ending one appointment, with a reason, decided by the server.
import { EndRoleButton } from "./endrole.jsx";
// Account lifecycle slice 1 (db/85): disabling and enabling an account, decided by the server.
import { AccountButton } from "./accountactive.jsx";

// ══════════════════════════════════════════════════════
//  PEOPLE — Management's user list, on the real directory
//
//  One row per account, with EVERY role it holds: the `accounts` read says who
//  the accounts are, disabled ones included (account lifecycle D5: `users`
//  keeps `where active`, for the screens that pick a person to act on), and
//  the `assignments` read (withdrawn rows included on
//  purpose — it is the audit surface) says what each one holds or held. A
//  person who coaches the 1st XI and is also a parent is one account and two
//  chips; a list with one role each told the office something false.
//
//  Adding is real: "Add user" and each person's "Add role" post to
//  /api/users, the call Settings → People makes (views/enrol.jsx is the one
//  form). An email that already belongs to someone at the school gets the new
//  role on the existing account — that is how a person gets a second role.
//
//  Ending a role is real (db/77, endrole.jsx), and so are Disable account and
//  Enable account (db/85, accountactive.jsx): disabling signs the person out
//  of every device and stops them signing in, and keeps every role. Each is
//  offered only where the server would allow it (lib/people.js
//  accountAction(), db/81's rule) and decided again by the server, whose
//  refusal is shown in its own words. A disabled account stays on the list,
//  marked "Disabled" in words, with the day it changed for the office and its
//  auditors (slice 2, db/90). Each act asks for a reason, and a disable first
//  says what the account has open (accountactive.jsx, the preview).
//
//  Nobody signed in (the demonstration): the seeded directory is read, one
//  role each, and nothing is offered that would write.
//
//  Floors: text is 12px or more, anything tapped is 44px or more, and nothing
//  is said by colour alone — an ended role says "ended" in words and is drawn
//  dashed, a paused one says "paused".
// ══════════════════════════════════════════════════════

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toLocaleDateString("en-CA");   // YYYY-MM-DD, the reader's own day

const ctl = () => ({ minHeight: "44px", boxSizing: "border-box", padding: "10px 14px", borderRadius: D.pill,
  background: D.surf2, border: `1px solid ${D.border}`, fontFamily: D.body, fontSize: "14px", color: D.textPrimary });

// Roles that are, by construction, about the account-holder's own record
// (decide_role_request writes selfaccess with relationship 'self'). Display only.
const OWN_RECORD = new Set(["selfaccess"]);

/** A role held (or once held), with its side and, if it is not live, the word for why not. */
function RoleChip({ r, person, linkedName }) {
  const meta = ROLES[r.role];
  const label = meta?.label ?? r.role;
  const off = r.state === "ended";
  const colour = off ? D.textMuted : textOn(meta?.color ?? D.indigo);
  // The side, where the appointment names one. A pupil's own-record access is
  // his own; a guardian's child is not in either read, so none is invented.
  const scope = r.team ?? (OWN_RECORD.has(r.role) && (person.player || linkedName) ? "own record" : null);
  const note = r.state === "ended" ? `ended${r.endedOn ? ` ${humanDate(r.endedOn)}` : ""}`
    : r.state === "paused" ? "paused"
    : r.state === "upcoming" ? `starts ${humanDate(r.from)}` : null;
  return (
    <li data-testid="role-chip" data-role={r.role} data-state={r.state}
        style={{ listStyle: "none", display: "inline-flex", alignItems: "center", gap: "6px", padding: "5px 12px",
                 borderRadius: D.pill, fontFamily: D.body, fontSize: "13px", fontWeight: off ? 400 : 600, color: colour,
                 background: off ? "transparent" : (meta?.color ?? D.indigo) + "18",
                 border: `1px ${off ? "dashed" : "solid"} ${off ? D.border : (meta?.color ?? D.indigo) + "55"}` }}>
      <span aria-hidden="true" style={{ display: "inline-flex" }}><Icon name={meta?.icon || "user"}/></span>
      <span>{label}</span>
      {scope && <span style={{ fontFamily: D.mono, fontWeight: 400 }}>· {scope}</span>}
      {note && <span style={{ fontWeight: 700, fontStyle: off ? "italic" : "normal" }}>· {note}</span>}
    </li>
  );
}

/** The reader's own day an account changed state (YYYY-MM-DD), or null. */
function changedDay(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-CA");
}

function lastSeen(v) {
  if (!v) return "Never signed in";
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `Last signed in ${humanDate(s.slice(0, 10))}` : `Last signed in ${s}`;
}

export function PeoplePanel({ role, players, onDirectoryChanged }) {
  const live = signedIn();
  // Bumped after a write, so the list re-reads instead of showing the roster as it was.
  const [nonce, setNonce] = useState(0);
  const accounts = useLive("accounts", role, nonce);
  const appointments = useLive("assignments", role, nonce);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // null | { kind: "user" } | { kind: "role", person }
  const [dialog, setDialog] = useState(null);
  const [issued, setIssued] = useState(null);
  const [notice, setNotice] = useState(null);

  // WHAT THIS READER MAY DO, by the capability and never by a role's name. The
  // server decides again on every post; this decides what to offer.
  const canAssign = holdsCapability(role, "user.role.assign");
  const schools = schoolsWhere("user.role.assign");
  // The platform account and the owner's key assign from an assignment that
  // names no school, which reaches every school (lib/session.js). Counting only
  // named schools left both with nothing offered here at all.
  const everywhere = reachesEverySchool("user.role.assign");
  const canWrite = live && canAssign && (everywhere || schools.length > 0) && grantableFor(role).length > 0;
  // A role is added at the person's own school, and only where this reader may
  // assign. An account with no school (the platform's own) is not a school's to add to.
  const mayAddTo = (p) => canWrite && !!p.school && (everywhere || schools.some((s) => s.id === p.school));
  // Disable or Enable: drawn only where db/81's rule would let this reader act
  // (lib/people.js accountAction()); the server asks it again on every post.
  const me = live ? profile() : null;
  const accountChanged = (p, active) => {
    setNotice(active
      ? `Enabled ${p.name}'s account. They can sign in again; each device signs in afresh. They are told it was re-enabled, not why.`
      : `Disabled ${p.name}'s account. They are signed out of every device and cannot sign in. Their roles stay.`);
    setNonce((n) => n + 1);
    onDirectoryChanged?.();
  };

  const people = peopleWithRoles(accounts.rows, appointments.rows, today());
  const linkedName = (p) => (p.player ? players.find((x) => x.id === p.player)?.name ?? null : null);
  const label = (r) => ROLES[r]?.label ?? r;
  const shown = people.filter((p) => matchesPerson(p, { role: roleFilter, status: statusFilter, q }, { label, linked: linkedName }));
  const rolesPresent = [...new Set(people.flatMap((p) => p.roles.map((r) => r.role)))].sort((a, b) => label(a).localeCompare(label(b)));

  const loading = accounts.loading || appointments.loading;
  // The assignments read failing must not look like nobody holding anything.
  const partial = live && !accounts.error && !!appointments.error;

  const enrolled = ({ out, name, role: granted, team }) => {
    const person = dialog?.person;
    setDialog(null);
    setIssued(issuedFrom(out, name));
    setNotice(person
      ? `Added ${label(granted)}${team ? ` (${team})` : ""} to ${name}'s account.`
      : `Opened an account for ${name} as ${label(granted)}${team ? ` (${team})` : ""}.`);
    setNonce((n) => n + 1);
    onDirectoryChanged?.();
  };

  const stats = [
    { label: "People", value: people.length },
    { label: "Active", value: people.filter((p) => p.status === "active").length },
    { label: "Disabled", value: people.filter((p) => p.status !== "active").length },
    { label: "With more than one role", value: people.filter((p) => liveRoles(p).length > 1).length },
    { label: "Showing", value: shown.length },
  ];

  return (
    <div data-testid="people-panel" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, role or side…" aria-label="Search people"
               data-testid="people-search" style={{ ...ctl(), flex: "1 1 220px", minWidth: "180px" }}/>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role"
                data-testid="people-role-filter" style={ctl()}>
          <option value="all">All roles</option>
          {rolesPresent.map((r) => <option key={r} value={r}>{label(r)}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status"
                data-testid="people-status-filter" style={ctl()}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Disabled</option>
        </select>
        {canWrite && <FormBtn data-testid="add-user" onClick={() => { setNotice(null); setDialog({ kind: "user" }); }}>Add user</FormBtn>}
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {stats.map((s) => (
          <div key={s.label} style={{ padding: "10px 16px", borderRadius: D.md, background: D.surf1, border: `1px solid ${D.border}`,
                                      display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontFamily: D.mono, fontSize: "20px", fontWeight: 700, color: D.textPrimary }}>{s.value}</span>
            <span style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted }}>{s.label}</span>
          </div>
        ))}
      </div>

      {notice && (
        <div role="status" data-testid="people-notice" style={{ padding: "10px 14px", borderRadius: D.md, background: D.emerald + "14",
          border: `1px solid ${D.emerald}44`, fontFamily: D.body, fontSize: "13px", color: D.textPrimary }}>{notice}</div>
      )}
      {partial && (
        <div role="alert" data-testid="people-partial" style={{ padding: "10px 14px", borderRadius: D.md, background: D.amber + "14",
          border: `1px solid ${D.amber}44`, fontFamily: D.body, fontSize: "13px", color: D.textPrimary }}>
          The roles each person holds could not be read just now, so each account shows only the role it was opened with.
        </div>
      )}

      <ul data-testid="people-list" aria-label="People and their roles" style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column",
        borderRadius: D.lg, border: `1px solid ${D.border}`, background: D.surf1, overflow: "hidden" }}>
        {loading && <li style={{ listStyle: "none", padding: "24px", textAlign: "center", fontFamily: D.body, fontSize: "13px", color: D.textMuted }}>Loading…</li>}
        {!loading && accounts.error && (
          <li style={{ listStyle: "none", padding: "24px", textAlign: "center", fontFamily: D.body, fontSize: "13px", color: D.roseText }}>
            The list could not be read — the server did not answer. This is not the same as there being nobody.
          </li>
        )}
        {!loading && !accounts.error && shown.length === 0 && (
          <li style={{ listStyle: "none", padding: "24px", textAlign: "center", fontFamily: D.body, fontSize: "13px", color: D.textMuted }}>
            {people.length ? "No one matches the current filter." : "No one is on the list yet."}
          </li>
        )}
        {!loading && shown.map((p, i) => (
          <li key={p.id} data-testid={`person-row-${p.id}`} data-email={p.email} data-status={p.status}
              style={{ listStyle: "none", display: "flex", gap: "14px", alignItems: "flex-start", flexWrap: "wrap",
                       padding: "14px 16px", borderTop: i ? `1px solid ${D.border}` : "none" }}>
            <Avatar name={p.name} size={40} color={p.status === "active" ? (ROLES[liveRoles(p)[0]?.role ?? p.role]?.color ?? D.indigo) : D.textMuted}/>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontFamily: D.body, fontSize: "15px", fontWeight: 600, color: p.status === "active" ? D.textPrimary : D.textMuted }}>{p.name}</div>
              <div style={{ fontFamily: D.mono, fontSize: "13px", color: D.textMuted, overflowWrap: "anywhere" }}>{p.email}</div>
              <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted, marginTop: "2px" }}>
                {/* The state in words, never by colour alone: a disabled account
                    cannot sign in, and keeps every role it holds. */}
                {p.status === "active" ? "Active" : (
                  <>
                    <span data-testid="account-disabled" style={{ fontWeight: 700, color: D.textPrimary }}>Disabled</span>
                    {/* When, from account_status_change (db/90): the office and its
                        auditors read it; a reader with user.read alone gets no date. */}
                    {changedDay(p.statusChangedAt) && (
                      <span data-testid="account-disabled-on"> {humanDate(changedDay(p.statusChangedAt))}, by the office</span>
                    )}
                  </>
                )}
                {" · "}{lastSeen(p.lastLogin)}
                {linkedName(p) ? ` · account for ${linkedName(p)}` : ""}
              </div>
            </div>
            <ul aria-label={`Roles held by ${p.name}`} style={{ flex: "2 1 260px", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
              {p.roles.map((r) => <RoleChip key={r.key} r={r} person={p} linkedName={linkedName(p)}/>)}
            </ul>
            {/* End a role (db/77): offered beside each live appointment at a school
                this reader may assign at. role_assignment_end() decides the rest
                (the owner's key, a superadmin's roles, your own last admin role,
                your own DSO appointment, a child's last verified guardian) and
                its words are shown as they come. A role known only from the
                account (no appointment row) has nothing to end. */}
            {mayAddTo(p) && p.roles.some((r) => r.state === "live" && UUID.test(r.key)) && (
              <div data-testid={`end-roles-${p.id}`} style={{ display: "flex", flexWrap: "wrap", gap: "6px", flex: "1 1 100%" }}>
                {p.roles.filter((r) => r.state === "live" && UUID.test(r.key)).map((r) => (
                  <EndRoleButton key={r.key}
                    assignment={{ id: r.key, role: r.role, team_code: r.team, person_name: p.name, active: true }}
                    onEnded={() => { setNotice(`Ended ${label(r.role)}${r.team ? ` (${r.team})` : ""} for ${p.name}.`); setNonce((n) => n + 1); onDirectoryChanged?.(); }}/>
                ))}
              </div>
            )}
            {mayAddTo(p) && (
              <FormBtn variant="ghost" data-testid={`add-role-${p.id}`} aria-label={`Add a role for ${p.name}`}
                       onClick={() => { setNotice(null); setDialog({ kind: "role", person: p }); }}>Add role</FormBtn>
            )}
            <AccountButton person={p} action={live ? accountAction(p, me) : null}
                           onChanged={(active) => accountChanged(p, active)}/>
          </li>
        ))}
      </ul>

      {!live && (
        <p data-testid="people-demo" style={{ margin: 0, fontFamily: D.body, fontSize: "13px", color: D.textMuted }}>
          This is the demonstration directory, one role each. Sign in to see everyone's roles and to add people or roles.
        </p>
      )}
      {live && !canWrite && (
        <p data-testid="people-readonly" style={{ margin: 0, fontFamily: D.body, fontSize: "13px", color: D.textMuted }}>
          You can see who holds which roles. Adding people or roles needs permission to assign roles at a school.
        </p>
      )}

      {dialog?.kind === "user" && (
        <EnrolModal role={role} players={players} title="Add user" submitLabel="Add user" codeByDefault={true}
                    onClose={() => setDialog(null)} onEnrolled={enrolled}
                    intro="This opens a real account. If the email already belongs to someone at your school, the role is added to their account instead. There is no email yet — ask for a sign-in code and hand it over in person."/>
      )}
      {dialog?.kind === "role" && (
        <EnrolModal role={role} players={players} title={`Add a role for ${dialog.person.name}`} submitLabel="Add role" codeByDefault={false}
                    fixed={{ name: dialog.person.name, email: dialog.person.email, school: dialog.person.school }}
                    intro={`This adds a role to ${dialog.person.name}'s existing account. Their name and email stay as they are.`}
                    onClose={() => setDialog(null)} onEnrolled={enrolled}/>
      )}
      {issued && <IssuedCodeModal issued={issued} onClose={() => setIssued(null)}/>}
    </div>
  );
}
