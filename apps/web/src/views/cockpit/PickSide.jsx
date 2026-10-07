import { useEffect, useMemo, useRef, useState } from "react";
import { T, inkOn } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { readLive } from "../../lib/live.js";
import { profile } from "../../lib/session.js";
import { cockpitGate, shortDate } from "../../lib/cockpit.js";
import { sidesOf } from "../../lib/matchCentre.js";
import { AWAY_AVAILABILITY_WORDS, SIDE_SIZE, candidates, checkDraft, draftFoot, draftFrom, drop, emptyDraft, findOthers, payload, pick, refusalWords, REFUSAL_WORDS, setNo, setTwelfth } from "../../lib/pickSide.js";

/**
 * PICK THE SIDE: the coach names the XI for a fixture, with a batting order and
 * an optional twelfth man. Offered, on a fixture still to be played, to the one
 * assignment that holds `team.select` for that side (cockpitGate's `panels.select`:
 * by capability, never by title) from the Match Centre's Match Details and from
 * the Coach tab's side panel.
 *
 * IT DECIDES NOTHING. One call, POST /api/matches/:id/squad, and the database's
 * two triggers answer for age and registration. A refusal names the boy and the
 * reason in the trigger's own words and is drawn beside him; the route is one
 * transaction, so the side as it stood is untouched. Duplicate numbers are said
 * before anything is sent (lib/pickSide.js checkDraft), in the route's sentences.
 *
 * It shows what the app already reads: the team (`players`), the sheet that
 * stands (`match_squad`) and this fixture's answers (`readiness`, where the
 * reader's grant reaches it: the status tier only, never a reason, D4).
 *
 * PLAYING UP: the list is the fixture team's own boys, and a quiet "Add a boy
 * from another team" finds any other boy of the SAME SCHOOL in the `players`
 * read the list already uses (lib/pickSide.js findOthers; no new read) and puts
 * him in the draft marked "from U13A". Whether he may play up is the database's
 * answer, shown beside him like any other refusal.
 *
 * AWAY SIDE: `readiness` answers for the fixture's home team only, and no other
 * read gives the away end's answers, so for an away coach nothing is read and
 * one line says availability shows for the home side only for now.
 *
 * A dialog: Escape closes it, focus moves in and Tab stays inside, and focus
 * returns to the button that opened it. Nothing animates.
 *
 * @param {{match: any, gate: {end: "home" | "away", school: string, teamCode: string | null, panels: {status: boolean, side: boolean}}, onClose: () => void, onSaved?: () => void}} p
 */
