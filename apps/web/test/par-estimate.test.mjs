/**
 * CRI-1.8: the win estimate, read off the existing par line and labelled a
 * "par estimate" (docs/design/CRICINFO_GAP_PLAN.md decision 5;
 * @scrbrd/scoring parEstimate(), lib/par.js estimateLine();
 * SCRBRD-130 §10 is its calibration note). Held to hand figures in both
 * innings, to nothing at all wherever par defines nothing, to the label before
 * every figure, and to team names only. The surfaces are the browser walks'
 * (browser-matchcentre, browser-public-live, browser-display).
 *
 *   node apps/web/test/par-estimate.test.mjs
 */
import { readFileSync } from "node:fs";
import { inningsStart, batters, bowler, ball, BALL_TYPE, deriveMatch, parReport, parEstimate, normalCdf, venueSpread, RANGE_D2,
  PAR_ESTIMATE_STEP, PAR_ESTIMATE_BOUND } from "@scrbrd/scoring";
import { PAR_ESTIMATE, estimateLine, estimateWords, reportFor } from "../src/lib/par.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// A ground's record: par 128 from nine first innings, 88 to 176 (the design's Kearsney example).
const V = { par: 128, n: 9, range: { low: 88, high: 176 }, sufficient: true };
const SIGMA = 88 / 2.970;   // d2(9) = 2.970

group("the pieces, against the tables");
ok("Φ(0) = ½, Φ(1.96) = 0.975, Φ(−1) = 0.1587", near(normalCdf(0), 0.5, 1e-6) && near(normalCdf(1.96), 0.975, 1e-4) && near(normalCdf(-1), 0.158655, 1e-5));
ok("d2 is the control-chart constant: d2(2) 1.128, d2(5) 2.326, d2(10) 3.078, d2(25) 3.931",
   RANGE_D2[2] === 1.128 && RANGE_D2[5] === 2.326 && RANGE_D2[10] === 3.078 && RANGE_D2[25] === 3.931 && RANGE_D2.length === 26);
ok(`the ground's spread: range 88 ÷ d2(9) = ${SIGMA.toFixed(2)}`, near(venueSpread(V), SIGMA));
ok("...past 25 innings, d2(25), the cautious side", near(venueSpread({ ...V, n: 60 }), 88 / 3.931));
ok("no spread without a range, a number, or a range of nothing", venueSpread({ n: 9 }) === null && venueSpread({ range: { low: 1, high: 9 } }) === null
   && venueSpread({ ...V, range: { low: 120, high: 120 } }) === null && venueSpread({ ...V, n: 1 }) === null && venueSpread(null) === null);

group("hand figures: a first innings, and a chase");
{
  // Northwood 87/3 after 12 of 20 overs; par here at this point 77 (the proportion of overs).
  const f = (128 - 77) / 128, z = (87 - 77) / (SIGMA * Math.sqrt(1 + f));
  const e = parEstimate({ report: { venue: { ...V, parAt: 77 } }, inn: { runs: 87, balls: 72, wickets: 3, overs: 20 }, chasing: false });
  ok(`first innings, ten ahead of par: z = ${z.toFixed(3)}, Φ = ${normalCdf(z).toFixed(3)} → 60 / 40`, e?.kind === "first_innings" && near(e.z, z) && e.batting === 60 && e.fielding === 40, e);
  const level = parEstimate({ report: { venue: { ...V, parAt: 77 } }, inn: { runs: 77, balls: 72, wickets: 3, overs: 20 }, chasing: false });
  ok("...level with par: 50 / 50", level?.batting === 50 && level.fielding === 50, level);
  const behind = parEstimate({ report: { venue: { ...V, parAt: 77 } }, inn: { runs: 67, balls: 72, wickets: 3, overs: 20 }, chasing: false });
  ok("...ten behind: the mirror, 40 / 60", behind?.batting === 40 && behind.fielding === 60, behind);
  // Kearsney 71/4 after 9 overs chasing 134; par at this point 58: 70 left by par, 63 needed.
  const f2 = (128 - 58) / 128, z2 = (128 * f2 - (63 - 0.5)) / (SIGMA * Math.sqrt(f2));
  const c = parEstimate({ report: { venue: { ...V, parAt: 58 } }, inn: { runs: 71, balls: 54, wickets: 4, overs: 20 }, chasing: true, target: 134 });
  ok(`chase, 63 needed where par leaves 70: z = ${z2.toFixed(3)}, Φ = ${normalCdf(z2).toFixed(3)} → 65 / 35`, c?.kind === "chase" && near(c.z, z2) && c.batting === 65 && c.fielding === 35, c);
}

group("on its grain, inside its bounds, and the two sides always 100");
{
  const at = (runs) => parEstimate({ report: { venue: { ...V, parAt: 77 } }, inn: { runs, balls: 72, wickets: 3, overs: 20 }, chasing: false });
  const all = Array.from({ length: 200 }, (_, r) => at(r));
  ok(`every figure a multiple of ${PAR_ESTIMATE_STEP}, between ${PAR_ESTIMATE_BOUND} and ${100 - PAR_ESTIMATE_BOUND}, the pair summing to 100`,
     all.every((e) => e && e.batting % PAR_ESTIMATE_STEP === 0 && e.batting >= PAR_ESTIMATE_BOUND && e.batting <= 100 - PAR_ESTIMATE_BOUND && e.batting + e.fielding === 100));
  ok("never certain: a hundred ahead is 95, a hundred behind is 5", at(177)?.batting === 95 && at(0)?.batting === 5);
  ok("more runs never lowers it", all.every((e, k) => k === 0 || /** @type {any} */ (e).batting >= /** @type {any} */ (all[k - 1]).batting));
}

