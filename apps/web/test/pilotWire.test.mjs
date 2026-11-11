/**
 * Pilot Match phase 2: the wire (lib/pilotWire.js; PILOT_MATCH_PHASE2 §3.2).
 *
 *   A  A PROPERTY TEST. Thousands of random events — every kind the pad
 *      writes, players as slot ids, as {id, name}, as the roster's names in
 *      any case and spacing, as substitutes nobody listed; teams by name or
 *      by side; free text in notes, reasons and nested values — over a
 *      roster that holds the canary. For every one: either it is held back
 *      (`name_on_wire`), or on the wire no string equals a roster name, every
 *      string is a code or an id, every player is a slot or nobody, every
 *      team is home or away, and no free text is left.
 *   B  The cases by hand: a clean ball, a squad of objects, a typed
 *      substitute fielder left off, a typed bowler held back, a note gone, a
 *      reason code kept, the team names gone.
 *   C  Deterministic (a retry is the same wire event), and pilotUnwire() puts
 *      the names back — positions where the roster has none.
 *   D  Phase 1's three locks still refuse a `practice-` id, and a `pilot-` id
 *      is not routed under `practice:`.
 *   E  The phone's allow-list and db/151's are one list: KIND_KEYS against
 *      pilot_kind_keys(), CLOSED against pilot_closed(), read out of the
 *      migration.
 *
 * The test name is the canary `Qa Canarytest`, which is nobody.
 *
 *   node apps/web/test/pilotWire.test.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pilotWire, pilotUnwire, PLAYER_FIELDS, TEAM_FIELDS, WIRE_STRING, KIND_KEYS, CLOSED, positionWords, containsWord, holdsAName } from "../src/lib/pilotWire.js";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${String(d).slice(0, 600)}`}`);
  if (c) pass++; else fail++;
};
const group = (/** @type {string} */ t) => console.log("\n" + t);
const normKey = (/** @type {unknown} */ s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

// A seeded generator, so a failure is the same failure on the next run.
let seed = 0x5eed1510;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = (/** @type {any[]} */ xs) => xs[Math.floor(rnd() * xs.length)];

const CANARY = "Qa Canarytest";
const HOME = ["Walk Home One", CANARY, "Sipho", "Émile Accent"];
const AWAY = ["Walk Away One", "Walk Away Two", "O'Neil", "Jean-Luc"];
const id = (/** @type {string} */ side, /** @type {number} */ i) => `00000000-0000-4000-8000-${side === "home" ? "1" : "2"}${String(i).padStart(11, "0")}`;
/** @type {import("../src/lib/pilotWire.js").PilotRoster} */
const roster = {
  slots: Object.fromEntries([
    ...HOME.map((name, i) => [id("home", i + 1), { side: "home", list_no: i + 1, name }]),
    ...AWAY.map((name, i) => [id("away", i + 1), { side: "away", list_no: i + 1, name }]),
    [id("away", 9), { side: "away", list_no: 9, name: null }],
  ]),
  teams: { home: "Walk Home U13B", away: "Walk Away U13B" },
};
const SLOTS = Object.keys(roster.slots);
const NAMES = [...HOME, ...AWAY];
const ROSTER_KEYS = new Set(NAMES.map(normKey));

const variants = (/** @type {string} */ n) => [n, n.toUpperCase(), n.toLowerCase(), `  ${n}  `, n.replace(" ", "   "), n.normalize("NFD")];
const aPlayer = () => {
  const r = rnd();
  const s = pick(SLOTS);
  if (r < 0.35) return s;
  if (r < 0.55) return { id: s, name: roster.slots[s].name ?? "x" };
  if (r < 0.75) return pick(variants(pick(NAMES)));
  if (r < 0.85) return pick(["A Substitute", "Typed Twelfth", "Qa  Canarytest Jnr"]);
  return null;
};
const aTeam = () => pick(["home", "away", "Walk Home U13B", "walk away u13b", "Walk  Home  U13B", "Some Other XI"]);
const freeText = () => pick(["hit on the helmet", "Rain", "Qa Canarytest was hurt", "bad light, umpires off", CANARY, "ok"]);
const KINDS = ["innings_start", "batters", "bowler", "ball", "penalty", "retire", "innings_end", "revision", "void", "keeper",
               "bowler_suspended", "play_stopped", "play_resumed"];
const anEvent = (/** @type {number} */ n) => {
  /** @type {Record<string, any>} */
  const ev = { kind: pick(KINDS), innings: Math.floor(rnd() * 2), clientTs: 1794400000000 + n, id: `dev-1:pilot-x:${n.toString(36)}:1` };
  for (const f of PLAYER_FIELDS) if (rnd() < 0.3) ev[f] = aPlayer();
  for (const f of TEAM_FIELDS) if (rnd() < 0.3) ev[f] = aTeam();
  if (rnd() < 0.3) ev.squad = Array.from({ length: 1 + Math.floor(rnd() * 4) }, aPlayer);
  if (rnd() < 0.3) ev.bowlingSquad = Array.from({ length: 1 + Math.floor(rnd() * 4) }, aPlayer);
  if (rnd() < 0.3) ev.note = freeText();
  if (rnd() < 0.3) ev.reason = pick(["retired_hurt", "rain", "injury", "scorer_undo", "sipho", "jean-luc", freeText()]);
  if (rnd() < 0.2) ev.detail = { why: freeText(), deep: [freeText(), 3, { k: freeText() }] };
  if (rnd() < 0.4) { ev.type = pick(["run", "W", "Wd", "Nb", "B", "LB"]); ev.value = Math.floor(rnd() * 7); }
  if (rnd() < 0.2) ev.dismissal = pick(["bowled", "caught", "run_out"]);
  if (rnd() < 0.1) ev.at = new Date(1794400000000 + n).toISOString();
  if (rnd() < 0.1) ev[pick(NAMES)] = 1;   // a name as a key
  return ev;
};

/** Every string in a value, and every key. @param {unknown} v @param {string[]} out */
const strings = (v, out = []) => {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out); }
  return out;
};

