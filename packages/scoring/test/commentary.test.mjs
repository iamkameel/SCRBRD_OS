/**
 * The commentary generator (SCRBRD-098): lines from the fold, names from the
 * caller.
 *
 *   A. every event kind has its line, and the figures in it are the fold's
 *   B. a void has no line; an amendment reads as the corrected history
 *   C. a free hit: said before the ball, and a wicket it saves is not out
 *   D. penalty runs to a fielding side, credited both ways across innings
 *   E. determinism: the same input gives the same lines; keys are stable as
 *      the log grows, and unique
 *   F. names come from `nameOf` and nowhere else — over generated logs, no
 *      player id, squad name or typed name reaches a line
 *   G. public mode: with role words for names, no pupil's name appears
 *   H. the vocabulary: every shot and sector the pad offers has its words
 *   I. foldSteps is the fold: its last step is deriveInnings()
 *   J. a left-hander's sector-era ball is worded for HIS side of the ground
 *      (SCRBRD-101): the stored seg is the screen's, mirrored for him
 */
import { readFileSync } from "node:fs";
import {
  deriveCommentary, COMMENTARY_KIND as K, ROLE_WORDS, SHOT_WORDS, SECTOR_WORDS,
  inningsStart, batters, bowler, ball, penalty, retire, inningsEnd, revision, voidEvent, shortRunning,
  sealInnings, deriveInnings, foldSteps, placementFromTap, BALL_TYPE, PENALTY_REASON_TEXT,
  ANGULAR_FAMILIES, angularFamily,
} from "../src/index.mjs";

/** Words without a Law clause bracket, escaped for a RegExp. */
const noLaw = (/** @type {string} */ t) => t.replace(/\s*\((?:Law|Laws)\s[^)]*\)/g, "").replace(/[()]/g, "\\$&");

/** @import { LogEvent } from "../src/events.mjs" */
/** @import { CommentaryItem, CommentaryRole } from "../src/commentary.mjs" */

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, detail?: unknown) => void} */
const ok = (n, c, detail) => {
  if (c) pass++;
  else { fail++; console.log("  ✗", n, detail === undefined ? "" : `\n      ${String(detail).slice(0, 400)}`); }
};
const group = (/** @type {string} */ t) => console.log("\n" + t);

// ── Fixtures ─────────────────────────────────────────────
// Ids that look like the database's, squad names nobody else uses, and the
// names a scorer types for players SCRBRD holds no row for.
const H = ["0a1b2c3d-0000-4000-8000-000000000001", "0a1b2c3d-0000-4000-8000-000000000002",
  "0a1b2c3d-0000-4000-8000-000000000003", "0a1b2c3d-0000-4000-8000-000000000004",
  "0a1b2c3d-0000-4000-8000-000000000005"];
const SQUAD_NAMES = ["Sipho Qwabe", "Liam Oosthuizen", "Thabo Mazibuko", "Keegan Fourie", "Ayanda Hlongwane"];
const SQUAD = H.map((id, i) => ({ id, name: SQUAD_NAMES[i] }));
// The away side: typed names, as the pad records an opposition with no roster.
const TYPED = ["Zakhele Typedname", "Brandon Keyboardson", "Musa Enteredby", "Jody Freetext"];
const FIELDER = "Werner Fieldtyped";

/** The reader's names: never the squad's, never the typed text. */
/** @type {Record<string, string>} */
const NAMES = {
  [H[0]]: "D Erasmus", [H[1]]: "R Pillay", [H[2]]: "S Naidoo", [H[3]]: "M Cele", [H[4]]: "T Bekker",
  [TYPED[0]]: "K Naidoo", [TYPED[1]]: "L Botha", [TYPED[2]]: "J Smit", [TYPED[3]]: "P Dube",
  [FIELDER]: "W Venter",
};
/** @type {(r: string) => string} */
const nameOf = (r) => NAMES[r] ?? "Unknown";

let seq = 0;
/** Give an event an id, as the pad does, so a void can name it.
 *  @template {object} T  @param {T} e  @param {number} [innings]  @returns {T & {id: string, innings: number}} */
const I = (e, innings = 0) => ({ ...e, id: `dev1:m1:${(++seq).toString(36)}`, innings });

