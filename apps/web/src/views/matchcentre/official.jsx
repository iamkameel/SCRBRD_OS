import { useCallback, useEffect, useState } from "react";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { officialWords, whenWords } from "../../lib/official.js";
import { StateLabel } from "../../ui/stateLabel.jsx";
import { Icon } from "../../ui/icons.jsx";
import { CardHead, Panel } from "./bits.jsx";

/**
 * When a result becomes official, on the Match Centre (docs/design/
 * OFFICIAL_RESULT.md §3 "Match Centre", D11–D14; db/114).
 *
 *   useOfficial()   GET /api/matches/:id/official for a finished match, read
 *                   again when the log moves, after an act, and every minute
 *                   while the match is open (polling, never the hub: GAP
 *                   decision 3). Null signed out and for a demonstration.
 *   OfficialLine    the StateLabel on the result header, in a polite live
 *                   region so a state learned on a poll is announced.
 *   OfficialPanel   for staff the server says may act: Confirm (the sheet's
 *                   words, the head it pins), Dispute and Clear with a note,
 *                   and his own Withdraw. Every refusal in words; the server
 *                   decides every one of them (the scorer of the log is never
 *                   offered "Confirm", and is refused anyway: D5).
 */

/** Every answer a door can give, in words. */
export const OFFICIAL_REFUSALS = Object.freeze({
  not_permitted: "You may not do this for this match.",
  support_session: "A support session does not make a result official.",
  not_finished: "The match is not finished.",
  innings_unsealed: "An innings is not sealed by the scorer yet.",
  amendment_pending: "A correction is awaiting approval: decide it first.",
  ball_held: "A late ball is held for a decision: decide it first.",
  already_official: "It is already official.",
  you_wrote_this_log: "Your hand is on this scorecard — you scored it, or asked for or approved a correction to it — so somebody else confirms it.",
  note_required: "Say why, in ten characters or more.",
  not_official: "It is not official, so there is nothing to dispute.",
  already_disputed: "It has already been disputed.",
  window_closed: "The window for this has closed. A correction can still be asked for.",
  cannot_dispute_your_own: "You confirmed it: withdraw it instead.",
  not_disputed: "No dispute stands on it.",
  not_standing: "That confirmation no longer stands.",
  cannot_clear_your_own: "You disputed it, so somebody else clears it.",
});

const refusal = (/** @type {any} */ e) => OFFICIAL_REFUSALS[/** @type {keyof typeof OFFICIAL_REFUSALS} */ (e?.code)]
  ?? "Could not reach the server; nothing was changed.";

/**
 * @param {any} match  the Match Centre's fixture
 * @param {boolean} on  a real fixture, signed in, decided
 * @param {unknown} seen  what the log has grown to
 */
