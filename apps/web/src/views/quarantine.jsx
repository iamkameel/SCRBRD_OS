import { useEffect, useState } from "react";
import { D, textOn } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { holdsCapability } from "../rbac/index.js";
import { Btn, Card } from "../ui/primitives.jsx";
import { DISMISSAL_LABEL } from "@scrbrd/scoring";

/**
 * The set-aside balls, as a second scorer's book beside the match's.
 * SCRBRD-003; docs/design/TWO_PHONES.md slice 2 (R5, R6).
 *
 * A phone that scored under a pen it did not hold kept a second account of
 * the match. Its balls were set aside, never merged. This panel lines that
 * account up against the pen's book (`GET /api/matches/:id/second-account`,
 * folded in the API by the fold the server judges by) — the pen's ball, the
 * other phone's ball, and whether they agree, differ, or the pen has no ball
 * there — and offers the three decisions, none of them made by default:
 *
 *   Pen stands                 the other phone's ball is set aside for good,
 *                              compared with the pen's and with a reason; for
 *                              every ball that agrees, one tap.
 *   Pen missed this ball       released: written at the END of the innings'
 *                              log (db/14), the Laws judged first.
 *   The other phone was right  an amendment of the pen's ball is asked for,
 *                              for a second person to approve; never a swap.
 *
 * Before this, every set-aside ball had a Release button, and releasing a
 * ball the pen also scored appended it: the over counted twice.
 *
 * Offered only to whoever holds `scoring.amend.approve` — a courtesy that
 * decides what to DRAW, never what to allow. `quarantine_resolve()` (db/136)
 * checks its own authority per match, and refuses the sender of a ball
 * (cannot_release_your_own) and the scorer of any ball in the match's record
 * (you_scored_this_match). The server answers a refusal on a 200 with
 * `{ok: false, reason}`; every answer is read, and a refusal is said.
 *
 * No motion: nothing here animates, so prefers-reduced-motion has nothing to
 * stop. Every state is said in words beside its colour; every control is 44px
 * to tap; nothing is under 12px.
 */
const REFUSAL = {
  not_permitted: "You do not hold the approval capability for this match.",
  cannot_release_your_own: "You sent this ball yourself — somebody else has to decide it.",
  you_scored_this_match: "You scored balls in this match's record, so you are a party to the difference and may not decide it. Another person who approves corrections, or the platform, must decide.",
  already_accepted: "Somebody already released this ball.",
  already_rejected: "Somebody already set this ball aside.",
  already_superseded: "The scorer's device sent this ball again and it is already in the log.",
  already_recorded: "That ball is already in the log by another road; nothing was written.",
  idempotency_conflict: "A different ball is already in the log under this ball's id. Nothing was written — set this one aside.",
  no_such_quarantine: "That row is gone.",
  no_such_counterpart: "The pen's ball it was compared with is not in this match's record.",
  row_required: "Could not rebuild the delivery — nothing was written.",
  dismissal_unknown: "The dismissal on this ball is not one of the recognised kinds.",
  note_required: "Say why first: what the paper book or the umpires say.",
  not_open_here: "The two accounts have changed since you opened them. Look again.",
  cannot_request: "Asking for an amendment needs the scorer's capability to request one. Ask a scorer to request it, then set this ball aside as \"Pen stands\".",
  no_counterpart: "The pen has no ball here to amend. If the other phone's ball happened, the pen missed it.",
  one_ball_at_a_time: "Decide one ball at a time.",
};

/**
 * A released ball meets the Laws, as a live one does (SCRBRD-071, db/37). The
 * server answers `{ ok: false, reason: "laws_refused", law, text }`, where
 * `text` is lawsRefusal()'s own words. Nothing was written and the ball is
 * still held; what happens to it is the approver's call.
 */
const lawsSaid = (res) => `The Laws refuse this ball: ${res.text ?? res.law}. Nothing was written. `
  + "Set it aside, or leave it held until the scorecard allows it.";

/** What was actually sitting in quarantine, for a decision made with eyes open. */
function describeBall(body) { return describeEvent(body?.payload); }