const openA = () => [
  I(inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville", squad: SQUAD, overs: 2 })),
  I(batters({ striker: H[0], nonStriker: H[1] })),
  I(bowler({ bowler: TYPED[0] })),
];
/** @param {number} v  @param {object} [o] */
const run = (v, o = {}) => I(ball({ type: BALL_TYPE.RUN, value: v, ...o }));
/** @param {CommentaryItem[]} out  @param {string} kind */
const ofKind = (out, kind) => out.filter((x) => x.kind === kind);
/** @param {CommentaryItem[]} out */
const texts = (out) => out.map((x) => x.text).join("\n");

// ── A. Every event kind ──────────────────────────────────
group("A. Every event kind has its line, with the fold's figures");
{
  seq = 0;
  const log = [
    ...openA(),
    run(4, { shot: "drive", ...placementFromTap({ angle: 270, radius: 1 }) }),
    run(0, { shot: "fwd_def" }),
    I(ball({ type: BALL_TYPE.WIDE, value: 0 })),
    I(ball({ type: BALL_TYPE.WIDE, value: 2 })),
    I(ball({ type: BALL_TYPE.NO_BALL, value: 1 })),                       // off the bat: rotates
    I(ball({ type: BALL_TYPE.NO_BALL, value: 2, nbRuns: "byes" })),       // byes off a no-ball
    I(ball({ type: BALL_TYPE.NO_BALL, value: 1, nbRuns: "leg_byes" })),   // leg byes off a no-ball
    run(6, { shot: "loft", seg: 5 }),
    I(ball({ type: BALL_TYPE.BYE, value: 2 })),
    I(ball({ type: BALL_TYPE.LEG_BYE, value: 1, shot: "hit_body" })),
    I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: FIELDER, shot: "pull",
      ...placementFromTap({ angle: 60, radius: 0.95 }) })),
    I(batters({ striker: H[2] })),
    run(1),                                                                // over 2's first ball
    I(bowler({ bowler: TYPED[1] })),
    I(retire({ batter: H[0], reason: "hurt" })),
    I(batters({ nonStriker: H[3] })),
    I(penalty({ runs: 5, toBattingTeam: true, reason: "helmet_struck" })),
    I(revision({ overs: 3, reason: "rain" })),
    I(ball({ type: BALL_TYPE.WICKET, value: 1, dismissal: "run_out", dismissed: H[3], outAt: "bowler_end", fielder: FIELDER })),
    I(batters({ nonStriker: H[4] })),
    I(retire({ batter: H[4], reason: "out" })),
  ];
  // Retired out, back with the captain's consent after the next wicket (Law 25.4.3).
  {
    const back = deriveCommentary([...log, I(batters({ nonStriker: H[1] })), run(0),
      I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })), I(batters({ striker: H[4], captainConsent: true }))],
      { nameOf, sensitive: true });
    const line = back.at(-1)?.text ?? "";
    ok("a batter retired out, back with consent: said so, on his runs", /resumes with the opposing captain's consent, on 0 \(0\)\.$/.test(line)
       && !/\bLaws? \d/.test(line), line);
  }
  const out = deriveCommentary(log, { nameOf, sensitive: true });
  const all = texts(out);
  const at = (/** @type {RegExp} */ re) => out.find((x) => re.test(x.text));

  ok("the innings opens: who bats and for how long", at(/^Hilton College to bat: 2 overs\.$/));
  ok("the openers, by the reader's names", at(/^D Erasmus and R Pillay open the batting for Hilton College\.$/));
  ok("the first bowler opens the bowling", ofKind(out, K.BOWLER)[0]?.text.startsWith("K Naidoo") &&
     /open(s)? the bowling/.test(ofKind(out, K.BOWLER)[0]?.text ?? ""));
  const four = ofKind(out, K.FOUR)[0];
  ok("a four, with the recorded shot and where it went", four && /K Naidoo to D Erasmus, .*four.*driven to deep point\./.test(four.text), four?.text);
  ok("...at 0.1", four?.over === 0 && four?.ball === 1);
  ok("a dot, with the shot", at(/defended on the front foot, no run\.$|defended on the front foot, dot ball\.$/));
  ok("a wide alone", at(/K Naidoo to D Erasmus, (wide|a wide|that's a wide)\.$/));
  ok("a wide that ran two more", at(/wide, and two more: 3 wides\./));
  ok("a no-ball off the bat, and the free hit it brings", at(/no-ball, and they run one\. Free hit to come\./));
  ok("byes off a no-ball", at(/no-ball, and two byes off it\./));
  ok("leg byes off a no-ball", at(/no-ball, and one leg bye off it\./));
  const six = ofKind(out, K.SIX)[0];
  // Sector 5 is centred on 150°: mid on, for this right-hander (SCRBRD-101;
  // it was named "deep mid-on", and sector 4, at 120°, "long-on").
  ok("a six, over the sector the scorer tapped", six && /lofted over mid on\./.test(six.text), six?.text);
  ok("byes", at(/, two byes\.$/));
  ok("leg byes, with the body contact recorded", at(/, off the body, one leg bye\.$/));
  const w = ofKind(out, K.WICKET)[0];
  ok("a catch: shot, catcher and where", w && /pulled and caught by W Venter at deep (backward )?square leg\./.test(w.text), w?.text);
  ok("...the batter's figures from the fold, and the score", w && /R Pillay (goes for|is out for) \d+|R Pillay is out for a duck/.test(w.text) && /Hilton College \d+\/1\.$/.test(w.text), w?.text);
  ok("the new batter comes in", ofKind(out, K.NEW_BATTER).some((x) => /^S Naidoo (comes in|is the new batter|walks out to bat)\.$/.test(x.text)));
  const end1 = ofKind(out, K.OVER_END)[0];
  // 18, not 24 less the byes and leg byes (21): the two byes and the leg bye
  // off no-balls are not the bowler's either (Law 21.15, db/52).
  ok("the end of the over: its runs, the score, the batters, the bowler", end1 &&
     /^End of over 1: 24 runs, one wicket\. Hilton College 24\/1\. D Erasmus \d+ \(\d+\)\. K Naidoo 1-0-18-1\.$/.test(end1.text), end1?.text);
  ok("...placed at the over's sixth ball, before the new batter", end1?.over === 0 && end1?.ball === 6
     && out.indexOf(end1) < out.findIndex((x) => /^S Naidoo/.test(x.text)));
  ok("a second bowler from the other end", at(/^L Botha to bowl from the other end\.$/));
  ok("retired hurt, said to a signed-in reader", at(/^D Erasmus retires hurt, on \d+ \(\d+\)\.$/));
  ok("a penalty to the batting side, in words, with no Law clause number", at(new RegExp(`^Five penalty runs to Hilton College, for ${noLaw(PENALTY_REASON_TEXT.helmet_struck)}\\. Hilton College \\d+/1\\.$`)));
  ok("a revision, with its reason", at(/^Revision for rain: the innings is now 3 overs\.$/));
  const ro = ofKind(out, K.WICKET)[1];
  ok("a run out: the runs completed, the batter, the end the Laws say, the fielder", ro &&
     /out: they complete one, and M Cele is run out at the bowler's end \(W Venter\)\./.test(ro.text), ro?.text);
  ok("retired out is a wicket", ofKind(out, K.WICKET).some((x) => /^T Bekker retires out, on 0 \(0\)\. Hilton College \d+\/3\.$/.test(x.text)));
  ok("no line says undefined, null or NaN", !/undefined|null|NaN|\[object/.test(all), all);
  ok("no line is empty", out.every((x) => x.text.trim().length > 0));

  // Innings end, and the end-of-innings reasons.
  const closed = [...log, I(inningsEnd({ reason: "declared", confirmed: { runs: 0, wickets: 0, balls: 0 } }))];
  const inn = deriveInnings(closed.slice(0, -1));
  const sealed = [...log, I(sealInnings(inn, "declared"))];
  const outS = deriveCommentary(sealed, { nameOf });
  ok("a declaration ends the innings in words", ofKind(outS, K.INNINGS_END)[0]?.text === `Hilton College declare on ${inn.runs}/${inn.wickets}. Westville need ${inn.runs + 1} to win.`,
     ofKind(outS, K.INNINGS_END)[0]?.text);
  ok("...and a seal the fold refuses closes nothing", ofKind(deriveCommentary(closed, { nameOf }), K.INNINGS_END).length === 0);

  // Timed out, and a retirement not said to a public reader.
  seq = 100;
  const t = deriveCommentary([...openA(), I(retire({ batter: H[2], reason: "timed_out" })), I(retire({ batter: H[0], reason: "hurt" }))], { nameOf });
  ok("timed out is a wicket", ofKind(t, K.WICKET)[0]?.text === "S Naidoo is timed out. Hilton College 0/1.", ofKind(t, K.WICKET)[0]?.text);
  ok("without `sensitive`, a retirement says nothing about health", ofKind(t, K.RETIRE)[0]?.text === "D Erasmus retires, not out, on 0 (0).",
     ofKind(t, K.RETIRE)[0]?.text);
}
{
  // Every dismissal in the Laws has words, and none says "undefined".
  const methods = {
    bowled: /, (out|and that's out), bowled\./, lbw: /, lbw\./, stumped: /stumped by W Venter\./,
    hit_wicket: /hit wicket\./, handled_ball: /handled the ball\./, obstructing_field: /obstructing the field\./,
    hit_twice: /hit the ball twice\./, run_out: /D Erasmus is run out \(W Venter\)\./,
  };
  for (const [d, re] of Object.entries(methods)) {
    seq = 200;
    const out = deriveCommentary([...openA(), I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: d, fielder: FIELDER }))], { nameOf });
    ok(`${d}: said`, re.test(ofKind(out, K.WICKET)[0]?.text ?? ""), ofKind(out, K.WICKET)[0]?.text);
  }
  seq = 250;
  const cab = deriveCommentary([...openA(), I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: TYPED[0] }))], { nameOf });
  ok("caught by the bowler is caught and bowled", /, caught and bowled\./.test(ofKind(cab, K.WICKET)[0]?.text ?? ""), ofKind(cab, K.WICKET)[0]?.text);
  ok("...but never between role words", !/caught and bowled/.test(texts(deriveCommentary([...openA(), I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: TYPED[0] }))]))));
}
{
  // A change of bowler: during an over, with the reason only when sensitive;
  // a new spell; and a bowler named twice before a ball, said once.
  seq = 300;
  const log = [
    ...openA(), run(0), run(0),
    I(bowler({ bowler: TYPED[1], reason: "injury" })), run(0), run(0), run(0), run(0),      // over 1, finished by L Botha
    I(bowler({ bowler: TYPED[2] })), I(bowler({ bowler: TYPED[3] })),                     // over 2: named, then changed
    run(0), run(0), run(0), run(0), run(0), run(0),
  ];
  const signedIn = deriveCommentary(log, { nameOf, sensitive: true });
  ok("a bowler taking over mid-over, and why (signed in)",
     ofKind(signedIn, K.BOWLER_CHANGE)[0]?.text === "L Botha will finish the over, taking over from K Naidoo, who is injured.",
     ofKind(signedIn, K.BOWLER_CHANGE)[0]?.text);
  ok("...without the reason otherwise",
     ofKind(deriveCommentary(log, { nameOf }), K.BOWLER_CHANGE)[0]?.text === "L Botha will finish the over, taking over from K Naidoo.");
  const b2 = ofKind(signedIn, K.BOWLER).filter((x) => x.over === 1);
  ok("a bowler named twice before a ball is said once, as the one who bowled", b2.length === 1 && /^P Dube/.test(b2[0].text), b2.map((x) => x.text));
  ok("a maiden is said as one", ofKind(signedIn, K.OVER_END).some((x) => /^End of over 2: a maiden\./.test(x.text)));

  // Back for a second spell: bowled over 1, rested for over 2 and 3... in a
  // five-over innings with three bowlers.
  seq = 400;
  const spell = [
    I(inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville", squad: SQUAD, overs: 5 })),
    I(batters({ striker: H[0], nonStriker: H[1] })),
    ...[TYPED[0], TYPED[1], TYPED[2], TYPED[1], TYPED[0]].flatMap((b) => [I(bowler({ bowler: b })), ...[0, 0, 0, 0, 0, 0].map(() => run(0))]),
  ];
  const sp = ofKind(deriveCommentary(spell, { nameOf }), K.BOWLER);
  ok("a bowler continuing from his end is not news", sp.filter((x) => /L Botha/.test(x.text)).length === 1, sp.map((x) => x.text));
  ok("a bowler back for a new spell is", sp.some((x) => x.over === 4 && /^K Naidoo (is back into|returns to) the attack\.$/.test(x.text)), sp.map((x) => x.text));
}
{
  // Milestones: a fifty, a fifty partnership, a five-for.
  seq = 500;
  const log = [
    I(inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville", squad: SQUAD, overs: 20 })),
    I(batters({ striker: H[0], nonStriker: H[1] })),
    I(bowler({ bowler: TYPED[0] })),
    // D Erasmus hits the first over for 36; R Pillay takes a single; three
    // more sixes bring up both fifties on the same ball.
    run(6), run(6), run(6), run(6), run(6), run(6), run(1), run(6), run(6), run(6),
  ];
  const out = deriveCommentary(log, { nameOf });
  const ms = ofKind(out, K.MILESTONE).map((x) => x.text);
  ok("a fifty, with the balls it took", ms.some((t) => /^(Fifty for D Erasmus|D Erasmus reaches fifty), from \d+ balls\.$/.test(t)), ms);
  ok("a fifty partnership", ms.some((t) => /^Fifty partnership for (D Erasmus and R Pillay|R Pillay and D Erasmus), from \d+ balls\.$/.test(t)), ms);

  seq = 600;
  const five = [
    I(inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville", squad: [...SQUAD, ...SQUAD.map((p) => ({ ...p, id: `${p.id}x` }))], overs: 20 })),
    I(batters({ striker: H[0], nonStriker: H[1] })),
    I(bowler({ bowler: TYPED[0] })),
    ...[H[2], H[3], H[4], `${H[0]}x`, `${H[1]}x`].flatMap((next) => [
      I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })), I(batters({ striker: next }))]),
  ];
  const fo = ofKind(deriveCommentary(five, { nameOf: (r) => NAMES[r] ?? "Another Reader-name" }), K.MILESTONE);
  ok("a five-for", fo.some((x) => x.text === "Five wickets for K Naidoo: 5/0."), fo.map((x) => x.text));
  ok("two in two: on a hat-trick, said once", fo.filter((x) => x.text === "K Naidoo is on a hat-trick.").length === 1, fo.map((x) => x.text));
  ok("three in three: a hat-trick, said once", fo.filter((x) => x.text === "A hat-trick for K Naidoo.").length === 1, fo.map((x) => x.text));
  seq = 650;
  const broken = [
    I(inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville", squad: SQUAD, overs: 20 })),
    I(batters({ striker: H[0], nonStriker: H[1] })), I(bowler({ bowler: TYPED[0] })),
    I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })), I(batters({ striker: H[2] })),
    I(ball({ type: BALL_TYPE.WIDE, value: 0 })),                                                    // a wide does not break it
    I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run_out", fielder: FIELDER })), I(batters({ striker: H[3] })), // not his
    I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "lbw" })), I(batters({ striker: H[4] })),
  ];
  const hb = ofKind(deriveCommentary(broken, { nameOf }), K.MILESTONE).map((x) => x.text);
  ok("a run out between is not his: no hat-trick ball", !hb.some((t) => /hat-trick/.test(t)), hb);
}