export function PickSide({ match, gate, onClose, onSaved }) {
  const panel = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [read, setRead] = useState(/** @type {{players: any[] | null, squad: any[] | null, readiness: any[] | null} | null} */ (null));
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState(/** @type {{words: string, boyId: string | null} | null} */ (null));
  // Boys the coach has added from another team this sitting, and the finder that adds them.
  const [added, setAdded] = useState(/** @type {string[]} */ ([]));
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState(/** @type {string | null} */ (null));
  const q = useMemo(() => ({ matchId: match.id }), [match.id]);
  const sides = sidesOf(match);
  // The readiness read answers for the fixture's home team only (see AWAY_AVAILABILITY_WORDS):
  // for the away end nothing is read, and the screen says so.
  const awayBlind = gate.end === "away" && gate.panels.side;
  const wantsReadiness = gate.panels.side && gate.end === "home";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [players, squad, readiness] = await Promise.all([
        readLive("players"), readLive("match_squad", q), wantsReadiness ? readLive("readiness", q) : null]);
      if (cancelled) return;
      setRead({ players, squad, readiness });
      setDraft(draftFrom(squad, gate.end));
    })();
    return () => { cancelled = true; };
  }, [q, gate.end, wantsReadiness]);

  useEffect(() => {
    if (!focusId) return;
    panel.current?.querySelector(`[data-testid="pick-xi-${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId, added]);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const f = [...panel.current.querySelectorAll("button:not([disabled]), select, input")];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); /** @type {HTMLElement} */ (last).focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); /** @type {HTMLElement} */ (first).focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const boys = useMemo(() => read?.players == null ? []
    : candidates(read.players, read.readiness, read.squad, { school: gate.school, teamCode: gate.teamCode, end: gate.end, may: { status: gate.panels.status === true }, added }),
  [read, gate.school, gate.teamCode, gate.end, gate.panels.status, added]);
  const names = useMemo(() => new Map(boys.map((b) => [b.id, b.name])), [boys]);
  const found = useMemo(() => findOthers(read?.players ?? null, query, { school: gate.school, teamCode: gate.teamCode, have: boys.map((b) => b.id) }),
    [read, query, gate.school, gate.teamCode, boys]);
  const check = checkDraft(draft);
  const full = draft.xi.length >= SIDE_SIZE;
  const edit = (/** @type {(d: typeof draft) => typeof draft} */ f) => { setSaid(null); setDraft(f); };
  /** Adds a boy from another team to the list, and to the XI if there is room. The database still decides whether he may play. */
  const addOther = (/** @type {string} */ id) => {
    setAdded((a) => (a.includes(id) ? a : [...a, id]));
    edit((d) => pick(d, id));
    setFinding(false); setQuery(""); setFocusId(id);
  };

  async function save() {
    if (saving) return;
    if (check.code) { setSaid({ words: REFUSAL_WORDS[/** @type {keyof typeof REFUSAL_WORDS} */ (check.code)], boyId: null }); return; }
    setSaving(true); setSaid(null);
    try {
      await api(`/api/matches/${match.id}/squad`, { method: "POST", body: { side: gate.end, players: payload(draft) } });
      onSaved?.();
      onClose();
    } catch (/** @type {any} */ e) {
      setSaid(refusalWords(e, boys));
      setSaving(false);
    }
  }

  const title = draftFrom(read?.squad, gate.end).xi.length ? "Change the side" : "Pick the side";

  return (
    <div data-testid="pick-side-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: T.glass.scrim, zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="pick-side-title" tabIndex={-1} data-testid="pick-side"
        style={{ background: T.surface.base, color: T.content.primary, width: "100%", maxWidth: "520px", height: "100%", boxSizing: "border-box",
          borderLeft: `1px solid ${T.line.normal}`, outline: "none", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: T.space.lg, display: "grid", gap: T.space.sm, borderBottom: `1px solid ${T.line.normal}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: T.space.md }}>
            <h2 id="pick-side-title" style={{ ...T.role.title.md, margin: 0, color: T.content.primary }}>{title}</h2>
            <button type="button" data-testid="pick-side-close" className="os-state" onClick={onClose} style={btn()}>Close</button>
          </div>
          <p style={quiet()}>
            {sides.home.full} v {sides.away.full}. Pick up to {SIDE_SIZE}, give each a batting number, and name a twelfth man if you want one.
            The database checks each boy's age and registration when you save.
          </p>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: T.space.lg, display: "grid", alignContent: "start", gap: T.space.sm }}>
          {read == null && <p data-testid="pick-side-loading" style={quiet()}>Reading the team…</p>}
          {read != null && read.players == null && <p data-testid="pick-side-unread" style={quiet()}>The team could not be read just now. Nothing has been changed.</p>}
          {read != null && read.players != null && boys.length === 0 && <p style={quiet()}>There is nobody on this team's list to pick from.</p>}
          {read != null && read.players != null && wantsReadiness && read.readiness == null && (
            <p style={quiet()}>Who has said they are available could not be read just now. That is not the same as everyone being free.</p>
          )}
          {read != null && read.players != null && awayBlind && <p data-testid="pick-side-away-note" style={quiet()}>{AWAY_AVAILABILITY_WORDS}</p>}

          {boys.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: T.space.sm }}>
              {boys.map((b) => {
                const x = draft.xi.find((r) => r.id === b.id);
                const twelfth = draft.twelfth === b.id;
                const code = check.byBoy[b.id];
                // Beside the boy: the reason alone. "Nothing was saved" is said once, at the foot.
                const note = said?.boyId === b.id ? said.words.replace(" Nothing was saved.", "") : code ? REFUSAL_WORDS[/** @type {keyof typeof REFUSAL_WORDS} */ (code)].replace(" Nothing was saved.", "") : null;
                return (
                  <li key={b.id} data-testid={`pick-${b.id}`} data-picked={x ? "xi" : twelfth ? "twelfth" : "no"} data-state={b.state ?? "unknown"}
                    style={{ border: `1px solid ${note ? T.semantic.criticalText : x || twelfth ? T.line.strong : T.line.normal}`, borderRadius: T.radius.lg,
                      background: x || twelfth ? T.surface.raised : "transparent", padding: T.space.md, display: "grid", gap: T.space.sm }}>
                    <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", alignItems: "baseline" }}>
                      <span style={{ ...T.role.body, fontWeight: 600, color: T.content.primary }}>{b.name}</span>
                      {b.from && <span data-testid={`pick-from-${b.id}`} style={quiet()}>from {b.from}</span>}
                      {b.from && wantsReadiness && !b.words && <span data-testid={`pick-nostate-${b.id}`} style={quiet()}>availability not shown</span>}
                      {b.words &&<span data-testid={`pick-state-${b.id}`} style={quiet()}>{b.words}{b.back ? ` · back ${shortDate(b.back)}` : ""}</span>}
                    </div>
                    <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", alignItems: "center" }}>
                      <button type="button" data-testid={`pick-xi-${b.id}`} className="os-state" aria-pressed={!!x}
                        disabled={!x && full} onClick={() => edit((d) => (x ? drop(d, b.id) : pick(d, b.id)))} style={toggle(!!x)}>
                        {x ? "In the XI" : "Pick"}
                      </button>
                      {x && (
                        <label style={{ ...quiet(), display: "inline-flex", alignItems: "center", gap: T.space.xs }}>
                          Bats at
                          <select data-testid={`pick-no-${b.id}`} aria-label={`Batting number for ${b.name}`} value={x.no ?? ""}
                            onChange={(e) => edit((d) => setNo(d, b.id, e.target.value === "" ? null : Number(e.target.value)))} style={select()}>
                            <option value="">none</option>
                            {Array.from({ length: SIDE_SIZE }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </label>
                      )}
                      <button type="button" data-testid={`pick-twelfth-${b.id}`} className="os-state" aria-pressed={twelfth}
                        onClick={() => edit((d) => setTwelfth(d, b.id))} style={toggle(twelfth)}>
                        Twelfth man
                      </button>
                    </div>
                    {note && <p data-testid={`pick-note-${b.id}`} style={{ ...T.role.body, fontSize: "14px", margin: 0, color: T.semantic.criticalText }}>{note}</p>}
                  </li>
                );
              })}
            </ul>
          )}

          {read != null && read.players != null && gate.teamCode && (
            <div data-testid="pick-other" style={{ display: "grid", gap: T.space.sm, marginTop: T.space.md, paddingTop: T.space.md, borderTop: `1px solid ${T.line.normal}` }}>
              {!finding ? (
                <button type="button" data-testid="pick-other-open" className="os-state" onClick={() => setFinding(true)} style={{ ...btn(), justifySelf: "start" }}>
                  Add a boy from another team
                </button>
              ) : (
                <>
                  <label style={{ ...quiet(), display: "grid", gap: T.space.xs }}>
                    Find a boy from another of your teams
                    <input type="search" data-testid="pick-other-search" value={query} autoFocus autoComplete="off" onChange={(e) => setQuery(e.target.value)}
                      placeholder="Type part of his name" style={{ ...select(), width: "100%", minWidth: 0 }}/>
                  </label>
                  {query.trim() !== "" && found.rows.length === 0 && <p data-testid="pick-other-none" style={quiet()}>Nobody on your other teams matches that.</p>}
                  {found.rows.length > 0 && (
                    <ul data-testid="pick-other-results" style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: T.space.xs }}>
                      {found.rows.map((r) => (
                        <li key={r.id}>
                          <button type="button" data-testid={`pick-other-add-${r.id}`} className="os-state" onClick={() => addOther(r.id)}
                            style={{ ...btn(), width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", gap: T.space.sm }}>
                            <span>{r.name}</span><span style={{ fontWeight: 400 }}>{r.team ? `from ${r.team}` : "no team"}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {found.more > 0 && <p style={quiet()}>{found.more} more match. Type more of his name to narrow the list.</p>}
                  <button type="button" data-testid="pick-other-cancel" className="os-state" onClick={() => { setFinding(false); setQuery(""); }} style={{ ...btn(), justifySelf: "start" }}>
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: T.space.lg, display: "grid", gap: T.space.sm, borderTop: `1px solid ${T.line.normal}` }}>
          <p data-testid="pick-side-foot" style={quiet()}>
            {draftFoot(draft, names)}{full ? ". The XI is full: take a boy out to pick another" : ""}
          </p>
          {said && <p role="alert" data-testid="pick-side-said" style={{ ...T.role.body, fontSize: "14px", margin: 0, color: T.semantic.criticalText }}>{said.words}</p>}
          <button type="button" data-testid="pick-side-save" className="os-state" disabled={saving || read?.players == null} onClick={save}
            style={{ ...btn(), background: T.content.primary, color: inkOn(T.content.primary), border: "none", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Save the side"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The way in from the Match Centre's Match Details: a button for the person
 * whose one assignment holds `team.select` for a side of this fixture, on a
 * fixture still to be played, and nothing for anyone else. Layout, not
 * authority: the route and the database decide again.
 * @param {{match: any}} p
 */
export function PickSideEntry({ match }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const opener = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const gate = useMemo(() => (signedIn() ? cockpitGate(profile()?.assignments, match) : null), [match]);
  if (!gate?.panels.select || match.status !== "upcoming") return null;
  return (
    <div style={{ display: "grid", gap: T.space.xs, marginBottom: T.space.md }}>
      <button type="button" ref={opener} data-testid="pick-side-entry" className="os-state" onClick={() => { setSaved(false); setOpen(true); }}
        style={{ ...btn(), justifySelf: "start" }}>Pick the side</button>
      {saved && <p data-testid="pick-side-entry-saved" style={quiet()}>The side was saved. It is on the fixture's Coach tab.</p>}
      {open && <PickSide match={match} gate={gate} onSaved={() => setSaved(true)} onClose={() => { setOpen(false); opener.current?.focus(); }}/>}
    </div>
  );
}

const quiet = () => ({ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0 });
const btn = () => ({ minHeight: "44px", padding: `0 ${T.space.lg}`, background: "transparent", color: T.content.primary,
  border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 });
const toggle = (/** @type {boolean} */ on) => ({ ...btn(), minWidth: "44px", border: `1px solid ${on ? T.content.primary : T.line.strong}`,
  background: on ? T.content.primary : "transparent", color: on ? inkOn(T.content.primary) : T.content.primary });
const select = () => ({ minHeight: "44px", minWidth: "72px", padding: "0 10px", boxSizing: /** @type {const} */ ("border-box"), background: T.surface.base, color: T.content.primary,
  border: `1px solid ${T.line.strong}`, borderRadius: T.radius.md, fontFamily: T.type.body, fontSize: "16px" });
