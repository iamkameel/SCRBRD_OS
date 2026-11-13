/**
 * A Practice or Pilot Match scored by position (Q5, Kameel 13 Nov 2026: "as
 * recommended", option b): the scorer skips the names, each side plays as
 * "Home No. 1" to "Home No. 11", and WHAT THE PAD RECORDS IS UNCHANGED.
 *
 *   A  The squads: a side with nothing typed plays by position, eleven of
 *      them, marked, in the pad's own words (pilotWire.js positionWords); a
 *      name typed takes the positions' place; a side with names keeps them.
 *   B  The events, Practice: the same match opened and scored on typed names
 *      and on positions writes events of the same kinds, with the same keys,
 *      each value of the same type, in the same order: the opening events
 *      (scorer/opening.js, the engine's own builder), a run, a caught
 *      wicket with its fielder, the next batter. Only the words differ.
 *   C  The events, Pilot: as B, scored on slot ids; every event leaves
 *      through pilotWire() the same shape as the named match's, a position
 *      never on the wire, the fielder and the twelfth man as their slots.
 *      The roster holds no name, so namesBody() offers SCRBRD nothing, and
 *      the record's players read as positions.
 *   D  Nothing else moved: a named Pilot Match's slots, config and wire are
 *      as before (its squads matched by place, which is its name's).
 *
 *   node apps/web/test/positions.test.mjs
 */
const disk = new Map();
const ls = {};
for (const [k, f] of Object.entries({
  getItem: (/** @type {string} */ key) => (disk.has(key) ? disk.get(key) : null),
  setItem: (/** @type {string} */ key, /** @type {unknown} */ v) => { disk.set(key, String(v)); /** @type {any} */ (ls)[key] = String(v); },
  removeItem: (/** @type {string} */ key) => { disk.delete(key); delete /** @type {any} */ (ls)[key]; },
})) Object.defineProperty(ls, k, { value: f, enumerable: false });
globalThis.localStorage = /** @type {any} */ (ls);
globalThis.fetch = async () => { throw new Error("no network in this suite"); };

const practice = await import("../src/lib/practice.js");
const P = await import("../src/lib/pilot.js");
const { pilotWire, positionWords } = await import("../src/lib/pilotWire.js");
const { openingEvents } = await import("../src/scorer/opening.js");
const { deliveryEvents, crease } = await import("../src/scorer/delivery.js");
const { foldPad } = await import("../src/scorer/penalty.js");
const { ball: ballEvent, batters: battersEvent } = await import("@scrbrd/scoring");

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
const POS = /^(Home|Away) No\. \d+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const HOME = Array.from({ length: 11 }, (_, i) => `Alpha ${["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven"][i]}`);
const AWAY = HOME.map((n) => n.replace("Alpha", "Bravo"));
const base = {
  ...practice.blankDraft(),
  teams: [{ school: "Hilton", division: "U13", cls: "B" }, { school: "Kearsney", division: "U13", cls: "B" }],
  toss: 0, bat: 0, overs: 20,
};
const named = { ...base, squads: [practice.addNames([], HOME), practice.addNames([], AWAY)] };
const nameless = { ...base, squads: [[], []] };

group("A. The squads");
{
  const sq = practice.playingSquads(nameless.squads);
  ok("a side with nothing typed plays by position: eleven a side", sq[0].length === 11 && sq[1].length === 11);
  ok("...in the pad's own words, home first", sq[0][0].name === positionWords("home", 1) && sq[0][10].name === "Home No. 11" && sq[1][2].name === "Away No. 3");
  ok("...each marked a position, none a twelfth man", sq.flat().every((p) => practice.isPosition(p) && p.twelfth === false));
  ok("...and a squad the setup accepts: no name twice across or within the sides",
     practice.validateSquad(sq[0]).ok && practice.validateSquad(sq[1]).ok && practice.sharedNames(sq[0], sq[1]).length === 0);
  ok("a side with names keeps them", practice.playingSquads(named.squads)[0].map((p) => p.name).join() === HOME.join());
  const typed = practice.addNames(practice.positionSquad("home"), ["Qa Canarytest", "Alpha Two"]);
  ok("a name typed on a side by position takes the positions' place", typed.length === 2 && !typed.some(practice.isPosition) && practice.hasTypedNames(typed));
  ok("...a side by position holds no typed name", !practice.hasTypedNames(practice.positionSquad("away")) && !practice.hasTypedNames([]));
}

/**
 * The pad scoring a few balls as engine.jsx does: the opening events, a
 * single, a catch (confirmWicket: the wicket ball with the fielder as the
 * sheet's text), and the next batter in (addBatsman). Returns the log.
 * @param {any} cfg @param {(squad: any[]) => string} fielderOf  the wicket sheet's fielder text
 */
