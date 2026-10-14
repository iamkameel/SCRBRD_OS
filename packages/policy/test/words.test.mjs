#!/usr/bin/env node
/**
 * The plan's word list (docs/design/SCRBRD-138_phaseB.md §3, §7.2): each class
 * hits, a clean plan passes, the words a plan needs pass, a stem matches its
 * forms, and an initial's full stop or a bracket hides nothing. The words are
 * proved here and in the route's test, not in db/99: the database holds the
 * audience and the anchor, the application the words (PB-D7).
 *
 * Falsified once each by editing the list or the matcher and running this
 * file: "physio*" made a plain word (E names "physiotherapist"); the
 * lookbehind removed (B, D and E go red at "still", "skill", "Still
 * excused"); "grounded" put back on the list (D names "the ball was grounded
 * behind the crease"); "exam" made a stem (D names "for example"); a full stop and a
 * bracket counted as letters at the edges (F names "R.physio" and "(physio)",
 * and B every sentence ending in its word).
 *
 *   node packages/policy/test/words.test.mjs
 */
import { WORDS, CLASSES, CLASS_SENTENCE, refusedWords, refusalMessage } from "../src/words.mjs";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${d}`}`);
  if (c) pass++; else fail++;
};
const group = (/** @type {string} */ t) => console.log("\n" + t);
const words = (/** @type {string} */ t) => refusedWords(t).map((h) => `${h.word}:${h.cls}`).join(", ");

group("A. The list is one frozen list of four classes");
{
  ok("four classes, in the order a refusal names them", CLASSES.join() === "health,absence,discipline,derisive");
  ok("the list is frozen, and so is each entry", Object.isFrozen(WORDS) && WORDS.every((e) => Object.isFrozen(e)));
  ok("every entry has a known class", WORDS.every((e) => CLASSES.includes(e.cls)), WORDS.filter((e) => !CLASSES.includes(e.cls)).map((e) => e.w).join());
  ok("every class has words", CLASSES.every((c) => WORDS.some((e) => e.cls === c)));
  ok("no entry twice", new Set(WORDS.map((e) => e.w)).size === WORDS.length);
  ok("lower case, letters, a space or a closing star only", WORDS.every((e) => /^[a-z]+(?: [a-z]+)*\*?$/.test(e.w)),
     WORDS.filter((e) => !/^[a-z]+(?: [a-z]+)*\*?$/.test(e.w)).map((e) => e.w).join());
  ok("one sentence per class", CLASSES.every((c) => typeof CLASS_SENTENCE[/** @type {keyof typeof CLASS_SENTENCE} */ (c)] === "string"));
}

group("B. Each class hits (§3.3)");
{
  /** @type {[string, string][]} */
  const cases = [
    ["Naidoo is on four overs, physio.", "physio:health"],
    ["Smith's hamstring is a niggle.", "hamstring:health, niggle:health"],
    ["He is unwell, and unavailable.", "unwell:health, unavailable:health"],
    ["The doctor says concussion.", "doctor:health, concussion:health"],
    ["He is restricted this week; watch his workload.", "restricted:health, workload:health"],
    ["Pillay is ill.", "ill:health"],
    ["Mokoena is excused.", "excused:absence"],
    ["Brought a sick note.", "sick note:absence"],
    ["He has an exam on Saturday.", "exam:absence"],
    ["Still excused.", "excused:absence"],
    ["His suspension runs to Friday.", "suspension:absence"],
    ["He has detention.", "detention:discipline"],
    ["A disciplinary matter.", "disciplinary:discipline"],
    ["There is a conduct matter.", "conduct matter:discipline"],
    ["Last week was a shocker.", "shocker:derisive"],
    ["That drop was a howler.", "howler:derisive"],
    ["It was embarrassing.", "embarrassing:derisive"],
  ];
  for (const [text, want] of cases) ok(`${JSON.stringify(text)} → ${want}`, words(text) === want, words(text));
  ok("every class is reached by the cases above",
     CLASSES.every((c) => cases.some(([t]) => refusedWords(t).some((h) => h.cls === c))));
  ok("'a disciplinary matter' and 'his suspension' are refused (Kameel, 14 Oct 2026)",
     words("a disciplinary matter") === "disciplinary:discipline" && words("his suspension") === "suspension:absence");
  ok("a two-word entry wins over the word inside it: 'sick note' is absence, not health",
     words("sick  note") === "sick note:absence");
}