/** The same, from the event itself (the Corrections sheet's held rows, GA-I36). */
function describeEvent(ev) {
  const p = ev ?? {};
  if ((p.kind ?? "ball") !== "ball") return p.kind ?? "event";
  switch (p.type) {
    case "W":  return `Wicket — ${DISMISSAL_LABEL[p.dismissal] ?? p.dismissal ?? "unspecified"}${p.fielder ? ` (${p.fielder})` : ""}`;
    case "Wd": return "Wide ball";
    case "Nb": return `No ball, ${p.value ?? 0} run${p.value === 1 ? "" : "s"}`;
    case "B":  return `Bye, ${p.value ?? 0} run${p.value === 1 ? "" : "s"}`;
    case "LB": return `Leg bye, ${p.value ?? 0} run${p.value === 1 ? "" : "s"}`;
    default:   return `${p.value ?? 0} run${p.value === 1 ? "" : "s"}`;
  }
}

/** Each state in words, with a mark that is not its colour alone. */
const STATUS = {
  agrees:  { mark: "=", words: "Agrees", tone: () => D.textMuted },
  differs: { mark: "≠", words: "Differs", tone: () => textOn(D.amber) },
  missing: { mark: "+", words: "Pen has no ball here", tone: () => textOn(D.amber) },
};

const overs = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;
const book = (t) => `${t.runs}/${t.wickets} (${overs(t.balls)})`;
const small = { fontFamily: D.body, fontSize: "12px", lineHeight: 1.45 };

