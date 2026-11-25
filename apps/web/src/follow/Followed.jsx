import { useState } from "react";
import { T, px } from "../design/tokens.js";
import { arrange, statusSentence } from "../home/sections/LiveStrip.jsx";
import { confirmFollow, dismissFollow } from "../lib/follow.js";

/**
 * FOLLOWED SCHOOLS (EXPERIENCE_PASS Q8, §1.9, §2.2, §2.4, §3.8; db/160).
 *
 * The block a follower's Today draws: the public fixtures today of the
 * schools he follows, live boards first, then today's starts, then results
 * (LiveStrip's arrange()), each with the home page's status sentence; then
 * the schools themselves, each with "Stop following". It is given its data
 * (lib/follow.js useFollowed()) so a home can choose where it stands: first
 * while one of them is live, otherwise after Now (§2.2).
 *
 * TEAM FACTS ONLY, as on the home page: the read it is drawn from names no
 * child, no ground, no official (db/82, db/159). A card links to the match's
 * public page, which names players only by the public rule.
 *
 * A LINK ASKS FIRST (Kameel, 15 Nov): a match page's Follow link, after the
 * sign-in, is a question here, "Follow Hilton College?", with Follow and Not
 * now. Nothing is written until Follow is tapped; Not now writes nothing.
 *
 * Props
 *   followed  useFollowed()'s answer
 *   lead      drawn as the screen's first block (a followed school is live,
 *             or a link's question waits)
 *   onAskView Q10 (db/168): "Ask the school for its signed-in view" on each
 *             school's row, which sends the spectator request the join form
 *             used to (the no-school home's; never a pupil's basic view,
 *             which asks for nothing). Omitted, no such button.
 *   viewAsk   its answer: { id, ok, words } for the school last asked
 */
