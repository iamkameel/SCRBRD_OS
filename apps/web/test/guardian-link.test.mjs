/**
 * The office verifying a parent's link and recording the family's agreement
 * (Squad → Edit Profile → Guardian links): the pure half, lib/guardianLink.js.
 *
 *   - who may be picked: guardian appointments live today at the child's
 *     school, once each, never another school's, an ended or paused one, or an
 *     appointment of another kind
 *   - what the office is asked to confirm names the child, the parent and, for
 *     the agreement, the terms version
 *   - "done" words exist for both acts and are said by name
 *   - every code guardian_link_verify() and guardian_consent_record() answer has
 *     words, a refusal and a failure are told apart, and none is a raw code
 *   - the version is the one the seed and db/62 record
 *
 *   node apps/web/test/guardian-link.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  GUARDIAN_TERMS_VERSION, confirmWords, doneWords, guardianCandidates, guardianLinkWords,
} from "../src/lib/guardianLink.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const TODAY = "2026-10-08";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const appt = (over) => ({ id: `a-${Math.random()}`, personId: "p1", personName: "A Bekker", role: "guardian", school: HIL,
  active: true, suspended: false, validFrom: null, validUntil: null, ...over });
const users = [{ id: "p1", email: "a.bekker@example.invalid" }, { id: "p2", email: "d.pillay@example.invalid" }];

group("Who may be picked");
{
  const pick = (assignments, school = HIL) => guardianCandidates({ assignments, users, schoolId: school, today: TODAY });
  const one = pick([appt({})]);
  ok("a live guardian appointment at the child's school is offered", one.length === 1 && one[0].id === "p1");
  ok("...with the name and the email, so two parents of one name can be told apart", one[0].label === "A Bekker · a.bekker@example.invalid", one[0].label);
  ok("a parent with two appointments is offered once", pick([appt({}), appt({ id: "second" })]).length === 1);
  ok("another school's guardian is not offered", pick([appt({ school: WES })]).length === 0);
  ok("an ended appointment is not offered", pick([appt({ active: false })]).length === 0);
  ok("one dated out before today is not offered", pick([appt({ validUntil: "2026-10-08" })]).length === 0);
  ok("...and one that ends tomorrow still is", pick([appt({ validUntil: "2026-10-09" })]).length === 1);
  ok("a paused appointment is not offered", pick([appt({ suspended: true })]).length === 0);
  ok("a coach is not a parent", pick([appt({ role: "coach" })]).length === 0);
  ok("with no school named the school is not narrowed", guardianCandidates({ assignments: [appt({ school: WES })], users, schoolId: null, today: TODAY }).length === 1);
  const two = pick([appt({ personId: "p2", personName: "D Pillay" }), appt({})]);
  ok("the list is in name order", two.map((c) => c.name).join() === "A Bekker,D Pillay", two.map((c) => c.name).join());
  const noEmail = guardianCandidates({ assignments: [appt({ personId: "p9", personName: "Z Stranger" })], users, schoolId: HIL, today: TODAY });
  ok("a parent whose email is not readable is still offered, by name", noEmail.length === 1 && noEmail[0].label === "Z Stranger" && noEmail[0].email === null);
  ok("nothing at all is no list, not a throw", guardianCandidates({ assignments: undefined, users: undefined, schoolId: HIL, today: TODAY }).length === 0);
}

group("What the office is asked to confirm, and told");
{
  const who = { child: "T Bekker", guardian: "A Bekker" };
  const v = confirmWords("verify", who), c = confirmWords("consent", who);
  ok("verifying names the child and the parent", v.includes("T Bekker") && v.includes("A Bekker"), v);
  ok("...and says what the act is, and whose name it is kept against", /paperwork has been checked/.test(v) && /against your name/.test(v), v);
  ok("the agreement names the child, the parent and the version", c.includes("T Bekker") && c.includes("A Bekker") && c.includes(GUARDIAN_TERMS_VERSION), c);
  ok("...and says the time is kept", /the time are kept/.test(c), c);
  ok("an agreement for another version names that version", confirmWords("consent", { ...who, version: "popia-2027-01" }).includes("popia-2027-01"));
  ok("done: verified, by name", doneWords("verify", who) === "Verified. A Bekker's link to T Bekker is checked.", doneWords("verify", who));
  ok("done: recorded, with the version", doneWords("consent", who) === `Recorded. A Bekker agrees to the school's terms for T Bekker, version ${GUARDIAN_TERMS_VERSION}.`, doneWords("consent", who));
  ok("nothing says it is done before the server has answered: the question is a question",
     v.endsWith("against your name.") && v.includes("?") && c.includes("?") && !/^(Verified|Recorded)\./.test(v + c));
}

group("The terms version is the one already on record");
{
  ok("popia-2026-01", GUARDIAN_TERMS_VERSION === "popia-2026-01");
  const seed = readFileSync(new URL("../../../db/98_seed_pilot.sql", import.meta.url), "utf8");
  const db62 = readFileSync(new URL("../../../db/62_guardian_link_past_eighteen.sql", import.meta.url), "utf8");
  ok("the seed's agreed links carry it", seed.includes(`'${GUARDIAN_TERMS_VERSION}'`));
  ok("db/62's own-record links carry it", db62.includes(`'${GUARDIAN_TERMS_VERSION}'`));
}

group("Every refusal has words");
{
  const who = { child: "T Bekker", guardian: "A Bekker" };
  const say = (code, status = 403) => guardianLinkWords(Object.assign(new Error(code), { code, status }), who);
  // The reasons guardian_link_verify() and guardian_consent_record() answer (db/08).
  for (const code of ["not_permitted", "self_verified", "no_pending_link", "no_verified_link", "no_such_player", "no_consent_version"]) {
    const w = say(code, code === "no_such_player" ? 404 : 403);
    ok(`${code}: a refusal, in a sentence, never the code`, w.kind === "refused" && w.text.length > 30 && !w.text.includes(code), w.text);
    ok(`${code}: says nothing was changed`, /Nothing was changed/.test(w.text), w.text);
  }
  ok("no_pending_link names both people", say("no_pending_link").text.includes("A Bekker") && say("no_pending_link").text.includes("T Bekker"));
  ok("no_verified_link sends the office to verify first", /Verify the link first/.test(say("no_verified_link").text));
  ok("a session that ended is a refusal that says to sign in", say("session_revoked", 401).kind === "refused" && /Sign in again/.test(say("session_revoked", 401).text));
  const none = guardianLinkWords(new Error("fetch failed"), who);
  ok("no answer at all is a failure, said so", none.kind === "failed" && /Could not reach SCRBRD/.test(none.text), none.text);
  const odd = say("error", 500);
  ok("a code nobody knows is a failure that shows it, and says nothing changed", odd.kind === "failed" && /error/.test(odd.text) && /Nothing was changed/.test(odd.text), odd.text);

  // Held to the database: every reason the two functions answer has words here.
  const fns = readFileSync(new URL("../../../db/08_schema_programme.sql", import.meta.url), "utf8");
  const reasons = new Set();
  for (const name of ["guardian_link_verify", "guardian_consent_record"]) {
    const from = fns.indexOf(`FUNCTION ${name}(`);
    const body = fns.slice(from, fns.indexOf("LANGUAGE plpgsql", from));
    for (const m of body.matchAll(/SELECT false, '([a-z_]+)'/g)) reasons.add(m[1]);
  }
  ok("db/08 answers at least the six reasons read here", reasons.size >= 6, [...reasons].join());
  ok("each of them has words in this file", [...reasons].every((r) => say(r).kind === "refused"), [...reasons].filter((r) => say(r).kind !== "refused").join());
  const router = readFileSync(new URL("../../../services/api/write/assessment-api.mjs", import.meta.url), "utf8");
  ok("the two routes this screen posts to exist", /verify: handle/.test(router) && /consent: handle/.test(router));
}

console.log(`\nGUARDIAN LINK SCREEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
