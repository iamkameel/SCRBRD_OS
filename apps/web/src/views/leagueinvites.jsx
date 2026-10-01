import { useEffect, useState } from "react";
import { T } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { holdsCapability } from "../rbac/index.js";
import { formatWhen } from "../lib/playingConditions.js";
import { entrantWords, leagueRefusal } from "../lib/league.js";
import { invitationsChanged } from "../lib/invitations.js";
import { Alert, styles } from "./playingconditions.jsx";
import { Said, Standing } from "./leagueui.jsx";

/**
 * Invitations to leagues (SCRBRD-127; docs/design/SCRBRD-123_planner.md §5.7).
 *
 * A league's organiser invites a school's team; the school answers from here,
 * on the Competitions screen: whoever arranges that side's fixtures
 * (`fixture.update` at the school and team) accepts or declines. The API lists
 * only the invitations the signed-in person may answer, and the organiser is
 * never among them, so this list is empty for a league administrator.
 *
 * WHAT THIS DECIDES: nothing. Accepting commits the side to fixtures made in
 * the school's name; the API and the database say who may, and a refusal is
 * worded here. Declining cannot be undone (an answer is given once, and the
 * league may invite the side afresh), so it asks once, in the page.
 *
 * There is no notification for an invitation yet (the API writes none), so
 * this panel is where a school finds one.
 */

/** @param {{ role: string, onAnswered?: () => void }} props */
export function LeagueInvitations({ role, onAnswered }) {
  const S = styles();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState(/** @type {{ loading: boolean, error: string | null, rows: any[] }} */ ({ loading: true, error: null, rows: [] }));
  const [asking, setAsking] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const [said, setSaid] = useState("");
  const live = signedIn();

  useEffect(() => {
    if (!live) return;
    let off = false;
    api("/api/competition-invitations")
      .then((d) => { if (!off) setState({ loading: false, error: null, rows: d.invitations ?? [] }); })
      .catch((e) => { if (!off) setState((s) => ({ ...s, loading: false, error: leagueRefusal(e) })); });
    return () => { off = true; };
  }, [live, nonce]);

  // Somebody who cannot arrange a school's fixtures has nothing to answer, and
  // a panel that only ever said so would be noise on their screen.
  const mayAnswer = holdsCapability(role, "fixture.update");
  if (!live || (!mayAnswer && state.rows.length === 0 && !said)) return null;

  async function answer(/** @type {any} */ inv, /** @type {boolean} */ accept) {
    setBusy(true); setErr(null);
    try {
      await api(`/api/competition-entrants/${inv.id}/${accept ? "accept" : "decline"}`, { method: "POST", body: {} });
      setSaid(accept ? `${inv.name} ${inv.teamCode} is now in ${inv.competitionName}.` : `${inv.name} ${inv.teamCode} declined ${inv.competitionName}.`);
      setAsking(null); setNonce((n) => n + 1); onAnswered?.(); invitationsChanged();
    } catch (/** @type {any} */ e) { setErr(leagueRefusal(e)); }
    finally { setBusy(false); }
  }

  return (
    <section data-testid="invitations" aria-label="Invitations to leagues" style={{ ...S.card, marginBottom: T.space.lg }}>
      <div>
        <h3 style={S.h3}>Invitations to leagues</h3>
        <p style={S.meta}>A league's organiser has invited one of your teams. Accepting puts the team in the league's fixtures. Only someone who arranges your school's fixtures may answer.</p>
      </div>
      <Said testid="invitations-status">{said}</Said>
      {state.loading && <p style={S.body}>Loading…</p>}
      <Alert words={state.error} testid="invitations-error"/>
      {!state.loading && !state.error && state.rows.length === 0 && <p data-testid="invitations-none" style={S.body}>No league is waiting for an answer.</p>}
      {state.rows.map((inv) => (
        <div key={inv.id} data-testid="invitation" data-invitation={`${inv.competitionName}: ${inv.name}`} style={S.row}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={S.wrap}>
              <span style={S.h4}>{inv.competitionName}</span>
              <Standing tone="warn">invited</Standing>
            </div>
            <p style={S.body}>{inv.name}, {inv.teamCode}{inv.invitedAt ? `. Invited ${formatWhen(inv.invitedAt)}.` : "."}</p>
            <p style={S.meta}>{entrantWords({ status: inv.status ?? "invited" }, false)}</p>
          </div>
          {asking !== inv.id && (
            <div style={S.wrap}>
              <button type="button" data-testid="invitation-accept" disabled={busy} aria-label={`Accept: ${inv.name} ${inv.teamCode} in ${inv.competitionName}`} onClick={() => answer(inv, true)} style={S.primary}>Accept</button>
              <button type="button" data-testid="invitation-decline" disabled={busy} aria-label={`Decline: ${inv.name} ${inv.teamCode} in ${inv.competitionName}`} onClick={() => { setAsking(inv.id); setErr(null); }} style={S.secondary}>Decline</button>
            </div>
          )}
          {asking === inv.id && (
            <div role="group" aria-label={`Decline ${inv.competitionName}`} data-testid="invitation-decline-confirm" style={{ ...S.confirm, width: "100%" }}>
              <p style={{ ...S.body, color: T.content.primary }}>Decline {inv.competitionName} for {inv.name} {inv.teamCode}? An answer is given once. The league may invite the team again.</p>
              <div style={S.wrap}>
                <button type="button" data-testid="invitation-decline-yes" disabled={busy} onClick={() => answer(inv, false)} style={S.danger}>Decline the invitation</button>
                <button type="button" data-testid="invitation-decline-no" onClick={() => setAsking(null)} style={S.secondary}>Keep it open</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <Alert words={err} testid="invitations-answer-error"/>
    </section>
  );
}
