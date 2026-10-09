/**
 * Corrections everywhere, A0 and A1 (docs/design/GA-I36_corrections_everywhere.md
 * §2, §5, §7, §8.1): what a reader is told of a correction, read off the log
 * it already has (lib/corrections.js), and what a correction would do,
 * folded before anyone decides it (lib/correctionEffect.js).
 *
 * The property the design asks for (§8.1): for many random logs with random
 * corrections in them — a scorer's undo of the latest ball, an amendment's
 * void of any ball, a held ball released at the end — the fold of the log
 * equals the fold of the same log with the voided rows and the voids taken
 * out, innings by innings, and the commentary differs only by the
 * `correction` lines this adds. No engine code changed for any of it.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/corrections.test.mjs
 */
import { readFileSync } from "node:fs";
import { inningsStart, batters, bowler, ball, voidEvent, deriveMatch, deriveInnings, MatchFold, BALL_TYPE } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { afterTheMatch, clockWords, correctedAt, correctedInnings, correctionsOf, correctionText, inningsWords, withCorrectionLines } from "../src/lib/corrections.js";
import { publicFixes } from "../src/public/corrections.jsx";
import { applied, ballLine, effectOf, headOf } from "../src/lib/correctionEffect.js";
import { pendingWords, refusalWords } from "../src/views/matchcentre/corrections.jsx";
import { agoWords } from "../src/views/ReadinessOverview.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

// ── A small match, written as a pad writes one ──
const T0 = Date.parse("2026-10-03T08:00:00Z");
const squad = (side) => Array.from({ length: 11 }, (_, k) => ({ id: `${side}${k + 1}`, name: `${side} Player ${k + 1}` }));
const MATCH = { id: "m1", homeTeam: "1XI", awayTeam: "Kearsney", homeLabel: "Hilton 1XI", awayLabel: "Kearsney", status: "complete" };

/** A seeded generator, so a failing log can be found again. @param {number} seed */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

/**
 * Two innings of random play, each event with an id, a seq and a time.
 * @param {() => number} r @param {{undo?: boolean}} [o]  `undo`: scorer's undos of the latest ball as it goes
 */
function randomLog(r, { undo = true } = {}) {
  /** @type {any[]} */
  const log = [];
  let seq = 0;
  const put = (ev, innings) => { seq++; const e = { ...ev, innings, seq, id: `ev${seq}`, clientTs: T0 + seq * 30_000 }; log.push(e); return e; };
  for (const [inn, bat, bowl] of [[0, "H", "K"], [1, "K", "H"]]) {
    put(inningsStart({ battingTeam: bat === "H" ? "1XI" : "Kearsney", bowlingTeam: bat === "H" ? "Kearsney" : "1XI", squad: squad(bat), bowlingSquad: squad(bowl), overs: 5 }), inn);
    put(batters({ striker: `${bat}1`, nonStriker: `${bat}2` }), inn);
    let next = 3, over = -1;
    for (let k = 0; k < 40; k++) {
      const st = deriveInnings(log.filter((e) => e.innings === inn));
      if (st.complete || st.wickets >= 10 || st.balls >= 30) break;
      if (Math.floor(st.balls / 6) !== over) { over = Math.floor(st.balls / 6); put(bowler({ bowler: `${bowl}${(over % 4) + 1}` }), inn); }
      if (st.striker == null) { put(batters(st.nonStriker === `${bat}${next}` ? { striker: `${bat}${++next}` } : { striker: `${bat}${next++}` }), inn); continue; }
      const x = r();
      const b = x < 0.06 ? ball({ type: BALL_TYPE.WIDE, value: 0 })
        : x < 0.1 ? ball({ type: BALL_TYPE.NO_BALL, value: Math.floor(r() * 3) })
        : x < 0.17 ? ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })
        : ball({ type: BALL_TYPE.RUN, value: [0, 0, 1, 1, 2, 3, 4, 6][Math.floor(r() * 8)] });
      const e = put(b, inn);
      // K1: the scorer's undo of the latest event, now and then.
      if (undo && r() < 0.08) put(voidEvent({ target: e.id, reason: "scorer_undo" }), inn);
    }
  }
  return { log, put };
}