group("A. The property: no roster name on the wire, ever");
{
  const N = 6000;
  let sent = 0, held = 0;
  const bad = [];
  for (let n = 0; n < N; n++) {
    const ev = anEvent(n);
    const r = pilotWire(ev, roster);
    if (!r.ok) { held++; if (r.reason !== "name_on_wire") bad.push(["reason", r]); continue; }
    sent++;
    const w = r.event;
    const ss = strings(w);
    const name = ss.find((s) => ROSTER_KEYS.has(normKey(s)));
    if (name) bad.push(["name", name, ev]);
    const loose = ss.find((s) => !WIRE_STRING.test(s));
    if (loose) bad.push(["free text", loose, ev]);
    for (const f of PLAYER_FIELDS) if (w[f] != null && !SLOTS.includes(w[f])) bad.push(["player", f, w[f]]);
    for (const f of ["squad", "bowlingSquad"]) if (Array.isArray(w[f]) && w[f].some((x) => !SLOTS.includes(x))) bad.push(["squad", w[f]]);
    for (const f of TEAM_FIELDS) if (w[f] != null && w[f] !== "home" && w[f] !== "away") bad.push(["team", f, w[f]]);
    const allowed = new Set(["kind", "innings", "clientTs", "id", "seq", ...(KIND_KEYS[w.kind] ?? [])]);
    const stray = Object.keys(w).find((k) => !allowed.has(k));
    if (stray) bad.push(["key outside its kind's list", stray, w.kind]);
    if ("note" in w || "detail" in w && JSON.stringify(w.detail).includes(" ")) bad.push(["note", w]);
  }
  ok(`${N} random events: every one held back, or on the wire with no name and no free text`, bad.length === 0, JSON.stringify(bad.slice(0, 3)));
  ok("...and both happened, many times (the generator reaches both sides)", sent > N / 10 && held > N / 50, `${sent} sent, ${held} held`);
}

