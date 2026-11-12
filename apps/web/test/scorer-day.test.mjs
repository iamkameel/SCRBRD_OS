/**
 * The scorer's home as a day sheet (R0: ROLE_DASHBOARDS_v1.1 §3D, §4, §9):
 * the order of its sections and which show in each state; what goes on the
 * P0 card and what does not; the board drawn from the phone's own log with no
 * player named; the finished Pilot Matches kept as a sandbox; the week; the
 * start entry's words. Hand-built logs and rows, no DOM, no database, no clock.
 *
 * The browser walk (tools/smoke-browser-scorer-home.mjs) holds the screen to this.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/scorer-day.test.mjs
 */
import { readFileSync } from "node:fs";
import { inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";
import {
  SECTION_ORDER, SANDBOX_WORDS, WEEK_DAYS, boardOfLog, finishedPilots, homeSections, nowItems, p0Items, scoreLine, startWords, weekOf,
} from "../src/lib/scorerDay.js";
import { heldByMatch, pendingByMatch } from "../src/lib/deviceMatches.js";
import { abandonCode, pilotStateWords, pilotUuid } from "../src/lib/pilot.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const NOW = Date.parse("2026-11-12T08:00:00Z");               // Thursday 10:00 SA
const T0 = Date.parse("2026-11-12T07:00:00Z");
const SQ_A = ["a1", "a2", "a3"].map((id) => ({ id, name: `Alpha ${id}` }));
const SQ_B = ["b1", "b2", "b3"].map((id) => ({ id, name: `Bravo ${id}` }));
const runs = (n, i = 0) => ball({ innings: i, type: BALL_TYPE.RUN, value: n, clientTs: T0 });
/** A log of one innings in play: the openers, the bowler, and these runs. */
const log = (...rs) => [[
  inningsStart({ innings: 0, battingTeam: "Hilton U13B", bowlingTeam: "Kearsney U13B", squad: SQ_A, bowlingSquad: SQ_B, overs: 20, clientTs: T0 }),
  batters({ innings: 0, striker: "a1", nonStriker: "a2", clientTs: T0 }),
  bowler({ innings: 0, bowler: "b1", clientTs: T0 }),
  ...rs.map((r) => runs(r)),
], []];

group("The sections, in the order the day happens");
{
  ok("the order is P0, Now, Start, Pilot Matches, This week", SECTION_ORDER.join() === "p0,now,start,pilots,week", SECTION_ORDER);
  const none = homeSections({});
  ok("nothing applies: Now (its empty state) and Start only", none.join() === "now,start", none);
  ok("a P0 item puts the card first", homeSections({ p0: 1 })[0] === "p0");
  ok("no P0 item, no card", !homeSections({ p0: 0 }).includes("p0"));
  ok("Pilot Matches when this account may send them, though none exists yet", homeSections({ pilotOffer: true }).join() === "now,start,pilots");
  ok("...or when one is on this phone or the server, whatever the switch says now", homeSections({ pilotsKnown: 2 }).includes("pilots"));
  ok("...and not for a scorer with no Pilot Match and no grant", !homeSections({ pilotOffer: false, pilotsKnown: 0 }).includes("pilots"));
  ok("This week when he has a fixture in it", homeSections({ week: 1, weekRead: "ok" }).at(-1) === "week");
  ok("...not when the read answered none", !homeSections({ week: 0, weekRead: "empty" }).includes("week") && !homeSections({ week: 0, weekRead: "ok" }).includes("week"));
  for (const st of ["loading", "failed", "forbidden", "disabled", "partial", "stale"]) {
    ok(`...but when the read is ${st}, it stays and says so (never drawn as none)`, homeSections({ week: 0, weekRead: st }).includes("week"));
  }
  const all = homeSections({ p0: 2, pilotOffer: true, week: 3, weekRead: "ok" });
  ok("everything at once keeps the order", all.join() === SECTION_ORDER.join(), all);
  ok("each list is a subsequence of the order", [none, all, homeSections({ p0: 1, week: 1, weekRead: "ok" })]
    .every((l) => l.every((k, i) => i === 0 || SECTION_ORDER.indexOf(l[i - 1]) < SECTION_ORDER.indexOf(k))));
}

group("The board, from the phone's own log, with no player named");
{
  const b = boardOfLog(log(1, 4, 0, 6), { curIn: 0, overs: 20 });
  ok("the innings in play: its side, its total, its wickets, its overs", b && b.team === "Hilton U13B" && b.total === 11 && b.wickets === 0 && b.overs === "0.4", b);
  ok("...the over as the board's chips", JSON.stringify(b?.thisOver) === JSON.stringify(["1", "4", "·", "6"]), b?.thisOver);
  ok("...no batter, no bowler, no last wicket: nothing that names a child", b && !("batters" in b) && !("bowler" in b) && !("lastWicket" in b) && !("partnership" in b));
  ok("...and no typed name anywhere in it", !/Alpha|Bravo/.test(JSON.stringify(b)));
  const zero = boardOfLog(log(), { curIn: 0 });
  ok("an innings with no ball yet is 0 for 0 off 0.0: the real state, not a stand-in", zero && zero.total === 0 && zero.overs === "0.0", zero);
  ok("a log with no innings has no board (the screen says so)", boardOfLog([[], []]) === null);
  ok("a log that does not fold has no board, and does not throw", boardOfLog([[{ id: "e1" }, { id: "e2" }], []]) === null);
  ok("no log, no board", boardOfLog(null) === null && boardOfLog(undefined) === null);
}

group("Now: what this phone is part-way through");
{
  const fixtures = [{ matchId: "fx-1", title: "1XI v Kearsney", pending: 3, savedAt: NOW - 60e3, openable: true, match: { id: "fx-1" }, events: log(1), curIn: 0, overs: 20 }];
  const pilots = [
    { id: "pilot-aaaa", title: "Hilton U13B v Kearsney U13B", complete: false, savedAt: NOW - 10e3, log: { events: log(4), curIn: 0 }, meta: { match: { overs: 20 } } },
    { id: "pilot-bbbb", title: "Done v Dusted", complete: true, savedAt: NOW - 9e5, log: { events: log(1) } },
    { id: "pilot-cccc", title: "Set up v Unscored", complete: false, savedAt: NOW, log: { events: [[], []] } },
  ];
  const practices = [{ id: "practice-1", title: "Nets v Nets", complete: false, savedAt: NOW - 5e3, log: { events: log(2) } }];
  const pending = new Map([["pilot-aaaa", 2]]);
  const held = new Map([["fx-1", 1]]);
  const now = nowItems({ fixtures, pilots, practices, pending, held });
  ok("a fixture, an unfinished Pilot Match and an unfinished practice match; newest save first",
    now.map((i) => i.matchId).join() === "practice-1,pilot-aaaa,fx-1", now.map((i) => i.matchId));
  ok("a finished Pilot Match is not part-way through", !now.some((i) => i.matchId === "pilot-bbbb"));
  ok("a Pilot Match with nothing scored is not drawn as a session", !now.some((i) => i.matchId === "pilot-cccc"));
  ok("the Pilot Match's unsent events are the outbox's own count", now.find((i) => i.matchId === "pilot-aaaa").pending === 2);
  ok("a practice match has no outbox: nothing to send, ever", now.find((i) => i.matchId === "practice-1").pending === 0);
  ok("each has its board", now.every((i) => i.board && Number.isFinite(i.board.total)));
  const unread = nowItems({ pilots, pending: null, held: null });
  ok("an outbox that could not be read is null, never 0", unread.find((i) => i.matchId === "pilot-aaaa").pending === null
    && unread.find((i) => i.matchId === "pilot-aaaa").held === null);
  ok("nothing on the phone: nothing drawn (Now says so)", nowItems({}).length === 0);
}

group("P0: only what applies, in the brief's order");
{
  const it = (o) => ({ key: o.matchId, kind: "fixture", title: o.matchId, pending: 0, held: 0, openable: true, ...o });
  const none = p0Items([it({ matchId: "a" }), it({ matchId: "b", kind: "pilot" })], { device: "dev-me", at: NOW });
  ok("everything sent, nobody else holding, nothing held: no P0 at all", none.length === 0, none);
  ok("an unread outbox is not a P0 (it is said on the Now row)", p0Items([it({ matchId: "a", pending: null, held: null })]).length === 0);
  const now = [
    it({ matchId: "fx-held", held: 2 }),
    it({ matchId: "fx-lease" }),
    it({ matchId: "fx-queue", pending: 4 }),
    it({ matchId: "pilot-lease", kind: "pilot" }),
    it({ matchId: "pilot-lapsed", kind: "pilot" }),
    it({ matchId: "pilot-mine", kind: "pilot" }),
    it({ matchId: "fx-closed", pending: 5, openable: false }),
  ];
  const fixtureStates = new Map([["fx-lease", "held_other"], ["fx-queue", "held_here"], ["fx-held", "not_started"]]);
  const pilotSessions = new Map([
    ["pilot-lease", { holderDevice: "dev-other", leaseUntil: new Date(NOW + 60e3).toISOString() }],
    ["pilot-lapsed", { holderDevice: "dev-other", leaseUntil: new Date(NOW - 60e3).toISOString() }],
    ["pilot-mine", { holderDevice: "dev-me", leaseUntil: new Date(NOW + 60e3).toISOString() }],
  ]);
  const p0 = p0Items(now, { fixtureStates, pilotSessions, device: "dev-me", at: NOW });
  ok("the order: not yet sent, then held elsewhere, then held for him", p0.map((x) => x.kind).join() === "queue,lease,lease,lease,held", p0.map((x) => x.kind));
  ok("the queue counts what the outbox counts", p0[0].matchId === "fx-queue" && /^4 to send/.test(p0[0].label), p0[0]);
  ok("a fixture another device holds is a lease conflict", p0.some((x) => x.kind === "lease" && x.matchId === "fx-lease" && /Another device/.test(x.label)));
  ok("this device holding it is not", !p0.some((x) => x.kind === "lease" && x.matchId === "fx-queue"));
  ok("a Pilot Match another phone holds, its lease live", p0.some((x) => x.matchId === "pilot-lease" && x.why === "pilot_active"));
  ok("...and one whose lease lapsed: take over on the pad", p0.some((x) => x.matchId === "pilot-lapsed" && x.why === "pilot_lapsed" && /take over/.test(x.note)));
  ok("this phone holding its own Pilot Match is no conflict", !p0.some((x) => x.matchId === "pilot-mine"));
  ok("held events wait on him, counted", p0.some((x) => x.kind === "held" && x.matchId === "fx-held" && /^2 held/.test(x.label)));
  ok("a match he may no longer open is not offered as a P0 door", !p0.some((x) => x.matchId === "fx-closed"));
  ok("with the server's sessions unread, no Pilot Match is called a conflict", p0Items(now, { pilotSessions: null, device: "dev-me", at: NOW })
    .every((x) => !x.matchId.startsWith("pilot-")));
  ok("every P0 item names its match and says what to do", p0.every((x) => x.title && x.label && x.note));
  ok("no P0 word is a bare count or a colour: each is a sentence", p0.every((x) => /[a-z]/.test(x.label)));
}

group("The outbox, counted per match: unsent and held apart");
{
  const keys = ["pilot-x:dev-a:evt:000000001", "pilot-x:dev-a:evt:000000002", "pilot-x:dev-a:held:000000003", "pilot-x:dev-b:held:000000001",
                "m1:dev-a:meta", "m1:dev-a:sent:k1", "m1:dev-a:held:000000004"];
  const p = pendingByMatch(keys, "dev-a"), h = heldByMatch(keys, "dev-a");
  ok("a Pilot Match's outbox is counted by its id", p.get("pilot-x") === 2);
  ok("held keys are counted apart, this device's only", h.get("pilot-x") === 1 && h.get("m1") === 1);
  ok("meta and sent keys are neither", !p.has("m1"));
}

group("Pilot Matches: finished ones are kept as a sandbox; nothing promotes");
{
  const phone = [
    { id: "pilot-11111111-1111-4111-8111-111111111111", title: "A v B", complete: true, savedAt: NOW - 1e3, lines: [{ team: "A", runs: 84, wickets: 3, balls: 72 }] },
    { id: "pilot-22222222-2222-4222-8222-222222222222", title: "C v D", complete: false, savedAt: NOW },
  ];
  const server = [
    { id: "11111111-1111-4111-8111-111111111111", status: "finished", sides: [{ display_name: "A" }, { display_name: "B" }] },
    { id: "33333333-3333-4333-8333-333333333333", status: "abandoned", endedAt: new Date(NOW - 5e3).toISOString(), sides: [{ display_name: "E" }, { display_name: "F" }] },
    { id: "44444444-4444-4444-8444-444444444444", status: "live", sides: [{ display_name: "G" }, { display_name: "H" }] },
  ];
  const rows = finishedPilots(phone, server, pilotUuid);
  ok("the phone's finished match, and the server's abandoned one it lacks; not the one in progress, not a live one",
    rows.map((r) => r.title).join() === "A v B,E v F", rows.map((r) => r.title));
  ok("one row per match: the server's copy of a phone's match is not drawn twice", rows.filter((r) => r.title === "A v B").length === 1);
  ok("the phone's opens; the server's says where it is", rows[0].onPhone === true && rows[1].onPhone === false);
  ok("its own score, from its own log", scoreLine(rows[0].lines[0]) === "A 84/3 (12.0 ov)");
  ok("with the server unread, the phone's alone", finishedPilots(phone, null, pilotUuid).length === 1);
  ok("a match the server called off is drawn called off", finishedPilots(phone, [{ ...server[0], status: "abandoned" }], pilotUuid)[0].status === "abandoned");
  ok("...and one called off on this phone, not yet heard back", finishedPilots([{ ...phone[0], meta: { pilot: { callOff: { code: "weather", at: NOW } } } }], null, pilotUuid)[0].status === "abandoned");
  ok("...a plain finish is finished", rows[0].status === "finished");
  ok("three words, the server's status first: In progress, Finished, Called off",
    pilotStateWords({ serverStatus: "live" }) === "In progress" && pilotStateWords({ serverStatus: "finished" }) === "Finished"
    && pilotStateWords({ serverStatus: "abandoned", complete: true }) === "Called off");
  ok("...then this phone's: a call-off made here, then the pad's own end",
    pilotStateWords({ meta: { pilot: { callOff: { code: "light" } } }, complete: true }) === "Called off"
    && pilotStateWords({ complete: true }) === "Finished" && pilotStateWords({}) === "In progress");
  ok("the stop's reason is kept as the server's code", abandonCode("rain") === "weather" && abandonCode("bad_light") === "light"
    && abandonCode("wet_ground") === "ground" && abandonCode("other") === "other" && abandonCode(undefined) === "other");
  ok("the words: kept as a sandbox, counted in no figure", /sandbox/.test(SANDBOX_WORDS.kept) && /no figure, standing or record/.test(SANDBOX_WORDS.why));
  ok("nothing finished: the empty state says what a finished one will be", /No finished Pilot Match yet/.test(SANDBOX_WORDS.empty));
  const view = readFileSync(new URL("../src/views/ScorerHomeView.jsx", import.meta.url), "utf8");
  ok("the screen has no promote action (promotion is R1)", !/promot/i.test(view.replace(/\/\/.*$|\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}/gm, "")));
  ok("...and no sponsor slot: a work mode (§7.1)", !/sponsor/i.test(view.replace(/\/\/.*$|\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}/gm, "")));
  ok("...and no KPI tile", !/KPICard|kpi/i.test(view));
  ok("...and the board is the one Board component", /import \{ Board \} from "\.\.\/ui\/board\.jsx"/.test(view));
}

