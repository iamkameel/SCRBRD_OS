/**
 * lib/postMatchReport.js — the pure derivations behind the Post-Match Report
 * (SCRBRD-082): best figures, a milestone's over, and the key-moments feed.
 *
 * Every assertion here is against a real `deriveInnings()` fold, not a hand
 * built object shaped like one — the same discipline tools/smoke-scorecard.mjs
 * uses at the API layer: a fixture event log, folded by the package these
 * helpers are meant to agree with, so a change to the fold's own shape breaks
 * this test rather than leaving it quietly asserting against the wrong thing.
 *
 *   node apps/web/test/post-match-report.test.mjs
 */
import { deriveInnings, retire, ball, RETIRE_REASON, NB_RUNS, BALL_TYPE } from "@scrbrd/scoring";
import { keyMoments, matchBestBatting, matchBestBowling, milestoneOver } from "../src/lib/postMatchReport.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d)}` : ""); } };
const group = (t) => console.log("\n" + t);

// A `batters` event immediately before every ball, forcing the named id onto
// strike regardless of the fold's own end-of-over rotation (replay.mjs: ends
// swap on an odd run and again at the sixth legal ball, which a real
// innings' run pattern manages and a synthetic one has to sidestep). This
// tests the LIBRARY's reading of the ball log, not the fold's rotation rule
// — packages/scoring/test/replay.test.mjs is where rotation itself is proven.
const battersBall = (id, value) => [{ kind: "batters", striker: id }, { kind: "ball", innings: 0, type: "run", value, striker: id, bowler: "X" }];

group("An innings nobody has batted yet");
{
  const empty = deriveInnings([{ kind: "innings_start", overs: 20, squad: [], bowlingSquad: [] }]);
  ok("no best batting to name", matchBestBatting([empty]) === null);
  ok("no best bowling to name", matchBestBowling([empty]) === null);
  ok("no key moments", keyMoments([empty]).length === 0);
}

group("A fifty, read off the ball log rather than guessed from the total");
{
  const events = [{ kind: "innings_start", overs: 20, squad: [{ id: "A", name: "A Player" }], bowlingSquad: [] },
                   { kind: "bowler", bowler: "X" }];
  // Twelve fours (48) then two more runs to bring A to exactly fifty on the
  // thirteenth scoring ball, then a dot after — A kept on strike throughout
  // by battersBall(), so a real over-boundary rotation never moves the
  // milestone onto B.
  for (let i = 0; i < 12; i++) events.push(...battersBall("A", 4));
  events.push(...battersBall("A", 2));
  events.push(...battersBall("A", 0));
  const inn = deriveInnings(events);
  ok("the fold agrees A has fifty", inn.batsmen.find((b) => b.id === "A")?.runs === 50, inn.batsmen);

  const over = milestoneOver(inn, "A", 50);
  // Twelve legal balls before the milestone ball, which is itself the 13th
  // legal ball — over 2, ball 1 (1-indexed within the over): fmtOvers(13) = "2.1".
  ok("the milestone lands on the ball that actually crossed it, not the last ball bowled", over === "2.1", over);

  const moments = keyMoments([inn]);
  ok("a fifty is on the key-moments feed", moments.some((m) => m.kind === "fifty" && /A Player/.test(m.label)), moments);
  ok("it is not mistaken for a hundred", !moments.some((m) => m.kind === "hundred"));
}

group("A five-wicket haul and a wicket both appear, in the order they fell");
{
  const events = [{ kind: "innings_start", overs: 20,
    squad: [{ id: "A", name: "A Player" }, { id: "B", name: "B Player" }],
    bowlingSquad: [{ id: "X", name: "X Bowler" }] },
    { kind: "batters", striker: "A", nonStriker: "B" }, { kind: "bowler", bowler: "X" }];
  // Five wickets to X, each a fresh batter named on the incoming "batters" event
  // — the fold needs the pair named again after every fall, same as a real log.
  const names = ["C", "D", "E", "F"];
  for (const id of names) {
    events.push({ kind: "ball", innings: 0, type: "W", value: 0, striker: "A", bowler: "X", dismissal: "bowled" });
    events.push({ kind: "batters", striker: id });
  }
  events.push({ kind: "ball", innings: 0, type: "W", value: 0, striker: "A", bowler: "X", dismissal: "bowled" });
  const inn = deriveInnings(events);
  ok("the fold credits X with five wickets", inn.bowlers.find((b) => b.id === "X")?.wickets === 5, inn.bowlers);

  const best = matchBestBowling([inn]);
  ok("the best (only) bowling figure is X's", best?.id === "X" && best.wickets === 5, best);

  const moments = keyMoments([inn]);
  ok("every wicket is on the feed", moments.filter((m) => m.kind === "wicket").length === 5, moments.length);
  ok("the five-for is on the feed, naming the bowler and the figures",
     moments.some((m) => m.kind === "five-for" && /X Bowler/.test(m.label) && /5\/0/.test(m.label)), moments);
  // fow is already in fall order; the feed must not reorder it.
  const wicketOrder = moments.filter((m) => m.kind === "wicket").map((m) => m.over);
  ok("wickets stay in the order they fell", JSON.stringify(wicketOrder) === JSON.stringify([...wicketOrder].sort((a, b) => Number(a) - Number(b))), wicketOrder);
}

