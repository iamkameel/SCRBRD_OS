#!/usr/bin/env node
/**
 * SCRBRD-083. What a signed-out page may show about a pupil, proved without a
 * database: docs/policy/PUBLIC_DATA.md, §6 step 1.
 *
 * Four things are held here, and the second is the one that makes the rule
 * stick rather than merely exist:
 *
 *   §2  every surface the document decides is decided here, and nothing else;
 *   §3  every column tables.mjs masks on a table about a pupil is on the
 *       never-public list, or on the allow-list with the surface that permits
 *       it — so a column masked tomorrow fails this suite until somebody
 *       places it — and every entry on either list is a real column in db/;
 *   §1.4 the "D Erasmus" formatter, on South African names;
 *   §4  the name rule, branch by branch, including the two that are easy to
 *       get subtly wrong: a withdrawal reaching old scorecards (C3) and a boy
 *       turning eighteen (C6).
 *
 * Falsified by: dropping `player.hometown` from NEVER_PUBLIC (the coverage
 * group names it); misspelling an entry (the schema group names it); letting
 * a never-public boy through publicName() (the C5 group fails); and judging
 * consent on the match day instead of the serving day (the C3 group fails).
 * The checker's own ability to fail is also asserted below, against lists
 * built to be wrong, so a coverage check that loops over nothing cannot pass.
 *
 *   node packages/policy/test/public.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DECISIONS, SURFACES, surface, ROBOTS,
  NEVER_PUBLIC_RULES, NEVER_PUBLIC, PUBLIC_DESPITE_MASK, neverPublicRule, assertPublicSelect,
  POSITION_LABELS, publicName, initialAndSurname,
} from "../src/public.mjs";
import { TABLES, maskedColumns } from "../src/tables.mjs";
/** @import { NameFacts, NameConsent } from "../src/public.mjs" */
/** @import { TableDef } from "../src/tables.mjs" */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// SCRBRD_DB_DIR, as in invariants.test.mjs: the migrations are frozen, so a
// falsification against the schema runs on a scratch copy.
const DB = process.env.SCRBRD_DB_DIR ?? join(ROOT, "db");

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${d}`}`);
  if (c) pass++; else fail++;
};
const group = (/** @type {string} */ t) => console.log("\n" + t);
/** @param {() => unknown} f */
const throws = (f) => { try { f(); return false; } catch { return true; } };

const DOC = readFileSync(join(ROOT, "docs", "policy", "PUBLIC_DATA.md"), "utf8");

// ═══════════════════════════════════════════════════════════════════
group("§2 — every surface the document decides, and nothing it does not");
// ═══════════════════════════════════════════════════════════════════
{
  const inDoc = [...DOC.matchAll(/^\| ([LAD]\d) \|/gm)].map((m) => m[1]);
  const inCode = Object.keys(SURFACES);
  ok(`the document's table decides ${inDoc.length} surfaces`, inDoc.length === 19, inDoc.join(" "));
  ok("every one of them is decided here",
     inDoc.every((id) => inCode.includes(id)), inDoc.filter((id) => !inCode.includes(id)).join(" "));
  ok("and nothing here that the document did not decide",
     inCode.every((id) => inDoc.includes(id)), inCode.filter((id) => !inDoc.includes(id)).join(" "));

  const all = Object.values(SURFACES);
  ok("each surface knows its own id", Object.entries(SURFACES).every(([k, s]) => s.id === k));
  ok("each decision is one of the five", all.every((s) => DECISIONS.includes(s.decision)));
  ok("`public` is the decision, not a second opinion",
     all.every((s) => s.public === ["public", "name_rule", "team_level"].includes(s.decision)));
  ok("each carries the document's words", all.every((s) => s.what.length > 5 && s.rule.length > 4));
  ok("the table is frozen, surface by surface",
     Object.isFrozen(SURFACES) && all.every((s) => Object.isFrozen(s) && Object.isFrozen(s.needs)));

  const d = (/** @type {string} */ id) => surface(id).decision;
  ok("A3 leaderboards: not public", d("A3") === "signed_in" && surface("A3").public === false);
  ok("A4 a page per player: never", d("A4") === "never" && !surface("A4").public);
  ok("A7 team sheets before the match: not public", d("A7") === "signed_in");
  ok("A8 photographs: never", d("A8") === "never");
  ok("D4 news naming pupils: signed in", d("D4") === "signed_in");
  ok("D1 search engines: never", d("D1") === "never");
  ok("L6 a typed name: never", d("L6") === "never");
  ok("L7 shot maps and wagon wheels: team level", d("L7") === "team_level" && surface("L7").public);
  ok("L2, L4, L5, A2, A5, A6 and D2 name pupils only by the name rule",
     ["L2", "L4", "L5", "A2", "A5", "A6", "D2"].every((id) => d(id) === "name_rule"));
  ok("L1, L3, A1 and D3 are public", ["L1", "L3", "A1", "D3"].every((id) => d(id) === "public"));
  ok("off until switched on: L1 and A1 need publishing (§1.1)",
     surface("L1").needs.includes("published") && surface("A1").needs.includes("published"));
  ok("A5: only an honour marked public", surface("A5").needs.includes("honour.is_public"));
  ok("public pages ask not to be indexed (D1)", ROBOTS === "noindex");

  ok("an undecided id is refused, not answered", throws(() => surface("Z9")));
  ok("...and so is a near miss", throws(() => surface("a3")));
  ok("...and a prototype key", throws(() => surface("constructor")));
}

