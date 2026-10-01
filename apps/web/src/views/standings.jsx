import { useEffect, useState } from "react";
import { T } from "../design/tokens.js";
import { api, signedIn } from "../lib/api.js";
import { formatWhen } from "../lib/playingConditions.js";
import {
  adjustmentKinds, basisWords, decisionChoices, decisionWords, nrrText, orderWords, overRateWords, pointsText, resultsRefusal,
} from "../lib/standings.js";
import { Alert, Field, styles } from "./playingconditions.jsx";
import { Said, Standing, selectStyle } from "./leagueui.jsx";

/**
 * A league's table, its results, and what the organiser decides about them
 * (SCRBRD-114 phase 3a; docs/design/SCRBRD-114_phase3_results_super_over.md
 * §2, §6). Opened from the Competitions screen for a competition on the
 * server.
 *
 * WHAT THIS DECIDES: nothing. The table is db/69's competition_standing,
 * computed on every read from each match's result under that match's own
 * frozen table figures — or, where the league's points are not confirmed, the
 * figures the schools typed, said so. Every write here is a db/69 function's
 * to refuse, and a refusal is worded (lib/standings.js):
 *
 *   the decision sheet     a concession, a walkover, an organiser's award (one
 *                          standing at a time; withdrawn with a note, never
 *                          deleted) — the league's competition.manage, or a
 *                          friendly's home school
 *   the adjustment sheet   points entered, never computed: conduct, a
 *                          correction, and an over-rate penalty only where the
 *                          league counts them in points (over_rate.kind)
 *   the table figures      a played match's points re-fixed from a named
 *                          version, with a reason; play never moves
 *
 * A reason typed here is read by every school in the league and by nobody
 * signed out: the sheets ask for the side, never a boy. Type is 12px at the
 * least and every control 44px, in both themes.
 */

