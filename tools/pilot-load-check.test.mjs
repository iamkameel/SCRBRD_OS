#!/usr/bin/env node
/**
 * tools/pilot-load-check.mjs: each problem it exists to catch, caught, and
 * the templates in docs/pilot/templates/ clean under it.
 *
 * No database: the age-group rule is teams.mjs's here, and the --db path is a
 * stand-in function. Every name is invented.
 *
 *   node tools/pilot-load-check.test.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLoad, birthAgeGroup, STAFF_COLUMNS, GUARDIAN_COLUMNS } from "./pilot-load-check.mjs";
import { IMPORTS } from "../services/api/io/import-api.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "docs", "pilot", "templates");
const SCRIPT = join(HERE, "pilot-load-check.mjs");
const ON = "2026-10-15";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const P_HEAD = IMPORTS.players.template.join(",");
const S_HEAD = STAFF_COLUMNS.join(",");
const G_HEAD = GUARDIAN_COLUMNS.join(",");
/** A players.csv row from the columns that matter; the rest blank. */
const prow = (/** @type {string} */ name, /** @type {string} */ team, /** @type {string} */ born, idNumber = "") =>
  `${name},${team},,,,,,${born},${idNumber},,,`;
const run = (/** @type {Parameters<typeof checkLoad>[0]} */ files, opts = {}) => checkLoad(files, { on: ON, ...opts });
/** The problems at one file and line. */
const at = (/** @type {ReturnType<typeof checkLoad>} */ r, /** @type {string} */ file, /** @type {number} */ line) =>
  r.problems.filter((p) => p.file === file && p.line === line);

group("A. The templates are clean, in the columns the steps read");
{
  const read = (/** @type {string} */ f) => readFileSync(join(TEMPLATES, f), "utf8");
  ok("players.csv's header is the importer's own, column for column",
     read("players.csv").split(/\r?\n/)[0] === P_HEAD);
  ok("staff.csv's header is the checker's", read("staff.csv").split(/\r?\n/)[0] === S_HEAD);
  ok("guardians.csv's header is the checker's", read("guardians.csv").split(/\r?\n/)[0] === G_HEAD);
  const r = run({ players: read("players.csv"), staff: read("staff.csv"), guardians: read("guardians.csv") });
  ok("together they have no error and no warning", r.problems.length === 0);
  ok("...and every name in them is plainly invented",
     ["players.csv", "staff.csv", "guardians.csv"].every((f) =>
       read(f).split(/\r?\n/).slice(1).filter(Boolean).every((l) => /^Fake /.test(l))));
  ok("the roles the office cannot grant are named, not refused",
     r.summary.officeCannotGrant.map((x) => x.role).join() === "principal,schooladmin");
}

group("B. Duplicates");
{
  const r = run({ players: [P_HEAD, prow("Fake Pupil One", "U14A", "2012-03-14"),
                                   prow("  fake   pupil ONE ", "U14B", "2012-03-14")].join("\n") });
  const e = at(r, "players.csv", 3);
  ok("a second row for the same boy is an error, whatever its case and spacing",
     e.some((p) => p.level === "error" && /already on line 2/.test(p.message)));
  const ids = run({ players: [P_HEAD, prow("Fake A", "U14A", "", "1104075800085"),
                                      prow("Fake B", "U14A", "", "1104075800085")].join("\n") });
  ok("the same ID number on two boys is an error", at(ids, "players.csv", 3).some((p) => p.level === "error" && /same ID number/.test(p.message)));
  ok("...and an ID number at all is a warning: born is enough",
     at(ids, "players.csv", 2).some((p) => p.level === "warning" && p.column === "id_number"));
  const s = run({ staff: [S_HEAD, "Fake Coach,fake.coach@example.invalid,coach,U14A",
                                  "Fake Coach,FAKE.COACH@example.invalid,coach,U14A"].join("\n") });
  ok("the same person, role and side twice in staff.csv is an error",
     at(s, "staff.csv", 3).some((p) => p.level === "error"));
  const g = run({ guardians: [G_HEAD, "Fake Pupil,Fake Parent,fake.parent@example.invalid,parent",
                                      "Fake Pupil,Fake Parent,fake.parent@example.invalid,parent"].join("\n") });
  ok("the same guardian and child twice is an error", at(g, "guardians.csv", 3).some((p) => p.level === "error"));
}

