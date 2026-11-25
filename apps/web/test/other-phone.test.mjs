/**
 * Another phone holds the match (redesign slice 13; DESIGN_DIRECTION §3.4
 * Flow E): when the pad opens on the one screen that says who is scoring, in
 * place of the toss sheet and the keys, and the words it and Today say.
 * Hand-built reads and statuses, no DOM.
 *
 * The browser walk (tools/smoke-browser-scorer-home.mjs, group A2) holds the screen to this.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/other-phone.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  CHECK_AGAIN_WORDS, HELD_REASONS, LAPSED_REASON, heldByAnother, holderOf, kindOf, lapsedHold, otherPhoneWords, showOtherPhone, todayLine,
} from "../src/lib/otherPhone.js";
import { scorerFixtures } from "../src/lib/scorerHome.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const row = (o) => ({ duty: "scoring", who: "C Naidoo", state: "active", detail: "lease held", held: "another", ...o });
const st = (o = {}) => ({ open: true, attached: false, reason: null, pending: 0, held: 0, ...o });

group("The read: the scoring row of match_duties, and nothing else");
{
  ok("the scoring row is found among the others",
     JSON.stringify(holderOf([{ duty: "umpire", who: "X" }, row()])) === JSON.stringify({ state: "active", held: "another", who: "C Naidoo" }));
  ok("no scoring row: null", holderOf([{ duty: "transport", who: "Bus" }]) === null && holderOf(null) === null);
  ok("an empty name is no name", holderOf([row({ who: "  " })]).who === null);
  ok("another person's phone, active", heldByAnother(holderOf([row()])));
  ok("your own other phone, active", heldByAnother(holderOf([row({ held: "you" })])));
  ok("a handover armed on another phone", heldByAnother(holderOf([row({ state: "handover_pending", held: "another" })])));
  ok("a handover being confirmed", heldByAnother(holderOf([row({ state: "verifying", held: "another" })])));
  ok("not this device's own token", !heldByAnother(holderOf([row({ held: "this_device" })])));
  ok("...nor a handover this device armed", !heldByAnother(holderOf([row({ state: "handover_pending", held: "this_device" })])));
  ok("not a lapsed lease: that is the confirmed take-over (db/126)", !heldByAnother(holderOf([row({ held: "lapsed" })])));
  ok("not an idle session", !heldByAnother(holderOf([row({ state: "idle", held: null })])));
}

group("When the screen shows: a phone holding nothing of the match, another holding it");
{
  const another = holderOf([row()]);
  for (const reason of ["lease_active", "handover_pending", "verifying"]) {
    ok(`the claim refused as ${reason}`, showOtherPhone({ fresh: true, holder: null, status: st({ reason }) }));
  }
  ok("those three, and no more", [...HELD_REASONS].sort().join() === "handover_pending,lease_active,verifying");
  ok("before the outbox has said anything, from the read alone (no toss sheet first)", showOtherPhone({ fresh: true, holder: another, status: null }));
  ok("...or while the claim is still asking", showOtherPhone({ fresh: true, holder: another, status: st({ reason: "attaching" }) }));
  ok("...or with no signal to ask", showOtherPhone({ fresh: true, holder: another, status: st({ reason: "offline" }) }));
  ok("no read and no answer yet: the pad, as before", !showOtherPhone({ fresh: true, holder: null, status: st({ reason: "attaching" }) }));
  ok("attached: never", !showOtherPhone({ fresh: true, holder: another, status: st({ attached: true, reason: "lease_active" }) }));
  ok("a phone with something of the match saved here: never (its banner lists its balls)",
     !showOtherPhone({ fresh: false, holder: another, status: st({ reason: "lease_active" }) }));
  ok("a ball waiting to send: the pad and its banner", !showOtherPhone({ fresh: true, holder: another, status: st({ reason: "lease_active", pending: 1 }) }));
  ok("a refused ball held here: the pad", !showOtherPhone({ fresh: true, holder: another, status: st({ reason: "lease_active", held: 1 }) }));
  for (const reason of ["match_complete", "no_capability", "not_signed_in", "pad_ended", "epoch_moved", "token_moved", "moved_on"]) {
    ok(`the server said ${reason}: the pad says it`, !showOtherPhone({ fresh: true, holder: another, status: st({ reason }) }));
  }
  ok("the read says this device holds it: the pad", !showOtherPhone({ fresh: true, holder: holderOf([row({ held: "this_device" })]), status: null }));
}

group("A lapsed hold (Kameel, 25 Nov 2026): the same screen, the confirmed take-over its primary");
{
  const lapsed = holderOf([row({ held: "lapsed" })]);
  ok("the read's lapsed lease is a lapsed hold, not one held now", lapsedHold(lapsed) && !heldByAnother(lapsed));
  ok("...an idle session is neither", !lapsedHold(holderOf([row({ state: "idle", held: null })])));
  ok("the claim refused as held_elsewhere: the screen", LAPSED_REASON === "held_elsewhere" && showOtherPhone({ fresh: true, holder: null, status: st({ reason: "held_elsewhere" }) }));
  ok("...before the claim answers, from the read alone (no toss sheet first)", showOtherPhone({ fresh: true, holder: lapsed, status: st({ reason: "attaching" }) }));
  ok("...not on a phone with something of the match saved here", !showOtherPhone({ fresh: false, holder: lapsed, status: st({ reason: "held_elsewhere" }) }));
  ok("...nor with a ball waiting to send", !showOtherPhone({ fresh: true, holder: lapsed, status: st({ reason: "held_elsewhere", pending: 2 }) }));
  ok("...nor once taken over (attached)", !showOtherPhone({ fresh: true, holder: lapsed, status: st({ reason: "held_elsewhere", attached: true }) }));
  ok("Somebody else took it meanwhile (epoch_moved): the pad's banner, as before", !showOtherPhone({ fresh: true, holder: lapsed, status: st({ reason: "epoch_moved" }) }));
  ok("the kind: lapsed, from the claim or the read", kindOf(null, "held_elsewhere") === "lapsed" && kindOf(lapsed, null) === "lapsed");
  ok("...a live lease in the claim's answer wins over an older read", kindOf(lapsed, "lease_active") === "another");
  const w = otherPhoneWords(lapsed, "held_elsewhere", "14:21");
  ok("says plainly the other phone has gone quiet", w.lead === "Nobody has scored on the other phone for a while.", w.lead);
  ok("...with the server's last ball, what the take-over is confirmed against", /last ball from it came in at 14:21/.test(w.body), w.body);
  ok("...and to leave it if it is still scoring", /if it is still scoring, leave it/.test(w.body));
  ok("...or that the server has no ball from it", /no ball from it yet/.test(otherPhoneWords(null, "held_elsewhere").body));
  ok("...naming nobody", !/Naidoo/.test(JSON.stringify(otherPhoneWords(holderOf([row({ held: "lapsed" })]), "held_elsewhere", "14:21"))));
}

group("The words: who, from the read; never a guess");
{
  const w = otherPhoneWords(holderOf([row()]), "lease_active");
  ok("another person: named as the server names him", w.kind === "another" && w.lead === "C Naidoo is scoring this match on another phone.", w);
  ok("...and Today's line (§2.2)", w.line === "C Naidoo is scoring on another phone", w.line);
  ok("...what to do, in one sentence a scorer can act on", /hand over/.test(w.body) && /six-digit code/.test(w.body), w.body);
  const none = otherPhoneWords(null, "lease_active");
  ok("no read (signed out on the pad's credential): someone else, unnamed", none.lead === "Someone else is scoring this match on another phone.", none);
  ok("a lapsed holder's name is not used for a live one", otherPhoneWords(holderOf([row({ held: "lapsed" })]), "lease_active").lead.startsWith("Someone else"));
  const you = otherPhoneWords(holderOf([row({ held: "you", who: "A Wessels" })]), "lease_active");
  ok("your own other phone: you, not your name", you.kind === "you" && you.lead === "You're scoring this match on your other phone." && !/Wessels/.test(JSON.stringify(you)), you);
  const ho = otherPhoneWords(holderOf([row({ state: "handover_pending" })]), "handover_pending");
  ok("a handover waiting: who is handing over, and the code", ho.kind === "handover" && ho.lead === "C Naidoo is handing this match over." && /code/.test(ho.body), ho);
  ok("...from the read alone, before the claim answers", kindOf(holderOf([row({ state: "handover_pending" })]), null) === "handover");
  ok("...or from the claim alone", otherPhoneWords(null, "handover_pending").lead === "A handover of this match is waiting.");
  const vf = otherPhoneWords(holderOf([row({ state: "verifying" })]), "verifying");
  ok("a handover being confirmed", vf.kind === "verifying" && /being confirmed/.test(vf.lead), vf);
  ok("the claim's answer wins over an older read", kindOf(holderOf([row({ state: "handover_pending" })]), "lease_active") === "another");
  ok("check again: a minute and a half, as the lease (90 s)", /a minute and a half/.test(CHECK_AGAIN_WORDS));
  const all = [w, none, you, ho, vf].map((x) => `${x.lead} ${x.body} ${x.line}`).join(" ");
  ok("no code, table or reason word in any of it", !/lease_active|handover_pending|verifying|token|epoch|match_duties|_/.test(all), all);
}

group("Today: the line for a live match another phone holds (§2.2 line 4)");
{
  ok("held_other: who", todayLine("held_other", holderOf([row()])) === "C Naidoo is scoring on another phone");
  ok("held_other with no name read", todayLine("held_other", null) === "Someone else is scoring on another phone");
  ok("held_you", todayLine("held_you", holderOf([row({ held: "you" })])) === "You're scoring on your other phone");
  ok("handover", todayLine("handover", holderOf([row({ state: "handover_pending" })])) === "C Naidoo is handing over · enter the code on the pad");
  for (const s of ["held_here", "lapsed", "live", "not_started", "provisional", "complete"]) ok(`${s}: none`, todayLine(s, holderOf([row()])) === null);
  const NOW = Date.parse("2026-10-08T06:00:00Z");
  const m = { id: "m1", schoolId: "hil", homeTeam: "1XI", awayTeam: "Kearsney", status: "live", startsAt: "2026-10-08T05:00:00.000Z", date: "2026-10-08", live: true };
  const list = scorerFixtures({ matches: [m], assignments: null, coverage: new Map([["m1", { rows: [row()] }]]), now: NOW });
  ok("the fixture list carries the read's holder", list.items[0]?.state === "held_other" && list.items[0]?.holder?.who === "C Naidoo", list.items[0]);
}

group("The screen and the pad (source)");
{
  const src = readFileSync(new URL("../src/scorer/otherPhone.jsx", import.meta.url), "utf8");
  const eng = readFileSync(new URL("../src/scorer/engine.jsx", import.meta.url), "utf8");
  ok("one primary at a time: Take over scoring for a lapsed hold, else Enter the handover code",
     (src.match(/primary testId=/g) ?? []).length === 2 && /\{lapsed\s*\? <Wide primary testId="sync-confirm-takeover"[^>]*>Take over scoring<\/Wide>\s*: <Wide primary testId="other-phone-code"[^>]*>Enter the handover code/.test(src));
  ok("the take-over is the pad's own confirmed one, offered only on the claim's held_elsewhere answer",
     /onTakeOver=\{padStatus\?\.reason==="held_elsewhere"\?\(\)=>syncRef\.current\?\.attach\("takeover"\):null\}/.test(eng) && /disabled=\{!onTakeOver\}/.test(src));
  ok("Watch the score is there", /Watch the score/.test(src));
  ok("the screen reads only match_duties", (src.match(/api\(/g) ?? []).length === 1 && /\/api\/read\/match_duties\?matchId=/.test(src));
  ok("it claims nothing itself: Check again is the pad's own attach", !/session\/claim|handover\/claim|\/takeover|api\(`\/api\/matches/.test(src) && /attach\("open"\)/.test(eng));
  ok("the pad draws it before the match screen, with only the handover sheet over it",
     /if\(otherPhone\)return \(/.test(eng) && /\{modal==="handover"&&renderModal\(\)\}/.test(eng));
  ok("the sheet opened from it is the code alone", /takeOnly=\{otherPhone\}/.test(eng));
  ok("a pad that has held the token since it opened is never fresh again (a fork, a handover: its banner)",
     /fresh: freshOpen && !heldHere/.test(eng) && /if \(padStatus\?\.attached\) setHeldHere\(true\)/.test(eng));
  ok("no 44px floor broken: every button sets minHeight to the floor", (src.match(/minHeight: `\$\{T\.floor\.target\}px`/g) ?? []).length === 2 && (src.match(/<button /g) ?? []).length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
