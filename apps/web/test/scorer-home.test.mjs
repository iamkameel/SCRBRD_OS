/**
 * The scorer's home (GA-I13): who lands on it, which fixtures it lists and in
 * what order (appointed first, then the side's others, by start), the state
 * each one is in for this device, what this device has to resume, and the
 * lines before the toss. Hand-built fixtures, no DOM, no database, no clock
 * (the clock is passed in).
 *
 * The browser walk (tools/smoke-browser-scorer-home.mjs) holds the screen to this.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/scorer-home.test.mjs
 */
import { readFileSync } from "node:fs";
import { ROLES, roleGrants } from "@scrbrd/policy/roles";
import {
  SHOWN, STATE_WORDS, appointmentOf, fixtureState, isTodayOrNext, mayScore, nextToPrepare, pendingWords,
  prepLines, resumeItems, saDay, scorerFixtures, scorerLanding,
} from "../src/lib/scorerHome.js";
import { pendingByMatch } from "../src/lib/deviceMatches.js";
import { combineReads, readState } from "../src/lib/readState.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil", KES = "kes";
const ME = "user-me", OTHER = "user-other";
const NOW = Date.parse("2026-10-08T06:00:00Z");              // Thursday 08:00 SA
const at = (iso, o = {}) => ({ id: o.id ?? iso, schoolId: HIL, homeTeam: "1XI", awayTeam: "Kearsney", status: "upcoming",
                                startsAt: `${iso}.000Z`, date: iso.slice(0, 10), time: iso.slice(11, 16), live: true, ...o });
const A = (role, school, team = null, o = {}) => ({ role, school, team, ...o });

group("Who lands on it: by capability, the scorer's bundle alone");
{
  const lands = (roles) => scorerLanding((cap) => roles.some((r) => roleGrants(r, cap)));
  ok("a scorer lands on it", lands(["scorer"]));
  for (const r of ["coach", "assistantcoach", "sportsadmin", "directorofsport", "superadmin"]) {
    ok(`${r}, who also scores, keeps the day sheet`, !lands([r]), r);
  }
  ok("a scorer who also coaches keeps the day sheet (the roles held are asked)", !lands(["scorer", "coach"]));
  ok("a role that cannot score never lands on it", !lands(["official"]) && !lands(["player"]) && !lands(["guardian"]));
  const landing = ROLES.filter((r) => lands([r]));
  ok("of every role today, only the scorer lands on it", JSON.stringify(landing) === JSON.stringify(["scorer"]), landing);
}

group("Which fixtures he may score: the home side, as scoring_claim() asks");
{
  const m = at("2026-10-10T08:00:00", { id: "m" });
  ok("a school-wide scorer at the home school", mayScore([A("scorer", HIL)], m));
  ok("a scorer on the side", mayScore([A("scorer", HIL, "1XI")], m));
  ok("not a scorer on another side", !mayScore([A("scorer", HIL, "U16B")], m));
  ok("not a scorer at another school", !mayScore([A("scorer", KES)], m));
  ok("a scorer narrowed to this fixture", mayScore([A("scorer", HIL, null, { fixture: "m" })], m));
  ok("not one narrowed to another fixture", !mayScore([A("scorer", HIL, null, { fixture: "other" })], m));
  ok("not a role that cannot start scoring (an official on the fixture)", !mayScore([A("official", HIL, null, { fixture: "m" })], m));
  ok("not an assignment about a person", !mayScore([A("scorer", HIL, null, { subjects: ["p1"] })], m));
  ok("no assignments, nothing", !mayScore([], m) && !mayScore(null, m));
  ok("the away side's scorer is not offered the home side's claim",
    !mayScore([A("scorer", KES, "1XI")], { ...m, awaySchoolId: KES, awayTeamCode: "1XI" }));
}