function scored(cfg, fielderOf) {
  const events = openingEvents(cfg);
  const at = (/** @type {any[]} */ ...evs) => { events[0] = [...events[0], ...evs.map((e) => ({ ...e, innings: 0 }))]; };
  const inn = () => foldPad(events, {})[0];
  let before = inn();
  at(...deliveryEvents({ curIn: 0, before, freeHit: before.freeHit, type: "run", value: 1, shot: null, seg: null, zone: null, approach: null, placement: null }));
  before = inn();
  at(ballEvent({ type: "W", value: 0, shot: null, seg: null, zone: null, dismissal: "caught", fielder: fielderOf(before.bowlingSquad ?? cfg.squad2), freeHit: false, ...crease(before) }));
  const xi = (cfg.squad1 ?? []).map((/** @type {any} */ p) => (typeof p === "string" ? p : p.id));
  const inNow = new Set([cfg.opener1, cfg.opener2]);
  at(battersEvent({ striker: xi.find((id) => !inNow.has(id)) }));
  return events;
}

/** An event as its shape: its kind, and each key with its value's type (a player is a player, whatever he is called). @param {any} e */
const shape = (e) => Object.keys(e).sort().map((k) => `${k}:${Array.isArray(e[k]) ? `array(${e[k].length})` : e[k] === null ? "null" : typeof e[k]}`).join(",");
/** @param {any[][]} log */
const shapes = (log) => log.map((evs) => evs.map((e) => `${e.kind}{${shape(e)}}`));

group("B. Practice: the events have the same shape");
{
  const lu = practice.playingSquads(nameless.squads).map(practice.lineUp);
  const cN = practice.practiceCfg(named, { id: "practice-x-named", opener1: HOME[0], opener2: HOME[1], openBowler: AWAY[0] });
  const cP = practice.practiceCfg(nameless, { id: "practice-x-pos", opener1: lu[0].xi[0], opener2: lu[0].xi[1], openBowler: lu[1].xi[0] });
  ok("the config by position: plain strings, the XI as positions", cP.squad1.length === 11 && cP.squad1.every((n) => typeof n === "string" && POS.test(n)) && cP.opener1 === "Home No. 1");
  ok("...the same keys as a named config", Object.keys(cP).sort().join() === Object.keys(cN).sort().join());
  const lN = scored(cN, () => AWAY[3]);
  const lP = scored(cP, () => "Away No. 4");
  const sN = shapes(lN), sP = shapes(lP);
  ok("the same events, in the same order, each with the same keys and value types", JSON.stringify(sN) === JSON.stringify(sP),
     sN.flat().filter((x, i) => x !== sP.flat()[i]).join(" | "));
  ok("...six events opening and scoring the first innings, the second innings declared", lP[0].length === 6 && lP[1].length === 1 && lP[0].map((e) => e.kind).join() === "innings_start,batters,bowler,ball,ball,batters");
  const fN = foldPad(lN, {})[0], fP = foldPad(lP, {})[0];
  ok("...and they fold to the same score", fN.runs === fP.runs && fN.wickets === fP.wickets && fN.balls === fP.balls && fP.runs === 1 && fP.wickets === 1 && fP.balls === 2,
     `${fN.runs}/${fN.wickets} ${fN.balls} v ${fP.runs}/${fP.wickets} ${fP.balls}`);
  ok("...the fielder kept as the sheet's text, a position", lP[0][4].fielder === "Away No. 4");
  const rec = practice.practiceRecord(nameless, "practice-x-pos", 1794400000000);
  ok("the record's players read as positions, 22 of them", rec.players.length === 22 && rec.players.every((p) => POS.test(p.full_name)));
  ok("...with batting numbers 1 to 11 a side", rec.match_squad.filter((m) => m.side === "home").map((m) => m.batting_no).join() === "1,2,3,4,5,6,7,8,9,10,11");
}

