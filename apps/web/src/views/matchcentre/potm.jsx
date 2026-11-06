import { useCallback, useEffect, useState } from "react";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { confirmWords, potmShortName, standingWords, WITHDRAW_KINDS, POTM_REASON_MIN, POTM_REASON_MAX, FALLBACK } from "../../lib/potm.js";
import { NO_AWARD_DONE, NO_AWARD_WORDS, staffLine } from "../../lib/nomination.js";
import { Icon } from "../../ui/icons.jsx";
import { CardHead, Panel } from "./bits.jsx";

/**
 * Player of the Match, the coach's path, on the Match Centre's staff sheet
 * (docs/design/RECOGNITION_design.md D17, D18, D21, §7 "the coach"; db/142).
 *
 *   usePotm()   GET /api/matches/:id/player-of-match for a finished match,
 *               read again when the log moves and after an act. The server
 *               answers a side only to the people who decide it (the side's
 *               coach, the director of sport, the principal), so nobody else
 *               is shown a button it would refuse.
 *   PotmPanel   per side: the standing award and its withdrawal, or the
 *               suggestions (never pre-selected), the rest of the sheet under
 *               "Someone else", one confirm sheet, and the server's words for
 *               every refusal. A boy whose guardian the reader is cannot be
 *               chosen, and the line says who decides instead (D10).
 *   R7 (db/144) The captain's nomination, when there is one: "The captain
 *               nominated R Pillay · decide by Mon 20:14", and Confirm (one
 *               tap and a confirm sheet), Choose another (the same
 *               suggestions; the award answers the nomination), or No award.
 *               A guardian of the nominee is told who decides instead.
 *
 * Floors: 12px text and up, 44px targets (56px for the one tap), the state of
 * a choice is a radio and words, never colour alone; nothing moves, so
 * prefers-reduced-motion has nothing to stop.
 */

/**
 * @param {any} match  the Match Centre's fixture
 * @param {boolean} on  a real, finished fixture, signed in
 * @param {unknown} seen  what the log has grown to
 */
export function usePotm(match, on, seen) {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on || !signedIn()) { setData(null); return undefined; }
    let cancelled = false;
    // R6's sides, and R7's nominations for them (db/144): a nomination read
    // that fails leaves the sheet as R6 draws it.
    Promise.all([api(`/api/matches/${match.id}/player-of-match`),
                 api(`/api/matches/${match.id}/player-of-match/nomination`).catch(() => null)])
      .then(([d, nom]) => { if (!cancelled) setData(d ? { ...d, nominations: nom?.staff ?? [] } : null); })
      .catch(() => { if (!cancelled) setData((x) => x); });
    return () => { cancelled = true; };
  }, [match.id, on, seen, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  /** @param {string} path @param {any} body */
  const post = useCallback(async (path, body) => {
    try {
      await api(path, { method: "POST", body });
      reload();
      return { ok: true, text: null };
    } catch (/** @type {any} */ e) {
      reload();
      return { ok: false, text: e?.data?.message ?? FALLBACK };
    }
  }, [reload]);
  const award = useCallback((/** @type {string} */ playerId, /** @type {number} */ headSeq) =>
    post(`/api/matches/${match.id}/player-of-match`, { playerId, headSeq }), [match.id, post]);
  const withdraw = useCallback((/** @type {string} */ honourId, /** @type {string} */ kind, /** @type {string} */ reason) =>
    post(`/api/matches/${match.id}/player-of-match/withdraw`, { honourId, kind, reason }), [match.id, post]);
  const decide = useCallback((/** @type {string} */ nominationId, /** @type {string} */ action, /** @type {string | null} */ playerId, /** @type {number} */ headSeq) =>
    post(`/api/matches/${match.id}/player-of-match/nomination/decide`, { nominationId, action, playerId, headSeq }), [match.id, post]);
  return { data, reload, award, withdraw, decide };
}

