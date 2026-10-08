#!/usr/bin/env node
/**
 * NOTIFICATIONS.md D1, D2, D5: the lists in packages/policy/src/notifications.mjs
 * are the lists db/89_notification_contract.sql CHECKs, and the per-kind
 * contract (how long a notice lives, which word retracts it) is the one the
 * migration's functions enforce. Read from the file, so a kind added to one
 * and not the other fails here before a database is involved.
 *
 * Falsified by: adding a kind to KINDS alone (the kinds group fails), taking
 * `news` out of SUBJECT_KINDS (the subjects group fails), changing a kind's
 * `lives` (the life group names it), and moving `superseded` to recognition
 * (the retraction group names it). The parsers' own ability to fail is
 * asserted at the end against a migration text edited to disagree.
 *
 *   node packages/policy/test/notifications.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { KINDS, SUBJECT_KINDS, RETRACTION_KINDS, CONTRACT, NOTICE_URGENCY, isTiered } from "../src/notifications.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DB = process.env.SCRBRD_DB_DIR ?? join(ROOT, "db");
const SQL = readFileSync(join(DB, "89_notification_contract.sql"), "utf8");

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${d}`}`);
  if (c) pass++; else fail++;
};
const group = (/** @type {string} */ t) => console.log("\n" + t);
const same = (/** @type {readonly string[]} */ a, /** @type {readonly string[]} */ b) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** The quoted list inside `CHECK (<column> IN (...))` for a named constraint. */
const checkList = (/** @type {string} */ sql, /** @type {string} */ name, /** @type {string} */ column) => {
  const m = sql.match(new RegExp(`ADD CONSTRAINT ${name}\\s+CHECK \\(${column} IN \\(([^)]*)\\)\\)`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
};
/** notification_life()'s CASE: kind → the interval it adds, or the expression. */
const lifeArms = (/** @type {string} */ sql) => {
  const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION notification_life"), sql.indexOf("REVOKE ALL ON FUNCTION notification_life"));
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of body.matchAll(/WHEN '([a-z]+)'\s+THEN (.*)/g)) out[m[1]] = m[2].trim();
  return out;
};
/** The kinds notification_retract() allows for a word, from its refusals. */
const retractRules = (/** @type {string} */ sql) => {
  const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION notification_retract("), sql.indexOf("REVOKE ALL ON FUNCTION notification_retract("));
  const correction = body.match(/p_kind = 'correction' AND n\.kind NOT IN \(([^)]*)\)/)?.[1];
  const superseded = body.match(/p_kind = 'superseded' AND n\.kind <> '([a-z]+)'/)?.[1];
  const withdrawn = body.match(/IF n\.kind <> '([a-z]+)' THEN\s+RAISE EXCEPTION 'only a notice a person wrote is withdrawn/)?.[1];
  const never = body.match(/IF n\.kind = '([a-z]+)' THEN\s+RAISE EXCEPTION 'a safeguarding notice is never retracted/)?.[1];
  return {
    correction: correction ? [...correction.matchAll(/'([^']+)'/g)].map((x) => x[1]) : null,
    superseded: superseded ? [superseded] : null,
    withdrawn: withdrawn ? [withdrawn] : null,
    never,
  };
};

// ═══════════════════════════════════════════════════════════════════
group("D1 — the kinds: one list, here and in the CHECK");
// ═══════════════════════════════════════════════════════════════════
const kinds = checkList(SQL, "notification_kind_known", "kind");
ok("db/89 carries notification_kind_known", Array.isArray(kinds));
ok("...and it is KINDS exactly", kinds && same(kinds, KINDS), `${kinds} vs ${KINDS}`);
ok("nine kinds, with notice among them", KINDS.length === 9 && KINDS.includes("notice"));
// The backfill's own count names the same nine (the DO block repeats them).
const kindBlock = SQL.slice(SQL.indexOf("DO $kind$"), SQL.indexOf("END $kind$"));
const notIn = kindBlock.match(/WHERE kind NOT IN \(([^)]*)\)/)?.[1];
ok("...and the paste's count of rows outside it reads the same list",
   !!notIn && same([...notIn.matchAll(/'([^']+)'/g)].map((x) => x[1]), KINDS));

// ═══════════════════════════════════════════════════════════════════
group("D5 — the subjects: welfare and news joined the list");
// ═══════════════════════════════════════════════════════════════════
const subjects = checkList(SQL, "notification_subject_kind_known", "subject_kind");
ok("db/89 carries notification_subject_kind_known", Array.isArray(subjects));
ok("...and it is SUBJECT_KINDS exactly", subjects && same(subjects, SUBJECT_KINDS), `${subjects} vs ${SUBJECT_KINDS}`);
ok("welfare and news are subjects", SUBJECT_KINDS.includes("welfare") && SUBJECT_KINDS.includes("news"));
// db/08's nine are all still there: the CHECK only grows, so no stored row fails it.
const db08 = readFileSync(join(DB, "08_schema_programme.sql"), "utf8");
const old = db08.match(/subject_kind text CHECK \(subject_kind IN \(([^)]*)\)\)/)?.[1];
ok("every subject db/08 allowed is still allowed",
   !!old && [...old.matchAll(/'([^']+)'/g)].every((x) => SUBJECT_KINDS.includes(x[1])));

// ═══════════════════════════════════════════════════════════════════
group("D18 — the retraction words");
// ═══════════════════════════════════════════════════════════════════
const words = checkList(SQL, "notification_retraction_kind", "retraction_kind");
ok("db/89's CHECK names the three words, as RETRACTION_KINDS", words && same(words, RETRACTION_KINDS));
const rules = retractRules(SQL);
const byWord = (/** @type {string} */ w) => Object.keys(CONTRACT).filter((k) => CONTRACT[k].retract.includes(w));
ok("a correction is for recognition and welfare, in both places",
   same(rules.correction ?? [], byWord("correction")), `${rules.correction} vs ${byWord("correction")}`);
ok("superseded is for a fixture notice, in both places", same(rules.superseded ?? [], byWord("superseded")));
ok("withdrawn is for a person's notice, in both places", same(rules.withdrawn ?? [], byWord("withdrawn")));
ok("a safeguarding notice is never retracted, in both places",
   rules.never === "safeguarding" && CONTRACT.safeguarding.retract.length === 0);

// ═══════════════════════════════════════════════════════════════════
group("D2 — how long each kind lives");
// ═══════════════════════════════════════════════════════════════════
ok("CONTRACT has exactly the nine kinds", same(Object.keys(CONTRACT), KINDS));
const arms = lifeArms(SQL);
for (const [kind, { lives }] of Object.entries(CONTRACT)) {
  const arm = arms[kind] ?? "";
  const want = typeof lives === "number"
    ? new RegExp(`^p_from \\+ interval '${lives} days'$`)
    : { start: /^coalesce\(fx\.starts_at, /, "start+7": /^coalesce\(fx\.starts_at \+ interval '7 days', /,
        "meet+1": /^coalesce\(greatest\(lf\.meet_at, fx\.starts_at\) \+ interval '1 day', / }[lives];
  ok(`${kind} lives ${lives}${typeof lives === "number" ? " days" : ""}`, !!want && want.test(arm), arm);
}

// ═══════════════════════════════════════════════════════════════════
group("D4, D17 — the shape of a person's notice; what is tiered");
// ═══════════════════════════════════════════════════════════════════
ok("a person's notice is low or medium", same(NOTICE_URGENCY, ["low", "medium"]));
ok("the trigger refuses high for a notice", /IF NEW\.urgency = 'high' THEN/.test(SQL));
ok("news.read is not tiered; anything else is",
   !isTiered({ required_capability: "news.read" }) && isTiered({ required_capability: "medical.nature.read" })
   && isTiered({ tiered: true }) && !isTiered({ tiered: false, required_capability: "x" }));
ok("the view holds a tiered row's body back",
   /CASE WHEN n\.required_capability = 'news\.read' THEN n\.body END AS body/.test(SQL));

// ═══════════════════════════════════════════════════════════════════
group("The checks can fail");
// ═══════════════════════════════════════════════════════════════════
const wrong = SQL.replace("'lift', 'notice')) NOT VALID", "'lift', 'notice', 'gossip')) NOT VALID");
ok("a tenth kind in the migration is seen", wrong !== SQL && !same(checkList(wrong, "notification_kind_known", "kind") ?? [], KINDS));
const wrongLife = SQL.replace("WHEN 'recognition'  THEN p_from + interval '180 days'", "WHEN 'recognition'  THEN p_from + interval '18 days'");
ok("a changed life is seen", wrongLife !== SQL && lifeArms(wrongLife).recognition !== arms.recognition);
const wrongRetract = SQL.replace("n.kind NOT IN ('recognition', 'welfare')", "n.kind NOT IN ('recognition', 'welfare', 'injury')");
ok("a wider correction is seen", wrongRetract !== SQL && !same(retractRules(wrongRetract).correction ?? [], byWord("correction")));

console.log("\n" + "─".repeat(52));
console.log(`NOTIFICATIONS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
