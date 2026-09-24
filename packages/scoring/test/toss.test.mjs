/**
 * SCRBRD-067. The toss decides the first innings of a live fixture.
 *
 * `battingFirst` restates bats_first() (db/02_schema_scoring.sql) for the one
 * case the pad must decide alone — the scorer answered the toss with no
 * signal — so it is held to the same four cases tools/smoke-toss.mjs holds
 * the SQL to. `firstInningsSides` is what innings_start is opened with: the
 * batting side, and the squads swapping with it.
 *
 *   node packages/scoring/test/toss.test.mjs
 */
import { battingFirst, tossFromRow, firstInningsSides, inningsStart, deriveInnings } from "../src/index.mjs";

let pass = 0, fail = 0;
/** @param {string} n  @param {unknown} c  @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 200)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

group("A. Who bats first — the four ways round, as bats_first() answers them");
{
  /** @type {Array<[string, string, string]>} */
  const combos = [["home", "bat", "home"], ["home", "bowl", "away"], ["away", "bat", "away"], ["away", "bowl", "home"]];
  for (const [wonBy, decision, expected] of combos) {
    ok(`${wonBy} won and elected to ${decision} → ${expected} bats`, battingFirst({ wonBy, decision }) === expected);
  }
}

group("B. Nothing is guessed");
{
  ok("no toss", battingFirst(null) === null && battingFirst(undefined) === null);
  ok("a winner with no choice", battingFirst({ wonBy: "home" }) === null);
  ok("a choice with no winner", battingFirst({ decision: "bat" }) === null);
  ok("a school's name is not a side", battingFirst({ wonBy: "Hilton College", decision: "bat" }) === null);
  ok("'field' is not one of the two choices", battingFirst({ wonBy: "home", decision: "field" }) === null);
}

group("C. Reading the toss off a fixture row (GET /api/read/matches)");
{
  const row = { id: "m", toss_won_by: "away", toss_decision: "bat", bats_first: "away" };
  ok("a recorded toss", JSON.stringify(tossFromRow(row)) === JSON.stringify({ wonBy: "away", decision: "bat", batsFirst: "away" }), tossFromRow(row));
  ok("a fixture with no toss reads as none, not as home",
     tossFromRow({ id: "m", toss_won_by: null, toss_decision: null, bats_first: null }) === null);
  ok("no row at all (not on the list, or the read failed) reads as none", tossFromRow(undefined) === null);
  ok("a row whose answer and toss disagree is not trusted either way",
     tossFromRow({ toss_won_by: "home", toss_decision: "bowl", bats_first: "home" }) === null);
  ok("a row without the server's answer still reads from its toss",
     tossFromRow({ toss_won_by: "home", toss_decision: "bowl" })?.batsFirst === "away");
}

group("D. The first innings: the batting side, and the squads swap with it");
{
  const fixture = { team1: "1XI", team2: "Michaelhouse" };
  const HOME = [{ id: "p1", name: "J Whitfield" }, { id: "p2", name: "T Bekker" }];

  const homeBats = firstInningsSides({ batsFirst: "home", fixture, homeSquad: HOME });
  ok("home bats: home is batting, away bowling", homeBats.battingTeam === "1XI" && homeBats.bowlingTeam === "Michaelhouse");
  ok("...with the home roster batting and nobody's bowling", homeBats.squad === HOME && homeBats.bowlingSquad.length === 0);
  ok("...and the keys follow the sides", homeBats.teamKey === "1XI" && homeBats.bowlingTeamKey === "Michaelhouse");

  const awayBats = firstInningsSides({ batsFirst: "away", fixture, homeSquad: HOME });
  ok("away bats: the away side is batting", awayBats.battingTeam === "Michaelhouse" && awayBats.bowlingTeam === "1XI");
  ok("...the home roster is the BOWLING squad", awayBats.bowlingSquad === HOME);
  ok("...and the batting squad is empty — typed as they come in", Array.isArray(awayBats.squad) && awayBats.squad.length === 0);
  ok("...the keys swap too", awayBats.teamKey === "Michaelhouse" && awayBats.bowlingTeamKey === "1XI");

  const keyed = firstInningsSides({ batsFirst: "away", fixture: { ...fixture, teamKey1: "HIL", teamKey2: "MHS" } });
  ok("explicit keys are kept, and follow their side", keyed.teamKey === "MHS" && keyed.bowlingTeamKey === "HIL");
  ok("no roster at all: both squads empty", keyed.squad.length === 0 && keyed.bowlingSquad.length === 0);

  let threw = false;
  try { firstInningsSides({ batsFirst: /** @type {any} */ (null), fixture }); } catch { threw = true; }
  ok("there is no default side: no toss is refused, not defaulted to home", threw);

  const inn = deriveInnings([inningsStart({ ...awayBats, overs: 20 })]);
  ok("the folded innings names the away side batting", inn.battingTeam === "Michaelhouse" && inn.bowlingTeam === "1XI");
  ok("...and the home players as the bowling squad", inn.bowlingSquad.length === 2 && inn.squad.length === 0);
}

console.log(`\n${"─".repeat(52)}\nTOSS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
