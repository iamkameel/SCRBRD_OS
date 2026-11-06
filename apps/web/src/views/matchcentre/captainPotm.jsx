import { useCallback, useEffect, useState } from "react";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { captainLead, mineWords, nominateConfirmWords, nominateLabel } from "../../lib/nomination.js";
import { FALLBACK } from "../../lib/potm.js";
import { Panel } from "./bits.jsx";

/**
 * PLAYER OF THE MATCH on the Captain tab (RECOGNITION R7, D17; db/144): the
 * pupil captain nominates one team-mate, and reads his own nomination's state.
 *
 * DRAWN BY THE SERVER'S ANSWER. GET /api/matches/:id/player-of-match/nomination
 * answers a side only to the boy who captains it this season, signed in as
 * himself; the picker is drawn only while D16's gate passes (mayNominate),
 * and his own row's state whenever he has one. Nothing else: no refusal is
 * shown to him as a refusal; a closed window or a decided award simply has
 * no picker.
 *
 * WHAT IT DRAWS. The same suggestions the coach sees, with the figures he
 * already reads on the scorecard, never pre-selected; "Someone else…" opens
 * the rest of his side's sheet; he is not on either list. One confirm sheet,
 * then his row. No text field: a nomination is a choice, not a message
 * (SG-9).
 *
 * WHAT IT NEVER DRAWS (§7): the opposition's boys, the coach's reason,
 * "rejected", "declined", "overruled", any other nomination.
 *
 * Floors: 12px text and up, 44px targets, 56px for the one tap, a radio and
 * words for a choice (never colour alone); nothing moves.
 */

/** @param {{match: any}} p */
export function CaptainPotm({ match }) {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!signedIn() || !match?.id) { setData(null); return undefined; }
    let cancelled = false;
    api(`/api/matches/${match.id}/player-of-match/nomination`)
      .then((d) => { if (!cancelled) setData(d ?? null); })
      .catch(() => { if (!cancelled) setData((x) => x); });
    return () => { cancelled = true; };
  }, [match?.id, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  const sides = (data?.captain ?? []).filter((/** @type {any} */ s) => s.mayNominate || s.mine);
  if (!sides.length) return null;
  return (
    <>
      {sides.map((/** @type {any} */ s) => (
        <CaptainPotmSide key={s.side} s={s} basis={data.basis} matchId={match.id} reload={reload}/>
      ))}
    </>
  );
}