export function FollowedSchools({ followed, lead = false, onAskView = null, viewAsk = null }) {
  const { loading, failed, schools, data, note, ask, unfollow, reload } = followed;
  const [busy, setBusy] = useState(/** @type {string | null} */ (null));
  const [problem, setProblem] = useState("");
  const [answering, setAnswering] = useState(false);
  if (loading && !ask) return null;
  const list = data?.fixtures ? arrange(data.fixtures) : [];
  const stop = async (/** @type {string} */ id, /** @type {string} */ name) => {
    setBusy(id); setProblem("");
    if (!(await unfollow(id))) setProblem(`Could not stop following ${name} just now. Try again.`);
    setBusy(null);
  };

  return (
    <section data-testid="followed-schools" data-lead={lead ? "" : undefined} aria-labelledby="followed-schools-h"
      style={{ borderRadius: "16px", border: `1px solid ${T.line.normal}`, background: T.fill.panel, padding: "20px", marginBottom: "16px" }}>
      <h2 id="followed-schools-h" style={{ fontFamily: T.type.head, fontSize: "16px", fontWeight: 800, margin: "0 0 8px", color: T.content.primary }}>Followed schools</h2>
      {ask && (
        <div role="group" aria-labelledby="follow-question" data-testid="follow-question"
          style={{ border: `1px solid ${T.line.strong}`, borderRadius: "12px", padding: "14px", margin: "0 0 14px", display: "grid", gap: "10px" }}>
          <p id="follow-question" style={{ ...T.role.body, margin: 0, color: T.content.primary, fontWeight: 600, overflowWrap: "anywhere" }}>Follow {ask.name}?</p>
          <p style={{ ...T.role.body, margin: 0, fontSize: "13px", color: T.content.secondary }}>Its public matches lead your Today. You can stop at any time.</p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" className="pressBtn" data-testid="follow-confirm" disabled={answering}
              onClick={async () => { setAnswering(true); await confirmFollow(); setAnswering(false); }}
              style={{ minHeight: px(T.floor.target), padding: "10px 18px", borderRadius: "999px", border: "none", background: T.light.action, color: T.light.ink,
                cursor: answering ? "not-allowed" : "pointer", opacity: answering ? 0.5 : 1, fontFamily: T.type.head, fontSize: "13px", fontWeight: 700 }}>
              {answering ? "Following…" : "Follow"}
            </button>
            <button type="button" className="pressBtn" data-testid="follow-not-now" disabled={answering} onClick={() => dismissFollow()}
              style={{ minHeight: px(T.floor.target), padding: "10px 18px", borderRadius: "999px", border: `1px solid ${T.line.strong}`, background: "transparent",
                color: T.content.secondary, cursor: "pointer", fontFamily: T.type.head, fontSize: "13px", fontWeight: 700 }}>
              Not now
            </button>
          </div>
        </div>
      )}
      {note && "name" in note && <p role="status" data-testid="followed-note" style={{ ...T.role.body, margin: "0 0 12px", color: T.content.secondary }}>You follow {note.name}. Its matches show here on match days.</p>}
      {note && "problem" in note && <p role="alert" data-testid="followed-problem" style={{ ...T.role.body, margin: "0 0 12px", color: T.semantic.criticalText }}>{note.problem}</p>}

      {schools.length === 0 ? (ask ? null :
        <p data-testid="followed-none" style={{ ...T.role.body, margin: 0, color: T.content.secondary }}>
          Follow a school from one of its match pages, and its matches show here on match days.
        </p>
      ) : (
        <>
          {data?.fixtures === null && !failed && <p data-testid="followed-off" style={{ ...T.role.body, margin: "0 0 12px", color: T.content.secondary }}>Match pages are switched off on SCRBRD just now.</p>}
          {failed && !data && (
            <div role="status" data-testid="followed-failed" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: T.space.md, margin: "0 0 12px" }}>
              <p style={{ ...T.role.body, margin: 0, color: T.content.secondary }}>Couldn't load today's matches. They show here when the connection is back.</p>
              {reload && <button type="button" onClick={reload} data-testid="followed-retry" className="pressBtn" style={{ minHeight: px(T.floor.target), minWidth: px(T.floor.target), padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill,
                border: `1px solid ${T.line.normal}`, background: "transparent", color: T.content.primary, fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>Retry</button>}
            </div>
          )}
          {data?.fixtures && list.length === 0 && (
            <p data-testid="followed-quiet" style={{ ...T.role.body, margin: "0 0 12px", color: T.content.secondary }}>No matches listed today for the schools you follow.</p>
          )}
          {list.length > 0 && (
            <div style={{ display: "grid", gap: "10px", marginBottom: "14px" }}>
              {list.map((f) => <FollowedCard key={f.id} f={f}/>)}
            </div>
          )}
          <ul aria-label="Schools you follow" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "6px" }}>
            {schools.map((s) => (
              <li key={s.id} data-testid={`followed-school-${s.code}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ ...T.role.body, color: T.content.primary, fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{s.name}</span>
                <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {onAskView && !(viewAsk?.id === s.id && viewAsk.ok) && (
                    <button type="button" className="pressBtn" data-testid={`ask-view-${s.code}`} onClick={() => onAskView(s)}
                      aria-label={`Ask ${s.name} for its signed-in view`}
                      style={{ minHeight: px(T.floor.target), padding: "10px 16px", borderRadius: "999px", border: `1px solid ${T.line.strong}`, background: "transparent",
                        color: T.content.secondary, cursor: "pointer", fontFamily: T.type.head, fontSize: "13px", fontWeight: 700 }}>
                      Ask the school for its signed-in view
                    </button>
                  )}
                  <button type="button" className="pressBtn" data-testid={`unfollow-${s.code}`} disabled={busy === s.id} onClick={() => stop(s.id, s.name)}
                    aria-label={`Stop following ${s.name}`}
                    style={{ minHeight: px(T.floor.target), padding: "10px 16px", borderRadius: "999px", border: `1px solid ${T.line.strong}`, background: "transparent",
                      color: T.content.secondary, cursor: busy === s.id ? "not-allowed" : "pointer", opacity: busy === s.id ? 0.5 : 1,
                      fontFamily: T.type.head, fontSize: "13px", fontWeight: 700 }}>
                    {busy === s.id ? "Stopping…" : "Stop following"}
                  </button>
                </span>
                {viewAsk?.id === s.id && (
                  <span role={viewAsk.ok ? "status" : "alert"} data-testid={`ask-view-said-${s.code}`}
                    style={{ ...T.role.body, flexBasis: "100%", fontSize: "13px", color: viewAsk.ok ? T.content.secondary : T.semantic.criticalText }}>{viewAsk.words}</span>
                )}
              </li>
            ))}
          </ul>
          {problem && <p role="alert" data-testid="unfollow-problem" style={{ ...T.role.body, margin: "8px 0 0", color: T.semantic.criticalText }}>{problem}</p>}
        </>
      )}
    </section>
  );
}

const nameOf = (/** @type {any} */ side) => [side?.label, side?.code].filter(Boolean).join(" ").trim() || "Opponent";
const LIVE = "#34e58a";

/** One fixture, on the ground's board, as the home page draws it: team facts and the sentence. */
function FollowedCard({ f }) {
  const live = f.status === "live", done = f.status === "complete" || f.status === "abandoned";
  const scores = Array.isArray(f.scores) ? f.scores : [];
  const own = (/** @type {string} */ side) => scores.filter((s) => s.side === side).map((s) => `${s.runs ?? 0}/${s.wickets ?? 0}`).join(" & ");
  const tag = live ? "LIVE" : f.status === "complete" ? "RESULT" : f.status === "abandoned" ? "ABANDONED" : f.status === "postponed" ? "POSTPONED" : "TODAY";
  return (
    <a href={`/${done ? "scorecard" : "live"}/${encodeURIComponent(f.id)}`} data-testid="followed-card" data-status={f.status}
      style={{ display: "block", textDecoration: "none", borderRadius: "14px", background: T.board.face, padding: "14px 16px", minHeight: px(T.floor.target),
        border: `1px solid ${live ? "rgba(52,229,138,0.55)" : T.board.rule}` }}>
      <span style={{ fontFamily: T.type.mono, fontSize: "12px", letterSpacing: "0.12em", color: live ? LIVE : T.board.dim, display: "inline-flex", alignItems: "center", gap: "8px" }}>
        {live && <span aria-hidden="true" className="live-dot" style={{ background: LIVE }}/>}{tag}
      </span>
      {[["home", f.home], ["away", f.away]].map(([k, side]) => (
        <span key={k} style={{ display: "flex", justifyContent: "space-between", gap: "12px", marginTop: "6px" }}>
          <span style={{ fontFamily: T.type.head, fontSize: "15px", fontWeight: 700, color: T.board.figure, minWidth: 0, overflowWrap: "anywhere" }}>{nameOf(side)}</span>
          <span style={{ fontFamily: T.type.mono, fontSize: "15px", color: T.board.figure, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{own(k)}</span>
        </span>
      ))}
      <span data-testid="followed-card-sentence" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", marginTop: "10px", flexWrap: "wrap" }}>
        <span style={{ fontFamily: T.type.body, fontSize: "15px", fontWeight: 600, color: T.board.figure, lineHeight: 1.4 }}>{statusSentence(f)}</span>
        <span style={{ fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, color: live ? LIVE : T.board.lime, whiteSpace: "nowrap" }}>{live ? "Watch" : "Open"}<span aria-hidden="true"> ›</span></span>
      </span>
    </a>
  );
}
