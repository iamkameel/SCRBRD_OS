/**
 * Practice Match, phase 1 (lib/practice.js and the locks around it).
 *
 * A match a scorer starts from the field with typed teams and pasted names,
 * scored on the real pad and kept on the phone. Its players are children, so
 * the suite holds the promises that matter more than the arithmetic:
 *
 *   A  reading a pasted list: blank lines, numbering, commas, trailing spaces,
 *      repeats, more than fifteen;
 *   B  the squad limits (2 and 15), the twelfth man, the XI and the reserves;
 *   C  the team's display name ("Hilton U15A");
 *   D  the config the scorer's startMatch(cfg) takes, and the record kept
 *      beside the log in the shapes phase 2 maps from;
 *   E  PERSISTENCE: score balls, reload, and the score, wickets, overs, the
 *      batters, the bowler and the undo all come back as they were;
 *   F  SANDBOX: nothing of a practice match reaches the sync path, none of it
 *      is stored where a normal match is, and no module outside the scorer
 *      can read it;
 *   G  DELETE: one match, and all of them, leave nothing — names, teams,
 *      weather, balls, the draft — and leave everything else alone;
 *   H  the weather record is the scorer's own and the hint is null;
 *   I  the scorecard file, with the names the scorer chose to export.
 *
 * Names here are made up. The browser walk (tools/smoke-browser-practice.mjs)
 * drives the real pad, offline, and the network.
 *
 *   node apps/web/test/practice.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// A localStorage that survives a "reload" the way the real one does: strings
// in, strings out, enumerable keys. persist.js falls back to it in node (no
// IndexedDB), so what is saved here is serialised exactly as on a phone.
const disk = new Map();
const ls = {};
for (const [k, f] of Object.entries({
  getItem: (key) => (disk.has(key) ? disk.get(key) : null),
  setItem: (key, v) => { disk.set(key, String(v)); ls[key] = String(v); },
  removeItem: (key) => { disk.delete(key); delete ls[key]; },
})) Object.defineProperty(ls, k, { value: f, enumerable: false });
globalThis.localStorage = ls;

const fetched = [];
globalThis.fetch = async (...a) => { fetched.push(String(a[0])); throw new Error("no network in this suite"); };

const P = await import("../src/lib/practice.js");
const store = await import("../src/lib/persist.js");
const { PadSync } = await import("../src/lib/sync.js");
const { getWeatherHint } = await import("../src/lib/weatherHint.js");
const { scorecardText, scorecardFileName } = await import("../src/lib/practiceExport.js");
const {
  inningsStart, batters, bowler, ball, deriveInnings, newEventId, LOCAL_ONLY,
} = await import("@scrbrd/scoring");
const { undoOnPad } = await import("@scrbrd/sync");
const { deliveryEvents, crease, deliveryOf } = await import("../src/scorer/delivery.js");
const { foldPad } = await import("../src/scorer/penalty.js");

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── A ────────────────────────────────────────────────────────────────
group("A. Reading a pasted list");
{
  const paste = [
    "1. Alpha One", "", "2) Bravo Two,   ", "  3 - Charlie Three  ", "", "",
    "• Delta Four", "#5 Echo Five", "6 Foxtrot Six", "Golf Seven, Hotel Eight; India Nine",
    "​Juliet Ten​", "11.Kilo Eleven", "   ", ",", "Lima  Twelve",
  ].join("\n");
  const r = P.parseSquadText(paste);
  ok("numbers, brackets, dashes, hashes, bullets and bare numbers are stripped",
    same(r.names.slice(0, 7), ["Alpha One", "Bravo Two", "Charlie Three", "Delta Four", "Echo Five", "Foxtrot Six", "Golf Seven"]), r.names.join("|"));
  ok("commas and semicolons separate names on one line", r.names.includes("Hotel Eight") && r.names.includes("India Nine"));
  ok("invisible characters are dropped", r.names.includes("Juliet Ten"));
  ok("\"11.Kilo Eleven\" (no space) is read", r.names.includes("Kilo Eleven"));
  ok("inner runs of spaces become one", r.names.includes("Lima Twelve"));
  ok("blank lines, lone commas and spaces make no names", r.count === 12 && r.names.every((n) => n.length > 0), r.count);
  ok("trailing spaces and commas are trimmed", r.names.every((n) => n === n.trim() && !/[,;]$/.test(n)));
  ok("nothing is lost: twelve in, twelve out, none flagged", r.duplicates.length === 0 && r.over === 0);

  const d = P.parseSquadText("Alpha One\n2. alpha  one\nBravo Two\nBravo Two\nCharlie Three");
  ok("a name twice is flagged, case and spacing ignored", same(d.duplicates, ["Alpha One", "Bravo Two"]), d.duplicates.join("|"));
  ok("...and every one of them is still in the list for the screen to show", d.count === 5);

  const long = P.parseSquadText(Array.from({ length: 17 }, (_, i) => `${i + 1}. Player ${String.fromCharCode(65 + i)}`).join("\n"));
  ok("seventeen names: all read, two over the limit", long.count === 17 && long.over === 2);
  ok("an empty paste is no names", P.parseSquadText("").count === 0 && P.parseSquadText(undefined).count === 0 && P.parseSquadText("\n\n  \n").count === 0);
  ok("a name is never longer than 60 characters", P.parseSquadText("x".repeat(200)).names[0].length === 60);
  ok("cleanName on its own", P.cleanName("  12) Mike Yankee , ") === "Mike Yankee" && P.cleanName("") === "");
}

// ── B ────────────────────────────────────────────────────────────────
group("B. Squad limits, the twelfth man, the XI");
{
  const mk = (n) => P.addNames([], Array.from({ length: n }, (_, i) => `Player ${i + 1}`));
  ok("one name is too few", !P.validateSquad(mk(1)).ok && P.validateSquad(mk(1)).problems[0].code === "too_few");
  ok("none is too few", !P.validateSquad(mk(0)).ok);
  ok("two names is the smallest side that can play", P.validateSquad(mk(2)).ok);
  ok("fifteen names is the largest", P.validateSquad(mk(15)).ok);
  const sixteen = P.validateSquad(mk(16));
  ok("sixteen is refused, in words", !sixteen.ok && sixteen.problems[0].code === "too_many" && /take 1 name off/.test(sixteen.problems[0].text), sixteen.problems[0]?.text);
  const dup = P.validateSquad(P.addNames(mk(3), ["player 2"]));
  ok("a repeat is refused and named", !dup.ok && dup.problems.some((p) => p.code === "duplicate" && /Player 2/.test(p.text)), JSON.stringify(dup.problems));
  ok("...the screen can ask which rows", P.isRepeated(dup, "PLAYER  2") && !P.isRepeated(dup, "Player 1"));
  ok("...and remove the repeats, keeping the first", same(P.withoutDuplicates(P.addNames(mk(3), ["player 2"])).map((p) => p.name), ["Player 1", "Player 2", "Player 3"]));

  let sq = mk(15);
  const lu = P.lineUp(sq);
  ok("fifteen: eleven play, four wait", lu.xi.length === 11 && lu.reserves.length === 4 && lu.twelfth === null);
  sq = P.toggleTwelfth(sq, 4);
  const lu2 = P.lineUp(sq);
  ok("the twelfth man is not in the XI, the next name comes up", lu2.twelfth === "Player 5" && !lu2.xi.includes("Player 5") && lu2.xi.length === 11 && lu2.xi[4] === "Player 6");
  ok("...there are three reserves left", lu2.reserves.length === 3);
  sq = P.toggleTwelfth(sq, 7);
  ok("only one man is the twelfth", sq.filter((p) => p.twelfth).length === 1 && P.lineUp(sq).twelfth === "Player 8");
  ok("...tapping him again clears it", P.lineUp(P.toggleTwelfth(sq, 7)).twelfth === null);
  const moved = P.moveAt(mk(4), 3, -1);
  ok("moving up reorders the batting order", same(moved.map((p) => p.name), ["Player 1", "Player 2", "Player 4", "Player 3"]));
  ok("moving off the top or bottom does nothing", same(P.moveAt(mk(3), 0, -1), mk(3)) && same(P.moveAt(mk(3), 2, 1), mk(3)));
  ok("removing takes one off", P.removeAt(mk(3), 1).length === 2);
  ok("two sides sharing a name are told apart", same(P.sharedNames(mk(3), P.addNames([], ["Other", "player 3"])), ["player 3"]));
  ok("a two-name side is a pair: both play", same(P.lineUp(mk(2)).xi, ["Player 1", "Player 2"]));
}

// ── C ────────────────────────────────────────────────────────────────
group("C. The team's display name");
{
  const n = (school, division, cls) => P.practiceTeamName({ school, division, cls });
  ok("school + division + class: \"Hilton U15A\"", n("Hilton", "U15", "A") === "Hilton U15A");
  ok("another", n("Michaelhouse", "U13", "B") === "Michaelhouse U13B");
  ok("a longer class takes a space", n("Kearsney", "U14", "1st XI") === "Kearsney U14 1st XI");
  ok("Open takes a space", n("Hilton", "Open", "A") === "Hilton Open A");
  ok("extra spaces in the school are tidied", n("  Hilton   College ", "U15", "A") === "Hilton College U15A");
  ok("a side with no class is the division", n("Hilton", "U15", "") === "Hilton U15");
  ok("the divisions run U11 to Open", P.DIVISIONS[0] === "U11" && P.DIVISIONS.at(-1) === "Open" && P.DIVISIONS.includes("U15"), P.DIVISIONS.join(","));
  ok("an incomplete team says what is missing", P.teamProblems({ school: "", division: "", cls: "" }).length === 3 && P.teamProblems({ school: "Hilton", division: "U15", cls: "A" }).length === 0);
  ok("two teams with one name are the same team", P.sameTeam({ school: "Hilton", division: "U15", cls: "A" }, { school: " hilton ", division: "U15", cls: "A" }));
  ok("overs: 1 to 50, whole", P.oversOf(20) === 20 && P.oversOf("35") === 35 && P.oversOf("0") === null && P.oversOf("51") === null && P.oversOf("x") === null && P.oversOf("2.5") === null);
  ok("the presets are 20, 30, 40 and 50", same(P.OVERS_PRESETS, [20, 30, 40, 50]));
}

// ── D ────────────────────────────────────────────────────────────────
group("D. startMatch(cfg), and the record");
const draft = (() => {
  const d = P.blankDraft();
  d.teams = [{ school: "Hilton", division: "U15", cls: "A" }, { school: "Kearsney", division: "U15", cls: "A" }];
  d.squads = [
    P.addNames([], ["Alpha One", "Alpha Two", "Alpha Three", "Alpha Four", "Alpha Five", "Alpha Six", "Alpha Seven", "Alpha Eight", "Alpha Nine", "Alpha Ten", "Alpha Eleven", "Alpha Twelve", "Alpha Thirteen"]),
    P.addNames([], ["Bravo One", "Bravo Two", "Bravo Three", "Bravo Four"]),
  ];
  d.squads[0] = P.toggleTwelfth(d.squads[0], 11);
  d.overs = 30; d.toss = 1; d.bat = 1;   // team 2 won the toss and chose to bowl: team 1 bats
  d.venue = { name: "Main Oval", lat: -29.54012, lon: 30.28765, accuracy_m: 12 };
  d.weather = { condition: "overcast", playable: true };
  return d;
})();
const cfg = P.practiceCfg(draft, { id: "practice-x1", opener1: "Alpha One", opener2: "Alpha Two", openBowler: "Bravo One" });
{
  ok("the cfg names the sides as typed", cfg.team1 === "Hilton U15A" && cfg.team2 === "Kearsney U15A");
  ok("team 2 chose to bowl, so team 1 bats first: teamKey1 is Hilton", cfg.teamKey1 === "Hilton U15A" && cfg.teamKey2 === "Kearsney U15A");
  ok("the squads are plain names, the XI only", same(cfg.squad1, draft.squads[0].filter((p) => !p.twelfth).slice(0, 11).map((p) => p.name)) && cfg.squad1.length === 11 && cfg.squad2.length === 4);
  ok("the twelfth man travels as the twelfth, not in the squad", cfg.twelfth1 === "Alpha Twelve" && !cfg.squad1.includes("Alpha Twelve") && cfg.twelfth2 === null);
  ok("the reserve (Alpha Thirteen) is in neither", !cfg.squad1.includes("Alpha Thirteen"));
  ok("overs, toss, the openers and the bowler go through", cfg.overs === 30 && cfg.toss === 1 && cfg.bat === 1 && cfg.opener1 === "Alpha One" && cfg.openBowler === "Bravo One");
  ok("it is marked a practice match and has a practice id", cfg.practice === true && store.isPracticeId(cfg.matchId));
  const flipped = P.practiceCfg({ ...draft, toss: 1, bat: 0 }, { id: "practice-x2", opener1: "Bravo One", opener2: "Bravo Two", openBowler: "Alpha One" });
  ok("if team 2 bats first the keys and squads swap", flipped.teamKey1 === "Kearsney U15A" && same(flipped.squad1, draft.squads[1].map((p) => p.name)));

  // startMatch (scorer/engine.jsx:829-862), line for line, on this cfg: the
  // browser walk runs the real one. INT_TEAMS has no "Hilton U15A", so the
  // bowling lists fall back to the squads the cfg carries (lines 833-834).
  const INT_TEAMS = {};
  const sq1 = cfg.squad1 || [], sq2 = cfg.squad2 || [];
  const tk1 = cfg.teamKey1 || cfg.team1, tk2 = cfg.teamKey2 || cfg.team2;
  const bsq1 = INT_TEAMS[tk2]?.players.map((p) => p.name) || sq2;
  const bsq2 = INT_TEAMS[tk1]?.players.map((p) => p.name) || sq1;
  const open1 = [inningsStart({ innings: 0, battingTeam: tk1, bowlingTeam: tk2, squad: sq1, bowlingSquad: bsq1, twelfthMan: cfg.twelfth1 || null, teamKey: tk1, bowlingTeamKey: tk2, overs: cfg.overs || 20, captureProfile: cfg.captureProfile ?? undefined })];
  const open2 = [inningsStart({ innings: 1, battingTeam: tk2, bowlingTeam: tk1, squad: sq2, bowlingSquad: bsq2, twelfthMan: cfg.twelfth2 || null, teamKey: tk2, bowlingTeamKey: tk1, overs: cfg.overs || 20, captureProfile: cfg.captureProfile ?? undefined })];
  open1.push(batters({ innings: 0, striker: cfg.opener1, nonStriker: cfg.opener2 }));
  open1.push(bowler({ innings: 0, bowler: cfg.openBowler }));
  const [i1, i2] = foldPad([open1, open2], {});
  ok("the first innings: Hilton bat, Kearsney bowl, 30 overs", i1.battingTeam === "Hilton U15A" && i1.bowlingTeam === "Kearsney U15A" && i1.overs === 30);
  ok("...the batters are the openers and Bravo One has the ball", i1.striker === "Alpha One" && i1.nonStriker === "Alpha Two" && i1.bowler === "Bravo One");
  ok("...the second innings knows both squads already", i2.battingTeam === "Kearsney U15A" && i2.squad.length === 4 && i2.bowlingSquad.length === 11);
  ok("...a four-name side is all out at three wickets", i2.squad.length - 1 === 3);

  const rec = P.practiceRecord(draft, "practice-x1", 1760000000000);
  ok("the record: a match, two teams with display names", rec.match.practice === true && rec.match.overs === 30 && rec.teams.length === 2 && rec.teams[0].display_name === "Hilton U15A" && rec.teams[0].side === "home" && rec.teams[0].age_division === "U15" && rec.teams[0].team_class === "A");
  ok("...players have full_name, and no other personal field", rec.players.length === 17 && rec.players.every((p) => Object.keys(p).sort().join() === "full_name,id,side"));
  const home = rec.match_squad.filter((m) => m.side === "home");
  ok("...match_squad: side, batting_no 1..11, one twelfth, reserves null", home.length === 13 && home.filter((m) => m.twelfth).length === 1 && home.filter((m) => m.batting_no != null).length === 11 && Math.max(...home.map((m) => m.batting_no ?? 0)) === 11 && home.find((m) => m.player_id.endsWith(":13")).batting_no === null);
  ok("...the venue and the toss", rec.match.venue.name === "Main Oval" && rec.match.venue.lat === -29.54012 && rec.match.toss.won_by === "away" && rec.match.toss.decision === "bowl");
  ok("...the weather is match_weather's shape", same(Object.keys(rec.match_weather).sort(), ["condition", "forecast", "humidity_pct", "observed_at", "playable", "rain_chance_pct", "temp_c", "wind_dir", "wind_kph"]) && rec.match_weather.condition === "overcast" && rec.match_weather.forecast === null);
  ok("...it is in progress, with no weather changes yet", rec.status === "in_progress" && rec.weather_changes.length === 0);
}

// ── E ────────────────────────────────────────────────────────────────
group("E. Score some balls, reload: everything comes back");
const ID = "practice-e1";
const mint = () => newEventId("dev", "local");
/** The pad's `emit` for one innings: the id stamped on, appended. */
const stamp = (evs, at) => evs.map((e) => ({ ...e, innings: at, id: e.id ?? mint() }));
const pad = (() => {
  const log = [[], []];
  const emit = (...evs) => { log[0].push(...stamp(evs, 0)); };
  emit(inningsStart({ innings: 0, battingTeam: cfg.teamKey1, bowlingTeam: cfg.teamKey2, squad: cfg.squad1, bowlingSquad: cfg.squad2, twelfthMan: cfg.twelfth1, teamKey: cfg.teamKey1, bowlingTeamKey: cfg.teamKey2, overs: cfg.overs }));
  emit(batters({ innings: 0, striker: "Alpha One", nonStriker: "Alpha Two" }), bowler({ innings: 0, bowler: "Bravo One" }));
  log[1].push(...stamp([inningsStart({ innings: 1, battingTeam: cfg.teamKey2, bowlingTeam: cfg.teamKey1, squad: cfg.squad2, bowlingSquad: cfg.squad1, twelfthMan: null, teamKey: cfg.teamKey2, bowlingTeamKey: cfg.teamKey1, overs: cfg.overs })], 1));
  const run = (value) => { const before = deriveInnings(log[0]); emit(...deliveryEvents({ curIn: 0, before, freeHit: before.freeHit, type: "run", value, shot: null, seg: null, zone: null, approach: null })); };
  const wide = () => { const before = deriveInnings(log[0]); emit(...deliveryEvents({ curIn: 0, before, freeHit: false, type: "Wd", value: 0, shot: null, seg: null, zone: null, approach: null })); };
  const wicket = () => { const before = deriveInnings(log[0]); emit(ball({ ...deliveryOf({ type: "W", value: 0, crease: crease(before) }), dismissal: "bowled" }), batters({ innings: 0, striker: "Alpha Three" })); };
  return { log, emit, run, wide, wicket };
})();
let before, after;
{
  [1, 0, 4, 2, 0].forEach(pad.run);
  pad.wide();
  pad.run(6);                            // over 1: 13 off 6 legal balls + a wide
  pad.emit(bowler({ innings: 0, bowler: "Bravo Two" }));
  pad.run(1); pad.wicket(); pad.run(3);  // a wicket; Alpha Three in
  before = deriveInnings(pad.log[0]);
  ok("the pad scored: 3 balls into the second over, a wicket, a wide", before.balls === 9 && before.wickets === 1 && before.runs === 1 + 0 + 4 + 2 + 0 + 1 + 6 + 1 + 3 && before.extras.wide === 1, `${before.runs}/${before.wickets} ${before.balls}`);

  await store.saveMatch(ID, { events: pad.log, curIn: 0, cfg });
  ok("the log is saved under the practice namespace, and nowhere else", (await store.recordKeys("practice:log:")).length === 1 && (await store.recordKeys("match:")).length === 0);

  // ── the reload: nothing from `pad` is used again; the screen is rebuilt from the disk
  const saved = await store.loadMatch(ID);
  after = deriveInnings(saved.events[0]);
  ok("the log came back, whole", saved.events[0].length === pad.log[0].length && saved.events[1].length === 1 && saved.curIn === 0);
  ok("the score", after.runs === before.runs);
  ok("the wickets", after.wickets === before.wickets && after.wickets === 1);
  ok("the overs", after.balls === before.balls && Math.floor(after.balls / 6) === 1);
  ok("the batters at the crease", after.striker === before.striker && after.nonStriker === before.nonStriker && after.striker && after.nonStriker);
  ok("each batter's line", same(after.batsmen.map((b) => [b.name, b.runs, b.balls, b.status]), before.batsmen.map((b) => [b.name, b.runs, b.balls, b.status])));
  ok("the bowler", after.bowler === "Bravo Two" && same(after.bowlers.map((b) => [b.name, b.runs, b.balls, b.wickets]), before.bowlers.map((b) => [b.name, b.runs, b.balls, b.wickets])));
  ok("the whole fold is the same", same(JSON.stringify(foldPad(saved.events, {})), JSON.stringify(foldPad(pad.log, {}))));
  ok("the cfg came back with it", saved.cfg.practice === true && saved.cfg.team1 === "Hilton U15A");
  ok("saved with a time", typeof saved.savedAt === "number");

  // Undo after the reload takes back exactly what undo takes back before it.
  const undoNow = undoOnPad(pad.log, 0, LOCAL_ONLY, mint);
  const undoThen = undoOnPad(saved.events, 0, LOCAL_ONLY, mint);
  ok("undo is the same after a reload: the same event, cut out of the log", undoNow.action === "truncate" && undoThen.action === "truncate" && undoNow.target.id === undoThen.target.id);
  const a = deriveInnings(undoNow.log[0]), b = deriveInnings(undoThen.log[0]);
  ok("...the same score after it (3 runs off)", a.runs === b.runs && b.runs === before.runs - 3 && a.balls === b.balls && b.balls === before.balls - 1);
  let log = saved.events, undone = 0;
  for (let i = 0; i < 40; i++) { const r = undoOnPad(log, 0, LOCAL_ONLY, mint); if (r.action === "none") break; log = r.log; undone++; }
  ok("...and undo walks all the way back to the start of the innings and no further", deriveInnings(log[0]).runs === 0 && log[0][0].kind === "innings_start" && undone >= 10, `${undone} undone, ${log[0].length} left`);
  const orphan = await P.listPractice();
  ok("a log whose record never got written is still listed, so it can be deleted", orphan.length === 1 && orphan[0].meta === null && orphan[0].id === ID);
}
{
  // The list reads the record and the log.
  await P.savePractice(P.practiceRecord(draft, ID));
  const rows = await P.listPractice();
  ok("the list shows the match with its title and both innings so far", rows.length === 1 && rows[0].title === "Hilton U15A v Kearsney U15A" && rows[0].lines[0].runs === before.runs && rows[0].lines[0].wickets === 1 && rows[0].lines[0].balls === 9);
  ok("...in progress, with the time it was last saved", rows[0].complete === false && typeof rows[0].savedAt === "number");
  ok("...and it is the one offered for Resume", (await P.inProgressPractice())?.id === ID);
  ok("the record is a single-key update", (await P.updatePractice(ID, { status: "complete" })).status === "complete");
}

