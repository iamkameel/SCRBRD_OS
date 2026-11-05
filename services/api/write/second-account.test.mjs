// second-account.mjs (docs/design/TWO_PHONES.md R5): the pen's book and a
// second phone's lined up by innings and legal ball, extras attached to the
// ball before them — agree, differ, the pen has no ball, and drift.
//   node services/api/write/second-account.test.mjs
import { inningsStart, batters, bowler, ball } from "@scrbrd/scoring";
import { alignAccounts, ballLabel } from "./second-account.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {boolean} c @param {string} [d] */
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d); } };

const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "aaaaaaaa-0000-0000-0000-000000000002";
const BW = "aaaaaaaa-0000-0000-0000-000000000003";
let n = 0;
/** An event as the log reads it back: its key as `id`. @param {any} ev @param {string} who */
const ev = (ev, who) => ({ ...ev, innings: 0, id: `${who}-${++n}` });
const run = (/** @type {number} */ v) => ball({ type: "run", value: v, striker: A, nonStriker: B, bowler: BW });
const wide = () => ball({ type: "Wd", value: 0, striker: A, nonStriker: B, bowler: BW });
const setup = () => [inningsStart({ battingTeam: "H", bowlingTeam: "W" }), batters({ striker: A, nonStriker: B }), bowler({ bowler: BW })];
/** The second phone's events, set aside, open. @param {any[]} evs */
const held = (evs) => evs.map((e, i) => ({ id: 100 + i, event: e, resolution: /** @type {string | null} */ (null) }));

ok("ball labels", ballLabel(1) === "0.1" && ballLabel(6) === "0.6" && ballLabel(7) === "1.1" && ballLabel(51) === "8.3" && ballLabel(0) === "start");

{
  // Agree: both phones scored balls 3–6 the same; the pen's is the log.
  const shared = setup().map((e) => ev(e, "s")).concat([ev(run(1), "s"), ev(run(0), "s")]);
  const penOwn = [run(4), run(0), run(2), run(1)].map((e) => ev(e, "pen"));
  const otherOwn = [run(4), run(0), run(2), run(1)].map((e) => ev(e, "oth"));
  const a = alignAccounts({ pen: [...shared, ...penOwn], prefix: shared, held: held(otherOwn) });
  ok("agree: four rows, one per ball the second phone scored", a.rows.length === 4, JSON.stringify(a.rows.map((r) => r.ball)));
  ok("...each agrees", a.rows.every((r) => r.status === "agrees"));
  ok("...at 0.3 to 0.6", a.rows.map((r) => r.ball).join(",") === "0.3,0.4,0.5,0.6");
  ok("...each compared with the pen's ball at its place", a.rows[0].counterparts["100"] === penOwn[0].id && a.rows[3].counterparts["103"] === penOwn[3].id);
  ok("...no drift", a.drift === null);
  ok("...both books total 8 off 6", a.totals.pen[0].runs === 8 && a.totals.other[0].runs === 8 && a.totals.pen[0].balls === 6);
}
{
  // Differ (S5): at 0.3 the pen has 4, the other phone 6.
  const shared = setup().map((e) => ev(e, "s"));
  const pen = [...shared, ...[run(1), run(0), run(4), run(1)].map((e) => ev(e, "pen"))];
  const otherOwn = [run(1), run(0), run(6), run(1)].map((e) => ev(e, "oth"));
  const a = alignAccounts({ pen, prefix: shared, held: held(otherOwn) });
  const d = a.rows.filter((r) => r.status === "differs");
  ok("differ: one row differs", d.length === 1 && d[0].ball === "0.3", JSON.stringify(a.rows.map((r) => [r.ball, r.status])));
  ok("...the other three agree", a.rows.filter((r) => r.status === "agrees").length === 3);
  ok("...in runs, said without naming anyone", d[0].differsIn.join() === "runs or extras", d[0].differsIn.join());
  ok("...the pen's 4 beside the other phone's 6", d[0].pen[0].words === "4 runs" && d[0].other[0].words === "6 runs");
  ok("...an amendment would correct the pen's 0.3", d[0].amendTarget === pen[5].id);
  ok("...the books' totals say it", a.totals.pen[0].runs === 6 && a.totals.other[0].runs === 8);
}
{
  // Pen missing: the pen stopped at 0.2; the other phone scored 0.3 and 0.4.
  const shared = setup().map((e) => ev(e, "s")).concat([ev(run(1), "s"), ev(run(2), "s")]);
  const otherOwn = [run(3), run(0)].map((e) => ev(e, "oth"));
  const a = alignAccounts({ pen: shared, prefix: shared, held: held(otherOwn) });
  ok("pen missing: two rows, the pen has no ball at either", a.rows.length === 2 && a.rows.every((r) => r.status === "missing"),
     JSON.stringify(a.rows.map((r) => [r.ball, r.status])));
  ok("...no counterpart: nothing to compare with", a.rows.every((r) => Object.values(r.counterparts).every((c) => c === null)));
  ok("...and nothing to amend", a.rows.every((r) => r.amendTarget === null));
}
{
  // A wide the pen scored and the other phone did not: the next ball is
  // still in line. That slot differs; nothing drifts.
  const shared = setup().map((e) => ev(e, "s"));
  const pen = [...shared, ...[run(1), wide(), run(0), run(2)].map((e) => ev(e, "pen"))];
  const otherOwn = [run(1), run(0), run(2)].map((e) => ev(e, "oth"));
  const a = alignAccounts({ pen, prefix: shared, held: held(otherOwn) });
  ok("a missed wide: the ball before it differs in the number of deliveries",
     a.rows[0].status === "differs" && a.rows[0].differsIn.includes("the number of deliveries"), JSON.stringify(a.rows[0]));
  ok("...the balls after it agree, and nothing drifts", a.rows.slice(1).every((r) => r.status === "agrees") && a.drift === null);
}
{
  // Drift from an extra wide: the pen has a wide at 0.2 that the other phone
  // scored as a dot. Every legal ball after it is one out.
  const shared = setup().map((e) => ev(e, "s"));
  const pen = [...shared, ...[run(1), wide(), run(4), run(0), run(2)].map((e) => ev(e, "pen"))];
  const otherOwn = [run(1), run(0), run(4), run(0), run(2)].map((e) => ev(e, "oth"));
  const a = alignAccounts({ pen, prefix: shared, held: held(otherOwn) });
  ok("drift: found", a.drift !== null, JSON.stringify(a.rows.map((r) => [r.ball, r.status])));
  ok("...from 0.2, the ball the wide was bowled as", a.drift?.ball === "0.2" && a.drift?.ordinal === 1, JSON.stringify(a.drift));
  ok("...every row from there is marked after the drift", a.rows.every((r) => r.afterDrift === (r.ordinal >= 1)));
  ok("...and the other phone's book is a ball longer", a.totals.other[0].balls === a.totals.pen[0].balls + 1);
}
{
  // A row already decided is not offered again; the next keeps its place.
  const shared = setup().map((e) => ev(e, "s"));
  const pen = [...shared, ...[run(1), run(0)].map((e) => ev(e, "pen"))];
  const o = [run(1), run(0)].map((e) => ev(e, "oth"));
  const h = held(o); h[0].resolution = "rejected";
  const a = alignAccounts({ pen, prefix: shared, held: h });
  ok("a decided row is not offered; the next is still at 0.2", a.rows.length === 1 && a.rows[0].ball === "0.2" && a.rows[0].status === "agrees");
}

console.log(`\nsecond-account: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
