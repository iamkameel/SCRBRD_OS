// The public page's live region (lib/announce.js): each new ball said in plain
// words, only what is new, and nobody named. Pure — the hook that feeds it
// (views/matchcentre/live.js useAnnouncement) and the region itself are driven
// in a browser by smoke-browser-public.
import { deriveCommentary } from "@scrbrd/scoring";
import { foldable } from "../src/public/publicLog.js";
import { BEAT_WORD, CATCH_UP, announceArrivals, ballWords, overSummaryText } from "../src/lib/announce.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

// A public log, as /api/public/matches/:id/log sends it: pseudonyms, labels.
const A = "a1a1a1a1a1a1", B = "b2b2b2b2b2b2", C = "c3c3c3c3c3c3", X = "d4d4d4d4d4d4", F = "f6f6f6f6f6f6";
let seq = 0;
const ev = (o) => ({ innings: 0, seq: ++seq, id: `e${String(seq).padStart(15, "0")}`, clientTs: 1_790_000_000_000 + seq * 1000, ...o });
const people = { [A]: "D Erasmus" };
const head = [
  ev({ kind: "innings_start", battingTeam: "1XI", bowlingTeam: "Kearsney College 1XI", teamKey: "1XI", bowlingTeamKey: "Kearsney College 1XI",
    squad: [{ id: A, label: "D Erasmus" }, { id: B, label: "Batter" }, { id: C, label: "Batter" }], bowlingSquad: [{ id: X, label: "Bowler" }], overs: 5 }),
  ev({ kind: "batters", striker: A, nonStriker: B }),
  ev({ kind: "bowler", bowler: X }),
];
const b = (o) => ev({ kind: "ball", type: "run", value: 0, striker: A, nonStriker: B, bowler: X, ...o });
const tell = (events) => deriveCommentary(foldable(events, people, { forCommentary: true }), { nameOf: (r) => people[r] ?? null, teamName: (_k, n) => n });
/** The lines `after` has that `before` did not — what a read brings. */
const fresh = (before, after) => { const seen = new Set(tell(before).map((c) => c.key)); return tell(after).filter((c) => !seen.has(c.key)); };
const say = (before, more) => announceArrivals(fresh(before, [...before, ...more]), [...before, ...more]);

console.log("A. The words, one delivery at a time");
ok("the beat words are the moment's", BEAT_WORD.four === "Four" && BEAT_WORD.six === "Six" && BEAT_WORD.wicket === "Wicket");
const w = (events) => { const all = [...head, ...events]; const c = tell(all); const last = c.filter((x) => x.kind !== "over_end").at(-1); return ballWords(last, all.find((e) => e.id === last.key.slice(2))); };
ok("a four", w([b({ value: 4 })]) === "Four runs", w([b({ value: 4 })]));
ok("a six", w([b({ value: 6 })]) === "Six runs");
ok("a single", w([b({ value: 1 })]) === "One run");
ok("a two", w([b({ value: 2 })]) === "Two runs");
ok("a dot", w([b({ value: 0 })]) === "Dot ball");
ok("a wicket: bowled", w([b({ type: "W", dismissal: "bowled" })]) === "Wicket — bowled");
ok("a wicket: caught, with the catcher never named", w([b({ type: "W", dismissal: "caught", fielder: F })]) === "Wicket — caught");
ok("a wicket: lbw, run out, hit wicket in words", ["lbw", "run_out", "hit_wicket"].map((d) => w([b({ type: "W", dismissal: d })])).join() === "Wicket — lbw,Wicket — run out,Wicket — hit wicket");
ok("a wicket with no dismissal is still a wicket", w([b({ type: "W" })]) === "Wicket");
ok("a wide", w([b({ type: "Wd", value: 0 })]) === "Wide");
ok("a wide with runs", w([b({ type: "Wd", value: 2 })]) === "Wide, and two more");
ok("a no ball", w([b({ type: "Nb", value: 0 })]) === "No ball");
ok("a bye and a leg bye", w([b({ type: "B", value: 1 })]) === "One bye" && w([b({ type: "LB", value: 2 })]) === "Two leg byes");
// A wicket on a wide or a no-ball (Law 22.9, 21.17): the extra, then the wicket.
ok("a stumping off a wide: \"Wide. Wicket — stumped\"", w([b({ type: "Wd", value: 0, dismissal: "stumped" })]) === "Wide. Wicket — stumped",
   w([b({ type: "Wd", value: 0, dismissal: "stumped" })]));
