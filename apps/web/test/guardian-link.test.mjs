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
 *   - N6 (GA-I20 D7): the terms' text is the approved text, by hash per
 *     version and equal to docs/design/GUARDIAN_TERMS.md §1; rendered, no
 *     placeholder is left; the parent's refusals are words
 *
 *   node apps/web/test/guardian-link.test.mjs
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  GUARDIAN_TERMS_VERSION, GUARDIAN_TERMS, AGREE_KEPT_WORDS, agreeRefusalWords, agreedWords, confirmWords, doneWords,
  guardianCandidates, guardianLinkWords, renderTerms, termsContacts, termsRuns,
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

group("N6: the terms' text is the version's, the approved text, and renders whole");
{
  // One entry per version ever shown. Changing a sentence without a new
  // version fails here; a new version adds a line, and the old text stays.
  const APPROVED = { "popia-2026-01": "807ccf8b527aa2bff1818bf967300c0550e21b543bcbeab3451d81e212d88b37" };
  const hash = createHash("sha256").update(JSON.stringify({ title: GUARDIAN_TERMS.title, sections: GUARDIAN_TERMS.sections })).digest("hex");
  ok("the text's hash is the one approved for its version", GUARDIAN_TERMS.version === GUARDIAN_TERMS_VERSION
     && APPROVED[GUARDIAN_TERMS.version] === hash, hash);
  // The design doc's §1, as a blockquote, rebuilt from the constant: byte for byte.
  const doc = readFileSync(new URL("../../../docs/design/GUARDIAN_TERMS.md", import.meta.url), "utf8");
  const quote = doc.slice(doc.indexOf("> ### "), doc.indexOf("\n---", doc.indexOf("> ### "))).trimEnd();
  const lines = [`> ### ${GUARDIAN_TERMS.title}`, `> *Version ${GUARDIAN_TERMS.version}*`];
  for (const sec of GUARDIAN_TERMS.sections) {
    lines.push(">");
    if (sec.heading) lines.push(`> **${sec.heading}**`);
    sec.paragraphs.forEach((p, i) => { if (i) lines.push(">"); lines.push(`> ${p}`); });
  }
  ok("the constant is the design doc's §1, byte for byte", lines.join("\n") === quote, quote.slice(0, 120));
  ok("Kameel's Q2 and Q5 lines are in it",
     GUARDIAN_TERMS.sections.some((s) => s.heading === "Your rights" && s.paragraphs.includes("The Information Regulator of South Africa (inforegulator.org.za)."))
     && GUARDIAN_TERMS.sections.some((s) => s.heading === "Why" && s.paragraphs[0].endsWith("If he has his own sign-in, the same agreement covers his account.")));
  const text = GUARDIAN_TERMS.sections.flatMap((s) => [s.heading ?? "", ...s.paragraphs]).join("\n");
  ok("its only placeholders are the two contacts", (text.match(/\{[^}]*\}/g) ?? []).sort().join() === "{SCRBRD contact},{school contact}");
  const shown = renderTerms(termsContacts("Hilton College"));
  const flat = shown.flatMap((s) => [s.heading ?? "", ...s.paragraphs]).join("\n");
  ok("rendered, no placeholder is left", !/[{}]/.test(flat), flat.match(/\{[^}]*\}/g));
  ok("...the school's contact is its head through the office; SCRBRD's the platform's",
     flat.includes("The school's information officer: the principal of Hilton College, through the school office.")
     && flat.includes("SCRBRD's information officer: the SCRBRD information officer, via the school office."));
  ok("...and only the contacts changed", shown.length === GUARDIAN_TERMS.sections.length
     && shown.slice(0, -1).every((s, i) => JSON.stringify(s) === JSON.stringify(GUARDIAN_TERMS.sections[i])));
  ok("no school name: 'the school', never a blank", JSON.stringify(renderTerms(termsContacts(null))).includes("the principal of the school,"));
  ok("the marks: bold, italic and plain, nothing else",
     JSON.stringify(termsRuns("You agree for **one child, at one school**, *See it:* x"))
       === JSON.stringify([{ kind: "text", text: "You agree for " }, { kind: "strong", text: "one child, at one school" },
                           { kind: "text", text: ", " }, { kind: "em", text: "See it:" }, { kind: "text", text: " x" }]));
  ok("every run of the text joins back to the text without its marks",
     GUARDIAN_TERMS.sections.every((s) => s.paragraphs.every((p) => termsRuns(p).map((r) => r.text).join("") === p.replace(/\*\*|\*/g, ""))));
}

group("N6: what the parent is told she agrees to, and what she is told if it is refused");
{
  ok("what is kept: her agreement, the version and the time, against her name",
     AGREE_KEPT_WORDS === "Your agreement, this version and the time are kept against your name.");
  ok("the done words are the record's: Agreed · day, time · version",
     agreedWords("2026-11-05T14:02:00Z", "popia-2026-01") === "Agreed · 5 Nov 2026, 16:02 · popia-2026-01", agreedWords("2026-11-05T14:02:00Z", "popia-2026-01"));
  for (const code of ["no_verified_link", "not_permitted", "no_consent_version", "no_such_player"]) {
    const w = agreeRefusalWords({ status: 403, code }, "Rohan");
    ok(`${code}: a refusal in words, saying nothing was recorded`, w.kind === "refused" && /Nothing was recorded|not recorded/.test(w.text) && !w.text.includes(code), w.text);
  }
  ok("no answer is a failure, not a refusal", agreeRefusalWords(new Error("offline"), "Rohan").kind === "failed");
  ok("an unknown code is a failure with the code, not a raw refusal", agreeRefusalWords({ status: 500, code: "boom" }, "Rohan").text.includes("boom"));
}

console.log(`\nGUARDIAN LINK SCREEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
