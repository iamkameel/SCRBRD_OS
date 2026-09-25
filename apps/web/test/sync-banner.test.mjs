/**
 * SCRBRD-078. What a live pad says about the server, in words.
 *
 * The pad cannot always send: no signal, signed out, a colleague scoring, a
 * handover waiting, a fork. Each used to be "On device" with the reason in a
 * tooltip, or nothing; each now gets a sentence and the one action that
 * answers it — and none of them offers a way round the server. This renders
 * the banner from PadSync-shaped status objects and reads the words a scorer
 * sees. The browser walk (smoke-browser-offline-day) drives the real pad.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/sync-banner.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SyncBanner, bannerFor } from "../src/scorer/syncBanner.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);
const text = (el) => renderToStaticMarkup(el).replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const ball = { payload: { kind: "ball" } };
const bowlerEv = { payload: { kind: "bowler" } };
const base = { open: true, attached: false, online: true, signedIn: false, pending: 0, pendingList: [], held: 0, rejected: 0, conflict: null, reconcile: null };
const st = (o) => ({ ...base, ...o, pending: (o.pendingList ?? []).length });
const MATCH = { team1: "1XI", team2: "Michaelhouse" };
const render = (s, extra = {}) => text(h(SyncBanner, { status: s, match: MATCH, onSignIn() {}, onRetry() {}, onScoreHere() {}, onTakeOver() {}, ...extra }));

group("A. Signed out: the count, and the real sign-in (never the demo)");
{
  const s = st({ reason: "not_signed_in", pendingList: [ball, ball, ball, ball, bowlerEv] });
  const out = render(s);
  ok("says how much is waiting", /Sign in to send 4 balls and 1 other change/.test(out), out);
  ok("...that it is saved on this device", /saved on this device/.test(out), out);
  ok("...and offers the sign-in", /data-testid="sync-signin"/.test(renderToStaticMarkup(h(SyncBanner, { status: s, match: MATCH, onSignIn() {} }))), out);
  ok("...only when there is a way to it", !/sync-signin/.test(renderToStaticMarkup(h(SyncBanner, { status: s, match: MATCH, onSignIn: null }))));
  ok("never offers a demo, or anything but the server", !/demo|continue anyway|without signing/i.test(out), out);
  const off = render(st({ reason: "not_signed_in", online: false, pendingList: [ball] }));
  ok("with no signal it says so, and offers no sign-in it cannot do", /No signal, and signed out/.test(off) && !/Sign in to send/.test(off), off);
  const expired = render(st({ reason: "session_expired", attached: true, pendingList: [ball, ball] }));
  ok("a session that ended mid-match says so too", /Your session has ended\. Sign in to send 2 balls/.test(expired), expired);
  ok("one ball is one", /Sign in to send 1 ball —/.test(render(st({ reason: "not_signed_in", pendingList: [ball] }))));
}

group("B. Refusals, each in words, with the action that answers it");
{
  const lease = render(st({ reason: "lease_active", pendingList: [ball] }));
  ok("someone else is scoring", /Someone else is scoring this match on another device right now/.test(lease) && /Try again/.test(lease), lease);
  const hp = render(st({ reason: "handover_pending" }));
  ok("a handover is waiting: take over", /A handover is waiting/.test(hp) && /Take over/.test(hp), hp);
  const mc = render(st({ reason: "match_complete" }));
  ok("the match is complete", /This match is complete/.test(mc), mc);
  const fork = render(st({ reason: "fork", reconcile: { state: "fork", extra: ["a", "b"], mine: ["c"] } }));
  ok("a fork: counts on both sides, nothing merged", /server has 2 events this device does not/.test(fork) && /1 the server does not/.test(fork) && /Nothing is merged/.test(fork), fork);
  const moved = render(st({ reason: "moved_on" }));
  ok("moved on: score here is a person's choice", /Another device has scored this match since/.test(moved) && /Score on this device/.test(moved), moved);
  const gone = render(st({ reason: "token_moved", attached: false, pendingList: [ball, ball] }));
  ok("the token moved: what is kept here", /Another device has taken over scoring/.test(gone) && /2 balls are saved on this device/.test(gone), gone);
}

group("C. The toss, and what is sent");
{
  const conflict = render(st({ reason: "toss_conflict", attached: true, conflict: {
    reason: "toss_conflict", mine: { wonBy: "home", decision: "bat" }, server: { wonBy: "away", decision: "bat" }, serverHasEvents: false } }));
  ok("a toss conflict names both tosses", /Michaelhouse won the toss and chose to bat/.test(conflict) && /1XI won the toss and chose to bat/.test(conflict), conflict);
  ok("...and that nothing more is sent until a person settles it", /Nothing more is sent from this device until a person settles/.test(conflict), conflict);
  const followed = render(st({ attached: true, reason: null, conflict: {
    reason: "toss_followed", mine: { wonBy: "home", decision: "bat" }, server: { wonBy: "away", decision: "bowl" } } }));
  ok("a toss followed is said, as a note", /The server already had a toss/.test(followed) && /now follows it/.test(followed), followed);
  const review = render(st({ attached: true, reason: null, rejected: 2 }));
  ok("quarantined events are named, not called sent", /2 events were held by the server for review/.test(review), review);
  ok("attached and sending: nothing to say", bannerFor(st({ attached: true, reason: null }), MATCH) === null);
  ok("not open yet: nothing to say", bannerFor({ open: false }, MATCH) === null);
}

console.log(`\n${"─".repeat(52)}\nSYNC BANNER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
