#!/usr/bin/env node
/**
 * The family list's route module (SCRBRD-140 honesty model, Migration C,
 * db/174), with no database: a sentence for every code
 * family_register_upload() answers, the date field's shape, and the claim
 * tried only for the two roles it is for.
 *
 * Every decision is the database's (db/99 §149, tools/smoke-family-register.mjs).
 * What this holds is that the two do not drift.
 *
 *   node services/api/write/family-register-api.test.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FAMILY_PROBLEM_WORDS, bornOf, familyClaim, familyRegisterFail } from "./family-register-api.mjs";
import { FAMILY_LINE_WORDS, familyLineWords } from "../../../apps/web/src/lib/familyList.js";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SQL = readFileSync(join(ROOT, "db", "174_family_register.sql"), "utf8");

group("A. Every problem db/174 answers with has words");
{
  const codes = [...new Set([...SQL.matchAll(/v_problem := '([a-z_]+)'/g)].map((m) => m[1]))];
  ok("db/174 names some problems", codes.length >= 15);
  for (const c of codes) ok(`${c} has a sentence`, typeof FAMILY_PROBLEM_WORDS[c] === "function");
  for (const c of Object.keys(FAMILY_PROBLEM_WORDS)) ok(`${c} is a code db/174 answers`, codes.includes(c));
  for (const [c, fn] of Object.entries(FAMILY_PROBLEM_WORDS)) {
    const w = fn("2");
    ok(`${c}'s sentence is words, not a code`, typeof w === "string" && /\s/.test(w) && !/_/.test(w) && /[.?]$/.test(w));
  }
}

group("B. The office's Requests line: one sentence per code family_register_line() answers, never a date");
{
  const body = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION family_register_line("));
  const codes = [...new Set([...body.slice(0, body.indexOf("$$ LANGUAGE")).matchAll(/THEN '([a-z_]+)'|ELSE '([a-z_]+)'/g)].map((m) => m[1] ?? m[2]))];
  ok("db/174 answers six codes", codes.length === 6);
  for (const c of codes) ok(`${c} has a line`, typeof familyLineWords(c) === "string");
  ok("the design's sentence, word for word", FAMILY_LINE_WORDS.details_disagree === "On the family list. The details did not agree."
     && FAMILY_LINE_WORDS.uploader_lapsed === "On the family list. The person who listed it can no longer make this link.");
  ok("no line holds a date or a digit", Object.values(FAMILY_LINE_WORDS).every((w) => !/\d/.test(w)));
  ok("an unknown code is no line", familyLineWords("weird") === null && familyLineWords(null) === null);
}

group("C. The date she typed: shape only, and only for a guardian or a pupil's own request");
{
  ok("YYYY-MM-DD and a real day", bornOf("2012-03-04") === "2012-03-04" && bornOf(" 2012-03-04 ") === "2012-03-04");
  ok("anything else is no date", [null, undefined, "", "2012-02-30", "04/03/2012", "2012-3-4", 20120304, {}].every((v) => bornOf(v) === null));
  /** @type {string[]} */
  const asked = [];
  const client = { query: async (/** @type {string} */ sql) => { asked.push(sql); return { rows: [{ outcome: "linked" }] }; } };
  ok("no date: nothing is asked", await familyClaim(client, "r", "guardian", null) === "sent" && asked.length === 0);
  ok("another role: nothing is asked", await familyClaim(client, "r", "coach", "2012-03-04") === "sent" && asked.length === 0);
  ok("a guardian's request is tried", await familyClaim(client, "r", "guardian", "2012-03-04") === "linked" && asked.length === 1);
  const odd = { query: async () => ({ rows: [{ outcome: "found" }] }) };
  ok("an answer that is not linked or in reads as sent", await familyClaim(odd, "r", "player", "2007-01-02") === "sent");
}

group("D. A Postgres error's own detail never reaches the screen");
{
  const answer = (/** @type {any} */ e) => {
    /** @type {any} */ const out = {};
    const res = { status(/** @type {number} */ s) { out.status = s; return res; }, json(/** @type {any} */ b) { out.body = b; return res; } };
    familyRegisterFail(/** @type {any} */ (res), e);
    return out;
  };
  const pg = Object.assign(new Error("new row for relation \"family_register\" violates check constraint"),
    { code: "23514", severity: "ERROR", detail: "Failing row contains (walk.parent@example.invalid, …)." });
  const a = answer(pg);
  ok("a Postgres error answers 500 with a bare code", a.status === 500 && a.body?.error === "error");
  ok("...and none of its detail or message", !JSON.stringify(a.body).includes("example.invalid") && !("detail" in a.body) && !/violates/.test(JSON.stringify(a.body)));
  const mine = answer(Object.assign(new Error("not_permitted"), { status: 403, detail: "Only the school office and the principal can use its family list." }));
  ok("this module's own refusal keeps its words", mine.status === 403 && mine.body?.error === "not_permitted" && /school office/.test(mine.body?.detail ?? ""));
}

console.log("\n" + "─".repeat(52));
console.log(`FAMILY REGISTER API: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
