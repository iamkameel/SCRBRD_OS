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
 *      as before (its squads matched by place, which is its name's), and
 *      after its names' date (withoutNames) its fielder in position words is
 *      still left off.
 *   E  A second phone (restoreFromServer): a slot the server gave it with no
 *      name is a position, so a catch by "Away No. 4" and a twelfth man as
 *      "Home No. 12" leave as their slots; a slot that came with its name is
 *      not, and after its date is sent as D's; a typed name is still refused.
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
const CANARY_NAME = "Qa Canarytest";
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
  ok("...and its roster keeps no name, each slot marked a position", Object.values(sP.roster.slots).every((s) => s.name === null && s.position === true));
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
  // Review (slice 1): a slot whose name has gone (purged on this phone) is no position slot: its fielder in
  // position words is left off, as before Q5. Nothing on the wire moves for it. (A second phone the names never
  // reached is E's: restoreFromServer marks its nameless slots.)
  const gone = { ...r.pilot.roster, slots: Object.fromEntries(Object.entries(r.pilot.roster.slots).map(([k, x]) => [k, { ...x, name: null }])) };
  const purged = pilotWire({ kind: "ball", type: "W", value: 0, dismissal: "caught", fielder: "Away No. 4", striker: c.opener1, nonStriker: c.opener2, bowler: c.openBowler }, gone);
  ok("...and a named match whose names have gone sends its fielder as before (left off)", purged.ok && /** @type {any} */ (purged).event.fielder === null, JSON.stringify(purged));
  const out = P.withoutNames(r, { events: [[]], cfg: c });
  ok("...the same through withoutNames itself: no slot marked a position", Object.values(out.rec.pilot.roster.slots).every((x) => x.name === null && x.position !== true));
  const after = pilotWire({ kind: "ball", type: "W", value: 0, dismissal: "caught", fielder: "Away No. 4", striker: c.opener1, nonStriker: c.opener2, bowler: c.openBowler }, out.rec.pilot.roster);
  ok("...so its fielder in position words is left off, as main sends it", after.ok && /** @type {any} */ (after).event.fielder === null, JSON.stringify(after));
}