group("C. A bad date of birth");
{
  const r = run({ players: [P_HEAD,
    prow("Fake Slash", "U14A", "14/03/2012"),
    prow("Fake Thirtieth", "U14A", "2012-02-30"),
    prow("Fake Nobirthday", "U14A", ""),
    prow("Fake Mismatch", "U14A", "2012-03-14", "1104075800085")].join("\n") });
  ok("day/month order is refused, not guessed",
     at(r, "players.csv", 2).some((p) => p.level === "error" && p.column === "born"));
  ok("a date that does not exist is refused",
     at(r, "players.csv", 3).some((p) => p.level === "error" && /not a real date/.test(p.message)));
  ok("a new boy with neither a birthday nor an ID number is refused",
     at(r, "players.csv", 4).some((p) => p.level === "error" && p.column === "born"));
  ok("an ID number that disagrees with the birthday is refused",
     at(r, "players.csv", 5).some((p) => p.level === "error" && p.column === "id_number"));
}

group("D. The age group against the birth date (birth_age_group)");
{
  ok("thirteen on 1 January is U13", birthAgeGroup("2013-01-01", ON) === "U13");
  ok("...a day younger is U12", birthAgeGroup("2013-01-02", ON) === "U12");
  ok("nine and under is U9", birthAgeGroup("2018-05-05", ON) === "U9");
  ok("seventeen is open", birthAgeGroup("2009-01-01", ON) === "open");
  const r = run({ players: [P_HEAD,
    prow("Fake Toobig", "U14A", "2010-01-15"),      // fifteen on 1 Jan 2026
    prow("Fake Fits", "U14A", "2012-01-01"),        // fourteen: U14, the top of it
    prow("Fake Wayup", "U14A", "2016-06-01"),       // nine: five years up
    prow("Fake Opener", "1XI", "2008-02-02"),       // open side, any age
    prow("Fake Nosuch", "U17A", "2010-01-15")].join("\n") });
  ok("a boy older than his side is an error naming his group by birth",
     at(r, "players.csv", 2).some((p) => p.level === "error" && /U15 by birth/.test(p.message)));
  ok("fourteen in a U14 side is fine", at(r, "players.csv", 3).length === 0);
  ok("three or more years up is a warning about the year",
     at(r, "players.csv", 4).some((p) => p.level === "warning" && /mistyped year/.test(p.message)));
  ok("an open side takes any age", at(r, "players.csv", 5).length === 0);
  ok("a side a school does not field is an error", at(r, "players.csv", 6).some((p) => p.level === "error" && p.column === "team_code"));
  const db = run({ players: [P_HEAD, prow("Fake Fits", "U14A", "2012-01-01")].join("\n") },
                 { ageGroupOf: () => "open" });
  ok("with --db, the database's answer is the one applied",
     at(db, "players.csv", 2).some((p) => p.level === "error" && /open by birth/.test(p.message)));
}

group("E. Guardians");
{
  const players = [P_HEAD, prow("Fake Pupil", "U14A", "2012-03-14"),
                           prow("Fake Adult", "1XI", "2008-01-20"),
                           prow("Fake Orphanrow", "U14A", "2012-04-04")].join("\n");
  const r = run({ players, guardians: [G_HEAD,
    "Fake Pupil,Fake Parent,,parent",
    "Fake Pupil,Fake Parent Two,not-an-email,parent",
    "Fake Nobody,Fake Parent Three,fake.three@example.invalid,parent",
    "Fake Adult,Fake Parent Four,fake.four@example.invalid,parent",
    "fake pupil,Fake Parent Five,fake.five@example.invalid,parent",
    "Fake Pupil,Fake Gran,fake.gran@example.invalid,grandparent"].join("\n") });
  ok("a missing guardian email is an error",
     at(r, "guardians.csv", 2).some((p) => p.level === "error" && p.column === "guardian_email" && /no email/.test(p.message)));
  ok("...and so is one that is not an email", at(r, "guardians.csv", 3).some((p) => p.level === "error"));
  ok("a child who is not in players.csv is an error", at(r, "guardians.csv", 4).some((p) => p.level === "error"));
  ok("a guardian for an eighteen-year-old is an error", at(r, "guardians.csv", 5).some((p) => /eighteen/.test(p.message)));
  ok("the child's name matches as the importer matches, ignoring case", at(r, "guardians.csv", 6).length === 0);
  ok("a relationship the import cannot record yet is an error",
     at(r, "guardians.csv", 7).some((p) => p.level === "error" && p.column === "relationship" && /parent link only/.test(p.message)));
  const noRel = run({ guardians: ["player_full_name,guardian_name,guardian_email",
                                  "Fake Pupil,Fake Parent,fake.parent@example.invalid"].join("\n") });
  ok("...and a file with no relationship column is refused, not assumed parent",
     noRel.problems.some((p) => p.level === "error" && /no relationship column/.test(p.message)));
  ok("a boy with no guardian at all is a warning",
     at(r, "players.csv", 4).some((p) => p.level === "warning" && /no guardian/.test(p.message)));
}