// ── F ────────────────────────────────────────────────────────────────
group("F. The sandbox: nothing reaches sync, nothing shows in a normal list");
{
  const keys = [...disk.keys()];
  ok("every key a practice match wrote starts \"scrbrd:practice:\" (persist.js's prefix, then ours)", keys.length > 0 && keys.every((k) => k.startsWith("scrbrd:practice:")), keys.join(","));
  ok("none is a `match:` key, a session, or a preference", !keys.some((k) => /^scrbrd:(match:|session|pref:|aside:)/.test(k)));
  ok("persist.js says a practice id is a practice id, and a fixture's is not", store.isPracticeId("practice-abc") && !store.isPracticeId("77777777-0000-0000-0000-000000000002") && !store.isPracticeId("local-abc") && !store.isPracticeId(null));

  const hooks = { padLog: () => [[], []], adopt: () => false, restore() {}, followToss() {}, onStatus() {} };
  const ps = new PadSync({ matchId: ID, userId: "u1", intent: "open", hooks });
  let engine = "not asked", opening = null;
  try { engine = await ps.open(); } catch (e) { opening = e; }
  ok("the pad's sync will not open an outbox for a practice match", opening === null && engine === null && ps.engine === null && ps.stopped === true,
    opening ? `it tried to open an outbox on disk: ${opening.message}` : "");
  ps.attach("open");
  let refused = null;
  try { await ps.call(`/api/matches/${ID}/events`, { method: "POST", body: { events: [{ id: "x" }] } }); } catch (e) { refused = e; }
  ok("...and its one door to the server refuses a practice match's request", refused?.message === "practice_match_stays_on_this_phone", refused?.message);
  ps.stop();
  ok("...no request was made, by any of it", fetched.length === 0, fetched.join(","));

  // The real thing the walk proves with a browser: a normal match's id is let through to the door.
  const live = new PadSync({ matchId: "77777777-0000-0000-0000-000000000002", userId: "u1", intent: "open", hooks });
  let liveErr = null;
  try { await live.call("/api/health"); } catch (e) { liveErr = e; }
  ok("...while a fixture's id still reaches it (the lock is not a wall around everything)", liveErr?.message !== "practice_match_stays_on_this_phone" && fetched.length >= 1, liveErr?.message);
  live.stop();

  // Who may read the store: only the scorer. No Match Centre, stats, table or shell module imports it.
  const readers = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name) && /from\s+["'][^"']*\/lib\/practice(Export)?\.js["']|from\s+["']\.\/practice(Export)?\.js["']/.test(readFileSync(p, "utf8"))) readers.push(p.replace(/\\/g, "/"));
  } };
  walk("apps/web/src");
  ok("only the scorer's own modules import the practice store", readers.length > 0 && readers.every((r) => /\/scorer\//.test(r) || /\/lib\/practice(Export)?\.js$/.test(r)), readers.join(", "));
  const persistReaders = [];
  const walk2 = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk2(p);
    else if (/\.(jsx?|mjs)$/.test(e.name) && /\b(recordKeys|putRecord|getRecord|deleteRecord)\b/.test(readFileSync(p, "utf8"))) persistReaders.push(p.replace(/\\/g, "/"));
  } };
  walk2("apps/web/src");
  ok("...and the generic record door is used by persist.js and the practice store alone", persistReaders.every((r) => /lib\/(persist|practice)\.js$/.test(r)), persistReaders.join(", "));
  ok("no module that lists fixtures, stats or tables mentions a practice match",
    !["lib/matchCentre.js", "lib/league.js", "lib/standings.js", "lib/live.js", "lib/seasonAwards.js", "lib/people.js", "views/MatchCentreView.jsx"]
      .some((f) => /practice/i.test(readFileSync(join("apps/web/src", f), "utf8"))));
}

