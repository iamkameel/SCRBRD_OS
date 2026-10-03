#!/usr/bin/env node
/**
 * The pilot load's dry run before the dry run: reads the school's lists and
 * says what is wrong with them before anybody loads anything.
 *
 * READ-ONLY, AND LOCAL. It reads the CSV files it is given and nothing else.
 * It sends nothing anywhere. With --db it also asks the LOCAL database one
 * question, birth_age_group() (db/47), inside a read-only transaction, so the
 * age-group rule it applies is the database's own and not a copy; without
 * --db it uses teams.mjs, which computes the same thing.
 *
 *   node tools/pilot-load-check.mjs --dir <folder holding players.csv, staff.csv, guardians.csv>
 *   node tools/pilot-load-check.mjs --players p.csv --staff s.csv --guardians g.csv [--on 2026-10-15] [--db]
 *
 * The files are docs/pilot/PILOT_LOAD.md's: players.csv in the importer's
 * own columns (POST /api/import/players), staff.csv and guardians.csv as the
 * office's worksheets for Settings → People. Exit 1 when there is any error,
 * 0 when there are only warnings or nothing.
 *
 * It prints names to this terminal and nowhere else. Keep the school's files
 * outside the repository (PILOT_LOAD.md, "Where the lists live").
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, mapRows, asText, asEmail, asOneOf } from "../services/api/io/csv.mjs";
import { IMPORTS, GUARDIAN_RELATIONSHIPS } from "../services/api/io/import-api.mjs";
import { resolveBirthDate, BIRTH_DATE_MESSAGE } from "@scrbrd/policy/date-of-birth";
import { parseTeam, isValidTeam, ageAtCutoff } from "@scrbrd/policy/teams";
import { ROLES, SUBJECT_SCOPED_ROLES, TEAM_SCOPED_ROLES, mayGrantRole } from "@scrbrd/policy/roles";

/** The office's staff worksheet: one row per role a person is to hold. */
export const STAFF_COLUMNS = ["name", "email", "role", "team_code"];
/** The guardians import's own file (POST /api/import/guardians): one row per guardian per child. */
export const GUARDIAN_COLUMNS = IMPORTS.guardians.template;

// Parsed with the importer's own column parsers, so "does not look like an
// email address" reads the same here as it will on the server. The role and
// the guardian's email are checked by hand below, for a sentence that says
// what to do rather than one that lists thirty roles.
const STAFF_SPEC = {
  name:      { required: true, parse: asText(120) },
  email:     { required: true, parse: asEmail },
  role:      { required: true, parse: asText(30) },
  team_code: { parse: asText(8) },
};
const GUARDIAN_SPEC = {
  player_full_name: { required: true, parse: asText(120) },
  guardian_name:    { required: true, parse: asText(120) },
  guardian_email:   { parse: asText(254) },
  relationship:     { required: true, parse: asOneOf(GUARDIAN_RELATIONSHIPS) },
};

// Roles that are never a staff line: a person's link to a child or to his
// own record is made against the child, in guardians.csv or by the office.
const NOT_STAFF = new Set([...SUBJECT_SCOPED_ROLES, "player"]);
// Platform-wide: nobody at a school is enrolled into these from a list.
const PLATFORM = new Set(["superadmin", "platformadmin"]);