group("B. By hand");
{
  const H1 = id("home", 1), H2 = id("home", 2), W1 = id("away", 1);
  let r = pilotWire({ kind: "ball", type: "run", value: 4, striker: H1, nonStriker: H2, bowler: W1, innings: 0, id: "d:p:1:1", clientTs: 1 }, roster);
  ok("a clean ball goes as it is", r.ok && r.event.striker === H1 && r.event.bowler === W1 && r.event.value === 4, JSON.stringify(r));
  r = pilotWire({ kind: "innings_start", battingTeam: "Walk Home U13B", bowlingTeam: "Walk Away U13B", teamKey: "Walk Home U13B",
                  bowlingTeamKey: "Walk Away U13B", squad: [{ id: H1, name: "Walk Home One" }, { id: H2, name: CANARY }],
                  bowlingSquad: [{ id: W1, name: "Walk Away One" }], twelfthMan: "Sipho", overs: 20 }, roster);
  ok("an innings opens on slot ids and sides; the twelfth man is his slot", r.ok && r.event.squad.join() === `${H1},${H2}`
     && r.event.bowlingSquad.join() === W1 && r.event.battingTeam === "home" && r.event.bowlingTeamKey === "away"
     && r.event.twelfthMan === id("home", 3), JSON.stringify(r));
  ok("...and no name is in it", r.ok && !JSON.stringify(r.event).toLowerCase().includes("canarytest") && !JSON.stringify(r.event).includes("Walk"));
  r = pilotWire({ kind: "ball", type: "W", dismissal: "caught", striker: H1, bowler: W1, dismissed: H1, fielder: "A Substitute" }, roster);
  ok("a substitute fielder nobody listed is left off; the wicket goes", r.ok && r.event.fielder === null && r.event.dismissed === H1, JSON.stringify(r));
  r = pilotWire({ kind: "ball", type: "W", dismissal: "caught", striker: H1, bowler: W1, dismissed: H1, fielder: "walk away one" }, roster);
  ok("a fielder by his name goes as his slot", r.ok && r.event.fielder === W1, JSON.stringify(r));
  r = pilotWire({ kind: "bowler", bowler: "Typed Bowler" }, roster);
  ok("a bowler typed in who is no slot keeps the event on the phone", !r.ok && r.reason === "name_on_wire" && r.field === "bowler", JSON.stringify(r));
  r = pilotWire({ kind: "play_stopped", reason: "rain", note: "Qa Canarytest hit on the helmet" }, roster);
  ok("a stoppage's note is gone, its code stays", r.ok && r.event.reason === "rain" && !("note" in r.event), JSON.stringify(r));
  r = pilotWire({ kind: "retire", batter: H1, reason: "retired_hurt", text: "concussion" }, roster);
  ok("a retirement goes as its code alone, never the reason in words", r.ok && r.event.reason === "retired_hurt" && !("text" in r.event), JSON.stringify(r));
  r = pilotWire({ kind: "revision", overs: 15, reason: "the umpires said so" }, roster);
  ok("a reason in words is left off", r.ok && !("reason" in r.event) && r.event.overs === 15, JSON.stringify(r));
  r = pilotWire({ kind: "retire", batter: H1, reason: "sipho" }, roster);
  ok("a one-word name written as a code is caught by the last check", !r.ok && r.reason === "name_on_wire", JSON.stringify(r));
  r = pilotWire({ kind: "ball", type: "run", value: 1, striker: H1, bowler: W1, catchBy: "Qa-Canarytest", sub: "Thabo", extra: { tag: "Sipho" } }, roster);
  ok("keys outside the kind's list never travel, whatever they hold (S3)", r.ok && !("catchBy" in r.event) && !("sub" in r.event) && !("extra" in r.event), JSON.stringify(r));
  r = pilotWire({ kind: "ball", type: "run", value: 1, striker: H1, bowler: W1, shot: "Cover Drive by Sipho" }, roster);
  ok("a value not of its key's shape is left off", r.ok && !("shot" in r.event), JSON.stringify(r));
  r = pilotWire({ kind: "scorebook_note", text: "x" }, roster);
  ok("a kind a Pilot Match does not send stays on the phone", !r.ok && r.reason === "not_sendable", JSON.stringify(r));
  const lb = { slots: { ...roster.slots, "00000000-0000-4000-8000-300000000001": { side: "home", list_no: 9, name: "LB" } }, teams: roster.teams };
  r = pilotWire({ kind: "ball", type: "LB", value: 1, striker: H1, bowler: W1 }, lb);
  ok("a boy typed as \"LB\" does not hold back a leg-bye: LB there is a code (N2)", r.ok && r.event.type === "LB", JSON.stringify(r));
  r = pilotWire({ kind: "ball", type: "run", value: 1, striker: H1, bowler: W1, bowlerApproach: "Around the wicket" }, roster);
  ok("the approach travels as its code, and comes back as the words", r.ok && r.event.bowlerApproach === "around"
     && pilotUnwire(r.event, roster).bowlerApproach === "Around the wicket", JSON.stringify(r));
  ok("whole words: a team holding a typed name is seen, a team merely near one is not",
     holdsAName("Qa Canarytest XI", roster) && holdsAName("The canarytest's farm", { slots: { x: { side: "home", list_no: 1, name: "Canarytest" } }, teams: roster.teams }) === true
     && !holdsAName("Sipholand High", roster) && containsWord("Hilton U13B", "hilton") && !containsWord("Hiltonian", "Hilton"));
  r = pilotWire({ kind: "innings_start", battingTeam: "Some Other XI", squad: [H1] }, roster);
  ok("a team that is neither side keeps the event on the phone", !r.ok, JSON.stringify(r));
}