group("His appointment: a scorer duty naming him, or an assignment narrowed to the fixture");
{
  const m = at("2026-10-10T08:00:00", { id: "m" });
  const duty = { matchId: "m", duty: "scorer", personId: ME, appointedAt: "2026-10-01T09:00:00Z", panel: "KZN", suspended: false };
  const a1 = appointmentOf(m, { officials: [duty], userId: ME });
  ok("a scorer duty naming him is an appointment", a1?.byDuty === true && a1.appointedAt === "2026-10-01" && !a1.paused, a1);
  ok("another person's scorer duty is not his", appointmentOf(m, { officials: [{ ...duty, personId: OTHER }], userId: ME }) === null);
  ok("an umpire duty naming him is not a scoring appointment", appointmentOf(m, { officials: [{ ...duty, duty: "umpire" }], userId: ME }) === null);
  ok("a duty on another fixture is not this one's", appointmentOf(m, { officials: [{ ...duty, matchId: "x" }], userId: ME }) === null);
  const a2 = appointmentOf(m, { assignments: [A("scorer", HIL, null, { fixture: "m" })], userId: ME });
  ok("an assignment narrowed to the fixture is an appointment", a2?.byAssignment === true && a2.byDuty === false, a2);
  ok("a team-wide assignment is not an appointment", appointmentOf(m, { assignments: [A("scorer", HIL, "1XI")], userId: ME }) === null);
  const a3 = appointmentOf(m, { officials: [{ ...duty, suspended: true }], userId: ME });
  ok("a paused duty says it is paused, and carries no reason", a3?.paused === true && !("reason" in a3), a3);
  ok("signed out (no user), no duty is his", appointmentOf(m, { officials: [duty], userId: null }) === null);
}

group("Today and next");
{
  ok("live, whenever it started", isTodayOrNext(at("2026-10-01T08:00:00", { status: "live" }), NOW));
  ok("still to be played today", isTodayOrNext(at("2026-10-08T12:00:00"), NOW));
  ok("earlier today, not yet started, is still today's", isTodayOrNext(at("2026-10-07T23:00:00"), NOW), saDay(Date.parse("2026-10-07T23:00:00Z")));
  ok("scheduled on an earlier day and never played is not", !isTodayOrNext(at("2026-10-06T08:00:00"), NOW));
  ok("finished today is", isTodayOrNext(at("2026-10-08T05:00:00", { status: "complete" }), NOW));
  ok("finished on an earlier day is not", !isTodayOrNext(at("2026-10-01T08:00:00", { status: "complete" }), NOW));
  ok("next week is", isTodayOrNext(at("2026-10-15T08:00:00"), NOW));
}

group("The state a scorer acts on, per fixture");
{
  const up = at("2026-10-10T08:00:00");
  const live = { ...up, status: "live" };
  ok("no session: not started", fixtureState(up, null) === "not_started");
  ok("an idle session: not started", fixtureState(up, { state: "idle", held: null }) === "not_started");
  ok("this device holds it", fixtureState(live, { state: "active", held: "this_device" }) === "held_here");
  ok("his other device holds it", fixtureState(live, { state: "active", held: "you" }) === "held_you");
  ok("another device holds it", fixtureState(live, { state: "active", held: "another" }) === "held_other");
  ok("a lapsed lease: nobody is scoring now", fixtureState(live, { state: "active", held: "lapsed" }) === "lapsed");
  ok("an armed handover", fixtureState(live, { state: "handover_pending", held: "another" }) === "handover");
  ok("a takeover being verified", fixtureState(live, { state: "verifying", held: "another" }) === "handover");
  ok("live, no session read to say more", fixtureState(live, null) === "live");
  ok("complete, whatever the session", fixtureState({ ...up, status: "complete" }, { state: "active", held: "this_device" }) === "complete");
  ok("every state has its words", ["not_started", "held_here", "held_you", "held_other", "handover", "lapsed", "live", "complete"].every((s) => STATE_WORDS[s]?.label));
  ok("held by another device: the pad (and its take-over) is the route, never a claim from here",
    STATE_WORDS.held_other.action === "Open the pad" && /hands over/.test(STATE_WORDS.held_other.note));
  ok("complete offers no scoring", STATE_WORDS.complete.action === null);
}

