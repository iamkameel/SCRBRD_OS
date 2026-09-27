/**
 * The pad's "Umpire suspended the bowler" (SCRBRD-094 item 2) — what its
 * sheet asks before it offers anything, and the sheet as drawn.
 *
 *   - The reasons are the closed list, in words, none with a Law clause
 *     number; the scope is the reason's (ball tampering: the match).
 *   - Only the bowler on, or who bowled the last ball, can be suspended.
 *   - The replacement is offered only from the bowlers the Laws take; the
 *     rest are listed with why not, in words.
 *   - The umpires' report: one item per suspension, the words filled in, a
 *     typed name with no record said so.
 *   - The sheet as drawn: 12px type floor, 44px touch floor, no Law numbers.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/suspension-sheet.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inningsStart, batters, bowler, ball, BALL_TYPE, REFUSAL, SUSPENSION_REASON } from "@scrbrd/scoring";
import { foldPad, withAppended } from "../src/scorer/penalty.js";
import {
  SUSPENSION_REASONS_OFFERED, bowlerToSuspend, bowlingCandidates, replacementOptions, scopeWords, suspendEvent,
  suspendRefusal, suspensionReasonWords, suspensionRefusalWords, suspensionsInMatch,
} from "../src/scorer/suspension.js";
import { SuspendSheet, ReportOffer } from "../src/scorer/suspendSheet.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 200)}` : ""); } };
const group = (t) => console.log("\n" + t);

const B1 = "bbbbbbbb-0000-0000-0000-000000000001";
const SQ_A = ["a1", "a2", "a3", "a4"].map((id) => ({ id, name: `Hilton ${id}` }));
const SQ_B = [{ id: B1, name: "K Botha" }, { id: "b2", name: "D Mkhize" }, { id: "b3", name: "L Govender" }, { id: "b4", name: "S Nel" }];
const runs = (n) => ball({ innings: 0, type: BALL_TYPE.RUN, value: n });
const start = () => [inningsStart({ innings: 0, battingTeam: "Hilton", bowlingTeam: "Michaelhouse", squad: SQ_A, bowlingSquad: SQ_B, overs: 5 }),
  batters({ innings: 0, striker: "a1", nonStriker: "a2" }), bowler({ innings: 0, bowler: "b2" })];
// Over 1 by b2; over 2 by K Botha, two balls in.
const log0 = [...start(), runs(0), runs(1), runs(0), runs(0), runs(0), runs(0), bowler({ innings: 0, bowler: B1 }), runs(0), runs(2)];
const match = (log) => ({ innings: foldPad(log), events: log });

group("The reasons, and who can be suspended");
{
  ok("nine reasons, the closed list (SCRBRD-113: the deliberate beamer apart from the dangerous series; throwing; Level 4 conduct)",
     SUSPENSION_REASONS_OFFERED.length === 9 && SUSPENSION_REASONS_OFFERED.includes("deliberate_beamer")
     && SUSPENSION_REASONS_OFFERED.includes("throwing") && SUSPENSION_REASONS_OFFERED.includes("conduct"));
  const words = SUSPENSION_REASONS_OFFERED.map(suspensionReasonWords);
  ok("each in words, capitalised, no Law clause number", words.every((w) => /^[A-Z]/.test(w) && !/\bLaws?\s+\d/.test(w)), words);
  ok("ball tampering is for the rest of the match, in both Editions",
     scopeWords(SUSPENSION_REASON.BALL_TAMPERING, 3) === "for the rest of the match" && scopeWords(SUSPENSION_REASON.BALL_TAMPERING, 4) === "for the rest of the match");
  ok("...a dangerous beamer for the rest of the innings, in both",
     scopeWords(SUSPENSION_REASON.BEAMERS, 3) === "for the rest of the innings" && scopeWords(SUSPENSION_REASON.BEAMERS, 4) === "for the rest of the innings");
  ok("...a deliberate front-foot no-ball or beamer: the innings under the 3rd Edition, the match under the 4th (SCRBRD-113)",
     scopeWords(SUSPENSION_REASON.DELIBERATE_NO_BALL, 3) === "for the rest of the innings" && scopeWords(SUSPENSION_REASON.DELIBERATE_NO_BALL, 4) === "for the rest of the match"
     && scopeWords(SUSPENSION_REASON.DELIBERATE_BEAMER, 3) === "for the rest of the innings" && scopeWords(SUSPENSION_REASON.DELIBERATE_BEAMER, 4) === "for the rest of the match");
  ok("...and the event the sheet sends carries that scope",
     suspendEvent(0, B1, SUSPENSION_REASON.DELIBERATE_NO_BALL, 3).scope === "innings" && suspendEvent(0, B1, SUSPENSION_REASON.DELIBERATE_NO_BALL, 4).scope === "match");
  const m = match([log0, []]);
  ok("the bowler on is the one to suspend", bowlerToSuspend(m.innings[0]) === B1);
  ok("the Laws take it", suspendRefusal(m, 0, B1, SUSPENSION_REASON.SHORT_PITCHED) === null);
  ok("...not of a bowler who is not bowling", suspendRefusal(m, 0, "b3", SUSPENSION_REASON.SHORT_PITCHED) === REFUSAL.NOT_BOWLING);
  ok("with nobody bowling, nobody", suspendRefusal(match([[start()[0], start()[1]], []]), 0, null, null) === REFUSAL.NOT_BOWLING);
}

group("The replacement: only who the Laws take, the rest with why not");
{
  // A 3rd-Edition match (the report's words below are the innings').
  const ev = suspendEvent(0, B1, SUSPENSION_REASON.DELIBERATE_NO_BALL, 3);
  const after = withAppended([log0, []], 0, [ev]);
  const m = match(after);
  const opts = replacementOptions(m, 0, bowlingCandidates(m.innings[0]));
  ok("mid-over: another finishes it", opts.midOver === true);
  ok("offered: the two who bowled no part of the last over", JSON.stringify(opts.eligible.map((c) => c.id).sort()) === JSON.stringify(["b3", "b4"]),
     JSON.stringify(opts.eligible));
  const why = Object.fromEntries(opts.refused.map((c) => [c.id, c]));
  ok("not offered: the suspended bowler, said so", why[B1]?.code === REFUSAL.BOWLER_SUSPENDED && /Suspended by the umpires/.test(why[B1].words));
  ok("...and the bowler of the last over, said so", why.b2?.code === REFUSAL.CONSECUTIVE_OVERS && /Bowled part of the last over/.test(why.b2.words));
  ok("every refusal's words carry no Law clause number",
     [REFUSAL.NOT_BOWLING, REFUSAL.BOWLER_SUSPENDED, REFUSAL.CONSECUTIVE_OVERS, REFUSAL.SUSPENSION_UNKNOWN, REFUSAL.MID_OVER_NO_REASON, REFUSAL.NO_INNINGS]
       .map(suspensionRefusalWords).every((w) => typeof w === "string" && !/\bLaws?\s+\d/.test(w)));
  // At an over's end: the next over's bowler, no reason; the suspended one still refused.
  const endOver = withAppended([[...start(), runs(0), runs(0), runs(0), runs(0), runs(0), runs(0)], []], 0,
    [suspendEvent(0, "b2", SUSPENSION_REASON.BEAMERS)]);
  const e = replacementOptions(match(endOver), 0, bowlingCandidates(match(endOver).innings[0]));
  ok("suspended on the last ball of an over: the next over's bowler is asked", e.midOver === false
     && e.refused.some((c) => c.id === "b2" && c.code === REFUSAL.BOWLER_SUSPENDED) && e.eligible.some((c) => c.id === "b3"));

  const list = suspensionsInMatch(m.innings);
  ok("the report: one item, the bowler, the words, where it happened", list.length === 1 && list[0].name === "K Botha"
     && list[0].playerId === B1 && list[0].at === "over 1.2" && /a deliberate front-foot no-ball/.test(list[0].body)
     && /for the rest of the innings/.test(list[0].body) && !/\bLaws?\s+\d/.test(list[0].body), JSON.stringify(list[0]));
  const typed = suspensionsInMatch(foldPad(endOver));
  ok("...a typed-name bowler has no record to file against", typed[0]?.playerId === null);
}

group("The sheet as drawn: floors, no Law numbers");
{
  const log = [log0, []];
  const props = { innings: foldPad(log), events: log, curIn: 0, onSuspend() {}, onReplace() {}, onClose() {} };
  const reason = renderToStaticMarkup(h(SuspendSheet, props));
  ok("it names the bowler and asks why", /K Botha/.test(reason) && /data-testid="suspend-reason-beamers"/.test(reason));
  ok("...Record is disabled until a reason is chosen, and says so", /<button[^>]*data-testid="suspend-confirm"[^>]*disabled/.test(reason) && /Choose the reason the umpire gave/.test(reason));
  const after = withAppended(log, 0, [suspendEvent(0, B1, SUSPENSION_REASON.BEAMERS)]);
  const replace = renderToStaticMarkup(h(SuspendSheet, { ...props, view: "replace", innings: foldPad(after), events: after }));
  ok("the replacement: who finishes the over, the eligible as buttons", /Who finishes the over\?/.test(replace)
     && /data-testid="suspend-pick-b3"/.test(replace) && !/data-testid="suspend-pick-b2"/.test(replace));
  ok("...the rest listed with why not", /data-testid="suspend-refused-b2"/.test(replace) && /Bowled part of the last over/.test(replace));
  const report = renderToStaticMarkup(h(SuspendSheet, { ...props, view: "report", innings: foldPad(after), events: after }));
  ok("the report says who files it when this account does not", /data-testid="suspend-report-who"/.test(report));
  const offer = renderToStaticMarkup(h(ReportOffer, { count: 1, onOpen() {} }));
  for (const [name, out] of [["reason", reason], ["replace", replace], ["report", report], ["offer", offer]]) {
    ok(`${name}: no Law clause numbers`, !/\bLaws? \d/.test(out) && !/\(Law/.test(out));
    const sizes = [...out.matchAll(/font-size:\s*([\d.]+)px/g)].map((x) => Number(x[1]));
    ok(`${name}: nothing under 12px (${Math.min(...sizes)}px)`, sizes.length > 0 && sizes.every((s) => s >= 12), sizes);
    const btns = [...out.matchAll(/<(?:button|input)[^>]*>/g)].map((x) => x[0]).filter((b) => !/aria-label="Close/.test(b));
    const tall = btns.map((b) => Number(b.match(/min-height:\s*(\d+)px/)?.[1] ?? 0));
    // The report, for an account that does not file, has no control but Close.
    ok(`${name}: every control is 44px or taller`, (btns.length > 0 || name === "report") && tall.every((x) => x >= 44), btns.filter((_, i) => tall[i] < 44));
  }
}

console.log("\n" + "─".repeat(52));
console.log(`SUSPENSION SHEET: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