/** The log with every voided row and every void taken out. @param {any[]} log */
const cleaned = (log) => {
  const gone = new Set(log.filter((e) => e.kind === "void").map((e) => e.target));
  return log.filter((e) => e.kind !== "void" && !gone.has(e.id));
};
const figures = (m) => m.innings.map((i) => i && [i.runs, i.wickets, i.balls, JSON.stringify(i.extras), i.batsmen.map((b) => `${b.id}:${b.runs}:${b.balls}`).join(",")].join("|"));

group("correctionsOf: a void counts when it undid an event of this log");
{
  const { log, put } = randomLog(rng(7), { undo: false });
  const target = log.find((e) => e.kind === "ball" && e.innings === 0);
  const v = put(voidEvent({ target: target.id }), 0);
  v.clientTs = Date.parse("2026-10-03T16:42:00Z");
  v.amendment = "amend-1";
  const undo = put(voidEvent({ target: log.find((e) => e.kind === "ball" && e.innings === 1).id, reason: "scorer_undo" }), 1);
  ok("a scorer's own undo during play is not a correction", !correctionsOf(log).some((c) => c.seq === undo.seq));
  const ghost = put(voidEvent({ target: "no-such-event" }), 1);
  const vv = put(voidEvent({ target: v.id }), 0);   // a void of a void: the fold skips it, so does this
  const list = correctionsOf(log);
  ok("one correction: the void of a ball in the log", list.length === 1 && list[0].seq === v.seq, list);
  ok("...its time, innings and target", list[0].at === v.clientTs && list[0].innings === 0 && list[0].target === target.id);
  ok("a void naming nothing in the log is not one", !list.some((c) => c.seq === ghost.seq));
  ok("a void of a void is not one", !list.some((c) => c.seq === vv.seq));
  ok("correctedAt is the latest time", correctedAt(list) === v.clientTs);
  ok("a log with none has correctedAt null, not 0", correctedAt(correctionsOf(randomLog(rng(8), { undo: false }).log)) === null);
  const rec = new Map([[log[5].seq, Date.parse("2026-10-03T17:00:00Z")]]);
  const withRel = correctionsOf(log, rec);
  ok("a released ball counts, at its release time, in seq order", withRel.length === 2 && withRel[0].kind === "recovered" && withRel[0].seq < withRel[1].seq
    && correctedAt(withRel) === Date.parse("2026-10-03T17:00:00Z"), withRel);
  const inn = deriveMatch(log).innings;
  const by = correctedInnings(log, list, inn);
  ok("the innings it moved is marked, keyed by the fold's own innings", by.get(inn[0]) === v.clientTs && !by.has(inn[1]));
}

group("Words: when, in the fixture's time zone");
{
  const now = Date.parse("2026-10-11T12:00:00Z");
  ok("today: the time", clockWords(Date.parse("2026-10-11T16:42:00Z"), now) === "18:42", clockWords(Date.parse("2026-10-11T16:42:00Z"), now));
  ok("another day: the time and the date", clockWords(Date.parse("2026-10-03T16:42:00Z"), now) === "18:42, 3 Oct", clockWords(Date.parse("2026-10-03T16:42:00Z"), now));
  ok("no time: nothing, never a zero", clockWords(null) === "");
  ok("after the match / during play", correctionText(true) === "The scorecard was corrected after the match." && correctionText(false) === "The scorecard was corrected.");
  ok("agoWords", agoWords("2026-10-09T12:00:00Z", now) === "2 days ago" && agoWords("2026-10-11T09:00:00Z", now) === "3 hours ago" && agoWords(null, now) === "just now");
}