group("The list: appointed first, then the side's other fixtures, each by start");
{
  const sat = at("2026-10-10T08:00:00", { id: "sat" });
  const fri = at("2026-10-09T12:00:00", { id: "fri" });
  const nextSat = at("2026-10-17T08:00:00", { id: "next-sat" });
  const tue = at("2026-10-13T12:00:00", { id: "tue" });
  const u16 = at("2026-10-09T08:00:00", { id: "u16", homeTeam: "U16B" });
  const played = at("2026-10-01T08:00:00", { id: "played", status: "complete" });
  const assignments = [A("scorer", HIL, "1XI"), A("scorer", HIL, null, { fixture: "tue" })];
  const officials = [{ matchId: "next-sat", duty: "scorer", personId: ME, appointedAt: "2026-10-02", suspended: false }];
  const coverage = new Map([
    ["sat", { rows: [{ duty: "scoring", state: "active", held: "another" }], error: null }],
    ["fri", { rows: [], error: "unreachable" }],
  ]);
  const r = scorerFixtures({ matches: [sat, fri, nextSat, tue, u16, played], assignments, officials, userId: ME, coverage, now: NOW });
  const order = r.items.map((i) => i.match.id);
  ok("appointed first, by start; then the side's, by start", order.join() === "tue,next-sat,fri,sat", order);
  ok("the appointment is shown on the appointed ones only", r.items.map((i) => i.group).join() === "appointed,appointed,team,team");
  ok("by duty and by assignment both count", r.items[0].appointment?.byAssignment && r.items[1].appointment?.byDuty);
  ok("another side's fixture is not listed (he may not score it)", !order.includes("u16"));
  ok("an earlier day's played fixture is not listed", !order.includes("played"));
  ok("the session read decides the state", r.items.find((i) => i.match.id === "sat").state === "held_other");
  ok("a fixture whose roster read failed says so, and is still listed as not started",
    r.items.find((i) => i.match.id === "fri").sessionError && r.items.find((i) => i.match.id === "fri").state === "not_started");
  ok("the next to prepare is the first not started in that order", nextToPrepare(r.items)?.match.id === "tue");

  const many = Array.from({ length: SHOWN + 3 }, (_, i) => at(`2026-10-${String(10 + i).padStart(2, "0")}T08:00:00`, { id: `f${i}` }));
  const big = scorerFixtures({ matches: many, assignments: [A("scorer", HIL)], now: NOW });
  ok(`${SHOWN} drawn, the rest counted`, big.shown.length === SHOWN && big.later === 3, [big.shown.length, big.later]);

  const demo = scorerFixtures({ matches: [sat, u16], assignments: null, now: NOW });
  ok("the demonstration lists the client-scoped fixtures as they are, nobody appointed",
    demo.items.length === 2 && demo.items.every((i) => i.group === "team" && i.appointment === null));
  ok("no fixtures, an empty list", scorerFixtures({ matches: [], assignments, now: NOW }).items.length === 0);
}

group("Resume: what this device is mid-way through");
{
  const cfg = (id) => ({ matchId: id, team1: "1XI", team2: "Michaelhouse", overs: 20, live: true, startsAt: "2026-10-08T08:00:00Z", format: "T20" });
  const ev = [[{ id: "e1" }], []];
  const saved = [
    { matchId: "a", cfg: cfg("a"), events: ev, savedAt: 100 },                        // scored, 3 to send
    { matchId: "b", cfg: cfg("b"), events: ev, savedAt: 300 },                        // scored, all sent, not finished
    { matchId: "c", cfg: cfg("c"), events: ev, savedAt: 200, serverHas: [1, 0] },     // finished, cleared
    { matchId: "d", cfg: { ...cfg("d"), live: false }, events: ev, savedAt: 400 },    // the demonstration's
    { matchId: "e", cfg: cfg("e"), events: [[], []], savedAt: 500 },                 // nothing scored
    { matchId: "f", cfg: cfg("f"), events: ev, savedAt: 50, serverHas: [1, 0] },      // finished, 2 still to send
  ];
  const pending = new Map([["a", 3], ["b", 0], ["c", 0], ["d", 5], ["e", 0], ["f", 2]]);
  const offline = resumeItems({ saved, pending, serverMatches: null });
  ok("listed: scored and unsent, scored and unfinished, finished but still to send; newest save first",
    offline.map((r) => r.matchId).join() === "b,a,f", offline.map((r) => r.matchId));
  ok("the unsent events are counted", offline.find((r) => r.matchId === "a").pending === 3);
  ok("a finished match whose outbox is empty is not offered", !offline.some((r) => r.matchId === "c"));
  ok("a demonstration log and a log with nothing in it are not offered", !offline.some((r) => r.matchId === "d" || r.matchId === "e"));
  ok("with no server to ask, it opens from the sides saved with the log (SCRBRD-078)",
    offline.every((r) => r.openable) && offline[0].match.id === "b" && offline[0].match.homeTeam === "1XI" && offline[0].match.live === true);

  const server = [{ id: "a", homeTeam: "1XI", awayTeam: "Michaelhouse", status: "live", live: true },
                  { id: "b", homeTeam: "1XI", awayTeam: "Michaelhouse", status: "complete", live: true }];
  const online = resumeItems({ saved, pending, serverMatches: server });
  ok("the server's complete fixture with nothing to send is not offered", !online.some((r) => r.matchId === "b"));
  ok("the server's row is what opens it", online.find((r) => r.matchId === "a").match.status === "live");
  const f = online.find((r) => r.matchId === "f");
  ok("a fixture the server no longer lists him is shown, with no door back into it", f && f.openable === false && f.match === null, f);
  const unknown = resumeItems({ saved: [saved[1]], pending: new Map([["b", null]]), serverMatches: null });
  ok("an outbox that could not be read is not 'nothing to send'", unknown[0]?.pending === null && /Could not/.test(pendingWords(null)));
  ok("the words: 3 to send, nothing waiting", pendingWords(3) === "3 to send" && pendingWords(0) === "Nothing waiting to send");
  ok("a practice id never reaches here (its log is under practice:)", resumeItems({ saved: [], pending: new Map(), serverMatches: null }).length === 0);
}