group("C. A clean plan passes");
{
  const plan = "Bat first if we win it. Naidoo and Smith open the bowling, four overs each, then " +
    "Erasmus from the top end. Field: two slips, a gully, the rest of the ring saved one. " +
    "If they are 40 for none after eight, bring the spinner on and keep the load on the off side. " +
    "Out by 7:15 for the bus; away whites. Keep it within the limit and back each other up.";
  ok("the design's own kind of plan passes", refusedWords(plan).length === 0, words(plan));
  ok("...and has no message", refusalMessage(refusedWords(plan)) === null);
  ok("no text is no hit", refusedWords("").length === 0 && refusedWords(/** @type {any} */ (null)).length === 0
     && refusedWords(/** @type {any} */ (42)).length === 0);
}

group("D. The words a plan needs pass (§3.3)");
{
  for (const t of ["away", "rest", "out", "load", "limit", "four overs", "the rest of the order",
                   "away whites", "out by seven", "load the off side", "for example", "the hospitality tent",
                   "at Illovo", "restrict them to 120", "a still day", "Willis", "skill", "physique", "medium pace",
                   // The cricket senses (Kameel, 14 Oct 2026: "Drop the cricket senses").
                   "the ball was grounded behind the crease", "play suspended for rain", "bowl with discipline"]) {
    ok(`${JSON.stringify(t)} passes`, refusedWords(t).length === 0, words(t));
  }
}

group("E. A stem matches its forms; a word its plural");
{
  for (const [t, w] of [["injury", "injury"], ["injured", "injured"], ["injuries", "injuries"],
                        ["physiotherapist", "physiotherapist"], ["physios", "physios"],
                        ["concussed", "concussed"],
                        ["embarrassed", "embarrassed"], ["embarrassment", "embarrassment"], ["sickness", "sickness"],
                        ["howlers", "howlers"], ["shockers", "shockers"], ["exams", "exams"], ["illnesses", "illnesses"]]) {
    ok(`${t} is caught as "${w}"`, refusedWords(t).length === 1 && refusedWords(t)[0].word === w, words(t));
  }
  ok("case-blind, and named as written", words("PHYSIO and Injured") === "PHYSIO:health, Injured:health");
  ok("a word inside another word is not that word: 'still', 'pill', 'Brill'",
     refusedWords("still pill Brill").length === 0);
  ok("one word named once, however often it is written", words("physio, physio, Physio") === "physio:health");
}

group("F. An initial's full stop or a bracket hides nothing");
{
  for (const t of ["R.physio", "R. physio.", "(physio)", "[injured]", "physio,", "\"howler\"", "D.Erasmus-injured",
                   "K.Naidoo:physio", "physio\nnext line", "Naidoo’s hamstring", "—sick—"]) {
    ok(`${JSON.stringify(t)} is caught`, refusedWords(t).length === 1, words(t));
  }
}

group("G. The refusal, in words (§3.4)");
{
  ok("one word, one class: the design's sentence",
     refusalMessage(refusedWords("physio")) ===
       "This can't go to the side with physio in it. A plan is read by every boy in the side and their parents. " +
       "A boy's health is not for it. Change the words and send again.");
  const m = refusalMessage(refusedWords("A howler, physio, and detention."));
  ok("every word named, in the order written", m?.startsWith("This can't go to the side with howler, physio and detention in it."), m ?? "");
  ok("one sentence per class hit, in class order",
     m?.includes("A boy's health is not for it. A boy's conduct is not for it. The side reads this about a team-mate."), m ?? "");
  ok("never the writer's text beyond the words", !m?.includes("A howler,"), m ?? "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
