// tools/backup-verify.mjs, the pure parts: which hosts count as this machine,
// the two comparisons that decide pass or fail, the roles a dump's grants name,
// and the counts file's shape. Plus the guard itself, run as a process: a
// restore aimed at a remote host is refused with exit 2 before anything is
// spawned or connected, and says nothing that identifies the host.
//
// Not falsified by removing the guard: with it gone, the refused case would
// try to connect to the made-up remote host, which a test must never do. The
// guard's decision is isLocalUrl(), which the first block pins case by case.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isLocalUrl, describeUrl, parseShipped, compareLedgers, compareCounts, rolesInAcl, parseCounts, majorOf, withoutPublicSchema,
  childConnection, shapeProblems, shapeAdvice,
} from "./backup-verify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let passes = 0, fails = 0;
const ok = (/** @type {string} */ label, /** @type {boolean} */ cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};

// ── isLocalUrl / describeUrl ──
const REMOTE = "postgresql://postgres.abcdefref:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres";
ok("a Supabase pooler is not local", !isLocalUrl(REMOTE));
ok("127.0.0.1 is local", isLocalUrl("postgres://scrbrd:scrbrd@127.0.0.1:5433/scrbrd_x"));
ok("localhost is local", isLocalUrl("postgres://u@localhost/x"));
ok("::1 is local", isLocalUrl("postgres://u@[::1]:5432/x"));
ok("the compose service `db` is local (the migrator's rule)", isLocalUrl("postgres://u@db/x"));
ok("a Unix socket with no host is local", isLocalUrl("postgres:///scrbrd_x"));
ok("a Unix socket named by host=/path is local", isLocalUrl("postgres:///x?host=/var/run/postgresql"));
ok("a host= parameter naming a remote host is not local, whatever the URL's host says",
   !isLocalUrl("postgres://u@localhost/x?host=db.example.com"));
ok("a lookalike host is not local", !isLocalUrl("postgres://u@localhost.example.com/x"));
ok("an unparseable string is not local", !isLocalUrl("not a url"));
ok("a non-Postgres URL is not local", !isLocalUrl("http://127.0.0.1/x"));
ok("a remote database is described without its host, user or reference",
   describeUrl(REMOTE) === "a remote database" && !/supabase|abcdefref|secret/.test(describeUrl(REMOTE)));
ok("a local database is described by its name, without the password",
   describeUrl("postgres://scrbrd:pw@127.0.0.1/scrbrd_bkdrill") === 'local database "scrbrd_bkdrill"');

// ── parseShipped, against the real manifest and a hand-made one ──
const real = parseShipped(readFileSync(join(HERE, "..", "db", "SHIPPED.sha256"), "utf8"));
ok("the real SHIPPED.sha256 parses, keyed by file name without db/", real.has("00_schema_core.sql") && real.size > 50);
const H = (/** @type {string} */ c) => c.repeat(64);
const two = parseShipped(`# comment\n${H("a")}  db/00_a.sql\n\n${H("b")}  db/01_b.sql\n`);
ok("comments and blank lines are skipped", two.size === 2 && two.get("01_b.sql") === H("b"));
let threw = false; try { parseShipped("nonsense db/00_a.sql"); } catch { threw = true; }
ok("an unreadable line is an error, not a silently shorter manifest", threw);

// ── compareLedgers ──
const L = (/** @type {[string,string][]} */ e) => new Map(e);
ok("identical ledgers have no differences", compareLedgers(L([["00_a.sql", H("a")]]), L([["00_a.sql", H("a")]]), "x", "y").length === 0);
const d = compareLedgers(L([["00_a.sql", H("a")], ["02_c.sql", H("c")]]), L([["00_a.sql", H("f")], ["01_b.sql", H("b")]]), "restored", "shipped");
ok("a changed hash, an extra and a missing migration are each named",
   d.length === 3 && d.some((l) => /00_a\.sql: hash differs/.test(l))
   && d.some((l) => /02_c\.sql: in restored, not in shipped/.test(l)) && d.some((l) => /01_b\.sql: in shipped, not in restored/.test(l)),
   JSON.stringify(d));