// ── G ────────────────────────────────────────────────────────────────
group("G. Delete one, delete all: nothing left behind");
{
  // Three matches, a draft, the other things a phone holds.
  for (const id of ["practice-g1", "practice-g2"]) {
    await store.saveMatch(id, { events: pad.log, curIn: 0, cfg: { ...cfg, matchId: id } });
    await P.savePractice(P.practiceRecord(draft, id));
  }
  await P.saveDraft(draft);
  await store.saveMatch("77777777-0000-0000-0000-000000000009", { events: [[], []], curIn: 0, cfg: {} });
  await store.saveSession({ role: "scorer" });
  await store.setPref("analytics", false);
  const everyKey = async () => [...disk.keys()];
  const mine = (ks) => ks.filter((k) => /practice/.test(k));
  ok("before: three matches and a draft are kept", (await P.listPractice()).length === 3 && mine(await everyKey()).length >= 7);

  ok("deleting one says nothing is left of it", (await P.deletePractice("practice-g1")) === true);
  ok("...its record and its balls are gone, the others are not", !(await everyKey()).some((k) => k.includes("practice-g1")) && (await P.listPractice()).length === 2);
  ok("...a fixture's id cannot be deleted through it", (await P.deletePractice("77777777-0000-0000-0000-000000000009")) === false && (await store.loadMatch("77777777-0000-0000-0000-000000000009")) != null);

  const r = await P.deleteAllPractice();
  ok("delete-all removes every key and leaves none", r.removed >= 5 && r.left === 0, JSON.stringify(r));
  const rest = await everyKey();
  ok("...no key anywhere says \"practice\" any more", mine(rest).length === 0, mine(rest).join(","));
  ok("...no name, team or weather is in anything that is left", !rest.some((k) => /Alpha|Bravo|Hilton|Kearsney|overcast|Main Oval/.test(disk.get(k))), rest.join(","));
  ok("...the list is empty, nothing is offered to resume, no draft comes back", (await P.listPractice()).length === 0 && (await P.inProgressPractice()) === null && (await P.loadDraft()) === null);
  ok("...and what is not a practice match is untouched: another match's log, the session, a preference",
    (await store.loadMatch("77777777-0000-0000-0000-000000000009")) != null && (await store.loadSession())?.role === "scorer" && (await store.getPref("analytics")) === false);
  ok("delete-all with nothing to delete is quiet", (await P.deleteAllPractice()).removed === 0);
}