group("where par defines nothing, there is nothing — never a guess");
{
  const inn = { runs: 87, balls: 72, wickets: 3, overs: 20 };
  const R = { venue: { ...V, parAt: 77 } };
  const none = (what, o) => ok(`${what}: nothing`, parEstimate({ report: R, inn, chasing: false, ...o }) === null);
  none("no report for this position", { report: null });
  none("no venue par (fewer than five innings here)", { report: { venue: { ...V, parAt: 77, sufficient: false } } });
  none("a report with no venue at all (a declaration match, a super over, a scorebook's innings)", { report: { venue: null } });
  none("a ground with no spread on record", { report: { venue: { ...V, parAt: 77, range: { low: null, high: null } } } });
  none("a first innings the umpires cut (held to a full innings' par)", { report: { venue: { ...V, parAt: 77, shortened: true } } });
  none("rain anywhere in the match", { rained: true });
  none("a match play has decided", { decided: true });
  none("a super over", { inn: { ...inn, superOver: 1 } });
  none("a scorebook's innings", { inn: { ...inn, summarised: { runs: 87 } } });
  const C = { report: { venue: { ...V, parAt: 58 } }, chasing: true };
  ok("a chase with no target: nothing", parEstimate({ ...C, inn: { runs: 71, balls: 54, wickets: 4, overs: 20 }, target: null }) === null);
  ok("a chase already won: nothing", parEstimate({ ...C, inn: { runs: 134, balls: 54, wickets: 4, overs: 20 }, target: 134 }) === null);
  ok("a chase with nothing left to bowl: nothing", parEstimate({ ...C, inn: { runs: 100, balls: 120, wickets: 4, overs: 20 }, target: 134 }) === null);
  ok("a chase all out: nothing", parEstimate({ ...C, inn: { runs: 100, balls: 80, wickets: 10, overs: 20 }, target: 134 }) === null);
  ok("a chase sealed: nothing", parEstimate({ ...C, inn: { runs: 100, balls: 80, wickets: 6, overs: 20, complete: true }, target: 134 }) === null);
}

group("the label, on every line, before any figure; the sides by name, never a player");
{
  const sides = { batting: "HIL 1XI", fielding: "WBH 1XI" };
  const w = estimateWords({ batting: 60, fielding: 40 }, sides);
  ok(`"${w}"`, w === "Par estimate: HIL 1XI 60% · WBH 1XI 40%" && w.startsWith(`${PAR_ESTIMATE}: `));
  ok("no estimate, no line", estimateWords(null, sides) === null);
  const par = { chasing: false, report: { venue: { ...V, parAt: 77 } }, rained: false, result: null };
  const inn = { runs: 87, balls: 72, wickets: 3, overs: 20 };
  ok("estimateLine says it from the board's own par", estimateLine({ inn, target: null, par, sides }) === "Par estimate: HIL 1XI 60% · WBH 1XI 40%");
  ok("...nothing with no par, once decided, or once the result is in", estimateLine({ inn, target: null, par: null, sides }) === null
     && estimateLine({ inn, target: null, par, sides, decided: true }) === null && estimateLine({ inn, target: null, par: { ...par, result: "HIL won" }, sides }) === null);
}

group("end to end, from a ball log: the server's par report, matched to the board, read as an estimate");
{
  const names = Array.from({ length: 11 }, (_, i) => ({ id: `h${i}`, name: `D Pupil${i}` }));
  let k = 0;
  const ev = (e, innings = 0) => ({ ...e, innings, id: `x${++k}` });
  const log = [ev(inningsStart({ battingTeam: "1XI", bowlingTeam: "Opp", squad: names, overs: 20 })), ev(batters({ striker: "h0", nonStriker: "h1" }))];
  for (let o = 0; o < 6; o++) {
    log.push(ev(bowler({ bowler: "Opp Bowler" })));
    for (let b = 0; b < 6; b++) {
      if (o === 2 && b === 0) { log.push(ev(ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }))); log.push(ev(batters({ striker: "h2" }))); }
      else log.push(ev(ball({ value: 1 })));
    }
  }
  const venue = { par: 128, n: 9, sufficient: true, median: 126, low: 88, high: 176 };
  const report = parReport({ events: log, venue });
  const inn = deriveMatch(log).innings[0];
  const matched = reportFor(report, inn, 0);
  ok(`the server's report speaks for the board's position (${inn.runs}/${inn.wickets} after ${inn.balls} balls; par here ${report.venue?.parAt})`, !!matched && Number.isInteger(report.venue?.parAt));
  const line = estimateLine({ inn, target: null, par: { chasing: false, report: matched, rained: false }, sides: { batting: "HIL 1XI", fielding: "Opp" } });
  ok(`...and reads as "${line}"`, /^Par estimate: HIL 1XI \d{1,2}% · Opp \d{1,2}%$/.test(line ?? ""));
  ok("...naming no player of the log", !names.some((p) => (line ?? "").includes(p.name)) && !/Pupil|Bowler/.test(line ?? ""));
  const later = reportFor(report, { ...inn, balls: inn.balls + 1 }, 0);
  ok("one ball later the report no longer speaks for the board, and the estimate says nothing until the next read",
     later === null && estimateLine({ inn: { ...inn, balls: inn.balls + 1 }, target: null, par: { chasing: false, report: later, rained: false }, sides: { batting: "a", fielding: "b" } }) === null);
}

group("the calibration note is written, for after the pilot");
{
  const doc = readFileSync(new URL("../../../docs/design/SCRBRD-130_rain_and_par.md", import.meta.url), "utf8");
  ok("SCRBRD-130 §10 records the estimate, its constants and how it is recalibrated on the pilot's ball logs",
     /## 10 · The par estimate \(CRI-1\.8\)/.test(doc) && /Recalibration after the pilot/.test(doc) && /d2/.test(doc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