group("F. Staff, and an email already in use");
{
  const r = run({
    staff: [S_HEAD,
      "Fake Coach,fake.coach@example.invalid,coach,U14A",
      "Fake Other,fake.coach@example.invalid,scorer,",
      "Fake Nosquad,fake.nosquad@example.invalid,coach,",
      "Fake Parentrow,fake.parentrow@example.invalid,guardian,",
      "Fake Owner,fake.owner@example.invalid,superadmin,",
      "Fake Wizard,fake.wizard@example.invalid,wizard,",
      "Fake Dso,fake.dso@example.invalid,dso,"].join("\n"),
    guardians: [G_HEAD,
      "Fake Pupil,Fake Coach,fake.coach@example.invalid,parent",
      "Fake Pupil Two,Fake Stranger,fake.coach@example.invalid,parent"].join("\n"),
  });
  ok("a staff email already used by another person is an error",
     at(r, "staff.csv", 3).some((p) => p.level === "error" && /already Fake Coach's/.test(p.message)));
  ok("the same person as a coach and a parent is one account with two roles, not an error",
     at(r, "guardians.csv", 2).length === 0);
  ok("a parent row using a staff member's email under another name is an error",
     at(r, "guardians.csv", 3).some((p) => p.level === "error" && /already Fake Coach's/.test(p.message)));
  ok("a coach with no side is an error", at(r, "staff.csv", 4).some((p) => p.level === "error" && p.column === "team_code"));
  ok("a guardian in the staff list is sent to guardians.csv", at(r, "staff.csv", 5).some((p) => /guardians\.csv/.test(p.message)));
  ok("a platform role is refused", at(r, "staff.csv", 6).some((p) => p.level === "error"));
  ok("a role that does not exist is refused", at(r, "staff.csv", 7).some((p) => p.level === "error"));
  ok("the DSO is a warning: the principal appoints on the day",
     at(r, "staff.csv", 8).some((p) => p.level === "warning" && /principal/.test(p.message)));
  ok("...and is among the roles the office cannot grant",
     r.summary.officeCannotGrant.some((x) => x.role === "dso"));
  const pe = run({ players: [P_HEAD, "Fake Pupil,U14A,,,,,,2012-03-14,,fake.coach@example.invalid,,"].join("\n"),
                   staff: [S_HEAD, "Fake Coach,fake.coach@example.invalid,coach,U14A"].join("\n") });
  ok("a pupil's email reused by a member of staff is an error",
     at(pe, "staff.csv", 2).some((p) => p.level === "error"));
}

group("G. It reads, and sends nothing");
{
  const src = readFileSync(SCRIPT, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  ok("no network call", !/\bfetch\(|node:https?|node:net|XMLHttpRequest/.test(src));
  ok("no file written", !/writeFile|appendFile|createWriteStream|unlink|rmSync/.test(src));
  ok("its one database question is a read-only transaction",
     /begin read only/.test(src) && !/\b(insert|update|delete)\s+(into|from|\w+\s+set)\b/i.test(src));
}

group("H. The command line");
{
  const clean = spawnSync(process.execPath, [SCRIPT, "--dir", TEMPLATES, "--on", ON], { encoding: "utf8" });
  ok("the templates exit 0", clean.status === 0);
  ok("...and say so", /0 errors, 0 warnings/.test(clean.stdout));
  const dir = mkdtempSync(join(tmpdir(), "pilot-check-"));
  try {
    writeFileSync(join(dir, "players.csv"), [P_HEAD, prow("Fake Toobig", "U14A", "2010-01-15")].join("\n"));
    const bad = spawnSync(process.execPath, [SCRIPT, "--dir", dir, "--on", ON], { encoding: "utf8" });
    ok("a file with an error exits 1", bad.status === 1);
    ok("...naming the file, the line and the column", /players\.csv line 2 \(team_code\)/.test(bad.stdout));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const none = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  ok("no files is a usage error, exit 2", none.status === 2);
}

console.log(`\n${"─".repeat(52)}\nPILOT LOAD CHECK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