// ── H ────────────────────────────────────────────────────────────────
group("H. Weather: the scorer's own, and no service");
{
  ok("the five buttons, in order", same(P.WEATHER_CONDITIONS.map((c) => c.label), ["Sunny", "Overcast", "Drizzle", "Rain", "Windy"]));
  const w = P.weatherRecord({ condition: "rain", playable: false, at: 1760000000000 });
  ok("a record is match_weather's shape, with only what was seen", w.condition === "rain" && w.playable === false && w.temp_c === null && w.forecast === null && w.observed_at === new Date(1760000000000).toISOString());
  const c = P.weatherChange({ condition: "rain", playable: false, innings: 1, balls: 45, note: "Rain stopped play", at: 1760000000000 });
  ok("a weather change carries the innings, the over and the ball", c.innings === 2 && c.over === 7 && c.ball === 3);
  ok("...in words", P.weatherChangeWords(c) === "Rain, not playable, Rain stopped play — 2nd innings, 7.3 overs", P.weatherChangeWords(c));
  ok("getWeatherHint(lat, lon) returns null, and calls nothing", getWeatherHint(-29.5, 30.3) === null);
  ok("...and this suite made no request at all but the one it asked of the door", fetched.length === 1, fetched.join(","));
}

// ── I ────────────────────────────────────────────────────────────────
group("I. The scorecard file");
{
  const rec = { ...P.practiceRecord(draft, "practice-i1", 1760000000000), weather_changes: [P.weatherChange({ condition: "drizzle", innings: 0, balls: 8, at: 1760000100000 })] };
  const text = scorecardText(rec, pad.log);
  ok("it names the sides, says it is a practice match and carries the names the scorer chose to export", /Hilton U15A v Kearsney U15A/.test(text) && /PRACTICE MATCH/.test(text) && /Alpha One/.test(text) && /Bravo Two/.test(text));
  ok("the innings and the figures", text.includes(`Hilton U15A, innings 1: ${before.runs}/1 (1.3 overs)`) && /Extras: 1 \(wides 1/.test(text), text.split("\n").slice(12, 20).join(" | "));
  ok("the venue, the toss and the weather", /Venue: Main Oval/.test(text) && /Toss: Kearsney U15A won and chose to bowl/.test(text) && /Weather: Drizzle/.test(text));
  ok("the file name has the sides and the date and no player's name", /^practice-match-hilton-u15a-v-kearsney-u15a-\d{4}-\d{2}-\d{2}\.txt$/.test(scorecardFileName(rec)), scorecardFileName(rec));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
