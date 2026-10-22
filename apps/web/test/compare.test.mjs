/**
 * Compare (GA-I24-I25 S1, D10): two players side by side, read and not scored.
 *
 * Held here, against lib/compare.js and the screen's own source:
 *
 *   - THE FLOOR (D4, Q8): a rate is withheld at 29 legal balls and drawn at
 *     30; the count is always drawn, with evidence_label()'s word, and the
 *     thresholds are db/08's, read from the SQL itself
 *   - THE COLUMNS (D5, §4, S5): the fields a component holds are pinned, and
 *     none is a restricted field of any read (skills.score, ratings.*,
 *     notes.body, players.fitness, born, age_band) or on the never-list
 *   - WHO MAY BE PICKED (D2, D10, D11, D13, Q6): a coach's own sides, an
 *     analyst's school, never a boy with no side, never a child readable only
 *     as somebody's child; a pupil's own side, never himself
 *   - NO ABSENCE (D8): a season is offered only where both have figures
 *   - TYPES ONLY (D7): the match-up rows carry no bowler
 *   - NOTHING KEPT (D9), NO VERDICT (D3): the screen writes to no store, has
 *     no share, download or export, reads only the four reads, and draws no
 *     colour of judgement
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/compare.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import {
  COMPARE_FIELDS, COMPARE_FLOOR, NEVER_COMPARED, battingRows, belowFloor, bowlingRows, bySide, compareScopes,
  evidenceWord, floorRate, pickable, project, sharedSeasons, teamMates, typeRows,
} from "../src/lib/compare.js";
import { asCareer, asSeasonCareer } from "../src/lib/live.js";
import { RESTRICTED_FIELDS } from "../../../services/api/read/read-api.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${typeof d === "string" ? d : JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

group("The floor (D4): a rate on thirty legal balls, the count always");
{
  ok("the floor is thirty", COMPARE_FLOOR === 30);
  const at29 = floorRate(41.5, 29), at30 = floorRate(41.5, 30);
  ok("at 29 balls the rate is withheld: an em dash", at29.text === "—" && at29.held === true, at29);
  ok("...with the word insufficient beside it", at29.word === "insufficient", at29);
  ok("at 30 it is drawn", at30.text === "41.50" && at30.held === false && at30.word === null, at30);
  ok("at none the word is none", floorRate(10, 0).word === "none" && floorRate(10, 0).text === "—");
  ok("a scorebook innings with no balls column says so, not none", floorRate(12, null).word === "balls not recorded");
  ok("a rate the adapter could not compute above the floor is a dash with no floor word", floorRate(null, 40).text === "—" && floorRate(null, 40).held === false);
  // db/08's evidence_label(), read from the file: the client's words are the SQL's.
  const sql = read("../../../db/08_schema_programme.sql");
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION evidence_label"), sql.indexOf("$$ LANGUAGE sql IMMUTABLE", sql.indexOf("CREATE OR REPLACE FUNCTION evidence_label")));
  const cuts = [...fn.matchAll(/WHEN p_n < (\d+)\s+THEN '(\w+)'/g)].map((m) => [Number(m[1]), m[2]]);
  ok("db/08's thresholds are read", cuts.length === 3, cuts);
  for (const [n, w] of cuts) {
    ok(`...one under ${n} is ${w} on both sides`, evidenceWord(n - 1) === w, evidenceWord(n - 1));
  }
  ok("...and 250 and over is high", evidenceWord(250) === "high" && /ELSE 'high'/.test(fn));
  ok("...the floor is the first of them", cuts[0][0] === COMPARE_FLOOR && cuts[0][1] === "insufficient");

  const thin = project(asCareer({ player_id: "a", full_name: "S Naidoo", team_code: "1XI", school_id: "s", bat_matches: 3, runs: 15, balls_faced: 21, dismissals: 2,
    bowl_matches: 2, runs_conceded: 70, balls_bowled: 90, wickets: 4, fours: 1, sixes: 0 }));
  const set = project(asCareer({ player_id: "b", full_name: "N Mthembu", team_code: "1XI", school_id: "s", bat_matches: 6, runs: 160, balls_faced: 138, dismissals: 4,
    bowl_matches: 0, runs_conceded: 0, balls_bowled: 0, wickets: 0, fours: 12, sixes: 2 }));
  const bat = Object.fromEntries(battingRows(thin, set).map((r) => [r.key, r]));
  ok("his balls faced are drawn, 21, with their word", bat.balls.a.text === "21" && bat.balls.a.word === "insufficient", bat.balls.a);
  ok("...his average and strike rate are not", bat.avg.a.held && bat.sr.a.held && bat.avg.a.text === "—" && bat.sr.a.text === "—");
  ok("...the other's are, on 138 balls", bat.avg.b.text === "40.00" && bat.sr.b.text === "115.9" && bat.balls.b.word === "moderate", [bat.avg.b, bat.sr.b]);
  ok("...and the runs are counts for both", bat.runs.a.text === "15" && bat.runs.b.text === "160");
  const bowl = Object.fromEntries(bowlingRows(thin, set).map((r) => [r.key, r]));
  ok("bowling floors on balls bowled: 90 is drawn", bowl.econ.a.text === "4.67" && bowl.balls.a.word === "low", bowl.econ.a);
  ok("...nought is none, and no economy", bowl.econ.b.held && bowl.balls.b.word === "none" && bowl.balls.b.text === "0");
  ok("the floor line names who is under it", belowFloor([{ name: "S Naidoo", n: 21 }, { name: "N Mthembu", n: 138 }]).map((s) => s.name).join() === "S Naidoo");
  ok("...and nobody when both clear it", belowFloor([{ name: "a", n: 30 }, { name: "b", n: 31 }]).length === 0);
}

group("The columns (D5, §4, S5): a pinned list, none of them restricted");
{
  ok("the list is the career columns and nothing more", COMPARE_FIELDS.join() ===
    "id,name,team,school,innings,runs,ballsFaced,dismissals,avg,sr,fours,sixes,wkts,ballsBowled,runsConceded,econ,season,currentSeason", COMPARE_FIELDS.join());
  ok("none is on the never-list", COMPARE_FIELDS.every((f) => !NEVER_COMPARED.includes(f)));
  const camel = (s) => s.replace(/[._](\w)/g, (_, c) => c.toUpperCase());
  const restricted = Object.values(RESTRICTED_FIELDS).flat();
  ok("the restricted fields are read", restricted.includes("score") && restricted.includes("body") && restricted.includes("fitness"));
  ok("none is a restricted field of any read, as written or as an adapter names it",
     COMPARE_FIELDS.every((f) => !restricted.includes(f) && !restricted.map(camel).includes(f)), COMPARE_FIELDS.filter((f) => restricted.includes(f)));
  for (const f of ["score", "ratings", "body", "fitness", "born", "age_band", "ageBand", "availability", "workload", "discipline"]) {
    ok(`${f} is on the never-list`, NEVER_COMPARED.includes(f));
  }
  const row = { ...asCareer({ player_id: "a", full_name: "x", team_code: "1XI", school_id: "s", bat_matches: 1, runs: 1, balls_faced: 1, dismissals: 0,
    bowl_matches: 0, runs_conceded: 0, balls_bowled: 0, wickets: 0, form: [4, 1] }), fitness: "rehab", born: "2011-04-07", score: 14, age_band: "U15" };
  const p = project(row);
  ok("a row is cut to the list: no form guide, fitness, birthday, score or band survives",
     !("form" in p) && !("fitness" in p) && !("born" in p) && !("score" in p) && !("age_band" in p) && Object.keys(p).every((k) => COMPARE_FIELDS.includes(k)), Object.keys(p));
  ok("a season row keeps its season", project(asSeasonCareer({ player_id: "a", full_name: "x", season: "2026", current_season: true })).season === "2026");
}

group("Who may be picked (D2, D10, D11, D13, Q6)");
{
  const HIL = "h", WES = "w";
  const rows = [
    { id: "p1", name: "J Whitfield", team: "1XI", school: HIL }, { id: "p2", name: "R Pillay", team: "1XI", school: HIL },
    { id: "p3", name: "S Naidoo", team: "1XI", school: HIL }, { id: "p4", name: "K Dlamini", team: "U14A", school: HIL },
    { id: "p5", name: "T Left", team: null, school: HIL }, { id: "p6", name: "Her Son", team: "1XI", school: WES },
  ].map((r) => ({ ...r, runs: 1, form: [] }));
  const coach = compareScopes([{ role: "coach", school: HIL, team: "1XI" }]);
  ok("a coach's scope is his side", coach.length === 1 && coach[0].team === "1XI");
  ok("...his picker offers his side's boys and no other side's, though the read returns them",
     pickable(rows, coach).map((p) => p.id).join() === "p1,p2,p3", pickable(rows, coach).map((p) => p.id));
  const analyst = compareScopes([{ role: "analyst", school: HIL, team: null }]);
  ok("an analyst's scope is the school: every side", pickable(rows, analyst).map((p) => p.id).sort().join() === "p1,p2,p3,p4");
  ok("A BOY WITH NO SIDE (HE HAS LEFT) IS IN NO PICKER (Q6)", !pickable(rows, analyst).some((p) => p.id === "p5"));
  const sarah = compareScopes([{ role: "directorofsport", school: HIL, team: null }, { role: "guardian", school: WES, team: null }]);
  ok("a director who is a parent at another school picks her school's boys, never her own child there (D11)",
     !pickable(rows, sarah).some((p) => p.id === "p6") && pickable(rows, sarah).length === 4, pickable(rows, sarah).map((p) => p.id));
  for (const role of ["guardian", "player", "selfaccess", "assistantcoach", "teammanager", "scout", "spectator"]) {
    ok(`${role} holds no Compare scope on Analytics (D11, D13, Q3, Q7)`, compareScopes([{ role, school: HIL, team: "1XI" }]).length === 0);
  }
  const me = { id: "p2", team: "1XI", school: HIL };
  const mates = teamMates(rows, me).map((p) => p.id);
  ok("a pupil's one picker offers his own side", mates.join() === "p1,p3", mates);
  ok("...never himself", !mates.includes("p2"));
  ok("...never another side, a boy who has left, or another school", !mates.some((id) => ["p4", "p5", "p6"].includes(id)));
  ok("a pupil with no side has nobody", teamMates(rows, { id: "p5", team: null }).length === 0);
  ok("the picker groups by side", bySide(pickable(rows, analyst)).map(([t, ps]) => `${t}:${ps.length}`).join() === "1XI:3,U14A:1");
}

group("No absence (D8): a season only where both have figures");
{
  const seasons = [{ id: "a", season: "2026" }, { id: "a", season: "2025" }, { id: "b", season: "2026" }, { id: "b", season: "2024" }];
  ok("only the season both played is offered", sharedSeasons(seasons, "a", "b").join() === "2026");
  ok("...none when they share none", sharedSeasons([{ id: "a", season: "2025" }, { id: "b", season: "2026" }], "a", "b").length === 0);
}

group("Types only (D7): no bowler is named");
{
  const m = (bowlerName, bowlingStyle, balls, runs, dismissals) => ({ batterId: "a", batterName: "A", bowlerId: bowlerName, bowlerName, bowlingStyle, balls, runs, dismissals, dots: 0 });
  const rows = typeRows([m("B Khumalo", "M", 20, 18, 1), m("J Steyn", "F", 12, 6, 0), m("K Naidoo", "S", 8, 4, 1)], [m("B Khumalo", "M", 40, 52, 0)]);
  ok("pace and spin, pace first", rows.map((r) => r.type).join() === "pace,spin");
  ok("...his 32 balls of pace are summed and his rate drawn", rows[0].a.balls.text === "32" && rows[0].a.sr.text === "75.0", rows[0].a);
  ok("...eight of spin is a count with no rate", rows[1].a.balls.text === "8" && rows[1].a.sr.held && rows[1].a.sr.word === "insufficient");
  ok("...the other batter faced no spin: nought, none", rows[1].b.balls.text === "0" && rows[1].b.balls.word === "none");
  ok("no bowler's name or id is in what is drawn", !/Khumalo|Steyn|Naidoo/.test(JSON.stringify(rows)), JSON.stringify(rows));
}

group("Nothing kept (D9), no verdict (D3), and only the four reads (D1)");
{
  const src = read("../src/views/compare.jsx");
  const lib = read("../src/lib/compare.js");
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const both = code(src) + code(lib);
  ok("no store is written or read", !/localStorage|sessionStorage|indexedDB|IndexedDB|caches\.|persist\.js|setPref|getPref/.test(both));
  ok("no download, share, export, print or pin", !/download|navigator\.share|\/api\/export|window\.print|clipboard|\bpin\b/i.test(both));
  const reads = new Set([...code(src).matchAll(/use(?:Live|ReadFor)\("(\w+)"/g)].map((m) => m[1]));
  ok("it reads career, career_by_season, matchups and matchup_coverage, and nothing else",
     [...reads].sort().join() === "career,career_by_season,matchup_coverage,matchups", [...reads].join());
  ok("no colour of judgement: no green, red, amber or a status tone", !/emerald|rose|amber|T\.status|D\.(sky|indigo)|brand\.(green|lime)/.test(code(src)));
  ok("no verdict words", !/better|worse|winner|\brank(ing|s)?\b|ahead of|behind\b|\bbest\b|outperform/i.test(code(src)));
  ok("no absence words", !/missed|absent|did not play|unavailable|appearances/i.test(code(src)));
  ok("nothing under 12px", ![...src.matchAll(/fontSize:\s*"(\d+)px"/g)].some((m) => Number(m[1]) < 12));
  ok("every control is 44 tall", [...src.matchAll(/<(?:button|select)\b/g)].length > 0 && (src.match(/minHeight: "44px"/g) ?? []).length >= 3);
  ok("each panel carries a source line", ["source-line-compare-batting", "source-line-compare-bowling", "source-line-compare-matchups"].every((t) => src.includes(`testid="${t}"`)));
  ok("it says when it read", /compare-as-at/.test(src) && /asAtWords/.test(src));
  const an = read("../src/views/AnalyticsView.jsx");
  ok("Analytics offers it as a sub-view", /"compare"/.test(an) && /<Compare role=\{role\}\/>/.test(an));
  const pupil = read("../src/views/family/pupil.jsx");
  ok("the pupil's passport draws it with himself as the left column", /<Compare role=\{role\} self=\{\{ id: me\.id/.test(pupil));
  // The family app's files, the pupil's own aside: a parent's screens are these.
  const famFiles = readdirSync(new URL("../src/views/family/", import.meta.url)).filter((f) => /\.jsx?$/.test(f) && f !== "pupil.jsx");
  ok("the parent's app draws none (D11)", famFiles.length > 5 && famFiles.every((f) => !/<Compare\b|compare\.jsx/.test(read(`../src/views/family/${f}`))), famFiles.join());
}

console.log(`\n${"─".repeat(52)}\nCOMPARE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
