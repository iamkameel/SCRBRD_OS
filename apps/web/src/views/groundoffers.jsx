import { useCallback, useEffect, useState } from "react";
import { T } from "../design/tokens.js";
import { api } from "../lib/api.js";
import { useRows } from "../lib/live.js";
import { addDays, dayWords, instantOf, leagueRefusal, saDay, saToday, slotWords, startOfDay } from "../lib/league.js";
import { Alert, Field, styles } from "./playingconditions.jsx";
import { Said, selectStyle } from "./leagueui.jsx";

/**
 * A ground owner's part in the fixture planner (SCRBRD-123; design note §5.5):
 * offer a slot for fixtures, close the ground for a spell, and name the two ends
 * of its strip. Reached from Fields, on a ground the person looks after
 * (`facility.manage`), under "Fixture slots".
 *
 * A slot is an OFFER, not a booking: nothing is reserved, and a league's manager
 * places fixtures in the slots offered to that league or to any league. A closure
 * makes the planner avoid the ground (and the field it lies on, or the pitches on
 * it) for those days. The ends are kept for the scoring of bowling ends to come;
 * nothing else reads them yet.
 *
 * WHAT THIS DECIDES: nothing. Who may offer, close or name is the API's
 * (`facility.manage` at the ground's school); a refusal is worded beside the
 * thing refused.
 */

const post = (/** @type {string} */ path, /** @type {any} */ body = {}) => api(path, { method: "POST", body });

