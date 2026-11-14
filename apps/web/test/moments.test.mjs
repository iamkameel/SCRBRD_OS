/**
 * SCRBRD-133 §5.2–5.3 (G3), EXPERIENCE_PASS Slice 2: lib/moments.js. Each
 * trigger of the catalogue from a built log, through the shared generator and
 * the fold, as the pages feed it: the lines new in one read, the fold before
 * it and after. The exact card, the merge, the drop, the hold, the gap. A
 * wrong trigger is a silent lie on a public screen.
 *
 *   node apps/web/test/moments.test.mjs
 */
import { inningsStart, batters, bowler, ball, revision, penalty, playStopped, sealInnings, deriveMatch, deriveInnings,
  deriveCommentary, BALL_TYPE } from "@scrbrd/scoring";
import { momentsFrom, enqueue, SIZE, SHOW_MS, GAP, QUEUE_MAX } from "../src/lib/moments.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HOME = Array.from({ length: 11 }, (_, i) => ({ id: `h${i}`, name: `H Batter${i}` }));
const AWAY = Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, name: `A Bowler${i}` }));
const nameOf = (r) => [...HOME, ...AWAY].find((p) => p.id === r)?.name ?? r;
const side = (inn) => (inn?.battingTeam === "Home" ? "Home XI" : "Away XI");

/** A match, grown a read at a time: each read() is what a page gets. */
function game({ overs = 20 } = {}) {
  let n = 0;
  const log = [];
  let seen = new Set();
  let prev = null;
  const add = (inn, ...es) => { for (const e of es) log.push({ ...e, innings: inn, id: `x${++n}` }); return log[log.length - 1]; };
  const read = () => {
    const fold = deriveMatch(log);
    const lines = deriveCommentary(log, { nameOf });
    const fresh = lines.filter((c) => !seen.has(c.key));
    seen = new Set(lines.map((c) => c.key));
    const cards = momentsFrom(fresh, prev, fold, { side });
    prev = fold;
    return { fresh, fold, cards };
  };
  add(0, inningsStart({ battingTeam: "Home", bowlingTeam: "Away", squad: HOME, bowlingSquad: AWAY, overs }),
    batters({ striker: "h0", nonStriker: "h1" }), bowler({ bowler: "a0" }));
  read();
  return { add, read, log };
}
const said = (cards) => cards.map((c) => `${c.kind}: ${c.title}${c.body ? ` / ${c.body}` : ""}${c.eyebrow ? ` [${c.eyebrow}]` : ""}`);

group("1, 2. A four and a six: a beat, 2.5 s; a run or a dot, none; nothing new, none");
{
  const g = game();
  g.add(0, ball({ value: 4 }));
  let r = g.read();
  ok("a four: FOUR, a beat of 2.5 s", r.cards.length === 1 && r.cards[0].kind === "four" && r.cards[0].title === "Four"
     && r.cards[0].size === SIZE.BEAT && r.cards[0].ms === SHOW_MS.beat && SHOW_MS.beat === 2500, said(r.cards));
  g.add(0, ball({ value: 6 }));
  r = g.read();
  ok("a six: SIX", said(r.cards).join() === "six: Six", said(r.cards));
  g.add(0, ball({ value: 1 }), ball({ value: 0 }));
  ok("a single and a dot: no card", g.read().cards.length === 0);
  ok("a read with nothing new: no card (a reload replays nothing)", g.read().cards.length === 0);
  ok("nothing arrived, no fold before (a first read): no card", momentsFrom([], null, r.fold).length === 0);
}

group("3. A wicket: big, 4 s, the batter out as the card shows him");
{
  const g = game();
  g.add(0, ball({ value: 2 }), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }));
  const r = g.read();
  const w = r.cards.find((c) => c.kind === "wicket");
  ok("WICKET, big, 4 s", w && w.title === "Wicket" && w.size === SIZE.BIG && w.ms === SHOW_MS.short && SHOW_MS.short === 4000, said(r.cards));
  ok(`...with the card's dismissal, his name and figures: "${w?.body}"`, /^b A Bowler0 · H Batter0 2 \(2\)$/.test(w?.body ?? ""), w?.body);
  g.add(0, batters({ striker: "h2" }), ball({ value: 0 }), ball({ type: BALL_TYPE.WICKET, dismissal: "run out", dismissed: "h1", outAt: "bowler_end" }));
  const r2 = g.read();
  ok("run out at the other end: the card is the batter who went, not the striker", /H Batter1 0 \(0\)$/.test(r2.cards.find((c) => c.kind === "wicket")?.body ?? ""), said(r2.cards));
}