group("C. Deterministic, and the way back");
{
  const ev = { kind: "innings_start", battingTeam: "Walk Away U13B", bowlingTeam: "Walk Home U13B", squad: [id("away", 1), id("away", 9)],
               bowlingSquad: [{ id: id("home", 2), name: CANARY }], twelfthMan: "Jean-Luc", overs: 20, id: "d:p:2:1" };
  const a = pilotWire(ev, roster), b = pilotWire(structuredClone(ev), roster);
  ok("the same event, the same wire event", a.ok && JSON.stringify(a) === JSON.stringify(b));
  const back = a.ok ? pilotUnwire(a.event, roster) : null;
  ok("pilotUnwire puts the sides' names and the squads' names back", back?.battingTeam === "Walk Away U13B"
     && back?.squad?.[0]?.name === "Walk Away One" && back?.bowlingSquad?.[0]?.name === CANARY && back?.twelfthMan === "Jean-Luc", JSON.stringify(back));
  ok("...and a slot with no name reads as its position, which is not a name", back?.squad?.[1]?.name === positionWords("away", 9) && positionWords("away", 9) === "Away No. 9");
  const nameless = { slots: Object.fromEntries(Object.entries(roster.slots).map(([k, s]) => [k, { ...s, name: null }])), teams: roster.teams };
  ok("with the names gone (their date passed), every player reads as his position", pilotUnwire(a.ok ? a.event : {}, nameless).bowlingSquad?.[0]?.name === "Home No. 2");
}

group("D. Phase 1's locks, beside phase 2");
{
  const sync = readFileSync(join(import.meta.dirname, "../src/lib/sync.js"), "utf8");
  const persist = readFileSync(join(import.meta.dirname, "../src/lib/persist.js"), "utf8");
  ok("PadSync.open() still refuses a practice id first", /async open\(\) \{\n\s+if \(isPracticeId\(this\.matchId\)\) \{ this\.stopped = true; return null; \}/.test(sync));
  ok("PadSync.call() still refuses a practice id first", /async call\(path, opts = \{\}\) \{\n\s+if \(isPracticeId\(this\.matchId\)\) throw new Error\("practice_match_stays_on_this_phone"\);/.test(sync));
  ok("persist.js routes a practice id under practice:, a pilot id under pilot:, nothing else under either",
     /isPracticeId\(id\) \? `practice:log:\$\{id\}`/.test(persist) && /isPilotId\(id\) \? `pilot:log:\$\{id\}`/.test(persist));
  const persistMod = await import("../src/lib/persist.js");
  ok("isPilotId and isPracticeId never both say yes", persistMod.isPilotId("pilot-x") && !persistMod.isPracticeId("pilot-x")
     && persistMod.isPracticeId("practice-x") && !persistMod.isPilotId("practice-x") && !persistMod.isPilotId("77777777-0000-0000-0000-000000000002"));
}

group("E. One list, on the phone and in db/151");
{
  const sql = readFileSync(join(import.meta.dirname, "../../../db/151_pilot_match.sql"), "utf8");
  const body = (/** @type {string} */ fn) => sql.slice(sql.indexOf(`FUNCTION ${fn}(`), sql.indexOf("$$ LANGUAGE", sql.indexOf(`FUNCTION ${fn}(`)));
  /** Every `WHEN 'x' THEN ARRAY[...]` of a CASE, as {x: [...]}. @param {string} t */
  const cases = (t) => Object.fromEntries([...t.matchAll(/WHEN '([A-Za-z_]+)' THEN ARRAY\[([^\]]*)\]/g)]
    .map((m) => [m[1], [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1])]));
  const keys = cases(body("pilot_kind_keys"));
  const closed = cases(body("pilot_closed"));
  const same = (/** @type {any} */ a, /** @type {any} */ b) => JSON.stringify(Object.keys(a).sort().map((k) => [k, [...a[k]].sort()]))
    === JSON.stringify(Object.keys(b).sort().map((k) => [k, [...b[k]].sort()]));
  ok("KIND_KEYS is pilot_kind_keys(), kind for kind and key for key", Object.keys(keys).length === 13 && same(keys, KIND_KEYS),
     JSON.stringify(Object.keys(keys)));
  ok("CLOSED is pilot_closed(), key for key and code for code", Object.keys(closed).length >= 15 && same(closed, CLOSED),
     JSON.stringify(Object.keys(closed)));
}

group("F. Shapes the scoring package writes");
{
  const p = SLOTS[0], q = SLOTS[4];
  const nio = pilotWire({ kind: "ball", type: "run", value: 0, striker: p, bowler: q, notInOver: "fielder_returning" }, roster);
  ok("a delivery not in the over keeps its reason, a code of NOT_IN_OVER", nio.ok && nio.event.notInOver === "fielder_returning", JSON.stringify(nio));
  const odd = pilotWire({ kind: "ball", type: "run", value: 0, striker: p, bowler: q, notInOver: "made_up_reason" }, roster);
  ok("...and leaves off one that is not", odd.ok && !("notInOver" in odd.event), JSON.stringify(odd));
  const at = 1762858800000;
  const st = pilotWire({ kind: "play_stopped", reason: "rain", note: "Qa Canarytest hurt", at }, roster);
  ok("a stoppage keeps its time, ms since the epoch as events.mjs writes it, and never its note",
     st.ok && st.event.at === at && !("note" in st.event), JSON.stringify(st));
  ok("an event with no kind is not sent", pilotWire({ striker: p }, roster).ok === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