ok("a run out off a no-ball: \"No ball. Wicket — run out\"", w([b({ type: "Nb", value: 1, dismissal: "run_out", dismissed: B, outAt: "striker_end" })]) === "No ball. Wicket — run out");
ok("...and a stumping off a wide the free hit saved is no wicket", w([b({ type: "Nb", value: 0 }), b({ type: "Wd", value: 0, dismissal: "stumped" })]) === "Wide. Free hit: not out",
   w([b({ type: "Nb", value: 0 }), b({ type: "Wd", value: 0, dismissal: "stumped" })]));

console.log("\nB. Only what is new");
const one = [...head, b({ value: 1 })];
ok("nothing arrived: nothing said", announceArrivals([], one) === "");
ok("a read with only a new bowler or batter says nothing", say(one, [ev({ kind: "batters", striker: C })]) === "");
ok("a new four is said", say(one, [b({ value: 4 })]) === "Four runs");
ok("...and a new wicket", say(one, [b({ type: "W", dismissal: "bowled" })]) === "Wicket — bowled");
ok("a burst of balls says the latest only, not all", say(one, [b({ value: 1 }), b({ value: 0 }), b({ type: "Wd" })]) === "Wide");
ok("the same words twice are still words (the page keys its region on a count)", say(one, [b({ value: 1 })]) === "One run" && say([...one, b({ value: 1 })], [b({ value: 1 })]) === "One run");

console.log("\nC. The end of the over");
const over = [...head];
for (let i = 0; i < 6; i++) over.push(b({ value: i === 5 ? 4 : 1 }));   // 9 runs
// The sixth ball ends the over, and the generator tells the over with it.
const endOfOver = say(over.slice(0, -1), [over.at(-1)]);
ok("the ball that ends an over comes with the over's summary, in the generator's words", /^Four runs\. End of over 1: 9 runs\. 1XI 9\/0\.$/.test(endOfOver), endOfOver);
ok("...said once: the next event, a new bowler, adds nothing", say(over, [ev({ kind: "bowler", bowler: X })]) === "");
ok("...and an over summary that arrives on its own is said alone",
   announceArrivals([{ kind: "over_end", key: "i0:o0", text: "End of over 1: a maiden. 1XI 0/0. Nothing else." }], []) === "End of over 1: a maiden. 1XI 0/0.");
ok("overSummaryText is the generator's first two sentences", overSummaryText({ text: "End of over 1: 9 runs. 1XI 9/0. D Erasmus 5 (3)." }) === "End of over 1: 9 runs. 1XI 9/0.");

console.log("\nD. A gap is not play");
const many = Array.from({ length: CATCH_UP + 1 }, () => b({ type: "Wd" }));   // wides: they never end an over
ok(`more than ${CATCH_UP} new deliveries in one read (a reconnect) say nothing`, say(head, many) === "");
ok(`...${CATCH_UP} still do`, say(head, many.slice(0, CATCH_UP)) === "Wide");

console.log("\nE. Nobody is named");
const all = [...head, b({ value: 4 }), b({ type: "W", dismissal: "caught", fielder: A }), b({ value: 6 }), b({ type: "W", dismissal: "run_out" }), b({ type: "Wd" })];
const said = [];
for (let n = head.length; n < all.length; n++) said.push(say(all.slice(0, n), [all[n]]));
ok("every announcement of an innings that names D Erasmus names no one", said.every((s) => s && !/Erasmus|Batter|Bowler|Fielder/.test(s)), said.join(" | "));
ok("...nor shows a pseudonym", said.every((s) => ![A, B, C, X, F].some((p) => s.includes(p))), said.join(" | "));

console.log(`\nANNOUNCE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
