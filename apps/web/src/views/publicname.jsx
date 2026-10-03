/**
 * A child's name on the public match pages (SCRBRD-083; PUBLIC_DATA §1 and
 * §4, C1–C5). Three pieces over public-name-api.mjs:
 *
 *   PublicNameSwitch  the parent's, on her own child's file: one switch,
 *                     "Show T Bekker on public match pages", and what that
 *                     means in PUBLIC_DATA's own words.
 *   PublicNameStaff   the school's, on Squad → Edit Profile: each guardian's
 *                     answer, which the office may record on the family's
 *                     word (a "no") or from a signed form (a "yes"); and
 *                     "Never show this child publicly", with its reason.
 *   NamesOffPanel     Settings → School: names off for an age group.
 *
 * WHAT THESE SCREENS DECIDE: nothing. Each section is drawn only from what
 * the read returned to this reader — `mine` to the person who answers for
 * the child, `guardians` to the office, `mark` (and its reason) to a holder
 * of player.public.withhold — and each write is refused by the database, in
 * a word this file turns into a sentence, for anybody it does not allow.
 *
 * Nothing here names any child but the one the screen is about. Type is 12px
 * at the smallest and every control 44px tall.
 */
import { useEffect, useId, useState } from "react";
import { roleGrants } from "@scrbrd/policy/roles";
import { T, D, inkOn, textOn } from "../design/tokens.js";
import { ROLE_IDENTITY } from "../design/roles.js";
import { api, signedIn } from "../lib/api.js";

/** The wording a family agrees to. A new wording is a new version, and a new record. */
export const PUBLIC_NAME_VERSION = "public-names-2026-10";

const REFUSAL = {
  not_signed_in: "Your session has ended. Sign in again; nothing was changed.",
  not_permitted: "You cannot answer for this child.",
  adult_consents_for_himself: "This child is eighteen, so this is their own decision now.",
  player_is_an_adult: "This child is eighteen, so this is their own decision now.",
  already_given: "That is already on.",
  no_verified_link: "That guardian's link to this child is not verified, so their answer cannot be recorded.",
  form_required: "A yes recorded by the office needs the form's name and its date.",
  form_date_invalid: "That date is not a date.",
  form_in_future: "The form's date cannot be in the future.",
  no_reason: "Give the reason. Only the people who may set this mark will see it.",
  reason_too_long: "Keep the reason under 1,000 characters.",
  already_marked: "This child is already marked.",
  not_marked: "This child is not marked.",
  unknown_age_group: "That is not an age group.",
};
const say = (e) => REFUSAL[e?.code]
  ?? (e?.status ? `Not changed. The server said ${e.code || `HTTP ${e.status}`}.` : "Could not reach the server. Nothing was changed.");
