/**
 * The pad's "Batter retired hurt" (SCRBRD-071) — the event it sends, what the
 * Laws say before it is offered, the fold after it and after his return, and
 * the sheet as drawn.
 *
 *   - The event is retire({batter, reason: "hurt"}): no W marker, no
 *     dismissal — it is not a wicket.
 *   - Only a batter at the crease can retire; anyone else is refused, in words.
 *   - Mid-over: the over, the bowler's figures and the wickets do not move; he
 *     is "retired hurt", not out; the partnership ends; his figures stop; the
 *     end he left must be filled before the next ball.
 *   - When he walks back in, his line goes on.
 *   - Who may resume is the Laws' answer: only once a wicket has fallen or
 *     another batter has retired since he went; the batting-order sheet
 *     offers exactly those, so never him straight back to the end he left.
 *   - No retirement once the innings is over.
 *   - The sheet as drawn: 12px type floor, 44px touch floor, no Law numbers.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/retire-sheet.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  inningsStart, batters, bowler, ball, BALL_TYPE, REFUSAL, KIND, RETIRE_REASON, lawsRefusal, scoringReadiness, SCORING_BLOCK,
} from "@scrbrd/scoring";
import { foldPad, withAppended } from "../src/scorer/penalty.js";
import { END_WORDS, resumeChoices, resumeEvent, resumeRefusal, retireChoices, retireHurtEvent, retireRefusal, retireRefusalWords } from "../src/scorer/retire.js";
import { RetireSheet } from "../src/scorer/retireSheet.jsx";
import { BattingOrderSheet } from "../src/scorer/sheets.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const SQ_A = [{ id: "a1", name: "R Pillay" }, { id: "a2", name: "D Erasmus" }, { id: "a3", name: "S Mokoena" }, { id: "a4", name: "T Dlamini" }];
const SQ_B = [{ id: "b1", name: "K Naidoo" }, { id: "b2", name: "B Zulu" }];
const runs = (n) => ball({ innings: 0, type: BALL_TYPE.RUN, value: n });
const start = () => [inningsStart({ innings: 0, battingTeam: "Hilton", bowlingTeam: "Kearsney", squad: SQ_A, bowlingSquad: SQ_B, overs: 5 }),
  batters({ innings: 0, striker: "a1", nonStriker: "a2" }), bowler({ innings: 0, bowler: "b1" })];
// Over 1, three balls in: a1 4 (2), a2 1 (1) — a1 on strike again after the single.
const log0 = [...start(), runs(4), runs(1), runs(1)];
const match = (logs) => ({ innings: foldPad(logs), events: logs });
const withEv = (logs, ...evs) => withAppended(logs, 0, evs);

group("The event: retired hurt, not a wicket");
{
  const ev = retireHurtEvent(0, "a1");
  ok("kind retire, reason hurt, the batter named", ev.kind === KIND.RETIRE && ev.reason === RETIRE_REASON.HURT && ev.batter === "a1" && ev.innings === 0);
  ok("...no wicket marker and no dismissal", !("type" in ev) && !("dismissal" in ev), JSON.stringify(ev));
}

group("The Laws, asked before anything is offered");
{
  const m = match([log0, []]);
  const inn = m.innings[0];
  ok("the striker may retire", retireRefusal(m, 0, inn.striker) === null);
  ok("...and the non-striker", retireRefusal(m, 0, inn.nonStriker) === null);
  ok("a batter not in yet is refused: not at the crease", retireRefusal(m, 0, "a3") === REFUSAL.NOT_AT_CREASE);
  ok("...and nobody at all", retireRefusal(m, 0, null) === REFUSAL.NOT_AT_CREASE);
  const out = withEv([log0, []], ball({ innings: 0, type: BALL_TYPE.WICKET, dismissal: "bowled" }));
  ok("a batter who is out is refused", retireRefusal(match(out), 0, "a2") === null && retireRefusal(match(out), 0, "a1") === REFUSAL.NOT_AT_CREASE);
  const twice = withEv([log0, []], retireHurtEvent(0, "a1"));
  ok("...and one who has already retired", retireRefusal(match(twice), 0, "a1") === REFUSAL.NOT_AT_CREASE);
  ok("with no innings: nobody is batting", retireRefusal(match([[], []]), 0, "a1") === REFUSAL.NO_INNINGS);
  const words = retireRefusalWords(REFUSAL.NOT_AT_CREASE);
  ok(`refused in words ("${words}")`, words === "He is not at the crease. Only a batter who is in can retire.");
  ok("...every code in words, none with a Law clause number",
     Object.values(REFUSAL).every((c) => { const w = retireRefusalWords(c); return typeof w === "string" && w.length > 5 && !/\bLaws?\s*\d|\(Law/.test(w); }));
  ok("...no code, no words", retireRefusalWords(null) === null);

  const choices = retireChoices(m, 0);
  ok("the choice: the striker then the non-striker, by name, with figures",
     choices.length === 2 && choices[0].id === "a1" && choices[0].name === "R Pillay" && choices[0].end === "striker"
     && choices[0].runs === 5 && choices[0].balls === 2 && choices[1].id === "a2" && choices[1].end === "nonStriker"
     && choices.every((c) => c.code === null), JSON.stringify(choices));
  ok("...the ends in words", END_WORDS.striker === "On strike" && END_WORDS.nonStriker === "Non-striker");
  ok("with an end empty, only the batter who is in", retireChoices(match(out), 0).map((c) => c.id).join() === "a2");
}

group("The fold after a retirement mid-over, and after his return");
{
  const before = match([log0, []]).innings[0];
  const logs = withEv([log0, []], retireHurtEvent(0, "a1"));
  const m = match(logs);
  const inn = m.innings[0];
  const a1 = inn.batsmen.find((b) => b.id === "a1");
  ok("he is retired hurt, not out", a1.status === "retired" && a1.dismissal === "retired hurt");
  ok("...not a wicket: none fell, no fall of wicket, no wicket without a ball",
     inn.wickets === 0 && inn.fow.length === 0 && inn.nonBallWickets.length === 0);
  ok("...the over and the bowler do not move", inn.balls === before.balls && inn.bowler === "b1"
     && JSON.stringify(inn.bowlers) === JSON.stringify(before.bowlers));
  ok("...his end is empty, the other batter still in", inn.striker === null && inn.nonStriker === "a2");
  ok("...the partnership ends: 6 off 3, him and his partner",
     inn.partnerships.length === 1 && inn.partnerships[0].runs === 6 && inn.partnerships[0].balls === 3
     && [inn.partnerships[0].bat1, inn.partnerships[0].bat2].sort().join() === "D Erasmus,R Pillay", JSON.stringify(inn.partnerships));
  const gate = scoringReadiness(inn);
  ok("the next ball waits for the next batter", !gate.ready && gate.blocked[0].code === SCORING_BLOCK.NEXT_BATTER);
  ok("...and the Laws refuse one anyway", lawsRefusal(m, runs(0)) === REFUSAL.NEXT_BATTER);
  ok("the batter who comes in at his end is taken", lawsRefusal(m, batters({ innings: 0, striker: "a3" })) === null);

  // a3 comes in, finishes the over and faces the next; a2 is out; a1 walks back in.
  const on = withEv(logs, batters({ innings: 0, striker: "a3" }), runs(2), runs(0), runs(0),
    bowler({ innings: 0, bowler: "b2" }), runs(0));
  const mid = match(on).innings[0];
  const a1Mid = mid.batsmen.find((b) => b.id === "a1");
  ok("the over finishes with the new batter; the retired batter's figures stop", mid.balls === 7 && a1Mid.runs === 5 && a1Mid.balls === 2
     && a1Mid.status === "retired");
  ok("...a new partnership, a3 and a2", mid.curPartner && [mid.curPartner.bat1, mid.curPartner.bat2].sort().join() === "a2,a3");
  const outA2 = withEv(on, ball({ innings: 0, type: BALL_TYPE.WICKET, dismissal: "run_out", dismissed: "a2" }));
  // The over ended with the ends changed: a2 faced b2 and was run out at the striker's end.
  ok("after the next wicket the Laws take him back", lawsRefusal(match(outA2), batters({ innings: 0, striker: "a1" })) === null);
  const back = withEv(outA2, batters({ innings: 0, striker: "a1" }), runs(4), runs(1));
  const fin = match(back).innings[0];
  const a1Back = fin.batsmen.find((b) => b.id === "a1");
  ok("he is batting again, no dismissal line", a1Back.status === "batting" && a1Back.dismissal === null);
  ok("...his line continues: 5 (2), then 4 and 1 — 10 (4), two fours", a1Back.runs === 10 && a1Back.balls === 4 && a1Back.fours === 2,
     JSON.stringify(a1Back));
  ok("...one line on the card", fin.batsmen.filter((b) => b.id === "a1").length === 1);
  ok("...and one wicket in the innings, a2's: the retirement never counted", fin.wickets === 1);
}

group("Who may resume: the Laws' answer, and the sheet that fills his end");
{
  const logs = withEv([log0, []], retireHurtEvent(0, "a1"));
  const m = match(logs);
  ok("straight back into the end he has just left: refused, in words",
     resumeRefusal(m, 0, "a1") === REFUSAL.RESUME_NOT_YET
     && retireRefusalWords(REFUSAL.RESUME_NOT_YET) === "He can resume only once a wicket has fallen or another batter has retired.");
  ok("...so he is not among those who may resume", resumeChoices(m, 0).length === 0);
  ok("...the event it would send goes to the empty end", resumeEvent(m, 0, "a1").striker === "a1"
     && resumeEvent(m, 0, "a1", false).nonStriker === "a1");

  const inn = m.innings[0];
  const props = { squad: SQ_A, batsmen: inn.batsmen, teamKey: null, twelfthMan: null, onSend() {}, onClose() {} };
  const filling = renderToStaticMarkup(h(BattingOrderSheet, { ...props, resumable: resumeChoices(m, 0) }));
  ok("filling the end he has just left, the sheet does not offer him back to it", !/data-testid="resume-a1"/.test(filling)
     && !/data-testid="resume-list"/.test(filling) && /data-testid="batter-choice"/.test(filling));
  const untold = renderToStaticMarkup(h(BattingOrderSheet, props));
  ok("...and not told whom the Laws take, it offers nobody", !/data-testid="resume-list"/.test(untold));

  // a3 comes in; a2 is run out: a wicket has fallen since a1 went.
  const on = withEv(logs, batters({ innings: 0, striker: "a3" }), runs(0),
    ball({ innings: 0, type: BALL_TYPE.WICKET, dismissal: "run_out", dismissed: "a2" }));
  const after = match(on);
  ok("after a wicket he may resume", resumeRefusal(after, 0, "a1") === null
     && resumeChoices(after, 0).map((b) => b.id).join() === "a1", resumeChoices(after, 0).map((b) => b.id));
  const offered = renderToStaticMarkup(h(BattingOrderSheet, { ...props, batsmen: after.innings[0].batsmen, resumable: resumeChoices(after, 0) }));
  ok("...and the sheet offers him", /data-testid="resume-a1"/.test(offered) && /R Pillay resumes/.test(offered));
  const resume44 = [...offered.matchAll(/<button[^>]*data-testid="resume-[^"]*"[^>]*>/g)].map((x) => Number(x[0].match(/min-height:\s*(\d+)px/)?.[1] ?? 0));
  ok("...at 44px or taller", resume44.length === 1 && resume44[0] >= 44, resume44);

  // a3 retires hurt instead: another batter's retirement lets a1 back, not a3.
  const a3Off = withEv(logs, batters({ innings: 0, striker: "a3" }), runs(0), retireHurtEvent(0, "a3"));
  ok("after another batter retires, he may resume; the one who has just gone may not",
     resumeChoices(match(a3Off), 0).map((b) => b.id).join() === "a1" && resumeRefusal(match(a3Off), 0, "a3") === REFUSAL.RESUME_NOT_YET);
}

group("No retirement once the innings is over");
{
  // Five overs of dots: over by the overs, both batters still in.
  let full = [log0, []];
  for (let o = 0; o < 5; o++) {
    if (o > 0) full = withEv(full, bowler({ innings: 0, bowler: o % 2 ? "b2" : "b1" }));
    const need = o === 0 ? 3 : 6;
    for (let k = 0; k < need; k++) full = withEv(full, runs(0));
  }
  const m = match(full);
  ok("the overs are done", m.innings[0].complete === true && m.innings[0].striker != null, [m.innings[0].balls, m.innings[0].complete]);
  const choices = retireChoices(m, 0);
  ok("each batter is refused: the innings is over, in words",
     choices.length === 2 && choices.every((c) => c.code === REFUSAL.INNINGS_OVER && c.words === "This innings is over."), choices);
}

group("The sheet as drawn: floors, no Law numbers");
{
  const logs = [log0, []];
  const props = { innings: foldPad(logs), events: logs, curIn: 0, onRetire() {}, onClose() {} };
  const out = renderToStaticMarkup(h(RetireSheet, props));
  ok("it offers the striker and the non-striker by name", /data-testid="retire-pick-striker"[^>]*data-batter="a1"/.test(out)
     && /R Pillay/.test(out) && /data-testid="retire-pick-nonStriker"[^>]*data-batter="a2"/.test(out) && /D Erasmus/.test(out));
  ok("...says it is not a wicket", /not out, and not a wicket/.test(out));
  ok("...Record is disabled until a batter is chosen, and says so",
     /<button[^>]*data-testid="retire-confirm"[^>]*disabled/.test(out) && /Choose the batter who is going off/.test(out));
  const none = renderToStaticMarkup(h(RetireSheet, { ...props, innings: foldPad([[...start().slice(0, 1)], []]), events: [[...start().slice(0, 1)], []] }));
  ok("with nobody at the crease: the Laws' refusal, in words, and nobody offered", /data-testid="retire-refusal"/.test(none)
     && /He is not at the crease/.test(none) && !/retire-pick-/.test(none));
  for (const [name, html] of [["the choice", out], ["the refusal", none]]) {
    ok(`${name}: no Law clause numbers`, !/\bLaws? \d/.test(html) && !/\(Law/.test(html));
    const sizes = [...html.matchAll(/font-size:\s*([\d.]+)px/g)].map((x) => Number(x[1]));
    ok(`${name}: nothing under 12px (${Math.min(...sizes)}px)`, sizes.length > 0 && sizes.every((s) => s >= 12), sizes);
    const btns = [...html.matchAll(/<button[^>]*>/g)].map((x) => x[0]).filter((b) => !/aria-label="Close/.test(b));
    const tall = btns.map((b) => Number(b.match(/min-height:\s*(\d+)px/)?.[1] ?? 0));
    ok(`${name}: every control is 44px or taller`, btns.length > 0 && tall.every((x) => x >= 44), btns.filter((_, i) => tall[i] < 44));
  }
}

console.log("\n" + "─".repeat(52));
console.log(`RETIRE SHEET: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