// ── B. Voids and amendments ──────────────────────────────
group("B. A void has no line; an amendment reads as the corrected history");
{
  seq = 700;
  const log = [...openA(), run(1), run(4), run(2)];
  const four = log[4];
  const undone = [...log, I(voidEvent({ target: four.id }))];
  const out = deriveCommentary(undone, { nameOf });
  ok("the voided ball has no line", !out.some((x) => x.key.startsWith(`e:${four.id}`)));
  ok("...and no four anywhere", ofKind(out, K.FOUR).length === 0);
  ok("...and the void itself has none", !out.some((x) => x.key.includes(undone[undone.length - 1].id)));
  const two = out.find((x) => /two runs|come back for two/.test(x.text));
  ok("the ball after it moves up to 0.2", two?.over === 0 && two?.ball === 2, two);

  // An amendment: a wicket found after the match to have been the wrong
  // ball — voided through scoring_amendment_decide() and replaced. The next
  // batter is still at the crease, and the lines are the history as it now
  // stands, with the dismissal gone.
  seq = 800;
  const wkt = I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "lbw" }));
  const played = [...openA(), run(1), wkt, I(batters({ striker: H[2] })), run(0), run(0)];
  const before = deriveCommentary(played, { nameOf });
  const amended = [...played, { ...voidEvent({ target: wkt.id, reason: "amendment" }), id: "amendment:9f", innings: 0 }];
  const after = deriveCommentary(amended, { nameOf });
  ok("before the amendment there is a wicket", ofKind(before, K.WICKET).length === 1);
  ok("after it there is none", ofKind(after, K.WICKET).length === 0, texts(after));
  ok("...the balls after it are renumbered as the fold now has them", after.filter((x) => x.kind === K.BALL).map((x) => `${x.over}.${x.ball}`).join(" ") === "0.1 0.2 0.3");
  const fold = deriveInnings(amended);
  ok("...and every figure in the lines is the corrected fold's", !/\/1\./.test(texts(after)) && fold.wickets === 0);
}

