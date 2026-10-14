#!/usr/bin/env node
/**
 * The staff register's route module (SCRBRD-140 phase 2, db/92), with no
 * database: the words it owes for every code register_upload() answers, the
 * staff.csv parse, and the template it is read against.
 *
 * Every decision is the database's (db/99 §73, tools/smoke-staff-register.mjs).
 * What this holds is that the two do not drift: a problem code db/92 can
 * answer with has a sentence here, and the template's columns are the ones
 * this module reads.
 *
 *   node services/api/write/register-api.test.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROBLEM_WORDS, REGISTER_COLUMNS, COOLDOWN_WORDS, registerRowsFromCsv } from "./register-api.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SQL = readFileSync(join(ROOT, "db", "92_staff_register.sql"), "utf8");

group("A. Every problem db/92 answers with has words");
{
  // The codes the function assigns: v_problem := '<code>'.
  const codes = [...new Set([...SQL.matchAll(/v_problem := '([a-z_]+)'/g)].map((m) => m[1]))];
  ok("db/92 names some problems", codes.length >= 15);
  for (const c of codes) ok(`${c} has a sentence`, typeof PROBLEM_WORDS[c] === "function");
  for (const c of Object.keys(PROBLEM_WORDS)) ok(`${c} is a code db/92 answers`, codes.includes(c));
  const input = { role: "Coach" };
  for (const [c, fn] of Object.entries(PROBLEM_WORDS)) {
    const w = fn(input, "2");
    ok(`${c}'s sentence is words, not a code`, typeof w === "string" && /\s/.test(w) && !/_/.test(w) && /[.?]$/.test(w));
  }
  ok("the cooldown's sentence is the design's", COOLDOWN_WORDS === "You can't send a request right now. Ask the school office.");
}

group("B. staff.csv, as the office's spreadsheet writes it");
{
  const template = readFileSync(join(ROOT, "docs", "pilot", "templates", "staff.csv"), "utf8");
  ok("the template's header is the register's columns", template.split(/\r?\n/)[0] === REGISTER_COLUMNS.join(","));
  const rows = registerRowsFromCsv(template);
  ok("every template row is read, with its spreadsheet line", rows.length === 5 && rows[0].line === 2 && rows[4].line === 6);
  ok("a blank valid_until is left out, for the season's end", rows.every((r) => !("valid_until" in r)));
  ok("a blank side is left out", !("team_code" in rows[0]) && rows[2].team_code === "U14A");
  const odd = registerRowsFromCsv("﻿Email,Name,ROLE,extra\r\nA@B.CO,A Person,coach,x\r\n\r\n");
  ok("a BOM, CRLF, any column order and case, and a blank line", odd.length === 1 && odd[0].email === "A@B.CO" && odd[0].name === "A Person" && odd[0].role === "coach");
  let thrown = null;
  try { registerRowsFromCsv("name,role\nA,coach\n"); } catch (/** @type {any} */ e) { thrown = e; }
  ok("a file with no email column is refused in words", thrown?.message === "csv_columns" && /no email column/.test(thrown?.detail ?? ""));
}

console.log("\n" + "─".repeat(52));
console.log(`REGISTER API: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
