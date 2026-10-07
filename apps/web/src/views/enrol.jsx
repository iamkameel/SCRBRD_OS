import { useId, useState } from "react";
import { GRANTABLE_ROLES, SUBJECT_SCOPED_ROLES, TEAM_SCOPED_ROLES } from "@scrbrd/policy/roles";
import { compareTeams, teamsForLevel } from "@scrbrd/policy/teams";
import { ROLES, canonicalRole } from "../design/roles.js";
import { D, T } from "../design/tokens.js";
import { Modal } from "../ui/primitives.jsx";
import { api } from "../lib/api.js";
import { schoolsWhere } from "../lib/session.js";

// ══════════════════════════════════════════════════════
//  ENROLMENT, SHARED
//
//  Settings → People and the Management screen both open an account (or add a
//  role to one) through the SAME call: POST /api/users, over enrol_person().
//  The form, the words for its refusals and the one-time code card live here
//  so the two screens cannot drift into two forms that mean different things.
//
//  The server decides everything — whether this caller may, whether the role
//  is one they can grant, whether the email already belongs to someone. The
//  role picker offers only what GRANTABLE_ROLES gives the caller's role, which
//  is presentation: a role left off the list is a role they cannot ask for by
//  accident, and the server refuses it regardless.
//
//  The type and touch floors (12px, 44px) are this file's own: the shared
//  Input/Select primitives are 10px labels on ~36px fields, and moving them
//  would move every screen that uses them.
// ══════════════════════════════════════════════════════

/**
 * Said in the office's words, not the database's. A code with no entry here is
 * NOT shown as itself — a person reading `check_violation` learns nothing —
 * the fallback says plainly that nothing was saved.
 */
export const ENROL_MESSAGE = {
  not_permitted: "You may not do that here. Either you cannot open accounts at this school, or that role is not one you may grant.",
  email_invalid: "That email address is not a valid one.",
  name_required: "A full name is needed.",
  school_required: "Choose the school this account is opened at.",
  role_invalid: "Choose a role.",
  player_required: "Choose the person on the roster this account is for.",
  player_invalid: "Choose the person from the list.",
  no_such_player: "That person is not on the roster.",
  player_not_at_that_school: "That person is on another school's roster.",
  player_already_has_an_account: "That person already has an account. Look for them in the list.",
  email_belongs_to_another_school: "That email address already belongs to an account at another school.",
  player_is_an_adult: "Guardian access ends at eighteen, and this person has turned eighteen.",
  player_date_of_birth_required: "Capture this person's date of birth first — guardian access is worked out from it.",
  team_required: "Choose the side this person coaches or manages.",
  team_code_invalid: "That is not a side this platform knows.",
  platform_role_needs_no_school: "That role belongs to no school, so it cannot be given at one.",
  not_requestable: "That role cannot be given this way.",
  already_pending: "A request for this is already waiting for an answer.",
  already_decided: "That request has already been answered.",
  no_result: "The server could not finish this. Nothing was changed.",
  refused: "The server refused this and did not say why. Nothing was changed.",
  missing_token: "You are not signed in.",
};
const UNSAID = "This was not saved. The server refused it for a reason that has no words yet, and nothing was changed.";
/** The words for a refusal code; a sentence even for a code nobody has written one for. */
export const enrolWords = (code) => ENROL_MESSAGE[code] || UNSAID;

/** The roles this role may grant, from the policy's own table. */
export const grantableFor = (role) => GRANTABLE_ROLES[canonicalRole(role)] ?? [];

// The pupil's own account: a team role that is also a person on the roster.
const PUPIL_ROLES = ["player"];

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ── Small fields at the floors ─────────────────────────
const labelStyle = () => ({ display: "block", fontFamily: D.head, fontSize: "12px", fontWeight: 700,
  color: D.textSecondary, letterSpacing: "0.02em", marginBottom: "6px" });
const fieldStyle = () => ({ width: "100%", minHeight: "44px", boxSizing: "border-box", padding: "10px 12px",
  background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.md, color: D.textPrimary,
  fontFamily: D.body, fontSize: "14px" });

function TextField({ label, value, onChange, type = "text", placeholder, readOnly, ...rest }) {
  const id = useId();
  return (
    <div style={{ marginBottom: "14px" }}>
      <label htmlFor={id} style={labelStyle()}>{label}</label>
      <input id={id} type={type} value={value} placeholder={placeholder} readOnly={readOnly}
             aria-readonly={readOnly || undefined}
             onChange={(e) => onChange?.(e.target.value)} {...rest}
             style={{ ...fieldStyle(), ...(readOnly ? { background: "transparent", borderStyle: "dashed", color: D.textSecondary } : {}) }}/>
    </div>
  );
}

