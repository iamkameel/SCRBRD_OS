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

group("D. The pad's resume credential (SCRBRD-078 option B)");
{
  const ended = render(st({ reason: "pad_ended", padEnd: "released", pendingList: [ball, ball, ball] }));
  ok("its end is one clear line", /Scoring ended for today on this phone — sign in to continue\./.test(ended), ended);
  ok("...with why, as the server said", /A supervisor released this match from this phone/.test(ended), ended);
  ok("...what is still saved here", /3 balls are saved on this device/.test(ended), ended);
  ok("...and the sign-in", /Sign in/.test(ended) && /sync-signin/.test(renderToStaticMarkup(h(SyncBanner, { status: st({ reason: "pad_ended", padEnd: "released" }), match: MATCH, onSignIn() {} }))));
  for (const [why, words] of [["expired", /until midnight on the match day/], ["token_moved", /Another device holds this match now/],
                              ["match_complete", /The match is over/], ["signed_out", /This phone was signed out/], ["office", /The school office ended it/]])
    ok(`...${why}: ${words.source}`, words.test(render(st({ reason: "pad_ended", padEnd: why }))));
  ok("an end the pad has no words for still reads as the day's end",
     /Scoring ended for today/.test(render(st({ reason: "pad_ended", padEnd: "something_new" }))));
  const offEnded = renderToStaticMarkup(h(SyncBanner, { status: st({ reason: "pad_ended", padEnd: "expired", online: false }), match: MATCH, onSignIn() {} }));
  ok("with no signal it offers no sign-in", !/sync-signin/.test(offEnded));
  const insecure = render(st({ reason: "not_signed_in", padResume: "unavailable", pendingList: [ball] }));
  ok("no secure context: the reload asks for a sign-in, and the pad says why",
     /Sign in to send 1 ball/.test(insecure) && /not secure \(plain http\)/.test(insecure) && /sign in each time/.test(insecure), insecure);
  ok("...and says nothing about it where there is one", !/plain http/.test(render(st({ reason: "not_signed_in", padResume: "none", pendingList: [ball] }))));
  const toss = render(st({ reason: "toss_needs_sign_in", attached: true, pendingList: [ball] }));
  ok("a toss to record, signed out: sign in to send it", /Sign in to send the toss/.test(toss) && /nothing is sent before it/.test(toss), toss);
}