// ── compareCounts ──
ok("equal counts have no differences", compareCounts({ a: 1, b: 0 }, { b: 0, a: 1 }).length === 0);
const c = compareCounts({ player: 120, match_event: 900, gone: 3 }, { player: 119, match_event: 900, extra: 0 });
ok("one row short is caught and names the table and both counts",
   c.some((l) => /^player: 120 row\(s\) at dump time, 119 in the restored copy$/.test(l)), JSON.stringify(c));
ok("a table missing from the copy is caught", c.some((l) => /^gone: .*missing/.test(l)));
ok("a table the counts file never saw is caught", c.some((l) => /^extra: not in the counts file/.test(l)));
ok("a matching table is not reported", !c.some((l) => l.startsWith("match_event")));
ok("an empty table on one side only is still a difference", compareCounts({ a: 0 }, {}).length === 1);

// ── rolesInAcl ──
const script = `
--
-- Name: TABLE player; Type: ACL; Schema: public; Owner: postgres
--
GRANT SELECT,INSERT,UPDATE ON TABLE public.player TO scrbrd_app;
GRANT ALL ON TABLE public.player TO anon;
GRANT ALL ON TABLE public.player TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.f() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.f() FROM "Odd ""Role""";
GRANT ALL ON SCHEMA public TO postgres WITH GRANT OPTION;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO dashboard_user;
`;
const roles = rolesInAcl(script);
ok("the grantees, revokees and default-privilege roles are found",
   ["Odd \"Role\"", "anon", "authenticated", "dashboard_user", "postgres", "scrbrd_app", "service_role", "supabase_admin"]
     .every((r) => roles.includes(r)), JSON.stringify(roles));
ok("PUBLIC is not a role", !roles.some((r) => r.toUpperCase() === "PUBLIC"));
ok("WITH GRANT OPTION is not read as a role", !roles.includes("GRANT") && !roles.includes("OPTION"));

// ── withoutPublicSchema ──
const tocLines = [
  ";",
  "; Archive created at 2026-10-03 09:32:31 SAST",
  "6; 2615 10229388 SCHEMA - public scrbrd",
  "7174; 0 0 ACL - SCHEMA public scrbrd",
  "220; 1259 10229400 TABLE public player scrbrd",
  "5; 2615 2200 SCHEMA - public_extra scrbrd",
];
const cut = withoutPublicSchema(tocLines.join("\n")).split("\n");
ok("the CREATE SCHEMA public entry is commented out", cut[2] === `;${tocLines[2]}`);
ok("the schema's ACL, the tables, and a schema whose name only starts with public stay",
   cut[3] === tocLines[3] && cut[4] === tocLines[4] && cut[5] === tocLines[5]);
const stock = tocLines.filter((_, i) => i !== 2).join("\n");
ok("a list with no such entry (a stock public schema, as on Supabase) is unchanged", withoutPublicSchema(stock) === stock);

// ── parseCounts / majorOf ──
const good = JSON.stringify({ version: 1, takenAt: "2026-10-03T00:00:00Z", serverVersion: "16.13", ledger: {}, tables: { a: 0 } });
ok("a well-formed counts file parses", parseCounts(good).tables.a === 0);
for (const [why, bad] of /** @type {[string, object][]} */ ([
  ["a wrong version", { version: 2, ledger: {}, tables: { a: 1 } }],
  ["no tables", { version: 1, ledger: {}, tables: {} }],
  ["a fractional count", { version: 1, ledger: {}, tables: { a: 1.5 } }],
  ["a negative count", { version: 1, ledger: {}, tables: { a: -1 } }],
])) {
  let t = false; try { parseCounts(JSON.stringify(bad)); } catch { t = true; }
  ok(`a counts file with ${why} is refused`, t);
}
ok("majorOf reads server and client versions", majorOf("16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)") === 16 && majorOf("17.4") === 17 && majorOf("15.8.1.093") === 15);