/** @param {{ ground: { id: string, name: string, endA?: string | null, endB?: string | null }, role: string }} props */
export function GroundOffers({ ground, role }) {
  const S = styles();
  const COMPS = useRows("competitions", role);
  const leagues = COMPS.filter((c) => c.live);
  const [nonce, setNonce] = useState(0);
  const [lists, setLists] = useState(/** @type {{ windows: any[], closures: any[], error: string | null }} */ ({ windows: [], closures: [], error: null }));
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const tomorrow = addDays(saToday(), 1);

  const [slot, setSlot] = useState({ day: "", start: "09:00", end: "13:00", competitionId: "" });
  const [slotErr, setSlotErr] = useState(/** @type {string | null} */ (null));
  const [closure, setClosure] = useState({ from: "", to: "", reason: "" });
  const [closeErr, setCloseErr] = useState(/** @type {string | null} */ (null));
  const [ends, setEnds] = useState({ endA: ground.endA ?? "", endB: ground.endB ?? "" });
  const [endsErr, setEndsErr] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    let off = false;
    Promise.all([api(`/api/grounds/${ground.id}/windows`), api(`/api/grounds/${ground.id}/closures`)])
      .then(([w, c]) => { if (!off) setLists({ windows: w.windows ?? [], closures: c.closures ?? [], error: null }); })
      .catch((e) => { if (!off) setLists((l) => ({ ...l, error: leagueRefusal(e) })); });
    return () => { off = true; };
  }, [ground.id, nonce]);
  useEffect(() => { setEnds({ endA: ground.endA ?? "", endB: ground.endB ?? "" }); }, [ground.id, ground.endA, ground.endB]);

  const run = useCallback(async (/** @type {() => Promise<void>} */ fn, /** @type {(w: string | null) => void} */ fail) => {
    setBusy(true); fail(null);
    try { await fn(); } catch (/** @type {any} */ e) { fail(leagueRefusal(e)); } finally { setBusy(false); }
  }, []);

  const offer = (/** @type {import("react").FormEvent} */ e) => {
    e.preventDefault();
    return run(async () => {
      await post(`/api/grounds/${ground.id}/windows`, {
        startsAt: instantOf(slot.day, slot.start), endsAt: instantOf(slot.day, slot.end), competitionId: slot.competitionId || undefined,
      });
      setSaid(`Offered ${slotWords(instantOf(slot.day, slot.start), instantOf(slot.day, slot.end))} at ${ground.name}${slot.competitionId ? " to that league" : " to any league"}.`);
      setSlot((s) => ({ ...s, day: "" })); setNonce((n) => n + 1);
    }, setSlotErr);
  };
  const close = (/** @type {import("react").FormEvent} */ e) => {
    e.preventDefault();
    return run(async () => {
      const last = closure.to || closure.from;
      await post(`/api/grounds/${ground.id}/closures`, { from: startOfDay(closure.from), to: startOfDay(addDays(last, 1)), reason: closure.reason });
      setSaid(`${ground.name} is closed ${closure.from === last ? dayWords(closure.from) : `${dayWords(closure.from)} to ${dayWords(last)}`}.`);
      setClosure({ from: "", to: "", reason: "" }); setNonce((n) => n + 1);
    }, setCloseErr);
  };
  const remove = (/** @type {string} */ path, /** @type {string} */ words) => run(async () => { await post(path); setSaid(words); setNonce((n) => n + 1); }, setSlotErr);
  const saveEnds = (/** @type {import("react").FormEvent} */ e, /** @type {boolean} */ clear = false) => {
    e.preventDefault();
    return run(async () => {
      const r = await post(`/api/grounds/${ground.id}/ends`, clear ? { endA: null, endB: null } : { endA: ends.endA.trim(), endB: ends.endB.trim() });
      setEnds({ endA: r.endA ?? "", endB: r.endB ?? "" });
      setSaid(r.endA ? `The ends are named ${r.endA} and ${r.endB}.` : "The ends are cleared.");
    }, setEndsErr);
  };

  const leagueName = (/** @type {string | null} */ id) => (id ? leagues.find((c) => c.id === id)?.name ?? "one league" : "any league");

  return (
    <div data-testid="go-root" style={{ display: "flex", flexDirection: "column", gap: T.space.lg, fontFamily: T.type.body }}>
      <div>
        <h3 style={S.h3}>Fixture slots at {ground.name}</h3>
        <p style={S.meta}>
          A slot you offer is not a booking. A league's organiser places fixtures in the slots offered to that league, or to any league, and every fixture is
          checked again when it is published. Close the ground for days it cannot be used.
        </p>
      </div>
      <Said testid="go-status">{said}</Said>
      <Alert words={lists.error} testid="go-error"/>

      <section style={S.card} aria-label="Offer a slot" data-testid="go-offer">
        <h4 style={S.h4}>Offer a slot</h4>
        <form onSubmit={offer} style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
          <div style={S.wrap}>
            <Field label="Day">{(id) => <input id={id} data-testid="go-slot-day" type="date" min={tomorrow} value={slot.day} onChange={(e) => setSlot({ ...slot, day: e.target.value })} style={S.input}/>}</Field>
            <Field label="From">{(id) => <input id={id} data-testid="go-slot-start" type="time" value={slot.start} onChange={(e) => setSlot({ ...slot, start: e.target.value })} style={{ ...S.input, width: "140px" }}/>}</Field>
            <Field label="Until">{(id) => <input id={id} data-testid="go-slot-end" type="time" value={slot.end} onChange={(e) => setSlot({ ...slot, end: e.target.value })} style={{ ...S.input, width: "140px" }}/>}</Field>
            <Field label="Offered to" grow>{(id) => (
              <select id={id} data-testid="go-slot-league" value={slot.competitionId} onChange={(e) => setSlot({ ...slot, competitionId: e.target.value })} style={selectStyle()}>
                <option value="">Any league</option>
                {leagues.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>)}</Field>
          </div>
          <Alert words={slotErr} testid="go-slot-error"/>
          <div><button type="submit" data-testid="go-slot-add" disabled={busy || !slot.day} style={{ ...S.primary, opacity: busy || !slot.day ? 0.5 : 1 }}>Offer this slot</button></div>
        </form>
        <div data-testid="go-windows">
          {lists.windows.length === 0 && <p style={S.body}>No slots are on offer.</p>}
          {lists.windows.map((w) => (
            <div key={w.id} data-testid="go-window" style={{ ...S.row, minHeight: "44px" }}>
              <span style={S.body}>{slotWords(w.startsAt, w.endsAt)}, offered to {leagueName(w.competitionId)}</span>
              <button type="button" data-testid="go-window-remove" disabled={busy} aria-label={`Withdraw the slot on ${dayWords(saDay(w.startsAt))}`}
                onClick={() => remove(`/api/ground-windows/${w.id}/remove`, "The slot is withdrawn. A draft that used it will be refused when published.")} style={S.secondary}>Withdraw</button>
            </div>
          ))}
        </div>
      </section>

      <section style={S.card} aria-label="Close the ground" data-testid="go-close">
        <h4 style={S.h4}>Close the ground</h4>
        <form onSubmit={close} style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
          <div style={S.wrap}>
            <Field label="First day closed">{(id) => <input id={id} data-testid="go-close-from" type="date" value={closure.from} onChange={(e) => setClosure({ ...closure, from: e.target.value })} style={S.input}/>}</Field>
            <Field label="Last day closed (blank for one day)">{(id) => <input id={id} data-testid="go-close-to" type="date" value={closure.to} onChange={(e) => setClosure({ ...closure, to: e.target.value })} style={S.input}/>}</Field>
            <Field label="Why (3 to 120 characters)" grow>{(id) => <input id={id} data-testid="go-close-reason" type="text" maxLength={120} value={closure.reason} onChange={(e) => setClosure({ ...closure, reason: e.target.value })} style={S.input}/>}</Field>
          </div>
          <Alert words={closeErr} testid="go-close-error"/>
          <div><button type="submit" data-testid="go-close-add" disabled={busy || !closure.from} style={{ ...S.primary, opacity: busy || !closure.from ? 0.5 : 1 }}>Close the ground</button></div>
        </form>
        <div data-testid="go-closures">
          {lists.closures.length === 0 && <p style={S.body}>The ground is not closed.</p>}
          {lists.closures.map((c) => (
            <div key={c.id} data-testid="go-closure" style={{ ...S.row, minHeight: "44px" }}>
              <span style={S.body}>Closed {slotWords(c.from, c.to)}: {c.reason}</span>
              <button type="button" data-testid="go-closure-remove" disabled={busy} aria-label={`Reopen the ground after the closure on ${dayWords(saDay(c.from))}`}
                onClick={() => remove(`/api/ground-closures/${c.id}/remove`, "The closure is removed.")} style={S.secondary}>Remove</button>
            </div>
          ))}
        </div>
      </section>

      <section style={S.card} aria-label="Name the ends" data-testid="go-ends">
        <div>
          <h4 style={S.h4}>Name the ends</h4>
          <p style={S.meta}>The two ends of the strip, such as “Pavilion End” and “School End”. Both or neither. Set them on the pitch where the ground has pitches, since two strips on one field may lie differently.</p>
        </div>
        <form onSubmit={saveEnds} style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
          <div style={S.wrap}>
            <Field label="One end" grow>{(id) => <input id={id} data-testid="go-end-a" type="text" maxLength={40} value={ends.endA} onChange={(e) => setEnds({ ...ends, endA: e.target.value })} style={S.input}/>}</Field>
            <Field label="The other end" grow>{(id) => <input id={id} data-testid="go-end-b" type="text" maxLength={40} value={ends.endB} onChange={(e) => setEnds({ ...ends, endB: e.target.value })} style={S.input}/>}</Field>
          </div>
          <Alert words={endsErr} testid="go-ends-error"/>
          <div style={S.wrap}>
            <button type="submit" data-testid="go-ends-save" disabled={busy} style={S.primary}>Save the ends</button>
            <button type="button" data-testid="go-ends-clear" disabled={busy} onClick={(e) => saveEnds(e, true)} style={S.secondary}>Clear both</button>
          </div>
        </form>
      </section>
    </div>
  );
}