const btn = (/** @type {boolean} */ strong, tall = false) => ({
  minHeight: tall ? "56px" : "44px", padding: `0 ${T.space.lg}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
  cursor: "pointer", borderRadius: T.radius.pill, fontFamily: T.type.body, fontSize: "14px", fontWeight: 600,
  background: strong ? T.brand.green : "transparent", color: strong ? T.surface.canvas : T.content.primary,
  border: strong ? "none" : `1px solid ${T.line.normal}`,
});
const row = () => ({
  minHeight: "44px", display: "flex", alignItems: "center", gap: T.space.sm, padding: `${T.space.xs} ${T.space.sm}`,
  border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, cursor: "pointer",
  color: T.content.primary, fontFamily: T.type.body, fontSize: "14px",
});
const small = () => ({ ...T.role.body, fontSize: "13px", color: T.content.secondary, margin: 0 });

/** @param {{s: any, basis: string, matchId: string, reload: () => void}} p */
function CaptainPotmSide({ s, basis, matchId, reload }) {
  const [chosen, setChosen] = useState(/** @type {string | null} */ (null));
  const [more, setMore] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {string | null} */ (null));
  const now = Date.now();

  const suggested = new Set((s.suggestions ?? []).map((/** @type {any} */ x) => x.playerId));
  const rest = (s.sheet ?? []).filter((/** @type {any} */ x) => !suggested.has(x.playerId));
  const pick = [...(s.suggestions ?? []), ...rest].find((x) => x.playerId === chosen) ?? null;

  const go = async () => {
    if (!pick) return;
    setBusy(true); setSaid(null);
    try {
      await api(`/api/matches/${matchId}/player-of-match/nomination`, { method: "POST", body: { playerId: pick.playerId, headSeq: s.headSeq } });
      setChosen(null); setMore(false); setConfirm(false);
    } catch (/** @type {any} */ e) {
      setConfirm(false);
      setSaid(e?.data?.message ?? FALLBACK);
    }
    setBusy(false);
    reload();
  };

  /** @param {any} x */
  const option = (x) => (
    <label key={x.playerId} data-testid={`mc-captain-potm-option-${x.playerId}`} style={row()}>
      <input type="radio" name={`captain-potm-${s.side}`} value={x.playerId} checked={chosen === x.playerId} disabled={busy}
        onChange={() => { setChosen(x.playerId); setSaid(null); }} style={{ width: "20px", height: "20px", margin: 0, flex: "none" }}/>
      <span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
        <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{x.name}</span>
        {x.figures && <span style={{ fontSize: "13px", color: T.content.secondary }}>{x.figures}</span>}
      </span>
    </label>
  );

  const lines = mineWords(s.mine, s.coachName, now);
  return (
    <Panel testid="mc-captain-potm">
      <div style={{ padding: `${T.space.md} ${T.space.lg}`, display: "grid", gap: T.space.sm }}>
        <h2 style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>Player of the Match</h2>

        {s.mayNominate && !confirm && (
          <fieldset data-testid="mc-captain-potm-choose" style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: T.space.sm }}>
            <legend style={{ ...T.role.body, color: T.content.primary, padding: 0, marginBottom: T.space.xs }}>
              <span data-testid="mc-captain-potm-lead">{captainLead(s.coachName)}</span>
              {" "}<span data-testid="mc-captain-potm-basis" style={{ color: T.content.secondary }}>{basis}</span>
            </legend>
            {(s.suggestions ?? []).length > 0
              ? <div data-testid="mc-captain-potm-suggestions" style={{ display: "grid", gap: T.space.xs }}>{s.suggestions.map(option)}</div>
              : <p data-testid="mc-captain-potm-no-suggestion" style={small()}>No team-mate has a run or a wicket to suggest him. Choose from the sheet.</p>}
            {rest.length > 0 && (
              <button type="button" data-testid="mc-captain-potm-more" aria-expanded={more} onClick={() => setMore((v) => !v)}
                className="pressBtn os-state" style={{ ...btn(false), justifySelf: "start" }}>
                {more ? "Fewer" : "Someone else…"}
              </button>
            )}
            {more && <div data-testid="mc-captain-potm-sheet" style={{ display: "grid", gap: T.space.xs }}>{rest.map(option)}</div>}
            <button type="button" data-testid="mc-captain-potm-nominate" disabled={!pick || busy} onClick={() => { setSaid(null); setConfirm(true); }}
              className="pressBtn os-state" style={{ ...btn(!!pick, true), justifySelf: "end", opacity: pick ? 1 : 0.6, cursor: pick ? "pointer" : "not-allowed" }}>
              {nominateLabel(pick?.name)}
            </button>
          </fieldset>
        )}

        {s.mayNominate && confirm && pick && (
          <div data-testid="mc-captain-potm-confirm-sheet" style={{ display: "grid", gap: T.space.sm }}>
            <p data-testid="mc-captain-potm-confirm-words" style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>
              {nominateConfirmWords(pick.name, s.coachName)}
            </p>
            <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
              <button type="button" data-testid="mc-captain-potm-confirm-go" disabled={busy} onClick={go} className="pressBtn os-state" style={btn(true, true)}>
                {busy ? "Sending…" : nominateLabel(pick.name)}</button>
              <button type="button" data-testid="mc-captain-potm-cancel" onClick={() => setConfirm(false)} className="pressBtn os-state" style={btn(false)}>Not now</button>
            </div>
          </div>
        )}

        {lines.length > 0 && (
          <div data-testid="mc-captain-potm-mine" data-status={s.mine?.status} style={{ display: "grid", gap: "2px" }}>
            {lines.map((l, i) => (
              <p key={i} style={i === 0 ? { ...T.role.body, color: T.content.primary, margin: 0, fontWeight: 600 } : small()}>{l}</p>
            ))}
          </div>
        )}

        {said && <p role="alert" data-testid="mc-captain-potm-said" style={{ ...small(), color: T.semantic.criticalText ?? T.semantic.critical }}>{said}</p>}
      </div>
    </Panel>
  );
}