group("The outbox count: this device's events, per match");
{
  const keys = ["m1:dev-a:evt:000000001", "m1:dev-a:evt:000000002", "m1:dev-a:meta", "m1:dev-a:sent:k1",
                "m1:dev-b:evt:000000001", "m2:dev-a:evt:000000004", "m2:dev-a:held:000000003"];
  const n = pendingByMatch(keys, "dev-a");
  ok("events only, this device only", n.get("m1") === 2 && n.get("m2") === 1 && n.size === 2, [...n]);
}

group("Before the toss: each line from a read that exists, with who fixes it");
{
  const comp = at("2026-10-10T08:00:00", { id: "p", venue: "Hilton Oval", competitionId: "c1" });
  const duties = [{ duty: "squad", detail: "13 selected" }, { duty: "umpire" }, { duty: "umpire" }, { duty: "scoring", state: "idle" }];
  const all = prepLines({ match: comp, duties, fold: { conditions: { a: 1 }, conditionsTitle: "KZN Schools T20", conditionsVersion: 2 } });
  const by = Object.fromEntries(all.map((l) => [l.key, l]));
  ok("five lines, in order", all.map((l) => l.key).join() === "squad,umpires,ground,pitch,conditions");
  ok("the team sheet is a count, never a name", by.squad.state === "ok" && by.squad.text === "13 selected");
  ok("umpires named", by.umpires.state === "ok" && by.umpires.text === "2 named");
  ok("the ground", by.ground.state === "ok" && by.ground.text === "Hilton Oval");
  ok("no pitch report: missing, and the groundsman sets it", by.pitch.state === "missing" && by.pitch.who === "the groundsman");
  ok("the conditions, by title and version", by.conditions.state === "ok" && by.conditions.text === "KZN Schools T20, version 2", by.conditions);

  const bare = prepLines({ match: { ...comp, venue: null }, duties: [], fold: { conditions: null } });
  const b = Object.fromEntries(bare.map((l) => [l.key, l]));
  ok("no team sheet: the coach", b.squad.state === "missing" && b.squad.who === "the coach");
  ok("no umpire: the school office", b.umpires.state === "missing" && b.umpires.who === "the school office");
  ok("no ground: the school office", b.ground.state === "missing" && b.ground.who === "the school office");
  const unnamed = prepLines({ match: { ...comp, venue: null, hasGround: true }, duties, fold: { conditions: null } }).find((l) => l.key === "ground");
  ok("a ground set whose name he may not read (no facility.read) is not 'missing'", unnamed.state === "ok" && unnamed.text === "Set on the fixture", unnamed);
  ok("no conditions published: the league organiser", b.conditions.state === "missing" && b.conditions.who === "the league organiser");

  const friendly = prepLines({ match: { ...comp, competitionId: null }, duties, fold: undefined });
  ok("a friendly needs no published conditions", friendly.find((l) => l.key === "conditions").state === "ok");

  const failed = prepLines({ match: comp, duties: null, fold: null });
  const f = Object.fromEntries(failed.map((l) => [l.key, l]));
  ok("a roster read that failed is never 'missing'", ["squad", "umpires", "pitch"].every((k) => f[k].state === "unknown" && /^Could not read/.test(f[k].text) && f[k].who === null), failed);
  ok("a conditions read that failed is never 'missing'", f.conditions.state === "unknown");
  ok("the fixture's own ground still answers", f.ground.state === "ok");
  ok("conditions still coming say so", prepLines({ match: comp, duties, fold: undefined }).find((l) => l.key === "conditions").state === "loading");
}