const day = (t) => (t ? new Date(`${String(t).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "");

/** The roles that hold a capability, as the school names them (never the platform's keys). */
const holdersOf = (capability) => Object.keys(ROLE_IDENTITY)
  .filter((r) => r !== "superadmin" && r !== "platformadmin" && roleGrants(r, capability))
  .map((r) => ROLE_IDENTITY[r]?.label ?? r);

/** The read, re-read after each change. `data` is null for a reader it answered 404. */
function usePublicName(playerId) {
  const [nonce, setNonce] = useState(0);
  const [st, setSt] = useState({ loading: true, data: null, error: false });
  useEffect(() => {
    if (!signedIn()) return undefined;
    let gone = false;
    api(`/api/players/${playerId}/public-name`)
      .then((data) => { if (!gone) setSt({ loading: false, data, error: false }); })
      .catch((e) => { if (!gone) setSt({ loading: false, data: null, error: e?.status !== 404 }); });
    return () => { gone = true; };
  }, [playerId, nonce]);
  return { ...st, reload: () => setNonce((n) => n + 1) };
}

/** Where one answer stands, in words, naming nobody else. */
function standing(a) {
  const who = a.actor === "you" ? "you" : a.actor === "guardian" ? "the guardian"
    : a.fromForm && a.state === "given" ? "the office, from a signed form" : "the office, on the family's word";
  switch (a.state) {
    case "given":     return `On since ${day(a.givenOn)}, recorded by ${who}.`;
    case "withdrawn": return `Off since ${day(a.endedOn)}, turned off by ${who}.`;
    case "refused":   return `Off since ${day(a.endedOn)}, a no recorded by ${who}.`;
    case "superseded":return "Off.";
    default:          return "Off. Nobody has answered yet.";
  }
}

// ── The parent's switch ────────────────────────────────

/** PUBLIC_DATA §1.3, §1.4 and §1.6, as the family reads them. */
export const publicNameWords = (label) => [
  `If you say yes, public match pages show your child as "${label}": initial and surname, never more. A full name, a first name alone, a photo or a date of birth is never shown.`,
  "Until you say yes, your child is shown by position: \"Batter\", \"Bowler\".",
  "Saying no takes effect at once, on every public page, finished scorecards included. You can change your answer at any time.",
];

export function PublicNameSwitch({ child }) {
  const { loading, data, error, reload } = usePublicName(child.id);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  if (!signedIn()) return null;
  if (loading) return <p style={tLine(true)}>Reading your answer…</p>;
  if (error) return <p style={tLine(true)}>Could not read your answer just now. Nothing has changed.</p>;
  const mine = data?.mine;
  if (!mine) return null;
  const on = mine.state === "given";
  const label = data.label;
  const answer = async (yes) => {
    setBusy(true); setSaid("");
    try {
      await api(`/api/players/${child.id}/public-name`, { method: "POST", body: { yes, version: PUBLIC_NAME_VERSION } });
      reload();
    } catch (e) { setSaid(say(e)); }
    finally { setBusy(false); }
  };
  return (
    <section data-testid={`public-name-${child.id}`} aria-labelledby={`public-name-title-${child.id}`}
      style={{ display: "grid", gap: T.space.sm, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: T.space.md }}>
      <div style={{ display: "flex", gap: T.space.md, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <span id={`public-name-title-${child.id}`} style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, flex: "1 1 200px", minWidth: 0 }}>
          Show {label} on public match pages
        </span>
        <button type="button" role="switch" aria-checked={on} aria-labelledby={`public-name-title-${child.id}`} disabled={busy}
          data-testid={`public-name-switch-${child.id}`} onClick={() => answer(!on)} className="pressBtn"
          style={{ minHeight: "44px", minWidth: "88px", padding: "8px 14px", borderRadius: T.radius.pill, cursor: busy ? "default" : "pointer",
            boxSizing: "border-box", ...T.role.control, fontSize: "15px", fontWeight: 600,
            border: `1px solid ${on ? T.content.primary : T.line.strong}`, background: on ? T.content.primary : "transparent",
            color: on ? inkOn(T.content.primary) : T.content.primary }}>
          {on ? "On" : "Off"}
        </button>
      </div>
      <p data-testid={`public-name-state-${child.id}`} style={tLine(true)}>{standing(mine)}</p>
      <ul style={{ margin: 0, paddingLeft: "20px", display: "grid", gap: T.space.xs }}>
        {publicNameWords(label).map((w) => <li key={w} style={{ ...tLine(true), fontSize: "14px" }}>{w}</li>)}
      </ul>
      {said && <p role="alert" data-testid="public-name-refused" style={{ ...T.role.body, color: T.semantic.criticalText, margin: 0 }}>{said}</p>}
    </section>
  );
}
const tLine = (quiet) => ({ ...T.role.body, margin: 0, color: quiet ? T.content.secondary : T.content.primary });

// ── The school's: each guardian's answer, and the mark ─

export const dHead = () => ({ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textMuted, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 6px" });
export const dNote = (bad) => ({ fontFamily: D.body, fontSize: "12px", lineHeight: 1.5, margin: "4px 0 0", color: bad ? textOn(D.rose) : D.textSecondary });
const dField = () => ({ width: "100%", minHeight: "44px", padding: "9px 12px", background: D.surf2, boxSizing: "border-box",
  border: `1px solid ${D.border}`, borderRadius: D.md, color: D.textPrimary, fontFamily: D.body, fontSize: "14px" });
function DBtn({ children, onClick, disabled, testid, quiet = false, type = "button" }) {
  return (
    <button type={type} className="pressBtn" disabled={disabled} onClick={onClick} data-testid={testid}
      style={{ minHeight: "44px", padding: "8px 16px", borderRadius: D.pill, cursor: disabled ? "not-allowed" : "pointer",
        background: quiet ? "transparent" : D.sky, border: `1px solid ${quiet ? D.border : "transparent"}`,
        color: quiet ? D.textPrimary : inkOn(D.sky), fontFamily: D.head, fontSize: "12px", fontWeight: 700,
        opacity: disabled ? 0.45 : 1, marginTop: "8px" }}>{children}</button>
  );
}

/**
 * Squad → Edit Profile. Draws whichever of the two sections the read
 * returned; for a reader it returned neither, nothing at all.
 */
export function PublicNameStaff({ player }) {
  const { loading, data, error, reload } = usePublicName(player.id);
  if (!signedIn() || loading) return null;
  if (error) return <p style={dNote(true)}>The public-name record could not be read just now.</p>;
  if (!data || (!data.guardians && !data.mark)) return null;
  return (
    <div data-testid="edit-public-name" style={{ display: "grid", gap: "12px" }}>
      <div>
        <p style={dHead()}>Public match pages</p>
        <p style={dNote(false)}>
          Named as <strong style={{ color: D.textPrimary }}>{data.label}</strong> only with a guardian&apos;s yes, and never while
          marked below. Otherwise shown by position.
        </p>
      </div>
      {data.guardians && <GuardianAnswers player={player} guardians={data.guardians} onChanged={reload}/>}
      {data.mark && <NeverPublic player={player} mark={data.mark} onChanged={reload}/>}
    </div>
  );
}

function GuardianAnswers({ player, guardians, onChanged }) {
  const [form, setForm] = useState(null);   // { guardianId, formName, formDate }
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const idName = useId(), idDate = useId();
  const send = async (body) => {
    setBusy(true); setSaid("");
    try {
      await api(`/api/players/${player.id}/public-name`, { method: "POST", body: { version: PUBLIC_NAME_VERSION, ...body } });
      setForm(null); onChanged();
    } catch (e) { setSaid(say(e)); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid="public-name-guardians">
      {!guardians.length && <p style={dNote(false)}>No guardian has a verified link to this child, so nobody can answer yet.</p>}
      {guardians.map((g) => (
        <div key={g.guardianId} data-testid={`public-name-guardian-${g.guardianId}`} style={{ borderTop: `1px solid ${D.border}`, paddingTop: "8px", marginTop: "8px" }}>
          <div style={{ fontFamily: D.body, fontSize: "14px", fontWeight: 600, color: D.textPrimary }}>{g.name}</div>
          <p style={dNote(false)} data-testid={`public-name-guardian-state-${g.guardianId}`}>{standing(g)}</p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {g.state === "given"
              ? <DBtn disabled={busy} testid={`public-name-withdraw-${g.guardianId}`} onClick={() => send({ yes: false, guardianId: g.guardianId })}>Record a no, on the family&apos;s word</DBtn>
              : <DBtn quiet disabled={busy} testid={`public-name-form-${g.guardianId}`} onClick={() => setForm({ guardianId: g.guardianId, formName: "", formDate: "" })}>Record a yes from a signed form</DBtn>}
          </div>
          {form?.guardianId === g.guardianId && (
            <form onSubmit={(e) => { e.preventDefault(); send({ yes: true, guardianId: g.guardianId, formName: form.formName, formDate: form.formDate }); }}
              style={{ display: "grid", gap: "6px", marginTop: "8px" }}>
              <label htmlFor={idName} style={dNote(false)}>Which form</label>
              <input id={idName} value={form.formName} onChange={(e) => setForm((f) => ({ ...f, formName: e.target.value }))} style={dField()}
                placeholder="Admission form, 2026" data-testid="public-name-form-name"/>
              <label htmlFor={idDate} style={dNote(false)}>The date it was signed</label>
              <input id={idDate} type="date" value={form.formDate} onChange={(e) => setForm((f) => ({ ...f, formDate: e.target.value }))} style={dField()}
                data-testid="public-name-form-date"/>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <DBtn type="submit" disabled={busy || !form.formName.trim() || !form.formDate} testid="public-name-form-save">Record the yes</DBtn>
                <DBtn quiet disabled={busy} onClick={() => setForm(null)}>Cancel</DBtn>
              </div>
            </form>
          )}
        </div>
      ))}
      {said && <p role="alert" data-testid="public-name-staff-refused" style={dNote(true)}>{said}</p>}
    </div>
  );
}

function NeverPublic({ player, mark, onChanged }) {
  const [reason, setReason] = useState("");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const who = holdersOf("player.public.withhold");
  const send = async (path, body) => {
    setBusy(true); setSaid("");
    try { await api(path, { method: "POST", body }); setReason(""); onChanged(); }
    catch (e) { setSaid(say(e)); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid="never-public" style={{ borderTop: `1px solid ${D.border}`, paddingTop: "8px" }}>
      <p style={dHead()}>Never show this child publicly</p>
      {mark.marked ? (
        <>
          <p style={{ ...dNote(false), color: D.textPrimary }} data-testid="never-public-state">Marked since {day(mark.setOn)}. Shown by position on every public page, whatever any consent says.</p>
          <p style={dNote(false)} data-testid="never-public-reason">Reason: {mark.reason}</p>
          <DBtn quiet disabled={busy} testid="never-public-end" onClick={() => send(`/api/players/${player.id}/never-public/end`)}>Remove the mark</DBtn>
        </>
      ) : (
        <>
          <p style={dNote(false)}>
            Overrides every consent, at once, on every public page, finished scorecards included. The reason is never on a page;
            only {who.join(", ")} can read it.
          </p>
          <label htmlFor={id} style={{ ...dNote(false), display: "block" }}>Reason</label>
          <textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={2}
            style={{ ...dField(), resize: "vertical" }} data-testid="never-public-reason-input"/>
          <DBtn disabled={busy || !reason.trim()} testid="never-public-set"
            onClick={() => send(`/api/players/${player.id}/never-public`, { reason })}>Never show this child publicly</DBtn>
        </>
      )}
      {said && <p role="alert" data-testid="never-public-refused" style={dNote(true)}>{said}</p>}
    </div>
  );
}

// ── The director of sport's: names off per age group ───

/** Settings → School, for one school: drawn only for a reader who may change it. */
export function NamesOffPanel({ schoolId }) {
  const [nonce, setNonce] = useState(0);
  const [data, setData] = useState(null);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (!signedIn()) return undefined;
    let gone = false;
    api(`/api/schools/${schoolId}/public-names`).then((d) => { if (!gone) setData(d); }).catch(() => { if (!gone) setData(null); });
    return () => { gone = true; };
  }, [schoolId, nonce]);
  if (!data?.mayChange) return null;
  const flip = async (g) => {
    setBusy(g.ageGroup); setSaid("");
    try {
      await api(`/api/schools/${schoolId}/public-names`, { method: "POST", body: { ageGroup: g.ageGroup, off: !g.namesOff } });
      setNonce((n) => n + 1);
    } catch (e) { setSaid(say(e)); }
    finally { setBusy(null); }
  };
  return (
    <section data-testid={`names-off-${schoolId}`} aria-label="Names on public match pages" style={{ marginTop: "12px", borderTop: `1px solid ${D.border}`, paddingTop: "12px" }}>
      <p style={dHead()}>Names on public match pages</p>
      <p style={dNote(false)}>
        Switch names off for an age group and nobody in it is named on a public page, whatever their family said: everyone is
        shown by position. It takes effect at once, finished scorecards included.
      </p>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
        {data.groups.map((g) => (
          <button key={g.ageGroup} type="button" role="switch" aria-checked={g.namesOff}
            aria-label={`Names off for ${g.ageGroup === "open" ? "open sides" : g.ageGroup}`}
            disabled={busy != null} onClick={() => flip(g)} className="pressBtn" data-testid={`names-off-${g.ageGroup}`}
            style={{ minHeight: "44px", padding: "0 14px", borderRadius: D.pill, cursor: busy ? "default" : "pointer",
              fontFamily: D.body, fontSize: "13px", fontWeight: 600,
              border: `1px solid ${g.namesOff ? D.textPrimary : D.borderMed}`, background: g.namesOff ? D.textPrimary : "transparent",
              color: g.namesOff ? textOn(D.textPrimary) : D.textPrimary }}>
            {g.ageGroup === "open" ? "Open sides" : g.ageGroup}: {g.namesOff ? "names off" : "names shown"}
          </button>
        ))}
      </div>
      {said && <p role="alert" style={dNote(true)}>{said}</p>}
    </section>
  );
}