group("Best batting picks the higher score, and the faster one on a tie");
{
  const events = [{ kind: "innings_start", overs: 20,
    squad: [{ id: "A", name: "Slow Fifty" }], bowlingSquad: [] }];
  for (let i = 0; i < 25; i++) events.push(...battersBall("A", 2));
  const inn0 = deriveInnings(events);
  // A second innings supplies the tie: same total, fewer balls.
  const events2 = [{ kind: "innings_start", overs: 20,
    squad: [{ id: "B", name: "Fast Fifty" }], bowlingSquad: [] }];
  for (let i = 0; i < 10; i++) events2.push(...battersBall("B", 5));
  const inn1 = deriveInnings(events2.map((e) => ({ ...e, innings: 1 })));

  const best = matchBestBatting([inn0, inn1]);
  ok("the higher score (or the faster of two equal ones) wins — both scored 50, B in fewer balls",
     best?.id === "B" && best.balls === 10, best);
}

group("A wicket with no ball — retired out, timed out (SCRBRD-081) — is a key moment, and says how");
{
  const squad = ["A", "B", "C", "D", "E"].map((id) => ({ id, name: `${id} Player` }));
  const events = [{ kind: "innings_start", overs: 20, squad, bowlingSquad: [{ id: "X", name: "X Bowler" }] },
    { kind: "batters", striker: "A", nonStriker: "B" }, { kind: "bowler", bowler: "X" },
    ball({ type: BALL_TYPE.RUN, value: 2 }),
    // B walks off without the umpire's leave: retired out, the non-striker.
    retire({ batter: "B", reason: RETIRE_REASON.OUT }),
    // ...and D, due in at that empty end, does not arrive in time.
    retire({ batter: "D", reason: RETIRE_REASON.TIMED_OUT }),
    { kind: "batters", nonStriker: "C" },
    ball({ type: BALL_TYPE.RUN, value: 0 }),
    ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })];
  const inn = deriveInnings(events);
  ok("the fold has two wickets with no ball, and three in the fall of wickets",
     inn.nonBallWickets.length === 2 && inn.fow.length === 3 && inn.wickets === 3, { nb: inn.nonBallWickets, fow: inn.fow });

  const wickets = keyMoments([inn]).filter((m) => m.kind === "wicket");
  ok("every wicket is on the feed, the two with no ball included", wickets.length === 3, wickets);
  const ro = wickets.find((m) => m.dismissal === "retired_out");
  const to = wickets.find((m) => m.dismissal === "timed_out");
  ok("retired out is on it, by name, saying how", /^B Player retired out — 2\/1$/.test(ro?.label ?? ""), ro);
  ok("timed out is on it, by name, saying how", /^D Player timed out — 2\/2$/.test(to?.label ?? ""), to);
  ok("...each at the over the fold says it fell (no ball bowled since the first)",
     ro?.over === inn.fow[0].overs && to?.over === inn.fow[1].overs && ro?.over === "0.1", { ro, to });
  const bowled = wickets.find((m) => !m.dismissal);
  ok("a wicket off a ball still reads as it did", /^A Player out — 2\/3$/.test(bowled?.label ?? ""), bowled);
  ok("...and the feed keeps the order they fell in", wickets.map((m) => m.label.split(" ")[0]).join("") === "BDA", wickets);
}

group("A fifty is reached by runs off the bat — not by byes off a no-ball (SCRBRD-068)");
{
  const events = [{ kind: "innings_start", overs: 20, squad: [{ id: "A", name: "A Player" }], bowlingSquad: [] },
                   { kind: "bowler", bowler: "X" }];
  for (let i = 0; i < 12; i++) events.push(...battersBall("A", 4));
  // Four byes off a no-ball: the side's, not his. He is still on 48.
  events.push({ kind: "batters", striker: "A" }, ball({ type: BALL_TYPE.NO_BALL, value: 4, nbRuns: NB_RUNS.BYES }));
  events.push(...battersBall("A", 2));
  const inn = deriveInnings(events);
  ok("the fold gives him fifty, the byes not his", inn.batsmen.find((b) => b.id === "A")?.runs === 50, inn.batsmen);
  // Twelve legal balls, the no-ball (not legal), then the two: the 13th legal ball.
  const over = milestoneOver(inn, "A", 50);
  ok("the fifty is on the ball that took him there, not the no-ball", over === "2.1", over);
}

console.log("\n" + "─".repeat(52));
console.log(`POST-MATCH REPORT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