group("The read states the screen draws (GA-I08)");
{
  const fixtures = { rows: [{ id: "x" }], live: true, loading: false, error: null };
  const officialsFailed = { rows: [], live: false, loading: false, error: "unreachable", status: null };
  const c = combineReads([{ what: "your fixtures", read: fixtures }, { what: "your appointments", read: officialsFailed }]);
  ok("fixtures answered, appointments failed: partial, and it says what", c.state === "partial" && /your appointments/.test(c.sentence) && c.retry);
  const off = combineReads([{ what: "your fixtures", read: fixtures }, { what: "your appointments", read: { rows: [], live: true, loading: false, error: null, disabled: "officials" } }]);
  ok("the officials module switched off is not a failure", off.state === "ok");
  const failedAll = combineReads([{ what: "your fixtures", read: { rows: [], error: "unreachable" } }, { what: "your appointments", read: fixtures }]);
  ok("the fixtures failing is said, with a retry", failedAll.state === "partial" || failedAll.state === "failed");
  const forbidden = readState({ rows: [], error: "forbidden", status: 403 }, { what: "your fixtures" });
  ok("a refusal is forbidden, not empty and not failed, with no retry", forbidden.state === "forbidden" && !forbidden.retry);
  const stale = readState({ rows: ["a"], observedAt: NOW - 3 * 60e3 }, { what: "who is scoring each match", maxAgeMs: 2 * 60e3, now: NOW });
  ok("the sessions read older than two minutes is stale, with a retry", stale.state === "stale" && stale.retry && /3 minutes ago/.test(stale.sentence), stale);
}

group("The screen: no child named, the floors, practice left to the pad");
{
  const view = readFileSync(new URL("../src/views/ScorerHomeView.jsx", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src/lib/scorerHome.js", import.meta.url), "utf8");
  const reads = [...view.matchAll(/useLive\("([a-z_]+)"/g)].map((m) => m[1]);
  ok("it reads the fixtures and the officials, and nothing about a child", JSON.stringify(reads) === JSON.stringify(["matches", "officials"]), reads);
  ok("no roster, availability, readiness, squad or player read", !/players|readiness|availability|match_squad|roster_on|injur/.test(view + lib));
  ok("a practice match is never read here: its store is the pad's, which offers it with its PracticeLabel",
    !/from\s+["'][^"']*(practice|practiceLabel)(\.jsx?)?["']/.test(view + lib) && /onClick=\{\(\) => open\(null\)\}/.test(view));
  ok("every button is 44px tall at least", /minHeight: "44px"/.test(view) && !/<Btn\b/.test(view));
  ok("nothing set under 12px", ![...view.matchAll(/fontSize:\s*"(\d+)px"/g)].some((m) => Number(m[1]) < 12));
  ok("no motion of its own (nothing for reduced motion to stop)", !/transition|animation|@keyframes/.test(view));
  ok("the claim is never made from here", !/session\/claim|claimHandover|armHandover/.test(view + lib));
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("the landing is chosen by capability, from the roles held", /scorerLanding\(\(cap\) => holdsAsHeld\(role, cap\)\)/.test(app));
  ok("the view is lazy (its own chunk)", /view\(\(\) => import\("\.\/views\/ScorerHomeView\.jsx"\)/.test(app));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
