/**
 * The words for a request that could not be answered or withdrawn.
 *
 *   - Management → Requests → Grant / Decline: every refusal
 *     decide_role_request() can give (db/62, db/86) and every check the route
 *     makes before it has a plain sentence, by code; no sentence is a code.
 *   - A refusal with no known code falls back to the server's own `detail`,
 *     then to a plain "not answered", and no answer at all says so.
 *   - A success is "Granted: {role} at {team}." or "Declined.".
 *   - The withdraw button: a refusal, a withdraw that changed nothing
 *     ({ withdrawn: 0 }) and no answer at all each say so in words.
 *   - Neither screen swallows the call's error any more.
 *
 *   node apps/web/test/decide-words.test.mjs
 */
import { readFileSync } from "node:fs";
import { DECIDE_WORDS, decideWords, decidedWords } from "../src/lib/decideWords.js";
import { WITHDRAW_WORDS, withdrawWords, withdrew } from "../src/lib/joinSchool.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const apiError = (status, code, detail) => Object.assign(new Error(code), { status, code, detail: detail ?? null });
const plain = (w) => typeof w === "string" && /\s/.test(w) && !/_/.test(w);

group("Every refusal of decide_role_request() has a sentence");
{
  const codes = new Set();
  for (const f of ["db/62_guardian_link_past_eighteen.sql", "db/86_platform_roles_need_no_school.sql"]) {
    let sql = read(`../../../${f}`);
    // db/62 holds other functions too: only decide_role_request()'s own body.
    const at = sql.indexOf("FUNCTION decide_role_request(");
    if (f.startsWith("db/62")) sql = sql.slice(at, sql.indexOf("END $$", at));
    for (const m of sql.matchAll(/SELECT false, ''?([a-z_]+)''?, NULL::uuid/g)) codes.add(m[1]);
  }
  ok("the migrations give at least the nine refusals the map lists", codes.size >= 9, [...codes].join(" "));
  const missing = [...codes].filter((c) => !DECIDE_WORDS[c]);
  ok("each one has words", missing.length === 0, missing.join(" "));
  const route = read("../../../services/api/write/requests-api.mjs");
  const decide = route.slice(route.indexOf("decide: handle"));
  const checks = new Set([...decide.matchAll(/err\("([a-z_]+)"/g)].map((m) => m[1]));
  const unsaid = [...checks].filter((c) => c !== "refused" && !DECIDE_WORDS[c]);
  ok("...and so does each check the route makes first", unsaid.length === 0, unsaid.join(" "));
  ok("the route's own not_permitted and the sign-in codes too",
     ["not_permitted", "missing_token", "token_expired"].every((c) => DECIDE_WORDS[c]));
  const bad = Object.entries(DECIDE_WORDS).filter(([, w]) => !plain(w));
  ok("every sentence is words, never a code", bad.length === 0, bad.map(([c]) => c).join(" "));
}

group("By code, then the server's detail, then what we know without it");
{
  for (const code of Object.keys(DECIDE_WORDS)) {
    ok(`${code}: the code's own sentence`, decideWords(apiError(422, code)) === DECIDE_WORDS[code]);
  }
  ok("the code wins over the detail", decideWords(apiError(422, "team_required", "Other.")) === DECIDE_WORDS.team_required);
  ok("a code nobody has words for says the server's detail", decideWords(apiError(422, "odd_new_code", "The office's words.")) === "The office's words.");
  const bare = decideWords(apiError(500, "internal_error"));
  ok("...with no detail, it still says the request was not answered, with no code in it", /not answered/.test(bare) && !/internal_error/.test(bare), bare);
  const gone = decideWords(new TypeError("Failed to fetch"));
  ok("no answer at all says so, and to check the list", /could not be reached/.test(gone) && /Check the list/.test(gone), gone);
  ok("nothing at all is the same", decideWords(undefined) === gone);
  ok("team_required tells her what to do", /Choose which side/.test(DECIDE_WORDS.team_required));
  ok("platform_role_needs_no_school says a school cannot grant it", /not to a school/.test(DECIDE_WORDS.platform_role_needs_no_school));
}

group("A success is said plainly");
{
  ok("granted, with the side", decidedWords(true, "Coach", "U15A") === "Granted: Coach at U15A.");
  ok("granted, with no side", decidedWords(true, "Guardian", null) === "Granted: Guardian.");
  ok("declined", decidedWords(false, "Coach", "U15A") === "Declined.");
}

group("Withdrawing");
{
  ok("a withdraw that changed nothing is not a withdrawal", !withdrew({ withdrawn: 0 }) && !withdrew(null) && !withdrew({}));
  ok("...and one row is", withdrew({ withdrawn: 1 }));
  ok("a request answered first is said so", /no longer waiting/.test(WITHDRAW_WORDS.not_waiting));
  ok("a sign-in that lapsed says to sign in", /Sign in again/.test(withdrawWords(apiError(401, "token_expired"))) && /Sign in again/.test(withdrawWords(apiError(401, "missing_token"))));
  ok("a 403 says it cannot be withdrawn", /cannot withdraw/.test(withdrawWords(apiError(403, "not_permitted"))));
  const odd = withdrawWords(apiError(500, "internal_error"));
  ok("a code nobody has words for is not shown as a code", /not withdrawn/.test(odd) && !/internal_error/.test(odd), odd);
  const gone = withdrawWords(new TypeError("Failed to fetch"));
  ok("no answer at all says the request may still be waiting", /Could not reach/.test(gone) && /still be waiting/.test(gone), gone);
  const bad = Object.entries(WITHDRAW_WORDS).filter(([, w]) => !plain(w));
  ok("every sentence is words", bad.length === 0, bad.map(([c]) => c).join(" "));
}

group("The two buttons no longer swallow the error");
{
  const mgmt = read("../src/views/ManagementView.jsx");
  const decide = mgmt.slice(mgmt.indexOf("const decide = async"), mgmt.indexOf("const needsChild"));
  ok("decide catches to say a refusal, and not to ignore it", /catch \(e\)/.test(decide) && /decideWords\(e\)/.test(decide) && !/catch\(\(\) => \{\}\)/.test(decide), decide.slice(0, 200));
  ok("...the success is set after the awaited reply", decide.indexOf("await api(") < decide.indexOf("decidedWords("));
  ok("...the refusal is an alert with a test id", /role=\{x\.ok \? "status" : "alert"\}/.test(mgmt) && /request-refused-/.test(mgmt));
  const ns = read("../src/auth/NoSchool.jsx");
  const w = ns.slice(ns.indexOf("const withdraw = async"), ns.indexOf("A reload drops"));
  ok("withdraw catches to say a refusal", /catch \(e\)/.test(w) && /withdrawWords\(e\)/.test(w) && !/catch\(\(\) => \{\}\)/.test(w), w.slice(0, 200));
  ok("...and shows it as an alert", /role="alert" data-testid="withdraw-problem"/.test(ns));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
