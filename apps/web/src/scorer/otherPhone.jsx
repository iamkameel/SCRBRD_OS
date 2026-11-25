import { useEffect, useRef } from "react";
import { T } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { CHECK_AGAIN_WORDS, holderOf, otherPhoneWords } from "../lib/otherPhone.js";
import { Icon } from "../ui/icons.jsx";
import { ExitKey } from "./pad.jsx";

/**
 * Who holds this match's scoring, from the read the office's roster and Today
 * already make (match_duties' `scoring` row: state, held, who). Null when it
 * is not asked (signed out: the pad's resume credential reads only its own
 * routes) or did not answer. Never throws; a short wait, so a ground with
 * thin signal does not hold the pad's opening up.
 * @param {string | null} matchId
 */
export async function readHolder(matchId) {
  if (!matchId || !signedIn()) return null;
  try {
    const { rows } = await api(`/api/read/match_duties?matchId=${encodeURIComponent(matchId)}`, { timeoutMs: 3000 });
    return holderOf(rows);
  } catch {
    return null;
  }
}

/** A 44px, full-width button: the tap floor. */
function Wide({ children, onClick, testId, primary = false, disabled = false, icon }) {
  return (
    <button type="button" className="pressBtn" data-testid={testId} onClick={onClick} disabled={disabled} style={{
      width: "100%", minHeight: `${T.floor.target}px`, padding: `${T.space.sm} ${T.space.lg}`, borderRadius: T.radius.pill, cursor: "pointer",
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: T.space.sm,
      border: `1px solid ${primary ? "transparent" : T.line.normal}`,
      background: primary ? T.light.cobalt : T.surface.interactive,
      color: primary ? T.light.ink : T.content.primary,
      fontFamily: T.type.head, fontSize: "16px", fontWeight: 700, textAlign: "center", overflowWrap: "anywhere",
    }}>{icon && <Icon name={icon}/>}{children}</button>
  );
}

/**
 * ANOTHER PHONE HOLDS THE MATCH (redesign slice 13; DESIGN_DIRECTION §3.4
 * Flow E): one screen, before any toss sheet. Who is scoring; "Enter the
 * handover code", the one primary, which opens the pad's own handover sheet
 * at its code (scorer/sheets.jsx TakeOverTab, unchanged); "Watch the score",
 * the Match Centre on this match. Nothing here claims, sends or changes the
 * lease: "Check again" is the pad's own Try again (PadSync attach, as the
 * banner's), for a phone that has stopped and whose lease then lapses.
 *
 * The pad's keys, its board and its sheets are not drawn: this phone holds
 * nothing of the match, and scoring here would only make a second log.
 * lib/otherPhone.js decides when this shows and says its words.
 *
 * @param {{
 *   match: any, holder: any, reason: string | null,
 *   onExit?: (() => void) | null, onCode: () => void, onWatch?: (() => void) | null,
 *   onCheck?: (() => void) | null, checking?: boolean,
 * }} p
 */
export function OtherPhoneScreen({ match, holder, reason, onExit = null, onCode, onWatch = null, onCheck = null, checking = false }) {
  const say = otherPhoneWords(holder, reason);
  const head = useRef(null);
  // Arriving here (from the pad's opening, or back from a sheet), focus goes to what the screen says.
  useEffect(() => { head.current?.focus({ preventScroll: true }); }, [say.kind]);
  // Each side in full where the fixture read named it ("Hilton College 1XI"), never "1XI" alone (§2.2).
  const sides = `${match?.homeLabel ?? match?.team1 ?? "Home"} v ${match?.awayLabel ?? match?.team2 ?? "Away"}`;
  return (
    <div data-testid="other-phone" data-kind={say.kind} style={{ minHeight: "100vh", background: T.surface.canvas }}>
      {/* The pad's own title bar: back, and which match this is. */}
      <header style={{ position: "sticky", top: 0, zIndex: 100, minHeight: "52px", display: "flex", alignItems: "center", gap: T.space.sm,
        padding: `${T.space.xs} ${T.space.sm}`, background: T.surface.base, borderBottom: `1px solid ${T.line.normal}` }}>
        <ExitKey onExit={onExit} inBar/>
        <h1 style={{ margin: 0, flex: 1, minWidth: 0, fontFamily: T.type.body, fontSize: "16px", fontWeight: 600, lineHeight: 1.25,
          color: T.content.primary, overflowWrap: "anywhere" }}>{sides}</h1>
      </header>
      <main style={{ maxWidth: "520px", margin: "0 auto", padding: `${T.space.xl} ${T.space.lg}`, display: "flex", flexDirection: "column", gap: T.space.lg }}>
        <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
          <p style={{ ...T.role.label, margin: 0, color: T.content.secondary, display: "inline-flex", alignItems: "center", gap: T.space.xs }}>
            <Icon name="smartphone"/> {say.kind === "handover" || say.kind === "verifying" ? "A handover" : "Another phone is scoring"}
          </p>
          <h2 ref={head} tabIndex={-1} data-testid="other-phone-who"
            style={{ ...T.role.title.lg, margin: 0, color: T.content.primary, overflowWrap: "anywhere", outline: "none" }}>{say.lead}</h2>
          <p data-testid="other-phone-body" style={{ ...T.role.body, margin: 0, color: T.content.secondary }}>{say.body}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
          <Wide primary testId="other-phone-code" icon="key-round" onClick={onCode}>Enter the handover code</Wide>
          {onWatch && <Wide testId="other-phone-watch" icon="eye" onClick={onWatch}>Watch the score</Wide>}
        </div>
        {onCheck && (say.kind === "another" || say.kind === "you") && (
          <div style={{ display: "flex", flexDirection: "column", gap: T.space.sm, paddingTop: T.space.md, borderTop: `1px solid ${T.line.subtle}` }}>
            <p style={{ ...T.role.body, margin: 0, fontSize: "14px", color: T.content.secondary }}>{CHECK_AGAIN_WORDS}</p>
            <button type="button" className="pressBtn" data-testid="other-phone-check" onClick={onCheck} disabled={checking} style={{
              alignSelf: "flex-start", minHeight: `${T.floor.target}px`, minWidth: `${T.floor.target}px`, padding: `0 ${T.space.md}`,
              borderRadius: T.radius.pill, cursor: "pointer", background: "transparent", border: `1px solid ${T.line.normal}`,
              color: T.content.primary, fontFamily: T.type.body, fontSize: "15px", fontWeight: 600 }}>
              {checking ? "Checking…" : "Check again"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
