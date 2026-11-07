// A boy's form guide is always an array (lib/live.js mergeCareer).
//
// asCareer promises it, for the boys the career read returns. The merge in
// usePlayersWithCareer put the career row beside the player only where there
// was one, so a boy who had not played, or every boy while the career read was
// still coming or after it failed, had no `form` at all, and Analytics' Full
// Squad Stats fell over on `p.form.slice` (the demo, 6 Nov 2026).
import { asCareer, mergeCareer } from "../src/lib/live.js";

let passes = 0, fails = 0;
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};

const players = [{ id: "a", name: "A Batter" }, { id: "b", name: "B Bowler" }];
const careerA = asCareer({ player_id: "a", full_name: "A Batter", bat_matches: 3, runs: 90, balls_faced: 80, dismissals: 2,
  wickets: 0, balls_bowled: 0, runs_conceded: 0, form: [40, 20, 30] });

// The career read has not answered (or failed): every boy has an empty guide.
const none = mergeCareer(players, []);
ok("no career rows: every boy has a form array", none.every((p) => Array.isArray(p.form) && p.form.length === 0), JSON.stringify(none));
ok("...and keeps his own fields", none[0].name === "A Batter" && none[1].id === "b");

// One boy has played, one has not.
const some = mergeCareer(players, [careerA]);
ok("the boy who played has his form", JSON.stringify(some[0].form) === "[40,20,30]", JSON.stringify(some[0]));
ok("the boy who has not played has an empty one", Array.isArray(some[1].form) && some[1].form.length === 0, JSON.stringify(some[1]));
ok("...and the player's name wins over the career row's", some[0].name === "A Batter");

// The demo's mock rows carry their own guide, which is kept.
const mock = mergeCareer([{ id: "m", name: "Mock", form: [1, 2] }], []);
ok("a row with its own form keeps it", JSON.stringify(mock[0].form) === "[1,2]");
const mockRow = { id: "m2", form: [3] };
ok("...and is the same object (nothing copied that needs no copy)", mergeCareer([mockRow], [])[0] === mockRow);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
