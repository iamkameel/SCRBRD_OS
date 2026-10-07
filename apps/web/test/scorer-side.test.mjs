// The side the pad scores for a real fixture (scorer/side.js): the side the
// coach named when there is one, else what the end always had. No DOM, no
// network. Invented names only.
import { endOf, mayType, namedSide, offSide, OFF_SIDE_ASK, OFF_SIDE_MARK, OFF_SIDE_WHY, onlyNamedWords, rosterOf, sidesFor, sideWords, twelfthOf } from "../src/scorer/side.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };
const is = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const num = (i) => String(i).padStart(2, "0");

// The players read: thirteen U14A boys and two of another team.
const players = [
  ...Array.from({ length: 13 }, (_, i) => ({ id: `p${i + 1}`, full_name: `Verify Side ${num(i + 1)}`, team_code: "U14A", batting_style: i === 2 ? "Left-hand bat" : "Right-hand bat" })),
  { id: "q1", full_name: "Verify Other 01", team_code: "U16B", batting_style: "Right-hand bat" },
  { id: "q2", full_name: "Verify Other 02", team_code: "U16B", batting_style: null },
];
const row = (id, side, batting_no, extra = {}) => ({ match_id: "m1", player_id: id, side, batting_no, twelfth: false, full_name: players.find((p) => p.id === id)?.full_name ?? `Verify Away ${id}`, ...extra });
// The coach's sheet, as the read returns it but deliberately shuffled: eleven
// numbered with 1 and 11 swapped, a twelfth, and a withdrawn boy the read
// would not normally return at all (proved dropped anyway).
const sheet = [
  row("p5", "home", 5), row("p1", "home", 11), row("p11", "home", 1), row("p2", "home", 2), row("p3", "home", 3),
  row("p4", "home", 4), row("p6", "home", 6), row("p7", "home", 7), row("p8", "home", 8), row("p9", "home", 9), row("p10", "home", 10),
  row("p12", "home", null, { twelfth: true }),
  row("p13", "home", null, { withdrawn: true }),
];