group("4, 5. Fifty and a fifty stand on one four: one card, FIFTY, \"with a four\"");
{
  const g = game();
  for (let i = 0; i < 6; i++) g.add(0, ball({ value: 6 }));
  g.add(0, bowler({ bowler: "a1" }));
  g.read();
  // The over's end swapped the ends: h1 faces. A single puts h0 back on strike, on 36.
  g.add(0, ball({ value: 1 }), ball({ value: 6 }), ball({ value: 4 }));
  g.read();   // h0 46, the stand 47
  g.add(0, ball({ value: 4 }));
  const r = g.read();
  ok(`h0 to 50 with a four, the stand to 51: "${said(r.cards).join(" | ")}"`, r.cards.length === 1 && r.cards[0].kind === "fifty"
     && r.cards[0].title === "Fifty" && r.cards[0].eyebrow === "with a four" && r.cards[0].size === SIZE.BIG, said(r.cards));
  ok("...his name and the mark, from the fold: \"H Batter0 · 50 off 10\"", r.cards[0]?.body === "H Batter0 · 50 off 9", r.cards[0]?.body);
  ok("the line it came from carries the fact, not only the words", r.fresh.some((c) => c.kind === "milestone" && c.moment?.kind === "batter_mark" && c.moment.mark === 50)
     && r.fresh.some((c) => c.kind === "milestone" && c.moment?.kind === "partnership" && c.moment.mark === 50), r.fresh.map((c) => c.moment ?? c.kind));
  ok("a milestone line with no fact is no card: never guessed from its words",
     momentsFrom([{ kind: "milestone", key: "e:zz", innings: 0, text: "Fifty for Someone, from 30 balls." }], r.fold, r.fold).length === 0);
}

group("6, 7, 8. A hat-trick and a five-for: the tag is no card; the hat-trick 6 s; the five-for 4 s");
{
  const g = game();
  let at = 2;
  const out = () => { g.add(0, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }), batters({ striker: `h${at++}` })); return g.read(); };
  const r1 = out();
  ok("one wicket: WICKET", said(r1.cards).length === 1 && r1.cards[0].kind === "wicket");
  const r2 = out();
  ok("two in two: still WICKET, and \"on a hat-trick\" is the board's tag, not a card",
     r2.cards.length === 1 && r2.cards[0].kind === "wicket" && r2.fresh.some((c) => c.moment?.kind === "hat_trick_ball"), said(r2.cards));
  const r3 = out();
  ok("three in three: HAT-TRICK, big, 6 s, the dismissal its line", r3.cards.length === 1 && r3.cards[0].kind === "hat_trick" && r3.cards[0].ms === SHOW_MS.long
     && /^b A Bowler0 · H Batter\d+ 0 \(1\)$/.test(r3.cards[0].body ?? ""), said(r3.cards));
  out();
  const r5 = out();
  const five = r5.cards[0];
  ok(`the fifth: one card, the biggest of the ball's ("${said(r5.cards).join(" | ")}")`, r5.cards.length === 1
     && (five.kind === "hat_trick" || five.kind === "five_wickets"), said(r5.cards));
  const facts = r5.fresh.filter((c) => c.moment?.kind === "bowler_wickets");
  ok("...the line says five wickets as a fact: 5 for 0", facts.length === 1 && facts[0].moment.wickets === 5 && facts[0].moment.runs === 0, r5.fresh.map((c) => c.moment));
  // A five-for on its own: the card's words.
  const lone = momentsFrom(facts, r5.fold, r5.fold);
  ok("FIVE WICKETS on its own: \"Five wickets / A Bowler0 5/0\", 4 s", lone.length === 1 && lone[0].title === "Five wickets" && lone[0].body === "A Bowler0 5/0"
     && lone[0].ms === SHOW_MS.short, said(lone));
}

