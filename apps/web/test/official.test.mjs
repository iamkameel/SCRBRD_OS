/**
 * The official result's words (OFFICIAL_RESULT D11, D12, D13; lib/official.js,
 * views/matchcentre/official.jsx, lib/queue.js resultRows()).
 *
 * Held here:
 *   - the public and a family read "Provisional" or "Official result ·
 *     confirmed …": the time only, never a role, never "under review" (Q3)
 *   - staff read the role word, the dispute's side and time, what a
 *     provisional result waits on, and "was official … reopened … needs
 *     confirming again"
 *   - every refusal the doors can answer (db/114) has words, and none of them
 *     is a code
 *   - the To-resolve rows: one per match, a door to the fixture, no person, no
 *     note; a league organiser appointed with no school is a reader
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/official.test.mjs
 */
import { readFileSync } from "node:fs";
import { publicOfficial, officialWords, whenWords, ROLE_WORDS, BLOCK_WORDS } from "../src/lib/official.js";
import { OFFICIAL_REFUSALS } from "../src/views/matchcentre/official.jsx";
import { isQueueReader, resultRows, resultsReader } from "../src/lib/queue.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 240)}`); } };
const group = (t) => console.log("\n" + t);

// 11 Oct 2026, 20:15 SAST = 18:15Z; "now" the same evening, and two days on.
const AT = "2026-10-11T18:15:00Z";
const SAME = Date.parse("2026-10-11T19:00:00Z");
const LATER = Date.parse("2026-10-13T08:00:00Z");

group("The clock: SAST, the date once it is not today");
ok("same day: the time", whenWords(AT, SAME) === "20:15", whenWords(AT, SAME));
ok("another day: the time and the date", whenWords(AT, LATER) === "20:15, 11 Oct", whenWords(AT, LATER));
ok("nothing to say for no time", whenWords(null, SAME) === null);

group("The public page: provisional or official, the time only (Q3)");
ok("not decided: no label", publicOfficial({ outcome: "in_progress" }, "live", SAME) === null && publicOfficial(null, "complete") === null);
ok("official, and when", JSON.stringify(publicOfficial({ outcome: "home_win", official: true, officialAt: AT }, "complete", LATER))
   === JSON.stringify({ kind: "official", why: "confirmed 20:15, 11 Oct" }));
ok("not official: Provisional, with nothing after it", JSON.stringify(publicOfficial({ outcome: "home_win", official: false }, "complete", LATER))
   === JSON.stringify({ kind: "provisional", why: null }));

group("A family reads the public's words, whatever the state");
const fam = (o) => officialWords({ staff: false, ...o }, { home: "Hilton College 1XI", away: "Westville Boys' High 1XI" }, LATER);
ok("official: the time, never the role", JSON.stringify(fam({ state: "official", confirmedAt: AT })) === JSON.stringify({ kind: "official", why: "confirmed 20:15, 11 Oct" }));
ok("a dispute reaches him as provisional (the server already says so)", fam({ state: "under_review" })?.kind === "provisional");
ok("reopened by a correction: Provisional · corrected …", fam({ state: "provisional", lapsedAt: AT })?.why === "corrected 20:15, 11 Oct");
ok("not finished: no label", fam({ state: "not_finished" }) === null);

group("Staff read the role words (D11)");
const st = (o) => officialWords({ staff: true, ...o }, { home: "Hilton College 1XI", away: "Westville Boys' High 1XI" }, LATER);
ok("confirmed by the organiser, and when", st({ state: "official", confirmedAs: "organiser", confirmedAt: AT })?.why === "confirmed by the organiser, 20:15, 11 Oct");
ok("under review, disputed by the away side", JSON.stringify(st({ state: "under_review", disputedAs: "away_school", disputedAt: AT }))
   === JSON.stringify({ kind: "review", why: "disputed by Westville Boys' High 1XI, 20:15, 11 Oct" }));
ok("provisional, and what it waits on", st({ state: "provisional", blockedBy: "amendment_pending" })?.why === BLOCK_WORDS.amendment_pending);
ok("provisional, waiting for nobody but the confirmer", st({ state: "provisional" })?.why === "awaiting confirmation");
ok("was official, reopened by a correction, needs confirming again",
   st({ state: "provisional", wasOfficialAt: AT, lapsedAt: "2026-10-13T06:00:00Z", lapsedReason: "correction" })?.why
     === "was official 20:15, 11 Oct · reopened by a correction 08:00 · needs confirming again");