// ── C. Free hit ──────────────────────────────────────────
group("C. A free hit");
{
  seq = 900;
  const log = [
    ...openA(),
    I(ball({ type: BALL_TYPE.NO_BALL, value: 0 })),
    I(ball({ type: BALL_TYPE.WIDE, value: 0 })),                                       // the free hit carries over a wide
    I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })),                // not out on a free hit
    I(ball({ type: BALL_TYPE.NO_BALL, value: 0 })),
    I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "run_out", fielder: FIELDER })), // stands on a free hit
    I(batters({ striker: H[2] })),
    run(1),
  ];
  const out = deriveCommentary(log, { nameOf });
  const fh = out.filter((x) => x.text.startsWith("Free hit: "));
  ok("the no-ball says a free hit is to come", out.filter((x) => /Free hit to come\./.test(x.text)).length === 2);
  ok("the wide on the free hit, the free hit, and the next free hit are marked", fh.length === 3, fh.map((x) => x.text));
  ok("bowled on a free hit is not out", fh.some((x) => /bowled, but it's a free hit: not out\./.test(x.text) && x.kind === K.BALL), fh.map((x) => x.text));
  ok("a run out on a free hit stands", ofKind(out, K.WICKET).length === 1 && /run out/.test(ofKind(out, K.WICKET)[0].text));
  ok("the ball after a legal free hit is not one", !out[out.length - 1].text.startsWith("Free hit"));
}

// ── D. Penalty credits both ways ─────────────────────────
group("D. Penalty runs to a fielding side, across innings");
{
  // To the side that has NOT batted yet: they start their innings on 5.
  seq = 1000;
  const first = [
    ...openA(),
    ...shortRunning({ striker: H[0], shot: "cut" }).map((e) => I(e)),
    I(penalty({ runs: 5, toBattingTeam: false, reason: "pitch_damage" })),
  ];
  const out1 = deriveCommentary(first, { nameOf, teamName: (_k, n) => (n === "Westville" ? "Westville" : n) });
  const sr = ofKind(out1, K.SHORT_RUNNING)[0];
  ok("short running: the ball's runs are disallowed in its own line",
     out1.some((x) => x.kind === K.BALL && /cut, they run, but the umpire calls deliberate short running and no runs count\./.test(x.text)));
  ok("short running: five to the fielding side, in words",
     sr?.text.startsWith(`Five penalty runs to Westville, for ${noLaw(PENALTY_REASON_TEXT.short_running)}; the runs are disallowed.`), sr?.text);
  ok("...who will start their innings on 5", /Westville will start their innings on 5\.$/.test(sr?.text ?? ""), sr?.text);
  const pd = ofKind(out1, K.PENALTY)[0];
  ok("a second award to them: on 10", /Westville will start their innings on 10\.$/.test(pd?.text ?? ""), pd?.text);

  const second = [...first,
    I(inningsStart({ battingTeam: "Westville", bowlingTeam: "Hilton College", overs: 2, target: 20 }), 1),
    I(batters({ striker: TYPED[0], nonStriker: TYPED[1] }), 1), I(bowler({ bowler: H[4] }), 1), I(run(1), 1)];
  const out2 = deriveCommentary(second, { nameOf });
  const credit = ofKind(out2, K.PENALTY_CREDIT)[0];
  ok("the next innings opens on the credit: \"Westville start their innings on 10\"",
     credit?.innings === 1 && credit.text === "Westville start their innings on 10, from penalty runs awarded while they were fielding.", credit?.text);
  const firstBall = out2.find((x) => x.innings === 1 && x.kind === K.BALL);
  ok("...placed before their first ball", credit != null && firstBall != null && out2.indexOf(credit) < out2.indexOf(firstBall));

  // To the side that HAS batted: added to their total, and the chase's
  // target moves with it.
  seq = 1100;
  const log = [
    ...openA(), run(4), run(4),
    I(sealInnings(deriveInnings([...openA(), run(4), run(4)]), "declared")),
    I(inningsStart({ battingTeam: "Westville", bowlingTeam: "Hilton College", overs: 2, target: 9 }), 1),
    I(batters({ striker: TYPED[0], nonStriker: TYPED[1] }), 1), I(bowler({ bowler: H[4] }), 1), I(run(1), 1),
    I(penalty({ runs: 5, toBattingTeam: false, reason: "time_wasting" }), 1),
    I(run(0), 1),
  ];
  const out = deriveCommentary(log, { nameOf });
  const p = ofKind(out, K.PENALTY).find((x) => x.innings === 1);
  ok("an award to the side that batted goes on their total", /They go on Hilton College's total, now 13\./.test(p?.text ?? ""), p?.text);
  ok("...and the chase's target moves with it", /The target is now 14\.$/.test(p?.text ?? ""), p?.text);
  ok("...in words, with no Law clause number", p?.text.includes(noLaw(PENALTY_REASON_TEXT.time_wasting)) && !/\bLaws?\s+\d/.test(p?.text ?? ""));

  // A stored award whose reason has since been withdrawn (2026-09-27) reads
  // as it always did: the same line, its own words. The constructor will not
  // build one now, so it is written as a stored row reads back.
  const stored = /** @type {typeof log} */ (/** @type {unknown} */ (log.map((e) => (e.kind === "penalty" ? { ...e, reason: "obstruction_distraction" } : e))));
  const q = ofKind(deriveCommentary(stored, { nameOf }), K.PENALTY).find((x) => x.innings === 1);
  ok("a withdrawn reason, stored before, still reads: the same total and target, its own words",
     q?.text === p?.text.replace(noLaw(PENALTY_REASON_TEXT.time_wasting), "distracting or obstructing the fielders"), q?.text);
}

// ── E. Determinism and keys ──────────────────────────────
group("E. Determinism: the same events, the same lines; keys stable and unique");
{
  seq = 1200;
  const log = [...openA(), run(1), run(4), I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: FIELDER })),
    I(batters({ striker: H[2] })), run(6), run(0), run(2), I(bowler({ bowler: TYPED[1] })), run(1)];
  const a = deriveCommentary(log, { nameOf });
  const b = deriveCommentary(structuredClone(log), { nameOf });
  ok("the same log gives the same lines, key for key", JSON.stringify(a) === JSON.stringify(b));
  ok("keys are unique", new Set(a.map((x) => x.key)).size === a.length);
  const grown = deriveCommentary([...log, run(1), run(0)], { nameOf });
  const byKey = new Map(grown.map((x) => [x.key, x]));
  ok("a line keeps its key and its words as the log grows", a.every((x) => byKey.get(x.key)?.text === x.text));
  // Events without ids (a test, an old log): the key is the place in the log.
  const bare = log.map(({ id: _id, ...rest }) => rest);
  const c = deriveCommentary(bare, { nameOf });
  ok("without ids, keys still unique", new Set(c.map((x) => x.key)).size === c.length);
  ok("...and still the same every time", JSON.stringify(c) === JSON.stringify(deriveCommentary(bare, { nameOf })));
  ok("the pad's shape (logs by innings) reads the same as a flat log",
     JSON.stringify(deriveCommentary([log], { nameOf })) === JSON.stringify(a));
  ok("an empty log has no lines", deriveCommentary([], { nameOf }).length === 0);
  // The wording varies across events, never within one.
  const words = new Set();
  for (let k = 0; k < 40; k++) {
    seq = 2000 + k * 10;
    words.add(ofKind(deriveCommentary([...openA(), run(1)], { nameOf }), K.BALL)[0].text);
  }
  ok("a single is not always worded the same way across events", words.size > 1, [...words]);
}

