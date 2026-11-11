/**
 * Pilot Match phase 2, the phone's store (lib/pilot.js; PILOT_MATCH_PHASE2 §3, §7.2).
 *
 *   A  The slots: one uuid per typed player, his side, list and batting
 *      number, the twelfth man; positions only. The pad's config scores on
 *      them ({id, name} squads, openers and bowler by slot) and the record is
 *      keyed by them.
 *   B  What leaves for pilot_create: sides, slots, overs, toss, the venue's
 *      name and the weather's conditions — never a player's name, never the
 *      phone's position. What leaves for the names, only when allowed.
 *   C  The store: under pilot:, never practice:; the practice store routes a
 *      pilot id there; delete one leaves nothing of it.
 *   D  The refusal: demoteToPractice() moves record and log under practice:
 *      with a practice id and leaves no pilot: key; never the other way.
 *   E  The names' date on the phone: the end is the last ball, not the last
 *      save; past it, every name in the record and the log is a position,
 *      before the server's date if that is earlier.
 *   F  Only the scorer's modules import the pilot store.
 *
 * Names here are made up; the canary `Qa Canarytest` is nobody.
 *
 *   node apps/web/test/pilot.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const disk = new Map();
const ls = {};
for (const [k, f] of Object.entries({
  getItem: (/** @type {string} */ key) => (disk.has(key) ? disk.get(key) : null),
  // Enumerable keys, as the real one has: persist.js lists them.
  setItem: (/** @type {string} */ key, /** @type {unknown} */ v) => { disk.set(key, String(v)); /** @type {any} */ (ls)[key] = String(v); },
  removeItem: (/** @type {string} */ key) => { disk.delete(key); delete /** @type {any} */ (ls)[key]; },
})) Object.defineProperty(ls, k, { value: f, enumerable: false });
globalThis.localStorage = /** @type {any} */ (ls);
globalThis.fetch = async () => { throw new Error("no network in this suite"); };

const P = await import("../src/lib/pilot.js");
const practice = await import("../src/lib/practice.js");
const store = await import("../src/lib/persist.js");
const { pilotWire } = await import("../src/lib/pilotWire.js");

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANARY = "Qa Canarytest";

const draft = {
  ...practice.blankDraft(),
  venue: { name: "Walk Oval", lat: -29.54012, lon: 30.28765, accuracy_m: 20 },
  weather: { condition: "overcast", playable: true, observation: null },
  teams: [{ school: "Hilton", division: "U13", cls: "B" }, { school: "Kearsney", division: "U13", cls: "B" }],
  squads: [
    [{ name: "Alpha One", twelfth: false }, { name: CANARY, twelfth: false }, { name: "Alpha Three", twelfth: true }],
    [{ name: "Bravo One", twelfth: false }, { name: "Bravo Two", twelfth: false }],
  ],
  toss: 0, bat: 0,
};
const ALL = ["Alpha One", CANARY, "Alpha Three", "Bravo One", "Bravo Two"];

group("A. Slots, the pad's config, the record");
const slots = P.pilotSlots(draft);
const id = P.newPilotId();
const cfg = P.pilotCfg(draft, { id, opener1: "Alpha One", opener2: CANARY, openBowler: "Bravo One" }, slots);
const rec = P.pilotRecord(draft, id, slots, 1794400000000, { namesMayGo: false });
{
  ok("a pilot id is pilot- and a v4 uuid", store.isPilotId(id) && UUID.test(/** @type {string} */ (P.pilotUuid(id))), id);
  ok("five slots, uuids, sides and list numbers", slots.slots.length === 5 && slots.slots.every((s) => UUID.test(s.id))
     && slots.slots.filter((s) => s.side === "home").map((s) => s.list_no).join() === "1,2,3");
  ok("...batting numbers for the XI, none for the twelfth man", slots.slots.filter((s) => s.side === "home").map((s) => s.batting_no).join() === "1,2,"
     && slots.slots.find((s) => s.twelfth)?.batting_no === null);
  ok("...and no name in a slot", !JSON.stringify(slots.slots).includes("Alpha") && !JSON.stringify(slots.slots).toLowerCase().includes("canary"));
  ok("the roster holds them, beside, with the sides' names", Object.values(slots.roster.slots).map((s) => s.name).sort().join() === [...ALL].sort().join()
     && slots.roster.teams.home === "Hilton U13B" && slots.roster.teams.away === "Kearsney U13B");
  ok("the config is a practice config marked pilot, on its id", cfg.practice === true && cfg.pilot === true && cfg.matchId === id);
  ok("...squads of {id, name}, the XI only", cfg.squad1.length === 2 && cfg.squad1.every((p) => UUID.test(p.id) && typeof p.name === "string") && cfg.squad1[1].name === CANARY);
  ok("...openers and bowler as their slots", UUID.test(cfg.opener1) && UUID.test(cfg.opener2) && UUID.test(cfg.openBowler)
     && slots.roster.slots[cfg.opener2].name === CANARY && slots.roster.slots[cfg.openBowler].name === "Bravo One");
  ok("...the twelfth man by name, as the pad shows him", cfg.twelfth1 === "Alpha Three");
  ok("the record's players are keyed by slot", rec.players.every((p) => UUID.test(p.id)) && rec.match_squad.every((m) => UUID.test(m.player_id)));
  ok("...marked pilot, not practice; pending; its names not to go", rec.match.pilot === true && rec.match.practice === false
     && rec.pilot.server === "pending" && rec.pilot.namesMayGo === false && rec.pilot.namesSent === false);
  const w = pilotWire({ kind: "innings_start", battingTeam: cfg.teamKey1, bowlingTeam: cfg.teamKey2, squad: cfg.squad1, bowlingSquad: cfg.squad2, twelfthMan: cfg.twelfth1 }, rec.pilot.roster);
  ok("the config's first innings goes on the wire with no name", w.ok && !/Alpha|Bravo|canarytest/i.test(JSON.stringify(w.event)), JSON.stringify(w));
}

