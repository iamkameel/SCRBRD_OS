/**
 * Family links, on the Squad screen's player panel (Edit Profile): every
 * guardian link of one child, in every state, for the office (account
 * lifecycle slice 3, db/109; ACCOUNT_LIFECYCLE.md §4.4, D12–D14).
 *
 *   The list        GET  /api/read/child_links?playerId=…
 *   Revoke…         POST /api/players/:id/guardians/:link/revoke { kind, reason }
 *
 * Drawn for a holder of user.role.assign or guardian.link.manage (the read
 * answers nothing to anybody else, and the server decides again). "Revoke…"
 * is offered only under guardian.link.manage. The sheet says what revoking
 * takes with it before the tap (D14), asks how and why, and changes nothing
 * until the server has answered OK. The reason is shown only where the read
 * returned it (D13). Never his date of birth: `is_minor` is the server's.
 *
 * Linking a guardian and verifying a link are the Guardian links section
 * beside this one (guardianlink.jsx), over the routes that already exist.
 *
 * Floors: nothing read under 12px, every control 44px tall, no motion.
 */
import { useId, useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { holdsCapability } from "../rbac/index.js";
import {
  REASON_MAX, REVOKE_KINDS, asChildLink, consequenceWords, isLastVerified, linkStateWords, mayOfferRevoke,
  reasonOk, revokeWords, standingLine,
} from "../lib/familyLinks.js";
import { DBtn, dField, dHead, dNote } from "./publicname.jsx";

/** May this person see a child's family links? The read decides again. */
export function mayFamilyLinks(role) {
  return holdsCapability(role, "guardian.link.manage") || holdsCapability(role, "user.role.assign");
}

/** @param {{ role: string, player: { id: string, name: string } }} props */
export function FamilyLinks({ role, player }) {
  const [nonce, setNonce] = useState(0);
  const read = useLive("child_links", role, nonce, { playerId: player.id });
  const [open, setOpen] = useState(/** @type {string | null} */ (null));
  const [done, setDone] = useState("");
  const mayRevoke = holdsCapability(role, "guardian.link.manage");
  const links = (read.rows ?? []).map(asChildLink);

  return (
    <div data-testid="family-links">
      <p style={dHead()}>Family links</p>
      {read.loading && <p role="status" style={dNote()} data-testid="family-links-loading">Reading his family links…</p>}
      {!read.loading && read.error && (
        <div data-testid="family-links-unread">
          <p role="alert" style={dNote(true)}>His family links could not be read. Nothing was changed.</p>
          <DBtn quiet onClick={() => setNonce((n) => n + 1)} testid="family-links-reread">Read them again</DBtn>
        </div>
      )}
      {!read.loading && !read.error && (
        <>
          <p style={{ ...dNote(), color: D.textPrimary }} data-testid="family-links-standing">{standingLine(links)}</p>
          {done && <p role="status" style={{ ...dNote(), color: D.textPrimary }} data-testid="family-links-ok">{done}</p>}
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: "8px" }}>
            {links.map((l) => (
              <li key={l.id} data-testid="family-link" data-state={l.live ? "live" : "ended"}
                style={{ padding: "10px 12px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf2 }}>
                <p style={{ fontFamily: D.body, fontSize: "14px", fontWeight: 600, color: D.textPrimary, margin: 0, overflowWrap: "anywhere" }}>
                  {l.guardianName || "A parent or guardian"}
                  {l.relationship ? <span style={{ fontWeight: 400, color: D.textSecondary }}> · {l.relationship}</span> : null}
                </p>
                {l.guardianEmail && <p style={{ ...dNote(), overflowWrap: "anywhere" }}>{l.guardianEmail}</p>}
                <p style={dNote()} data-testid="family-link-state">{linkStateWords(l, { readsEndings: mayRevoke })}</p>
                <p style={dNote()}>
                  {l.createdAt ? `Linked ${l.createdAt}${l.createdBy ? ` by ${l.createdBy}` : ""}` : ""}
                  {l.verifiedAt ? ` · verified ${l.verifiedAt}${l.verifiedBy ? ` by ${l.verifiedBy}` : ""}` : ""}
                  {l.consent === "granted" && l.consentVersion ? ` · terms ${l.consentVersion}` : ""}
                  {l.endedBy ? ` · ended by ${l.endedBy}` : ""}
                  {!l.accountActive ? " · account not active" : ""}
                </p>
                {l.endingReason && <p style={dNote()} data-testid="family-link-reason">Why: {l.endingReason}</p>}
                {mayRevoke && mayOfferRevoke(l) && open !== l.id && (
                  <DBtn quiet onClick={() => { setOpen(l.id); setDone(""); }} testid="family-link-revoke">Revoke…</DBtn>
                )}
                {open === l.id && (
                  <RevokeSheet player={player} link={l}
                    onCancel={() => setOpen(null)}
                    onDone={(text) => { setOpen(null); setDone(text); setNonce((n) => n + 1); }}/>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** @param {{ player: { id: string, name: string }, link: any, onCancel: () => void, onDone: (text: string) => void }} props */
function RevokeSheet({ player, link, onCancel, onDone }) {
  const kindId = useId();
  const reasonId = useId();
  const [kind, setKind] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {null | { kind: string, text: string }} */ (null));
  const guardian = link.guardianName || "This guardian";
  const blocked = isLastVerified(link);

  const send = async () => {
    if (busy || !kind || !reasonOk(reason)) return;
    setBusy(true); setSaid(null);
    try {
      await api(`/api/players/${player.id}/guardians/${link.id}/revoke`, { method: "POST", body: { kind, reason: reason.trim() } });
      onDone(`Revoked. ${guardian}'s link to ${player.name} has ended, and ${guardian} has been told.`);
    } catch (e) {
      setSaid(revokeWords(e));
    } finally { setBusy(false); }
  };

  return (
    <div role="group" aria-label={`Revoke ${guardian}'s link to ${player.name}`} data-testid="family-link-sheet"
      style={{ marginTop: "10px", padding: "12px 14px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf1 }}>
      {blocked ? (
        <>
          <p role="alert" style={{ ...dNote(), color: D.textPrimary, margin: 0 }} data-testid="family-link-last">
            He is under 18 and this is his only verified guardian. Link the new guardian first.
          </p>
          <DBtn quiet onClick={onCancel} testid="family-link-cancel">Close</DBtn>
        </>
      ) : (
        <>
          <p style={{ ...dNote(), color: D.textPrimary, margin: 0 }}>Revoking {guardian}&apos;s link to {player.name}:</p>
          <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }} data-testid="family-link-consequences">
            {consequenceWords({ guardian }).map((w) => <li key={w} style={dNote()}>{w}</li>)}
          </ul>
          <label htmlFor={kindId} style={{ ...dHead(), display: "block", marginTop: "10px" }}>How it ended</label>
          <select id={kindId} value={kind} onChange={(e) => setKind(e.target.value)} style={dField()} data-testid="family-link-kind">
            <option value="">Choose…</option>
            {REVOKE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          <label htmlFor={reasonId} style={{ ...dHead(), display: "block", marginTop: "10px" }}>Why (kept by the office, never shown to the family)</label>
          <textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={3}
            style={{ ...dField(), resize: "vertical" }} data-testid="family-link-reason-input"/>
          <p style={dNote()}>At least ten characters.</p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <DBtn onClick={send} disabled={busy || !kind || !reasonOk(reason)} testid="family-link-yes">
              {busy ? "Revoking…" : "Revoke the link"}
            </DBtn>
            <DBtn quiet onClick={onCancel} disabled={busy} testid="family-link-cancel">Cancel</DBtn>
          </div>
          {said && (
            <p role="alert" data-testid={`family-link-${said.kind}`}
              style={{ ...dNote(true), color: textOn(D.rose) }}>{said.text}</p>
          )}
        </>
      )}
    </div>
  );
}