/** @param {{ competition: { id: string, name: string } }} props */
export function Standings({ competition }) {
  const S = styles();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState(/** @type {{ loading: boolean, error: string | null, data: any }} */ ({ loading: true, error: null, data: null }));
  const [open, setOpen] = useState(/** @type {string | null} */ (null));   // "adjust", "decide:<id>", "refix:<id>"
  const [said, setSaid] = useState("");
  const live = signedIn();

  useEffect(() => {
    if (!live) return undefined;
    let off = false;
    api(`/api/competitions/${competition.id}/standings`)
      .then((d) => { if (!off) setState({ loading: false, error: null, data: d }); })
      .catch((e) => { if (!off) setState({ loading: false, error: resultsRefusal(e), data: null }); });
    return () => { off = true; };
  }, [live, competition.id, nonce]);

  if (!live) return null;
  const d = state.data;
  /** @param {string} words */
  const done = (words) => { setSaid(words); setOpen(null); setNonce((n) => n + 1); };

  /** @type {{key: string, label: string, rows: any[]}[]} */
  const groups = [];
  for (const r of d?.rows ?? []) {
    const key = r.divisionId ?? "none";
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, label: r.division ?? "", rows: [] }; groups.push(g); }
    g.rows.push(r);
  }
  const anyDrawn = (d?.rows ?? []).some((/** @type {any} */ r) => r.drawn > 0);
  const head = ["#", "Side", "P", "W", "L", "T", ...(anyDrawn ? ["D"] : []), "NR", "Pts", "NRR"];
  const th = { padding: "8px 10px", fontFamily: T.type.body, fontSize: "12px", fontWeight: 600, color: T.content.secondary, textAlign: /** @type {const} */ ("center"), whiteSpace: /** @type {const} */ ("nowrap") };
  const td = { padding: "10px", fontFamily: T.type.mono, fontSize: "14px", color: T.content.primary, textAlign: /** @type {const} */ ("center") };

  return (
    <section data-testid="standings" aria-label={`The table: ${competition.name}`} style={{ ...S.card, marginBottom: T.space.lg }}>
      <div>
        <h3 style={S.h3}>The table</h3>
        {d && <p data-testid="standings-basis" data-basis={d.basis ?? ""} style={S.body}>{basisWords(d.basis)}</p>}
        {d && <p data-testid="standings-order" style={S.meta}>{orderWords(d.order)}</p>}
      </div>
      <Said testid="standings-said">{said}</Said>
      {state.loading && <p style={S.body}>Loading the table…</p>}
      <Alert words={state.error} testid="standings-error"/>
      {d && d.rows.length === 0 && <p data-testid="standings-empty" style={S.body}>No side has accepted a place in this league yet.</p>}
      {groups.map((g) => (
        <div key={g.key} data-testid={`standings-division-${g.key}`}>
          {groups.length > 1 && <h4 style={{ ...S.h4, margin: `${T.space.sm} 0` }}>{g.label || "Not yet placed"}</h4>}
          <div style={{ overflowX: "auto", maxWidth: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "460px" }}>
              <thead><tr>{head.map((h) => <th key={h} scope="col" style={{ ...th, textAlign: h === "Side" ? "left" : "center" }}>{h}</th>)}</tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.entrantId} data-testid="standings-row" data-side={r.side} data-points={r.points ?? ""} data-rank={r.rank ?? ""}
                    style={{ borderTop: `1px solid ${T.line.normal}` }}>
                    <td style={{ ...td, color: r.rank === 1 ? T.brand.accentText : T.content.secondary, fontWeight: 600 }}>{r.rank ?? "—"}</td>
                    <td style={{ ...td, fontFamily: T.type.body, textAlign: "left" }}>
                      {r.side}
                      {r.conditionsAdjusted > 0 && <span style={{ marginLeft: T.space.sm }}><Standing tone="info" testid="standings-adjusted">conditions adjusted</Standing></span>}
                      {r.adjustmentPoints ? <span data-testid="standings-adjustment" style={{ ...S.meta, display: "block" }}>{r.adjustmentPoints > 0 ? "+" : "−"}{pointsText(Math.abs(r.adjustmentPoints))} adjusted</span> : null}
                    </td>
                    <td style={td}>{r.played}</td><td style={td}>{r.won}</td><td style={td}>{r.lost}</td><td style={td}>{r.tied}</td>
                    {anyDrawn && <td style={td}>{r.drawn}</td>}
                    <td style={td}>{r.noResult}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{pointsText(r.points)}</td>
                    <td style={{ ...td, color: T.content.secondary }}>{nrrText(r.nrr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {d && (
        <div data-testid="standings-results" style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
          <h4 style={S.h4}>Results</h4>
          {d.results.length === 0 && <p style={S.body}>No match has been played in this league yet.</p>}
          {d.results.map((/** @type {any} */ r) => (
            <div key={r.matchId} data-testid="result-row" data-match={r.matchId} style={S.row}>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <p style={S.meta}>{formatWhen(r.startsAt)}</p>
                <p style={{ ...S.body, color: T.content.primary }}>{r.home} v {r.away}</p>
                <p data-testid="result-text" style={{ ...S.body, fontWeight: 600, color: T.content.primary }}>
                  {r.text ?? (r.status === "scheduled" ? "To be played" : "In progress")}
                </p>
                <span style={S.wrap}>
                  {r.decidedBy === "decision" && <Standing tone="warn" testid="result-decided">decided by the organiser</Standing>}
                  {r.decision && !r.decisionApplied && <Standing tone="quiet" testid="result-decision-shown">{decisionWords(r.decision, { home: r.home, away: r.away })} Play stands.</Standing>}
                  {r.conditionsAdjusted && <Standing tone="info">conditions adjusted</Standing>}
                </span>
              </div>
              <div style={S.wrap}>
                {r.canDecide && open !== `decide:${r.matchId}` && (
                  <button type="button" data-testid="decision-open" onClick={() => setOpen(`decide:${r.matchId}`)} style={S.secondary}
                    aria-label={`A decision about ${r.home} v ${r.away}`}>{r.decision ? "The decision" : "Record a decision"}</button>
                )}
                {d.canAdjust && (d.versions ?? []).length > 0 && r.documented && open !== `refix:${r.matchId}` && (
                  <button type="button" data-testid="refix-open" onClick={() => setOpen(`refix:${r.matchId}`)} style={S.secondary}
                    aria-label={`The table figures for ${r.home} v ${r.away}`}>Table figures</button>
                )}
              </div>
              {open === `decide:${r.matchId}` && <DecisionSheet row={r} onDone={done} onCancel={() => setOpen(null)}/>}
              {open === `refix:${r.matchId}` && <RefixSheet row={r} versions={d.versions} onDone={done} onCancel={() => setOpen(null)}/>}
            </div>
          ))}
        </div>
      )}

      {d && (d.canAdjust || d.adjustments.length > 0) && (
        <div data-testid="standings-adjustments" style={{ display: "flex", flexDirection: "column", gap: T.space.sm }}>
          <h4 style={S.h4}>Points adjustments</h4>
          {overRateWords(d.overRateKind) && <p data-testid="over-rate-words" style={S.meta}>{overRateWords(d.overRateKind)}</p>}
          {d.adjustments.length === 0 && <p style={S.body}>None.</p>}
          {d.adjustments.map((/** @type {any} */ a) => <AdjustmentRow key={a.id} a={a} canAdjust={d.canAdjust} onDone={done}/>)}
          {d.canAdjust && open !== "adjust" && (
            <div><button type="button" data-testid="adjust-open" onClick={() => setOpen("adjust")} style={S.secondary}>Adjust points</button></div>
          )}
          {open === "adjust" && <AdjustmentSheet data={d} competitionId={competition.id} onDone={done} onCancel={() => setOpen(null)}/>}
        </div>
      )}
    </section>
  );
}

/** One adjustment: who, how many, why, who entered it; withdrawn with a note. */
function AdjustmentRow({ a, canAdjust, onDone }) {
  const S = styles();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const withdrawn = a.withdrawnAt != null;
  async function withdraw() {
    setBusy(true); setErr(null);
    try { await api(`/api/points-adjustments/${a.id}/withdraw`, { method: "POST", body: { note } }); onDone(`The adjustment to ${a.side} is withdrawn.`); }
    catch (/** @type {any} */ e) { setErr(resultsRefusal(e)); }
    finally { setBusy(false); }
  }
  return (
    <div data-testid="adjustment-row" data-withdrawn={withdrawn ? "yes" : "no"} style={S.row}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <p style={{ ...S.body, color: T.content.primary, textDecoration: withdrawn ? "line-through" : "none" }}>
          {a.side}: {a.points > 0 ? "+" : "−"}{pointsText(Math.abs(a.points))} ({a.kind.replace("_", " ")})
        </p>
        <p style={S.body}>{a.reason}{a.sourceClause ? ` (${a.sourceClause})` : ""}</p>
        <p style={S.meta}>Entered{a.setByName ? ` by ${a.setByName}` : ""} {formatWhen(a.setAt)}{withdrawn ? `. Withdrawn: ${a.withdrawnNote}` : ""}</p>
      </div>
      {canAdjust && !withdrawn && !asking && (
        <button type="button" data-testid="adjustment-withdraw-open" onClick={() => setAsking(true)} style={S.secondary}>Withdraw</button>
      )}
      {asking && (
        <div role="group" aria-label="Withdraw the adjustment" style={{ ...S.confirm, width: "100%" }}>
          <Field label="Why is it withdrawn?" grow>{(id) => (
            <input id={id} data-testid="adjustment-withdraw-note" value={note} onChange={(e) => setNote(e.target.value)} style={S.input}/>
          )}</Field>
          <div style={S.wrap}>
            <button type="button" data-testid="adjustment-withdraw" disabled={busy} onClick={withdraw} style={S.danger}>Withdraw it</button>
            <button type="button" onClick={() => setAsking(false)} style={S.secondary}>Keep it</button>
          </div>
          <Alert words={err} testid="adjustment-withdraw-error"/>
        </div>
      )}
    </div>
  );
}

/** The adjustment sheet: a side, a kind, the points, the reason. */
function AdjustmentSheet({ data, competitionId, onDone, onCancel }) {
  const S = styles();
  const kinds = adjustmentKinds(data.overRateKind);
  const [entrantId, setEntrant] = useState(data.rows[0]?.entrantId ?? "");
  const [kind, setKind] = useState(kinds[0]?.value ?? "conduct");
  const [points, setPoints] = useState("");
  const [matchId, setMatch] = useState("");
  const [reason, setReason] = useState("");
  const [clause, setClause] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  async function save() {
    setBusy(true); setErr(null);
    try {
      await api(`/api/competitions/${competitionId}/adjustments`, { method: "POST",
        body: { entrantId, matchId: matchId || null, kind, points: Number(points), reason, sourceClause: clause || null } });
      const side = data.rows.find((/** @type {any} */ r) => r.entrantId === entrantId)?.side ?? "the side";
      onDone(`${Number(points) > 0 ? "+" : "−"}${pointsText(Math.abs(Number(points)))} to ${side}. The table has it.`);
    } catch (/** @type {any} */ e) { setErr(resultsRefusal(e)); }
    finally { setBusy(false); }
  }
  return (
    <div role="group" aria-label="Adjust points" data-testid="adjust-sheet" style={S.editor}>
      <h4 style={S.h4}>Adjust points</h4>
      <p style={S.meta}>Points are entered, never worked out: the figure the umpires or the league decided. Name the side, never a boy: every school in the league reads this.</p>
      <div style={S.wrap}>
        <Field label="Side" grow>{(id) => (
          <select id={id} data-testid="adjust-side" value={entrantId} onChange={(e) => setEntrant(e.target.value)} style={selectStyle()}>
            {data.rows.map((/** @type {any} */ r) => <option key={r.entrantId} value={r.entrantId}>{r.side}</option>)}
          </select>
        )}</Field>
        <Field label="Kind" grow>{(id) => (
          <select id={id} data-testid="adjust-kind" value={kind} onChange={(e) => setKind(e.target.value)} style={selectStyle()}>
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        )}</Field>
        <Field label="Points (−2 for a deduction)">{(id) => (
          <input id={id} data-testid="adjust-points" type="number" step="0.5" inputMode="decimal" value={points}
            onChange={(e) => setPoints(e.target.value)} style={{ ...S.input, width: "140px" }}/>
        )}</Field>
      </div>
      <Field label="The match, if it was one" grow>{(id) => (
        <select id={id} data-testid="adjust-match" value={matchId} onChange={(e) => setMatch(e.target.value)} style={selectStyle()}>
          <option value="">The season, not one match</option>
          {data.results.map((/** @type {any} */ r) => <option key={r.matchId} value={r.matchId}>{r.home} v {r.away}</option>)}
        </select>
      )}</Field>
      <Field label="Why" grow>{(id) => (
        <input id={id} data-testid="adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} style={S.input}/>
      )}</Field>
      <Field label="The rule it is under (optional)" grow>{(id) => (
        <input id={id} data-testid="adjust-clause" value={clause} onChange={(e) => setClause(e.target.value)} style={S.input}/>
      )}</Field>
      <div style={S.wrap}>
        <button type="button" data-testid="adjust-save" disabled={busy} onClick={save} style={S.primary}>Enter the adjustment</button>
        <button type="button" onClick={onCancel} style={S.secondary}>Cancel</button>
      </div>
      <Alert words={err} testid="adjust-error"/>
    </div>
  );
}

/** The decision sheet for one match: the standing decision, or a new one. */
function DecisionSheet({ row, onDone, onCancel }) {
  const S = styles();
  const names = { home: row.home, away: row.away };
  const choices = decisionChoices(row, row.played !== false);
  const [kind, setKind] = useState(choices.kinds[0].value);
  const [side, setSide] = useState("home");
  const [overrides, setOverrides] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  const sideLabel = choices.kinds.find((k) => k.value === kind)?.side ?? "Side";
  const standing = row.decision;

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api(`/api/matches/${row.matchId}/result-decision`, { method: "POST",
        body: { kind, side, reason, overridesPlay: kind === "awarded" && overrides } });
      onDone(`Recorded: ${decisionWords({ kind, side, overridesPlay: kind === "awarded" && overrides }, names)}`);
    } catch (/** @type {any} */ e) { setErr(resultsRefusal(e)); }
    finally { setBusy(false); }
  }
  async function withdraw() {
    setBusy(true); setErr(null);
    try {
      await api(`/api/result-decisions/${standing.id}/withdraw`, { method: "POST", body: { note } });
      onDone(`The decision about ${row.home} v ${row.away} is withdrawn. The result is play's again.`);
    } catch (/** @type {any} */ e) { setErr(resultsRefusal(e)); }
    finally { setBusy(false); }
  }

  return (
    <div role="group" aria-label={`A decision: ${row.home} v ${row.away}`} data-testid="decision-sheet" style={S.editor}>
      <h4 style={S.h4}>{standing ? "The decision" : "Record a decision"}</h4>
      {standing ? (
        <>
          <p data-testid="decision-standing" style={{ ...S.body, color: T.content.primary }}>{decisionWords(standing, names)}</p>
          {standing.reason && <p style={S.body}>{standing.reason}</p>}
          <p style={S.meta}>A decision is never changed: withdraw it, with a note, and record another.</p>
          <Field label="Why is it withdrawn?" grow>{(id) => (
            <input id={id} data-testid="decision-withdraw-note" value={note} onChange={(e) => setNote(e.target.value)} style={S.input}/>
          )}</Field>
          <div style={S.wrap}>
            <button type="button" data-testid="decision-withdraw" disabled={busy} onClick={withdraw} style={S.danger}>Withdraw the decision</button>
            <button type="button" onClick={onCancel} style={S.secondary}>Close</button>
          </div>
        </>
      ) : (
        <>
          <p style={S.meta}>For what was decided off the field: a side conceded, a side did not arrive, or the organiser decided a match play could not. The result played is shown beside it. Name the side, never a boy: every school in the league reads the reason, and nobody signed out does.</p>
          <div role="radiogroup" aria-label="What was decided" style={S.wrap}>
            {choices.kinds.map((k) => (
              <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} data-testid={`decision-kind-${k.value}`}
                onClick={() => { setKind(k.value); if (k.value !== "awarded") setOverrides(false); }} style={S.toggle(kind === k.value)}>{k.label}</button>
            ))}
          </div>
          <div role="radiogroup" aria-label={sideLabel} style={S.wrap}>
            <span style={S.label}>{sideLabel}</span>
            {(/** @type {("home" | "away")[]} */ (["home", "away"])).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={side === s} data-testid={`decision-side-${s}`}
                onClick={() => setSide(s)} style={S.toggle(side === s)}>{names[s]}</button>
            ))}
          </div>
          {kind === "awarded" && choices.overridable && (
            <label style={{ ...S.wrap, minHeight: "44px", cursor: "pointer" }}>
              <input type="checkbox" data-testid="decision-override" checked={overrides} onChange={(e) => setOverrides(e.target.checked)}
                style={{ width: "22px", height: "22px" }}/>
              <span style={S.body}>This sets aside the result played: {row.text}. (A protest upheld.)</span>
            </label>
          )}
          <Field label="Why" grow>{(id) => (
            <input id={id} data-testid="decision-reason" value={reason} onChange={(e) => setReason(e.target.value)} style={S.input}/>
          )}</Field>
          <div style={S.wrap}>
            <button type="button" data-testid="decision-save" disabled={busy} onClick={save} style={S.primary}>Record the decision</button>
            <button type="button" onClick={onCancel} style={S.secondary}>Cancel</button>
          </div>
        </>
      )}
      <Alert words={err} testid="decision-error"/>
    </div>
  );
}

