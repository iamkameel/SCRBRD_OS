#!/usr/bin/env node
/**
 * The follow list's screens (EXPERIENCE_PASS Q8, §2.4, §3.8; db/160), with no
 * server: the public page's offer (an offer at a pause, a plain link, a
 * published school on SCRBRD only, named without its team), the app's hint
 * (a school code and nothing else), and the Followed schools block (team
 * facts, the home page's sentence, live first, "Stop following" at the floor).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/follow.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FollowOffer, FOLLOW_PAUSES, followable, schoolOfSide } from "../src/public/followOffer.jsx";
import { followAsked, followProblem } from "../src/lib/follow.js";
import { FollowedSchools } from "../src/follow/Followed.jsx";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, typeof d === "string" ? d : JSON.stringify(d)); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const HEADER = { homeLabel: "Hilton College 1XI", homeCode: "HIL", homeTeam: "1XI", awayLabel: "Westville Boys' High 1XI", awayCode: "WES",
  awayTeam: "1XI", awayOnPlatform: true, published: { home: true, away: false } };

group("A. The offer on the public page (§2.4 step 2)");
{
  ok("drawn at the pauses alone: the innings break and the result", JSON.stringify(FOLLOW_PAUSES) === '["innings_break","result","complete"]');
  for (const st of ["first_innings", "chase", "upcoming", "toss", "abandoned", "postponed", "super_over"])
    ok(`not drawn while ${st}`, renderToStaticMarkup(h(FollowOffer, { header: HEADER, state: st })) === "");
  const html = renderToStaticMarkup(h(FollowOffer, { header: HEADER, state: "innings_break" }));
  ok("at the break: Follow Hilton College's matches", /Follow Hilton College(&#x27;|')s matches/.test(html), html);
  ok("...a plain link to the app with the school's code, nofollow", /href="\/app\?follow=HIL"/.test(html) && /rel="nofollow"/.test(html));
  ok("...not the side that did not publish", !/WES|Westville/.test(html), html);
  ok("...and no form, no button, no field: an offer, never a wall", !/<(form|button|input)/.test(html));
  const both = followable({ ...HEADER, published: { home: true, away: true } });
  ok("both published: both schools, each without its team", JSON.stringify(both) === JSON.stringify([{ code: "HIL", name: "Hilton College" }, { code: "WES", name: "Westville Boys' High" }]), both);
  ok("a typed opponent off SCRBRD is never offered", followable({ ...HEADER, awayOnPlatform: false, awayCode: null, published: { home: false, away: true } }).length === 0);
  ok("nothing published, nothing offered; no header, nothing", followable({ ...HEADER, published: { home: false, away: false } }).length === 0 && followable(null).length === 0);
  ok("a code that is not one is not linked", followable({ ...HEADER, homeCode: "HIL\"><script>" }).length === 0);
  ok("the school's name without the team", schoolOfSide("Hilton College 1XI", "1XI") === "Hilton College" && schoolOfSide("Hilton College", "1XI") === "Hilton College"
     && schoolOfSide("St Andrew's College U15A", "u15a") === "St Andrew's College");
  ok("...and a name ending in s takes the apostrophe alone",
     /Follow St Johns(&#x27;|') matches/.test(renderToStaticMarkup(h(FollowOffer, { header: { ...HEADER, homeLabel: "St Johns 1XI" }, state: "result" }))));
}

group("B. The app's hint: a school code, nothing else");
{
  ok("?follow=HIL reads HIL", followAsked("?follow=HIL") === "HIL");
  ok("...and verify-051", followAsked("?door=parent&follow=verify-051") === "verify-051");
  for (const bad of ["", "?follow=", "?follow=%3Cscript%3E", "?follow=a%20b", `?follow=${"x".repeat(40)}`, "?other=HIL"])
    ok(`${JSON.stringify(bad)} is no hint`, followAsked(bad) === null);
  ok("a refusal is said in words, never a code", ["no_such_school", "too_many", "boom"].every((c) => !/_/.test(followProblem({ code: c, status: 409 })))
     && /fifty/.test(followProblem({ code: "too_many" })));
}

group("C. The Followed schools block");
{
  const base = { loading: false, failed: false, note: null, live: false, unfollow: async () => true, reload() {} };
  const none = renderToStaticMarkup(h(FollowedSchools, { followed: { ...base, schools: [], data: { asOf: "2026-11-15", fixtures: [] } } }));
  ok("following nothing: one line says what will show", /data-testid="followed-none"/.test(none) && /Follow a school from one of its match pages/.test(none), none);
  const schools = [{ id: "s1", code: "HIL", name: "Hilton College", since: "2026-11-15" }];
  const fx = (id, status, extra = {}) => ({ id, status, home: { label: "Hilton College", code: "1XI" }, away: { label: "Westville Boys' High", code: "1XI", onPlatform: true },
    overs: 20, startsAt: "2026-11-15T08:00:00Z", scores: [], result: null, target: null, revised: false, ...extra });
  const fixtures = [
    fx("done", "complete", { result: "Hilton College 1XI won by 6 wickets", scores: [{ innings: 0, runs: 140, wickets: 9, balls: 120, side: "away" }, { innings: 1, runs: 141, wickets: 4, balls: 100, side: "home" }] }),
    fx("later", "scheduled"),
    fx("now", "live", { target: 142, scores: [{ innings: 0, runs: 141, wickets: 6, balls: 120, side: "home" }, { innings: 1, runs: 97, wickets: 3, balls: 86, side: "away" }] })];
  const html = renderToStaticMarkup(h(FollowedSchools, { followed: { ...base, live: true, schools, data: { asOf: "2026-11-15", fixtures } }, lead: true }));
  const order = [...html.matchAll(/data-testid="followed-card" data-status="([a-z]+)"/g)].map((m) => m[1]);
  ok("live first, then today's, then results", JSON.stringify(order) === '["live","scheduled","complete"]', order);
  ok("the live card says the home page's sentence, from the read's target", /Westville Boys(&#x27;|')s? High 1XI need 45 off 34/.test(html), html);
  ok("...links to the match's public page", /href="\/live\/now"/.test(html) && /href="\/scorecard\/done"/.test(html));
  ok("...and a lead block is marked so", /data-lead=""/.test(html));
  ok("each school has Stop following, a button at the floor", /data-testid="unfollow-HIL"/.test(html) && /min-height:44px/.test(html) && /Stop following/.test(html));
  ok("no type under 12px", [...html.matchAll(/font-size:(\d+)px/g)].every((m) => Number(m[1]) >= 12));
  const quiet = renderToStaticMarkup(h(FollowedSchools, { followed: { ...base, schools, data: { asOf: "2026-11-15", fixtures: [] } } }));
  ok("following, nothing today: said in one line", /data-testid="followed-quiet"/.test(quiet));
  const off = renderToStaticMarkup(h(FollowedSchools, { followed: { ...base, schools, data: { asOf: null, fixtures: null } } }));
  ok("public pages off: said so, nothing guessed", /data-testid="followed-off"/.test(off) && !/followed-card/.test(off));
  const told = renderToStaticMarkup(h(FollowedSchools, { followed: { ...base, schools, note: { name: "Hilton College" }, data: { asOf: "2026-11-15", fixtures: [] } } }));
  ok("a follow from a match page is said once: You follow Hilton College", /You follow Hilton College/.test(told));
  ok("loading draws nothing", renderToStaticMarkup(h(FollowedSchools, { followed: { ...base, loading: true, schools: [], data: null } })) === "");
}

console.log(`\n${"─".repeat(52)}\nFOLLOW SCREENS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