group("E. The match-day audit (Kameel, 30 Oct 2026): every stop says what to do, and lists what it keeps");
{
  const handlers = { onSignIn() {}, onRetry() {}, onScoreHere() {}, onTakeOver() {}, onConfirmTakeOver() {}, onSettleFork() {}, onReview() {}, onDismissNote() {} };
  const markup = (s, extra) => renderToStaticMarkup(h(SyncBanner, { status: s, match: MATCH, extra, ...handlers }));
  const describe = (ev) => ev?.kind === "ball" ? `Ball — ${ev.value ?? 0} run${ev.value === 1 ? "" : "s"}` : `Event — ${ev?.kind}`;
  const b1 = { payload: { kind: "ball", value: 1 } }, b4 = { payload: { kind: "ball", value: 4 } };
  const AT = "2026-10-31T12:21:40Z";   // 14:21 in Johannesburg

  // B1: another phone held the match; taking it is a confirmed act, shown the last ball.
  const he = bannerFor(st({ reason: "held_elsewhere", heldElsewhere: { epoch: 7, at: AT, seq: 41 } }), MATCH);
  ok("held_elsewhere: another phone was scoring, with the server's last ball at 14:21", he?.lead === "Another phone was scoring this match." && /14:21/.test(he.text), he);
  ok("...and the action is the confirmed take-over", he?.action === "confirmtakeover" && /sync-confirm-takeover/.test(markup(st({ reason: "held_elsewhere", heldElsewhere: { epoch: 7, at: AT } }))));
  ok("...never Try again (which used to take it in silence)", !/sync-retry/.test(markup(st({ reason: "held_elsewhere", heldElsewhere: { epoch: 7, at: AT } }))));
  const heNone = bannerFor(st({ reason: "held_elsewhere", heldElsewhere: { epoch: 7, at: null } }), MATCH);
  ok("...with no ball yet, it says so", /no ball from it yet/.test(heNone?.text ?? ""), heNone);
  const em = bannerFor(st({ reason: "epoch_moved" }), MATCH);
  ok("epoch_moved: nothing taken, Try again", em?.action === "retry" && /Nothing was taken/.test(em.text), em);

  // P4: the incoming scorer's note, until checked.
  const note = bannerFor(st({ attached: true, reason: null, takeoverNote: { at: AT, seq: 41 } }), MATCH, 0, { score: "87 for 3 after 14.2 overs" });
  ok("the take-over note: the time of the server's last ball and the board then", note?.reason === "takeover_note" && /14:21/.test(note.text) && /87 for 3 after 14\.2 overs/.test(note.text), note);
  ok("...to check against the scoreboard and the book, with Checked", /scoreboard and the book/.test(note?.text ?? "") && note?.action === "checked"
     && /sync-note-checked/.test(markup(st({ attached: true, reason: null, takeoverNote: { at: AT } }))));

  // P5: token_moved, fork and match_complete each offer an action and list the balls kept.
  const tm = bannerFor(st({ reason: "token_moved", pendingList: [b1, b4] }), MATCH, 0, { describe });
  ok("token_moved: Score on this device, the other phone first", tm?.action === "scorehere" && /other phone must stop first/.test(tm.text), tm);
  ok("...and the two balls kept, listed", JSON.stringify(tm?.list) === JSON.stringify(["Ball — 1 run", "Ball — 4 runs"]), tm?.list);
  ok("...rendered as a list a scorer can show the lead", /data-testid="sync-banner-list"/.test(markup(st({ reason: "token_moved", pendingList: [b1] }), { describe })));
  const find = (id) => ({ c: { kind: "ball", value: 4 } })[id] ?? null;
  const fk = bannerFor(st({ reason: "fork", reconcile: { state: "fork", extra: ["a"], mine: ["c"] } }), MATCH, 0, { describe, find });
  ok("fork: its balls the server lacks, listed, and written aside", JSON.stringify(fk?.list) === JSON.stringify(["Ball — 4 runs"]) && /written aside on this phone/.test(fk.text), fk);
  ok("...and the action: Send them to the lead", fk?.action === "settlefork" && /sync-settle-fork/.test(markup(st({ reason: "fork", reconcile: { state: "fork", extra: [], mine: [] } }))));
  const mc = bannerFor(st({ reason: "match_complete", pendingList: [b1] }), MATCH, 0, { describe });
  ok("match_complete with a ball unsent: never sent before the result, listed, Send for review", mc?.action === "review" && mc.list?.length === 1
     && /never sent before the result was recorded/.test(mc.text), mc);
  const mcGoing = bannerFor(st({ reason: "match_complete", pendingList: [b1], reviewing: true }), MATCH, 0, { describe });
  ok("...while it is going, no second press", !mcGoing?.action && /Sending 1 ball to the lead/.test(mcGoing?.text ?? ""), mcGoing);

  // P6: the outbox could not open.
  const ob = bannerFor({ open: false, outboxUnavailable: true }, MATCH);
  ok("outbox_unavailable: said, with what to do", ob?.reason === "outbox_unavailable" && /Score on the other phone/.test(ob.text), ob);

  ok("every action button is at least 44px tall", (markup(st({ reason: "held_elsewhere", heldElsewhere: { epoch: 7, at: AT } })).match(/min-height:\s*(\d+)px/g) ?? [])
     .every((m) => Number(m.match(/(\d+)/)[1]) >= 44));
}

console.log(`\n${"─".repeat(52)}\nSYNC BANNER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
