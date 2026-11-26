/**
 * Edit Profile, on the Squad screen's player panel.
 *
 * It offers ONLY what a route exists to change, each under the capability the
 * route's own policy asks for (the server decides again; this only keeps from
 * drawing a control the person could never use):
 *
 *   - which side he plays for     POST /api/players/:id/team
 *   - a missing date of birth     POST /api/players/:id/date-of-birth
 *                                 (writes only where there is none)
 *   - correcting a recorded one   POST /api/players/:id/date-of-birth/correction
 *                                 and GET …/date-of-birth/changes: the school
 *                                 office only, every change recorded (db/172)
 *   - who to ring in an emergency POST /api/players/:id/emergency-contacts
 *   - his name on public pages    POST /api/players/:id/public-name (the office,
 *                                 on a guardian's word or form) and
 *                                 …/never-public (the mark): publicname.jsx
 *   - a parent's link to him      POST /api/players/:id/guardians/verify and
 *                                 …/consent, under guardian.link.manage:
 *                                 guardianlink.jsx
 *   - every link, and ending one    GET /api/read/child_links, POST
 *                                 …/guardians/:link/revoke, under
 *                                 user.role.assign or guardian.link.manage:
 *                                 familylinks.jsx (db/109)
 *   - his own sign-in              GET/POST /api/players/:id/own-signin[/office],
 *                                 under guardian.link.manage: the form on
 *                                 file (who signed it, when), a withdrawal,
 *                                 or opening him now: ownsignin.jsx (db/169)
 *
 * Name, squad number, playing role and the rest have no route, so they have no
 * field here. The first two need player.profile.manage, the third
 * player.emergency.manage, and the public-name section guardian.link.manage
 * or player.public.withhold (it draws only what its read returns). A
 * demonstration offers no writes at all.
 *
 * Floors: nothing read under 12px, nothing pressed under 44px.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { D, T, inkOn, textOn } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { useRows } from "../lib/live.js";
import { holdsCapability } from "../rbac/index.js";
import { resolveBirthDate, BIRTH_DATE_MESSAGE, BORN_LINKS_NOTE, bornLinkWords } from "@scrbrd/policy/date-of-birth";
import { compareTeams, teamLabel, teamsForLevel } from "@scrbrd/policy/teams";
import { WhoToRing } from "./family/childfile.jsx";
import { PublicNameStaff } from "./publicname.jsx";
import { GuardianLinks } from "./guardianlink.jsx";
import { FamilyLinks, mayFamilyLinks } from "./familylinks.jsx";
import { OfficeOwnSignIn } from "./ownsignin.jsx";
import { holds } from "../lib/family.js";

/** Does this person hold anything Edit Profile could offer? Signed out: nothing. */
export function mayEditProfile(role) {
  return signedIn() && (holdsCapability(role, "player.profile.manage") || holdsCapability(role, "player.emergency.manage")
    || mayPublicName(role) || mayFamilyLinks(role));
}

/** The public-name section: a guardian's answer recorded by the office, or the never-public mark. */
function mayPublicName(role) {
  return holds(role, "guardian.link.manage") || holds(role, "player.public.withhold");
}

const SAY = {
  not_permitted: "You may not change this player's record.",
  team_required: "Choose a side.",
  effective_on_invalid: "That date is not a date.",
  effective_on_in_future: "A move cannot be dated in the future.",
  born_required: "Give a date of birth.",
  not_found: "That player is not on record.",
};
const words = (e) => e?.detail || SAY[e?.code] || BIRTH_DATE_MESSAGE[e?.code] || "The change was refused.";