// ── F. Names come from nameOf and nowhere else ───────────
group("F. Over generated logs: every name is nameOf's, and nothing leaks");
{
  /** A small seeded generator, so a failure names the seed that found it. */
  const rng = (/** @type {number} */ s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const DISMISSALS = ["bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket", "handled_ball", "obstructing_field", "hit_twice"];
  const SHOTS = Object.keys(SHOT_WORDS);
  let checked = 0, leaks = 0, foreign = 0, voidedSeen = 0, voidedLeft = 0;
  /** @type {string[]} */ const firstLeak = [];
  let clauses = 0; /** @type {string[]} */ const firstClause = [];
  for (let s = 1; s <= 60; s++) {
    const r = rng(s);
    const pick = /** @template T @param {T[]} xs @returns {T} */ (xs) => xs[Math.floor(r() * xs.length)];
    seq = s * 10000;
    // The home side's ids and squad names; the away side typed.
    const home = H.map((id, i) => ({ id: `${id.slice(0, -2)}${String(s % 90 + 10)}`.slice(0, 34) + String(i + 10), name: `${SQUAD_NAMES[i]} ${s}` }));
    const away = TYPED.map((t) => `${t} ${s}`);
    const fielders = [`${FIELDER} ${s}`, ...away];
    /** @type {Set<string>} */ const refs = new Set([...home.map((p) => p.id), ...away, ...fielders]);
    const forbidden = [...refs, ...home.map((p) => p.name)];
    /** @type {Map<string, string>} */ const given = new Map();
    let k = 0;
    /** @type {(ref: string, role: CommentaryRole) => string} */
    const reader = (ref, _role) => {
      if (!refs.has(ref)) foreign++;
      if (!given.has(ref)) given.set(ref, `Reader${++k}q`);
      return /** @type {string} */ (given.get(ref));
    };
    /** @type {LogEvent[]} */
    const log = [];
    for (const inns of [0, 1]) {
      const [bat, bowl] = inns === 0 ? [home.map((p) => p.id), away] : [away, home.map((p) => p.id)];
      log.push(I(inningsStart({ battingTeam: inns ? "Away XI" : "Home XI", bowlingTeam: inns ? "Home XI" : "Away XI",
        squad: inns ? [] : home, overs: 3, target: inns ? 40 : null }), inns));
      log.push(I(batters({ striker: bat[0], nonStriker: bat[1] }), inns));
      let next = 2;
      for (let n = 0; n < 30; n++) {
        const x = r();
        if (x < 0.06) log.push(I(bowler({ bowler: pick(bowl) }), inns));
        else if (x < 0.09) log.push(I(penalty({ runs: 5, toBattingTeam: r() < 0.5, reason: pick(["other", "helmet_struck", "time_wasting"]) }), inns));
        else if (x < 0.11) log.push(I(retire({ batter: pick(bat), reason: pick(["hurt", "out", "timed_out"]) }), inns));
        else if (x < 0.12) log.push(I(revision({ overs: 2, target: inns ? 30 : null }), inns));
        else if (x < 0.16 && log.length > 3) {
          const target = pick(log.filter((e) => e.innings === inns && e.kind === "ball"));
          if (target?.id) log.push(I(voidEvent({ target: target.id }), inns));
        } else if (x < 0.24) {
          log.push(I(ball({ type: BALL_TYPE.WICKET, value: r() < 0.3 ? 1 : 0, dismissal: pick(DISMISSALS), fielder: pick(fielders),
            ...(r() < 0.3 ? { dismissed: pick(bat) } : {}), ...(r() < 0.3 ? { outAt: pick(["striker_end", "bowler_end"]) } : {}),
            shot: pick(SHOTS) }), inns));
          log.push(I(batters({ striker: bat[next++ % bat.length] }), inns));
        } else {
          const type = pick(["run", "run", "run", "Wd", "Nb", "B", "LB"]);
          log.push(I(ball({ type, value: pick([0, 0, 1, 1, 2, 3, 4, 6]), shot: r() < 0.5 ? pick(SHOTS) : null,
            ...(r() < 0.4 ? placementFromTap({ angle: Math.floor(r() * 360), radius: r() }) : { seg: r() < 0.3 ? Math.floor(r() * 12) : null }),
            ...(type === "Nb" && r() < 0.3 ? { nbRuns: pick(["byes", "leg_byes"]) } : {}) }), inns));
        }
      }
    }
    const out = deriveCommentary(log, { nameOf: reader, sensitive: r() < 0.5 });
    const voids = log.filter((e) => e.kind === "void").map((e) => /** @type {{target: string}} */ (e).target);
    voidedSeen += voids.length;
    voidedLeft += out.filter((x) => voids.some((t) => x.key === `e:${t}` || x.key.startsWith(`e:${t}#`))).length;
    for (const x of out) {
      checked++;
      // Take out every name the reader gave, and what is left must hold no
      // reference, squad name or typed name — nor a stray token of either.
      let rest = x.text;
      for (const v of given.values()) rest = rest.split(v).join("");
      const bad = forbidden.filter((f) => rest.includes(f) || x.text.includes(f));
      const stray = /Typedname|Keyboardson|Enteredby|Freetext|Fieldtyped|[0-9a-f]{8}-[0-9a-f]{4}/.test(rest)
        || SQUAD_NAMES.some((n) => rest.includes(n.split(" ")[1]));
      if (bad.length || stray) { leaks++; if (!firstLeak.length) firstLeak.push(`seed ${s}: ${x.text}`); }
      if (/\bLaws?\s+\d/.test(x.text)) { clauses++; if (!firstClause.length) firstClause.push(`seed ${s}: ${x.text}`); }
    }
  }
  ok(`${checked} lines over 60 generated matches: no id, squad name or typed name`, leaks === 0, firstLeak[0]);
  ok("nameOf is asked only about players in the events", foreign === 0, `${foreign} foreign refs`);
  ok("no line carries a Law clause number", clauses === 0, firstClause[0]);
  ok(`every voided ball (${voidedSeen}) has no line`, voidedSeen > 0 && voidedLeft === 0, `${voidedLeft} lines survived a void`);
  ok("the generator exercised enough lines to mean something", checked > 2000, checked);
}

// ── G. Public mode ───────────────────────────────────────
group("G. Public mode: role words for names, and no pupil's name anywhere");
{
  seq = 3000;
  const log = [
    ...openA(), run(4, { shot: "drive" }), I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "caught", fielder: FIELDER })),
    I(batters({ striker: H[2] })), run(1), run(0), run(6), run(0),
    I(bowler({ bowler: TYPED[1] })), I(retire({ batter: H[1], reason: "hurt" })), I(batters({ nonStriker: H[3] })),
    I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "stumped", fielder: FIELDER })),
  ];
  /** @type {(ref: string, role: CommentaryRole) => string} */
  const publicName = (_ref, role) => ROLE_WORDS[role];
  for (const [label, out] of [["role words", deriveCommentary(log, { nameOf: publicName })], ["no nameOf at all", deriveCommentary(log)]]) {
    const all = texts(/** @type {CommentaryItem[]} */ (out));
    const pupils = [...SQUAD_NAMES, ...SQUAD_NAMES.map((n) => n.split(" ")[1]), ...TYPED, FIELDER, ...H, ...Object.values(NAMES)];
    ok(`${label}: no pupil's name, typed name or id`, !pupils.some((p) => all.includes(p)), pupils.find((p) => all.includes(p)));
    ok(`${label}: people are role words`, /the bowler to the striker|The bowler to the striker/i.test(all) && /the keeper/.test(all), all.slice(0, 300));
    ok(`${label}: nothing about health`, !/hurt|injur/i.test(all));
    ok(`${label}: and so does every sentence in it`, !/[.!?]\s+[a-z]/.test(all), /[^\n]*[.!?]\s+[a-z][^\n]*/.exec(all)?.[0]);
    ok(`${label}: every line starts with a capital`, /** @type {CommentaryItem[]} */ (out).every((x) => /^[A-Z0-9]/.test(x.text)),
       /** @type {CommentaryItem[]} */ (out).find((x) => !/^[A-Z0-9]/.test(x.text))?.text);
  }
}