export function useOfficial(match, on, seen) {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on || !signedIn()) { setData(null); return undefined; }
    let cancelled = false;
    const read = () => api(`/api/matches/${match.id}/official`)
      .then((d) => { if (!cancelled) setData(d ?? null); })
      .catch(() => { if (!cancelled) setData((x) => x); });
    read();
    const t = setInterval(read, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [match.id, on, seen, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  /** @param {"confirm" | "dispute" | "clear" | "withdraw"} what @param {string | null} [note] */
  const act = useCallback(async (what, note = null) => {
    const path = what === "confirm" ? `/api/matches/${match.id}/confirm`
      : what === "dispute" ? `/api/matches/${match.id}/dispute`
      : what === "clear" ? `/api/results/disputes/${data?.confirmationId}/clear`
      : `/api/results/confirmations/${data?.confirmationId}/withdraw`;
    try {
      await api(path, { method: "POST", body: note == null ? {} : { note } });
      reload();
      return { ok: true, text: null };
    } catch (e) {
      reload();
      return { ok: false, text: refusal(e) };
    }
  }, [match.id, data?.confirmationId, reload]);
  return { data, reload, act };
}

/** @param {{official: ReturnType<typeof useOfficial>, names: {home: string, away: string}}} p */
export function OfficialLine({ official, names }) {
  const w = officialWords(official.data, names);
  return (
    <div role="status" aria-live="polite" data-testid="mc-official">
      {w && <StateLabel kind={w.kind} why={w.why} compact/>}
    </div>
  );
}

const btn = (/** @type {boolean} */ strong) => ({
  minHeight: "44px", padding: `0 ${T.space.lg}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
  cursor: "pointer", borderRadius: T.radius.pill, fontFamily: T.type.body, fontSize: "14px", fontWeight: 600,
  background: strong ? T.brand.green : "transparent", color: strong ? T.surface.canvas : T.content.primary,
  border: strong ? "none" : `1px solid ${T.line.normal}`,
});
const field = () => ({
  width: "100%", minHeight: "72px", padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md, resize: "vertical",
  border: `1px solid ${T.line.normal}`, background: T.surface.raised, color: T.content.primary,
  fontFamily: T.type.body, fontSize: "14px", boxSizing: "border-box",
});

/**
 * The acts the server says this reader may do, one at a time. `step` is lifted
 * so the full-time prompt's "Confirm result" opens this sheet's confirm (D13).
 * @param {{official: ReturnType<typeof useOfficial>, step: string | null, setStep: (s: string | null) => void, result: string | null}} p
 */
export function OfficialPanel({ official, step, setStep, result }) {
  const o = official.data;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {{ok: boolean, text: string} | null} */ (null));
  if (!o?.staff) return null;
  const may = o.may ?? {};
  const any = may.confirm || may.dispute || may.clear || may.withdraw;
  if (!any && !said) return null;
  const go = async (/** @type {"confirm" | "dispute" | "clear" | "withdraw"} */ what) => {
    if (what !== "confirm" && note.trim().length < 10) { setSaid({ ok: false, text: OFFICIAL_REFUSALS.note_required }); return; }
    setBusy(true); setSaid(null);
    const r = await official.act(what, what === "confirm" ? null : note.trim());
    setBusy(false);
    if (r.ok) { setNote(""); setStep(null); }
    setSaid(r.ok ? { ok: true, text: what === "confirm" ? "Confirmed: the result is official, and both schools are told."
      : what === "dispute" ? "Disputed: the result is under review." : what === "clear" ? "Cleared: the result stands official."
      : "Withdrawn: the result is provisional again, and both schools are told." } : { ok: false, text: r.text ?? "" });
  };
  const closes = o.windowClosesAt ? whenWords(o.windowClosesAt) : null;
  return (
    <Panel testid="mc-official-panel">
      <CardHead icon="shield-check">Official result</CardHead>
      <div style={{ padding: T.space.md, display: "grid", gap: T.space.sm }}>
        {step == null && (
          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
            {may.confirm && <button type="button" data-testid="mc-official-confirm" onClick={() => { setSaid(null); setStep("confirm"); }} className="pressBtn os-state" style={btn(true)}>
              <Icon name="shield-check"/> Confirm result</button>}
            {may.dispute && <button type="button" data-testid="mc-official-dispute" onClick={() => { setSaid(null); setStep("dispute"); }} className="pressBtn os-state" style={btn(false)}>
              <Icon name="scale"/> Dispute</button>}
            {may.clear && <button type="button" data-testid="mc-official-clear" onClick={() => { setSaid(null); setStep("clear"); }} className="pressBtn os-state" style={btn(false)}>
              <Icon name="circle-check"/> Clear the dispute</button>}
            {may.withdraw && <button type="button" data-testid="mc-official-withdraw" onClick={() => { setSaid(null); setStep("withdraw"); }} className="pressBtn os-state" style={btn(false)}>
              <Icon name="rotate-ccw"/> Withdraw my confirmation</button>}
          </div>
        )}
        {step === "confirm" && (
          <div data-testid="mc-official-confirm-sheet" style={{ display: "grid", gap: T.space.sm }}>
            {result && <p style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, margin: 0 }}>{result}</p>}
            <p data-testid="mc-official-confirm-words" style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>
              This makes the result official, as the scorecard stands now (head {o.headSeq}). Both schools are told. A later correction reopens it.
            </p>
            <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
              <button type="button" data-testid="mc-official-confirm-go" disabled={busy} onClick={() => go("confirm")} className="pressBtn os-state" style={btn(true)}>
                {busy ? "Confirming…" : "Confirm the result"}</button>
              <button type="button" data-testid="mc-official-cancel" onClick={() => setStep(null)} className="pressBtn os-state" style={btn(false)}>Not now</button>
            </div>
          </div>
        )}
        {(step === "dispute" || step === "clear" || step === "withdraw") && (
          <div data-testid={`mc-official-${step}-sheet`} style={{ display: "grid", gap: T.space.sm }}>
            <p style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>
              {step === "dispute" ? `Say what is wrong with it. The result is under review until it is cleared or a correction reopens it; nothing in the table moves.${closes ? ` The window closes ${closes}.` : ""}`
                : step === "clear" ? "Say why the result stands. It is official again."
                : "Say why. The result is provisional again and both schools are told."}
            </p>
            <label style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary }}>
              Note (ten characters or more)
              <textarea data-testid="mc-official-note" value={note} onChange={(e) => setNote(e.target.value)} style={field()}/>
            </label>
            <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
              <button type="button" data-testid="mc-official-go" disabled={busy} onClick={() => go(/** @type {any} */ (step))} className="pressBtn os-state" style={btn(true)}>
                {busy ? "Sending…" : step === "dispute" ? "Dispute it" : step === "clear" ? "Clear it" : "Withdraw it"}</button>
              <button type="button" data-testid="mc-official-cancel" onClick={() => setStep(null)} className="pressBtn os-state" style={btn(false)}>Not now</button>
            </div>
          </div>
        )}
        {said && (
          <p role="alert" data-testid="mc-official-said" style={{ ...T.role.body, fontSize: "13px", margin: 0,
            color: said.ok ? T.semantic.positive : T.semantic.criticalText ?? T.semantic.critical }}>{said.text}</p>
        )}
      </div>
    </Panel>
  );
}