group("B. What leaves for the server");
{
  const body = P.createBody(rec);
  const s = JSON.stringify(body);
  ok("pilot_create's body: the id, two sides, five slots, overs, toss", body.id === P.pilotUuid(id) && body.sides.length === 2 && body.slots.length === 5
     && body.overs === 20 && body.toss.wonBy === "home" && body.toss.decision === "bat");
  ok("...no player's name", !ALL.some((n) => s.includes(n)) && !/canarytest/i.test(s), s.slice(0, 300));
  ok("...never the venue's name, never the phone's position (S4)", body.venueName === null && !s.includes("Walk Oval") && !/-29\.54|30\.28|"lat"|"lon"|accuracy/.test(s), s);
  ok("...and, unless the names may go, the sides as their place: Home U13B, Away U13B",
     body.sides.map((x) => `${x.school}|${x.display_name}`).join() === "Home|Home U13B,Away|Away U13B" && !/Hilton|Kearsney/.test(s), JSON.stringify(body.sides));
  const real = P.createBody(rec, { sidesMayGo: true });
  ok("where the names may go, the sides' real names go too", real.sides.map((x) => x.display_name).join() === "Hilton U13B,Kearsney U13B");
  const named = P.createBody({ ...rec, teams: [{ ...rec.teams[0], school: "Qa Canarytest Academy", display_name: "Qa Canarytest Academy U13B" }, rec.teams[1]] },
                             { sidesMayGo: true });
  ok("...but never a side whose name holds a typed name as whole words: it goes as its place",
     named.sides[0].school === "Home" && !/canarytest/i.test(JSON.stringify(named)) && named.sides[1].school === "Kearsney", JSON.stringify(named.sides));
  ok("...the weather's conditions alone", body.weather?.condition === "overcast" && !("observed_at" in (body.weather ?? {})));
  const nb = P.namesBody(rec);
  ok("the names' body: each slot's name, for the one request that carries them", nb.rows.length === 5 && nb.rows.some((r) => r.name === CANARY && UUID.test(r.slot)));
}

group("C. The store");
{
  await practice.savePractice(rec);
  const keys = (await store.recordKeys("")) ?? [];
  ok("the practice store routes a pilot record under pilot:meta:", keys.includes(`pilot:meta:${id}`) && !keys.some((k) => k.startsWith("practice:")), keys.join(" "));
  ok("loadPilot and loadPractice read it alike", (await P.loadPilot(id))?.id === id && (await practice.loadPractice(id))?.id === id);
  await store.saveMatch(id, { events: [[{ kind: "innings_start", clientTs: 1794400000000 }], []], cfg });
  ok("its log under pilot:log:", ((await store.recordKeys("pilot:log:")) ?? []).includes(`pilot:log:${id}`));
  ok("...and listPractice does not list it; listPilot does", !(await practice.listPractice()).some((r) => r.id === id) && (await P.listPilot()).some((r) => r.id === id));
  const r2 = await P.updatePilotState(id, { server: "created" });
  ok("updatePilotState keeps the record and moves the state", r2?.pilot?.server === "created" && r2?.players?.length === 5);
  await practice.saveDraft({ ...practice.blankDraft(), mode: "pilot", step: 1 });
  ok("a draft that chose Send live is kept under pilot:draft, and only there",
     ((await store.recordKeys("pilot:draft")) ?? []).length === 1 && ((await store.recordKeys("practice:draft")) ?? []).length === 0);
  await practice.saveDraft({ ...practice.blankDraft(), mode: "practice", step: 1 });
  ok("...one that chose this phone, under practice:draft, and only there",
     ((await store.recordKeys("pilot:draft")) ?? []).length === 0 && ((await store.recordKeys("practice:draft")) ?? []).length === 1);
  await practice.clearDraft();
}

