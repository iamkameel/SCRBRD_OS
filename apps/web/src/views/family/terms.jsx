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
 * Agreeing needs a signal: offline the button says "Connect to agree" and
 * nothing is queued, so the time kept is always the server's. Under the
 * buttons, one line: not agreeing is said to the office, and a written
 * request for what the school holds stays hers either way.
 *
 * TermsGate, below, is the card drawn in place of a child's section on Home,
 * Matches and Family while the terms are not agreed on her own link.
 *
 * No child's name in the route, the title or any notice.
 */
import { useEffect, useRef, useState } from "react";
import { T } from "../../design/tokens.js";
import { api } from "../../lib/api.js";
import { profile } from "../../lib/session.js";
import {
  AGREE_KEPT_WORDS, CONNECT_TO_AGREE, GUARDIAN_TERMS_VERSION, agreeRefusalWords, agreedWords, gateWords, notAgreeingWords,
} from "../../lib/guardianLink.js";
import { TermsText, WaitingTerms } from "../terms.jsx";
import { Action, Card, Line, Title } from "./parts.jsx";

/** The phone's own word on its signal; a phone that cannot say is taken as online. */
function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

/**
 * @param {{ child: any, w: { place?: string }, onAgreed?: () => void, onClose?: () => void }} p
 */
export function AgreeTerms({ child, w, onAgreed, onClose }) {
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  // The server said OK and the link is being read again: the button stays
  // "Saving…" until the record's own words replace it. A fresh read of her
  // links is a new row, which lets the button go again if it did not change.
  const [sent, setSent] = useState(false);
  useEffect(() => { setSent(false); }, [child]);
  const online = useOnline();
  const [said, setSaid] = useState(/** @type {null | { kind: "refused" | "failed", text: string }} */ (null));
  const name = child.knownAs || child.name;
  const place = w?.place ?? "school";
  if (child.consent === "granted") {
    return (
      <div data-testid={`family-terms-${child.id}`} style={{ display: "grid", gap: T.space.xs }}>
        <Line strong testid="family-terms-agreed">{agreedWords(child.consentAt, child.consentVersion)}</Line>
        <TermsText schoolName={child.schoolName} testid="family-terms-text"/>
      </div>
    );
  }
  // Q15: a link the office has not yet checked may read the terms, never agree to them.
  if (child.verification && child.verification !== "verified") {
    return <div data-testid={`family-terms-${child.id}`}><WaitingTerms schoolName={child.schoolName} testid="family-terms-waiting"/></div>;
  }
  const agree = async () => {
    if (busy || sent || !read || !online) return;
    setBusy(true); setSaid(null);
    try {
      await api(`/api/players/${child.id}/guardians/consent`, { method: "POST",
        body: { guardianId: profile()?.user?.id, consentVersion: GUARDIAN_TERMS_VERSION } });
      setSent(true);
      onAgreed?.();
    } catch (e) {
      setSaid(agreeRefusalWords(e, name));
    } finally { setBusy(false); }
  };
  const saving = busy || sent;
  return (
    <div data-testid={`family-terms-${child.id}`} style={{ display: "grid", gap: T.space.sm }}>
      <Line>The {place}&apos;s terms for {name} at {child.schoolName || "the school"}. Read them to the end to agree.</Line>
      <TermsText schoolName={child.schoolName} onEnd={() => setRead(true)} testid="family-terms-text"/>
      <Line quiet testid="family-terms-kept">Version {GUARDIAN_TERMS_VERSION}. {AGREE_KEPT_WORDS}</Line>
      {!read && <Line quiet testid="family-terms-scroll">The button is ready once you reach the end of the terms.</Line>}
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <Action primary onClick={agree} disabled={!read || saving || !online} testid="family-terms-agree">
          {saving ? "Saving…" : online ? "I agree" : CONNECT_TO_AGREE}
        </Action>
        {onClose && <Action onClick={onClose} disabled={saving} testid="family-terms-close">Not now</Action>}
      </div>
      <Line quiet testid="family-terms-office">{notAgreeingWords(name, place)}</Line>
      {said && <p role="alert" data-testid={`family-terms-${said.kind}`} style={{ ...T.role.body, margin: 0, color: T.content.primary }}>{said.text}</p>}
    </div>
  );
}

/**
 * THE CARD IN PLACE OF HIS SECTION (GA-I20 D7; Kameel, 18 Nov 2026): while
 * the terms are not agreed on her own link, a child's section on Home,
 * Matches and Family is this card alone. Whose terms, at which school, and
 * that his section opens when she agrees; "Read the terms" opens the whole
 * text here, in place. Nothing else of his: no fixture, no count, no notice.
 * The words are the same for every child behind it.
 *
 * The child's name is hers to read: she gave it, and the school verified it.
 * @param {{ child: any, w?: { place?: string }, onAgreed?: () => void, testid?: string }} p
 */
export function TermsGate({ child, w, onAgreed, testid = "family-gate" }) {
  const [open, setOpen] = useState(false);
  // Focus follows the tap: into the text when it opens, back to the button when "Not now" closes it.
  const toggled = useRef(false);
  const sheet = useRef(/** @type {HTMLDivElement | null} */ (null));
  const button = useRef(/** @type {HTMLDivElement | null} */ (null));
  useEffect(() => {
    if (!toggled.current) return;
    if (open) sheet.current?.querySelector?.('[role="region"]')?.focus?.();
    else button.current?.querySelector?.("button")?.focus?.();
  }, [open]);
  const toggle = (/** @type {boolean} */ v) => { toggled.current = true; setOpen(v); };
  const name = child.knownAs || child.name;
  const words = gateWords({ name, school: child.schoolName, place: w?.place ?? "school" });
  return (
    <Card testid={`${testid}-${child.id}`}>
      <Title as="h2" testid={`${testid}-head`}>{words.head}</Title>
      {/* Open, the sheet says the ask in its own first line: each thing once. */}
      {!open && <Line testid={`${testid}-ask`}>{words.ask}</Line>}
      {!open && <Line quiet testid={`${testid}-opens`}>{words.opens}</Line>}
      {open
        ? <div ref={sheet}><AgreeTerms child={child} w={w ?? {}} onAgreed={onAgreed} onClose={() => toggle(false)}/></div>
        : <div ref={button}><Action primary onClick={() => toggle(true)} testid={`${testid}-read`}>{words.button}</Action></div>}
    </Card>
  );
}