console.log("A. The named side");
const named = namedSide(sheet, "home", new Map(players.map((p) => [p.id, p])));
ok("eleven, the twelfth and the withdrawn boy left out", named?.length === 11 && !named.some((m) => m.id === "p12" || m.id === "p13"), named);
ok("in batting order, 1 to 11", is(named?.map((m) => m.id), ["p11", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p1"]), named?.map((m) => m.id));
ok("each as the pad's squad member: id, name, batting hand", is(named?.[0], { id: "p11", name: "Verify Side 11", batHand: "R" }));
ok("...the left-hander's hand from the players read", named?.find((m) => m.id === "p3")?.batHand === "L");
ok("a boy the players read does not carry is right-handed, as the fold defaults", namedSide([row("x1", "home", 1)], "home")?.[0]?.batHand === "R");
ok("no rows for that end: no named side", namedSide(sheet, "away") === null && namedSide([], "home") === null && namedSide(null, "home") === null);
ok("only the twelfth man named: no named side", namedSide([row("p12", "home", null, { twelfth: true })], "home") === null);
const reserve = namedSide([row("p2", "home", null), row("p1", "home", 1)], "home");
ok("a boy named without a number comes after the numbered", is(reserve?.map((m) => m.id), ["p1", "p2"]));

console.log("\nB. The roster, as before");
const r = rosterOf(players, "U14A");
ok("the team's players, in the read's order", r?.team === true && is(r.squad.map((m) => m.id), players.slice(0, 13).map((p) => p.id)));
const all = rosterOf(players, "U19A");
ok("a team with nobody listed: every player the scorer may read", all?.team === false && all.squad.length === players.length);
ok("no players read: no roster", rosterOf(null, "U14A") === null);

console.log("\nC. Both ends");
const both = sidesFor({ players, squad: sheet, teamCode: "U14A" });
ok("home named: the named side, said so", both.home.source === "named" && both.home.squad?.length === 11 && both.home.squad[0].id === "p11");
ok("away with nothing named: nobody, typed as they come in (as before)", both.away.squad === null && both.away.source === null);
const none = sidesFor({ players, squad: [], teamCode: "U14A" });
ok("no side named: the U14A roster, exactly as the pad read it before", none.home.source === "roster" && is(none.home.squad, rosterOf(players, "U14A")?.squad));
const withdrawnOnly = sidesFor({ players, squad: [row("p13", "home", 1, { withdrawn: true })], teamCode: "U14A" });
ok("a sheet of withdrawn rows only is no named side", withdrawnOnly.home.source === "roster");
const unread = sidesFor({ players, squad: null, teamCode: "U14A" });
ok("the sheet could not be read: the roster, and said so", unread.home.source === "unread" && unread.home.squad?.length === 13);
const away = sidesFor({ players, squad: [...sheet, row("a1", "away", 2), row("a2", "away", 1)], teamCode: "U14A" });
ok("an away side named and readable: its own, in its order", away.away.source === "named" && is(away.away.squad?.map((m) => m.id), ["a2", "a1"]));
ok("...and the home side is unchanged by it", away.home.squad?.length === 11 && away.home.squad.every((m) => !m.id.startsWith("a")));
const awayOnly = sidesFor({ players, squad: [row("a1", "away", 1)], teamCode: "U14A" });
ok("only the away side named: the home end keeps its roster", awayOnly.home.source === "roster" && awayOnly.away.source === "named");
const offline = sidesFor({ players: null, squad: null, teamCode: "U14A" });
ok("nothing read: nothing, as before", offline.home.squad === null && offline.home.source === null && offline.away.squad === null);
const sheetOnly = sidesFor({ players: null, squad: sheet, teamCode: "U14A" });
ok("the sheet read without the roster: still the named side", sheetOnly.home.source === "named" && sheetOnly.home.squad?.length === 11);

console.log("\nD. The words");
ok("named", sideWords("named", "U14A") === "The side the coach named");
ok("roster", sideWords("roster", "U14A") === "The whole U14A roster: no side has been named");
ok("unread", sideWords("unread", "U14A") === "The whole U14A roster: the side the coach named could not be read");
ok("a roster that is the whole school says so", sideWords("roster", "U19A", false) === "Every player at the school: no side has been named");
ok("nothing from the server: nothing said", sideWords(null, "U14A") === null);

console.log("\nE. Who may be typed in (the unlisted player)");
ok("a named side: nobody typed in", mayType("named") === false);
ok("the roster, no side named: typed as before", mayType("roster") === true);
ok("the roster, the side unread: typed as before", mayType("unread") === true);
ok("nothing from the server (an away school, a practice match): typed as before", mayType(null) === true && mayType(undefined) === true);
ok("the pad's own decision, end to end: home named, away nothing",
   mayType(both.home.source) === false && mayType(both.away.source) === true);
ok("...no side named anywhere: both ends typed", mayType(none.home.source) && mayType(none.away.source));
ok("the batting side is the home end when the home key bats", endOf("batting", { battingKey: "U14A", homeKey: "U14A" }) === "home");
ok("...and the bowling side then the away end", endOf("bowling", { battingKey: "U14A", homeKey: "U14A" }) === "away");
ok("the away side batting: batting is away, bowling is home",
   endOf("batting", { battingKey: "Verify Away XI", homeKey: "U14A" }) === "away" && endOf("bowling", { battingKey: "Verify Away XI", homeKey: "U14A" }) === "home");
ok("a key missing: no end, so typed as before", endOf("batting", { battingKey: null, homeKey: "U14A" }) === null && mayType(null) === true);
ok("the line where the typed name was: bat", onlyNamedWords("bat") === "Only the side the coach named can bat. Ask the coach to change the side in Pick the side.");
ok("...and bowl", onlyNamedWords("bowl") === "Only the side the coach named can bowl. Ask the coach to change the side in Pick the side.");

console.log("\nF. The twelfth man, for the wicket sheet's substitute fielder");
ok("the named twelfth man", is(twelfthOf(sheet, "home"), { id: "p12", name: "Verify Side 12" }));
ok("none named at that end: null", twelfthOf(sheet, "away") === null && twelfthOf(null, "home") === null);
ok("a withdrawn twelfth man is not offered", twelfthOf([row("p12", "home", null, { twelfth: true, withdrawn: true })], "home") === null);
ok("sidesFor carries him with the named side", is(both.home.twelfth, { id: "p12", name: "Verify Side 12" }));
ok("...and an end with no named side carries none", (both.away.twelfth ?? null) === null && (none.home.twelfth ?? null) === null);

console.log("\nG. The deliberate way out, and who came through it");
ok("the ask", OFF_SIDE_ASK === "Not in the named side?");
ok("...why it is there, in one line", OFF_SIDE_WHY === "For a late change or a concussion replacement. The coach will need to fix this after the match.");
ok("...and the marker", OFF_SIDE_MARK === "typed in — not on the named side");
const isOff = offSide(named);
ok("a boy picked from the named side is not marked", isOff("p11") === false && isOff("p1") === false);
ok("a boy typed in (his name is his only id) is marked", isOff("Verify Late Change") === true);
ok("...even one typed with a named boy's name: a name is not an id", isOff("Verify Side 11") === true);
ok("nobody at all: nothing to mark", isOff(null) === false && isOff(undefined) === false);
ok("a squad of bare names (a demonstration team) reads the same way", offSide(["A Name", "B Name"])("A Name") === false && offSide(["A Name"])("C Name") === true);
ok("no squad: everyone typed is off it", offSide(null)("Verify Away 01") === true);

console.log(`\n${"─".repeat(52)}\nSCORER SIDE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
