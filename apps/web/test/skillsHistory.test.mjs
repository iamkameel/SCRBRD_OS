/**
 * The assessment history screens (GA-I26a A3, §4, AH-D4): the strip, the
 * target, "since the last look", the plan editor and the register.
 *
 * Held here, without a browser (tools/smoke-browser-skills-history.mjs holds
 * the same on the real screen, signed in):
 *
 *   - a score history is said as figures and dates, never as a direction: no
 *     "improving", "declining", "stalled", "plateau", "form", "rank",
 *     "percentile", "fatigue", "injured", "absent", "missed", and none of the
 *     cockpit's never-words, in a single word a strip, a target or the panel
 *     draws, text or aria-label, with 40 points and with one
 *   - "not assessed" and "not rated" are words, never a number
 *   - a dot's hit area is 44px, no type is under 12px
 *   - a withdrawn score is drawn but is not on the line and not "where he stands"
 *   - the open targets feed the focus areas, and a withdrawn one feeds nothing
 *   - the panel counts what he attended and never what he did not; a session
 *     with no register says so and is not a zero
 *   - the register has four words and the plan names nobody; `injured` is
 *     nowhere in either
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/skillsHistory.test.mjs
 */
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  shortDate, pointsFor, standingPoint, stripLayout, stripSummary, dotWords, byWords, savedTargets, openTargetOn,
  targetWords, targetProblem, orderDrills, sinceWords, lastLookBy, REGISTER_STATES, CELL, yOf,
} from "../src/lib/assessmentHistory.js";
import { focusAreas } from "../src/lib/focusAreas.js";
import { holdsForPlayer } from "../src/lib/held.js";
import { moved, minutesProblem } from "../src/lib/trainingPlan.js";
import { NEVER_ON_THE_COCKPIT } from "../src/lib/cockpitNever.js";
import { Strip, TargetLine, SincePanel, DotSheet } from "../src/views/skills/History.jsx";
import { PlanList, PlanEditor, RegisterSheet } from "../src/views/training/PlanRegister.jsx";
import { drillCategoriesFor } from "@scrbrd/scoring";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

/** The design's list (§7.3), whole words, plus the cockpit's. */
const NEVER = /\b(improv\w*|declin\w*|stall\w*|plateau\w*|regress\w*|form|fatigue\w*|injur\w*|absent|absence|missed|rank\w*|percentile)\b/i;
const sayable = (s) => !NEVER.test(s) && !NEVER_ON_THE_COCKPIT.test(s);
/** Every word a reader or a screen reader gets from some markup: text nodes and aria-labels. */
const words = (html) => [
  ...[...html.matchAll(/>([^<>]+)</g)].map((m) => m[1]),
  ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]),
].join(" | ");
const fontSizes = (html) => [...html.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));

const pt = (i, score, on, extra = {}) => ({ id: `s${i}`, playerId: "p1", assessedOn: on, category: "technical", metric: "againstPace", score, by: "R Pillay", withdrawn: false, ...extra });

group("Dates and words");
ok("a date is day and month", shortDate("2026-09-14") === "14 Sep" && shortDate("2026-03-02T00:00:00.000Z") === "2 Mar");
ok("no date is no word", shortDate(null) === "" && shortDate("soon") === "");
ok("staff are told who; the boy is told 'your coach'", byWords("R Pillay", true) === "R Pillay, coach" && byWords("R Pillay", false) === "your coach");