// ── H. The vocabulary ────────────────────────────────────
group("H. Every shot and sector the pad offers has its words here");
{
  const shotsJs = readFileSync(new URL("../../../apps/web/src/scorer/shots.js", import.meta.url), "utf8");
  const ids = [...new Set([...shotsJs.matchAll(/\{id:"([a-z_]+)"/g)].map((m) => m[1]))];
  ok("the pad offers shots", ids.length >= 20, ids.length);
  const missing = ids.filter((id) => !Object.hasOwn(SHOT_WORDS, id));
  ok("each has its words", missing.length === 0, missing.join(", "));
  // One source of truth (SCRBRD-101): the words are the families' names at
  // each sector's centre, and the pad's wheel takes its names from the same
  // table rather than typing a second list.
  ok("twelve sectors, each named by the family at its centre", SECTOR_WORDS.length === 12
    && SECTOR_WORDS.every((w, s) => w === ANGULAR_FAMILIES.find((f) => f.key === angularFamily(s * 30))?.label),
    SECTOR_WORDS.join(", "));
  const fieldJs = readFileSync(new URL("../../../apps/web/src/scorer/field.js", import.meta.url), "utf8");
  ok("...and the pad's wheel names its sectors from the same table, typing none",
    /\bSECTORS\b/.test(fieldJs) && !/label:\s*"[A-Z]/.test(fieldJs));
  seq = 3100;
  const odd = deriveCommentary([...openA(), run(1, { shot: "not_a_shot", seg: 99 })], { nameOf });
  ok("an id the vocabulary does not know says nothing, never itself", !/not_a_shot|99/.test(texts(odd)), texts(odd));
}

// ── I. foldSteps is the fold ─────────────────────────────
group("I. foldSteps() walks the same fold as deriveInnings()");
{
  seq = 3200;
  const log = [...openA(), run(1), run(4), I(ball({ type: BALL_TYPE.NO_BALL, value: 1 })), I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })),
    I(batters({ striker: H[2] })), run(0), run(0), run(2)];
  const withVoid = [...log, I(voidEvent({ target: log[4].id }))];
  const it = foldSteps(withVoid);
  let n = 0, r = it.next();
  while (!r.done) { n++; r = it.next(); }
  ok("it steps over every event that counts, and no other", n === log.length - 1, n);
  ok("its settled innings is deriveInnings()'s, figure for figure", JSON.stringify(r.value) === JSON.stringify(deriveInnings(withVoid)));
}