const heading = () => ({ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 6px" });
const field = () => ({ width: "100%", minHeight: "44px", padding: "9px 12px", background: D.surf2, boxSizing: "border-box",
  border: `1px solid ${D.border}`, borderRadius: D.md, color: D.textPrimary, fontFamily: D.body, fontSize: T.role.control.fontSize });
const note = (bad) => ({ fontFamily: D.body, fontSize: "12px", margin: "6px 0 0", color: bad ? textOn(D.rose) : D.textSecondary });

function Go({ children, disabled, onClick, testid }) {
  return (
    <button type="button" className="pressBtn" disabled={disabled} onClick={onClick} data-testid={testid}
      style={{ minHeight: "44px", padding: "8px 16px", borderRadius: D.pill, cursor: disabled ? "not-allowed" : "pointer",
        background: D.sky, border: "1px solid transparent", color: inkOn(D.sky),
        fontFamily: D.head, fontSize: "12px", fontWeight: 700, opacity: disabled ? 0.45 : 1, marginTop: "8px" }}>{children}</button>
  );
}

/** @param {{ role: string, player: { id: string, name: string, team: string, born?: string|null }, teams: string[], onMoved: (team: string) => void }} props */
export function EditProfile({ role, player, teams, onMoved }) {
  const mayManage = holdsCapability(role, "player.profile.manage");
  const mayContacts = holdsCapability(role, "player.emergency.manage");
  return (
    <div data-testid="edit-profile" style={{ display: "grid", gap: "16px", marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${D.border}` }}>
      {mayManage && <MoveSide player={player} teams={teams} onMoved={onMoved}/>}
      {mayManage && <CaptureBirthday role={role} player={player}/>}
      {mayCorrectBirthday(role) && <CorrectBirthday player={player}/>}
      {mayContacts && (
        <div data-testid="edit-contacts">
          <p style={heading()}>Who to ring</p>
          <WhoToRing child={{ id: player.id, name: player.name }} role={role}/>
        </div>
      )}
      {mayFamilyLinks(role) && <FamilyLinks role={role} player={player}/>}
      {holdsCapability(role, "guardian.link.manage") && <GuardianLinks role={role} player={player}/>}
      {holdsCapability(role, "guardian.link.manage") && <OfficeOwnSignIn player={player}/>}
      {mayPublicName(role) && <PublicNameStaff player={player}/>}
    </div>
  );
}

function MoveSide({ player, teams, onMoved }) {
  const id = useId();
  const [to, setTo] = useState(player.team);
  const [said, setSaid] = useState({ text: "", bad: false });
  const [busy, setBusy] = useState(false);
  const options = useMemo(
    () => [...new Set([...teamsForLevel("school"), ...teams, player.team])].filter(Boolean).sort(compareTeams),
    [teams, player.team]);
  const move = async () => {
    setBusy(true); setSaid({ text: "", bad: false });
    try {
      await api(`/api/players/${player.id}/team`, { method: "POST", body: { teamCode: to } });
      onMoved(to);
    } catch (e) { setSaid({ text: words(e), bad: true }); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid="edit-side">
      <label htmlFor={id} style={heading()}>Side</label>
      <select id={id} value={to} onChange={(e) => setTo(e.target.value)} style={field()} data-testid="edit-side-select">
        {options.map((c) => <option key={c} value={c}>{teamLabel(c)}</option>)}
      </select>
      <Go disabled={busy || to === player.team} onClick={move} testid="edit-side-save">Move him</Go>
      {said.text && <p role="alert" style={note(said.bad)}>{said.text}</p>}
    </div>
  );
}

/**
 * Only for a boy the school's own gaps list says has no birthday: the route
 * writes only where there is none, and correcting a wrong one is a larger
 * decision it keeps out of reach on purpose.
 */
function CaptureBirthday({ role, player }) {
  const [nonce, setNonce] = useState(0);
  const gaps = useRows("dob_gaps", role, nonce);
  const [v, setV] = useState({ born: "", idNumber: "" });
  const [said, setSaid] = useState({ text: "", bad: false });
  const [busy, setBusy] = useState(false);
  const idBorn = useId(), idNo = useId();
  const missing = gaps.some((g) => g.kind === "no_dob" && g.playerId === player.id);
  // An ID number, first or not, is the office's to write (db/173): the field
  // is the office's alone, and the server refuses it from anyone else.
  const office = mayCorrectBirthday(role);
  if (!missing) return null;
  const check = (v.born || v.idNumber) ? resolveBirthDate({ born: v.born, idNumber: v.idNumber }) : null;
  const save = async () => {
    setBusy(true); setSaid({ text: "", bad: false });
    try {
      await api(`/api/players/${player.id}/date-of-birth`, { method: "POST", body: { born: v.born || undefined, idNumber: v.idNumber || undefined } });
      setV({ born: "", idNumber: "" }); setNonce((n) => n + 1);
      setSaid({ text: "Date of birth recorded.", bad: false });
    } catch (e) { setSaid({ text: words(e), bad: true }); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid="edit-dob">
      <p style={heading()}>Date of birth</p>
      <p style={note(false)}>None is on record for {player.name}.</p>
      <label htmlFor={idBorn} style={{ ...note(false), display: "block" }}>Date of birth</label>
      <input id={idBorn} type="date" value={v.born} onChange={(e) => setV((x) => ({ ...x, born: e.target.value }))} style={field()} data-testid="edit-dob-born"/>
      {office && <>
        <label htmlFor={idNo} style={{ ...note(false), display: "block" }}>ID number (or use the date above)</label>
        <input id={idNo} value={v.idNumber} onChange={(e) => setV((x) => ({ ...x, idNumber: e.target.value }))} style={field()} placeholder="13 digits"/>
      </>}
      {check && check.ok === false && <p role="alert" style={note(true)}>{BIRTH_DATE_MESSAGE[check.reason] || check.reason}</p>}
      <Go disabled={busy || !check?.ok} onClick={save} testid="edit-dob-save">Record it</Go>
      {said.text && <p role={said.bad ? "alert" : "status"} style={note(said.bad)}>{said.text}</p>}
    </div>
  );
}

/**
 * The school office's three capabilities together (db/172's
 * player_born_office(), which the server asks again): the principal, the
 * director of sport and the sports administrator each lack one of them.
 */
export function mayCorrectBirthday(role) {
  return signedIn() && ["player.profile.manage", "player.identity.read", "guardian.link.manage"]
    .every((c) => holdsCapability(role, c));
}

/** The school's day (Johannesburg), yyyy-mm-dd. */
const todayIso = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10);

/** How a change came about, in the office's words. */
const HOW = { capture: "recorded", correction: "corrected", import: "from a roster import", owner: "by SCRBRD" };
const day = (iso) => {
  const d = iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "none";
};
const when = (ts) => {
  const d = ts ? new Date(ts) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" }) : "";
};

/**
 * Correcting a date of birth already on record: the office only, and every
 * change is kept, before and after, who and when (Kameel, 20 Nov 2026). The
 * server refuses a date that disagrees with the ID number on his record; a
 * boy with no date at all is CaptureBirthday's above. Draws nothing for a
 * person the server does not answer.
 */
function CorrectBirthday({ player }) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState(/** @type {{ born: string|null, changes: any[] } | null} */ (null));
  const [born, setBorn] = useState("");
  const [why, setWhy] = useState("");
  const [said, setSaid] = useState({ text: "", bad: false });
  // db/176: the guardian links the old date set, as the correction answered them.
  const [links, setLinks] = useState(/** @type {any[]} */ ([]));
  const [busy, setBusy] = useState(false);
  const idBorn = useId(), idWhy = useId(), idHint = useId();
  useEffect(() => {
    let live = true;
    api(`/api/players/${player.id}/date-of-birth/changes`)
      .then((r) => { if (live) setState({ born: r?.born ?? null, changes: Array.isArray(r?.changes) ? r.changes : [] }); })
      .catch(() => { if (live) setState(null); });
    return () => { live = false; };
  }, [player.id, nonce]);
  if (!state || !state.born) return null;
  const check = born ? resolveBirthDate({ born }) : null;
  const reason = /[\p{L}\p{N}]/u.test(why) ? why.trim() : "";
  const save = async () => {
    setBusy(true); setSaid({ text: "", bad: false }); setLinks([]);
    try {
      const r = await api(`/api/players/${player.id}/date-of-birth/correction`, { method: "POST", body: { born, reason } });
      setBorn(""); setWhy(""); setNonce((n) => n + 1);
      setLinks(Array.isArray(r?.links) ? r.links : []);
      setSaid({ text: r?.unchanged ? "That is the date already on record." : "Date of birth corrected.", bad: false });
    } catch (e) { setSaid({ text: words(e), bad: true }); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid="edit-dob-correct">
      <p style={heading()}>Correct the date of birth</p>
      <p style={note(false)} data-testid="edit-dob-on-record">On record for {player.name}: {day(state.born)}.</p>
      <p style={note(false)}>Every change is kept: the date before and after, who made it and when. If his ID number is on file, the date must agree with it.</p>
      <label htmlFor={idBorn} style={{ ...note(false), display: "block" }}>The right date of birth</label>
      <input id={idBorn} type="date" value={born} onChange={(e) => setBorn(e.target.value)} style={field()} data-testid="edit-dob-correct-born"/>
      {check && check.ok === false && <p role="alert" style={note(true)}>{BIRTH_DATE_MESSAGE[check.reason] || check.reason}</p>}
      <label htmlFor={idWhy} style={{ ...note(false), display: "block" }}>Why are you correcting it?</label>
      <input id={idWhy} value={why} maxLength={200} aria-describedby={idHint} onChange={(e) => setWhy(e.target.value)}
        style={field()} data-testid="edit-dob-correct-reason" placeholder="Birth certificate seen"/>
      <p id={idHint} style={note(false)}>For example: birth certificate seen. Kept with the change.</p>
      <Go disabled={busy || !check?.ok || !reason} onClick={save} testid="edit-dob-correct-save">Correct it</Go>
      {said.text && <p role={said.bad ? "alert" : "status"} style={note(said.bad)} data-testid="edit-dob-correct-said">{said.text}</p>}
      {links.length > 0 && (
        <div data-testid="edit-dob-links">
          <p style={{ ...note(false), fontWeight: 700 }}>Guardian links the old date set</p>
          <ul style={{ listStyle: "none", padding: 0, margin: "4px 0", display: "grid", gap: "4px" }}>
            {links.map((l) => <li key={l.linkId} style={note(false)} data-testid="edit-dob-link">{bornLinkWords(l, todayIso(), day)}</li>)}
          </ul>
          <p style={note(false)}>{BORN_LINKS_NOTE}</p>
        </div>
      )}
      {state.changes.length > 0 && (
        <ul data-testid="edit-dob-changes" style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: "4px" }}>
          {state.changes.map((c, i) => (
            <li key={`${c.at}-${i}`} style={note(false)}>
              {when(c.at)}: {day(c.was)} to {day(c.became)}, {HOW[c.how] || c.how}{c.by ? `, by ${c.by}` : ""}{c.reason ? `: ${c.reason}` : ""}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