function SelectField({ label, value, onChange, options, ...rest }) {
  const id = useId();
  return (
    <div style={{ marginBottom: "14px" }}>
      <label htmlFor={id} style={labelStyle()}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} style={fieldStyle()}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** A button at the 44px floor, in the shared pill language. */
export function FormBtn({ children, variant = "primary", style, ...rest }) {
  const primary = variant === "primary";
  return (
    <button className="pressBtn" {...rest} style={{ minHeight: "44px", padding: "10px 20px", borderRadius: D.pill,
      border: `1px solid ${primary ? "transparent" : D.border}`, background: primary ? D.gradMain : "transparent",
      color: primary ? T.light.ink : D.textSecondary, fontFamily: D.head, fontSize: "13px", fontWeight: 700,
      letterSpacing: "0.02em", cursor: rest.disabled ? "not-allowed" : "pointer", opacity: rest.disabled ? 0.45 : 1, ...style }}>
      {children}
    </button>
  );
}

/**
 * The enrolment form, in a dialog.
 *
 *   role        the CALLER's role — decides what the picker offers
 *   players     the roster this caller can read (the "who is it for" choices)
 *   accountless the part of it with no account yet; a pupil's own account is
 *               for one of these. Omit to offer the whole roster.
 *   initial     { name, email, role, player } to start from
 *   fixed       { name, email, school } — the person already has an account;
 *               the form shows both and will not change them, and the role is
 *               added to that account (the server finds it by the email)
 *   onEnrolled  ({ out, name }) once the server has said yes
 *
 * `fixed.school` is where the role is added. Otherwise the school is the one
 * the caller holds user.role.assign at — a choice only if there is more than one.
 */
export function EnrolModal({ role, players = [], accountless, initial = {}, fixed = null, title = "Enrol a person",
                             intro, submitLabel = "Enrol", codeByDefault = true, onClose, onEnrolled }) {
  const grantable = grantableFor(role);
  const schools = schoolsWhere("user.role.assign");
  const [school, setSchool] = useState(fixed?.school ?? null);
  const schoolId = fixed?.school || school || schools[0]?.id || null;
  const [f, setF] = useState({
    name: fixed?.name ?? initial.name ?? "",
    email: fixed?.email ?? initial.email ?? "",
    role: grantable.includes(initial.role) ? initial.role : "",
    player: initial.player ?? "",
    team: "",
    withCode: codeByDefault,
  });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const teamScoped = TEAM_SCOPED_ROLES.includes(f.role);
  // Which roles name a person. A guardian's, a pupil's own-record access and an
  // enquiry's are about a child (the policy's list); a pupil's own account is
  // for one more — the pupil — and a pupil's account is one per child, so it is
  // offered only the roster people who have none yet.
  const forChild = SUBJECT_SCOPED_ROLES.includes(f.role);
  const subjectScoped = forChild || PUPIL_ROLES.includes(f.role);
  const teams = [...new Set([...teamsForLevel("school"), ...players.map((p) => p.team).filter(Boolean)])].sort(compareTeams);
  const choices = forChild ? players : (accountless ?? players);
  const linked = players.find((p) => p.id === f.player) || null;

  const ready = !!schoolId && f.name.trim().length >= 2 && EMAIL.test(f.email.trim()) && !!f.role
    && (!teamScoped || !!f.team) && (!subjectScoped || !!f.player);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const out = await api("/api/users", { method: "POST", body: {
        email: f.email.trim(),
        name: f.name.trim(),
        role: f.role,
        schoolId,
        // A coach's side is the one chosen; a pupil's is his own. A guardian's
        // reach is the child she answers for, not his side, so none is sent.
        teamCode: (teamScoped ? f.team : subjectScoped && !forChild ? linked?.team : "") || undefined,
        playerId: subjectScoped && f.player ? f.player : undefined,
        withCode: f.withCode === true,
      } });
      await onEnrolled?.({ out, name: f.name.trim(), role: f.role, team: teamScoped ? f.team : null });
    } catch (e) {
      setError(e?.code || "unsaid");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted, lineHeight: 1.5, marginBottom: "14px" }}>
        {intro ?? "This opens a real account and links it to their record. There is no email yet — ask for a sign-in code and hand it over in person."}
      </div>
      {!fixed && schools.length > 1 && (
        <SelectField label="School" value={schoolId || ""} onChange={setSchool}
                     options={schools.map((sc) => ({ value: sc.id, label: sc.name }))}/>
      )}
      <TextField label="Full name" value={f.name} onChange={set("name")} placeholder="First Last" readOnly={!!fixed}
                 data-testid="enrol-name" autoComplete="off"/>
      <TextField label="Email" value={f.email} onChange={set("email")} type="email" placeholder="name@school.co.za"
                 readOnly={!!fixed} data-testid="enrol-email" autoComplete="off"/>
      <SelectField label="Role" value={f.role} onChange={(v) => setF((p) => ({ ...p, role: v, player: "", team: "" }))}
                   data-testid="enrol-role"
                   options={[{ value: "", label: "Choose a role…" },
                             ...grantable.map((v) => ({ value: v, label: ROLES[v]?.label ?? v }))]}/>
      {teamScoped && (
        <SelectField label="Which side" value={f.team} onChange={set("team")} data-testid="enrol-team"
                     options={[{ value: "", label: "Choose a side…" }, ...teams.map((t) => ({ value: t, label: t }))]}/>
      )}
      {subjectScoped && (
        <SelectField label={forChild ? "Which child" : "Who this account is for"} value={f.player}
                     onChange={(v) => setF((p) => ({ ...p, player: v, name: p.name || choices.find((x) => x.id === v)?.name || "" }))}
                     data-testid="enrol-player"
                     options={[{ value: "", label: "Choose from the roster…" },
                               ...choices.map((p) => ({ value: p.id, label: `${p.name} (${p.team})` }))]}/>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "44px", cursor: "pointer",
                      fontFamily: D.body, fontSize: "13px", color: D.textSecondary }}>
        <input type="checkbox" checked={f.withCode === true} data-testid="enrol-code"
               onChange={(e) => set("withCode")(e.target.checked)}
               style={{ width: "20px", height: "20px", flexShrink: 0 }}/>
        Issue a sign-in code now
      </label>
      {error && (
        <div data-testid="enrol-error" data-code={error} role="alert" style={{ marginTop: "10px", padding: "10px 12px", borderRadius: D.sm,
          background: D.rose + "14", border: `1px solid ${D.rose}33`, fontFamily: D.body, fontSize: "13px", color: D.roseText }}>
          {enrolWords(error)}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap", marginTop: "14px" }}>
        <FormBtn variant="ghost" onClick={onClose}>Cancel</FormBtn>
        <FormBtn data-testid="enrol-submit" onClick={submit} disabled={busy || !ready}>{busy ? "Saving…" : submitLabel}</FormBtn>
      </div>
    </Modal>
  );
}

