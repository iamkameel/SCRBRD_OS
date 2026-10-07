/**
 * Guardian links, on the Squad screen's player panel (Edit Profile).
 *
 * The office does two things here, each one a route that existed with no
 * screen to reach it:
 *
 *   Verify the link            POST /api/players/:id/guardians/verify
 *   Record the agreement       POST /api/players/:id/guardians/consent
 *
 * guardian_link_verify() turns a parent's claim into a permission, and records
 * who checked the paperwork. guardian_consent_record() records the family's
 * agreement to the school's terms, with the wording's version and the time.
 * Both are db/08 functions under `guardian.link.manage`; this section is drawn
 * only for a holder of it (the server decides again).
 *
 * WHAT IT CANNOT SHOW. No read says which parents are linked to a child, or in
 * what state, so there is no list of links to act on. The office picks the
 * parent from the school's guardian appointments (the `assignments` read), and
 * the server answers whether that parent has a link to this child in the state
 * the act needs. Wrong pick, no change: "no link waiting", in words.
 *
 * Nothing says "saved" until the server has answered OK. A refusal and a
 * failure are told apart, both keep the pick, and neither changes a thing.
 *
 * Floors: nothing read under 12px, every control 44px tall.
 */
import { useId, useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import {
  GUARDIAN_TERMS_VERSION, confirmWords, doneWords, guardianCandidates, guardianLinkWords,
} from "../lib/guardianLink.js";
import { DBtn, dField, dHead, dNote } from "./publicname.jsx";

const today = () => new Date().toLocaleDateString("en-CA");

/** @param {{ role: string, player: { id: string, name: string, school?: string | null } }} props */
export function GuardianLinks({ role, player }) {
  const pickId = useId();
  const [readNonce, setReadNonce] = useState(0);
  const appointments = useLive("assignments", role, readNonce);
  const accounts = useLive("users", role, readNonce);
  const [pick, setPick] = useState("");
  const [ask, setAsk] = useState(/** @type {null | "verify" | "consent"} */ (null));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(/** @type {null | { kind: "ok" | "refused" | "failed", text: string }} */ (null));

  const candidates = guardianCandidates({ assignments: appointments.rows, users: accounts.rows, schoolId: player.school, today: today() });
  const chosen = candidates.find((c) => c.id === pick) ?? null;
  const loading = appointments.loading || accounts.loading;
  const readFailed = !!appointments.error;
  const who = chosen ? { child: player.name, guardian: chosen.name } : null;

  const choose = (id) => { setPick(id); setAsk(null); setOutcome(null); };
  const open = (act) => { setAsk(act); setOutcome(null); };

  const run = async () => {
    if (!ask || !chosen || !who || busy) return;
    setBusy(true); setOutcome(null);
    try {
      if (ask === "verify") {
        await api(`/api/players/${player.id}/guardians/verify`, { method: "POST", body: { guardianId: chosen.id } });
      } else {
        await api(`/api/players/${player.id}/guardians/consent`, { method: "POST", body: { guardianId: chosen.id, consentVersion: GUARDIAN_TERMS_VERSION } });
      }
      setOutcome({ kind: "ok", text: doneWords(ask, who) });
      setAsk(null);
    } catch (e) {
      setOutcome(guardianLinkWords(e, who));
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="guardian-links">
      <p style={dHead()}>Guardian links</p>
      <p style={dNote()}>
        Verify a parent&apos;s link to {player.name}, or record that the family agrees to the school&apos;s terms. Pick the parent first.
      </p>

      {loading && <p data-testid="guardian-links-loading" role="status" style={dNote()}>Reading the school&apos;s parents…</p>}

      {!loading && readFailed && (
        <div data-testid="guardian-links-unread">
          <p role="alert" style={dNote(true)}>The school&apos;s parents could not be read, so nothing can be picked. Nothing was changed.</p>
          <DBtn quiet onClick={() => setReadNonce((n) => n + 1)} testid="guardian-links-reread">Read the list again</DBtn>
        </div>
      )}

      {!loading && !readFailed && candidates.length === 0 && (
        <p data-testid="guardian-links-none" style={dNote()}>
          No parent at this school holds a guardian appointment yet. Enrol the parent under Settings, People first.
        </p>
      )}

      {!loading && !readFailed && candidates.length > 0 && (
        <div style={{ marginTop: "8px" }}>
          <label htmlFor={pickId} style={dHead()}>Parent or guardian</label>
          <select id={pickId} value={pick} onChange={(e) => choose(e.target.value)} style={dField()} data-testid="guardian-links-pick">
            <option value="">Choose a parent…</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>

          {chosen && (
            <div style={{ marginTop: "8px" }}>
              <p data-testid="guardian-links-version" style={dNote()}>
                The terms the family agrees to: version <span style={{ fontFamily: D.mono }}>{GUARDIAN_TERMS_VERSION}</span>.
              </p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <DBtn onClick={() => open("verify")} disabled={busy} testid="guardian-links-verify"
                  quiet={ask !== "verify"}>Verify the link</DBtn>
                <DBtn onClick={() => open("consent")} disabled={busy} testid="guardian-links-consent"
                  quiet={ask !== "consent"}>Record the agreement</DBtn>
              </div>
            </div>
          )}

          {chosen && ask && who && (
            <div role="group" aria-label={confirmWords(ask, who)} data-testid="guardian-links-confirm"
              style={{ marginTop: "10px", padding: "12px 14px", borderRadius: D.md, border: `1px solid ${D.border}`, background: D.surf2 }}>
              <p style={{ ...dNote(), margin: 0, color: D.textPrimary }}>{confirmWords(ask, who)}</p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <DBtn onClick={run} disabled={busy} testid="guardian-links-yes">
                  {busy ? "Saving…" : ask === "verify" ? "Yes, verify" : "Yes, record it"}
                </DBtn>
                <DBtn quiet onClick={() => setAsk(null)} disabled={busy} testid="guardian-links-cancel">Cancel</DBtn>
              </div>
            </div>
          )}
        </div>
      )}

      {outcome && (
        <p role={outcome.kind === "ok" ? "status" : "alert"} data-testid={`guardian-links-${outcome.kind}`}
          style={{ ...dNote(outcome.kind !== "ok"), color: outcome.kind === "ok" ? D.textPrimary : textOn(D.rose) }}>{outcome.text}</p>
      )}
    </div>
  );
}
