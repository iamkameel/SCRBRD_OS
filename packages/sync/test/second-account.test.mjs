/**
 * Two phones scoring one match: the words each scorer reads
 * (docs/design/TWO_PHONES.md R3; packages/sync/src/second-account.mjs).
 *
 *   node packages/sync/test/second-account.test.mjs
 */
import { secondAccountWords, penStandsLine, penStandsWords } from "../src/index.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 240)}` : ""); } };

const ballsOf = (n) => Array.from({ length: n }, () => ({ payload: { kind: "ball" } }));

// The design's words, with the design's count.
{
  const w = secondAccountWords(ballsOf(22));
  ok("the lead is R3's", w.lead === "Another phone scored this match while this one had no signal.", w.lead);
  ok("the text is R3's, with the real count", w.text === "22 balls on this phone are not in the match record. They are kept here and "
     + "set aside on the server for review — nothing was lost, and none of them was added to the score. "
     + "Someone who approves corrections will compare the two accounts.", w.text);
  ok("the count is said", w.count === "22 balls", w.count);
}
// One ball reads as one.
{
  const w = secondAccountWords(ballsOf(1));
  ok("one ball, singular", w.text.startsWith("1 ball on this phone is not in the match record. It is kept here")
     && w.text.includes("it was not added to the score"), w.text);
}
// A kept over change is counted, not called a ball.
{
  const w = secondAccountWords([...ballsOf(6), { payload: { kind: "bowler_change" } }]);
  ok("a ball and another change", w.count === "6 balls and 1 other change" && w.text.startsWith("6 balls and 1 other change on this phone are"), w.text);
}
// The pen-holder's line and its sheet.
{
  ok("the badge line is R3's", penStandsLine(22) === "Your scoring stands · 22 balls from another phone set aside for review", penStandsLine(22));
  ok("one ball, singular", penStandsLine(1) === "Your scoring stands · 1 ball from another phone set aside for review", penStandsLine(1));
  const w = penStandsWords(22);
  ok("the pen-holder's sheet says the same, of the other phone", w.lead === "Another phone scored this match while it had no signal."
     && w.text.includes("22 balls from it are not in the match record") && w.text.includes("nothing was lost")
     && w.text.includes("Someone who approves corrections will compare the two accounts."), w);
}
// No person is named, and nothing invites a merge.
{
  const all = [secondAccountWords(ballsOf(3)).text, penStandsWords(3).text, penStandsLine(3)].join(" ");
  ok("no merge, no accept, no name", !/merge|accept|scorer/i.test(all), all);
}

console.log(`\nsecond-account: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