/** A played match's table figures, re-fixed from a named version with a reason. */
function RefixSheet({ row, versions, onDone, onCancel }) {
  const S = styles();
  const [setId, setSet] = useState(versions[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(/** @type {string | null} */ (null));
  async function save() {
    setBusy(true); setErr(null);
    try {
      await api(`/api/matches/${row.matchId}/playing-conditions/refix-table`, { method: "POST", body: { setId, reason } });
      onDone(`${row.home} v ${row.away} now counts under the version chosen. Its play is as it was.`);
    } catch (/** @type {any} */ e) { setErr(resultsRefusal(e)); }
    finally { setBusy(false); }
  }
  return (
    <div role="group" aria-label={`Table figures: ${row.home} v ${row.away}`} data-testid="refix-sheet" style={S.editor}>
      <h4 style={S.h4}>Table figures for this match</h4>
      <p style={S.meta}>The points this match counts for, from a published version of the league's conditions. What was played never changes; the figures it replaces are kept beside it.</p>
      <Field label="Version" grow>{(id) => (
        <select id={id} data-testid="refix-version" value={setId} onChange={(e) => setSet(e.target.value)} style={selectStyle()}>
          {versions.map((/** @type {any} */ v) => <option key={v.id} value={v.id}>Version {v.version}: {v.title} (from {v.effectiveFrom})</option>)}
        </select>
      )}</Field>
      <Field label="Why" grow>{(id) => (
        <input id={id} data-testid="refix-reason" value={reason} onChange={(e) => setReason(e.target.value)} style={S.input}/>
      )}</Field>
      <div style={S.wrap}>
        <button type="button" data-testid="refix-save" disabled={busy} onClick={save} style={S.primary}>Re-fix the figures</button>
        <button type="button" onClick={onCancel} style={S.secondary}>Cancel</button>
      </div>
      <Alert words={err} testid="refix-error"/>
    </div>
  );
}
