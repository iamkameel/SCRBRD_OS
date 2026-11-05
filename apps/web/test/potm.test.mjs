/**
 * Player of the Match's words (RECOGNITION R6; lib/potm.js, potm-api.mjs
 * POTM_WORDS, views/matchcentre/potm.jsx; db/142).
 *
 *   - the initial and the surname, as db/142's match_award_short() makes them
 *   - the confirm sheet's sentence and the standing award's line (§7)
 *   - every refusal db/142's doors can answer has words, none is a code, and
 *     a guardian is told who decides instead (D10)
 *   - the withdrawal's two kinds say what the side is told (D21), and the
 *     words never say "rejected", "declined" or "overruled" (§7)
 *   - the sheet draws no colour-only state and nothing under 12px
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/potm.test.mjs
 */
import { readFileSync } from "node:fs";
import { shortName, confirmWords, standingWords, WITHDRAW_KINDS, REASON_MIN, REASON_MAX } from "../src/lib/potm.js";
import { POTM_WORDS, potmWords } from "../../../services/api/write/potm-api.mjs";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 240)}`); } };
const group = (t) => console.log("\n" + t);

group("Names: the initial and the surname");
ok("Rohan Pillay is R Pillay", shortName("Rohan Pillay") === "R Pillay");
ok("a middle name goes", shortName("Rohan  Dev Pillay") === "R Pillay");
ok("an initial stays", shortName("S Naidoo") === "S Naidoo");
ok("one name is itself", shortName("Cele") === "Cele");
ok("nothing is nothing", shortName(null) === "");

group("The sheet's sentences (§7, the coach)");
ok("the confirm sheet", confirmWords("Rohan Pillay") === "This awards Player of the Match to R Pillay and tells the side.");
const AT = "2026-10-04T18:15:00Z";
ok("the standing award, for staff: the name, the decider, the time",
   standingWords({ name: "Rohan Pillay", decidedBy: "Sarah Botha", awardedAt: AT }, Date.parse("2026-10-06T08:00:00Z"))
     === "Player of the Match: Rohan Pillay · decided by Sarah Botha, 20:15, 4 Oct");
ok("nothing standing, nothing said", standingWords(null) === null);
ok("the reason's limits are the door's", REASON_MIN === 3 && REASON_MAX === 200);

group("Every refusal has words");
const sql = readFileSync(new URL("../../../db/142_player_of_match.sql", import.meta.url), "utf8");
const reasons = [...new Set([...sql.matchAll(/SELECT false, '([a-z_]+)'::text/g)].map((m) => m[1]))];
ok("the doors answer at least nine reasons", reasons.length >= 9, reasons.join());
for (const r of reasons) {
  const w = potmWords(r, "directorofsport");
  ok(`${r}: words, not a code`, typeof w === "string" && w.length > 12 && !/_/.test(w) && w !== potmWords("no_such_reason"), w);
}
ok("a guardian is told the director of sport decides", /director of sport decides/.test(potmWords("guardian_conflict", "directorofsport")));
ok("...or the principal, when he is the director", /principal decides/.test(potmWords("guardian_conflict", "principal")));
ok("no word of verdict anywhere", !Object.values(POTM_WORDS).some((w) => /reject|declin|overrul|demot/i.test(w)));

group("Withdrawal: two kinds, and what each tells the side (D21)");
ok("correction and other, in that order", WITHDRAW_KINDS.map((k) => k.kind).join() === "correction,other");
ok("a correction is told to the side, naming nobody", /scorecard was corrected/.test(WITHDRAW_KINDS[0].says) && /Nobody is named/.test(WITHDRAW_KINDS[0].says));
ok("another reason is not told", /nothing more is said/.test(WITHDRAW_KINDS[1].says));

group("The sheet's floors");
const jsx = readFileSync(new URL("../src/views/matchcentre/potm.jsx", import.meta.url), "utf8");
const sizes = [...jsx.matchAll(/fontSize:\s*"(\d+)px"/g)].map((m) => Number(m[1]));
ok("no text under 12px", sizes.length > 0 && sizes.every((n) => n >= 12), sizes.join());
const heights = [...jsx.matchAll(/minHeight:\s*(?:tall \? "56px" : )?"(\d+)px"/g)].map((m) => Number(m[1]));
ok("every target at least 44px", heights.length > 0 && heights.every((n) => n >= 44), heights.join());
ok("the one tap is 56px", /minHeight: tall \? "56px"/.test(jsx) && /btn\(true, true\)/.test(jsx));
ok("a choice is a radio with words, never a colour alone", /type="radio"/.test(jsx) && !/outline:\s*`2px solid \$\{T\.brand/.test(jsx));
ok("nothing animates", !/transition|animation|@keyframes/.test(jsx));
ok("no suggestion is chosen for him", /useState\(\/\*\* @type \{string \| null\} \*\/ \(null\)\)/.test(jsx) && !/defaultChecked/.test(jsx));

console.log(`\n${"─".repeat(52)}\nPOTM WORDS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