group("D. The refusal: a Pilot Match becomes a Practice Match, never the reverse");
{
  const pid = await P.demoteToPractice(id);
  ok("it has a practice id", store.isPracticeId(pid) && !store.isPilotId(pid), pid);
  const left = (await store.recordKeys("")) ?? [];
  ok("...its record and its log are under practice:, and nothing under pilot: is left",
     left.includes(`practice:meta:${pid}`) && left.includes(`practice:log:${pid}`) && !left.some((k) => k.startsWith("pilot:")), left.join(" "));
  const prec = await practice.loadPractice(/** @type {string} */ (pid));
  ok("...the record says so, and carries no pilot state", prec?.demotedFromPilot === true && !("pilot" in prec) && prec.match.practice === true);
  ok("...the log's config is a practice one", (await store.loadMatch(/** @type {string} */ (pid)))?.cfg?.pilot === false);
  ok("nothing turns a practice id into a pilot id", (await P.demoteToPractice(/** @type {string} */ (pid))) === null && P.pilotUuid(pid) === null);
  await practice.deleteAllPractice();
}

group("E. The names' date, on the phone");
{
  const DAY = 86400000;
  const id2 = P.newPilotId();
  const s2 = P.pilotSlots(draft);
  const r2 = P.pilotRecord(draft, id2, s2, 1000);
  const c2 = P.pilotCfg(draft, { id: id2, opener1: "Alpha One", opener2: CANARY, openBowler: "Bravo One" }, s2);
  await P.savePilot(r2);
  const lastBall = 1794400000000;
  await store.saveMatch(id2, { events: [[{ kind: "innings_start", clientTs: 2000, squad: c2.squad1, bowlingSquad: c2.squad2, twelfthMan: "Alpha Three" },
                                         { kind: "ball", clientTs: lastBall, fielder: "Bravo Two" }], []], cfg: c2 });
  const log = await store.loadMatch(id2);
  ok("the end is the last ball, not the save", P.endOf(await P.loadPilot(id2), { ...log, savedAt: lastBall + 40 * DAY }) === lastBall);
  ok("before the date, nothing is purged", (await P.purgeExpiredNames(lastBall + 29 * DAY)) === 0);
  ok("past it, the match is purged", (await P.purgeExpiredNames(lastBall + 31 * DAY)) === 1);
  const after = JSON.stringify([await P.loadPilot(id2), await store.loadMatch(id2)]);
  ok("...and no typed name is left in its record or its log", !ALL.some((n) => after.includes(n)), after.slice(0, 300));
  ok("...the players read as their positions", after.includes("Home No. 2") && after.includes("Away No. 2"));
  ok("...once: a second pass purges nothing", (await P.purgeExpiredNames(lastBall + 60 * DAY)) === 0);
  // The server's date, where it is earlier, wins.
  const id3 = P.newPilotId();
  const r3 = P.pilotRecord(draft, id3, P.pilotSlots(draft), 1000);
  await P.savePilot({ ...r3, pilot: { ...r3.pilot, serverNamesPurgeAfter: new Date(lastBall + 5 * DAY).toISOString() } });
  await store.saveMatch(id3, { events: [[{ kind: "ball", clientTs: lastBall }], []] });
  ok("the server's earlier date wins: the phone's copy never outlives it", (await P.purgeExpiredNames(lastBall + 6 * DAY)) === 1);
  ok("deletePilotHere leaves nothing of a match", (await P.deletePilotHere(id2)) && (await P.deletePilotHere(id3)));
  ok("...and deleteAllPilotHere sweeps the prefix", (await P.deleteAllPilotHere()).left === 0);
}

group("F. Who may read the pilot store");
{
  const readers = [];
  const walk = (/** @type {string} */ dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name) && /from\s+["'][^"']*\/lib\/pilot\.js["']|from\s+["']\.\/pilot\.js["']/.test(readFileSync(p, "utf8"))) readers.push(p.replace(/\\/g, "/"));
  } };
  walk(join(import.meta.dirname, "../src"));
  ok("only the scorer's own modules import it", readers.length > 0 && readers.every((r) => /\/scorer\//.test(r)), readers.join(", "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