// ── childConnection: the password in the environment, never in argv ──
{
  const a = childConnection("postgres://owner:s%40cret%2Fpw@127.0.0.1:6543/scrbrd_bk?sslmode=require");
  ok("the password leaves the connection string pg_dump is given",
     !/s%40cret|s@cret/.test(a.dbname) && a.dbname === "postgres://owner@127.0.0.1:6543/scrbrd_bk?sslmode=require", a.dbname);
  ok("...and arrives, decoded, as PGPASSWORD", a.env.PGPASSWORD === "s@cret/pw");
  const b = childConnection("postgresql://owner@db.example.invalid/scrbrd?password=pw2&sslmode=require");
  ok("a password= parameter is moved too", !b.dbname.includes("pw2") && /sslmode=require/.test(b.dbname) && b.env.PGPASSWORD === "pw2", b.dbname);
  const c = childConnection("postgres://owner@127.0.0.1/scrbrd");
  ok("no password: no PGPASSWORD, the string unchanged", c.dbname === "postgres://owner@127.0.0.1/scrbrd" && !("PGPASSWORD" in c.env));
}

// ── shapeProblems: what is wrong with a pasted secret, never its value ──
{
  // Every value is made up and distinctive, so a leak of any fragment shows.
  const USER = "postgres.qqrefxyzzy", PW = "Plugh7Wombat", REGION = "zz-mars-9", DB = "dbquuxzot";
  const GOOD = `postgresql://${USER}:${PW}@aws-0-${REGION}.pooler.supabase.com:5432/${DB}`;
  ok("a well-shaped session-pooler string has no problems", shapeProblems(GOOD).length === 0, JSON.stringify(shapeProblems(GOOD)));
  ok("...and its advice says where else to look",
     shapeAdvice(GOOD).join("\n").includes("shape looks right; check the password and that the project is not paused"));
  ok("a local string has no Supabase complaints", shapeProblems("postgres://scrbrd:scrbrd@127.0.0.1:5433/scrbrd").length === 0);

  /** @type {[string, string, RegExp][]} */
  const cases = [
    ["a trailing line break", GOOD + "\n", /leading or trailing whitespace or a line break/],
    ["a leading space", " " + GOOD, /leading or trailing whitespace or a line break/],
    ["a line break inside", GOOD.replace("@", "@\n"), /a space, tab or line break inside it/],
    ["quotes around it", `"${GOOD}"`, /wrapped in quotes/],
    ["single quotes around it", `'${GOOD}'`, /wrapped in quotes/],
    ["the template's brackets", GOOD.replace(PW, `[${PW}]`), /square brackets left in/],
    ["angle brackets", GOOD.replace(PW, `<${PW}>`), /angle brackets left in/],
    ["the placeholder word", GOOD.replace(PW, "YOUR-PASSWORD"), /the words YOUR-PASSWORD left in/],
    ["no scheme", GOOD.replace("postgresql://", ""), /does not start with postgresql:\/\/ or postgres:\/\//],
    ["an http scheme", GOOD.replace("postgresql:", "https:"), /does not start with postgresql:\/\//],
    ["an unencoded @ in the password", GOOD.replace(PW, `${PW}@x`), /more than one @ .*%40/],
    ["an unencoded # in the password", GOOD.replace(PW, `${PW}#x`), /contains # .*%23/],
    ["a bare % in the password", GOOD.replace(PW, `${PW}%zz`), /a % not followed by two hex digits .*%25/],
    ["an unencoded / in the password", GOOD.replace(PW, `${PW}/x`), /does not parse as a URL/],
    ["an unencoded ? in the password", GOOD.replace(PW, `${PW}?x`), /does not parse as a URL/],
    ["no user", `postgresql://:${PW}@aws-0-${REGION}.pooler.supabase.com:5432/${DB}`, /no user/],
    ["no password", GOOD.replace(`:${PW}`, ""), /no password/],
    ["no database name", GOOD.replace(`/${DB}`, ""), /no database name/],
    ["no host", `postgresql://${USER}:${PW}@:5432/${DB}`, /no host|does not parse/],
    ["a host that is not Supabase's", GOOD.replace(`aws-0-${REGION}.pooler.supabase.com`, `${REGION}.example.zz`), /host does not end in pooler\.supabase\.com or supabase\.co/],
    ["the IPv6-only direct host", GOOD.replace(`aws-0-${REGION}.pooler.supabase.com`, "db.qqrefxyzzy.supabase.co"), /direct host .* IPv6-only/],
    ["no port", GOOD.replace(":5432", ""), /no port/],
    ["a wrong port", GOOD.replace(":5432", ":5433"), /port is not 5432 or 6543/],
    ["the transaction pooler's port", GOOD.replace(":5432", ":6543"), /6543 is the transaction pooler/],
    ["a pooler user with no project ref", GOOD.replace(USER, "postgres"), /lacks the \.<project-ref> suffix/],
    ["a host with characters no host name has", `postgresql://${USER}:${PW}@aws-0-${REGION}.pooler.supabase.com!x:5432/${DB}`, /the host has characters a host name cannot have|does not parse/],
    ["an empty string", "", /it is empty/],
    ["a zero-width space at the start", "\u200B" + GOOD, /invisible character at the very start/],
    ["a byte-order mark at the start", "\uFEFF" + GOOD, /leading or trailing whitespace|invisible character at the very start/],
    ["a zero-width joiner inside", GOOD.replace("@", "\u200D@"), /invisible character inside it/],
    ["a look-alike letter", GOOD.replace("postgresql", "p\u043Estgresql"), /outside plain keyboard text/],
    ["a smart quote in the password", GOOD.replace(PW, `${PW}\u2019`), /outside plain keyboard text/],
    ["a name and = in front", "DATABASE_URL=" + GOOD, /a name and = in front of it/],
    ["a jdbc scheme in front", "jdbc:" + GOOD, /starts with a different scheme/],
  ];
  /** Every 4-character run of a made-up value: no message may hold one. */
  const fragments = [USER, PW, REGION, DB, "qqrefxyzzy", "example.zz"]
    .flatMap((v) => Array.from({ length: v.length - 3 }, (_, i) => v.slice(i, i + 4)))
    // Runs of Supabase's stock user "postgres.", which the messages may say.
    .filter((f) => !"postgres.".includes(f));
  for (const [why, input, want] of cases) {
    const got = shapeProblems(input);
    ok(`shape: ${why} is named`, got.some((m) => want.test(m)), JSON.stringify(got));
    const all = shapeAdvice(input).join("\n");
    const leak = fragments.find((f) => all.includes(f));
    ok(`shape: ${why} — the advice carries no fragment of the host, user, password or database`, !leak, `leaked "${leak}"`);
  }
  const onePort = shapeProblems(GOOD.replace(":5432", ":5433"));
  ok("only the problem a string has is named (one fault, one message)", onePort.length === 1, JSON.stringify(onePort));
}

// ── the guard, as a process ──
const run = (/** @type {string[]} */ args, /** @type {Record<string,string>} */ env) =>
  spawnSync(process.execPath, [join(HERE, "backup-verify.mjs"), ...args], { encoding: "utf8", timeout: 20000, env: { ...process.env, ...env } });
const refused = run(["restore", "--from", "/nonexistent.dump"], { DATABASE_URL: REMOTE });
ok("restore into a managed host is refused with exit 2", refused.status === 2, `status ${refused.status}\n    ${refused.stderr}`);
ok("the refusal names neither the host, the reference nor the password",
   !/supabase\.com|abcdefref|secret/.test(refused.stderr + refused.stdout), refused.stderr);
ok("the refusal says why", /writes only to a database on this machine/.test(refused.stderr));
const noMode = run([], {});
ok("no mode is a usage error (exit 2)", noMode.status === 2 && /usage:/.test(noMode.stderr));
const noOut = run(["dump", "--out"], { DATABASE_URL: REMOTE });
ok("a flag with no value is a usage error before any connection", noOut.status === 2 && /needs a value/.test(noOut.stderr));
// A local port nothing listens on: the failure names its code and the shape
// verdict, and neither the user nor the password. No remote host is touched.
const refusedConn = run(["counts", "--out", join(tmpdir(), `scrbrd-bv-${process.pid}.json`)],
  { DATABASE_URL: "postgres://zzuserq:Xyzzy9Frob@127.0.0.1:1/zzdbq" });
ok("a failed connection exits 1 and prints the shape verdict", refusedConn.status === 1
   && /could not connect to local database/.test(refusedConn.stderr) && /shape looks right/.test(refusedConn.stderr), refusedConn.stderr);
ok("...without the user or the password", !/zzuserq|Xyzzy9Frob/.test(refusedConn.stderr + refusedConn.stdout), refusedConn.stderr);

console.log(`\nBACKUP VERIFY: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