const btn = (/** @type {boolean} */ strong, tall = false) => ({
  minHeight: tall ? "56px" : "44px", padding: `0 ${T.space.lg}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
  cursor: "pointer", borderRadius: T.radius.pill, fontFamily: T.type.body, fontSize: "14px", fontWeight: 600,
  background: strong ? T.brand.green : "transparent", color: strong ? T.surface.canvas : T.content.primary,
  border: strong ? "none" : `1px solid ${T.line.normal}`,
});
const row = (/** @type {boolean} */ disabled) => ({
  minHeight: "44px", display: "flex", alignItems: "center", gap: T.space.sm, padding: `${T.space.xs} ${T.space.sm}`,
  border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, cursor: disabled ? "not-allowed" : "pointer",
  color: disabled ? T.content.tertiary : T.content.primary, fontFamily: T.type.body, fontSize: "14px",
});
const small = () => ({ ...T.role.body, fontSize: "13px", color: T.content.secondary, margin: 0 });

/** @param {{potm: ReturnType<typeof usePotm>}} p */
export function PotmPanel({ potm }) {
  const sides = potm.data?.sides ?? [];
  if (!sides.length) return null;
  return (
    <Panel testid="mc-potm">
      <CardHead icon="award">Player of the Match</CardHead>
      <div style={{ padding: T.space.md, display: "grid", gap: T.space.lg }}>
        {sides.map((/** @type {any} */ s) => (
          <PotmSide key={s.side} s={s} basis={potm.data.basis} two={sides.length > 1} potm={potm}
            nom={(potm.data.nominations ?? []).find((/** @type {any} */ x) => x.side === s.side) ?? null}/>
        ))}
      </div>
    </Panel>
  );
}

/** @param {{s: any, basis: string, two: boolean, potm: ReturnType<typeof usePotm>, nom: any}} p */
function PotmSide({ s, basis, two, potm, nom }) {
  const [chosen, setChosen] = useState(/** @type {string | null} */ (null));
  const [more, setMore] = useState(false);
  const [step, setStep] = useState(/** @type {null | "confirm" | "withdraw" | "nominee" | "no_award"} */ (null));
  // R7: an open nomination the reader may decide; Choose another opens R6's picker under it.
  const open = nom && nom.status === "open" && nom.mayDecide;
  const [another, setAnother] = useState(false);
  const [kind, setKind] = useState(/** @type {string | null} */ (null));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {{ok: boolean, text: string} | null} */ (null));

  const suggested = new Set((s.suggestions ?? []).map((/** @type {any} */ x) => x.playerId));
  const rest = (s.sheet ?? []).filter((/** @type {any} */ x) => !suggested.has(x.playerId));
  const everyone = [...(s.suggestions ?? []), ...rest];
  const pick = everyone.find((x) => x.playerId === chosen) ?? null;

  const go = async () => {
    if (!pick) return;
    setBusy(true); setSaid(null);
    // While the captain's nomination is open, the award answers it (db/144).
    const r = open ? await potm.decide(nom.nominationId, pick.playerId === nom.nomineeId ? "confirm" : "choose", pick.playerId, s.headSeq)
                   : await potm.award(pick.playerId, s.headSeq);
    setBusy(false);
    setStep(null);
    if (r.ok) { setChosen(null); setMore(false); }
    setSaid(r.ok ? { ok: true, text: `Awarded: ${potmShortName(pick.name)} is Player of the Match, and the side is told.` }
                 : { ok: false, text: r.text ?? FALLBACK });
  };
  const goWithdraw = async () => {
    const text = reason.trim();
    if (!kind) { setSaid({ ok: false, text: "Say whether it is withdrawn after a scorecard correction or for another reason." }); return; }
    if (text.length < POTM_REASON_MIN || text.length > POTM_REASON_MAX) {
      setSaid({ ok: false, text: `Say why, in ${POTM_REASON_MIN} to ${POTM_REASON_MAX} characters. Nobody on the side reads it.` }); return;
    }
    setBusy(true); setSaid(null);
    const r = await potm.withdraw(s.standing.honourId, kind, text);
    setBusy(false);
    if (r.ok) { setStep(null); setKind(null); setReason(""); }
    setSaid(r.ok ? { ok: true, text: kind === "correction" ? "Withdrawn. The side is told it was withdrawn after the scorecard was corrected."
                                                            : "Withdrawn. The side's notice is taken back." }
                 : { ok: false, text: r.text ?? FALLBACK });
  };

  /** @param {any} x */
  const option = (x) => (
    <label key={x.playerId} data-testid={`mc-potm-option-${x.playerId}`} style={row(!!x.conflict)}>
      <input type="radio" name={`potm-${s.side}`} value={x.playerId} checked={chosen === x.playerId} disabled={!!x.conflict || busy}
        onChange={() => { setChosen(x.playerId); setSaid(null); }} style={{ width: "20px", height: "20px", margin: 0, flex: "none" }}/>
      <span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
        <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{x.name}</span>
        <span style={{ fontSize: "13px", color: T.content.secondary }}>{x.conflict ? x.conflictWords : x.figures}</span>
      </span>
    </label>
  );

  return (
    <div data-testid={`mc-potm-${s.side}`} style={{ display: "grid", gap: T.space.sm }}>
      <h3 style={{ ...T.role.body, fontWeight: 600, color: T.content.primary, margin: 0 }}>
        {two ? `${s.label} · ` : ""}{s.heading}
      </h3>

      {s.standing && (
        <>
          <p data-testid="mc-potm-standing" style={{ ...T.role.body, color: T.content.primary, margin: 0, display: "flex", gap: T.space.xs, alignItems: "center" }}>
            <Icon name="award"/> {standingWords(s.standing)}
          </p>
          {s.mayWithdraw && step !== "withdraw" && (
            <button type="button" data-testid="mc-potm-withdraw" onClick={() => { setSaid(null); setStep("withdraw"); }}
              className="pressBtn os-state" style={{ ...btn(false), justifySelf: "start" }}>
              <Icon name="rotate-ccw"/> Withdraw the award
            </button>
          )}
          {step === "withdraw" && (
            <fieldset data-testid="mc-potm-withdraw-sheet" style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: T.space.sm }}>
              <legend style={{ ...T.role.body, color: T.content.primary, padding: 0, marginBottom: T.space.xs }}>
                Why is it withdrawn?
              </legend>
              {WITHDRAW_KINDS.map((k) => (
                <label key={k.kind} data-testid={`mc-potm-kind-${k.kind}`} style={row(false)}>
                  <input type="radio" name={`potm-kind-${s.side}`} value={k.kind} checked={kind === k.kind}
                    onChange={() => { setKind(k.kind); setSaid(null); }} style={{ width: "20px", height: "20px", margin: 0, flex: "none" }}/>
                  <span style={{ display: "grid", gap: "2px" }}>
                    <span style={{ fontWeight: 600 }}>{k.label}</span>
                    <span style={{ fontSize: "13px", color: T.content.secondary }}>{k.says}</span>
                  </span>
                </label>
              ))}
              <label style={{ ...small(), display: "grid", gap: T.space.xs }}>
                The reason, for the school ({POTM_REASON_MIN} to {POTM_REASON_MAX} characters; nobody on the side reads it)
                <textarea data-testid="mc-potm-reason" value={reason} maxLength={POTM_REASON_MAX} onChange={(e) => setReason(e.target.value)}
                  style={{ width: "100%", minHeight: "72px", padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md, resize: "vertical",
                    border: `1px solid ${T.line.normal}`, background: T.surface.raised, color: T.content.primary,
                    fontFamily: T.type.body, fontSize: "14px", boxSizing: "border-box" }}/>
              </label>
              <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
                <button type="button" data-testid="mc-potm-withdraw-go" disabled={busy} onClick={goWithdraw} className="pressBtn os-state" style={btn(true)}>
                  {busy ? "Withdrawing…" : "Withdraw it"}</button>
                <button type="button" data-testid="mc-potm-cancel" onClick={() => setStep(null)} className="pressBtn os-state" style={btn(false)}>Not now</button>
              </div>
            </fieldset>
          )}
        </>
      )}

      {!s.standing && !s.mayAward && s.refusalWords && (
        <p data-testid="mc-potm-wait" style={small()}>{s.refusalWords}</p>
      )}

      {nom && (
        <div data-testid="mc-potm-nomination" data-status={nom.status} style={{ display: "grid", gap: T.space.sm }}>
          {nom.status === "open" && (
            <p data-testid="mc-potm-nomination-line" style={{ ...T.role.body, color: T.content.primary, margin: 0, fontWeight: 600 }}>
              {staffLine(nom, Date.now())}
            </p>
          )}
          {nom.status === "no_award" && <p data-testid="mc-potm-nomination-line" style={small()}>{NO_AWARD_DONE}</p>}
          {nom.refusalWords && nom.status !== "confirmed" && nom.status !== "superseded" && (
            <p data-testid="mc-potm-nomination-wait" style={small()}>{nom.refusalWords}</p>
          )}
          {open && s.mayAward && !step && (
            <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
              <button type="button" data-testid="mc-potm-nomination-confirm" onClick={() => { setSaid(null); setStep("nominee"); }}
                className="pressBtn os-state" style={btn(true, true)}>Confirm {potmShortName(nom.nomineeName)}</button>
              <button type="button" data-testid="mc-potm-nomination-another" aria-expanded={another} onClick={() => setAnother((v) => !v)}
                className="pressBtn os-state" style={btn(false)}>Choose another</button>
              <button type="button" data-testid="mc-potm-nomination-none" onClick={() => { setSaid(null); setStep("no_award"); }}
                className="pressBtn os-state" style={btn(false)}>No award</button>
            </div>
          )}
          {open && step === "nominee" && (
            <div data-testid="mc-potm-nomination-sheet" style={{ display: "grid", gap: T.space.sm }}>
              <p data-testid="mc-potm-nomination-words" style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>{confirmWords(nom.nomineeName)}</p>
              <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
                <button type="button" data-testid="mc-potm-nomination-go" disabled={busy} className="pressBtn os-state" style={btn(true, true)}
                  onClick={async () => {
                    setBusy(true); setSaid(null);
                    const r = await potm.decide(nom.nominationId, "confirm", null, s.headSeq);
                    setBusy(false); setStep(null);
                    setSaid(r.ok ? { ok: true, text: `Awarded: ${potmShortName(nom.nomineeName)} is Player of the Match, and the side is told.` }
                                 : { ok: false, text: r.text ?? FALLBACK });
                  }}>{busy ? "Awarding…" : "Award it"}</button>
                <button type="button" data-testid="mc-potm-cancel" onClick={() => setStep(null)} className="pressBtn os-state" style={btn(false)}>Not now</button>
              </div>
            </div>
          )}
          {open && step === "no_award" && (
            <div data-testid="mc-potm-nomination-sheet" style={{ display: "grid", gap: T.space.sm }}>
              <p data-testid="mc-potm-nomination-words" style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>{NO_AWARD_WORDS}</p>
              <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
                <button type="button" data-testid="mc-potm-nomination-go" disabled={busy} className="pressBtn os-state" style={btn(true, true)}
                  onClick={async () => {
                    setBusy(true); setSaid(null);
                    const r = await potm.decide(nom.nominationId, "no_award", null, s.headSeq);
                    setBusy(false); setStep(null);
                    setSaid(r.ok ? { ok: true, text: NO_AWARD_DONE } : { ok: false, text: r.text ?? FALLBACK });
                  }}>{busy ? "Recording…" : "Record no award"}</button>
                <button type="button" data-testid="mc-potm-cancel" onClick={() => setStep(null)} className="pressBtn os-state" style={btn(false)}>Not now</button>
              </div>
            </div>
          )}
        </div>
      )}

      {s.mayAward && step !== "confirm" && (!nom || nom.status !== "open" || (open && another && !step)) && (
        <fieldset data-testid="mc-potm-choose" style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: T.space.sm }}>
          <legend style={{ ...small(), padding: 0, marginBottom: T.space.xs }}>
            Choose one boy from the side. <span data-testid="mc-potm-basis">{basis}</span>
          </legend>
          {(s.suggestions ?? []).length > 0
            ? <div data-testid="mc-potm-suggestions" style={{ display: "grid", gap: T.space.xs }}>{s.suggestions.map(option)}</div>
            : <p data-testid="mc-potm-no-suggestion" style={small()}>No one on the side has a run or a wicket to suggest him. Choose from the sheet.</p>}
          {rest.length > 0 && (
            <button type="button" data-testid="mc-potm-more" aria-expanded={more} onClick={() => setMore((v) => !v)}
              className="pressBtn os-state" style={{ ...btn(false), justifySelf: "start" }}>
              <Icon name="chevron-down"/> {more ? "Fewer" : "Someone else…"}
            </button>
          )}
          {more && <div data-testid="mc-potm-sheet" style={{ display: "grid", gap: T.space.xs }}>{rest.map(option)}</div>}
          <button type="button" data-testid="mc-potm-award" disabled={!pick || busy} onClick={() => { setSaid(null); setStep("confirm"); }}
            className="pressBtn os-state" style={{ ...btn(!!pick, true), justifySelf: "start", opacity: pick ? 1 : 0.6,
              cursor: pick ? "pointer" : "not-allowed" }}>
            {pick ? `Award to ${potmShortName(pick.name)}` : "Choose a player first"}
          </button>
        </fieldset>
      )}

      {s.mayAward && step === "confirm" && pick && (
        <div data-testid="mc-potm-confirm-sheet" style={{ display: "grid", gap: T.space.sm }}>
          <p data-testid="mc-potm-confirm-words" style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>{confirmWords(pick.name)}</p>
          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
            <button type="button" data-testid="mc-potm-confirm-go" disabled={busy} onClick={go} className="pressBtn os-state" style={btn(true, true)}>
              {busy ? "Awarding…" : "Award it"}</button>
            <button type="button" data-testid="mc-potm-cancel" onClick={() => setStep(null)} className="pressBtn os-state" style={btn(false)}>Not now</button>
          </div>
        </div>
      )}

      {said && (
        <p role="alert" data-testid="mc-potm-said" style={{ ...T.role.body, fontSize: "13px", margin: 0,
          color: said.ok ? T.semantic.positive : T.semantic.criticalText ?? T.semantic.critical }}>{said.text}</p>
      )}
    </div>
  );
}
