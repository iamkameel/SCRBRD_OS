// The owner's key off the read path (PLATFORM_CONTROLS slice 6a, db/166):
// what the dispatcher hands log_platform_read() for one answer, and that
// every GET route the dispatcher mounts is decided, logged or not. The rows
// themselves are db/99 §144's; the live routes are tools/smoke-who-read.mjs's.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { uuidsIn, platformReadArgs, MAX_SEEN } from "./platform-reads.mjs";

let passes = 0, fails = 0;
/** @param {string} label @param {unknown} cond @param {string} [detail] */
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};

const KID = "aaaaaaaa-0000-0000-0000-000000000005";
const MATCH = "77777777-0000-0000-0000-000000000001";
const ACCT = "88888888-0000-0000-0000-000000000009";

// ── uuidsIn ──
const body = { matchId: MATCH, rows: [{ playerId: KID.toUpperCase(), name: "R Pillay" }, { nested: [{ id: KID }] }],
               note: `about ${ACCT} and again ${ACCT}` };
const seen = uuidsIn(body);
ok("every id in the answer, nested and inside text, once each, lower-cased",
   seen.length === 3 && seen.includes(KID) && seen.includes(MATCH) && seen.includes(ACCT), JSON.stringify(seen));
ok("an answer with no ids gives none", uuidsIn({ rows: [{ name: "R Pillay" }] }).length === 0);
ok("nothing at all gives none", uuidsIn(undefined).length === 0 && uuidsIn(null).length === 0);
const many = Array.from({ length: MAX_SEEN + 50 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
ok(`at most ${MAX_SEEN} ids are offered`, uuidsIn(many).length === MAX_SEEN);

// ── platformReadArgs ──
{
  const [resource, ids, match, account, squad] = platformReadArgs({ resource: "fixture_sheet", subject: "match", squad: true }, MATCH, { rows: [{ name: "R Pillay" }] });
  ok("a fixture route: the fixture is the subject and among the ids, the sheet asked for",
     resource === "fixture_sheet" && ids.includes(MATCH) && match === MATCH && account === null && squad === true);
}
{
  const [, ids, match, account, squad] = platformReadArgs({ resource: "account_preview", subject: "account" }, ACCT, { active: true });
  ok("an account route: the account is the subject, no fixture, no sheet",
     ids.includes(ACCT) && match === null && account === ACCT && squad === false);
}
{
  const [, ids, match, account, squad] = platformReadArgs({ resource: "public_name" }, KID, { playerId: KID });
  ok("a child's route with no subject kind: his id is offered once, nothing else is asked",
     ids.length === 1 && ids[0] === KID && match === null && account === null && squad === false);
}
{
  const [, ids, match] = platformReadArgs({ resource: "x", subject: "match", squad: true }, "not-a-uuid", {});
  ok("a capture group that is no id is not a subject", ids.length === 0 && match === null);
}
{
  const [, , , , squad] = platformReadArgs({ resource: "x", squad: true }, MATCH, {});
  ok("the sheet is asked for only with a fixture subject", squad === false);
}

// ── Every GET route the dispatcher mounts is decided ──
// server.mjs also refuses to start on a route in neither set; this reads the
// source so the omission is named without starting a server.
const src = readFileSync(fileURLToPath(new URL("../server.mjs", import.meta.url)), "utf8");
const block = (/** @type {string} */ from, /** @type {string} */ to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  return a < 0 || b < 0 ? "" : src.slice(a, b);
};
const logged = block("const PLATFORM_LOGGED = new Map(", "]));");
const notLogged = block("const NOT_PLATFORM_LOGGED = new Set([", "]);");
const handlers = [...src.matchAll(/\[\s*\/\^.+?\$\/\s*,\s*"GET"\s*,\s*([A-Za-z]+\.[A-Za-z]+)/g)].map((m) => m[1]);
const named = (/** @type {string} */ text, /** @type {string} */ h) => new RegExp(`(^|[^A-Za-z.])${h.replace(".", "\\.")}([^A-Za-z]|$)`, "m").test(text);
ok(`the route tables mount GET routes (${handlers.length})`, handlers.length >= 60);
const undecided = handlers.filter((h) => !named(logged, h) && !named(notLogged, h));
ok("every GET route is in PLATFORM_LOGGED or NOT_PLATFORM_LOGGED", undecided.length === 0, undecided.join(", "));
const both = handlers.filter((h) => named(logged, h) && named(notLogged, h));
ok("...and none is in both", both.length === 0, both.join(", "));
for (const h of ["publicName.read", "sheet.read", "events.list", "signIn.preview", "signIn.accountSignIns", "potm.state"])
  ok(`${h} (a child's data) is logged for the platform`, named(logged, h));
ok("the dispatcher writes the row before the answer leaves, and refuses one it cannot write",
   /logPlatformRead\([^)]*\);[\s\S]{0,400}not_logged[\s\S]{0,200}out\.flush\(\)/.test(src));

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