// ═══════════════════════════════════════════════════════════════════
//  The schema, read from db/ — the source of truth for "does this exist".
//
//  tables.mjs names only the columns it masks, and not every table (the
//  disciplinary record's policies are hand-written in db/25), so an existence
//  check against it alone could not see most of the never-public list. This
//  reads CREATE TABLE and ALTER TABLE ... ADD/DROP/RENAME COLUMN across the
//  migrations in the order the migrator runs them.
// ═══════════════════════════════════════════════════════════════════

/** Comments out, strings kept: `--` and block comments can hold "CREATE TABLE x (" in prose. @param {string} sql */
function stripComments(sql) {
  let out = "", i = 0;
  while (i < sql.length) {
    const c = sql[i], n = sql[i + 1];
    if (c === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end < 0 ? sql.length : end + 1;
      out += sql.slice(i, stop); i = stop;              // '' re-enters here, harmlessly
    } else if (c === "-" && n === "-") {
      const end = sql.indexOf("\n", i); i = end < 0 ? sql.length : end;
    } else if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2); i = end < 0 ? sql.length : end + 2;
    } else { out += c; i++; }
  }
  return out;
}

/** The text inside the parenthesis that opens at `open`. @param {string} sql @param {number} open */
function inside(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "'") { i = sql.indexOf("'", i + 1); if (i < 0) break; continue; }
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) return sql.slice(open + 1, i);
  }
  return "";
}