group("The strip: figures and dates, no direction");
const hist = [pt(1, 8, "2026-03-14"), pt(2, 9, "2026-05-02"), pt(3, 11, "2026-09-14")];
const rows = [...hist, { ...pt(9, 5, "2026-04-01", { metric: "footwork" }) }];
ok("one metric's points, oldest first", pointsFor(rows, "technical", "againstPace").map((p) => p.score).join() === "8,9,11");
ok("...and only that metric's", pointsFor(rows, "technical", "footwork").length === 1);
ok("where he stands is the newest standing point", standingPoint(hist).score === 11);
const gone = [...hist, pt(4, 3, "2026-10-01", { withdrawn: true, reason: "wrong boy" })];
ok("a withdrawn newest score is not where he stands", standingPoint(gone).score === 11);
const lay = stripLayout(gone);
ok("a withdrawn dot is drawn but off the hairline", lay.dots.length === 4 && lay.line.split(" ").length === 3);
ok("a dot's cell is 44px, so its hit area is", CELL === 44 && lay.dots.every((d, i) => d.x === i * 44 + 22));
ok("the axis runs up: a higher score sits higher", yOf(20) < yOf(11) && yOf(11) < yOf(1));
ok("the summary is two figures and two dates", stripSummary(hist) === "8 on 14 Mar, then 9 on 2 May, then 11 on 14 Sep.", stripSummary(hist));
ok("...and says a withdrawn score is withdrawn, not counted", /1 withdrawn/.test(stripSummary(gone)) && !/\b3 on\b/.test(stripSummary(gone)));
ok("a dot says its score, date and author", dotWords(hist[2], true) === "11 on 14 Sep, rated by R Pillay, coach" && dotWords(hist[2], false) === "11 on 14 Sep, rated by your coach");
ok("...and that it was withdrawn", /withdrawn$/.test(dotWords(gone[3], false)));

