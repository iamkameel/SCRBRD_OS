/**
 * A child's family links, for the office (Squad → a pupil → Family links;
 * account lifecycle slice 3, db/109): the pure half, lib/familyLinks.js.
 *
 *   - the adapter keeps every column the read gives and never invents a
 *     date of birth; the reason is only what the read returned
 *   - the standing line: the state, the verified links, the agreement
 *   - a link's words: live, ending, ended (each automatic kind, and a revoked
 *     link from before db/109 with no row)
 *   - "Revoke…" is offered only on a live link; the last verified link of a
 *     minor is said, not offered as a button that fails
 *   - the sheet's consequences say D14 before the tap, and the reason floor
 *   - every refusal guardian_link_revoke() answers has words, held to db/109
 *
 *   node apps/web/test/family-links.test.mjs
 */
import { readFileSync } from "node:fs";
import {
  REASON_MIN, REVOKE_KINDS, asChildLink, consequenceWords, isLastVerified, linkStateWords, mayOfferRevoke,
  reasonOk, revokeWords, standingLine,
} from "../src/lib/familyLinks.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const row = (over = {}) => ({
  link_id: "l1", school_id: "s1", player_id: "p1", guardian_id: "g1", guardian_name: "FL Mum", guardian_email: "mum@example.invalid",
  account_active: true, role_live: true, relationship: "parent", verification_state: "verified", verified_by_name: "B Naicker",
  verified_at: "2026-09-25T08:00:00Z", verified_note: null, consent_state: "granted", consent_version: "popia-2026-01",
  consent_at: "2026-09-25T08:00:00Z", valid_from: "2026-09-15", valid_until: null, created_by_name: "B Naicker",
  created_at: "2026-09-15T08:00:00Z", live: true, ending_kind: null, ending_on: null, ended_at: null, ended_by_name: null,
  ending_reason: null, standing: "active", is_minor: true, live_links: 2, consented_links: 2, ...over,
});

group("The adapter");
{
  const l = asChildLink(row());
  ok("keeps the link, the guardian, the state and the dates",
     l.id === "l1" && l.guardianName === "FL Mum" && l.state === "verified" && l.verifiedAt === "2026-09-25" && l.validFrom === "2026-09-15");
  ok("carries the standing as the server says it", l.standing === "active" && l.isMinor && l.liveLinks === 2);
  ok("never a date of birth", !("born" in l) && !Object.keys(l).some((k) => /born|birth/i.test(k)));
  ok("no reason unless the read gave one", l.endingReason === null && asChildLink(row({ ending_reason: "a reason here" })).endingReason === "a reason here");
}

group("The standing line");
{
  ok("two verified, both agreed", standingLine([asChildLink(row())]) === "Active · 2 verified links · terms agreed on both");
  ok("one verified, agreed", standingLine([asChildLink(row({ live_links: 1, consented_links: 1 }))]) === "Active · 1 verified link · terms agreed");
  ok("waiting for the agreement",
     standingLine([asChildLink(row({ standing: "pending_consent", live_links: 1, consented_links: 0 }))]) === "Waiting for the family's agreement · 1 verified link · terms agreed on 0");
  ok("no link ever", /No guardian has ever been linked/.test(standingLine([])));
}

group("A link, in words");
{
  ok("live and verified", linkStateWords(asChildLink(row())) === "Verified");
  ok("pending", linkStateWords(asChildLink(row({ verification_state: "pending" }))) === "Waiting to be verified");
  ok("revoked, with its kind and day",
     linkStateWords(asChildLink(row({ live: false, verification_state: "revoked", ending_kind: "custody", ending_on: "2026-10-15" })))
       === "Ended 2026-10-15 · custody changed");
  ok("a live link dated to his birthday after he left (D11)",
     /ends on his eighteenth birthday/.test(linkStateWords(asChildLink(row({ ending_kind: "majority", ending_on: "2029-03-01" })))));
  for (const k of ["role_ended", "left_school", "family_left", "guardian_asked", "office"]) {
    const w = linkStateWords(asChildLink(row({ live: false, verification_state: "revoked", ending_kind: k, ending_on: "2026-10-15" })));
    ok(`the kind ${k} has words, not its code`, !w.endsWith(`· ${k}`) && !w.includes("_"), w);
  }
  ok("revoked before db/109: no reason recorded, said so",
     /no reason recorded/.test(linkStateWords(asChildLink(row({ live: false, verification_state: "revoked", valid_until: "2026-01-01" })))));
}

group("Revoke…, offered and not");
{
  ok("on a live verified link", mayOfferRevoke(asChildLink(row())));
  ok("on a live pending link", mayOfferRevoke(asChildLink(row({ verification_state: "pending" }))));
  ok("never on an ended one", !mayOfferRevoke(asChildLink(row({ live: false, verification_state: "revoked" }))));
  ok("the last verified link of a minor is known", isLastVerified(asChildLink(row({ live_links: 1 }))));
  ok("...and not when there are two", !isLastVerified(asChildLink(row())));
  ok("...nor for an adult", !isLastVerified(asChildLink(row({ live_links: 1, is_minor: false }))));
}

group("The sheet");
{
  const w = consequenceWords({ guardian: "FL Mum" }).join(" ");
  ok("says his name comes off public pages until another answers", /name comes off public pages until another guardian answers/.test(w));
  ok("says the health consent lapses and her seats are voided", /Health monitoring consent .* lapses/.test(w) && /lift seats .* voided/.test(w));
  ok("says the contacts stay", /emergency contacts stay/.test(w));
  ok("says what she is told, and not", /Not his name, and not the reason/.test(w));
  ok("four kinds for the office, never an automatic one",
     REVOKE_KINDS.map((k) => k.id).join() === "custody,family_left,guardian_asked,office");
  ok("ten characters, trimmed", REASON_MIN === 10 && !reasonOk("  123456789  ") && reasonOk("1234567890"));
}

group("Refusals, in words");
{
  const say = (code, status = 403) => revokeWords({ code, status });
  ok("the last link, in the function's words",
     say("last_verified_link", 409).text === "He is under 18 and this is his only verified guardian. Link the new guardian first.");
  ok("no answer at all is a failure", revokeWords(new Error("offline")).kind === "failed");
  ok("an unknown code is a failure that names it", /weird/.test(say("weird", 500).text) && say("weird", 500).kind === "failed");
  const sql = readFileSync(new URL("../../../db/109_guardian_link_ending.sql", import.meta.url), "utf8");
  const from = sql.indexOf("FUNCTION guardian_link_revoke(p_link");
  const body = sql.slice(from, sql.indexOf("LANGUAGE plpgsql", from));
  const reasons = new Set([...body.matchAll(/SELECT false, '([a-z_]+)'/g)].map((m) => m[1]));
  ok("db/109 answers the ten reasons", reasons.size === 10, [...reasons].join());
  ok("each has words here", [...reasons].every((r) => say(r).kind === "refused"), [...reasons].filter((r) => say(r).kind !== "refused").join());
}

console.log(`\nFAMILY LINKS SCREEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