group("11, 12. Innings closed, then the target");
{
  const g = game({ overs: 2 });
  for (let i = 0; i < 6; i++) g.add(0, ball({ value: 1 }));
  g.add(0, bowler({ bowler: "a1" }));
  g.read();
  for (let i = 0; i < 6; i++) g.add(0, ball({ value: 1 }));
  // The twelfth ball ends the innings by the Laws: the generator closes it with that read.
  let r = g.read();
  const first = deriveInnings(g.log.filter((e) => e.innings === 0));
  g.add(0, sealInnings(first));
  ok("...and the scorer's seal after it says nothing new", g.read().cards.length === 0);
  const closed = r.cards.find((c) => c.kind === "innings_closed");
  ok(`INNINGS CLOSED, big, 6 s: "${closed?.title} / ${closed?.body}"`, closed?.title === "Innings closed" && closed.body === "Home XI 12/0 (2 overs)"
     && closed.ms === SHOW_MS.long, said(r.cards));
  g.add(1, inningsStart({ battingTeam: "Away", bowlingTeam: "Home", squad: AWAY, bowlingSquad: HOME, overs: 2, target: 13 }));
  r = g.read();
  ok("TARGET 13, from 2 overs, big, 6 s", said(r.cards).join() === "target: Target 13 / from 2 overs" && r.cards[0].ms === SHOW_MS.long, said(r.cards));
  g.add(1, batters({ striker: "a0", nonStriker: "a1" }), bowler({ bowler: "h0" }), ball({ value: 0 }));
  g.read();
  g.add(1, revision({ overs: 1, target: 8, reason: "rain" }));
  r = g.read();
  ok(`15. a revision: "${said(r.cards).join(" | ")}"`, r.cards.length === 1 && r.cards[0].kind === "revision" && r.cards[0].title === "Overs revised to 1"
     && r.cards[0].body === "Target 8 from 1 overs", said(r.cards));
  g.add(1, penalty({ runs: 5, toBattingTeam: true }));
  r = g.read();
  ok("16. five penalty runs: to the side, never the boy", said(r.cards).join() === "penalty: 5 penalty runs / to Away XI", said(r.cards));
  g.add(1, penalty({ runs: 5, toBattingTeam: false }));
  r = g.read();
  ok("...and to the fielding side", said(r.cards).join() === "penalty: 5 penalty runs / to Home XI", said(r.cards));
  g.add(1, playStopped({ reason: "rain", note: "a note the page must never say" }));
  r = g.read();
  const stop = r.cards.find((c) => c.kind === "stopped");
  ok(`14. play stopped: held, the reason's word and the score, never the note ("${stop?.body}")`, stop?.size === SIZE.HELD && stop.ms === null
     && stop.title === "Play stopped" && /^rain · 0\.1 ov, 5\/0$/.test(stop.body ?? "") && !/note/.test(JSON.stringify(stop.body)), said(r.cards));
  ok("...and not again on the next read while it stays stopped", g.read().cards.length === 0);
}

group("13. The result: held");
{
  const res = momentsFrom([{ kind: "result", key: "result:m1", innings: 1, over: 0, ball: 0, text: "Away XI won by 5 wickets" }], null, { innings: [] });
  ok("the result line: held, its words", res.length === 1 && res[0].kind === "result" && res[0].size === SIZE.HELD && res[0].title === "Away XI won by 5 wickets");
}

group("17. A super over's first innings");
{
  const fold = { innings: [{ battingTeam: "Home" }, { battingTeam: "Away" }, { battingTeam: "Away", superOver: 1 }, { battingTeam: "Home", superOver: 1, target: 9, overs: 1 }] };
  const so = momentsFrom([{ kind: "innings_start", key: "e:so1", innings: 2, text: "" }], null, fold, { side });
  ok("SUPER OVER, Away XI to bat", said(so).join() === "super_over: Super over / Away XI to bat", said(so));
  const second = momentsFrom([{ kind: "innings_start", key: "e:so2", innings: 3, text: "" }], null, fold, { side });
  ok("...its second: the target", said(second).join() === "target: Target 9 / from 1 overs", said(second));
}

group("The gap: more than six deliveries in one read cut to state, with no card");
{
  const g = game();
  for (let i = 0; i < GAP; i++) g.add(0, ball({ value: 4 }));
  ok(`${GAP} fours in one read: cards`, g.read().cards.length === GAP);
  for (let i = 0; i < GAP + 1; i++) g.add(0, ball({ value: i === 0 ? 6 : 4 }));
  const r = g.read();
  ok(`${GAP + 1} deliveries in one read: no card at all`, GAP === 6 && r.cards.length === 0, said(r.cards));
}

group("§5.3: the queue");
{
  const c = (kind, size) => ({ key: kind + Math.random(), kind, size, ms: 1, title: kind, body: null, eyebrow: null, line: null });
  const big = c("wicket", SIZE.BIG), four = c("four", SIZE.BEAT), six = c("six", SIZE.BEAT), held = c("stopped", SIZE.HELD);
  ok("a beat behind a big card on show is dropped", enqueue([], [four], big).length === 0);
  ok("a big card behind a big card waits", enqueue([], [c("fifty", SIZE.BIG)], big).length === 1);
  ok("a beat behind a beat waits", enqueue([], [six], four).length === 1);
  ok("a beat behind a waiting big card is dropped", enqueue([c("fifty", SIZE.BIG)], [four], null).length === 1);
  ok("a held card ends the queue: nothing after it waits", enqueue([], [held, c("fifty", SIZE.BIG), four], null).map((x) => x.kind).join() === "stopped");
  ok("...and what waited before it gives way", enqueue([c("fifty", SIZE.BIG)], [held], null).map((x) => x.kind).join() === "stopped");
  ok(`at most ${QUEUE_MAX} wait, the latest kept`, QUEUE_MAX === 3 && enqueue([], [1, 2, 3, 4, 5].map(() => c("fifty", SIZE.BIG)), null).length === 3);
}

console.log(`\n────────────────────────────────────────────────────\nMOMENTS: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