function QuarantinePanel({ matchId, role }) {
  const canApprove = holdsCapability(role, "scoring.amend.approve");
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [busy, setBusy] = useState(null);
  const [said, setSaid] = useState({});
  const [notes, setNotes] = useState({});

  useEffect(() => {
    if (!canApprove || !matchId) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const data = await api(`/api/matches/${matchId}/second-account`);
        if (!cancelled) setState({ data, loading: false, error: null });
      } catch (e) {
        if (!cancelled) setState({ data: null, loading: false, error: e.code || e.message || "unreachable" });
      }
    })();
    return () => { cancelled = true; };
  }, [matchId, canApprove, nonce]);

  // A courtesy, not the gate: the route and quarantine_resolve() decide.
  if (!canApprove) return null;
  if (state.error === "not_permitted") return null;
  const head = (
    <div style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.textPrimary }}>Set-aside balls</div>
  );
  if (state.loading || state.error) {
    return (
      <Card sx={{ padding: "14px", marginTop: "12px" }} data-testid="quarantine-panel">
        <div style={{ marginBottom: "6px" }}>{head}</div>
        <div style={{ ...small, color: state.error ? textOn(D.rose) : D.textMuted }}>
          {state.loading ? "Loading…" : `Could not load the set-aside balls (${state.error}).`}
        </div>
      </Card>
    );
  }

  const { viewer = {}, accounts = [], open = 0 } = state.data ?? {};
  const say = (key, v) => setSaid((s) => ({ ...s, [key]: v }));
  const refusal = (res) => REFUSAL[res?.reason]
    ?? (res?.text ? `The record cannot hold this ball: ${res.text}. Nothing was written — set it aside.` : null)
    ?? res?.reason ?? "Refused.";

  /** One decision; `fn` returns the server's answer. A refusal is said on `key`. */
  const decide = async (key, fn) => {
    setBusy(key); say(key, null);
    try {
      const res = await fn();
      if (res?.reason === "laws_refused") say(key, { text: lawsSaid(res), laws: true });
      else if (!res?.ok) say(key, refusal(res));
      else setNonce((n) => n + 1);
    } catch (e) {
      say(key, REFUSAL[e.code] ?? e.message ?? "Refused.");
    } finally {
      setBusy(null);
    }
  };
  const penStands = (key, ids, note) => decide(key, () =>
    api(`/api/matches/${matchId}/second-account/pen-stands`, { method: "POST", body: { ids, note: note || undefined } }));
  const otherRight = (key, ids, note) => decide(key, () =>
    api(`/api/matches/${matchId}/second-account/other-phone-right`, { method: "POST", body: { ids, note } }));
  // Released one by one, in the order the phone recorded them, each judged
  // by the Laws; the first refusal stops the rest.
  const penMissed = (key, ids, note) => decide(key, async () => {
    let last = { ok: true };
    for (const id of ids) {
      last = await api(`/api/quarantine/${id}/resolve`, { method: "POST", body: { accept: true, note: note || undefined } });
      if (!last?.ok) return last;
    }
    return last;
  });

  return (
    <Card sx={{ padding: "14px", marginTop: "12px" }} data-testid="quarantine-panel">
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "8px" }}>
        {head}
        <div style={{ fontFamily: D.mono, fontSize: "12px", color: D.textMuted }} data-testid="quarantine-count">
          {open} waiting
        </div>
      </div>
      {open === 0 ? (
        <div style={{ ...small, color: D.textMuted }}>Nothing waiting for review.</div>
      ) : (<>
        <p style={{ ...small, color: D.textPrimary, margin: "0 0 8px" }}>
          Another phone scored part of this match without the scoring pen. Its balls were set aside, not added to the score.
          The pen's book is the match's record; below, each of the other phone's balls is beside the pen's ball at the same place.
        </p>
        {/* Where a released ball lands (the match-day audit's P3; Kameel,
            30 Oct 2026; TWO_PHONES R5.2): at the end of the log. */}
        <div data-testid="quarantine-where" style={{ ...small, color: D.textPrimary,
             padding: "8px 10px", marginBottom: "8px", borderRadius: "8px", background: `${D.amber}14`, border: `1px solid ${D.amber}55` }}>
          "Pen missed this ball" releases it: it is written at the end of the log, at the innings' end, after every ball scored since,
          and counted for whoever is batting and bowling there. Release only the last ball (or balls) of an innings.
          Otherwise set it aside, and have the scorer record it on the pad, in its place.
        </div>
        {viewer.scoredThisMatch && (
          <div role="note" data-testid="second-account-barred" style={{ ...small, color: D.textPrimary, fontWeight: 600,
               padding: "8px 10px", marginBottom: "8px", borderRadius: "8px", border: `1px solid ${D.border}` }}>
            You scored balls in this match's record, so you are a party to any difference between the two phones and may not decide it.
            Another person who approves corrections must decide — or, if there is nobody else at the school, the platform.
          </div>
        )}
        {accounts.filter((a) => a.open > 0).map((a) => {
          const barred = viewer.scoredThisMatch || a.mine;
          const agreeing = a.rows.filter((r) => r.status === "agrees" && !r.afterDrift);
          const agreeIds = agreeing.flatMap((r) => r.heldIds);
          const bulkKey = `agree-${a.deviceId}`;
          return (
            <section key={a.deviceId} data-testid={`second-account-${a.deviceId}`} aria-label="A second account"
                     style={{ borderTop: `1px solid ${D.border}`, paddingTop: "8px" }}>
              <div style={{ ...small, fontFamily: D.mono, color: D.textMuted }}>
                Sent by {a.sender || "unknown"} from another phone · scored under epoch {a.submittedEpoch} (now {a.currentEpoch ?? "—"})
                · {a.open} waiting{a.decided ? `, ${a.decided} decided` : ""}
              </div>
              <div data-testid="second-account-totals" style={{ ...small, color: D.textPrimary, marginTop: "4px" }}>
                {a.totals.pen.map((t) => {
                  const o = a.totals.other.find((x) => x.innings === t.innings);
                  return <div key={t.innings}>Innings {t.innings + 1}: the pen's book {book(t)} · the other phone's {o ? book(o) : "—"}</div>;
                })}
              </div>
              {a.mine && (
                <div role="note" data-testid="second-account-mine" style={{ ...small, color: D.textPrimary, fontWeight: 600, marginTop: "6px" }}>
                  You sent these balls yourself — somebody else has to decide them.
                </div>
              )}
              {a.drift && (
                <div role="note" data-testid="second-account-drift" style={{ ...small, color: D.textPrimary, marginTop: "6px",
                     padding: "8px 10px", borderRadius: "8px", border: `1px solid ${D.amber}55` }}>
                  From {a.drift.ball} (innings {a.drift.innings + 1}) the two accounts stop lining up: one phone has a delivery there the other does not,
                  so every ball after it is one out. Decide those balls by the over, against the paper book.
                </div>
              )}
              {agreeIds.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <Btn variant="primary" disabled={barred || busy != null} data-testid="second-account-agree-all"
                       onClick={() => penStands(bulkKey, agreeIds, "Both accounts agree")}>
                    Pen stands for the {agreeing.length} that agree
                  </Btn>
                  {said[bulkKey] && <div role="alert" style={{ ...small, color: textOn(D.rose), marginTop: "5px" }}>{said[bulkKey]?.text ?? said[bulkKey]}</div>}
                </div>
              )}
              <ol style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                {a.rows.map((r) => {
                  const st = STATUS[r.status];
                  const note = notes[r.key] ?? "";
                  const needsNote = r.status !== "agrees" || r.afterDrift;
                  const off = barred || busy != null;
                  return (
                    <li key={r.key} data-testid={`second-account-row-${r.key}`} data-status={r.status}
                        style={{ padding: "9px 0", borderTop: `1px solid ${D.border}` }}>
                      <div style={{ display: "flex", gap: "10px", alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: D.mono, fontSize: "12px", fontWeight: 700, color: D.textPrimary }}>
                          {r.ball === "start" ? "Before the first ball" : r.ball}
                        </span>
                        <span data-testid={`second-account-row-${r.key}-status`} style={{ ...small, fontWeight: 700, color: st.tone() }}>
                          <span aria-hidden="true">{st.mark} </span>{st.words}{r.differsIn?.length ? `: ${r.differsIn.join(", ")}` : ""}
                          {r.afterDrift ? " · after the accounts stop lining up" : ""}
                        </span>
                      </div>
                      <dl style={{ ...small, margin: "4px 0 0", display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "8px" }}>
                        <dt style={{ color: D.textMuted }}>Pen</dt>
                        <dd style={{ margin: 0, color: D.textPrimary }}>{r.pen.length ? r.pen.map((x) => x.words).join(" · ") : "No ball"}</dd>
                        <dt style={{ color: D.textMuted }}>Other phone</dt>
                        <dd style={{ margin: 0, color: D.textPrimary }}>{r.other.length ? r.other.map((x) => x.words).join(" · ") : "No ball (a change of bowler or batter only)"}</dd>
                      </dl>
                      {needsNote && (
                        <label style={{ ...small, display: "block", marginTop: "6px", color: D.textMuted }}>
                          Why — what the paper book or the umpires say
                          <input type="text" value={note} maxLength={1000} disabled={off}
                                 data-testid={`second-account-row-${r.key}-note`}
                                 onChange={(e) => setNotes((n) => ({ ...n, [r.key]: e.target.value }))}
                                 style={{ display: "block", width: "100%", boxSizing: "border-box", minHeight: "44px", marginTop: "4px",
                                          padding: "8px 10px", borderRadius: "8px", border: `1px solid ${D.border}`, background: D.surf2,
                                          color: D.textPrimary, fontFamily: D.body, fontSize: "14px" }} />
                        </label>
                      )}
                      {said[r.key] && (
                        <div role="alert" data-testid={`second-account-row-${r.key}-refused`}
                             style={{ ...small, color: textOn(D.rose), marginTop: "5px" }}>
                          {said[r.key]?.text ?? said[r.key]}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "8px", marginTop: "7px", flexWrap: "wrap" }}>
                        <Btn size="sm" variant="ghost" disabled={off || (needsNote && !note.trim())}
                             onClick={() => penStands(r.key, r.heldIds, note.trim())} data-testid={`second-account-row-${r.key}-pen-stands`}>
                          Pen stands
                        </Btn>
                        {r.status !== "agrees" && (
                          <Btn size="sm" variant="ghost" disabled={off}
                               onClick={() => penMissed(r.key, r.heldIds, note.trim())} data-testid={`second-account-row-${r.key}-pen-missed`}>
                            Pen missed this ball
                          </Btn>
                        )}
                        {r.amendTarget && (
                          <Btn size="sm" variant="ghost" disabled={off || !note.trim() || !viewer.mayRequest}
                               onClick={() => otherRight(r.key, r.heldIds, note.trim())} data-testid={`second-account-row-${r.key}-other-right`}>
                            The other phone was right
                          </Btn>
                        )}
                        {said[r.key]?.laws && (
                          <Btn size="sm" variant="ghost" disabled={busy != null}
                               onClick={() => say(r.key, null)} data-testid={`second-account-row-${r.key}-leave`}>
                            Leave it held
                          </Btn>
                        )}
                      </div>
                      {r.amendTarget && !viewer.mayRequest && !barred && (
                        <div style={{ ...small, color: D.textMuted, marginTop: "4px" }}>
                          "The other phone was right" asks for an amendment of the pen's ball, which needs a scorer's capability to request one.
                          Ask a scorer to request it; another person then approves it.
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </>)}
    </Card>
  );
}

export { QuarantinePanel, describeBall, describeEvent };