ok("...or the confirmation withdrawn", /the confirmation was withdrawn/.test(st({ state: "provisional", wasOfficialAt: AT, withdrawnAt: AT })?.why ?? ""));
ok("every role word is a phrase", Object.values(ROLE_WORDS).every((w) => /^the /.test(w)));

group("Every door's refusal has words (db/114)");
{
  const sql = readFileSync(new URL("../../../db/114_official_result.sql", import.meta.url), "utf8");
  const codes = new Set([...sql.matchAll(/SELECT false, '([a-z_]+)'::text/g)].map((m) => m[1]));
  for (const c of ["not_permitted", "not_finished", "innings_unsealed", "amendment_pending", "ball_held", "already_official", "you_wrote_this_log"])
    codes.add(c);
  const missing = [...codes].filter((c) => !OFFICIAL_REFUSALS[c]);
  ok(`each of the ${codes.size} codes the doors answer has words`, codes.size >= 15 && missing.length === 0, missing.join(" "));
  ok("...and none of the words is a code", Object.entries(OFFICIAL_REFUSALS).every(([c, w]) => !w.includes(c) && /\s/.test(w)));
  ok("you_wrote_this_log says why, and who confirms instead", /somebody else confirms it/.test(OFFICIAL_REFUSALS.you_wrote_this_log));
}

group("D13: Looks right stays this phone's, and says so");
{
  const ft = readFileSync(new URL("../src/views/matchcentre/fulltime.jsx", import.meta.url), "utf8");
  ok("the device-only words", /it does not make the result official/.test(ft) && /data-testid="mc-confirm-device"/.test(ft));
  ok("a confirmer sees Confirm result in its place, opening the sheet that writes", /official\?\.may\?\.confirm && onConfirm/.test(ft) && /data-testid="mc-confirm-result"/.test(ft));
  ok("Looks right still writes nothing: localStorage only", /dismiss\(match\.id\)/.test(ft) && !/api\(`\/api\/matches\/\$\{match\.id\}\/confirm`/.test(ft));
}

group("The To-resolve rows (§3, GA-I09)");
{
  const NOW = Date.parse("2026-10-14T08:00:00Z");
  const r = resultRows({ now: NOW, rows: [
    { matchId: "m1", startsAt: "2026-10-11T08:00:00Z", home: "Hilton College 1XI", away: "Westville Boys' High 1XI", competitionId: "c1", kind: "confirm" },
    { matchId: "m2", startsAt: "2026-10-12T08:00:00Z", home: "Hilton College 2XI", away: "Kearsney College", competitionId: null, kind: "blocked", blockedBy: "amendment_pending" },
    { matchId: "m3", startsAt: "2026-10-10T08:00:00Z", home: "A", away: "B", competitionId: "c1", kind: "review", windowClosesAt: "2026-10-17T08:00:00Z" },
  ] });
  ok("one row each: to confirm, blocked with its reason, under review with its window",
     r.rows.length === 3 && r.rows[0].rule === "R1" && r.rows[0].fact === "Result to confirm · Hilton College 1XI v Westville Boys' High 1XI"
     && r.rows[1].rule === "R2" && /a correction is awaiting approval/.test(r.rows[1].fact)
     && r.rows[2].rule === "R3" && /window closes/.test(r.rows[2].deadline?.words ?? ""), JSON.stringify(r.rows.map((x) => x.fact)));
  ok("each opens its fixture", r.rows.every((x) => x.action?.kind === "result" && typeof x.action.matchId === "string"));
  ok("played … ago, from the fixture's start", r.rows[0].age === "played 3 days ago", r.rows[0].age);
  const failed = resultRows({ rows: null, now: NOW, error: "unreachable" });
  ok("a read that failed is a row that says so", failed.failed === 1 && failed.unread[0].state === "could_not_read");
  ok("nothing names a person or a note", !/@|note|reason/i.test(JSON.stringify(r.rows.map((x) => x.fact))));
  const A = (role, school = null) => ({ role, school, team: null });
  ok("a league organiser appointed with no school reads it; a scorer and a coach do not",
     resultsReader([A("competitionadmin")]) && isQueueReader([A("competitionadmin")])
     && !resultsReader([A("scorer", "s1")]) && !resultsReader([A("coach", "s1")]) && resultsReader([A("principal", "s1")]));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