group("This week: the next seven days of his list");
{
  const at = (days, o = {}) => ({ match: { id: `d${days}`, status: "upcoming", startsAt: new Date(NOW + days * 864e5).toISOString(), ...o }, state: "not_started" });
  const items = [at(6), at(0), at(7), at(13), { match: { id: "live", status: "live", startsAt: new Date(NOW - 30 * 864e5).toISOString() }, state: "live" },
                 { match: { id: "nodate", status: "upcoming" }, state: "not_started" }];
  const { week, later } = weekOf({ items, shown: items }, NOW);
  ok(`within ${WEEK_DAYS} SA days, a live one whenever it started, one with no date (it says so)`,
    week.map((i) => i.match.id).join() === "d6,d0,live,nodate", week.map((i) => i.match.id));
  ok("the rest are counted, for the Match Centre", later === 2, later);
  ok("his order is kept (appointed first, as lib/scorerHome.js sorted it)", week[0].match.id === "d6");
  ok("none: none", weekOf({ items: [], shown: [] }, NOW).week.length === 0);
}

group("Start: the pad's own setup, its words from what SCRBRD said");
{
  ok("granted and switched on: Start Pilot Match, sent live, team names only in public",
    startWords({ sync: true, granted: true }).action === "Start Pilot Match" && /score and team names only/.test(startWords({ sync: true, granted: true }).note));
  ok("switched off (as shipped): a Practice Match, and it says it stays on this phone",
    startWords({ sync: false, granted: false }).action === "Start Practice Match" && /stays on this phone/.test(startWords({ sync: false }).note));
  ok("not granted: says so", startWords({ sync: true, granted: false }).state === "not_granted" && /can't send/.test(startWords({ sync: true, granted: false }).note));
  ok("never asked and nothing remembered: not assumed", startWords(null).state === "unknown" && startWords(null).action === "Start Practice Match");
  ok("still asking: says so", startWords(null, true).state === "loading" && /Checking/.test(startWords(null, true).note));
  ok("every state says what the setup asks: venue, both sides, their players", ["pilot", "off", "unknown"].every((k) =>
    /Venue/.test(startWords(k === "pilot" ? { sync: true, granted: true } : k === "off" ? { sync: false } : null).note)));
}

console.log(`\n${"─".repeat(52)}\nSCORER DAY: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