/**
 * THE CODE, ONCE. login_code_issue() stores a hash; the readable code exists
 * in the response that carried it and nowhere else, ever again.
 */
export function IssuedCodeModal({ issued, onClose }) {
  return (
    <Modal title={issued.code ? "Sign-in code" : "Account opened"} onClose={onClose}>
      {issued.code ? (
        <>
          <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textSecondary, lineHeight: 1.6, marginBottom: "10px" }}>
            <strong style={{ color: D.textPrimary }}>{issued.name}</strong> now has an account.
            Write this code down and hand it over — it is shown once and cannot be read again.
          </div>
          <div data-testid="issued-code" style={{ fontFamily: D.mono, fontSize: "22px", letterSpacing: "0.18em",
            textAlign: "center", padding: "14px", borderRadius: D.sm, color: D.textPrimary,
            background: D.emerald + "14", border: `1px solid ${D.emerald}44` }}>{issued.code}</div>
          {issued.expiresAt && (
            <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted, marginTop: "8px", textAlign: "center" }}>
              Expires {new Date(issued.expiresAt).toLocaleString()}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontFamily: D.body, fontSize: "13px", color: D.textSecondary, lineHeight: 1.6 }}>
          <strong style={{ color: D.textPrimary }}>{issued.name}</strong> now has an account, but no
          sign-in code could be issued ({issued.error}). The account is real — issue a code from
          this screen when you are ready.
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "14px" }}>
        <FormBtn onClick={onClose}>Done</FormBtn>
      </div>
    </Modal>
  );
}

/** The issued-code card's content from an enrolment's answer, or null when none was asked for. */
export function issuedFrom(out, name) {
  if (out?.code) return { code: out.code, expiresAt: out.expiresAt, name };
  if (out?.codeError) return { code: null, error: out.codeError, name };
  return null;
}
