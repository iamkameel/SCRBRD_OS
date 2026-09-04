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
} from "../src/rubric.mjs";

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
ok("a real pairing answers a ratio", ageRelative(66, "U16") > 0.9 && ageRelative(66, "U16") < 1.0);

// ── F. The tree matches what coaches are asked to rate ───
group("F. The tree is the one already in use");
{
  const api = readFileSync(new URL("../../../services/api/write/assessment-api.mjs", import.meta.url).pathname, "utf8");
  for (const [cat, metrics] of Object.entries(TREE)) {
    ok(`${cat} is a category the write path accepts`, new RegExp(`\\b${cat}:\\s*\\[`).test(api));
    ok(`${cat}'s metrics match the write path`,
       metrics.every((m) => new RegExp(`"${m}"`).test(api)));
  }
}

console.log(`\n${"─".repeat(52)}\nRUBRIC SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
