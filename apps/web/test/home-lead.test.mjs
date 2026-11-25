/**
 * Redesign slice 8: the lead on the pupil's and the parent's Home (the role
 * reviews' direction §2.6, §3.1, §3.2; Kameel's questions 5 and 6, 19 Nov).
 *
 *   - leadOf(): one lead per child, by the match day, the ladder in order
 *   - underLead(): the lead's own ask is not drawn twice, and the count is the list's own
 *   - injuredLine(): his open injury in one line, no diagnosis, from his own rows only
 *   - the captain's block in its three places, and only C1's facts in any of them
 *   - the three card weights, from the existing tokens
 *
 * Hand-built fixtures, no DOM beyond server rendering, no database, no clock.
 * The walks (smoke-browser-pupil, smoke-browser-read, smoke-browser-slice4)
 * hold the screens to this.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/home-lead.test.mjs
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { leadOf, onTheDay } from "../src/lib/homeLead.js";
import { SHOWN_ROWS, owes, todoOf, underLead } from "../src/lib/todo.js";
import { homeInjuryRows, injuredLine } from "../src/lib/injury.js";
import { humanDate } from "../src/lib/format.js";
import { NEVER_ON_THE_TAB } from "../src/lib/captain.js";
import { CaptainCardView } from "../src/views/family/captain.jsx";
import { Card } from "../src/views/family/parts.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil";
const NOW = Date.parse("2026-11-21T06:00:00Z");                 // Saturday 08:00 in South Africa
const fx = (iso, o = {}) => ({ id: o.id ?? iso, schoolId: HIL, homeTeam: "1XI", awayTeamCode: null, awaySchoolId: null,
  homeLabel: "Hilton College 1XI", awayLabel: "Westville Boys' High 1XI", opponent: "Westville Boys' High 1XI", status: "upcoming",
  startsAt: `${iso}.000Z`, date: iso.slice(0, 10), time: iso.slice(11, 16), ...o });
const TODAY = fx("2026-11-21T08:00:00", { id: "today" });       // 10:00 SA, not started
const TONIGHT_UTC = fx("2026-11-21T21:30:00", { id: "late" });   // 23:30 SA: still today in South Africa
const TOMORROW = fx("2026-11-22T08:00:00", { id: "tomorrow" });
const NEXT_WEEK = fx("2026-11-28T08:00:00", { id: "next-week" });
const LIVE = fx("2026-11-21T05:00:00", { id: "live", status: "live" });
const DONE_TODAY = fx("2026-11-21T04:00:00", { id: "done-today", status: "complete" });
const DONE_LAST_WEEK = fx("2026-11-14T08:00:00", { id: "done-last-week", status: "complete" });
const OTHER_SIDE = fx("2026-11-21T08:00:00", { id: "u16b-today", homeTeam: "U16B" });
const ME = { id: "p-rohan", name: "R Pillay", knownAs: null, school: HIL, team: "1XI" };

group("leadOf: one lead, by the match day (§2.6's ladder, in order)");
{
  const L = (matches, o = {}) => leadOf({ matches, child: ME, now: NOW, ...o });
  ok("a match of his side live: the board", L([LIVE, TODAY, DONE_TODAY]).kind === "live" && L([LIVE, TODAY]).match.id === "live");
  ok("...and a captain's block goes under it (question 5 (a))", L([LIVE, TODAY], { captain: true }).captainUnder === true && L([LIVE]).captainUnder === false);
  ok("his match today, not started: the fixture leads", L([TODAY, DONE_LAST_WEEK]).kind === "next" && L([TODAY]).match.id === "today");
  ok("...for a captain, his captain's block leads before play (question 5 (a))", L([TODAY], { captain: true }).kind === "captain" && L([TODAY], { captain: true }).match.id === "today");
  ok("...'today' is the South African day: 23:30 SA on Saturday is still Saturday", onTheDay(TONIGHT_UTC, NOW) && L([TONIGHT_UTC], { captain: true }).kind === "captain");
  ok("a captain on any other day: no captain lead, the next fixture leads", L([TOMORROW], { captain: true }).kind === "next" && L([NEXT_WEEK], { captain: true }).kind === "next");
  ok("a match finished today, the next nothing owed: the result leads", L([DONE_TODAY, NEXT_WEEK]).kind === "result" && L([DONE_TODAY, NEXT_WEEK]).match.id === "done-today");
  ok("...but the next fixture with his answer owed comes first (rung 5 before rung 6)", L([DONE_TODAY, NEXT_WEEK], { owed: true }).kind === "next");
  ok("...a result today with nothing to come still leads", L([DONE_TODAY], { owed: true }).kind === "result");
  ok("a result last week, the next fixture to come: the fixture leads, calm", L([DONE_LAST_WEEK, NEXT_WEEK]).kind === "next");
  ok("nothing arranged: 'none' (the next-fixture card's own words, the last result under it)", L([DONE_LAST_WEEK]).kind === "none" && L([]).kind === "none" && L(null).kind === "none");
  ok("another side's match today is not his: it leads nothing", L([OTHER_SIDE, NEXT_WEEK]).kind === "next" && L([OTHER_SIDE, NEXT_WEEK]).match.id === "next-week");
  ok("a postponed fixture never leads", L([fx("2026-11-21T08:00:00", { id: "pp", status: "postponed" }), NEXT_WEEK]).match.id === "next-week");
}

group("underLead: the answer in the lead is not asked again under it; one count");
{
  const silent = (id) => [{ playerId: ME.id, status: null }].map((r) => ({ ...r, matchId: id }));
  const soon = fx("2026-11-24T08:00:00", { id: "soon" }), soon2 = fx("2026-11-25T08:00:00", { id: "soon2" });
  const t = todoOf({ child: ME, matches: [soon, soon2], answers: { soon: silent("soon"), soon2: silent("soon2") }, now: NOW });
  ok("setup: two answers owed, '2 to do'", t.open === 2 && t.line === "2 to do", t.line);
  const u = underLead(t, "soon");
  ok("the lead's row is held, the other drawn", u.held?.matchId === "soon" && u.rows.length === 1 && u.rows[0].matchId === "soon2");
  ok("...the count is the list's own number, said with where the held one is", u.line === "2 to do, including the answer above" && u.open === 2, u.line);
  const one = underLead(todoOf({ child: ME, matches: [soon], answers: { soon: silent("soon") }, now: NOW }), "soon");
  ok("one owed, and it is the lead's: '1 to do: the answer above', and no row", one.line === "1 to do: the answer above" && one.rows.length === 0, one.line);
  const failed = underLead(todoOf({ child: ME, matches: [soon, soon2], answers: { soon: silent("soon"), soon2: null }, now: NOW }), "soon");
  ok("a failed read is still counted and said", failed.line === "1 to do: the answer above · 1 read failed" && failed.rows.length === 1 && failed.rows[0].state === "could_not_read", failed.line);
  ok("no lead, or a lead with nothing owed: the list as it was", underLead(t, null).line === t.line && underLead(t, null).rows.length === 2 && underLead(t, "nope").rows.length === 2);
  const far = fx("2026-12-20T08:00:00", { id: "far" });
  const tl = todoOf({ child: ME, matches: [far], answers: { far: silent("far") }, now: NOW });
  const ul = underLead(tl, "far");
  ok("the lead's ask under 'Later' is held too, and the fold says one fewer", tl.later.rows.length === 1 && ul.later.rows.length === 0 && ul.later.line === null && ul.line === tl.line, [tl.later.line, ul.later.line]);
  ok("owes(): his answer for that fixture is owed; not for one answered", owes(t, "soon") && !owes(t, "nope")
     && !owes(todoOf({ child: ME, matches: [soon], answers: { soon: [{ playerId: ME.id, status: "available" }] }, now: NOW }), "soon"));
  ok("...nothing is claimed owed while the answers are still being read", !owes(todoOf({ child: ME, matches: [soon], answers: {}, now: NOW }), "soon"));
  ok("up to three rows open (§2.6 'Also for you')", SHOWN_ROWS === 3);
}

group("injuredLine: his open injury in one line, no diagnosis, and nobody else's (question 6 (a))");
{
  const inj = (o) => ({ id: o.id ?? "i1", player: ME.id, type: "Hamstring", phase: "rehab", restricted: true, rtw: "2026-12-04", severity: "moderate",
    notes: "Physio notes", physio: "Ms Physio", dateInj: "2026-11-20", ...o });
  const L = (rows) => injuredLine(rows, ME, humanDate);
  ok("open, with a return date: 'Injured · back Fri 4 Dec'", L([inj({})]) === "Injured · back Fri 4 Dec", L([inj({})]));
  ok("no return date read: 'Injured'", L([inj({ rtw: null })]) === "Injured");
  const types = ["Hamstring", "Grade 2 hamstring strain", "Concussion", "Ankle sprain", "Back Fri", "Injured"];
  ok("the line never carries the injury field, whatever the injury is called", types.every((t) => {
    const line = L([inj({ type: t, rtw: null })]) ?? "", dated = L([inj({ type: t })]) ?? "";
    return line === "Injured" && dated === "Injured · back Fri 4 Dec";
  }), types.map((t) => L([inj({ type: t })])));
  ok("...nor the severity, the notes, the physio or the day he was hurt", !/moderate|notes|Physio|20 Nov/i.test(L([inj({})])));
  ok("what a Home keeps of a row: whose, open, the return date; never the injury's name or anything clinical",
     homeInjuryRows([inj({})]).every((r) => Object.keys(r).sort().join() === "leftSchool,phase,player,restricted,rtw" && !("type" in r) && !("notes" in r) && !("severity" in r)));
  ok("cleared, or a status-only row not restricted: nothing", L([inj({ phase: "cleared" })]) === null && L([inj({ phase: null, restricted: false })]) === null);
  ok("a status-only row still restricted: open", L([inj({ phase: null, type: null })]) === "Injured · back Fri 4 Dec");
  ok("a team-mate's row (a coach-parent's read of the side): never his line", L([inj({ player: "p-mate" })]) === null);
  ok("left the injury's school: nothing", L([inj({ leftSchool: true })]) === null);
  ok("two open: the one he is back from last", L([inj({ id: "a", rtw: "2026-11-30" }), inj({ id: "b", rtw: "2026-12-11" })]) === "Injured · back Fri 11 Dec");
  const cards = readFileSync(new URL("../src/views/family/cards.jsx", import.meta.url), "utf8");
  const fn = cards.slice(cards.indexOf("export function InjuryLine"));
  ok("the Home's card draws the line alone: it reads no injury field itself", /injuredLine\(rows, child, humanDate\)/.test(fn) && !/\.(type|severity|notes|physio)\b/.test(fn));
}

group("The captain's block: C1's facts in each of its three places, and nothing more (SCRBRD-138 §3.2, §4)");
{
  const me = { id: "p-rohan", name: "R Pillay", school: HIL, schoolName: "Hilton College", team: "1XI" };
  const plan = { id: "n1", title: "t", body: "Bat first.", author: "Mr Dlamini", publishedAt: "2026-11-19T18:10:00Z", mine: false, noticeId: "nt1", schoolId: HIL, teamCode: "1XI" };
  const draw = (place, next = TODAY, p = plan) => renderToStaticMarkup(h(CaptainCardView, { cap: { label: "Captain" }, next, me, named: 11, plan: p, onOpen: () => {}, place, now: NOW }));
  const card = draw("card"), lead = draw("lead"), under = draw("under", LIVE);
  ok("card (any other day): the fixture line, the count, the plan line, 'Match day'", /captain-card-fixture/.test(card) && /11 named in the side/.test(card) && /captain-card-plan/.test(card) && />Match day</.test(card) && /data-weight="standard"/.test(card));
  ok("lead (his match day, before play): the lead weight, the match's own card in place of the fixture line", /data-weight="lead"/.test(lead) && /captain-card-match/.test(lead) && !/captain-card-fixture/.test(lead)
     && /Hilton College 1XI/.test(lead) && /11 named in the side/.test(lead));
  ok("under (live): a part of the board's lead, no fixture line (the board says it), 'Open the match'", /data-place="under"/.test(under) && !/captain-card-fixture|captain-card-match/.test(under) && />Open the match</.test(under) && !/data-weight/.test(under));
  ok("in no place a team-mate's name, an answer, a health word or a figure nobody measured",
     [card, lead, under].every((x) => !NEVER_ON_THE_TAB.test(x.replace(/<[^>]+>/g, " ")) && !/Naidoo|Whitfield|Bekker/.test(x)), [card, lead, under].map((x) => x.replace(/<[^>]+>/g, " ").match(NEVER_ON_THE_TAB)?.[0]));
  ok("the label is the honour's: 'Vice-captain' for that kind, in every place",
     ["card", "lead", "under"].every((p) => /Vice-captain · Hilton College 1XI/.test(renderToStaticMarkup(h(CaptainCardView, { cap: { label: "Vice-captain" }, next: p === "under" ? LIVE : TODAY, me, named: 0, plan: null, onOpen: () => {}, place: p, now: NOW })))));
  const src = readFileSync(new URL("../src/views/family/captain.jsx", import.meta.url), "utf8");
  const home = src.slice(src.indexOf("// ── C1 · The Home card"), src.indexOf("// ── C2 ·"));
  ok("the block reads only the sheet and the plan, as C1 did: no availability, injury, workload or rating read", (home.match(/useLive\("([a-z_]+)"/g) ?? []).map((m) => m.slice(9, -1)).sort().join() === "match_squad,news"
     && !/availability|injur|workload|rating|wellness/.test(home.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), home.match(/useLive\("([a-z_]+)"/g));
}

group("Three card weights, from the existing tokens");
{
  const w = (weight) => renderToStaticMarkup(h(Card, { label: "X", weight }, "body"));
  ok("lead, standard and quiet each draw, and say which they are", /data-weight="lead"/.test(w("lead")) && /data-weight="standard"/.test(w(undefined)) && /data-weight="quiet"/.test(w("quiet")));
  ok("...and they differ: a lift on the lead, none on the quiet", /box-shadow/.test(w("lead")) && !/box-shadow/.test(w("quiet")) && !/box-shadow/.test(w("standard")) && w("lead") !== w("quiet") && w("standard") !== w("quiet"));
  const parts = readFileSync(new URL("../src/views/family/parts.jsx", import.meta.url), "utf8");
  const block = parts.slice(parts.indexOf("const WEIGHT = {"), parts.indexOf("};", parts.indexOf("const WEIGHT = {")));
  ok("...from tokens alone: no hex, no rgb, no new value", /T\.surface\.raised/.test(block) && /"transparent"/.test(block) && /T\.elevation\.md/.test(block) && !/#[0-9a-f]{3,8}\b|rgba?\(/i.test(block), block.match(/#[0-9a-f]{3,8}\b|rgba?\(/i)?.[0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