/** Column names in a CREATE TABLE body, constraints skipped. @param {string} body */
function columnsOf(body) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0, from = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "'") { i = body.indexOf("'", i + 1); if (i < 0) break; continue; }
    if (body[i] === "(") depth++;
    else if (body[i] === ")") depth--;
    else if (body[i] === "," && depth === 0) { parts.push(body.slice(from, i)); from = i + 1; }
  }
  parts.push(body.slice(from));
  return parts.map((p) => p.trim().match(/^("[^"]+"|\w+)/)?.[1] ?? "")
    .filter((w) => w && !/^(constraint|primary|unique|check|foreign|exclude|like)$/i.test(w))
    .map((w) => (w.startsWith('"') ? w.slice(1, -1) : w.toLowerCase()));
}

/** @param {string} dir @returns {Map<string, Set<string>>} */
function readSchema(dir) {
  /** @type {Map<string, Set<string>>} */
  const tables = new Map();
  const files = readdirSync(dir).filter((f) => /^\d\d_.*\.sql$/.test(f) && !/^9[89]_/.test(f)).sort();
  const re = new RegExp(String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(`
    + String.raw`|\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(\w+)\s([^;]*);`
    + String.raw`|\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)`, "gi");
  for (const f of files) {
    const sql = stripComments(readFileSync(join(dir, f), "utf8"));
    for (const m of sql.matchAll(re)) {
      const at = m.index ?? 0;
      if (m[1]) { tables.set(m[1].toLowerCase(), new Set(columnsOf(inside(sql, at + m[0].length - 1)))); continue; }
      if (m[4]) { tables.delete(m[4].toLowerCase()); continue; }
      const t = m[2].toLowerCase(), stmt = m[3];
      const cols = tables.get(t) ?? new Set();
      for (const a of stmt.matchAll(/\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) cols.add(a[1].toLowerCase());
      for (const a of stmt.matchAll(/\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) cols.delete(a[1].toLowerCase());
      for (const a of stmt.matchAll(/\bRENAME\s+COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/gi)) {
        cols.delete(a[1].toLowerCase()); cols.add(a[2].toLowerCase());
      }
      const renamed = stmt.match(/^\s*RENAME\s+TO\s+"?(\w+)"?/i);
      if (renamed) { tables.delete(t); tables.set(renamed[1].toLowerCase(), cols); } else tables.set(t, cols);
    }
  }
  return tables;
}

const SCHEMA = readSchema(DB);
/** @param {string} ref  "table" or "table.column" */
const exists = (ref) => {
  const [t, c] = ref.split(".");
  return SCHEMA.has(t) && (c === undefined || /** @type {Set<string>} */ (SCHEMA.get(t)).has(c));
};

group("The schema reader reads the schema (so the existence checks below can fail)");
{
  ok(`it finds the tables (${SCHEMA.size})`, SCHEMA.size >= 60);
  ok("a CREATE TABLE column: player.full_name", exists("player.full_name"));
  ok("an unquoted mixed-case column folds as Postgres folds it: player.houseatschool",
     exists("player.houseatschool") && !exists("player.houseAtSchool"));
  ok("a column from a later file: disciplinary_record.body (db/25)", exists("disciplinary_record.body"));
  ok("a column added by ALTER TABLE: ball_event.fingerprint (db/36)", exists("ball_event.fingerprint"));
  ok("...and one of a multi-line ADD: ball_event.capture_profile (db/07)", exists("ball_event.capture_profile"));
  ok("a constraint is not a column", !exists("development_note.constraint") && !exists("honour.constraint"));
  ok("a typo is not a column: player.bron", !exists("player.bron"));
  ok("a typo is not a table: injuries", !exists("injuries"));
}

// ═══════════════════════════════════════════════════════════════════
group("§3 — the never-public list");
// ═══════════════════════════════════════════════════════════════════
{
  const refs = Object.keys(NEVER_PUBLIC);
  const rules = Object.keys(NEVER_PUBLIC_RULES);
  const section3 = DOC.slice(DOC.indexOf("## 3."), DOC.indexOf("## 4."));
  const bullets = (section3.match(/^- \*\*/gm) ?? []).length;
  ok(`§3 has ${bullets} bullets, and there are as many rules (N1–N5)`, bullets === 5 && rules.length === 5);
  ok("every entry names one of them", Object.values(NEVER_PUBLIC).every((r) => rules.includes(r)));
  ok("each of the five keeps something off the page",
     rules.every((r) => Object.values(NEVER_PUBLIC).includes(/** @type {any} */ (r))),
     rules.filter((r) => !Object.values(NEVER_PUBLIC).includes(/** @type {any} */ (r))).join(" "));

  const missing = refs.filter((r) => !exists(r));
  ok(`every one of the ${refs.length} entries is a real table or column in db/ — a typo protects nothing`,
     missing.length === 0, missing.join(", "));
  ok("entries are spelled as Postgres holds them, lower case", refs.every((r) => r === r.toLowerCase()));
  const redundant = refs.filter((r) => r.includes(".") && Object.hasOwn(NEVER_PUBLIC, r.split(".")[0]));
  ok("no column is listed on a table already listed whole", redundant.length === 0, redundant.join(", "));

  // The six the brief names by kind, found by their real names.
  for (const t of ["injury", "disciplinary_record", "development_note", "player_skill",
                   "player_scouting_consent", "emergency_contact"])
    ok(`${t}: the whole table`, Object.hasOwn(NEVER_PUBLIC, t));
  ok("a date of birth: N1", NEVER_PUBLIC["player.born"] === "N1");
  ok("the bare word \"unavailable\" (player.fitness): N2", NEVER_PUBLIC["player.fitness"] === "N2");
  ok("why a boy is not playing (match_availability): N2", NEVER_PUBLIC.match_availability === "N2");
  ok("every contact, home and identity column on player: N4",
     ["id_number", "email", "phone", "address", "guardian", "hometown", "houseatschool", "height", "weight"]
       .every((c) => NEVER_PUBLIC[`player.${c}`] === "N4"));

  // The list must not grow over what a public page is FOR.
  const needed = ["player.id", "player.full_name", "player.team_code", "player.playing_role",
                  "player.squad_no", "honour.kind", "honour.is_public", "match.id"];
  ok("what a public page needs stays selectable", needed.every((r) => {
    const [t, c] = r.split("."); return exists(r) && neverPublicRule(t, c) === null;
  }), needed.filter((r) => neverPublicRule(r.split(".")[0], r.split(".")[1]) !== null).join(", "));

  ok("neverPublicRule: a column", neverPublicRule("player", "born") === "N1");
  ok("...a column of a table listed whole", neverPublicRule("injury", "rtw_date") === "N2");
  ok("...the table itself", neverPublicRule("disciplinary_record") === "N3");
  ok("...spelled as the DDL spells it", neverPublicRule("player", "houseAtSchool") === "N4");
  ok("...a prototype key is not an entry",
     neverPublicRule("constructor") === null && neverPublicRule("player", "constructor") === null);

  ok("assertPublicSelect lets a public read select a player's name and side",
     !throws(() => assertPublicSelect("player", ["id", "full_name", "team_code", "playing_role"])));
  ok("...refuses his date of birth among them",
     throws(() => assertPublicSelect("player", ["full_name", "born"])));
  ok("...refuses \"unavailable\"", throws(() => assertPublicSelect("player", ["fitness"])));
  ok("...refuses any column of a whole-table entry", throws(() => assertPublicSelect("injury", ["rtw_date"])));
  ok("...refuses * — a public read names its columns", throws(() => assertPublicSelect("match", ["*"])));
  let message = "";
  try { assertPublicSelect("player", ["full_name", "born", "phone"]); } catch (e) { message = String(e); }
  ok("...and names every refusal with its rule",
     message.includes("player.born (N1)") && message.includes("player.phone (N4)") && !message.includes("full_name"),
     message);
}

// ═══════════════════════════════════════════════════════════════════
//  §3 against tables.mjs — the test that makes the list stick.
// ═══════════════════════════════════════════════════════════════════

/**
 * Tables that mask columns but are not about a pupil, and why. Adults doing a
 * public job are outside the rule by the document's own first paragraph; a
 * contract is nobody's personal information.
 */
const OUTSIDE_THE_RULE = {
  coach: "adults: a coach's own contact details, born and hometown",
  staff: "adults: the school's staff directory",
  sponsorship: "commercial terms, about no person",
};

/**
 * Masks written by hand in db/ rather than generated from tables.mjs, and why
 * they are outside the rule.
 */
const HAND_MASKED = {
  official: "adults: the union's umpire panel (db/08 official_masked)",
};

/** A table is about a pupil when it is the player table or its person anchor is a player. @param {string} t */
const aboutAPupil = (t) => t === "player" || TABLES[t]?.anchors.person === "player_id";

/**
 * Every masked column, from every mask form a TableDef has — any key that
 * begins "masked", so a third form added tomorrow is covered without anybody
 * remembering to add it here.
 * @param {TableDef} def
 */
const everyMask = (def) => Object.entries(def)
  .filter(([k]) => k.startsWith("masked"))
  .flatMap(([, v]) => Object.values(/** @type {Record<string, string[]>} */ (v)).flat());

/**
 * The coverage check, parameterised so its own ability to fail can be shown.
 * @param {Readonly<Record<string, string>>} never
 * @param {Readonly<Record<string, string>>} allowed
 * @returns {string[]}  every masked pupil column placed on neither list, and every bad allow-list entry
 */
function unplaced(never, allowed) {
  const out = [];
  for (const [t, def] of Object.entries(TABLES)) {
    if (!aboutAPupil(t)) continue;
    for (const c of everyMask(def)) {
      const ref = `${t}.${c}`;
      if (!Object.hasOwn(never, t) && !Object.hasOwn(never, ref) && !Object.hasOwn(allowed, ref)) out.push(ref);
    }
  }
  for (const [ref, id] of Object.entries(allowed)) {
    const [t, c] = ref.split(".");
    if (!Object.hasOwn(SURFACES, id) || !SURFACES[id].public) out.push(`${ref} → ${id} (not a public surface)`);
    else if (!aboutAPupil(t) || !TABLES[t] || !everyMask(TABLES[t]).includes(c)) out.push(`${ref} (not masked on a pupil's table: stale)`);
    else if (Object.hasOwn(never, t) || Object.hasOwn(never, ref)) out.push(`${ref} (also never public)`);
  }
  return out;
}

group("§3 against tables.mjs — every column masked about a pupil is placed");
{
  const masking = Object.entries(TABLES).filter(([, def]) => everyMask(def).length).map(([t]) => t);
  ok(`${masking.length} tables mask columns`, masking.length >= 5, masking.join(" "));
  ok("maskedColumns() sees every mask form a TableDef has",
     Object.values(TABLES).every((def) => {
       const a = everyMask(def).sort().join(), b = Object.values(maskedColumns(def)).flat().sort().join();
       return a === b;
     }));
  const pupil = masking.filter(aboutAPupil);
  ok(`of them, ${pupil.length} are about a pupil`, pupil.includes("player") && pupil.includes("injury"), pupil.join(" "));
  const unclassified = masking.filter((t) => !aboutAPupil(t) && !Object.hasOwn(OUTSIDE_THE_RULE, t));
  ok("every other masking table says why it is outside the rule", unclassified.length === 0,
     `${unclassified.join(", ")} — a pupil's table, or add it to OUTSIDE_THE_RULE with the reason`);
  ok("...and none of those is a pupil's table in disguise",
     Object.keys(OUTSIDE_THE_RULE).every((t) => t in TABLES && !aboutAPupil(t)));

  const gaps = unplaced(NEVER_PUBLIC, PUBLIC_DESPITE_MASK);
  ok("every masked pupil column is never public, or allowed by a named surface", gaps.length === 0,
     `place each on NEVER_PUBLIC or PUBLIC_DESPITE_MASK: ${gaps.join(", ")}`);
  ok(`the allow-list is short (${Object.keys(PUBLIC_DESPITE_MASK).length} today)`,
     Object.keys(PUBLIC_DESPITE_MASK).length <= 5);

  // Masks in db/ that tables.mjs did not generate.
  const dbSql = readdirSync(DB).filter((f) => /^\d\d_.*\.sql$/.test(f) && !/^9[89]_/.test(f))
    .map((f) => stripComments(readFileSync(join(DB, f), "utf8"))).join("\n");
  const views = [...new Set([...dbSql.matchAll(/VIEW\s+(\w+)_masked\b/g)].map((m) => m[1]))];
  const handWritten = views.filter((t) => !masking.includes(t));
  ok(`db/ builds ${views.length} *_masked views`, views.length >= 5, views.join(" "));
  ok("every one not generated from tables.mjs is classified by hand",
     handWritten.every((t) => Object.hasOwn(HAND_MASKED, t)),
     handWritten.filter((t) => !Object.hasOwn(HAND_MASKED, t)).join(", "));
  ok("...and a hand-written mask on a pupil's own table would need placing column by column",
     handWritten.every((t) => !aboutAPupil(t)));
}

group("...and the check can fail");
{
  const without = /** @type {Record<string, string>} */ ({ ...NEVER_PUBLIC });
  delete without["player.born"];
  ok("a masked column dropped from the list is named", unplaced(without, {}).join() === "player.born");
  ok("...and placed by an allow-list entry naming a public surface",
     unplaced(without, { "player.born": "A5" }).length === 0);
  ok("an allow-list entry naming no surface is refused",
     unplaced(without, { "player.born": "Z9" }).some((g) => g.includes("not a public surface")));
  ok("...or naming a surface that is not public",
     unplaced(without, { "player.born": "A3" }).some((g) => g.includes("not a public surface")));
  ok("an allow-list entry for a column nobody masks is stale",
     unplaced(NEVER_PUBLIC, { "player.full_name": "L2" }).some((g) => g.includes("stale")));
  ok("an allow-list entry that is also never public is a contradiction",
     unplaced(NEVER_PUBLIC, { "player.born": "L2" }).some((g) => g.includes("also never public")));
  const wholeGone = /** @type {Record<string, string>} */ ({ ...NEVER_PUBLIC });
  delete wholeGone.injury;
  ok("a whole table dropped names every masked column on it",
     unplaced(wholeGone, {}).sort().join() === "injury.injury_type,injury.notes,injury.phase,injury.physio,injury.severity");
}

// ═══════════════════════════════════════════════════════════════════
group("§1.4 — initial and surname");
// ═══════════════════════════════════════════════════════════════════
{
  /** @type {[string|null|undefined, string, string][]} */
  const cases = [
    ["Dewald Erasmus", "D Erasmus", "the document's own example"],
    ["Thabo Mahlangu", "T Mahlangu", "two words"],
    ["Sipho Andile Khumalo", "S Khumalo", "a second given name is not shown"],
    ["Jan-Hendrik van der Merwe", "J van der Merwe", "hyphenated given name, compound particle"],
    ["Mary-Anne du Plessis", "M du Plessis", "the first letter of a hyphenated given name"],
    ["Pieter de la Rey", "P de la Rey", "French compound particle"],
    ["Johannes van den Berg", "J van den Berg", "van den"],
    ["Anna von Wielligh", "A von Wielligh", "von"],
    ["Jacques le Roux", "J le Roux", "le"],
    ["Ricardo dos Santos", "R dos Santos", "Portuguese particle"],
    ["Jan vd Merwe", "J vd Merwe", "a register's short van der"],
    ["Jan Van der Merwe", "J Van der Merwe", "a capitalised particle heading a run"],
    ["Sipho", "S", "one word: the initial alone, never a first name alone"],
    ["  Thabo \t  Mahlangu  ", "T Mahlangu", "odd spacing"],
    ["Thabo Mahlangu", "T Mahlangu", "a non-breaking space"],
    ["van der Merwe", "van der Merwe", "all surname: the surname alone"],
    ["Khumalo, Sipho Andile", "S Khumalo", "a register's surname-first form"],
    ["van der Merwe, Jan-Hendrik", "J van der Merwe", "...with particles"],
    ['Botha, A "Andy"', "A Botha", "a known-as in quotes is set aside (the CSV suite's own example)"],
    ["Johannes Botha (Hannes)", "J Botha", "a trailing known-as in brackets is not the surname"],
    ["Pieter Botha Jnr", "P Botha", "a suffix is not the surname"],
    ["A.B. de Villiers", "A de Villiers", "initials already"],
    ["T Bekker", "T Bekker", "already in the public form (the seed's names)"],
    ["sipho khumalo", "S khumalo", "the initial is capitalised; the surname is kept as stored"],
    ["Émile Rousseau", "É Rousseau", "an accented initial"],
    ["", "", "empty"],
    ["   ", "", "blank"],
    [null, "", "null"],
    [undefined, "", "undefined"],
  ];
  for (const [input, want, why] of cases) {
    const got = initialAndSurname(input);
    ok(`${JSON.stringify(input)} → ${JSON.stringify(want)} — ${why}`, got === want, `got ${JSON.stringify(got)}`);
  }

  // Pinned, not endorsed: a stored surname (§6 step 2) is what fixes these,
  // and a fix should show up here as a deliberate change.
  /** @type {[string, string, string][]} */
  const knownWrong = [
    ["Pieter De Villiers", "P Villiers", "capitalised particle with no run after it"],
    ["Maria Santos Silva", "M Silva", "a two-word surname with no particle"],
    ["Khumalo Sipho", "K Sipho", "surname first with no comma: a first name shown"],
    ["Jan VAN DER MERWE", "J MERWE", "particles in capitals"],
  ];
  for (const [input, got, why] of knownWrong)
    ok(`KNOWN WRONG, pinned: ${JSON.stringify(input)} → ${JSON.stringify(got)} — ${why}`, initialAndSurname(input) === got);

  // Never more: nothing of a second given name — not the name, not its
  // initial ("S A Khumalo", which is what db/08's broadcast_name() shows).
  const multi = ["Sipho Andile Khumalo", "Jan-Hendrik Pieter van der Merwe", "Mary-Anne Louise du Plessis",
                 "Khumalo, Sipho Andile", "Thabo Sipho Andile Mahlangu"];
  ok("no second given name, nor its initial, ever reaches the output",
     multi.every((n) => {
       const out = initialAndSurname(n);
       return !/Andile|Pieter|Louise|Hendrik|Anne|Sipho/.test(out.slice(1)) && !/^\S+ \p{Lu}\b(?! *$)/u.test(out);
     }), multi.map(initialAndSurname).join(" | "));
}

// ═══════════════════════════════════════════════════════════════════
//  §4 — the name rule
// ═══════════════════════════════════════════════════════════════════

const TODAY = "2026-09-25";
/** @param {Partial<NameConsent>} [c] @returns {NameConsent} */
const guardian = (c = {}) => ({ by: "guardian", competent: true, givenOn: "2026-01-15", endedOn: null, ...c });
/** @param {Partial<NameConsent>} [c] @returns {NameConsent} */
const pupil = (c = {}) => ({ by: "pupil", competent: true, givenOn: "2026-08-01", endedOn: null, ...c });

/** Every fact in favour: the one case that names him. @type {NameFacts} */
const NAMED = Object.freeze({
  on: TODAY, fullName: "Dewald Erasmus", label: "Batter",
  typed: false, schoolOnPlatform: true, schoolPublished: true, neverPublic: false, namesOff: false,
  consents: [guardian()],
});
/** @param {Partial<NameFacts>} change */
const name = (change) => publicName({ ...NAMED, ...change });

group("§4 — the name rule, branch by branch");
{
  ok("with every fact in favour he is named, initial and surname", publicName(NAMED) === "D Erasmus");
  ok("C5: a never-public mark → his position", name({ neverPublic: true }) === "Batter");
  ok("C5 overrides his own consent at eighteen as well as his guardian's",
     name({ neverPublic: true, consents: [guardian(), pupil()] }) === "Batter");
  ok("L6: a name the scorer typed in → a position, consent or not", name({ typed: true }) === "Batter");
  ok("L5: a side whose school is not on the platform → never named", name({ schoolOnPlatform: false }) === "Batter");
  ok("§1.1: his school has not published → not named", name({ schoolPublished: false }) === "Batter");
  ok("C4: his school switched names off for the age group → not named", name({ namesOff: true }) === "Batter");
  ok("C2: nothing recorded → not named", name({ consents: [] }) === "Batter");
  ok("C2: consents not supplied at all → not named", name({ consents: undefined }) === "Batter");
  ok("C1: a guardian whose link was not verified → not named",
     name({ consents: [guardian({ competent: false })] }) === "Batter");
  ok("a consent from nobody the rule knows → not named",
     name({ consents: [/** @type {any} */ ({ by: "coach", competent: true, givenOn: "2026-01-01" })] }) === "Batter");
  ok("a consent that begins after the day served has not begun",
     name({ consents: [guardian({ givenOn: "2026-10-01" })] }) === "Batter");
  ok("a consent with an unreadable start does not count",
     name({ consents: [guardian({ givenOn: "15/01/2026" })] }) === "Batter"
     && name({ consents: [guardian({ givenOn: "2026-02-30" })] }) === "Batter");
  ok("a consent that runs to a future end still counts today",
     name({ consents: [guardian({ endedOn: "2026-12-31" })] }) === "D Erasmus");
  ok("an unreadable end is an end", name({ consents: [guardian({ endedOn: "soon" })] }) === "Batter");
  ok("a consenting boy with no usable name is still a position", name({ fullName: "   " }) === "Batter");
  ok("the caller's label is used", name({ neverPublic: true, label: "Fielder" }) === "Fielder");
  ok("...and with none, \"Player\"", name({ neverPublic: true, label: undefined }) === POSITION_LABELS.player);
  ok("the day served is required, as a day", throws(() => name({ on: "" }))
     && throws(() => name({ on: /** @type {any} */ (new Date()) })) && throws(() => name({ on: "2026-13-01" })));
}

group("Unknown is not yes: a fact nobody established never names a child");
{
  for (const k of /** @type {(keyof NameFacts)[]} */ (["typed", "schoolOnPlatform", "schoolPublished", "neverPublic", "namesOff"])) {
    const facts = /** @type {Record<string, unknown>} */ ({ ...NAMED });
    delete facts[k];
    ok(`${k} missing → not named`, publicName(/** @type {NameFacts} */ (facts)) === "Batter");
  }
  ok("a truthy string where a boolean belongs is not a fact",
     name({ neverPublic: /** @type {any} */ ("no") }) === "Batter"
     && name({ schoolPublished: /** @type {any} */ ("yes") }) === "Batter");
  ok("competent must be true, not truthy",
     name({ consents: [guardian({ competent: /** @type {any} */ (1) })] }) === "Batter");
}

group("C5: no reason leaks — every refusal is the same string");
{
  const refusals = [
    { neverPublic: true }, { typed: true }, { schoolOnPlatform: false }, { schoolPublished: false },
    { namesOff: true }, { consents: [] }, { consents: [guardian({ endedOn: "2026-06-01" })] },
  ].map((c) => name(c));
  ok("seven different reasons, one answer: the label", refusals.every((r) => r === "Batter"), refusals.join(" | "));
  const withReason = /** @type {NameFacts} */ (/** @type {unknown} */ ({
    ...NAMED, neverPublic: true, neverPublicReason: "court order", reason: "court order",
  }));
  ok("a reason passed in by mistake does not come back out", publicName(withReason) === "Batter");
  ok("the answer is a string, with nothing attached", typeof publicName(NAMED) === "string");
}

group("C3: a \"no\" is immediate, and reaches the past");
{
  const withdrawn = [guardian({ givenOn: "2026-01-15", endedOn: "2026-06-01" })];
  ok("named while the consent stood", name({ on: "2026-05-31", consents: withdrawn }) === "D Erasmus");
  ok("not named from the day it was withdrawn — that day included",
     name({ on: "2026-06-01", consents: withdrawn }) === "Batter");
  // A scorecard from 2026-03-07, when consent stood, served today.
  const oldScorecard = /** @type {NameFacts} */ (/** @type {unknown} */ ({
    ...NAMED, consents: withdrawn, matchOn: "2026-03-07", playedOn: "2026-03-07",
  }));
  ok("a scorecard from before the withdrawal, served after it, does not name him",
     publicName(oldScorecard) === "Batter");
  ok("...and a consent recorded after the match names him on it now (§1.3: recorded, and served today)",
     publicName(/** @type {NameFacts} */ (/** @type {unknown} */ ({
       ...NAMED, consents: [guardian({ givenOn: "2026-09-01" })], matchOn: "2026-03-07",
     }))) === "D Erasmus");
  ok("the record is end-dated, not deleted, and a new version names him again",
     name({ consents: [...withdrawn, guardian({ givenOn: "2026-07-01" })] }) === "D Erasmus");
  ok("the latest record governs: a later withdrawal outweighs an earlier consent still open",
     name({ consents: [guardian({ givenOn: "2026-01-15" }), guardian({ givenOn: "2026-03-01", endedOn: "2026-05-01" })] })
       === "Batter");
  ok("...and a tie on the day goes to the one that ended",
     name({ consents: [guardian({ givenOn: "2026-03-01" }), guardian({ givenOn: "2026-03-01", endedOn: "2026-05-01" })] })
       === "Batter");
  ok("a recorded \"no\" — a record that ends the day it begins — is not a consent",
     name({ consents: [guardian({ givenOn: "2026-03-01", endedOn: "2026-03-01" })] }) === "Batter");
}

group("C6: turning eighteen");
{
  ok("his own consent at eighteen names him, with no guardian's on file",
     name({ consents: [pupil()] }) === "D Erasmus");
  ok("...and names him after his guardian's was withdrawn",
     name({ consents: [guardian({ endedOn: "2026-05-01" }), pupil()] }) === "D Erasmus");
  ok("until he gives his own, his guardian's stands (given while he was a minor)",
     name({ consents: [guardian({ givenOn: "2024-02-01" })] }) === "D Erasmus");
  ok("once he has given his own, his own governs: withdrawing it unnames him though his guardian's is open",
     name({ consents: [guardian(), pupil({ endedOn: "2026-09-01" })] }) === "Batter");
  ok("...as does his own recorded \"no\"",
     name({ consents: [guardian(), pupil({ givenOn: "2026-08-01", endedOn: "2026-08-01" })] }) === "Batter");
  // The two cases where "his own governs" is what decides, rather than "the
  // latest governs": a guardian's record dated AFTER his own. Consistent data
  // cannot hold one (a guardian link ends at his majority, db/10), which is
  // exactly why it has to be proved here — the first falsification of C6
  // passed without them.
  ok("a guardian's record dated after his own withdrawal does not name him again",
     name({ consents: [pupil({ givenOn: "2026-08-01", endedOn: "2026-08-15" }), guardian({ givenOn: "2026-09-01" })] })
       === "Batter");
  ok("...nor does a guardian's later withdrawal unname him while his own consent stands",
     name({ consents: [pupil({ givenOn: "2026-08-01" }), guardian({ givenOn: "2026-09-01", endedOn: "2026-09-10" })] })
       === "D Erasmus");
  ok("a record he made before eighteen is not a consent: it names nobody",
     name({ consents: [pupil({ competent: false })] }) === "Batter");
  ok("...and does not displace his guardian's",
     name({ consents: [guardian(), pupil({ competent: false, endedOn: "2026-08-02" })] }) === "D Erasmus");
  ok("his own consent dated after the day served has not begun, so his guardian's still stands",
     name({ consents: [guardian(), pupil({ givenOn: "2026-10-01", endedOn: "2026-10-01" })] }) === "D Erasmus");
  ok("his withdrawal at eighteen reaches his U14 scorecards too (C3 and C6 together)",
     publicName(/** @type {NameFacts} */ (/** @type {unknown} */ ({
       ...NAMED, consents: [guardian({ givenOn: "2022-02-01" }), pupil({ endedOn: "2026-09-01" })], matchOn: "2022-03-05",
     }))) === "Batter");
}

console.log("\n" + "─".repeat(52));
console.log(`PUBLIC: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
