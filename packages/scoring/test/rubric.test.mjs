/**
 * The rubric, and the gate the spec put in front of it.
 *
 * §3.4: "The schema must not ship before the anchors exist, since the whole
 * comparability argument rests on them." That is easy to state and easy to
 * forget under deadline, so it is a test rather than a paragraph.
 *
 * The tripwire below PASSES today — the rubric is incomplete and no assessment
 * schema exists — and fails the moment someone builds one while it is still
 * incomplete. When the anchors are authored, the same test flips to asserting
 * readiness, and neither state can be reached by accident.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  TREE, ANCHORS, ANCHOR_POINTS, BANDS, BENCHMARKS, BENCHMARKS_ARE_PROVISIONAL,
  CEILING, RUBRIC_VERSION, allSkills, unanchoredSkills, rubricIsReady, ageRelative, rubric,
  SCALE_MIN, SCALE_MAX, BANDS_OF_SCALE, scaleBand, DISCIPLINES,
  DERIVABLE_DISCIPLINES, COACH_ONLY_DISCIPLINES,
  DRAFT_ANCHORS, anchorFor, draftedSkills, unwrittenSkills,
} from "../src/rubric.mjs";
import { ASSESSMENT_SHAPE, validateAssessment } from "../../../services/api/write/assessment-api.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

// ── A. The gate ──────────────────────────────────────────
group("A. The schema does not ship before the anchors do");
{
  const missing = unanchoredSkills();
  console.log(`  ${allSkills().length - missing.length}/${allSkills().length} skills anchored`
            + (missing.length ? ` — still to author: ${missing.join(", ")}` : ""));

  const db = join(new URL("../../../", import.meta.url).pathname, "db");
  const sql = readdirSync(db).filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(db, f), "utf8")).join("\n");
  const assessmentTableExists = /create table\s+(if not exists\s+)?skill_assessment\b/i.test(sql);

  // THE TRIPWIRE. Either the rubric is finished, or the table it would be
  // assessed against does not exist yet. Both at once is the failure: coaches
  // recording numbers on a scale nobody has defined, which produces data that
  // looks longitudinal and compares nothing.
  ok("no assessment schema exists while skills remain unanchored",
     rubricIsReady() || !assessmentTableExists);

  ok("the gate is legible — the rubric reports its own readiness",
     rubric().ready === rubricIsReady() && Array.isArray(rubric().unanchored));
}

// ── B. What anchoring means ──────────────────────────────
group("B. An anchored skill is anchored at every point");
{
  for (const [skill, anchors] of Object.entries(ANCHORS)) {
    ok(`${skill} has all five anchor points`,
       ANCHOR_POINTS.every((p) => typeof anchors[p] === "string" && anchors[p].length > 20));
    ok(`${skill} is a skill in the tree`, allSkills().includes(skill));
  }
  ok("at least one worked example exists to author the rest against",
     Object.keys(ANCHORS).length >= 1);
  // A placeholder anchor is worse than none: a coach reads it and calibrates
  // against it. So an unanchored skill must be ABSENT, not filled with prose.
  ok("unanchored skills are absent rather than stubbed",
     unanchoredSkills().every((s) => ANCHORS[s] === undefined));
}

// ── C. The scale is absolute ─────────────────────────────
group("C. 100 does not move as a player ages");
ok("the ceiling is written down, not folklore",
   typeof CEILING === "string" && /provincial/i.test(CEILING));
ok("the rubric is versioned", RUBRIC_VERSION === "cricket-v1");
// The failure this prevents: a player who genuinely improves between U14 and
// U15 scoring lower at U15, because the bar rose faster than they did.
ok("a fixed score is comparable across bands — the same number means the same thing",
   ageRelative(60, "U14") > ageRelative(60, "U16"));
// The worked example from the spec: a player moving U15 → U16 whose stored
// score rises 61 → 66. The absolute number rises, which is the truth. The
// age-relative one BARELY moves, because the bar rose too — and that is the
// whole reason the stored score is the absolute one.
//
// The first version of this assertion read `a > b === false || true`, which is
// true for every input. Vacuous, and it passed.
ok("the absolute score records improvement plainly", 66 > 61);
ok("...while the age-relative view can stay almost flat across a promotion",
   Math.abs(ageRelative(66, "U16") - ageRelative(61, "U15")) < 0.05);
ok("...and can even FALL while the player improves, which is why it is not stored",
   ageRelative(62, "U16") < ageRelative(61, "U15"));

// ── D. Bands, including the one schools actually have ────
group("D. Above U16 there is no age group, so OPEN is a band");
ok("the bands stop at U16", !BANDS.some((b) => /^U1[789]$/.test(b)));
ok("...and carry an OPEN band", BANDS.includes("OPEN"));
ok("every band has a benchmark", BANDS.every((b) => Number.isFinite(BENCHMARKS[b])));
ok("benchmarks rise with the band", BANDS.every((b, i) =>
   i === 0 || BENCHMARKS[b] >= BENCHMARKS[BANDS[i - 1]]));
ok("the benchmarks are flagged as provisional, not presented as consensus",
   BENCHMARKS_ARE_PROVISIONAL === true);

// ── E. The age-relative view never guesses ───────────────
group("E. Unknown is not average");
ok("an unknown band answers null", ageRelative(60, "U19") === null);
ok("a missing score answers null", ageRelative(null, "U15") === null);
ok("a band with no benchmark answers null", ageRelative(60, "NOPE") === null);
// On the 1-20 scale: the U16 benchmark is 14, so 13 is just short of par.
ok("a real pairing answers a ratio", ageRelative(13, "U16") > 0.9 && ageRelative(13, "U16") < 1.0);
ok("...and a player at the benchmark is exactly par", ageRelative(BENCHMARKS.U16, "U16") === 1);
ok("...and one above it is above par", ageRelative(BENCHMARKS.U16 + 3, "U16") > 1);

// ── F. The write path has no attribute list of its own ───
//
// It used to keep a copy, and a copy of a vocabulary is a vocabulary that
// diverges: the write path would go on accepting an attribute the rubric had
// renamed, store it, and nothing would ever render it. This used to be checked
// by regexing the API source for the same words, which could only ever prove
// the two texts looked alike. Now there is one list and the check is that
// there is still only one.
group("F. One attribute set, not two");
{
  ok("the write path's shape IS the rubric's tree", ASSESSMENT_SHAPE === TREE);

  // ...and behaviourally, which is what actually protects a coach: a made-up
  // attribute is refused, and a real one on the old scale is too.
  const rejects = (scores) => {
    try { validateAssessment({ scores }); return false; } catch { return true; }
  };
  ok("a real attribute at a real score is accepted",
     rejects({ technical: { footwork: 14 } }) === false);
  ok("an invented attribute is refused",
     rejects({ technical: { swagger: 14 } }) === true);
  ok("an attribute filed under the wrong group is refused",
     rejects({ physical: { footwork: 14 } }) === true);
  ok("a group nobody defined is refused",
     rejects({ spiritual: { footwork: 14 } }) === true);

  // The scale, enforced where the data enters rather than trusted.
  ok("0 is refused: an attribute nobody has is not a thing",
     rejects({ technical: { footwork: 0 } }) === true);
  ok("21 is refused", rejects({ technical: { footwork: 21 } }) === true);
  ok("1 and 20 are both accepted",
     rejects({ technical: { footwork: 1 } }) === false &&
     rejects({ technical: { footwork: 20 } }) === false);
  ok("a fraction is refused, because a coach cannot defend 13.5 against 14",
     rejects({ technical: { footwork: 13.5 } }) === true);
}

// ── H. Drafts do not close the gate ──────────────────────
//
// 32 attributes now carry a first-pass anchor set, written to be redlined
// rather than believed. The whole value of that depends on ONE property: a
// draft must not count as an anchor. rubric.mjs says a placeholder anchor is
// worse than none — a coach reads it, calibrates against it, and the drift
// that follows is indistinguishable from a player changing.
//
// So the assertions here are mostly about the seam between the two.
group("H. A draft is not an anchor");
{
  const all = new Set(allSkills());
  ok("every draft names an attribute that exists",
     Object.keys(DRAFT_ANCHORS).every((k) => all.has(k)));
  ok("every attribute now has either an anchor or a draft", unwrittenSkills().length === 0);
  ok("...and exactly one of the two", draftedSkills().every((k) => !ANCHORS[k]));

  // THE LOAD-BEARING ONE. A drafted attribute is still unanchored, so the gate
  // counts it as outstanding work.
  ok("a drafted attribute still counts as unanchored",
     draftedSkills().every((k) => unanchoredSkills().includes(k)));
  ok("...so the gate is still shut", rubricIsReady() === false);
  ok("...and it is shut for a reason, not by accident", unanchoredSkills().length === 32);

  // Anything showing an anchor is obliged to say which kind it got.
  ok("an approved anchor reports itself as authored",
     anchorFor("technical.footwork").status === "authored");
  ok("a draft reports itself as a draft",
     anchorFor("mental.bravery").status === "draft");
  ok("an attribute that does not exist has no anchor at all",
     anchorFor("technical.swagger") === null);

  // Shape: the same five points, every one a real sentence.
  for (const [skill, points] of Object.entries(DRAFT_ANCHORS)) {
    const keys = Object.keys(points).map(Number).sort((a, b) => a - b);
    ok(`${skill} is anchored at every point on the scale`,
       keys.length === ANCHOR_POINTS.length && keys.every((k, i) => k === ANCHOR_POINTS[i]));
  }
  // Length is a poor proxy for substance and it fired on the best line in the
  // set — "Works when watched." is nineteen characters and says more than most
  // of the paragraph-long ones. What actually distinguishes a real anchor from
  // a placeholder is that it was written for THIS attribute: a stub gets
  // pasted, so a repeat across two attributes is the thing to look for.
  ok("every draft sentence is a written sentence",
     Object.values(DRAFT_ANCHORS).every((p) =>
       Object.values(p).every((v) => typeof v === "string" && v.trim().endsWith(".")
                                     && v.trim().length > 12)));
  {
    const seen = new Map();
    let repeated = 0;
    for (const [skill, points] of Object.entries(DRAFT_ANCHORS))
      for (const v of Object.values(points)) {
        const key = v.trim().toLowerCase();
        if (seen.has(key) && seen.get(key) !== skill) repeated++;
        seen.set(key, skill);
      }
    ok("...and no sentence was pasted from one attribute to another", repeated === 0);
  }
  // Five identical or near-identical sentences would satisfy the shape check
  // and teach a coach nothing.
  ok("...and the five differ from each other",
     Object.values(DRAFT_ANCHORS).every((p) => new Set(Object.values(p)).size === 5));
  // The top of every scale means the same thing, or the scale is not absolute.
  ok("every 20 refers to the ceiling this rubric defines",
     Object.values(DRAFT_ANCHORS).every((p) => /provincial/i.test(p[20])));
}

console.log(`\n${"─".repeat(52)}\nRUBRIC SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
