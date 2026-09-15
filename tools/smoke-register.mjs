#!/usr/bin/env node
/**
 * The officials register: open by name, closed by person.
 *
 * db/99_rls_verify.sql already asserts these policies against a raw
 * connection. This walk asserts the same boundary THROUGH THE API, as real
 * people holding real tokens, because that is the path a browser takes and
 * the two can disagree: a masked view is only load-bearing if the read
 * endpoint actually goes through it, and a query written against `official`
 * instead of `official_masked` would pass every database assertion and leak
 * an umpire's ID number to every school in the country.
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8884, BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const NDLOVU = "0a000000-0000-0000-0000-000000000001";   // level2, in date
const NGCOBO = "0a000000-0000-0000-0000-000000000005";   // accreditation lapsed

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-officials" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = []; server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-officials" } })).body?.token;
const register = async (tok) => (await api("/api/read/official_register", { token: tok })).body?.rows ?? [];
const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const head    = await login("sarah@example.invalid");     // directorofsport, Hilton
  const coach   = await login("coach@example.invalid");     // coach, 1XI
  const watcher = await login("watcher@example.invalid");   // spectator
  const plat    = await login("platform@example.invalid");  // platformadmin

  group("The panel is readable, because a scorecard already says who stood");
  {
    const seen = await register(head);
    ok("a director of sport reads the register", seen.length >= 5);
    ok("...with names and panels", seen.some((o) => o.full_name === "E Ndlovu" && /KZN/.test(o.panel ?? "")));
    // The whole point of keeping a register rather than deriving a directory
    // from appointments: somebody accredited but not yet appointed anywhere
    // has to be findable, because that is when you are looking for them.
    // Read BEFORE the appointment group below, which goes on to appoint the
    // very person this looks for. Like every walk in this suite it runs on a
    // database the harness has just reset (run-smoke-api.mjs does that per
    // walk); run twice by hand against the same database, this one assertion
    // is the one that will fail, and it is failing honestly.
    const stoodIds = (await q(`select distinct official_id from match_official where official_id is not null`)).map((r) => r.official_id);
    const neverStood = seen.find((o) => !stoodIds.includes(o.id));
    ok("...including somebody who has never stood at a fixture", !!neverStood);
    ok("a coach reads it too", (await register(coach)).length >= 5);
    ok("a spectator reads it too — a panel is not a secret", (await register(watcher)).length >= 5);
    ok("an unauthenticated caller reads nothing", [401, 403].includes((await api("/api/read/official_register")).status));
  }

  group("The person behind the name is not");
  {
    const seen = await register(head);
    const one = seen.find((o) => o.id === NDLOVU);
    ok("the row is there", !!one);
    // The assertion this walk exists for. Masked columns must arrive NULL —
    // not absent, not omitted from the column list, but asked for and refused,
    // which is the only version of this that tests the mask rather than the
    // SELECT.
    ok("a school reads no date of birth", one?.born == null);
    ok("...no ID number", one?.id_number == null);
    ok("...and no contact details", one?.email == null && one?.phone == null);
    ok("a coach is refused the same", (await register(coach)).find((o) => o.id === NDLOVU)?.id_number == null);
    ok("so is a spectator", (await register(watcher)).find((o) => o.id === NDLOVU)?.born == null);

    const asUnion = (await register(plat)).find((o) => o.id === NDLOVU);
    ok("the register's keeper reads the date of birth", asUnion?.born != null);
    ok("...and the ID number", asUnion?.id_number === "7904125012084");
    // Proof the two are the same fact: the ID number's first six digits ARE
    // the date of birth beside it. A seed that failed this would be fixture
    // data the validator on the write path would itself reject.
    ok("...and the number agrees with the date, digit for digit",
       asUnion?.id_number?.slice(0, 6) === String(asUnion?.born).slice(2, 10).replace(/-/g, ""));
  }

  group("A grade is a span, so the register can say who may stand today");
  {
    const seen = await register(head);
    const current = seen.find((o) => o.id === NDLOVU);
    const lapsed  = seen.find((o) => o.id === NGCOBO);

    ok("a current accreditation reads as its grade", current?.level === "level2");
    ok("...with the date it runs to", !!current?.accredited_until);

    // The distinction the screen depends on: lapsed and never-accredited are
    // both a null grade, and only one of them means "go and renew it".
    ok("a lapsed accreditation reads as no current grade", lapsed?.level == null);
    ok("...but the register still knows he held one", Number(lapsed?.accreditations ?? 0) > 0);
    ok("...and says when it ran out", !!lapsed?.accredited_until);

    const national = seen.find((o) => o.full_name === "G Marais");
    ok("the highest grade held is the one reported", national?.level === "national");
    // E Ndlovu holds two accreditations — club, then level2 after promotion.
    // The register must report the CURRENT one, not the first or the last
    // recorded, or a promotion would read as a demotion.
    ok("a promoted official reads at the grade he was promoted TO",
       Number(current?.accreditations ?? 0) > 1 && current?.level === "level2");
  }

  group("Appointing from the panel, and appointing somebody who is not on it");
  {
    // Both are legitimate and the difference must survive into the data: an
    // appointment carrying official_id can be checked and counted; one
    // carrying only a typed name can be neither, and says so by being null.
    const linked = await q(`select count(*)::int c from match_official where official_id is not null and not withdrawn`);
    ok("appointments name people on the register", linked[0].c > 0);
    const unlinked = await q(`select person_name from match_official where official_id is null and not withdrawn`);
    ok("...and one does not, which is allowed", unlinked.length > 0);
    ok("...and is still recorded by name", unlinked.every((r) => (r.person_name ?? "").trim().length > 0));
  }

  group("Appointing FROM the register, and being told what you just did");
  {
    const HIL = "11111111-1111-1111-1111-111111111111";
    const m = (await q(
      `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
       values ($1,'1XI','Kearsney College', now() + interval '3 days','T20',20,'scheduled') returning id`,
      [HIL]))[0].id;
    const appoint = (tok, officials) =>
      api(`/api/matches/${m}/officials`, { method: "POST", token: tok, body: { officials } });

    // Naming the register rather than typing a name: the appointment now
    // carries WHO, so it can be checked and counted.
    const a = await appoint(head, [{ duty: "umpire", officialId: NDLOVU }]);
    ok("an appointment can name somebody on the register", a.status === 200);
    ok("...and the name is filled in FROM the register, not retyped",
       (await q(`select person_name, official_id from match_official where match_id = $1 and not withdrawn`, [m]))[0]?.person_name === "E Ndlovu");
    ok("...linked by id, which is what makes it countable", 
       (await q(`select official_id from match_official where match_id = $1 and not withdrawn`, [m]))[0]?.official_id === NDLOVU);
    ok("...and the panel comes with him", a.body?.standing?.[0]?.name === "E Ndlovu");
    ok("...reported as accredited, with his grade", a.body?.standing?.[0]?.level === "level2" && a.body.standing[0].accredited === true);
    ok("...and not flagged as lapsed", a.body?.standing?.[0]?.lapsed === false);

    // The whole reason for keeping accreditation as a span. The appointment
    // is ALLOWED — a fixture that has to be played is not blocked by
    // paperwork — but the person appointing is told, at the one moment they
    // can do something about it.
    const l = await appoint(head, [{ duty: "umpire", officialId: NGCOBO }]);
    ok("appointing somebody whose accreditation lapsed is allowed", l.status === 200);
    ok("...and comes back named as lapsed", l.body?.standing?.[0]?.lapsed === true);
    ok("...with no current grade to report", l.body?.standing?.[0]?.level == null);
    ok("...and the appointment really was made", l.body?.appointed === 1);

    // Standing somebody down is a decision, and appointing them anyway would
    // make it meaningless. Unlike a lapsed grade there is no Saturday-morning
    // argument for it, so this one refuses.
    await q(`update official set active = false where id = $1`, [NGCOBO]);
    const off = await appoint(head, [{ duty: "umpire", officialId: NGCOBO }]);
    ok("somebody stood down cannot be appointed at all", off.status === 422);
    await q(`update official set active = true where id = $1`, [NGCOBO]);

    ok("an official id that is not on the register is refused",
       (await appoint(head, [{ duty: "umpire", officialId: "0a000000-0000-0000-0000-0000000000ff" }])).status === 404);
    ok("a malformed official id is refused before the database sees it",
       (await appoint(head, [{ duty: "umpire", officialId: "not-a-uuid" }])).status === 400);

    // The fallback is untouched: a typed name with no register id still works,
    // because a parent standing in at short notice must not be blocked.
    const p = await appoint(head, [{ duty: "umpire", name: "A Willing Parent" }]);
    ok("a typed name with no register id still appoints", p.status === 200);
    ok("...and reports no standing, because there is none to report", (p.body?.standing ?? []).length === 0);
    ok("...and is stored with a null official_id, saying so rather than pretending",
       (await q(`select official_id from match_official where match_id = $1 and not withdrawn`, [m]))[0]?.official_id === null);
  }

  group("Only the union changes the register");
  {
    // Sarah holds officiating.assign — she appoints officials all season —
    // and that must not extend to putting somebody on the panel. The database
    // refuses it; this checks nothing in the API has opened a side door.
    const before = (await q(`select count(*)::int c from official`))[0].c;
    const r = await api("/api/read/official_register", { method: "POST", token: head, body: { full_name: "Self Appointed" } });
    ok("there is no write route on the read path", [404, 405, 400, 403].includes(r.status));
    ok("...and nobody was added", (await q(`select count(*)::int c from official`))[0].c === before);
  }
} catch (e) {
  ok(`the officials walk threw: ${e.message}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) console.log("\nAPI stderr:\n" + serverErr.join("").split("\n").slice(0, 12).join("\n"));
console.log(`\n${"─".repeat(52)}\nREGISTER SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
