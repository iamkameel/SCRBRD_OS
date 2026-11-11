import { useEffect, useState } from "react";
import { refusedWords } from "@scrbrd/policy/words";
import { D, inkOn } from "../design/tokens.js";
import { holdsAsHeld } from "../lib/held.js";
import { api, signedIn } from "../lib/api.js";

/**
 * Colours, on the Management screen (docs/design/RECOGNITION_design.md A17,
 * D2, D5, D8, D9, D10, §7 "the coach" and "the office"; db/146, R8).
 *
 *   The side's coach   nominates a boy of his side for Full colours or Half
 *                      colours, with an optional "why". Only his own sides'
 *                      boys are offered (GET /api/colours/nominations `sides`,
 *                      the door's own answer), so no choice is drawn that the
 *                      server would refuse.
 *   The deciders       the director of sport and the principal: each open
 *                      nomination they may decide, with Award (one confirm
 *                      sheet, an optional citation) or No award. A decider
 *                      who is the boy's guardian, or who made the nomination,
 *                      is told who decides instead and is offered no button.
 *   The office         reads the nominations (D8); it records a decision
 *                      through the honour sheet, naming who made it (D5).
 *
 * Words. The rationale and the citation pass the side's list (D2) on the
 * server; the same list runs here as a courtesy, so a refused word is named
 * before the button is pressed. Nobody is told about a nomination: a boy never
 * learns he was nominated and not chosen (D8), so no word here says
 * "rejected" or "declined" — "No award".
 *
 * Floors: 12px text and up, 44px targets (56px for the one tap that awards),
 * a choice is a radio and words, never colour alone; nothing moves, so
 * prefers-reduced-motion has nothing to stop. No dependency is added.
 */

export const TEXT_MAX = 300;
const KINDS = [["colours", "Full colours"], ["half_colours", "Half colours"]];
const kindWords = (/** @type {string} */ k) => (k === "half_colours" ? "Half colours" : "Full colours");
const FALLBACK = "Could not send it; nothing was changed.";
const day = (/** @type {string | null | undefined} */ at) => {
  if (!at) return "";
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short" });
};
/** The courtesy check: the side's list, the words named. */
const courtesy = (/** @type {string} */ text) => {
  const hits = refusedWords(text);
  if (!hits.length) return null;
  const w = hits.map((h) => h.word);
  const listed = w.length <= 1 ? w[0] : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
  return `This can't be written with ${listed} in it. Change the words and send again.`;
};

