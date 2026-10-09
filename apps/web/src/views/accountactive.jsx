import { useEffect, useId, useState } from "react";
import { D, inkOn, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";

/**
 * Disable and Enable an account, from People (account lifecycle, slices 1
 * and 2).
 *
 * `POST /api/auth/users/:id/disable` and `/enable` `{ reason }` run
 * account_set_active() (db/90), which decides everything through db/81's
 * auth_office_refusal(): user.invite at the account's school, every role the
 * account holds one the caller could grant there, a platform-wide account only
 * by a superadmin, never your own; then a reason of ten characters or more.
 * Each refusal comes back with the sentence SIGN_IN_REFUSALS gives it in
 * `detail`, and this shows it as it comes. WHAT THIS DECIDES: nothing.
 * lib/people.js accountAction() decides only whether to draw the button, and
 * the reason's ten characters are checked here only to say so before the
 * round trip; the database checks them again.
 *
 * Disabling is a sign-in matter, not a dismissal (D1): every device is signed
 * out now, nobody can sign in, and every role and link stays. Before the tap
 * the sheet says what the account has open (D3, `GET /api/auth/users/:id/
 * preview`, db/90 account_offboard_preview()): its devices, the phones that
 * can score without signing in, the scoring tokens it holds by fixture, its
 * duties and lifts this fortnight, the children it is linked to, as a count.
 * Never a child's name. Enabling signs nobody back in; the person signs in
 * again on each device, and is told the account was re-enabled, never why
 * (D20). The reason is the school's record, read by the office and its
 * auditors, never by the person (D4).
 *
 * No motion, so there is nothing for reduced motion to stop.
 */

export const REASON_MIN = 10;

/** The client's own words, for what never reached the server. */
export const ACCOUNT_WORDS = {
  reason_required: "Say why, in at least ten characters. It goes on the school's record, not to the person.",
  // D21: a dead token is told the same for every reason (db/85).
  signed_out: "You were signed out. Sign in again.",
  unreachable: "The server did not answer. Read the list again before trying: the account may or may not have changed.",
  preview_unreachable: "What this account has open could not be read just now. You can still go ahead.",
};

/** null when the reason will do; otherwise why not, in words. */
export function reasonProblem(reason) {
  return String(reason ?? "").trim().length < REASON_MIN ? ACCOUNT_WORDS.reason_required : null;
}

/** A refusal in words: the server's own sentence, or what we know without it. */
export function accountRefusalWords(e) {
  if (e?.detail) return e.detail;
  if (e?.code === "reason_required") return ACCOUNT_WORDS.reason_required;
  if (e?.status === 401) return ACCOUNT_WORDS.signed_out;
  if (e?.status) return "The account was not changed. Read the list again and try once more.";
  return ACCOUNT_WORDS.unreachable;
}

/**
 * Disable (`active` false) or enable (`active` true) one account, saying why.
 * `post` is api() unless a test hands in another.
 * @returns {Promise<{ ok: true, active: boolean } | { ok: false, code: string, words: string }>}
 */
export async function setAccountActive(userId, active, reason, post = api) {
  const problem = reasonProblem(reason);
  if (problem) return { ok: false, code: "reason_required", words: problem };
  try {
    const out = await post(`/api/auth/users/${encodeURIComponent(userId)}/${active ? "enable" : "disable"}`,
                           { method: "POST", body: { reason: String(reason).trim() } });
    return { ok: true, active: out?.active ?? active };
  } catch (e) {
    return { ok: false, code: e?.code || "unreachable", words: accountRefusalWords(e) };
  }
}

/**
 * What disabling the account would cut. `get` is api() unless a test hands in
 * another. A server refusal (`refused`) means the act would be refused too;
 * an unanswered read does not.
 * @returns {Promise<{ ok: true, preview: object } | { ok: false, refused: boolean, code: string, words: string }>}
 */
export async function loadPreview(userId, get = api) {
  try {
    return { ok: true, preview: await get(`/api/auth/users/${encodeURIComponent(userId)}/preview`) };
  } catch (e) {
    const refused = !!e?.status && e.status !== 401 && e.status < 500;
    return { ok: false, refused, code: e?.code || "unreachable",
             words: refused || e?.status === 401 ? accountRefusalWords(e) : ACCOUNT_WORDS.preview_unreachable };
  }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The preview, as the lines the sheet says (§2.3). Never a child's name: the server sends none. */
export function previewLines(p) {
  if (!p) return [];
  const lines = [];
  for (const f of p.scoringTokens ?? []) {
    lines.push(`Holds the scoring token for ${f}, live now. Disabling ends the pad's credential and the lease lapses; another scorer takes over or the office releases it.`);
  }
  if (p.padCredentials > 0) {
    lines.push(`${plural(p.padCredentials, "phone", "phones")} can still score without signing in; disabling ends ${p.padCredentials === 1 ? "it" : "them"}.`);
  }
  if (p.duties > 0) {
    lines.push(`${plural(p.duties, "match-day duty", "match-day duties")} this fortnight; each will need somebody linked to it again.`);
  }
  if (p.lifts > 0) {
    lines.push(`${plural(p.lifts, "lift", "lifts")} offered this fortnight; a disabled driver cannot mark the day. Nothing is cancelled by this: cancel ${p.lifts === 1 ? "it" : "them"} first or tell the families.`);
  }
  if (p.children > 0) {
    lines.push(`Linked to ${plural(p.children, "child", "children")} at this school. The links stay and the children stay registered; they cannot answer availability or lifts while disabled.`);
  }
  lines.push(p.sessions > 0 ? `${plural(p.sessions, "device", "devices")} signed in; all are signed out now.` : "Signed in on no device just now.");
  if (lines.length === 1) {
    lines.push("Nothing else is open: no scoring token, scoring phone, duty, lift or linked child.");
  }
  return lines;
}

/** What the confirmation says before a disable. */
export const disableWarning = (name) =>
  `This signs ${name || "this person"} out of every device now and stops them signing in. Their roles stay. To remove them from the school, end their roles first.`;

/** What the confirmation says before an enable. */
export const enableWarning = (name) =>
  `${name || "This person"} can sign in again; each device signs in afresh. They are told the account was re-enabled, not why.`;

/** A button on the 12px and 44px floors (the list it sits in is held to them). */
function Act({ children, variant = "ghost", disabled, ...rest }) {
  const danger = variant === "danger";
  return (
    <button type="button" className="pressBtn" disabled={disabled} {...rest}
      style={{ minHeight: "44px", padding: "10px 16px", borderRadius: D.pill, boxSizing: "border-box",
        border: `1px solid ${danger ? "transparent" : D.border}`, background: danger ? D.rose : "transparent",
        color: danger ? inkOn(D.rose) : D.textSecondary, fontFamily: D.head, fontSize: "13px", fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }}>{children}</button>
  );
}

const SUB = () => ({ fontFamily: D.body, fontSize: "13px", lineHeight: 1.45, color: D.textSecondary });

/** The reason, on the floors: a 12px label, 16px text (a phone does not zoom into it), 64px tall. */
function ReasonField({ value, onChange, disabled, placeholder }) {
  const id = useId();
  return (
    <div style={{ display: "grid", gap: "4px" }}>
      <label htmlFor={id} style={{ fontFamily: D.body, fontSize: "12px", fontWeight: 700, color: D.textSecondary }}>
        Why? (the school's record; they are not told)
      </label>
      <textarea id={id} data-testid="account-reason" value={value ?? ""} disabled={disabled} rows={2} maxLength={2000}
        onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder}
        style={{ minHeight: "64px", boxSizing: "border-box", width: "100%", padding: "10px 12px", resize: "vertical",
                 background: D.surf1, border: `1px solid ${D.border}`, borderRadius: D.md,
                 color: D.textPrimary, fontFamily: D.body, fontSize: "16px", lineHeight: 1.4 }}/>
    </div>
  );
}

/**
 * The confirmation before a disable or an enable, as drawn. Stateless, so a
 * test can draw each state. The safe button comes first and takes the focus,
 * so a stray Enter keeps the account as it is: the act is never the default,
 * and it waits for a reason. A disable says first what the account has open
 * (`preview`: { loading } | { lines } | { words, refused }); a refused
 * preview means the act would be refused too, so the act is not offered.
 */
export function AccountSheet({ mode = "disable", name, preview, reason, onReason, busy, refusal, onConfirm, onCancel }) {
  const off = mode === "disable";
  const blocked = off && !!preview?.refused;
  const t = off ? "disable" : "enable";
  return (
    <div data-testid={`account-${t}-form`} role="group" aria-label={`${off ? "Disable" : "Enable"} ${name}'s account`}
         style={{ display: "grid", gap: "8px", padding: "12px", borderRadius: D.md, boxSizing: "border-box",
                  border: `1px solid ${D.border}`, background: D.surf2, maxWidth: "560px", width: "100%" }}>
      <div style={{ ...SUB(), color: D.textPrimary, fontWeight: 600 }}>{off ? "Disable" : "Enable"} {name}'s account?</div>
      <div data-testid={`account-${t}-warning`} style={SUB()}>{off ? disableWarning(name) : enableWarning(name)}</div>
      {off && preview?.loading && <div data-testid="account-preview-loading" role="status" style={SUB()}>Reading what this account has open…</div>}
      {off && preview?.lines?.length > 0 && (
        <ul data-testid="account-preview" aria-label="What disabling cuts"
            style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "4px", ...SUB(), color: D.textPrimary }}>
          {preview.lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      {off && preview?.words && !preview.refused && <div data-testid="account-preview-unread" style={SUB()}>{preview.words}</div>}
      {!blocked && (
        <ReasonField value={reason} onChange={onReason} disabled={busy}
                     placeholder={off ? "e.g. Phone lost at the away fixture" : "e.g. Phone recovered; cleared by the office"}/>
      )}
      {(refusal || blocked) && <div role="alert" data-testid="account-refused"
                                    style={{ ...SUB(), color: textOn(D.rose) }}>{refusal || preview.words}</div>}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <Act onClick={onCancel} disabled={busy} data-testid={`account-${t}-cancel`} autoFocus>
          {off ? "Keep it active" : "Keep it disabled"}
        </Act>
        {!blocked && (
          <Act variant={off ? "danger" : "ghost"} onClick={onConfirm} disabled={busy || !!reasonProblem(reason)}
               data-testid={`account-${t}-confirm`}>
            {off ? (busy ? "Disabling…" : "Disable account") : (busy ? "Enabling…" : "Enable account")}
          </Act>
        )}
      </div>
    </div>
  );
}

/** The disable confirmation (slice 1's name, kept). */
export const DisableConfirm = (p) => <AccountSheet mode="disable" {...p}/>;

/**
 * The button for one account: "Disable account" or "Enable account", each of
 * which opens its confirmation. `action` is accountAction()'s answer; null
 * draws nothing. `post` and `get` are api() unless a test hands in others.
 * @param {{ person: { id: string, name: string }, action: "disable" | "enable" | null,
 *           onChanged?: (active: boolean) => void, post?: typeof api, get?: typeof api }} p
 */
export function AccountButton({ person, action, onChanged, post = api, get = api }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [refusal, setRefusal] = useState("");
  const [preview, setPreview] = useState(null);
  const id = person?.id;

  useEffect(() => {
    if (!open || action !== "disable" || !id) return undefined;
    let live = true;
    setPreview({ loading: true });
    loadPreview(id, get).then((r) => {
      if (!live) return;
      setPreview(r.ok ? { lines: previewLines(r.preview) } : { words: r.words, refused: r.refused });
    });
    return () => { live = false; };
  }, [open, action, id, get]);

  if (!person || !action) return null;

  const close = () => { setOpen(false); setRefusal(""); setReason(""); setPreview(null); };
  const act = async () => {
    setRefusal(""); setBusy(true);
    const r = await setAccountActive(person.id, action === "enable", reason, post);
    setBusy(false);
    if (!r.ok) { setRefusal(r.words); return; }
    close();
    onChanged?.(r.active);
  };

  if (!open) {
    const off = action === "disable";
    return (
      <Act onClick={() => setOpen(true)} data-testid={`account-${action}-${person.id}`}
           aria-label={`${off ? "Disable" : "Enable"} ${person.name}'s account`}>{off ? "Disable account" : "Enable account"}</Act>
    );
  }
  return (
    <AccountSheet mode={action} name={person.name} preview={preview} reason={reason} onReason={setReason}
                  busy={busy} refusal={refusal} onConfirm={act} onCancel={close}/>
  );
}