group("E. A second phone: the slots the server gave it without names are positions");
{
  // The server's header for a match, as GET /api/pilot/:id gives it: the slots, no name.
  const uuidOf = (/** @type {number} */ n) => `${String(n).padStart(8, "0")}-4444-4444-8444-444444444444`;
  const slots = ["home", "away"].flatMap((side, s) => Array.from({ length: 12 }, (_, i) => ({
    id: uuidOf(s * 100 + i + 1), side, list_no: i + 1, batting_no: i < 11 ? i + 1 : null, twelfth: i === 11,
  })));
  const slotAt = (/** @type {string} */ side, /** @type {number} */ n) => /** @type {any} */ (slots.find((x) => x.side === side && x.list_no === n)).id;
  /** @param {{slot: string, name: string}[]} names */
  const server = (names) => async (/** @type {string} */ path) => (
    path.endsWith("/names") ? { names }
    : path.endsWith("/events") ? { events: [] }
    : { slots, overs: 20, startsAt: "2026-11-14T08:00:00.000Z", status: "live", namesPurgeAfter: null,
        sides: [{ side: "home", display_name: "Hilton U13B" }, { side: "away", display_name: "Kearsney U13B" }] });
  const catchBy = (/** @type {string} */ fielder) => ({ kind: "ball", type: "W", value: 0, dismissal: "caught", fielder,
    striker: slotAt("home", 1), nonStriker: slotAt("home", 2), bowler: slotAt("away", 1) });
  const start = (/** @type {string} */ twelfthMan) => ({ kind: "innings_start", battingTeam: "Hilton U13B", bowlingTeam: "Kearsney U13B",
    squad: Array.from({ length: 11 }, (_, i) => slotAt("home", i + 1)), bowlingSquad: Array.from({ length: 11 }, (_, i) => slotAt("away", i + 1)), twelfthMan });

  // The names never reached this phone (not sent, or their date passed on the server).
  const id = await P.restoreFromServer("55555555-5555-4555-8555-555555555555", { call: /** @type {any} */ (server([])) });
  const rec = await P.loadPilot(id);
  const roster = rec?.pilot?.roster;
  ok("restored: every slot without a name, marked a position", !!roster && Object.values(roster.slots).length === 24
     && Object.values(roster.slots).every((/** @type {any} */ x) => x.name === null && x.position === true));
  const w = pilotWire(catchBy("Away No. 4"), roster);
  ok("a second phone's catch by \"Away No. 4\" sends that slot's id", w.ok && /** @type {any} */ (w).event.fielder === slotAt("away", 4), JSON.stringify(w));
  const t = pilotWire(start("Home No. 12"), roster);
  ok("...and its twelfth man, \"Home No. 12\", his slot's id", t.ok && /** @type {any} */ (t).event.twelfthMan === slotAt("home", 12), JSON.stringify(t));
  ok("...with no position on the wire", !JSON.stringify([w, t]).includes("No. "));
  const typed = pilotWire({ ...catchBy("Away No. 4"), striker: CANARY_NAME }, roster);
  ok("a typed name in a player's place is still refused", !typed.ok && /** @type {any} */ (typed).reason === "name_on_wire" && /** @type {any} */ (typed).field === "striker", JSON.stringify(typed));
  const sub = pilotWire(catchBy(CANARY_NAME), roster);
  ok("...a substitute fielder typed in is left off, never sent", sub.ok && /** @type {any} */ (sub).event.fielder === null && !JSON.stringify(sub).includes(CANARY_NAME));

  // The names did reach it (home's typed, away's scored by position): only the nameless slots are positions.
  const names = HOME.map((name, i) => ({ slot: slotAt("home", i + 1), name }));
  const id2 = await P.restoreFromServer("66666666-6666-4666-8666-666666666666", { call: /** @type {any} */ (server(names)) });
  const rec2 = await P.loadPilot(id2);
  const r2 = rec2?.pilot?.roster;
  ok("restored with names: a named slot keeps its name, unmarked; a nameless one is a position",
     r2?.slots[slotAt("home", 3)]?.name === HOME[2] && r2?.slots[slotAt("home", 3)]?.position !== true && r2?.slots[slotAt("away", 4)]?.position === true);
  const w2 = pilotWire(catchBy("Away No. 4"), r2);
  ok("...its catch by \"Away No. 4\" sends that slot", w2.ok && /** @type {any} */ (w2).event.fielder === slotAt("away", 4), JSON.stringify(w2));
  const w2n = pilotWire({ ...catchBy(HOME[3]), bowler: slotAt("home", 1) }, r2);
  ok("...a named fielder his slot, and no name on the wire", w2n.ok && /** @type {any} */ (w2n).event.fielder === slotAt("home", 4) && !/Alpha/.test(JSON.stringify(w2n)));
  const hn = pilotWire(catchBy("Home No. 4"), r2);
  ok("...\"Home No. 4\" is no slot there: that slot has a name (left off)", hn.ok && /** @type {any} */ (hn).event.fielder === null);
  // Its names' date passes on this phone: the named slots go back to main's way, the position ones stay positions.
  const gone = P.withoutNames(/** @type {any} */ (rec2), { events: [[]] });
  const g = gone.rec.pilot.roster;
  ok("its names' date passed: no name kept, the named slots not made positions", Object.values(g.slots).every((/** @type {any} */ x) => x.name === null)
     && g.slots[slotAt("home", 4)].position !== true);
  const gw = pilotWire(catchBy("Home No. 4"), g);
  ok("...so a fielder of a once-named slot, in position words, is left off as main sends it", gw.ok && /** @type {any} */ (gw).event.fielder === null, JSON.stringify(gw));
  const gw2 = pilotWire(catchBy("Away No. 4"), g);
  ok("...and one of a slot that never had a name still his slot", gw2.ok && /** @type {any} */ (gw2).event.fielder === slotAt("away", 4), JSON.stringify(gw2));
}

console.log(`\npositions: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