// Each style is a function, read when drawn: the tokens switch in place
// (tokens.js), and a constant would keep the first theme for ever.
const note = () => ({ margin: 0, fontFamily: D.body, fontSize: "14px", color: D.textMuted });
const small = () => ({ margin: 0, fontFamily: D.body, fontSize: "13px", color: D.textSecondary });
const card = () => ({ borderRadius: D.lg, border: `1px solid ${D.border}`, background: D.surf1, padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px" });
const head = () => ({ margin: 0, fontFamily: D.head, fontSize: "14px", fontWeight: 800, color: D.textPrimary });
const field = () => ({ minHeight: "44px", background: D.surf2, border: `1px solid ${D.border}`, borderRadius: D.sm, padding: "8px 10px",
                fontFamily: D.body, fontSize: "14px", color: D.textPrimary, boxSizing: "border-box", width: "100%" });
const label = () => ({ display: "flex", flexDirection: "column", gap: "4px", fontFamily: D.body, fontSize: "13px", color: D.textSecondary });
/** @param {boolean} strong @param {boolean} [tall] @param {boolean} [off] */
const btn = (strong, tall = false, off = false) => ({
  minHeight: tall ? "56px" : "44px", padding: "0 18px", borderRadius: D.pill, cursor: off ? "not-allowed" : "pointer",
  fontFamily: D.head, fontSize: "14px", fontWeight: 700, opacity: off ? 0.55 : 1,
  background: strong ? D.indigo : "transparent", color: strong ? inkOn(D.indigo) : D.textPrimary,
  border: strong ? "none" : `1px solid ${D.borderMed}`,
});

/**
 * @param {{ role: string, players: any[] }} p  role: the persona; players: the
 *   rows this reader reads (useRows("players")), filtered to his sides here
 */
export function ColoursPanel({ role, players }) {
  const live = signedIn();
  const [state, setState] = useState(/** @type {{ rows: any[], sides: any[], loading: boolean, error: string | null }} */ ({ rows: [], sides: [], loading: true, error: null }));
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    if (!live) return undefined;
    let cancelled = false;
    api("/api/colours/nominations")
      .then((d) => { if (!cancelled) setState({ rows: d?.rows ?? [], sides: d?.sides ?? [], loading: false, error: null }); })
      .catch(() => { if (!cancelled) setState((s) => ({ ...s, loading: false, error: "unreachable" })); });
    return () => { cancelled = true; };
  }, [live, nonce]);

  if (!live) return <p data-testid="colours-signin" style={note()}>Sign in to nominate or decide Colours. The demonstration holds none.</p>;

  // From every role the person holds (a director who coaches a side too), as
  // the menu is drawn; the server's `sides` say which boys.
  const canNominate = holdsAsHeld(role, "recognition.colours.nominate") && state.sides.length > 0;
  const toDecide = state.rows.filter((r) => r.status === "open" && r.mayDecide);
  const rest = state.rows.filter((r) => !(r.status === "open" && r.mayDecide));
  return (
    <div data-testid="colours" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <p style={{ ...note(), fontSize: "13px" }}>
        The side&apos;s coach nominates; the director of sport or the principal decides. Nobody is told about a nomination,
        so a boy never learns he was nominated and not chosen.
      </p>
      {state.error && <p data-testid="colours-error" role="alert" style={{ ...note(), color: D.roseText }}>The nominations could not be read — the server did not answer. This is not the same as there being none.</p>}
      {canNominate && <Nominate sides={state.sides} players={players} onDone={reload}/>}
      {toDecide.length > 0 && (
        <section aria-labelledby="colours-decide-h" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h3 id="colours-decide-h" style={head()}>To decide</h3>
          {toDecide.map((r) => <DecideRow key={r.nominationId} r={r} onDone={reload}/>)}
        </section>
      )}
      <section aria-labelledby="colours-list-h" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <h3 id="colours-list-h" style={head()}>Nominations</h3>
        {state.loading && <p style={note()}>Loading…</p>}
        {!state.loading && !state.error && rest.length === 0 && <p data-testid="colours-none" style={note()}>{toDecide.length ? "Nothing else on the list." : "No Colours nominations yet."}</p>}
        {rest.length > 0 && (
          <ul data-testid="colours-rows" style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${D.border}`, borderRadius: D.lg, background: D.surf1 }}>
            {rest.map((r, i) => (
              <li key={r.nominationId} data-testid="colours-row" data-status={r.status}
                style={{ padding: "10px 14px", borderTop: i ? `1px solid ${D.border}` : "none", display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontFamily: D.body, fontSize: "14px", color: D.textPrimary }}>
                  <span style={{ fontWeight: 600 }}>{r.nomineeName}</span> · {r.kindWords} {r.season} · {r.sideLabel}
                </span>
                <span style={small()}>{r.mine ? "You nominated him" : `Nominated by ${r.nominatedBy ?? "a coach"}`}, {day(r.nominatedAt)}</span>
                {r.rationale && <span style={small()}>Why: {r.rationale}</span>}
                <span data-testid="colours-state" style={{ ...small(), color: D.textPrimary }}>{stateWords(r)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One row's state, in §7's words for staff. @param {any} r */
function stateWords(r) {
  if (r.status === "confirmed") return `Awarded · ${day(r.decidedAt)}${r.decidedBy ? ` · decided by ${r.decidedBy}` : ""}`;
  if (r.status === "no_award") return `No award · ${day(r.decidedAt)}${r.decidedBy ? ` · ${r.decidedBy}` : ""}`;
  return r.refusalWords ?? "With the school to decide.";
}

/** @param {{ sides: any[], players: any[], onDone: () => void }} p */
function Nominate({ sides, players, onDone }) {
  const [side, setSide] = useState(0);
  const [kind, setKind] = useState(/** @type {string | null} */ (null));
  const [boy, setBoy] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const s = sides[Math.min(side, sides.length - 1)];
  // Never a boy he is guardian of (Kameel, 6 Nov 2026): the door refuses him.
  const kin = new Set(s.kin ?? []);
  const boys = (players ?? []).filter((p) => p.school === s.schoolId && p.team === s.teamCode && !kin.has(p.id))
    .slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const pick = boys.find((p) => p.id === boy) ?? null;
  const refused = courtesy(why);
  const off = !pick || !kind || busy || !!refused || why.trim().length > TEXT_MAX;

  const go = async () => {
    if (off || !pick || !kind) return;
    setBusy(true); setSaid(null);
    try {
      await api("/api/colours/nominations", { method: "POST", body: { playerId: pick.id, kind, rationale: why.trim() || null } });
      setSaid({ ok: true, text: `Nominated: ${pick.name} for ${kindWords(kind)}. The school decides.` });
      setBoy(""); setWhy(""); setKind(null);
      onDone();
    } catch (/** @type {any} */ e) {
      setSaid({ ok: false, text: e?.data?.message ?? FALLBACK });
    }
    setBusy(false);
  };

  return (
    <section data-testid="colours-nominate" aria-labelledby="colours-nominate-h" style={card()}>
      <h3 id="colours-nominate-h" style={head()}>Nominate for Colours</h3>
      <p style={small()}>A boy of your side. The director of sport decides; the principal, if he is the boy&apos;s guardian. A boy you are guardian of is nominated by another coach of the side.</p>
      {sides.length > 1 && (
        <label style={label()}>Side
          <select data-testid="colours-side" value={side} onChange={(e) => { setSide(Number(e.target.value)); setBoy(""); }} style={field()}>
            {sides.map((x, i) => <option key={`${x.schoolId}:${x.teamCode}`} value={i}>{x.sideLabel}</option>)}
          </select>
        </label>
      )}
      <label style={label()}>Boy
        <select data-testid="colours-boy" value={boy} onChange={(e) => setBoy(e.target.value)} style={field()}>
          <option value="">Choose a boy of {s.sideLabel}…</option>
          {boys.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div role="radiogroup" aria-label="Which Colours" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {KINDS.map(([k, w]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} data-testid={`colours-kind-${k}`} onClick={() => setKind(k)}
            style={{ ...btn(false), display: "inline-flex", alignItems: "center", gap: "8px",
                     borderColor: kind === k ? D.indigo : D.borderMed, background: kind === k ? `${D.indigo}18` : "transparent" }}>
            <span aria-hidden="true">{kind === k ? "◉" : "○"}</span>{w}
          </button>
        ))}
      </div>
      <label style={label()}>Why (optional)
        <textarea data-testid="colours-why" value={why} onChange={(e) => setWhy(e.target.value)} rows={3} maxLength={TEXT_MAX + 50}
          style={{ ...field(), minHeight: "88px", resize: "vertical" }}/>
        <span style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>
          Read by the side&apos;s staff and the school&apos;s deciders, never by him, his parents or his team-mates. {why.trim().length}/{TEXT_MAX}
        </span>
      </label>
      {refused && <p data-testid="colours-why-refused" role="status" style={{ ...small(), color: D.roseText }}>{refused}</p>}
      <div>
        <button type="button" data-testid="colours-nominate-go" disabled={off} onClick={go} style={btn(true, false, off)}>
          {pick && kind ? `Nominate ${pick.name}` : "Nominate"}
        </button>
      </div>
      {said && <p data-testid="colours-said" role={said.ok ? "status" : "alert"} style={{ ...small(), color: said.ok ? D.textPrimary : D.roseText }}>{said.text}</p>}
    </section>
  );
}

/** @param {{ r: any, onDone: () => void }} p */
function DecideRow({ r, onDone }) {
  const [step, setStep] = useState(/** @type {null | "award" | "no_award"} */ (null));
  const [cite, setCite] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(/** @type {{ ok: boolean, text: string } | null} */ (null));
  const refused = courtesy(cite);
  const what = `${r.kindWords} ${r.season}`;

  /** @param {"award" | "no_award"} action */
  const go = async (action) => {
    setBusy(true); setSaid(null);
    try {
      await api(`/api/colours/nominations/${r.nominationId}/decide`, { method: "POST",
        body: action === "award" ? { action, citation: cite.trim() || null } : { action } });
      setStep(null);
      onDone();
    } catch (/** @type {any} */ e) {
      setSaid({ ok: false, text: e?.data?.message ?? FALLBACK });
    }
    setBusy(false);
  };

  return (
    <div data-testid="colours-decide-row" style={card()}>
      <span style={{ fontFamily: D.body, fontSize: "14px", color: D.textPrimary }}>
        <span style={{ fontWeight: 600 }}>{what} to decide</span> · {r.nominatedBy ?? "The coach"} nominated {r.nomineeName} · {r.sideLabel} · {day(r.nominatedAt)}
      </span>
      {r.rationale && <span style={small()}>Why: {r.rationale}</span>}
      {step === null && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button type="button" data-testid="colours-award" onClick={() => setStep("award")} style={btn(true)}>Award</button>
          <button type="button" data-testid="colours-no-award" onClick={() => setStep("no_award")} style={btn(false)}>No award</button>
        </div>
      )}
      {step === "award" && (
        <div data-testid="colours-confirm" role="group" aria-label={`Award ${what}`} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ ...small(), color: D.textPrimary }}>This awards {what} to {r.nomineeName}.</p>
          <label style={label()}>Citation (optional)
            <textarea data-testid="colours-citation" value={cite} onChange={(e) => setCite(e.target.value)} rows={2} maxLength={TEXT_MAX + 50}
              style={{ ...field(), minHeight: "64px", resize: "vertical" }}/>
            <span style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>Read by his side and his parents. {cite.trim().length}/{TEXT_MAX}</span>
          </label>
          {refused && <p data-testid="colours-citation-refused" role="status" style={{ ...small(), color: D.roseText }}>{refused}</p>}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" data-testid="colours-award-go" disabled={busy || !!refused || cite.trim().length > TEXT_MAX}
              onClick={() => go("award")} style={btn(true, true, busy || !!refused || cite.trim().length > TEXT_MAX)}>Award {r.kindWords}</button>
            <button type="button" onClick={() => { setStep(null); setSaid(null); }} style={btn(false)}>Cancel</button>
          </div>
        </div>
      )}
      {step === "no_award" && (
        <div data-testid="colours-no-award-confirm" role="group" aria-label="Record no award" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ ...small(), color: D.textPrimary }}>No award for {r.nomineeName} on this nomination. Nobody is told about it.</p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" data-testid="colours-no-award-go" disabled={busy} onClick={() => go("no_award")} style={btn(true, false, busy)}>Record no award</button>
            <button type="button" onClick={() => { setStep(null); setSaid(null); }} style={btn(false)}>Cancel</button>
          </div>
        </div>
      )}
      {said && <p data-testid="colours-decide-said" role="alert" style={{ ...small(), color: D.roseText }}>{said.text}</p>}
    </div>
  );
}
