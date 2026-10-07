// Pick the side's plain parts (lib/pickSide.js): the draft, the checks the route
// makes before it writes, the route's codes in words, and which boy a trigger's
// message is about. No DOM, no network. Invented names only.
import {
  AWAY_AVAILABILITY_WORDS, FIND_LIMIT, SIDE_SIZE, findOthers, boyNamed, candidates, checkDraft, draftFoot, draftFrom, drop, emptyDraft, freeNo, payload, pick, refusalWords, REFUSAL_WORDS, setNo, setTwelfth,
} from "../src/lib/pickSide.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };
const is = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ids = Array.from({ length: 13 }, (_, i) => `p${i + 1}`);

console.log("A. The draft");
let d = emptyDraft();
for (const id of ids.slice(0, 3)) d = pick(d, id);
ok("a boy picked takes the lowest free number", is(d.xi.map((x) => x.no), [1, 2, 3]), d);
d = drop(d, "p2");
d = pick(d, "p4");
ok("a number let go is the next one given", is(d.xi.map((x) => [x.id, x.no]), [["p1", 1], ["p3", 3], ["p4", 2]]), d);
ok("picking him twice changes nothing", pick(d, "p1") === d);
let full = emptyDraft();
for (const id of ids.slice(0, 11)) full = pick(full, id);
ok("eleven fill the XI, numbered 1 to 11", full.xi.length === SIDE_SIZE && freeNo(full) === null && is(full.xi.map((x) => x.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
ok("a twelfth boy is not taken into the XI", pick(full, "p12") === full);

console.log("\nB. The twelfth man");
let t = setTwelfth(full, "p12");
ok("he is named, and the XI is untouched", t.twelfth === "p12" && t.xi.length === 11);
t = setTwelfth(t, "p5");
ok("naming a boy from the XI takes him out of it, and the old twelfth is unnamed", t.twelfth === "p5" && t.xi.length === 10 && !t.xi.some((x) => x.id === "p5"), t);
t = pick(t, "p5");
ok("picking the twelfth for the XI frees the twelfth's place", t.twelfth === null && t.xi.some((x) => x.id === "p5"));
ok("naming the same twelfth again clears it", setTwelfth(setTwelfth(full, "p12"), "p12").twelfth === null);

console.log("\nC. What is sent");
const swapped = payload(setNo(setNo(full, "p1", 11), "p11", 1));
ok("in batting order", is(swapped.slice(0, 2), [{ playerId: "p11", battingNo: 1 }, { playerId: "p2", battingNo: 2 }]), swapped);
const withTwelfth = payload({ ...full, twelfth: "p12" });
ok("the twelfth is last and carries twelfth: true and no battingNo", is(withTwelfth.at(-1), { playerId: "p12", twelfth: true }) && withTwelfth.length === 12);
ok("a boy whose number was cleared is sent without one", is(payload(setNo(pick(emptyDraft(), "p1"), "p1", null)), [{ playerId: "p1" }]));

console.log("\nD. What is checked before anything is sent (the route's own codes)");
ok("an empty side is players_required", checkDraft(emptyDraft()).code === "players_required");
ok("a twelfth man alone is a side the route accepts", checkDraft(setTwelfth(emptyDraft(), "p1")).code === null);
ok("eleven different numbers pass", checkDraft(full).code === null);
const c = checkDraft(setNo(full, "p3", 1));
ok("two boys on one number is duplicate_batting_no, naming both boys", c.code === "duplicate_batting_no" && is(Object.keys(c.byBoy).sort(), ["p1", "p3"]), c);
ok("a number outside 1 to 11 is batting_no_must_be_1_to_11",
  checkDraft(setNo(full, "p3", 12)).code === "batting_no_must_be_1_to_11" && checkDraft(setNo(full, "p3", 0)).code === "batting_no_must_be_1_to_11" && checkDraft(setNo(full, "p3", 2.5)).code === "batting_no_must_be_1_to_11");
ok("reserves with no number never collide", checkDraft(setNo(setNo(full, "p1", null), "p2", null)).code === null);

console.log("\nE. The sheet that stands");
const squad = [
  { playerId: "p3", side: "home", battingNo: 2, twelfth: false, name: "B Dummy Three" },
  { playerId: "p1", side: "home", battingNo: 1, twelfth: false, name: "A Dummy One" },
  { playerId: "p9", side: "home", battingNo: null, twelfth: true, name: "I Dummy Nine" },
  { playerId: "p7", side: "away", battingNo: 1, twelfth: false, name: "Their Boy" },
];
const from = draftFrom(squad, "home");
ok("our end only, in batting order, the twelfth apart", is(from, { xi: [{ id: "p1", no: 1 }, { id: "p3", no: 2 }], twelfth: "p9" }), from);
ok("an end with no sheet is an empty draft", draftFrom(squad, "away").twelfth === null && draftFrom(null, "home").xi.length === 0);
ok("the foot says how many and who is twelfth", draftFoot(from, { p9: "I Dummy Nine" }) === "2 in the XI · twelfth man: I Dummy Nine" && draftFoot(emptyDraft(), {}) === "0 in the XI");

console.log("\nF. Who can be picked");
const players = [
  { id: "p3", name: "B Dummy Three", school: "S", team: "U14A" }, { id: "p1", name: "A Dummy One", school: "S", team: "U14A" },
  { id: "p2", name: "Z Other Team", school: "S", team: "1XI" }, { id: "p5", name: "Y Other School", school: "T", team: "U14A" },
];
const readiness = [
  { playerId: "p1", declaredStatus: "unavailable", clinicallyRestricted: false },
  { playerId: "p3", declaredStatus: "available", clinicallyRestricted: true, returnDate: "2026-10-20" },
];
const who = candidates(players, readiness, squad, { school: "S", teamCode: "U14A", end: "home", may: { status: true } });
ok("the team's boys, by name, and a boy picked from elsewhere stays", is(who.map((w) => w.id), ["p1", "p3", "p9"]), who);
ok("each with this fixture's word; restricted, and back, to a reader of the status tier",
  who[0].words === "unavailable" && who[1].words === "restricted" && who[1].back === "2026-10-20" && who[2].words === null, who);
const blind = candidates(players, readiness, squad, { school: "S", teamCode: "U14A", end: "home", may: { status: false } });
ok("a reader without the tier gets the family's word and no date", blind[1].words === "available" && blind[1].back === null, blind);
ok("with no readiness read there are no words, and still the boys", candidates(players, null, null, { school: "S", teamCode: "U14A", end: "home", may: { status: true } }).every((w) => w.words === null));

console.log("\nG. A refusal in the route's own words");
const boys = [{ id: "p1", name: "T Bekker" }, { id: "p2", name: "T Bekkers" }, { id: "p3", name: "B Khumalo" }];
const age = "B Khumalo is 14 on 1 January and cannot play U13A: the limit is 13";
ok("the age trigger names him", boyNamed(age, boys) === "p3");
ok("the registration trigger names him", boyNamed("cannot select B Khumalo: not registered to play (unlinked). A minor needs a verified guardian link and consent before he is selected", boys) === "p3");
ok("the dob trigger names him", boyNamed("cannot select B Khumalo for a U13A match: no date of birth on record, so eligibility cannot be checked", boys) === "p3");
ok("the longest name wins", boyNamed("T Bekkers is 15 on 1 January", boys) === "p2");
ok("a message that names nobody names nobody", boyNamed("cannot check eligibility for a U17 fixture: bands above U16 are representative cricket", boys) === null);
const r = refusalWords({ status: 400, code: "not_eligible", detail: age }, boys);
ok("the trigger's words are kept whole, beside the boy, and say nothing was saved", r.boyId === "p3" && r.words === `${age}. Nothing was saved.`, r);
ok("a sentence that starts lower case is capitalised", refusalWords({ status: 400, code: "not_eligible", detail: "cannot select B Khumalo: not registered" }, boys).words.startsWith("Cannot select B Khumalo"));
for (const code of ["side_must_be_home_or_away", "players_required", "duplicate_player", "batting_no_must_be_1_to_11", "duplicate_batting_no", "twelfth_man_has_no_batting_no", "not_permitted"]) {
  const w = refusalWords({ status: code === "not_permitted" ? 403 : 400, code }, boys);
  ok(`${code} is a sentence, not the code`, w.words === REFUSAL_WORDS[code] && !w.words.includes("_") && /\.$/.test(w.words) && w.boyId === null, w);
}
ok("the race between two coaches (409) is the duplicate-number sentence", refusalWords({ status: 409, code: "duplicate_batting_no" }, boys).words === REFUSAL_WORDS.duplicate_batting_no);
ok("an unnamed code says what the server said", /The server said teapot/.test(refusalWords({ status: 418, code: "teapot" }, boys).words));
ok("no answer is not 'nothing was saved'", !/Nothing was saved/.test(refusalWords(null, boys).words) && /may not have been saved/.test(refusalWords(null, boys).words));

console.log("\nH. Playing a boy up");
const school = [
  { id: "a1", name: "A Dummy One", school: "S", team: "U14A" },
  { id: "y1", name: "Young Dummy One", school: "S", team: "U13A" },
  { id: "y2", name: "Young Dummy Two", school: "S", team: "U13B" },
  { id: "e1", name: "Elder Dummy", school: "S", team: "1XI" },
  { id: "n1", name: "Young Nameless", school: "S", team: null },
  { id: "x1", name: "Young Stranger", school: "T", team: "U13A" },
];
const find = (query, have = ["a1"]) => findOthers(school, query, { school: "S", teamCode: "U14A", have });
ok("nothing is offered until something is typed", find("").rows.length === 0 && find("   ").rows.length === 0);
ok("a typed name finds the school's boys on other teams, by team then name", is(find("young").rows.map((r) => r.id), ["y1", "y2", "n1"]), find("young"));
ok("another school's boy is never offered", !find("young").rows.some((r) => r.id === "x1") && !find("stranger").rows.length, find("stranger"));
ok("the fixture team's own boys are not offered (they are already listed)", !find("dummy one").rows.some((r) => r.id === "a1"));
ok("every word typed must be in the name, in any case", is(find("DUMMY two").rows.map((r) => r.id), ["y2"]) && find("dummy zzz").rows.length === 0);
ok("a boy already in the list is not offered again", !find("young", ["a1", "y1"]).rows.some((r) => r.id === "y1"));
ok("a boy with no team is offered, with no team named", find("nameless").rows[0]?.team === null);
ok("no school or no fixture team offers nobody", findOthers(school, "young", { school: null, teamCode: "U14A", have: [] }).rows.length === 0 && findOthers(school, "young", { school: "S", teamCode: null, have: [] }).rows.length === 0);
const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `Many Dummy ${String(i).padStart(2, "0")}`, school: "S", team: "U13A" }));
const lim = findOthers(many, "many", { school: "S", teamCode: "U14A", have: [] });
ok("the finder lists at most FIND_LIMIT and says how many it left out", lim.rows.length === FIND_LIMIT && lim.more === 12 - FIND_LIMIT, lim);
const up = candidates(school, null, null, { school: "S", teamCode: "U14A", end: "home", may: { status: true }, added: ["y1", "x1", "ghost"] });
ok("an added boy joins the list marked with his own team; the team's own boys carry none", is(up.map((u) => [u.id, u.from]), [["a1", null], ["y1", "U13A"]]), up);
ok("an added boy from another school, or unknown, is dropped", !up.some((u) => u.id === "x1" || u.id === "ghost"));
ok("a boy on the sheet from another team is marked too, and his name stays", is(candidates(school, null, [{ playerId: "e1", side: "home", name: "Elder Dummy" }], { school: "S", teamCode: "U14A", end: "home", may: { status: true } }).find((u) => u.id === "e1")?.from, "1XI"));
ok("a sheet boy the roster read does not know is kept, with no team", is(candidates(school, null, [{ playerId: "zz", side: "home", name: "Z Unknown" }], { school: "S", teamCode: "U14A", end: "home", may: { status: true } }).find((u) => u.id === "zz")?.from, null));
ok("the refusal for an added boy is found by his name, in the list the screen uses", boyNamed("Young Dummy One is 14 on 1 January and cannot play U13A: the limit is 13", up) === "y1");
ok("the away side's line is said plainly", AWAY_AVAILABILITY_WORDS === "Availability shows for the home side only for now.");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
