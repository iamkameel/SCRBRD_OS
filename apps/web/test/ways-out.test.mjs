/**
 * The ways out the pad offers (Kameel, 2026-09-27).
 *
 * "Handled the ball" left the Laws in the 2017 Code: it is Obstructing the
 * field (Law 37). The pad offers it nowhere — not on the wicket sheet (the
 * basic pad's and the Pro hub's alike: both open WicketSheet), and not in the
 * no-ball sheet's note of the ways out off a no-ball. The engine keeps
 * DISMISSAL.HANDLED_BALL: an old event, or a pre-2017 scorecard backfilled,
 * still folds, reads and counts as it did, and the server still takes one.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/ways-out.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DISMISSAL, DISMISSAL_LABEL, BALL_TYPE, normaliseDismissal, chargedToBowler,
  deriveInnings, inningsStart, batters, bowler, ball, lawsRefusal, MatchFold,
} from "@scrbrd/scoring";
import { NoBallSheet, WicketSheet } from "../src/scorer/sheets.jsx";
import { NB_TYPES } from "../src/scorer/extras.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 200)}` : ""); } };
const group = (t) => console.log("\n" + t);
const noop = () => {};

group("The wicket sheet: every way out in the Laws, and no handled the ball");
{
  const out = renderToStaticMarkup(h(WicketSheet, {
    batName: "D Erasmus", striker: { id: "a", name: "D Erasmus" }, nonStriker: { id: "b", name: "R Pillay" },
    fieldingSquad: [], onClose: noop, onConfirm: noop,
  }));
  const offered = [...out.matchAll(/data-testid="wicket-mode-([a-z_]+)"/g)].map((m) => m[1]);
  ok("handled the ball is not offered", !offered.includes(DISMISSAL.HANDLED_BALL), offered.join(","));
  ok("...nor its words anywhere on the sheet", !/handled/i.test(out));
  ok("obstructing the field, which it is now, is", offered.includes(DISMISSAL.OBSTRUCTING_FIELD));
  const want = Object.keys(DISMISSAL_LABEL).filter((m) => m !== DISMISSAL.TIMED_OUT && m !== DISMISSAL.HANDLED_BALL);
  ok(`...and every other way out the sheet offered before is still there (${want.length})`,
     JSON.stringify([...offered].sort()) === JSON.stringify([...want].sort()), offered.join(","));
}

group("The no-ball sheet's ways out: the Law's three");
{
  const out = renderToStaticMarkup(h(NoBallSheet, { onConfirm: noop, onClose: noop }));
  ok("no handled the ball", !/handled/i.test(out));
  ok("run out, hit the ball twice, obstructing the field", /run out, hit the ball twice, or obstructing the field/.test(out));
  ok("...and not caught or stumped, which a no-ball cannot be", !/caught|stumped/i.test(out));
  // SCRBRD-113: from 1 October 2026 (the Laws' 4th Edition) a bouncer over
  // head height is a wide. The height no-ball is a waist-high full toss.
  const fourth = renderToStaticMarkup(h(NoBallSheet, { onConfirm: noop, onClose: noop, edition: 4 }));
  ok("a 4th-Edition match: the sheet says a bouncer over head height is a wide", /A bouncer over head height is a wide, not a no ball/.test(fourth));
  ok("...a 3rd-Edition match's does not", !/over head height/.test(out));
  ok("the height no-ball is named as the full toss it is, in both", /Waist-high Full Toss/.test(out) && /without landing/.test(out) && /Waist-high Full Toss/.test(fourth));
  ok("the quick pad's kind reads Waist high, never a bare Height",
     NB_TYPES.find((t) => t.id === "height")?.label === "Waist high" && !NB_TYPES.some((t) => t.label === "Height"));
}

group("The wicket sheet under the 4th Edition: nothing new until an obstruction");
{
  const props = { batName: "D Erasmus", striker: { id: "a", name: "D Erasmus" }, nonStriker: { id: "b", name: "R Pillay" }, fieldingSquad: [], onClose: noop, onConfirm: noop };
  const three = renderToStaticMarkup(h(WicketSheet, { ...props, edition: 3 }));
  const four = renderToStaticMarkup(h(WicketSheet, { ...props, edition: 4 }));
  ok("bowled (the sheet's first way out) reads the same in both Editions", three === four && !/wicket-obstruct-catch/.test(four));
}

group("The engine still reads it: old events and pre-2017 scorecards");
{
  ok("the vocabulary keeps it, with its label", DISMISSAL.HANDLED_BALL === "handled_ball" && DISMISSAL_LABEL.handled_ball === "Handled Ball"
     && normaliseDismissal("handled_ball") === "handled_ball");
  const log = [
    inningsStart({ battingTeam: "Hilton", bowlingTeam: "Westville", squad: [{ id: "a", name: "D Erasmus" }, { id: "b", name: "R Pillay" }, { id: "c", name: "S Naidoo" }], overs: 20 }),
    batters({ striker: "a", nonStriker: "b" }), bowler({ bowler: "k" }),
    ball({ type: BALL_TYPE.RUN, value: 1 }),
  ].map((e, i) => ({ ...e, id: `e${i}`, innings: 0 }));
  const handled = { ...ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: DISMISSAL.HANDLED_BALL }), id: "hb", innings: 0 };
  ok("the server takes one (the Laws check does not refuse it)", lawsRefusal(new MatchFold(log).view(), handled) === null);
  const inn = deriveInnings([...log, handled]);
  const outBat = inn.batsmen.find((b) => b.id === "b");
  ok("it folds: a wicket, not the bowler's, the batter out", inn.wickets === 1 && inn.bowlers[0].wickets === 0
     && !chargedToBowler(DISMISSAL.HANDLED_BALL) && outBat?.status === "out", JSON.stringify(outBat));
  ok("...and reads as it did", /handled/i.test(outBat?.dismissal ?? ""), outBat?.dismissal);
}

console.log(`\nWAYS OUT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
