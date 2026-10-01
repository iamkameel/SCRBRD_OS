/**
 * Venue par (SCRBRD-130 R3; docs/design/SCRBRD-130_rain_and_par.md §6):
 *
 *   A. the floor: five innings, one constant, pinned with db/74's (D11)
 *   B. par at a point: the proportion of overs with no table, labelled so;
 *      the resources used with one (here a linear stand-in, worked by hand —
 *      no DLS figure is in this file); one rounding, half up
 *   C. the words the board and the ground page say
 */
import { readFileSync } from "node:fs";
import { VENUE_PAR_MIN_INNINGS, VENUE_PAR_PIN, PAR_AT_METHOD, parAt, parAtWords, venueParWords } from "../src/index.mjs";

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, detail?: unknown) => void} */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

group("A. The floor, pinned with db/74");
ok("five innings", VENUE_PAR_MIN_INNINGS === 5);
ok("the pin db/99 §53 compares SQL's floor with", VENUE_PAR_PIN === "venue_par.min_innings=5");
{
  const sql = readFileSync(new URL("../../../db/74_venue_par.sql", import.meta.url), "utf8");
  const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION venue_par_min_innings()"), sql.indexOf("$$ LANGUAGE", sql.indexOf("CREATE OR REPLACE FUNCTION venue_par_min_innings()")));
  ok("db/74's venue_par_min_innings() is the same five", /SELECT\s+5\s*$/.test(body.trim()), body);
}

group("B. Par at a point");
{
  // 20 overs (120 balls), venue par 128, 12 overs bowled, 3 down.
  const at = { allottedBalls: 120, balls: 72, wickets: 3 };
  const p = parAt(128, at);
  ok("no table: the proportion of overs, 128 × 72 ÷ 120 = 76.8 → 77, labelled so",
     p?.runs === 77 && p.wickets === 3 && p.method === PAR_AT_METHOD.PROPORTION && /no DLS table loaded/.test(p.label), p);
  // A linear stand-in for a table (tenths): R(b, w) = ⌊1000 × b × (10 − w) ÷ (120 × 10)⌋.
  const linear = (/** @type {number} */ b, /** @type {number} */ w) => Math.floor((1000 * b * (10 - w)) / 1200);
  const q = parAt(128, at, { resources: linear });
  // R(120,0) = 1000; R(48,3) = ⌊1000 × 48 × 7 ÷ 1200⌋ = 280; used 720; 128 × 720 ÷ 1000 = 92.16 → 92.
  ok("with a table: the resources used, 128 × 720 ÷ 1000 → 92, labelled so", q?.runs === 92 && q.method === PAR_AT_METHOD.DLS && /DLS resources used/.test(q.label), q);
  ok("half up: 0.5 rounds up (P 1, 60 of 120 bowled)", parAt(1, { allottedBalls: 120, balls: 60, wickets: 0 })?.runs === 1);
  ok("at the start nothing, at the end the whole par", parAt(128, { allottedBalls: 120, balls: 0, wickets: 0 })?.runs === 0
     && parAt(128, { allottedBalls: 120, balls: 120, wickets: 0 })?.runs === 128);
  ok("a reduced innings is measured against the full-length par: 16 overs, all bowled, is the par",
     parAt(128, { allottedBalls: 96, balls: 96, wickets: 2 })?.runs === 128);
  ok("no par (insufficient), or a position that is not one, gives nothing",
     parAt(null, at) === null && parAt(128, { allottedBalls: 0, balls: 0, wickets: 0 }) === null && parAt(128, /** @type {any} */ ({})) === null);
  ok("a table that answers nothing falls back to the proportion", parAt(128, at, { resources: () => null })?.method === PAR_AT_METHOD.PROPORTION);
}

group("C. The words");
ok("the board: a typical side here", parAtWords({ par: 128, n: 9, sufficient: true }, parAt(128, { allottedBalls: 120, balls: 72, wickets: 3 }))
   === "A typical side here would be 77/3 by now");
ok("...or none yet, with the count", parAtWords({ par: null, n: 2, floor: 5, sufficient: false }, null) === "No venue par here yet (2 of 5)");
ok("the ground page", venueParWords({ par: 128, n: 9, sufficient: true }) === "Par at this ground: 128"
   && venueParWords({ par: null, n: 2, floor: 5, sufficient: false }) === "Not enough matches here yet (2 of 5)");

console.log(`\n${"─".repeat(52)}\nVENUE SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