const many = Array.from({ length: 40 }, (_, i) => pt(i, 1 + (i * 7) % 20, `2026-${String(1 + (i % 9)).padStart(2, "0")}-${String(1 + (i % 27)).padStart(2, "0")}`));
const tgt = { id: "t1", category: "technical", metric: "againstPace", target: 12, setOn: "2026-09-14", dueOn: "2026-11-30", drillName: "Throw-downs", withdrawn: false };
for (const [name, points, staff] of [["three points", hist, true], ["forty points", many, true], ["one point", [hist[0]], false], ["the boy's view", hist, false]]) {
  const html = renderToStaticMarkup(h(Strip, { points, staff, color: "#0a0", label: "against pace", target: tgt, onOpen() {} }));
  ok(`${name}: nothing the strip says is a verdict`, sayable(words(html)), words(html).match(NEVER)?.[0]);
  ok(`${name}: every dot has a 44px hit area`, (html.match(/<button[^>]*width:44px;height:44px/g) ?? []).length === points.length);
  ok(`${name}: no type under 12px`, fontSizes(html).every((n) => n >= 12), fontSizes(html));
  ok(`${name}: the target ticks the axis`, html.includes('data-testid="target-tick"'));
}
ok("a single point has no hairline to draw", !renderToStaticMarkup(h(Strip, { points: [hist[0]], staff: true, color: "#0a0", label: "x", target: null, onOpen() {} })).includes("hairline"));
ok("two points draw one", renderToStaticMarkup(h(Strip, { points: hist.slice(0, 2), staff: true, color: "#0a0", label: "x", target: null, onOpen() {} })).includes("hairline"));
ok("the hairline has a class that reduced motion switches off", /os-hair/.test(renderToStaticMarkup(h(Strip, { points: hist, staff: true, color: "#0a0", label: "x", target: null, onOpen() {} }))) && /\.os-hair\{animation:none/.test(readFileSync(new URL("../src/design/tokens.js", import.meta.url), "utf8")));

group("The target: said, never closed by the screen");
ok("an open target is its number, date and drill", targetWords(tgt).text === "target 12 · by 30 Nov · set 14 Sep · drill: Throw-downs", targetWords(tgt).text);
const reached = { ...tgt, reachedOn: "2026-10-11", latest: 12, latestOn: "2026-10-11" };
ok("reached is said, with the target struck", targetWords(reached).note === "reached 11 Oct" && targetWords(reached).struck === "target 12");
const lower = { ...reached, latest: 10, latestOn: "2026-11-02" };
ok("reached then rated lower says both and judges neither", targetWords(lower).note === "reached 11 Oct, then rated 10 on 2 Nov" && sayable(targetWords(lower).note));
ok("a target that stood on a withdrawn score says so", /stood on a withdrawn score/.test(targetWords({ ...tgt, fromWithdrawn: true }).note));
ok("a target at or below where he stands is 'already there'", targetProblem(11, 11) === "already there" && targetProblem(9, 11) === "already there");
ok("...above is allowed; a bad number is not", targetProblem(12, 11) === null && /whole number/.test(targetProblem("", 11)) && /whole number/.test(targetProblem(21, 11)) && /whole number/.test(targetProblem(1, null)));
ok("a target on a boy not yet rated needs no standing score", targetProblem(10, null) === null);
const tHtml = renderToStaticMarkup(h(TargetLine, { target: reached }));
ok("the line is struck once reached", /line-through/.test(tHtml) && sayable(words(tHtml)));

group("The focus areas receive the saved targets");
const targets = [tgt, { ...tgt, id: "t2", metric: "footwork", target: 14, withdrawn: true }, { ...tgt, id: "t3", category: "mental", metric: "composure", target: 15 }];
ok("only the open targets of the category", JSON.stringify(savedTargets(targets, "technical")) === '{"againstPace":12}' && JSON.stringify(savedTargets(targets, "mental")) === '{"composure":15}');
ok("a withdrawn target is no target", savedTargets(targets, "technical").footwork === undefined && openTargetOn(targets, "technical", "footwork") === null);
const fa = focusAreas({ againstPace: 8, footwork: 12, timing: 14 }, savedTargets(targets, "technical"));
ok("the lowest rating gets its saved target", fa[0].skill === "againstPace" && fa[0].target === 12 && fa[1].target === null);
ok("a target at or below the rating is not drawn (the same rule as ever)", focusAreas({ againstPace: 12 }, { againstPace: 12 })[0].target === null);

group("Since the last look: what he attended, never what he did not");
const since = {
  discipline: "batting", anchor: "2026-09-14", windowFrom: "2026-09-14", sessions: 6, registered: 6, present: 5, late: 1,
  drills: [{ id: "d1", name: "throw-downs", times: 4 }, { id: "d2", name: "short-pitch defence", times: 2 }, { id: "d3", name: "running between wickets", times: 3 }],
  targets: [{ id: "t1", category: "technical", metric: "againstPace", target: 12, setOn: "2026-09-14", dueOn: "2026-11-30", drillId: "d1", drillName: "throw-downs", drillRan: 4, drillAttended: 3 }],
};
const ctx = { name: "D Erasmus", team: "U15A", self: false, author: "your coach" };
const w = sinceWords(since, ctx);
ok("the title names the discipline, the date and the author", w.title === "Batting · last looked 14 Sep (your coach)", w.title);
ok("the sessions the side held", w.lines[0] === "Since then U15A held 6 sessions.", w.lines[0]);
ok("what he was marked at", w.lines[1] === "D Erasmus was marked present at 5, late at 1.", w.lines[1]);
ok("the drills the plan ran", w.lines[2] === "Drills on those sessions: throw-downs ×4, short-pitch defence ×2, running between wickets ×3.", w.lines[2]);
ok("the target as it stands, the drill and how often he was there", w.lines[3] === "Target: against pace 12 by 30 Nov, set 14 Sep — the drill for it, throw-downs, ran 4 times; he was there for 3.", w.lines[3]);
ok("the footer names its source and window", /^From the training sessions, the register and the plan; U15A, 14 Sep to today\.$/.test(w.footer), w.footer);
ok("the boy is spoken to as 'you'", sinceWords(since, { ...ctx, self: true }).lines[1] === "You were marked present at 5, late at 1." && /you were there for 3/.test(sinceWords(since, { ...ctx, self: true }).lines[3]));
const noReg = sinceWords({ ...since, registered: 0, present: 0, late: 0 }, ctx);
ok("a session with no register is 'no register', not a zero", noReg.lines[1] === "No register was taken at them." && !/marked present/.test(noReg.lines.join(" ")), noReg.lines);
const partial = sinceWords({ ...since, registered: 4 }, ctx);
ok("a register at some says at how many", /a register was taken at 4 of 6/.test(partial.lines[1]), partial.lines[1]);
ok("a side that held no sessions says so", sinceWords({ ...since, sessions: 0, registered: 0, present: 0, late: 0, drills: [] }, ctx).lines[0] === "U15A held no sessions since then.");
ok("no plan is said, not a list of nothing", sinceWords({ ...since, drills: [] }, ctx).lines[2] === "No drills were planned on them.");
ok("a target with no drill says so", /no drill chosen\.$/.test(sinceWords({ ...since, targets: [{ ...since.targets[0], drillName: null, drillId: null }] }, ctx).lines[3]));
const unrated = sinceWords({ discipline: "keeping", anchor: null, sessions: null, targets: [], drills: [] }, ctx);
ok("a discipline he was never rated in is one line, and no number", unrated.lines.join() === "Not yet rated for keeping." && !/\d/.test(unrated.lines.join()) && unrated.footer === null);
const all = [w, noReg, partial, unrated, sinceWords({ ...since, late: 0 }, { ...ctx, self: true })].flatMap((x) => [x.title, ...x.lines, x.footer ?? ""]).join(" | ");
ok("not a word of it is a verdict, an absence or a miss", sayable(all), all.match(NEVER)?.[0]);
const panel = renderToStaticMarkup(h(SincePanel, { rows: [since, { discipline: "bowling", anchor: null, targets: [], drills: [] }], history: [pt(1, 11, "2026-09-14")], player: { name: "D Erasmus", team: "U15A" }, staff: true, self: false }));
ok("the panel draws every discipline it was sent", panel.includes('data-testid="since-batting"') && panel.includes('data-testid="since-bowling"'));
ok("...with the assessor's name for staff", /last looked 14 Sep \(R Pillay, coach\)/.test(words(panel)), words(panel));
ok("...and no type under 12px, and no verdict", fontSizes(panel).every((n) => n >= 12) && sayable(words(panel)));
ok("the last look is by the newest standing score of that discipline", lastLookBy([pt(1, 9, "2026-03-01", { by: "A Coach" }), pt(2, 11, "2026-09-14", { by: "R Pillay" }), pt(3, 4, "2026-10-01", { by: "X", withdrawn: true })], "batting") === "R Pillay");
ok("nobody rated is nobody named", lastLookBy([], "batting") === null);

group("A dot's sheet: staff and the boy");
const staffSheet = renderToStaticMarkup(h(DotSheet, { point: hist[2], staff: true, canWrite: true, points: [{ id: "n1", skillId: "s3", body: "Gets squared up early.", author: "R Pillay", observedOn: "2026-09-15", withdrawn: false }], onClose() {}, onDone() {} }));
ok("staff: the score, the date, the author by name", /Rated 11 on 14 Sep by R Pillay, coach\./.test(words(staffSheet)), words(staffSheet));
ok("staff: the coaching point that stood on this score, and a withdrawal", /Gets squared up early/.test(staffSheet) && staffSheet.includes('data-testid="withdraw-score"'));
const boySheet = renderToStaticMarkup(h(DotSheet, { point: hist[2], staff: false, canWrite: false, points: [{ id: "n1", skillId: "s3", body: "Gets squared up early.", author: "R Pillay", observedOn: "2026-09-15", withdrawn: false }], onClose() {}, onDone() {} }));
ok("the boy: 'your coach', no name, no coaching point, no withdrawal", /by your coach\./.test(words(boySheet)) && !/R Pillay/.test(boySheet) && !/Gets squared up/.test(boySheet) && !boySheet.includes("withdraw-score") && !/COACHING POINTS/.test(boySheet), words(boySheet));
const withdrawnSheet = renderToStaticMarkup(h(DotSheet, { point: { ...hist[0], withdrawn: true, withdrawnBy: "C Hendricks", reason: "wrong boy" }, staff: false, canWrite: true, points: [], onClose() {}, onDone() {} }));
ok("a withdrawn score says so, and who (as his coach), and cannot be withdrawn again", /Withdrawn by your coach: wrong boy\./.test(words(withdrawnSheet)) && !withdrawnSheet.includes("withdraw-score"), words(withdrawnSheet));
ok("no sheet says a direction or a miss", [staffSheet, boySheet, withdrawnSheet].every((x) => sayable(words(x))));
ok("no type under 12px on a sheet", [staffSheet, boySheet, withdrawnSheet].every((x) => fontSizes(x).every((n) => n >= 12)));

group("The drill picker only orders");
const lib = [{ id: "a", category: "fielding" }, { id: "b", category: "batting" }, { id: "c", category: "Batting" }];
const ord = orderDrills(lib, drillCategoriesFor("technical", "againstPace"));
ok("drills that suit come first, every other one below", ord.suit.map((d) => d.id).join() === "b,c" && ord.rest.map((d) => d.id).join() === "a");
ok("an attribute no drill teaches orders nothing and refuses nothing", orderDrills(lib, drillCategoriesFor("mental", "determination")).rest.length === 3);

group("The plan names nobody; the register has four words");
ok("the register's words are the four", REGISTER_STATES.join() === "present,late,excused,absent");
ok("...and `injured` is not one", !REGISTER_STATES.includes("injured"));
ok("a plan line moves up or down, and stops at the ends", moved([1, 2, 3], 1, -1).join() === "2,1,3" && moved([1, 2, 3], 0, -1).join() === "1,2,3" && moved([1, 2, 3], 2, 1).join() === "1,2,3");
ok("minutes: blank is the drill's own, 5 to 180 otherwise", minutesProblem("") === null && minutesProblem("20") === null && !!minutesProblem("4") && !!minutesProblem("181") && !!minutesProblem("2.5"));
const session = { id: "s1", title: "Pre-match nets", team: "U15A", school: "sch", type: "batting", drills: ["Warm-up"] };
const library = [{ id: "d1", name: "Throw-downs", category: "batting", duration: 20 }, { id: "d2", name: "Slips cordon", category: "fielding", duration: 20 }];
const planned = [{ sessionId: "s1", position: 1, drillId: "d1", name: "Throw-downs", category: "batting", minutes: 20, ownMinutes: false }];
const pe = renderToStaticMarkup(h(PlanEditor, { session, plan: planned, drills: library, onClose() {}, onDone() {} }));
ok("the editor shows the plan and offers only the drills that suit a batting session", /1\. Throw-downs/.test(pe) && !pe.includes("plan-add-d2") && pe.includes("Every drill"));
ok("...with the legacy drills shown, as typed, not edited", /Other, as typed[^<]*Warm-up/.test(words(pe)));
ok("...and the buttons are 44px, the type 12px and up", (pe.match(/min-height:44px/g) ?? []).length >= 5 && fontSizes(pe).every((n) => n >= 12));
ok("...and it says it names nobody", /names nobody/.test(pe));
const pl = renderToStaticMarkup(h(PlanList, { lines: planned, other: ["Warm-up"] }));
ok("a session's plan reads 'Throw-downs · 20 min' and 'Other: Warm-up'", /Throw-downs · 20 min/.test(words(pl)) && /Other: Warm-up/.test(words(pl)));
const roster = [{ id: "p1", name: "D Erasmus" }, { id: "p2", name: "K Naidoo" }];
const rs = renderToStaticMarkup(h(RegisterSheet, { session, roster, register: [{ sessionId: "s1", playerId: "p1", status: "late" }, { sessionId: "other", playerId: "p2", status: "present" }], onClose() {}, onDone() {} }));
ok("every boy on the side has the four states and no fifth", ["p1", "p2"].every((id) => REGISTER_STATES.every((st) => rs.includes(`register-${id}-${st}`))) && (rs.match(/role="radio"/g) ?? []).length === 8);
ok("...no 'injured' anywhere on it", !/injur/i.test(rs));
ok("...his mark for THIS session is the one pressed, not another session's", /aria-checked="true"[^>]*data-state="late"/.test(rs) && (rs.match(/aria-checked="true"/g) ?? []).length === 1);
ok("...each state is a 44px target", (rs.match(/role="radio"/g) ?? []).length === (rs.match(/<button[^>]*role="radio"[^>]*min-height:44px/g) ?? []).length && fontSizes(rs).every((n) => n >= 12));
ok("...and there is no free text on the register", !/<textarea/.test(rs) && !/<input/.test(rs));
ok("Save is off until somebody is marked", /data-testid="register-save"[^>]*disabled/.test(renderToStaticMarkup(h(RegisterSheet, { session, roster, register: [], onClose() {}, onDone() {} }))));

group("Nothing here widens a reader or writes a health word");
const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");
const skills = src("../src/views/SkillsView.jsx") + src("../src/views/skills/History.jsx") + src("../src/lib/assessmentHistory.js");
const asked = [...skills.matchAll(/holds(?:AsHeld|ForPlayer)\(\s*role\s*,\s*"([^"]+)"/g)].map((m) => m[1]);
ok("the Skills screens ask only for the scores' and the notes' own capabilities", asked.length >= 3 && asked.every((c) => ["player.development.read", "player.development.write", "player.note.read"].includes(c)), asked);
ok("the Skills screens do not read a load, a wellness check, the discipline record or the injuries", !/workload|wellness|bowler_day|disciplinary|injuries|medical/i.test(skills));
const skillsSrc = src("../src/views/SkillsView.jsx");
ok("Set target, and with it the Why, is offered only to a writer", /\{canEdit&&\(\s*<button type="button" data-testid=\{`set-target-/.test(skillsSrc));
ok("the Skills header draws no fitness or health badge", !/fitness/i.test(skillsSrc));
ok("the register code never writes the word injured", !/injured/i.test(src("../src/views/training/PlanRegister.jsx") + src("../src/lib/trainingPlan.js")));
{
  // A pupil holds player.development.read through selfaccess, which names him
  // alone: the history reads are asked for him, never for a team-mate tapped
  // in the list. A coach's side-scoped assignment names nobody and reaches any.
  const ME = "aaaaaaaa-0000-0000-0000-000000000005", MATE = "aaaaaaaa-0000-0000-0000-000000000006";
  const pupil = [{ role: "player", subjects: [] }, { role: "selfaccess", subjects: [ME] }];
  const coach = [{ role: "coach", subjects: [] }];
  ok("a pupil may ask for his own history", holdsForPlayer("player", "player.development.read", ME, pupil));
  ok("...and not a team-mate's", !holdsForPlayer("player", "player.development.read", MATE, pupil));
  ok("...nor anybody's coaching points", !holdsForPlayer("player", "player.note.read", ME, pupil));
  ok("a coach may ask for any boy's (the server decides which answer)", holdsForPlayer("coach", "player.development.read", MATE, coach));
  ok("no boy selected, no read", !holdsForPlayer("coach", "player.development.read", null, coach));
  ok("the history reads are gated per boy, and the points only where the strip is",
     /useBoyRead\("skills_history",[^)]*mayReadHistory\)/.test(skillsSrc)
     && /useBoyRead\("coaching_points",[\s\S]*?mayReadHistory && holdsForPlayer\(role, "player\.note\.read"/.test(skillsSrc));
}
ok("the assessment modal sends no note", !/note:\s*note/.test(src("../src/lib/development.js")) && !/recordAssessment\([^)]*\{[^}]*note/.test(src("../src/views/SkillsView.jsx")));

console.log(`\n${"─".repeat(52)}\nSKILLS HISTORY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
