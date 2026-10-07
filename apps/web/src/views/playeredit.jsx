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
 *   - who to ring in an emergency POST /api/players/:id/emergency-contacts
 *   - his name on public pages    POST /api/players/:id/public-name (the office,
 *                                 on a guardian's word or form) and
 *                                 …/never-public (the mark): publicname.jsx
 *   - a parent's link to him      POST /api/players/:id/guardians/verify and
 *                                 …/consent, under guardian.link.manage:
 *                                 guardianlink.jsx
 *
 * Name, squad number, playing role and the rest have no route, so they have no
 * field here. The first two need player.profile.manage, the third
 * player.emergency.manage, and the public-name section guardian.link.manage
 * or player.public.withhold (it draws only what its read returns). A
 * demonstration offers no writes at all.
 *
 * Floors: nothing read under 12px, nothing pressed under 44px.
 */
import { useId, useMemo, useState } from "react";
import { D, inkOn, textOn } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { useRows } from "../lib/live.js";
import { holdsCapability } from "../rbac/index.js";
import { resolveBirthDate, BIRTH_DATE_MESSAGE } from "@scrbrd/policy/date-of-birth";
import { compareTeams, teamLabel, teamsForLevel } from "@scrbrd/policy/teams";
import { WhoToRing } from "./family/childfile.jsx";
import { PublicNameStaff } from "./publicname.jsx";
import { GuardianLinks } from "./guardianlink.jsx";
import { holds } from "../lib/family.js";

/** Does this person hold anything Edit Profile could offer? Signed out: nothing. */
export function mayEditProfile(role) {
  return signedIn() && (holdsCapability(role, "player.profile.manage") || holdsCapability(role, "player.emergency.manage")
    || mayPublicName(role));
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
};
const words = (e) => e?.detail || SAY[e?.code] || BIRTH_DATE_MESSAGE[e?.code] || "The change was refused.";

const heading = () => ({ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 6px" });
const field = () => ({ width: "100%", minHeight: "44px", padding: "9px 12px", background: D.surf2, boxSizing: "border-box",
  border: `1px solid ${D.border}`, borderRadius: D.md, color: D.textPrimary, fontFamily: D.body, fontSize: "14px" });
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
      {mayContacts && (
        <div data-testid="edit-contacts">
          <p style={heading()}>Who to ring</p>
          <WhoToRing child={{ id: player.id, name: player.name }} role={role}/>
        </div>
      )}
      {holdsCapability(role, "guardian.link.manage") && <GuardianLinks role={role} player={player}/>}
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
      <label htmlFor={idNo} style={{ ...note(false), display: "block" }}>ID number (or use the date above)</label>
      <input id={idNo} value={v.idNumber} onChange={(e) => setV((x) => ({ ...x, idNumber: e.target.value }))} style={field()} placeholder="13 digits"/>
      {check && check.ok === false && <p role="alert" style={note(true)}>{BIRTH_DATE_MESSAGE[check.reason] || check.reason}</p>}
      <Go disabled={busy || !check?.ok} onClick={save} testid="edit-dob-save">Record it</Go>
      {said.text && <p role={said.bad ? "alert" : "status"} style={note(said.bad)}>{said.text}</p>}
    </div>
  );
}
