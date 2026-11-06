/**
 * THE PARENT AGREES THE SCHOOL'S TERMS FOR HER OWN LINK (GA-I20 D7, N6;
 * docs/design/GUARDIAN_TERMS.md §4). Opened from "Read and agree ›" on his
 * Family card, or from the To-do row R8a.
 *
 * Before the button: his name once, the school, the whole text (the button
 * waits until its last section has been on screen), the version, and what is
 * kept. Then POST /api/players/:id/guardians/consent { guardianId: me,
 * consentVersion }; guardian_consent_record() (db/08) updates only her own
 * verified, live link. Nothing says "agreed" until the server has said OK,
 * and then in the record's words, from the link as read again.
 *
 * No child's name in the route, the title or any notice.
 */
import { useState } from "react";
import { T } from "../../design/tokens.js";
import { api } from "../../lib/api.js";
import { profile } from "../../lib/session.js";
import { AGREE_KEPT_WORDS, GUARDIAN_TERMS_VERSION, agreeRefusalWords, agreedWords } from "../../lib/guardianLink.js";
import { TermsText } from "../terms.jsx";
import { Action, Line } from "./parts.jsx";

/**
 * @param {{ child: any, w: { place?: string }, onAgreed?: () => void, onClose?: () => void }} p
 */
export function AgreeTerms({ child, w, onAgreed, onClose }) {
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {null | { kind: "refused" | "failed", text: string }} */ (null));
  const name = child.knownAs || child.name;
  if (child.consent === "granted") {
    return (
      <div data-testid={`family-terms-${child.id}`} style={{ display: "grid", gap: T.space.xs }}>
        <Line strong testid="family-terms-agreed">{agreedWords(child.consentAt, child.consentVersion)}</Line>
        <TermsText schoolName={child.schoolName} testid="family-terms-text"/>
      </div>
    );
  }
  const agree = async () => {
    if (busy || !read) return;
    setBusy(true); setSaid(null);
    try {
      await api(`/api/players/${child.id}/guardians/consent`, { method: "POST",
        body: { guardianId: profile()?.user?.id, consentVersion: GUARDIAN_TERMS_VERSION } });
      onAgreed?.();
    } catch (e) {
      setSaid(agreeRefusalWords(e, name));
    } finally { setBusy(false); }
  };
  return (
    <div data-testid={`family-terms-${child.id}`} style={{ display: "grid", gap: T.space.sm }}>
      <Line>The {w?.place ?? "school"}&apos;s terms for {name} at {child.schoolName || "the school"}. Read them to the end to agree.</Line>
      <TermsText schoolName={child.schoolName} onEnd={() => setRead(true)} testid="family-terms-text"/>
      <Line quiet testid="family-terms-kept">Version {GUARDIAN_TERMS_VERSION}. {AGREE_KEPT_WORDS}</Line>
      {!read && <Line quiet testid="family-terms-scroll">The button is ready once you reach the end of the terms.</Line>}
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <Action primary onClick={agree} disabled={!read || busy} testid="family-terms-agree">{busy ? "Saving…" : "I agree"}</Action>
        {onClose && <Action onClick={onClose} disabled={busy} testid="family-terms-close">Not now</Action>}
      </div>
      {said && <p role="alert" data-testid={`family-terms-${said.kind}`} style={{ ...T.role.body, margin: 0, color: T.content.primary }}>{said.text}</p>}
    </div>
  );
}