group("C. Pilot: the same shape on the wire, no position and no name on it");
{
  const sN = P.pilotSlots(named), sP = P.pilotSlots(nameless);
  ok("a side by position gets its slots as a named one does", sP.slots.length === 22 && sP.slots.every((s) => UUID.test(s.id)) && sP.slots.filter((s) => s.side === "home").map((s) => s.batting_no).join() === "1,2,3,4,5,6,7,8,9,10,11");
  ok("...and its roster keeps no name", Object.values(sP.roster.slots).every((s) => s.name === null));
  const cN = P.pilotCfg(named, { id: "pilot-11111111-1111-4111-8111-111111111111", opener1: HOME[0], opener2: HOME[1], openBowler: AWAY[0] }, sN);
  const lu = practice.playingSquads(nameless.squads).map(practice.lineUp);
  const cP = P.pilotCfg(nameless, { id: "pilot-22222222-2222-4222-8222-222222222222", opener1: lu[0].xi[0], opener2: lu[0].xi[1], openBowler: lu[1].xi[0] }, sP);
  ok("the config by position: {id, name} on slots, the pad's position words", cP.squad1.every((p) => UUID.test(p.id) && POS.test(p.name)) && UUID.test(cP.opener1) && UUID.test(cP.openBowler));
  ok("...the openers and bowler are the slots of No. 1, No. 2 and Away No. 1",
     sP.roster.slots[cP.opener1].list_no === 1 && sP.roster.slots[cP.opener2].list_no === 2 && sP.roster.slots[cP.openBowler].side === "away" && sP.roster.slots[cP.openBowler].list_no === 1);
  const fieldText = (/** @type {any[]} */ sq) => (sq.find((/** @type {any} */ p) => (p.name ?? p) === "Away No. 4" || (p.name ?? p) === AWAY[3])?.name ?? null);
  const lN = scored(cN, fieldText), lP = scored(cP, fieldText);
  ok("the same events, keys and value types on the phone", JSON.stringify(shapes(lN)) === JSON.stringify(shapes(lP)));
  const rN = P.pilotRecord(named, cN.matchId, sN, 1794400000000, { namesMayGo: false });
  const rP = P.pilotRecord(nameless, cP.matchId, sP, 1794400000000, { namesMayGo: false });
  const wire = (/** @type {any[][]} */ log, /** @type {any} */ roster) => log.flat().map((e) => pilotWire(e, roster));
  const wN = wire(lN, rN.pilot.roster), wP = wire(lP, rP.pilot.roster);
  ok("every event of both leaves the phone", wN.every((w) => w.ok) && wP.every((w) => w.ok), JSON.stringify(wP.filter((w) => !w.ok)));
  const ev = (/** @type {any[]} */ w) => w.map((x) => (x.ok ? x.event : {}));
  ok("...with the same keys and value types on the wire", JSON.stringify(ev(wN).map(shape)) === JSON.stringify(ev(wP).map(shape)),
     ev(wN).map(shape).filter((x, i) => x !== ev(wP).map(shape)[i]).join(" | "));
  const caught = ev(wP).find((e) => e.dismissal === "caught");
  ok("...the catch's fielder as his slot, not left off", !!caught && UUID.test(caught.fielder) && rP.pilot.roster.slots[caught.fielder]?.list_no === 4 && rP.pilot.roster.slots[caught.fielder]?.side === "away", JSON.stringify(caught));
  ok("...and no position on the wire anywhere", !JSON.stringify(ev(wP)).includes("No. "));
  ok("the names SCRBRD would be offered: none", P.namesBody(rP).rows.length === 0);
  ok("the record's players read as positions", rP.players.every((p) => POS.test(p.full_name)));
  const body = JSON.stringify(P.createBody(rP));
  ok("what pilot_create is sent carries no position and no name", !body.includes("No. ") && !/Alpha|Bravo/.test(body));
}

group("D. A named Pilot Match is as it was");
{
  const s = P.pilotSlots(named);
  const c = P.pilotCfg(named, { id: "pilot-33333333-3333-4333-8333-333333333333", opener1: HOME[2], opener2: HOME[4], openBowler: AWAY[6] }, s);
  ok("its roster keeps the names typed", Object.values(s.roster.slots).filter((x) => x.side === "home").map((x) => x.name).join() === HOME.join());
  ok("...each of the XI on the slot of his place in the list", c.squad1.every((p, i) => s.roster.slots[p.id]?.name === HOME[i] && s.roster.slots[p.id]?.list_no === i + 1));
  ok("...the openers and bowler on theirs", s.roster.slots[c.opener1].name === HOME[2] && s.roster.slots[c.opener2].name === HOME[4] && s.roster.slots[c.openBowler].name === AWAY[6]);
  const r = P.pilotRecord(named, c.matchId, s, 1794400000000, { namesMayGo: false });
  const w = pilotWire({ kind: "ball", type: "W", value: 0, dismissal: "caught", fielder: AWAY[3], striker: c.opener1, nonStriker: c.opener2, bowler: c.openBowler }, r.pilot.roster);
  ok("...a named fielder still leaves as his slot", w.ok && UUID.test(/** @type {any} */ (w).event.fielder));
  const typedPos = pilotWire({ kind: "ball", type: "run", value: 0, fielder: "Away No. 4", striker: c.opener1, nonStriker: c.opener2, bowler: c.openBowler }, r.pilot.roster);
  ok("...and a position word names no slot that has a name (a substitute: left off)", typedPos.ok && /** @type {any} */ (typedPos).event.fielder === null);
}

console.log(`\npositions: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
