/**
 * up48. The card that draws db/26's two views — rendered, not just adapted.
 *
 * lib/live.js turns `dismissal_breakdown`'s long-form rows into
 * { playerId, side, method, count }; the API and view walks
 * (tools/smoke-dismissals.mjs, tools/smoke-browser-dismissals.mjs) prove the
 * numbers are right end to end, against a real database. What none of that
 * proves is the one thing a screen can get wrong on its own: dropping the row
 * whose `dismissal` is NULL, which db/26's own comment is explicit must never
 * happen — a "method not recorded" wicket is still a real one, and a sum over
 * this card has to keep agreeing with the flat `career.dismissals` /
 * `career.wickets` count it refines.
 *
 * This renders DismissalMethodCard directly, the same way
 * innings-review.test.mjs renders InningsReviewSheet: no DOM, no network,
 * `renderToStaticMarkup` over a fixture `live` object shaped exactly like
 * useLive("dismissal_breakdown", role) returns it.
 *
 * Falsified by dropping the NULL-method row from the sort/render (the
 * "keeps the unrecorded row" and "total still adds up" groups go red) and by
 * reverting the signed-out branch to fall through to the empty-rows branch
 * (the "no mock fallback" group goes red — it would show "No dismissals yet"
 * instead of the sign-in line).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/dismissal-breakdown.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setToken } from "../src/lib/api.js";
import { DismissalMethodCard, dismissalMethodLabel } from "../src/views/ProfilesView.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 160)}` : ""); } };
const group = (t) => console.log("\n" + t);
const html = (el) => renderToStaticMarkup(el);

const PLAYER = "p1";
const card = (live, side = "batting") => html(h(DismissalMethodCard, {
  title: "DISMISSALS BY METHOD", testId: "t", color: "#f00",
  live, playerId: PLAYER, side, emptyMessage: "No dismissals yet.",
}));

group("Vocabulary: every one of the eleven Laws methods has words, and NULL is not one of the eleven");
{
  const ELEVEN = ["bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket",
                  "handled_ball", "obstructing_field", "timed_out", "retired_out", "hit_twice"];
  ok("every method the vocabulary knows renders as words, not its column spelling",
     ELEVEN.every((m) => dismissalMethodLabel(m) !== m && /^[A-Z]/.test(dismissalMethodLabel(m))),
     ELEVEN.filter((m) => dismissalMethodLabel(m) === m).join(" "));
  ok("NULL renders as the sentence a screen should show, not blank and not dropped",
     dismissalMethodLabel(null) === "Method not recorded");
  ok("an unrecognised value still shows something rather than crashing",
     dismissalMethodLabel("something_new") === "something_new");
}

try {
  group("Signed out: no mock fallback for a derived match statistic");
  setToken(null);
  const out = card({ rows: [], loading: false, error: null });
  ok("says to sign in, naming why (derived from live match data)",
     /Sign in to see dismissal analysis/.test(out) && /derived from live match data/.test(out));
  ok("does not draw the ordinary empty-card sentence instead",
     !/No dismissals yet/.test(out));
  // Rows present or not must not matter while signed out — the honest
  // sign-in line always wins, never an invented figure drawn from rows that
  // should not exist in this state.
  const outWithRows = card({ rows: [{ playerId: PLAYER, side: "batting", method: "bowled", count: 9 }], loading: false, error: null });
  ok("...even if rows were somehow present, the signed-out message still wins",
     /Sign in to see dismissal analysis/.test(outWithRows) && !/\b9\b/.test(outWithRows));

  setToken("fixture-token");

  group("Loading and error, told apart from an honest empty answer");
  ok("loading says loading", /Loading…/.test(card({ rows: [], loading: true, error: null })));
  ok("error is not the same claim as empty", /Could not load this/.test(card({ rows: [], loading: false, error: "unreachable" })));
  ok("a real empty answer says so in the card's own words",
     /No dismissals yet\./.test(card({ rows: [], loading: false, error: null })));

  group("Filtered to this player and this side — long-form rows for everyone, drawn for one");
  const rows = [
    { playerId: PLAYER, side: "batting", method: "bowled", count: 3 },
    { playerId: PLAYER, side: "batting", method: "caught", count: 1 },
    { playerId: PLAYER, side: "batting", method: null,     count: 1 },
    // Not this player, and not this side — neither should appear.
    { playerId: "someone-else", side: "batting", method: "lbw", count: 7 },
    { playerId: PLAYER, side: "bowling", method: "bowled", count: 5 },
  ];
  const out2 = card({ rows, loading: false, error: null }, "batting");
  ok("this player's batting methods are on the card", /Bowled/.test(out2) && /Caught/.test(out2));
  ok("another player's row never appears", !/\b7\b/.test(out2));
  ok("this player's OWN bowling row does not leak onto the batting card", !/\b5\b/.test(out2));

  group("The NULL-method row is kept, not dropped, and the total still adds up");
  ok("\"Method not recorded\" is on the card", /Method not recorded/.test(out2));
  // 3 + 1 + 1 = 5. Every count on the card, summed, must equal that — the
  // exact invariant db/26 and the read API's comment both name.
  const counts = [...out2.matchAll(/>(\d+) · (\d+)%</g)].map((m) => Number(m[1]));
  ok("every seeded count is on the card", counts.includes(3) && counts.includes(1));
  ok("nothing was silently summed away", counts.reduce((s, n) => s + n, 0) === 5, counts.join(","));
  ok("the unrecorded row sits last, after every named method",
     out2.indexOf("Method not recorded") > out2.indexOf("Bowled") && out2.indexOf("Method not recorded") > out2.indexOf("Caught"));

  group("Percentages are shares of THIS card's total, not invented");
  // bowled: 3/5 = 60%, caught: 1/5 = 20%, unrecorded: 1/5 = 20%. Matched on
  // the label's own "count · pct%" text, not the bar's CSS width (which
  // repeats the same digits in a `width:NN%` style and would double-count).
  ok("60% next to bowled", /Bowled<\/span><span[^>]*>3 · 60%/.test(out2), out2.match(/Bowled.{0,60}/)?.[0]);
  const pcts = [...out2.matchAll(/\d+ · (\d+)%</g)].map((m) => Number(m[1]));
  ok("every row has a labelled percentage", pcts.length === 3, pcts.join(","));
  ok("percentages actually sum to 100, not left over from a dropped row",
     pcts.reduce((s, n) => s + n, 0) === 100, pcts.join(","));
} finally {
  setToken(null);
}

console.log("\n" + "─".repeat(52));
console.log(`DISMISSAL BREAKDOWN CARD: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