group("The commentary: one quiet line each, in its place, never a card");
{
  const { log, put } = randomLog(rng(11), { undo: false });
  const mid = log.filter((e) => e.kind === "ball" && e.innings === 0)[3];
  // An undo during play, right after the ball, then play on.
  const before = log.indexOf(mid);
  const undo = { ...voidEvent({ target: mid.id }), innings: 0, seq: mid.seq + 0.5, id: "undo-1", clientTs: mid.clientTs + 1000 };
  log.splice(before + 1, 0, undo);
  const after = { ...put(voidEvent({ target: log.filter((e) => e.kind === "ball" && e.innings === 1)[2].id }), 1), amendment: "a1" };
  log[log.indexOf(log.find((e) => e.id === after.id))] = after;
  const items = deriveCommentary(log);
  const list = correctionsOf(log);
  const told = withCorrectionLines(items, log, list, true);
  const lines = told.filter((t) => t.kind === "correction");
  ok("the scorer's undo is no correction: one correction, one line", list.length === 1 && lines.length === 1, lines);
  ok("the amendment after the match: '...after the match.'", lines[0].text === "The scorecard was corrected after the match." && lines[0].innings === 1);
  ok("afterTheMatch reads it so", afterTheMatch(log, list[0], true) && !afterTheMatch(log, list[0], false));
  const i0 = told.indexOf(lines[0]);
  const prevKey = told[i0 - 1]?.key ?? "";
  const prevSeq = log.find((e) => `e:${e.id}` === prevKey.split("#")[0])?.seq;
  ok("its line sits after the last line told before it", prevSeq != null && prevSeq < after.seq && told.slice(i0 + 1).every((t) => {
    const s = log.find((e) => `e:${e.id}` === t.key.split("#")[0])?.seq; return s == null || s > after.seq; }), { prevKey });
  ok("...in the same over as the line before it", lines[0].over === told[i0 - 1].over);
  ok("keys are their own and unique", new Set(told.map((t) => t.key)).size === told.length && lines.every((l) => l.key.startsWith("c:")));
  ok("no names in a correction line", lines.every((l) => !/Player/.test(l.text)));
  ok("the kind is not one the board makes a moment of", !["four", "six", "wicket", "milestone", "result"].includes(lines[0].kind));
  ok("no corrections: the commentary is returned as it was", withCorrectionLines(items, log, [], true) === items);
  ok("the source says no reason, requester or approver to the line (team words only)",
    !/reason|requested|approved_by/.test(readFileSync(new URL("../src/lib/corrections.js", import.meta.url), "utf8").split("export function withCorrectionLines")[1]));
  void after;
}

group("Property: 300 random logs, every kind of correction, fold and story agree");
{
  let agreeFold = 0, agreeStory = 0, agreeIncremental = 0, n = 0;
  /** @type {any} */ let firstBad = null;
  for (let s = 1; s <= 300; s++) {
    const r = rng(s * 97);
    const { log, put } = randomLog(r);
    // K3: an amendment's void of any delivery, approved after the match.
    const balls = log.filter((e) => e.kind === "ball" && !log.some((v) => v.kind === "void" && v.target === e.id));
    if (balls.length) { const t = balls[Math.floor(r() * balls.length)]; put({ ...voidEvent({ target: t.id }), amendment: `a${s}` }, t.innings); }
    // K4: a held ball released, written at the end of the last innings.
    if (r() < 0.5) put(ball({ type: BALL_TYPE.RUN, value: 1 }), 1);
    n++;
    const a = deriveMatch(log), b = deriveMatch(cleaned(log));
    const fa = figures(a), fb = figures(b);
    if (JSON.stringify(fa) === JSON.stringify(fb) && a.result?.text === b.result?.text) agreeFold++;
    else if (!firstBad) firstBad = { s, fa, fb };
    const told = withCorrectionLines(deriveCommentary(log), log, correctionsOf(log), true);
    const plain = deriveCommentary(cleaned(log));
    if (JSON.stringify(told.filter((t) => t.kind !== "correction")) === JSON.stringify(plain)) agreeStory++;
    // The live path's fold, pushed one event at a time, ends where the whole log's does.
    const f = new MatchFold([], {});
    for (const e of log) f.push(e);
    if (JSON.stringify(figures({ innings: f.view().innings })) === JSON.stringify(fa)) agreeIncremental++;
  }
  ok(`the fold with voids equals the fold without the voided rows (${agreeFold}/${n})`, agreeFold === n, firstBad);
  ok(`the commentary differs only by correction lines (${agreeStory}/${n})`, agreeStory === n);
  ok(`MatchFold pushed event by event ends where the whole log's fold does (${agreeIncremental}/${n})`, agreeIncremental === n);
}

