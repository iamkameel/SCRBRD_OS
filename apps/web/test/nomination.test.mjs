/**
 * The captain's Player of the Match nomination: the words (RECOGNITION R7;
 * lib/nomination.js, nomination-api.mjs CAPTAIN_WORDS and NOMINATION_WORDS,
 * views/matchcentre/captainPotm.jsx and potm.jsx; db/144).
 *
 *   - the Captain tab's lead, the tap and the confirm sheet in §7's words
 *   - his own row's five states in neutral words (D17's sketch), the time in
 *     the fixture's zone, never "rejected", "declined" or "overruled"
 *   - the coach's line and the To-resolve row (D18), the vice-captain named
 *     as such, a failed read said as one
 *   - every refusal db/144's doors can answer has words, none is a code
 *   - the screens draw nothing under 12px, no text box on the captain's block
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/nomination.test.mjs
 */
import { readFileSync } from "node:fs";
import { captainLead, dayName, dayTime, mineWords, nominateConfirmWords, nominateLabel, nominationRows, nominatorWord,
         staffLine, NO_AWARD_WORDS } from "../src/lib/nomination.js";
import { CAPTAIN_WORDS, NOMINATION_WORDS, captainWords, nominationWords } from "../../../services/api/write/nomination-api.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 240)}`); } };
const group = (t) => console.log("\n" + t);

// Sat 3 Oct 2026 20:14 in Johannesburg is 18:14Z; "now" is the Sunday morning.
const SAT = "2026-10-03T18:14:00Z";
const SUN = "2026-10-04T08:00:00Z";
const MON = "2026-10-05T18:14:00Z";
const NOW = Date.parse("2026-10-04T09:00:00Z");

group("Times, in the fixture's zone");
ok("Sat 20:14", dayTime(SAT, NOW) === "Sat 20:14", dayTime(SAT, NOW));
ok("a date once it is more than six days away", dayTime(SAT, Date.parse("2026-10-20T09:00:00Z")) === "Sat 3 Oct 20:14");
ok("Monday", dayName(MON) === "Monday");
ok("nothing is nothing", dayTime(null, NOW) === null && dayName(undefined) === null);

group("The Captain tab (D17, §7 the captain)");
ok("the lead names the coach", captainLead("Mr Dlamini") === "Nominate one team-mate. Mr Dlamini decides. You cannot choose yourself.");
ok("...and says the coach when the side has none on record", captainLead(null) === "Nominate one team-mate. Your coach decides. You cannot choose yourself.");
ok("the tap names the boy, by initial and surname", nominateLabel("Rohan Pillay") === "Nominate R Pillay");
ok("...and waits for a choice", nominateLabel(null) === "Choose a team-mate first");
ok("the confirm sheet says who decides", nominateConfirmWords("Rohan Pillay", "Mr Dlamini")
   === "This sends R Pillay to Mr Dlamini as your nomination. He decides, and the side hears it from him.");

group("His own row, in neutral words");
const mine = (o) => ({ nomineeName: "R Pillay", nominatedAt: SAT, closesAt: MON, ...o });
ok("open", mineWords(mine({ status: "open" }), "Mr Dlamini", NOW).join(" | ") === "You nominated R Pillay · Sat 20:14 | With Mr Dlamini.");
ok("confirmed: the honour, as the side sees it", mineWords(mine({ status: "confirmed", award: { name: "R Pillay", awardedAt: SUN, same: true } }), "Mr Dlamini", NOW).join(" | ")
   === "You nominated R Pillay · Sat 20:14 | Player of the Match: R Pillay · Sun");
ok("superseded: the coach decided, no verdict word", mineWords(mine({ status: "superseded", award: { name: "K Naidoo", same: false } }), "Mr Dlamini", NOW).join(" | ")
   === "You nominated R Pillay · Sat 20:14 | Player of the Match: K Naidoo · the coach decided");
ok("no award", mineWords(mine({ status: "no_award" }), "Mr Dlamini", NOW)[1] === "No award for this match.");
ok("lapsed", mineWords(mine({ status: "lapsed" }), "Mr Dlamini", NOW)[1] === "The window closed on Monday.");
ok("no row, no lines", mineWords(null, "Mr Dlamini", NOW).length === 0);
const every = ["open", "confirmed", "superseded", "no_award", "lapsed"]
  .flatMap((status) => mineWords(mine({ status, award: { name: "K Naidoo" } }), "Mr Dlamini", NOW)).join(" ");