// ── J. A left-hander's ball, in his own words ────────────
group("J. A left-hander's ball is worded for his side of the ground (SCRBRD-101)");
{
  // One right-hander (H[0]) and one left-hander (H[1]); the squad carries the
  // hand, as the pad's live squad does.
  const hands = SQUAD.map((p, i) => ({ ...p, batHand: i === 1 ? "L" : "R" }));
  seq = 3300;
  /** @param {object} placed  the placement of one ball, faced by the left-hander */
  const lefty = (placed) => deriveCommentary([
    I(inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville", squad: hands, overs: 2 })),
    I(batters({ striker: H[1], nonStriker: H[0] })),
    I(bowler({ bowler: TYPED[0] })),
    run(4, { shot: "drive", ...placed }),
  ], { nameOf });
  const fourOf = (/** @type {CommentaryItem[]} */ out) => ofKind(out, K.FOUR)[0]?.text ?? "";
  // A sector-era ball: the scorer tapped the screen's sector 3 (90°, the
  // right of the screen). Under his mirrored field that is his point, not
  // square leg: 12 − 3 = 9.
  const sector = fourOf(lefty({ seg: 3, zone: "boundary", placementSource: "sector" }));
  ok("a left-hander's sector tap on the screen's right is through point", /driven through point\./.test(sector), sector);
  ok("...not square leg, which is where it is on a right-hander's screen", !/square leg/.test(sector), sector);
  // His cover drive tapped at the screen's 120°: his 240°, cover.
  const cover = fourOf(lefty({ seg: 4, zone: "boundary", placementSource: "sector" }));
  ok("...and the screen's 120° is his cover", /driven through cover\./.test(cover), cover);
  // A point: the same screen tap, captured as a point for him, is his point
  // too — theta is batter-relative already, so the two eras agree.
  const point = fourOf(lefty(placementFromTap({ angle: 90, radius: 0.6, batHand: "L" })));
  ok("a point tapped at the same place is his deep point: the two eras agree", /driven to deep point\./.test(point), point);
  // The right-hander's same screen sector stays square leg.
  seq = 3400;
  const righty = deriveCommentary([
    I(inningsStart({ battingTeam: "Hilton College", bowlingTeam: "Westville", squad: hands, overs: 2 })),
    I(batters({ striker: H[0], nonStriker: H[1] })),
    I(bowler({ bowler: TYPED[0] })),
    run(4, { shot: "drive", seg: 3, zone: "boundary", placementSource: "sector" }),
  ], { nameOf });
  ok("...while a right-hander's tap there is through square leg", /driven through square leg\./.test(fourOf(righty)), fourOf(righty));
}

console.log(`\n${"─".repeat(52)}\nCOMMENTARY SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