group("The effect, folded before anyone decides");
{
  const { log } = randomLog(rng(21), { undo: false });
  const four = log.find((e) => e.kind === "ball" && e.type === BALL_TYPE.RUN && e.value === 4) ?? log.find((e) => e.kind === "ball" && e.value > 0);
  const n = four.value;
  const e = effectOf({ match: MATCH, events: log, change: { kind: "void", target: four.id, innings: four.innings } });
  const before = deriveMatch(log).innings[four.innings], after = deriveMatch(cleaned([...log, { kind: "void", target: four.id }])).innings[four.innings];
  ok("the void's innings moves by the ball's runs", e.innings.length === 1 && before.runs - after.runs === n, e.innings);
  ok("...in words, team and figures", e.words[0] === `${e.innings[0].team} ${e.innings[0].before} → ${e.innings[0].after}` && /→/.test(e.words[0]), e.words);
  ok("...and the result said: unchanged, or the words before and after",
    e.result.changes ? /^Result changes: .+ → .+$/.test(e.words[1]) : e.words[1] === "Result unchanged", e.words);
  const applied1 = applied(log, { kind: "void", target: four.id, innings: four.innings });
  ok("the void is appended at the next seq, the log it was given is untouched", applied1.length === log.length + 1
    && applied1[applied1.length - 1].seq === headOf(log) + 1 && headOf(log) === log[log.length - 1].seq);
  const rel = effectOf({ match: MATCH, events: log, change: { kind: "release", event: { kind: "ball", type: BALL_TYPE.RUN, value: 2, innings: 1 } } });
  ok("a released ball is folded at the end of its innings", rel.innings.length === 1 && rel.innings[0].after !== rel.innings[0].before, rel.words);
  const same = effectOf({ match: MATCH, events: log, change: { kind: "void", target: "nothing-here", innings: 0 } });
  ok("a void of nothing moves nothing, and says so", same.same && same.words[0] === "No figure moves" && same.words[1] === "Result unchanged", same.words);
  const line = ballLine({ events: [...log, { kind: "void", innings: four.innings, target: four.id, seq: 999, id: "v" }], target: four.id });
  ok("a corrected ball can still be named, with its place", !!line && line.words.startsWith(`${line.over}.${line.ball} · `), line);
}

group("The sheet's words");
{
  ok("pendingWords: nothing to say is null", pendingWords({ amendments: [], held: [] }) === null && pendingWords(null) === null);
  ok("pendingWords: amendments and held balls", pendingWords({ amendments: [{ state: "pending" }, { state: "approved" }], held: [{}, {}] })
    === "1 correction awaiting approval · 2 held balls awaiting a decision");
  ok("pendingWords: the scorer's declined request", pendingWords({ amendments: [{ state: "declined", mine: true }], held: [] }) === "1 of your requests was declined");
  ok("refusalWords: the Laws' own words", /The Laws refuse this: the start of an innings/.test(refusalWords({ reason: "laws_refused", text: "the start of an innings cannot be undone" })));
  ok("refusalWords: the self-approval guard", /Somebody else has to decide it/.test(refusalWords({ reason: "cannot_approve_your_own" })));
}