/** The name the importer matches on (lower(btrim())), with runs of spaces closed too. */
const norm = (/** @type {unknown} */ s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * birth_age_group() (db/47) in JavaScript: the age on the season's cut-off
 * (teams.mjs, 1 January for school cricket), U9 for nine and under, U10–U16,
 * and 'open' from seventeen.
 * @param {string | null | undefined} born  YYYY-MM-DD
 * @param {Date | string} on
 * @returns {string | null}
 */
export function birthAgeGroup(born, on) {
  const a = ageAtCutoff(born, on, "school");
  if (a == null) return null;
  if (a <= 9) return "U9";
  if (a <= 16) return `U${a}`;
  return "open";
}

/** YYYY-MM-DD of a Date or a date string. */
const isoDay = (/** @type {Date | string} */ d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

/** 'U13' → 13, 'open' → Infinity. */
const groupAge = (/** @type {string} */ g) => (g === "open" ? Infinity : Number(g.slice(1)));

/**
 * @typedef {{ level: "error" | "warning", file: string, line: number | null, column: string | null, message: string }} Problem
 */

/**
 * Check the lists. Pure: text in, problems out.
 *
 * @param {{ players?: string, staff?: string, guardians?: string }} files  CSV text, any subset
 * @param {{ on?: Date | string, ageGroupOf?: (born: string) => string | null }} [opts]
 *   on: the day the age groups are worked out for (default today);
 *   ageGroupOf: the database's birth_age_group, when --db supplied it.
 * @returns {{ problems: Problem[], summary: { players: number, staff: number, guardians: number, officeCannotGrant: { line: number, role: string }[] } }}
 */
export function checkLoad(files, { on = new Date(), ageGroupOf } = {}) {
  /** @type {Problem[]} */
  const problems = [];
  const add = (/** @type {Problem["level"]} */ level, /** @type {string} */ file,
               /** @type {number | null} */ line, /** @type {string | null} */ column, /** @type {string} */ message) =>
    problems.push({ level, file, line, column, message });
  const groupOf = ageGroupOf ?? ((/** @type {string} */ born) => birthAgeGroup(born, on));

  /**
   * Who an email belongs to, across all three files. One email is one
   * account, and one account is one person: the same person may hold two
   * roles (a coach whose son plays), but two people may not share one.
   * @type {Map<string, { name: string, file: string, line: number }>}
   */
  const owners = new Map();
  const claimEmail = (/** @type {string} */ email, /** @type {string} */ name, /** @type {string} */ file,
                      /** @type {number} */ line, /** @type {string} */ column) => {
    const was = owners.get(email);
    if (!was) { owners.set(email, { name, file, line }); return; }
    if (norm(was.name) !== norm(name)) {
      add("error", file, line, column,
          `${email} is already ${was.name}'s (${was.file} line ${was.line}). One email is one account, and an ` +
          `account is one person: ${name} needs an address of their own.`);
    }
  };

  /** @param {string} file @param {string} text @param {string[]} columns @param {Record<string, any>} spec */
  const read = (file, text, columns, spec) => {
    const parsed = parseCsv(text);
    const mapped = mapRows(parsed, spec);
    for (const e of mapped.errors) add("error", file, e.line, e.column, e.message);
    for (const u of mapped.unknown) {
      add("warning", file, 1, u, `"${u}" is not a column this step reads, and will be ignored. ` +
                                 `The columns are: ${columns.join(", ")}.`);
    }
    return mapped.rows;
  };

  // ── players.csv: the importer's file ───────────────────────────────
  /** @type {Map<string, { line: number, born: string | null, name: string }>} */
  const players = new Map();
  let playerRows = 0;
  if (files.players != null) {
    const F = "players.csv";
    const def = IMPORTS.players;
    const rows = read(F, files.players, def.template, def.spec);
    playerRows = rows.length;
    /** @type {Map<string, number>} */ const ids = new Map();
    /** @type {Map<string, number>} */ const squads = new Map();
    for (const { line, values: v } of rows) {
      const key = norm(v.full_name);
      const first = players.get(key);
      if (first) {
        add("error", F, line, "full_name",
            `${v.full_name} is already on line ${first.line}. The importer matches on the name, so the second ` +
            "row would overwrite the first. Two boys with one name need telling apart (an initial, a second name).");
        continue;
      }
      // The importer's own birth-date rule, as a new player meets it.
      const dob = resolveBirthDate({ born: v.born, idNumber: v.id_number });
      if (!dob.ok) {
        add("error", F, line, dob.field, BIRTH_DATE_MESSAGE[dob.reason] ?? dob.reason);
      } else if (dob.warning) {
        add("warning", F, line, "id_number", BIRTH_DATE_MESSAGE[dob.warning] ?? dob.warning);
      }
      const born = dob.ok ? dob.born : null;
      players.set(key, { line, born, name: v.full_name });

      // What the pilot does not load (PILOT_LOAD.md): the columns exist in the
      // importer; nothing on day one needs them filled.
      if (v.id_number) {
        add("warning", F, line, "id_number",
            "leave the ID number out: born is enough, and no day-one step reads an ID number");
        if (ids.has(v.id_number)) add("error", F, line, "id_number", `the same ID number is on line ${ids.get(v.id_number)}`);
        else ids.set(v.id_number, line);
      }
      for (const col of ["email", "phone", "hometown"]) {
        if (v[col]) add("warning", F, line, col, `leave ${col} blank: no day-one step needs a pupil's ${col}`);
      }
      if (v.email) claimEmail(v.email, v.full_name, F, line, "email");

      // The side, and whether his birthday lets him play in it.
      const team = v.team_code;
      if (!team) {
        add("warning", F, line, "team_code", "no side: he will be on the roster but in no team's squad");
        continue;
      }
      if (!isValidTeam(team, "school")) {
        add("error", F, line, "team_code",
            `${team} is not a school side. Sides are U9–U16 with an optional A–F (U14A), or 1XI, 2XI, 3XI…`);
        continue;
      }
      if (v.squad_no != null) {
        const sk = `${team}#${v.squad_no}`;
        if (squads.has(sk)) add("warning", F, line, "squad_no", `squad number ${v.squad_no} in ${team} is also on line ${squads.get(sk)}`);
        else squads.set(sk, line);
      }
      if (!born) continue;
      const t = /** @type {NonNullable<ReturnType<typeof parseTeam>>} */ (parseTeam(team));
      if (t.kind !== "age") continue;              // an open side takes any age
      const group = groupOf(born);
      if (!group) continue;
      const age = groupAge(group);
      if (age > t.age) {
        add("error", F, line, "team_code",
            `born ${born}, he is ${group} by birth, which is older than ${team}: ${team} is for ` +
            `${t.age} and under on 1 January. Check the side or the year of birth.`);
      } else if (t.age - age >= 3) {
        add("warning", F, line, "born",
            `born ${born}, he is ${group} by birth, ${t.age - age} years younger than ${team}. ` +
            "Playing up is allowed; three years up is usually a mistyped year.");
      }
    }
  }

  // ── staff.csv: the office's worksheet for Settings → People ─────────
  /** @type {{ line: number, role: string }[]} */
  const officeCannotGrant = [];
  let staffRows = 0;
  if (files.staff != null) {
    const F = "staff.csv";
    const rows = read(F, files.staff, STAFF_COLUMNS, STAFF_SPEC);
    staffRows = rows.length;
    /** @type {Map<string, number>} */ const seen = new Map();
    for (const { line, values: v } of rows) {
      const role = String(v.role).trim().toLowerCase();
      const team = v.team_code ? String(v.team_code).trim() : null;
      const key = `${v.email}|${role}|${team ?? ""}`;
      if (seen.has(key)) {
        add("error", F, line, null, `the same person, role and side is on line ${seen.get(key)}`);
        continue;
      }
      seen.set(key, line);
      claimEmail(v.email, v.name, F, line, "email");

      if (!ROLES.includes(role)) {
        add("error", F, line, "role", `"${v.role}" is not a SCRBRD role. Coaching staff are coach, assistantcoach ` +
                                      "and teammanager; see PILOT_LOAD.md for the rest.");
        continue;
      }
      if (NOT_STAFF.has(role)) {
        add("error", F, line, "role", role === "guardian"
          ? "parents go in guardians.csv, against their child"
          : `${role} is a link to a child's record, made against the child, never from the staff list`);
        continue;
      }
      if (PLATFORM.has(role)) {
        add("error", F, line, "role", `${role} is a platform role; nobody at a school is enrolled into it`);
        continue;
      }
      if (TEAM_SCOPED_ROLES.includes(role)) {
        if (!team) add("error", F, line, "team_code", `a ${role} is a ${role} of a side: name it (U14A, 1XI…)`);
        else if (!isValidTeam(team, "school")) add("error", F, line, "team_code", `${team} is not a school side`);
      } else if (team) {
        add("warning", F, line, "team_code", `${role} is a school-wide role; the side ${team} will be ignored`);
      }
      if (role === "dso") {
        add("warning", F, line, "role",
            "the DSO is appointed by the principal on the day, signed in as the principal, not loaded from this list");
      }
      if (!mayGrantRole("schooladmin", role)) officeCannotGrant.push({ line, role });
    }
  }

  // ── guardians.csv: one row per guardian per child ───────────────────
  let guardianRows = 0;
  /** @type {Set<string>} */
  const linked = new Set();
  if (files.guardians != null) {
    const F = "guardians.csv";
    const rows = read(F, files.guardians, GUARDIAN_COLUMNS, GUARDIAN_SPEC);
    guardianRows = rows.length;
    /** @type {Map<string, number>} */ const seen = new Map();
    for (const { line, values: v } of rows) {
      if (!v.guardian_email) {
        add("error", F, line, "guardian_email",
            `no email for ${v.guardian_name}: a guardian's account is opened on an email, and without one ` +
            "the family cannot be linked. Ask the office for it, or leave this row for later.");
        continue;
      }
      if (v.relationship !== "parent") {
        add("error", F, line, "relationship",
            `the import records a parent link only, so a ${v.relationship} cannot be loaded from this file yet. ` +
            "Take this row out and raise it with Kameel.");
      }
      let email;
      try { email = asEmail(v.guardian_email); }
      catch (/** @type {any} */ e) { add("error", F, line, "guardian_email", e.message); continue; }

      const child = norm(v.player_full_name);
      const key = `${child}|${email}`;
      if (seen.has(key)) { add("error", F, line, null, `the same guardian and child is on line ${seen.get(key)}`); continue; }
      seen.set(key, line);
      claimEmail(email, v.guardian_name, F, line, "guardian_email");

      if (files.players == null) continue;
      const p = players.get(child);
      if (!p) {
        add("error", F, line, "player_full_name",
            `${v.player_full_name} is not in players.csv. The name has to match his row there, letter for letter.`);
        continue;
      }
      linked.add(child);
      // Eighteen on the day, not on the cut-off: majority_on() is his birthday.
      if (p.born && `${Number(p.born.slice(0, 4)) + 18}${p.born.slice(4)}` <= isoDay(on)) {
        add("error", F, line, "player_full_name",
            `${p.name} is eighteen (born ${p.born}). Guardian access ends at eighteen, and the server refuses the link.`);
      }
    }
    if (files.players != null) {
      for (const [key, p] of players) {
        if (!linked.has(key)) {
          add("warning", "players.csv", p.line, "full_name",
              `no guardian for ${p.name} in guardians.csv: nobody can give his consents until one is linked`);
        }
      }
    }
  }

  return { problems, summary: { players: playerRows, staff: staffRows, guardians: guardianRows, officeCannotGrant } };
}

/** @param {Problem} p */
export const formatProblem = (p) =>
  `${p.level === "error" ? "✗" : "!"} ${p.file}${p.line ? ` line ${p.line}` : ""}${p.column ? ` (${p.column})` : ""}: ${p.message}`;

// ── The command line ──────────────────────────────────────────────────
async function main(argv) {
  const opt = (/** @type {string} */ k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const dir = opt("--dir");
  const pathOf = (/** @type {string} */ kind) => opt(`--${kind}`) ?? (dir && existsSync(join(dir, `${kind}.csv`)) ? join(dir, `${kind}.csv`) : null);
  const paths = { players: pathOf("players"), staff: pathOf("staff"), guardians: pathOf("guardians") };
  if (!paths.players && !paths.staff && !paths.guardians) {
    console.error("usage: node tools/pilot-load-check.mjs --dir <folder> | --players p.csv --staff s.csv --guardians g.csv [--on YYYY-MM-DD] [--db]");
    return 2;
  }
  const onArg = opt("--on");
  if (onArg && !/^\d{4}-\d{2}-\d{2}$/.test(onArg)) { console.error("--on takes a date like 2026-10-15"); return 2; }
  const on = onArg ? new Date(onArg + "T00:00:00Z") : new Date();

  /** @type {{ players?: string, staff?: string, guardians?: string }} */
  const files = {};
  for (const [k, p] of Object.entries(paths)) if (p) files[/** @type {"players"} */ (k)] = readFileSync(p, "utf8");

  let ageGroupOf;
  if (argv.includes("--db")) {
    // The database's own rule, asked once for every birthday in the file.
    // Read-only, local: db-url.mjs's address (SCRBRD_DB / SCRBRD_PORT_OFFSET).
    const { default: pg } = await import("pg");
    const { ownerUrl } = await import("./db-url.mjs");
    const { header, rows: cells } = parseCsv(files.players ?? "");
    const col = header.indexOf("born");
    const borns = [...new Set(cells.map((r) => (r[col] ?? "").trim())
      .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b)))];
    const db = new pg.Client({ connectionString: ownerUrl() });
    await db.connect();
    try {
      await db.query("begin read only");
      const { rows } = await db.query(
        `select b, birth_age_group(b::date, $2::date) as g from unnest($1::text[]) b`,
        [borns, on.toISOString().slice(0, 10)]);
      await db.query("rollback");
      const byBorn = new Map(rows.map((r) => [r.b, r.g]));
      for (const b of borns) {
        if (byBorn.get(b) !== birthAgeGroup(b, on)) {
          console.log(`! born ${b}: the database says ${byBorn.get(b)}, teams.mjs says ${birthAgeGroup(b, on)}; using the database's`);
        }
      }
      ageGroupOf = (/** @type {string} */ born) => byBorn.get(born) ?? birthAgeGroup(born, on);
    } finally { await db.end(); }
  }

  const { problems, summary } = checkLoad(files, { on, ageGroupOf });
  for (const p of problems) console.log(formatProblem(p));
  const errors = problems.filter((p) => p.level === "error").length;
  const warnings = problems.length - errors;
  console.log(`\n${summary.players} players, ${summary.staff} staff lines, ${summary.guardians} guardian lines; ` +
              `age groups as on ${on.toISOString().slice(0, 10)}${ageGroupOf ? " (from the database)" : ""}.`);
  if (summary.officeCannotGrant.length) {
    console.log("Roles the school office cannot grant (Kameel or the principal enrols these): " +
      summary.officeCannotGrant.map((x) => `${x.role} (staff.csv line ${x.line})`).join(", ") + ".");
  }
  console.log(`${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}. ` +
              (errors ? "Fix the errors before loading anything." : "Nothing here stops the load."));
  return errors ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