ok("never 'rejected', 'declined', 'overruled', 'chose', 'instead'", !/rejected|declined|overruled|\bchose\b|instead/i.test(every), every);

group("The coach's line and the To-resolve row (D18, §7 the coach)");
ok("the staff sheet's line", staffLine({ nomineeName: "Rohan Pillay", nominatedAs: "captain", closesAt: MON }, NOW) === "The captain nominated R Pillay · decide by Mon 20:14");
ok("...the vice-captain named as such", staffLine({ nomineeName: "R Pillay", nominatedAs: "vice_captain", closesAt: MON }, NOW).startsWith("The vice-captain nominated R Pillay"));
ok("nominatorWord", nominatorWord("captain") === "the captain" && nominatorWord("vice_captain") === "the vice-captain");
const q = nominationRows({ rows: [{ nominationId: "n1", matchId: "m1", nomineeName: "R Pillay", nominatedAs: "captain", closesAt: MON }], now: NOW });
ok("the To-resolve row, its deadline and its one door", q.rows.length === 1 && q.open === 1 && q.failed === 0
   && q.rows[0].fact === "Player of the Match to decide · the captain nominated R Pillay"
   && q.rows[0].deadline?.words === "by Mon 20:14" && q.rows[0].deadline.due === false
   && q.rows[0].action?.kind === "result" && q.rows[0].action.matchId === "m1" && q.rows[0].owner === "you", JSON.stringify(q.rows[0]));
const f = nominationRows({ rows: null, now: NOW, error: "unreachable" });
ok("a failed read is a row that says so, never an empty list", f.rows.length === 0 && f.unread.length === 1 && f.failed === 1
   && f.unread[0].state === "could_not_read" && /Could not read the nominations to decide/.test(f.unread[0].fact));
ok("the no-award sheet says the side is not told", /The side is not told/.test(NO_AWARD_WORDS));

group("Every refusal has words");
const captainReasons = ["not_permitted", "not_captain", "captain_on_sheet", "not_on_sheet", "nominee_not_on_sheet", "cannot_nominate_yourself",
  "not_verified", "already_awarded", "window_closed", "already_nominated", "already_decided", "no_season", "stale", "derived_from_invalid"];
ok("each of captain_nominate()'s answers", captainReasons.every((r) => typeof CAPTAIN_WORDS[r] === "string" && captainWords(r) === CAPTAIN_WORDS[r]),
   captainReasons.filter((r) => !CAPTAIN_WORDS[r]).join());
ok("...none says rejected, declined or overruled, or names a reason", !/rejected|declined|overruled|because/i.test(Object.values(CAPTAIN_WORDS).join(" ")));
ok("himself, in D17's words", CAPTAIN_WORDS.cannot_nominate_yourself === "You cannot choose yourself.");
const decideReasons = ["lapsed", "already_decided", "action_invalid", "decider_is_nominator", "player_required"];
ok("each of match_nomination_decide()'s own answers", decideReasons.every((r) => typeof NOMINATION_WORDS[r] === "string"));
ok("...and R6's come through in R6's words, the guardian told who decides",
   nominationWords("guardian_conflict", "principal") === "You are his guardian, so the principal decides."
   && nominationWords("not_verified", null).startsWith("Player of the Match is decided once"));

group("The screens");
const block = readFileSync(new URL("../src/views/matchcentre/captainPotm.jsx", import.meta.url), "utf8");
const staff = readFileSync(new URL("../src/views/matchcentre/potm.jsx", import.meta.url), "utf8");
const sizes = [...(block + staff).matchAll(/fontSize:\s*"(\d+(?:\.\d+)?)px"/g)].map((m) => Number(m[1]));
ok("no text under 12px", sizes.length > 0 && sizes.every((n) => n >= 12), sizes.join());
ok("the captain's block has no text box: a nomination is a choice, not a message (SG-9)", !/<textarea|type="text"|contentEditable/i.test(block));
ok("...its one tap is 56px and the rest 44px", /minHeight: tall \? "56px" : "44px"/.test(block) && /minHeight: "44px"/.test(block));
ok("...a choice is a radio, never colour alone", /type="radio"/.test(block));
ok("...and it names no opposition: it draws the door's sheet and the suggestions only", !/away|opposition|opponent/i.test(block.replace(/\/\*[\s\S]*?\*\//g, "")));

console.log(`\nnomination: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