group("The public page's half: what it draws of a correction, from the redacted log");
{
  const { log, put } = randomLog(rng(31), { undo: false });
  const t = log.find((e) => e.kind === "ball" && e.innings === 1 && e.value > 0);
  const v = put(voidEvent({ target: t.id }), 1);
  v.clientTs = Date.parse("2026-10-03T16:42:00Z");
  // The public log's void: kind, innings, seq, id, time and target, and `amendment: true` when an amendment wrote it.
  const redact = (/** @type {any} */ x) => (x.kind === "void" ? { kind: x.kind, innings: x.innings, seq: x.seq, id: x.id, clientTs: x.clientTs, target: x.target, ...(x.amendment ? { amendment: true } : {}) } : x);
  // A scorer's undo (no flag) is no correction; the amendment's void (flagged) is.
  const undone = log.find((e) => e.kind === "ball" && e.innings === 0 && e.value > 0);
  const u = put(voidEvent({ target: undone.id, reason: "scorer_undo" }), 0);
  const pubUndo = log.map(redact);
  ok("an undo alone: no chip, no words", publicFixes(pubUndo, { commentary: [], folded: deriveMatch(pubUndo), settled: true, match: { status: "complete" } }).at === null);
  v.amendment = "amend-9";
  const pub = log.map(redact);
  const folded = deriveMatch(pub);
  const story = { commentary: deriveCommentary(pub), folded, settled: !!folded.result, match: { status: "complete" } };
  const f = publicFixes(pub, story);
  ok("the chip's time is the void's", f.at === v.clientTs);
  ok("the line is team-level: after the match", f.line === "The scorecard was corrected after the match.");
  ok("the innings it moved has its words", f.corrected.get(folded.innings[1]) === `corrected ${clockWords(v.clientTs)}` && !f.corrected.has(folded.innings[0]), [...f.corrected.values()]);
  ok("the commentary gains the one line", f.commentary.length === story.commentary.length + 1 && f.commentary.filter((c) => c.kind === "correction").length === 1);
  ok("inningsWords is correctedInnings in words", [...inningsWords(pub, correctionsOf(pub), folded.innings).values()].every((w) => /^corrected \d\d:\d\d/.test(w)));
  const none = publicFixes(log.filter((e) => e !== v && e !== u), { ...story, commentary: deriveCommentary(log.filter((e) => e !== v && e !== u)) });
  ok("no correction: no time, no words, the commentary as it was", none.at === null && none.corrected.size === 0 && none.commentary.every((c) => c.kind !== "correction"));
}

group("The public page carries no reason, requester or approver");
{
  const pub = readFileSync(new URL("../src/public/PublicMatch.jsx", import.meta.url), "utf8");
  const reads = readFileSync(new URL("../src/public/reads.js", import.meta.url), "utf8");
  ok("the public page imports nothing of the signed-in correction code", !/correctionEffect|matchcentre\/corrections\.jsx/.test(pub + reads));
  ok("...and loads its corrections half only on demand (a dynamic import, never a static one)",
    /import\("\.\/corrections\.jsx"\)/.test(pub) && !/^import [^\n]*corrections?\.jsx?"/m.test(pub) && !/lib\/corrections\.js/.test(pub + reads));
  const half = readFileSync(new URL("../src/views/matchcentre/corrected.jsx", import.meta.url), "utf8")
    + readFileSync(new URL("../src/public/corrections.jsx", import.meta.url), "utf8");
  ok("the half reads no reason, requester or approver either", !/\.reason\b|requester|approved_by|approvedBy|decidedNote|\/api\/(?!public\/)/.test(half));
  ok("...and reads no reason, requester or approver field", !/\.reason\b|requester|approved_by|approvedBy|decidedNote/.test(pub + reads));
}

console.log(`\n${"─".repeat(52)}\nCORRECTIONS (web): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
